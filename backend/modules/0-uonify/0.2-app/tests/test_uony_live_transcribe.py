"""Loopback-only transcription transport tests; no Google connection or charge."""
import asyncio
import base64
import json

import pytest
from google import genai
from google.auth.credentials import AnonymousCredentials
from google.genai import _common, _live_converters, types
from websockets.asyncio.server import serve

from app.uony_live_bridge import MAX_FRAME_BYTES, LiveIdentity
from app.uony_live_transcribe import (
    TranscribeFinal, TranscribeInterim, TranscribeUsage,
    VertexTranscribeProvider, _vertex_uri,
)


IDENTITY = LiveIdentity('test-user', 'test-google-subject', 'fixture-project')
TOKEN = 'short-lived-fixture-token'


def loopback(monkeypatch, scenario):
    async def run():
        async with serve(scenario, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            monkeypatch.setattr('app.uony_live_transcribe._vertex_uri',
                                lambda: f'ws://127.0.0.1:{port}')
            await scenario.client()
    asyncio.run(run())


def test_eu_vertex_wire_is_regional_and_does_not_use_developer_api():
    assert _vertex_uri() == ('wss://aiplatform.eu.rep.googleapis.com/ws/'
        'google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent')


def test_oauth_setup_pcm_interim_final_usage_and_close(monkeypatch):
    observed = {}
    pcm = b'\x01\x00' * 32

    async def server(ws):
        observed['authorization'] = ws.request.headers['Authorization']
        observed['setup'] = json.loads(await ws.recv())['setup']
        await ws.send(json.dumps({'setupComplete': {}}))
        observed['audio'] = json.loads(await ws.recv())
        await ws.send(json.dumps({'serverContent': {'interimInputTranscription': {
            'text': 'Quiero una mesa'}}}))
        await ws.send(json.dumps({'serverContent': {'interimInputTranscription': {
            'text': 'Quiero una lámpara'}}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Quiero una lámpara', 'finished': True}}}))
        await ws.send(json.dumps({'usageMetadata': {'promptTokenCount': 30,
            'candidatesTokenCount': 6, 'other': 'not retained'}}))

    async def client():
        session = await VertexTranscribeProvider().open(IDENTITY, TOKEN)
        await session.send_audio(pcm)
        events = [event async for event in session.events()]
        assert events == [TranscribeInterim('Quiero una mesa'),
                          TranscribeInterim('Quiero una lámpara'),
                          TranscribeFinal('Quiero una lámpara'),
                          TranscribeUsage({'promptTokenCount': 30,
                                           'candidatesTokenCount': 6})]
        assert (session.interims, session.finals, session.usage_reports,
                session.input_bytes) == (2, 1, 1, len(pcm))
        await session.close()
        assert session.closed

    server.client = client
    loopback(monkeypatch, server)
    assert observed['authorization'] == f'Bearer {TOKEN}'
    assert observed['setup'] == {
        'model': 'projects/fixture-project/locations/eu/publishers/google/models/'
                 'gemini-3.5-transcribe-live',
        'generationConfig': {'responseModalities': ['TEXT']},
        'inputAudioTranscription': {'language_codes': ['es-ES']},
    }
    sdk = genai.Client(vertexai=True, project=IDENTITY.project_id, location='eu',
                       credentials=AnonymousCredentials())
    config = types.LiveConnectConfig(response_modalities=['TEXT'],
        input_audio_transcription=types.AudioTranscriptionConfig(language_codes=['es-ES']))
    params = types.LiveConnectParameters(model=observed['setup']['model'], config=config)
    sdk_request = _common.convert_to_dict(_live_converters._LiveConnectParameters_to_vertex(
        sdk._api_client, params.model_dump(exclude_none=True)))
    sdk_request.pop('config', None)
    sdk_wire = json.loads(json.dumps(_common.encode_unserializable_types(sdk_request)))
    assert observed['setup'] == sdk_wire['setup']
    assert 'tools' not in observed['setup']
    assert 'systemInstruction' not in observed['setup']
    assert observed['audio'] == {'realtimeInput': {'audio': {
        'mimeType': 'audio/pcm;rate=16000',
        'data': base64.b64encode(pcm).decode('ascii')}}}


def test_unfinished_input_is_only_provisional_and_top_level_final_is_accepted(monkeypatch):
    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Necesito', 'finished': False}}}))
        await ws.send(json.dumps({'inputTranscription': {'text': 'Necesito ayuda'}}))

    async def client():
        session = await VertexTranscribeProvider().open(IDENTITY, TOKEN)
        assert [event async for event in session.events()] == [
            TranscribeInterim('Necesito'), TranscribeFinal('Necesito ayuda')]
        await session.close()

    server.client = client
    loopback(monkeypatch, server)


def test_invalid_identity_token_and_pcm_never_reach_provider(monkeypatch):
    async def fail_if_connected():
        raise AssertionError('invalid input must not open a socket')

    monkeypatch.setattr('app.uony_live_transcribe.connect', fail_if_connected)

    async def run():
        provider = VertexTranscribeProvider()
        for identity, token in ((IDENTITY, 'bad\nheader'),
                                (LiveIdentity('u', 's', 'bad/project'), TOKEN),
                                (IDENTITY, '')):
            with pytest.raises(ValueError, match='identity'):
                await provider.open(identity, token)

    asyncio.run(run())

    class FakeSocket:
        def __init__(self):
            self.sent = []

        async def send(self, value):
            self.sent.append(value)

    from app.uony_live_transcribe import VertexTranscribeSession
    socket = FakeSocket()
    session = VertexTranscribeSession(socket)

    async def validate():
        for value in (b'', b'\x01', b'\x00' * (MAX_FRAME_BYTES + 2), 'not pcm'):
            with pytest.raises(ValueError, match='PCM'):
                await session.send_audio(value)
        assert socket.sent == []

    asyncio.run(validate())


def test_provider_error_and_unexpected_tool_never_log_sensitive_values(
        monkeypatch, caplog):
    private = 'sensitive-test-audio-or-project'

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'toolCall': {'functionCalls': [
            {'name': 'create_product', 'args': {'description': private}}]}}))

    async def client():
        session = await VertexTranscribeProvider().open(IDENTITY, TOKEN)
        with pytest.raises(ValueError, match='unexpected Transcribe action'):
            await anext(session.events())
        await session.close()

    server.client = client
    loopback(monkeypatch, server)
    assert private not in caplog.text
    assert TOKEN not in caplog.text

    async def rejection(ws):
        await ws.recv()
        await ws.send(json.dumps({'error': {'message': private}}))

    async def rejected_client():
        with pytest.raises(ValueError, match='setup not confirmed'):
            await VertexTranscribeProvider().open(IDENTITY, TOKEN)

    rejection.client = rejected_client
    loopback(monkeypatch, rejection)
    assert private not in caplog.text
    assert TOKEN not in caplog.text
