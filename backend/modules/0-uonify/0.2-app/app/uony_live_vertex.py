"""Server-only Vertex Live transport pilot for allowlisted accounts."""
import asyncio
import base64
from contextlib import suppress
from cryptography.fernet import Fernet
import json
import logging
import re

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from .access import workspace_access
from .google_cloud_provider import SCOPE
from .uony_live_bridge import (MAX_AUDIO_BYTES, MAX_FRAME_BYTES, LiveIdentity,
                               LiveInterrupted)
from .uony_live_messages import LiveServerMessages, MAX_UPSTREAM_MESSAGE
from .uony_live_caption_session import open_captioned_session
from .uony_live_instruction import live_instruction, live_tool_declarations
from .uony_live_transcribe import VertexTranscribeProvider
from .uony_live_wire import (_vertex_uri, _decode_message, _stream_envelope,
                             _stream_close_code)

SUPPORTED_MODELS = {'gemini-3.8-live': frozenset({'eu', 'us', 'us-central1'})}
PROJECT_ID = re.compile(r'[a-z][a-z0-9-]{4,62}[a-z0-9]')
INPUT_MIME = 'audio/pcm;rate=16000'
logger = logging.getLogger(__name__)

class VertexLiveSession(LiveServerMessages):
    def __init__(self, websocket):
        super().__init__()
        self.websocket = websocket
        self.closed = False
        self.manual_stop = False
        self.input_bytes = 0

    async def send_audio(self, pcm):
        if self.closed:
            raise RuntimeError('Live session closed')
        if not isinstance(pcm, bytes) or not pcm or len(pcm) > MAX_FRAME_BYTES or len(pcm) % 2:
            raise ValueError('invalid input PCM')
        if self.input_bytes + len(pcm) > MAX_AUDIO_BYTES:
            raise ValueError('input PCM limit')
        self.input_bytes += len(pcm)
        self._note_audio_input(pcm)
        await self.websocket.send(json.dumps({'realtimeInput': {'audio': {
            'mimeType': INPUT_MIME, 'data': base64.b64encode(pcm).decode('ascii')}}}))

    async def interrupt(self):
        # The API documents VAD barge-in, not a manual cancel message. A user
        # pressing Stop ends only this voice socket. It never cancels a job.
        self.manual_stop = True
        await self.close()

    async def respond_tool(self, call_id, name, response, scheduling=None):
        if (self.closed or name not in ('get_current_work', 'route_spoken_request')
                or not isinstance(call_id, str)
                or not 1 <= len(call_id) <= 128 or not isinstance(response, dict)
                or scheduling not in (None, 'WHEN_IDLE', 'SILENT')):
            raise ValueError('invalid Live tool response')
        item = {'id': call_id, 'name': name, 'response': response}
        if scheduling is not None:
            item['scheduling'] = scheduling
        await self.websocket.send(json.dumps({'toolResponse': {'functionResponses': [
            item]}}))

    async def send_system_context(self, text):
        # Vertex Live supports a mid-session system turn without completing a
        # user turn. A finished backend job remains data, never user consent.
        if (self.closed or not isinstance(text, str)
                or not 1 <= len(text) <= 12000 or text != text.strip()):
            raise ValueError('invalid Live system context')
        await self.websocket.send(json.dumps({'clientContent': {'turns': [
            {'role': 'system', 'parts': [{'text': text}]}], 'turnComplete': False}}))

    async def events(self):
        frame_type = 'none'
        envelope = 'none'
        try:
            async for message in self.websocket:
                frame_type = ('binary' if isinstance(message, bytes)
                              else 'text' if isinstance(message, str) else 'other')
                envelope = 'none'
                data = _decode_message(message)
                envelope = _stream_envelope(data)
                for event in self.translate(data):
                    yield event
        except ConnectionClosed as error:
            if not self.manual_stop:
                logger.warning('Live stream ended class=%s frame_type=%s envelope=%s ws_code=%s',
                               type(error).__name__, frame_type, envelope,
                               _stream_close_code(error, self.websocket))
                raise
        except Exception as error:
            logger.warning('Live stream failed class=%s frame_type=%s envelope=%s ws_code=%s',
                           type(error).__name__, frame_type, envelope,
                           _stream_close_code(error, self.websocket))
            raise
        if not self.manual_stop:
            logger.warning('Live stream ended class=CleanClose frame_type=%s envelope=%s ws_code=%s',
                           frame_type, envelope, _stream_close_code(None, self.websocket))
        if self.manual_stop:
            yield LiveInterrupted()

    async def close(self):
        if not self.closed:
            self.closed = True
            self.pcm_diagnostics.close()
            self.report_signals()
            await self.websocket.close()


class VertexLiveProvider:
    """Opt-in injection only; refresh and both ownership checks stay server-side."""

    def __init__(self, settings, database, cloud, *, model='gemini-3.8-live', location='eu',
                 caption_enabled=False):
        if location not in SUPPORTED_MODELS.get(model, ()):
            raise ValueError('unsupported Live model/location')
        if caption_enabled and location != 'eu':
            raise ValueError('caption pilot requires EU Live location')
        self.settings = settings
        self.database = database
        self.cloud = cloud
        self.model = model
        self.location = location
        self.caption_enabled = caption_enabled
        self.cipher = Fernet(settings.encryption_key)

    def _connection(self, identity):
        if not PROJECT_ID.fullmatch(identity.project_id):
            raise ValueError('invalid Cloud project')
        with self.database.connect() as c:
            user = c.execute('''SELECT id,email,google_subject,onboarding_completed_at
                FROM users WHERE id=%s''', (identity.user_id,)).fetchone()
            row = c.execute('''SELECT google_subject,project_id,status,project_check,
                refresh_encrypted,scope,connected_at FROM google_cloud_connections
                WHERE user_id=%s''', (identity.user_id,)).fetchone()
            if (not user or user['google_subject'] != identity.google_subject
                    or not user['onboarding_completed_at']
                    or workspace_access(c, user)['status'] != 'allowed'
                    or not row or row['google_subject'] != identity.google_subject
                    or row['project_id'] != identity.project_id
                    or row['status'] != 'connected'
                    or not (row['project_check'] or {}).get('ready')
                    or SCOPE not in (row['scope'] or '').split()):
                raise ValueError('Live Cloud identity unavailable')
            return row

    async def render_verified(self, identity, text, on_audio=None):
        # A dedicated, tool-free Live session; with on_audio its verified prefix
        # is released while generated. It cannot enqueue work or act as the user.
        from .uony_live_adk_narration import LiveSpeechRenderer
        return await LiveSpeechRenderer(self).render(identity, text, on_audio=on_audio)

    async def open(self, identity: LiveIdentity):
        stage = 'local_identity'
        websocket = None
        try:
            row = self._connection(identity)
            refresh = self.cipher.decrypt(row['refresh_encrypted'].encode()).decode()
            stage = 'oauth_refresh'
            token = await asyncio.to_thread(self.cloud.refresh, refresh)
            if not isinstance(token, str) or not token or '\r' in token or '\n' in token:
                raise ValueError('invalid Live access token')
            stage = 'identity_recheck'
            current = self._connection(identity)
            if any(current[key] != row[key] for key in
                   ('google_subject', 'project_id', 'connected_at', 'refresh_encrypted')):
                raise ValueError('Live Cloud connection changed')
            stage = 'socket_upgrade'
            websocket = await connect(_vertex_uri(self.location),
                                      additional_headers={'Authorization': f'Bearer {token}'},
                                      open_timeout=5, close_timeout=2,
                                      max_size=MAX_UPSTREAM_MESSAGE, max_queue=4)
            stage = 'setup'
            model = (f'projects/{identity.project_id}/locations/{self.location}'
                     f'/publishers/google/models/{self.model}')
            instruction = live_instruction(identity.context)
            await websocket.send(json.dumps({'setup': {'model': model,
                # The model-specific 3.8 Live SDK example uses AUDIO alone;
                # input/output transcription is configured separately below.
                'generationConfig': {'responseModalities': ['AUDIO']},
                'inputAudioTranscription': {}, 'outputAudioTranscription': {},
                'explicitVadSignal': True,
                'systemInstruction': {'parts': [{'text': instruction}]},
                'tools': live_tool_declarations()}}))
            first_frame = await asyncio.wait_for(websocket.recv(), timeout=5)
            frame_type = ('binary' if isinstance(first_frame, bytes)
                          else 'text' if isinstance(first_frame, str) else 'other')
            try:
                setup = _decode_message(first_frame)
            except ValueError:
                logger.warning('Live setup invalid frame_type=%s', frame_type)
                raise
            if not isinstance(setup.get('setupComplete'), dict) or 'error' in setup:
                # Only fixed envelope names and a bounded numeric error code
                # are logged; provider messages may contain account details.
                envelope = next((key for key in ('error', 'goAway', 'serverContent',
                    'usageMetadata', 'toolCall', 'sessionResumptionUpdate') if key in setup),
                    'other')
                error = setup.get('error')
                code = error.get('code') if isinstance(error, dict) else None
                if type(code) is not int or not 100 <= code <= 599:
                    code = 'none'
                logger.warning('Live setup unconfirmed frame_type=%s envelope=%s error_code=%s',
                               frame_type, envelope, code)
                raise ValueError('Live setup not confirmed')
            primary = VertexLiveSession(websocket)
            if self.caption_enabled and identity.user_id in self.settings.live_pilot_user_ids:
                return await open_captioned_session(primary, identity, token,
                                                    VertexTranscribeProvider())
            return primary
        except asyncio.CancelledError:
            logger.warning('Live upstream cancelled stage=%s class=CancelledError', stage)
            if websocket is not None:
                with suppress(Exception):
                    await asyncio.wait_for(websocket.close(), timeout=2)
            raise
        except Exception as error:
            # Do not log exception messages: HTTP/WebSocket errors can contain
            # request paths, project IDs or authentication details.
            response = getattr(error, 'response', None)
            status = getattr(response, 'status_code', None)
            if type(status) is not int or not 100 <= status <= 599:
                status = 'none'
            close_frame = getattr(error, 'rcvd', None) or getattr(error, 'sent', None)
            close_code = getattr(close_frame, 'code', None)
            if type(close_code) is not int or not 1000 <= close_code <= 4999:
                close_code = 'none'
            logger.warning('Live upstream failed stage=%s class=%s http_status=%s ws_code=%s',
                           stage, type(error).__name__, status, close_code)
            if websocket is not None:
                with suppress(Exception):
                    await websocket.close()
            raise
