"""Supplemental Vertex transcription for an existing Live voice session.

The caller supplies the short-lived OAuth token after its normal Cloud identity
checks. This adapter never receives browser credentials, tools, or conversation
history. Its final text may recover one explicitly ended chat turn when Live omits
the primary transcript, but it can never authorize tools or become a second user
action.
"""
import asyncio
import base64
from contextlib import suppress
from dataclasses import dataclass
import json
import logging
import re

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from .uony_live_bridge import MAX_AUDIO_BYTES, MAX_FRAME_BYTES, LiveIdentity
from .uony_live_usage import usage_counts


MODEL = 'gemini-3.5-transcribe-live'
LOCATION = 'eu'
INPUT_MIME = 'audio/pcm;rate=16000'
MAX_UPSTREAM_MESSAGE = 4 * 1024 * 1024
PROJECT_ID = re.compile(r'[a-z][a-z0-9-]{4,62}[a-z0-9]')
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TranscribeInterim:
    text: str


@dataclass(frozen=True)
class TranscribeFinal:
    text: str


@dataclass(frozen=True)
class TranscribeUsage:
    counts: dict


def _vertex_uri():
    # Same Vertex multi-region REP host and BidiGenerateContent wire as Live.
    return ('wss://aiplatform.eu.rep.googleapis.com/ws/google.cloud.aiplatform.'
            'v1beta1.LlmBidiService/BidiGenerateContent')


def _decode_message(message):
    if isinstance(message, bytes):
        try:
            message = message.decode('utf-8')
        except UnicodeDecodeError:
            raise ValueError('invalid Transcribe encoding') from None
    elif not isinstance(message, str):
        raise ValueError('non-json Transcribe response')
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        raise ValueError('invalid Transcribe JSON') from None
    if not isinstance(data, dict):
        raise ValueError('invalid Transcribe response')
    return data


def _text(item):
    if not isinstance(item, dict) or not isinstance(item.get('text'), str):
        raise ValueError('invalid Transcribe text')
    value = item['text'].strip()
    if len(value) > 3000 or ('finished' in item and type(item['finished']) is not bool):
        raise ValueError('invalid Transcribe marker')
    return value


def _close_code(error, websocket):
    frame = getattr(error, 'rcvd', None) or getattr(error, 'sent', None)
    code = getattr(frame, 'code', None) if frame else getattr(websocket, 'close_code', None)
    return code if type(code) is int and 1000 <= code <= 4999 else 'none'


class VertexTranscribeSession:
    """One optional caption socket. The owner must close it with the Live socket."""

    def __init__(self, websocket):
        self.websocket = websocket
        self.closed = False
        self.input_bytes = 0
        self.interims = 0
        self.finals = 0
        self.usage_reports = 0
        self.reported = False

    async def send_audio(self, pcm: bytes):
        if self.closed:
            raise RuntimeError('Transcribe session closed')
        if (not isinstance(pcm, bytes) or not pcm or len(pcm) > MAX_FRAME_BYTES
                or len(pcm) % 2):
            raise ValueError('invalid Transcribe PCM')
        if self.input_bytes + len(pcm) > MAX_AUDIO_BYTES:
            raise ValueError('Transcribe PCM limit')
        self.input_bytes += len(pcm)
        await self.websocket.send(json.dumps({'realtimeInput': {'audio': {
            'mimeType': INPUT_MIME, 'data': base64.b64encode(pcm).decode('ascii')}}}))

    async def events(self):
        envelope = 'none'
        try:
            async for message in self.websocket:
                data = _decode_message(message)
                envelope = next((key for key in ('error', 'toolCall', 'serverContent',
                    'inputTranscription', 'interimInputTranscription', 'usageMetadata',
                    'goAway', 'sessionResumptionUpdate', 'voiceActivity') if key in data),
                    'other')
                if 'error' in data or 'toolCall' in data or 'toolCallCancellation' in data:
                    raise ValueError('unexpected Transcribe action or error')
                if 'usageMetadata' in data:
                    counts = usage_counts(data['usageMetadata'])
                    if counts:
                        self.usage_reports += 1
                        yield TranscribeUsage(counts)
                content = data.get('serverContent')
                if content is not None and not isinstance(content, dict):
                    raise ValueError('invalid Transcribe content')
                content = content or {}
                final_item = content.get('inputTranscription', data.get('inputTranscription'))
                interim_item = content.get('interimInputTranscription',
                                           data.get('interimInputTranscription'))
                if interim_item is not None:
                    interim = _text(interim_item)
                    if interim:
                        self.interims += 1
                        yield TranscribeInterim(interim)
                if final_item is not None:
                    value = _text(final_item)
                    if value:
                        if final_item.get('finished') is False:
                            self.interims += 1
                            yield TranscribeInterim(value)
                        else:
                            self.finals += 1
                            yield TranscribeFinal(value)
        except ConnectionClosed as error:
            if not self.closed:
                logger.warning('Transcribe stream ended class=%s envelope=%s ws_code=%s',
                               type(error).__name__, envelope,
                               _close_code(error, self.websocket))
                raise
        except Exception as error:
            logger.warning('Transcribe stream failed class=%s envelope=%s ws_code=%s',
                           type(error).__name__, envelope,
                           _close_code(error, self.websocket))
            raise

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if not self.reported:
            self.reported = True
            logger.warning('Transcribe signals interim=%d finals=%d usage=%d input_bytes=%d',
                           self.interims, self.finals, self.usage_reports, self.input_bytes)
        with suppress(Exception):
            await asyncio.wait_for(self.websocket.close(), timeout=2)


class VertexTranscribeProvider:
    """Open the caption model with a token already verified by Uonify server."""

    async def open(self, identity: LiveIdentity, access_token: str):
        if (not isinstance(identity, LiveIdentity)
                or not PROJECT_ID.fullmatch(identity.project_id or '')
                or not isinstance(access_token, str) or not access_token
                or '\r' in access_token or '\n' in access_token):
            raise ValueError('invalid Transcribe identity')
        websocket = None
        stage = 'socket_upgrade'
        try:
            websocket = await connect(_vertex_uri(), additional_headers={
                'Authorization': f'Bearer {access_token}'}, open_timeout=5,
                close_timeout=2, max_size=MAX_UPSTREAM_MESSAGE, max_queue=4)
            stage = 'setup'
            model = (f'projects/{identity.project_id}/locations/{LOCATION}'
                     f'/publishers/google/models/{MODEL}')
            await websocket.send(json.dumps({'setup': {
                'model': model,
                'generationConfig': {'responseModalities': ['TEXT']},
                # The pinned Google Gen AI SDK emits this nested proto field
                # in snake_case for Vertex's BidiGenerateContent wire.
                'inputAudioTranscription': {'language_codes': ['es-ES']}}}))
            first = _decode_message(await asyncio.wait_for(websocket.recv(), timeout=5))
            if not isinstance(first.get('setupComplete'), dict) or 'error' in first:
                raise ValueError('Transcribe setup not confirmed')
            return VertexTranscribeSession(websocket)
        except asyncio.CancelledError:
            if websocket is not None:
                with suppress(Exception):
                    await asyncio.wait_for(websocket.close(), timeout=2)
            raise
        except Exception as error:
            # Upstream exception strings can include project names or headers.
            logger.warning('Transcribe open failed stage=%s class=%s',
                           stage, type(error).__name__)
            if websocket is not None:
                with suppress(Exception):
                    await asyncio.wait_for(websocket.close(), timeout=2)
            raise
