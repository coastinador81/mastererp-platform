"""Pinned ADK Live behavior with a fake SDK socket, never Google or Drive.

These are compatibility tests: a result does not establish that a real Gemini
3.8 session will speak a backend result without a model-issued tool call.
"""
import asyncio
from contextlib import aclosing, asynccontextmanager
import json
from types import SimpleNamespace

import pytest
from google import genai
from google.auth.credentials import AnonymousCredentials
from google.genai import types
from google.genai.live import AsyncSession
from google.adk.models.gemini_llm_connection import GeminiLlmConnection
from google.adk.models.google_llm import Gemini

from app.uony_live_adk_probe import (
    ACTIVE_PROVIDER_REPLACEMENT_READY, create_adk_live_probe,
)
from app.uony_live_bridge import LiveIdentity


IDENTITY = LiveIdentity('fixture-user', 'fixture-subject', 'fixture-project',
                        'fixture-thread')


class Socket:
    def __init__(self):
        self.sent = []

    async def send(self, value):
        self.sent.append(json.loads(value))


class SdkSession:
    session_id = 'fixture-provider-session'

    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = []
        self.closed = False

    async def send_realtime_input(self, **value):
        self.sent.append(('realtime', value))

    async def send_tool_response(self, **value):
        self.sent.append(('tool', value))
        self.incoming.put_nowait(types.LiveServerMessage(server_content=
            types.LiveServerContent(model_turn=types.Content(role='model', parts=[
                types.Part(inline_data=types.Blob(data=b'\x01\x00' * 8,
                    mime_type='audio/pcm;rate=24000'))]))))
        self.incoming.put_nowait(types.LiveServerMessage(server_content=
            types.LiveServerContent(output_transcription=types.Transcription(
                text='Hay 31 carpetas.', finished=True))))
        self.incoming.put_nowait(types.LiveServerMessage(server_content=
            types.LiveServerContent(turn_complete=True)))

    async def send_client_content(self, **value):
        self.sent.append(('client', value))

    async def send(self, **value):
        self.sent.append(('generic', value))

    async def close(self):
        self.closed = True
        self.incoming.put_nowait(None)

    async def receive(self):
        while not self.closed:
            value = await self.incoming.get()
            if value is None:
                return
            yield value
            if value.server_content and value.server_content.turn_complete:
                return


class SdkLive:
    def __init__(self, session):
        self.session = session
        self.configs = []

    @asynccontextmanager
    async def connect(self, **kwargs):
        self.configs.append(kwargs)
        try:
            yield self.session
        finally:
            await self.session.close()


def authenticated_fixture_client():
    # A real SDK object, with no ambient credentials or live network call.
    return genai.Client(vertexai=True, project='fixture-project', location='eu',
                        credentials=AnonymousCredentials())


def test_real_runner_routes_only_through_server_boundary_and_preserves_call_id(monkeypatch):
    async def scenario():
        session = SdkSession()
        live = SdkLive(session)
        sdk = SimpleNamespace(vertexai=True, aio=SimpleNamespace(live=live))
        monkeypatch.setattr(Gemini, '_live_api_client', property(lambda self: sdk))
        dispatches = []

        async def dispatch(call_id, name, args):
            dispatches.append((call_id, name, args))
            return {'status': 'success', 'reply': 'Hay 31 carpetas.'}

        client = authenticated_fixture_client()
        try:
            probe = await create_adk_live_probe(IDENTITY, client, dispatch)
            probe.send_audio(b'\x01\x00' * 16)
            session.incoming.put_nowait(types.LiveServerMessage(voice_activity=
                types.VoiceActivity(voice_activity_type='ACTIVITY_START')))
            session.incoming.put_nowait(types.LiveServerMessage(server_content=
                types.LiveServerContent(input_transcription=types.Transcription(
                    text='Cuenta las carpetas de Drive.', finished=True))))
            session.incoming.put_nowait(types.LiveServerMessage(tool_call=
                types.LiveServerToolCall(function_calls=[types.FunctionCall(
                    id='provider-call-1', name='route_spoken_request',
                    args={'intent': 'use_drive_materials',
                          'spokenText': 'Cuenta las carpetas de Drive.'})])))
            events = []
            async with aclosing(probe.events()) as stream:
                async for event in stream:
                    events.append(event)
                    if event.turn_complete:
                        break
            probe.close()
            assert dispatches == [('provider-call-1', 'route_spoken_request', {
                'intent': 'use_drive_materials',
                'spokenText': 'Cuenta las carpetas de Drive.'})]
            replies = [item for kind, item in session.sent if kind == 'tool']
            assert len(replies) == 1
            assert replies[0]['function_responses'][0].id == 'provider-call-1'
            assert any(e.voice_activity for e in events)
            assert any(e.input_transcription for e in events)
            assert any(e.output_transcription for e in events)
            assert any(p.inline_data for e in events if e.content
                       for p in e.content.parts or [])
            assert any(kind == 'realtime' and 'audio' in item
                       for kind, item in session.sent)
            config = live.configs[0]['config']
            assert config.response_modalities == ['AUDIO']
            assert config.explicit_vad_signal is True
            assert config.input_audio_transcription is not None
        finally:
            await client.aio.aclose()

    asyncio.run(asyncio.wait_for(scenario(), timeout=5))


def test_adk_three_x_promotes_nonfinal_transcript_and_keeps_interruption():
    async def scenario():
        session = SdkSession()
        session.incoming.put_nowait(types.LiveServerMessage(server_content=
            types.LiveServerContent(input_transcription=types.Transcription(
                text='Analiza esta carpeta pero', finished=False))))
        session.incoming.put_nowait(types.LiveServerMessage(server_content=
            types.LiveServerContent(interrupted=True, turn_complete=True)))
        connection = GeminiLlmConnection(session, model_version='gemini-3.8-live')
        events = [event async for event in connection.receive()]
        transcript = next(e.input_transcription for e in events if e.input_transcription)
        assert transcript.finished is True
        assert any(e.interrupted for e in events)
        # This normalized flag must not replace the current final-transcript
        # consent gate. It is the reason native ADK Live is not a drop-in yet.
        assert ACTIVE_PROVIDER_REPLACEMENT_READY is False

    asyncio.run(scenario())


def test_adk_completed_system_text_becomes_realtime_input_not_system_update():
    async def scenario():
        session = SdkSession()
        connection = GeminiLlmConnection(session, model_version='gemini-3.8-live')
        content = types.Content(role='system', parts=[types.Part(text='Estado verificado.')])
        await connection._send_content(content, partial=True)
        await connection._send_content(content, partial=False)
        kind, first = session.sent[0]
        assert kind == 'generic'
        assert first['input'].turns[0].role == 'system'
        assert first['input'].turn_complete is False
        # A completed one-part system Content loses its role in this adapter.
        assert session.sent[1] == ('realtime', {'text': 'Estado verificado.'})

    asyncio.run(scenario())


def test_sdk_can_encode_context_then_empty_generation_trigger_without_user_or_tool():
    async def scenario():
        socket = Socket()
        session = AsyncSession(SimpleNamespace(vertexai=True), socket)
        await session.send_client_content(turns=types.Content(role='system',
            parts=[types.Part(text='Dato de prueba controlado por el servidor: 31.')]),
            turn_complete=False)
        await session.send_client_content(turn_complete=True)
        assert socket.sent == [
            {'client_content': {'turns': [{'role': 'system', 'parts': [
                {'text': 'Dato de prueba controlado por el servidor: 31.'}]}],
                'turnComplete': False}},
            {'client_content': {'turnComplete': True}},
        ]
        # Encoding is proven; server acceptance/speech timing is not. No
        # function response or pretend customer content is used by this probe.

    asyncio.run(scenario())


def test_probe_requires_explicit_authenticated_dependencies():
    with pytest.raises(ValueError, match='explicit authenticated'):
        asyncio.run(create_adk_live_probe(IDENTITY, None, lambda *args: None))
