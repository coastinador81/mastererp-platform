"""ADK Live route: Runner.run_live with Uonify provenance and tools.

ADK-FLUJOS §§1-3 and §10.1. The conversation runs in ADK, one Runner,
session and LiveRequestQueue per voice socket. Original provider messages
reach the shared translator through the version-pinned tap, so transcripts,
VAD and audio events — and with them consent and provenance — are exactly
those of the raw route. ADK runs the model's tool calls in the background
through the router's server dispatcher; the router observes those calls and
never answers them a second time (single tool owner).
"""
import asyncio
import base64
from contextlib import aclosing, suppress
import logging
from uuid import uuid4

from google import genai
from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig
from google.adk.live.live_request_queue import LiveRequestQueue
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
import google.oauth2.credentials as oauth_credentials

from .uony_live_adk_tap import TappedGemini
from .uony_live_adk_tools import ServerTool
from .uony_live_bridge import MAX_AUDIO_BYTES, MAX_FRAME_BYTES, LiveInterrupted, LiveToolCall
from .uony_live_caption_session import open_captioned_session
from .uony_live_instruction import live_instruction, live_tool_declarations
from .uony_live_messages import LiveServerMessages
from .uony_live_transcribe import VertexTranscribeProvider
from .uony_live_vertex import VertexLiveProvider

APP_NAME = 'uonify_live'
INPUT_MIME = 'audio/pcm;rate=16000'
# LiveRequestQueue is unbounded: about four seconds of 32 ms frames.
MAX_PENDING_INPUT = 128
MAX_TRACKED_CALLS = 64
CLOSE_SECONDS = 2
logger = logging.getLogger(__name__)
_END, _FAILED = object(), object()


def provider_dict(message):
    """The provider message as the raw route decodes it from the wire.

    genai serializes bytes as URL-safe base64; the wire and the shared
    translator use standard base64 (real audio cut the voice, 20-10-2026).
    Audio is re-encoded from the exact original bytes.
    """
    data = message.model_dump(mode='json', by_alias=True, exclude_none=True)
    turn = message.server_content.model_turn if message.server_content else None
    if turn is not None and turn.parts:
        for part, original in zip(data['serverContent']['modelTurn']['parts'], turn.parts):
            if original.inline_data is not None and original.inline_data.data is not None:
                part['inlineData']['data'] = base64.b64encode(
                    original.inline_data.data).decode('ascii')
    return data


class AdkLiveSession(LiveServerMessages):
    """The existing LiveSession contract on top of ADK Runner.run_live."""

    tool_owner = 'adk'

    def __init__(self, model, client=None):
        super().__init__()
        self.model, self.client = model, client
        self.requests = LiveRequestQueue()
        self.closed = False
        self.manual_stop = False
        self.input_bytes = 0
        self._events = asyncio.Queue()
        self._failure = None
        self._dispatch = None
        self._runner = self._run_config = self._user_id = self._adk_session_id = None
        self._run_task = None
        self._call_turns = {}
        self._tool_tasks = {}
        model.tap(self._observe)

    def attach(self, runner, user_id, adk_session_id, run_config):
        self._runner, self._user_id = runner, user_id
        self._adk_session_id, self._run_config = adk_session_id, run_config

    def bind_tools(self, dispatch):
        """The router's server dispatcher: evidence, admission and observation."""
        self._dispatch = dispatch

    def turn_for_call(self, call_id):
        """User turn the provider was answering when it issued this call."""
        return self._call_turns.get(call_id)

    async def run_tool(self, call_id, name, args):
        if self.closed or self._dispatch is None:
            return {'status': 'blocked', 'reason': 'session_unavailable'}
        task = asyncio.current_task()
        self._tool_tasks[call_id] = task
        try:
            return await self._dispatch(call_id, name, args)
        finally:
            if self._tool_tasks.get(call_id) is task:
                del self._tool_tasks[call_id]

    def _observe(self, message):
        """Tap sink: synchronous and never raises into ADK's receive loop."""
        if self.closed or self._failure is not None:
            return
        try:
            data = provider_dict(message)
            cancellation = data.get('toolCallCancellation')
            if isinstance(cancellation, dict):
                for call_id in cancellation.get('ids') or ():
                    task = self._tool_tasks.get(call_id)
                    if task is not None:
                        task.cancel()  # Only this call's observer stops (T05).
            if 'goAway' in data:
                # ADK would reconnect and may replay history or send '.' as
                # user text. End this voice socket cleanly instead.
                asyncio.get_running_loop().create_task(self.close())
            for event in self.translate(data):
                if isinstance(event, LiveToolCall):
                    self._call_turns[event.call_id] = self.assistant_reply_to
                    while len(self._call_turns) > MAX_TRACKED_CALLS:
                        self._call_turns.pop(next(iter(self._call_turns)))
                self._events.put_nowait(event)
        except Exception as error:
            self._failure = error
            self._events.put_nowait(_FAILED)

    async def events(self):
        if self._runner is None:
            raise RuntimeError('ADK Live runner not attached')
        if self._run_task is None:
            self._run_task = asyncio.create_task(self._run())
        while True:
            event = await self._events.get()
            if event is _END:
                break
            if event is _FAILED:
                raise self._failure or RuntimeError('ADK Live failed')
            yield event
        if self.manual_stop:
            yield LiveInterrupted()

    async def _run(self):
        try:
            async with aclosing(self._runner.run_live(user_id=self._user_id,
                    session_id=self._adk_session_id, live_request_queue=self.requests,
                    run_config=self._run_config)) as stream:
                async for event in stream:
                    self._observe_adk(event)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if self._failure is None:
                self._failure = error
            logger.warning('Live ADK run failed class=%s', type(error).__name__)
            self._events.put_nowait(_FAILED)
            return
        self._events.put_nowait(_END)

    @staticmethod
    def _observe_adk(event):
        # Observability only: ADK owns tool execution, the tap owns provenance.
        for call in event.get_function_calls() or ():
            logger.warning('Live ADK tool call name=%s', call.name)
        for response in event.get_function_responses() or ():
            logger.warning('Live ADK tool response name=%s', response.name)
        if event.error_code:
            logger.warning('Live ADK event error code=%s', event.error_code)

    async def send_audio(self, pcm):
        if self.closed:
            raise RuntimeError('Live session closed')
        if not isinstance(pcm, bytes) or not pcm or len(pcm) > MAX_FRAME_BYTES or len(pcm) % 2:
            raise ValueError('invalid input PCM')
        if self.input_bytes + len(pcm) > MAX_AUDIO_BYTES:
            raise ValueError('input PCM limit')
        # Report saturation explicitly; never drop or queue voice without limit.
        if self.requests._queue.qsize() >= MAX_PENDING_INPUT:
            raise RuntimeError('Live input backpressure')
        self.input_bytes += len(pcm)
        self._note_audio_input(pcm)
        self.requests.send_realtime(types.Blob(data=pcm, mime_type=INPUT_MIME))

    async def interrupt(self):
        # No supported cancel exists: Stop ends this voice socket, never a job.
        self.manual_stop = True
        await self.close()

    async def respond_tool(self, call_id, name, response, scheduling=None):
        raise RuntimeError('ADK owns Live tool responses on this route')

    async def send_system_context(self, text):
        await self._client_content('system', text, 12000)

    async def _client_content(self, role, text, limit):
        # ADK would send a completed one-part Content as user realtime text
        # (A3). Send the provider turn directly, as the raw route does.
        session = self.model.raw_session
        if (self.closed or session is None or not isinstance(text, str)
                or not 1 <= len(text) <= limit or text != text.strip()):
            raise ValueError('invalid Live client content')
        await session.send_client_content(turns=types.Content(role=role,
            parts=[types.Part(text=text)]), turn_complete=False)

    async def close(self):
        if self.closed:
            return
        self.closed = True
        self.requests.close()
        for task in list(self._tool_tasks.values()):
            task.cancel()
        run = self._run_task
        if run is not None and not run.done():
            try:
                await asyncio.wait_for(asyncio.shield(run), CLOSE_SECONDS)
            except BaseException:
                run.cancel()
                with suppress(BaseException):
                    await run
        if self.client is not None:
            with suppress(Exception):
                await self.client.aio.aclose()
        self.pcm_diagnostics.close()
        self.report_signals()
        self._events.put_nowait(_END)


async def adk_live_session(model, client, instruction, user_id):
    """One ADK agent, Runner, session and queue for exactly one voice socket."""
    session = AdkLiveSession(model, client)
    # The typed Drive tool lives here: its scope is emitted with the admission (F0.1).
    declarations = live_tool_declarations(drive=True)[0]['functionDeclarations']
    # A callable instruction keeps chat context out of ADK {state} templating.
    agent = LlmAgent(name='uony', model=model, instruction=lambda _context: instruction,
                     tools=[ServerTool(item, session) for item in declarations])
    sessions = InMemorySessionService()
    adk_session_id = str(uuid4())
    await sessions.create_session(app_name=APP_NAME, user_id=user_id,
                                  session_id=adk_session_id)
    session.attach(Runner(app_name=APP_NAME, agent=agent, session_service=sessions),
        user_id, adk_session_id, RunConfig(response_modalities=['AUDIO'],
            explicit_vad_signal=True, save_live_blob=False,
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig()))
    return session


class AdkLiveProvider(VertexLiveProvider):
    """Explicit server-side route per account (ADK-FLUJOS §11); never the browser."""

    async def open(self, identity):
        if identity.user_id not in self.settings.live_adk_user_ids:
            return await super().open(identity)
        stage, session, client = 'local_identity', None, None
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
            stage = 'adk_setup'
            client = genai.Client(vertexai=True, project=identity.project_id,
                location=self.location, credentials=oauth_credentials.Credentials(token=token))
            model = TappedGemini(model=self.model, client=client)
            session = await adk_live_session(model, client,
                live_instruction(identity.context, drive=True), identity.user_id)
            logger.warning('Live route selected route=adk')
            if self.caption_enabled and identity.user_id in self.settings.live_pilot_user_ids:
                return await open_captioned_session(session, identity, token,
                                                    VertexTranscribeProvider())
            return session
        except BaseException as error:
            if not isinstance(error, asyncio.CancelledError):
                logger.warning('Live ADK open failed stage=%s class=%s', stage,
                               type(error).__name__)
            with suppress(Exception):
                if session is not None:
                    await session.close()
                elif client is not None:
                    await client.aio.aclose()
            raise
