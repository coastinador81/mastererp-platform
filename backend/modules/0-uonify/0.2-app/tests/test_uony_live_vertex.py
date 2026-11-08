"""Offline protocol tests: loopback WebSocket only, no Google calls or charges."""
import asyncio
import base64
from dataclasses import replace
from cryptography.fernet import Fernet
import json
from uuid import UUID

import pytest
from google import genai
from websockets.asyncio.server import serve

from app.google_cloud_provider import SCOPE
from app.uony_live_bridge import (LiveAudio, LiveIdentity, LiveInterrupted, LiveStatus,
                                  LiveToolCall, LiveTranscript, LiveTranscriptPreview, LiveUsage)
from app.uony_live_vertex import VertexLiveProvider, _vertex_uri
from test_uony_live_bridge import account_setup


class FakeCloud:
    def __init__(self):
        self.refreshes = []

    def refresh(self, token):
        self.refreshes.append(token)
        return 'short-lived-fixture-access-token'


def prepared(environment):
    settings, provider, database = environment
    user_id, subject, project, _ = account_setup(settings, provider, database)[0]
    with database.connect() as connection:
        connection.execute('''UPDATE google_cloud_connections
            SET refresh_encrypted=%s,scope=%s WHERE user_id=%s''',
            (Fernet(settings.encryption_key).encrypt(b'fixture-refresh').decode(), SCOPE, user_id))
    return settings, database, LiveIdentity(str(user_id), subject, project)


def run_server_test(monkeypatch, scenario):
    async def run():
        async with serve(scenario, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            monkeypatch.setattr('app.uony_live_vertex._vertex_uri',
                                lambda _location: f'ws://127.0.0.1:{port}')
            await scenario.client()
    asyncio.run(run())


@pytest.mark.parametrize(('location', 'expected'), (
    ('eu', 'wss://aiplatform.eu.rep.googleapis.com/ws/google.cloud.aiplatform.'
     'v1beta1.LlmBidiService/BidiGenerateContent'),
    ('us', 'wss://aiplatform.us.rep.googleapis.com/ws/google.cloud.aiplatform.'
     'v1beta1.LlmBidiService/BidiGenerateContent'),
    ('us-central1', 'wss://us-central1-aiplatform.googleapis.com/ws/'
     'google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent'),
))
def test_vertex_live_endpoint_matches_local_google_sdk_without_network(location, expected):
    sdk = genai.Client(vertexai=True, project='fixture-project', location=location)
    sdk_base = sdk._api_client._websocket_base_url().rstrip('/')
    sdk_version = sdk._api_client._http_options.api_version
    sdk_uri = (f'{sdk_base}/ws/google.cloud.aiplatform.{sdk_version}.'
               'LlmBidiService/BidiGenerateContent')
    assert _vertex_uri(location) == expected == sdk_uri


def test_vertex_transport_audio_vad_and_boundaries(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    identity = replace(identity, thread_id='voice-thread',
                       context='user: Quiero crear una lámpara.')
    cloud = FakeCloud()
    adapter = VertexLiveProvider(settings, database, cloud, location='eu')
    seen = {}

    async def server(ws):
        seen['auth'] = ws.request.headers['Authorization']
        seen['setup'] = json.loads(await ws.recv())
        await ws.send(json.dumps({'setupComplete': {}}))
        audio = json.loads(await ws.recv())
        seen['audio'] = audio
        # Split a provider chunk above the public bridge's per-frame limit.
        reply = b'\x02\x00' * 5000
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [{
            'inlineData': {'mimeType': 'audio/pcm;rate=24000',
                           'data': base64.b64encode(reply).decode()}}]}}}))
        await ws.send(json.dumps({'serverContent': {'interrupted': True}}))

    async def client():
        session = await adapter.open(identity)
        await session.send_audio(b'\x01\x00' * 32)
        events = session.events()
        assert await anext(events) == LiveStatus('speaking')
        first = await anext(events)
        second = await anext(events)
        assert isinstance(first, LiveAudio) and isinstance(second, LiveAudio)
        assert first.pcm + second.pcm == b'\x02\x00' * 5000
        assert len(first.pcm) <= 8192 and len(second.pcm) <= 8192
        assert await anext(events) == LiveInterrupted()
        await session.close()
        assert session.closed

    server.client = client
    run_server_test(monkeypatch, server)
    assert seen['auth'] == 'Bearer short-lived-fixture-access-token'
    setup = seen['setup']['setup']
    assert setup['model'] == (
        f'projects/{identity.project_id}/locations/eu/publishers/google/models/gemini-3.8-live')
    assert setup['generationConfig']['responseModalities'] == ['AUDIO']
    assert setup['inputAudioTranscription'] == {}
    assert setup['outputAudioTranscription'] == {}
    assert len(setup['tools']) == 1
    assert len(setup['tools'][0]['functionDeclarations']) == 2
    declaration = setup['tools'][0]['functionDeclarations'][0]
    assert declaration['name'] == 'get_current_work'
    assert declaration['parameters'] == {'type': 'OBJECT', 'properties': {}}
    assert 'Solo lectura' in declaration['description']
    handoff = setup['tools'][0]['functionDeclarations'][1]
    assert handoff['name'] == 'route_spoken_request'
    assert handoff['parameters']['required'] == ['intent', 'spokenText']
    assert 'creative_plan' in handoff['parameters']['properties']['intent']['enum']
    instruction = setup['systemInstruction']['parts'][0]['text']
    assert 'Quiero crear una lámpara.' in instruction
    assert 'No hagas más de dos llamadas consecutivas' in instruction
    assert 'No afirmes que revisaste Drive, documentos' in instruction
    assert 'no concluyas que faltan documentos' in instruction
    assert 'del mismo chat' in instruction
    assert 'responsable de llevar adelante los encargos' in instruction
    assert 'no te presentes como un mero coordinador' in instruction
    assert 'buscar o analizar una carpeta concreta de Drive' in instruction
    assert 'intent=creative_plan' in instruction
    assert 'comprobar el acceso a Drive y avisarle' in instruction
    assert 'Decir que hay una carpeta es información' in instruction
    assert 'Pedir comprobar acceso no autoriza buscar, contar o leer documentos' in instruction
    assert 'no pidas automáticamente un segundo clic por la misma lectura' in instruction
    assert 'no abras un formulario para cada pregunta' in instruction
    assert 'el servidor verifica identidad, acceso y alcance' in instruction
    assert 'el backend valida el alcance antes de actuar' in handoff['description']
    assert 'fixture-refresh' not in instruction
    assert 'short-lived-fixture-access-token' not in instruction
    assert seen['audio'] == {'realtimeInput': {'audio': {'mimeType': 'audio/pcm;rate=16000',
        'data': base64.b64encode(b'\x01\x00' * 32).decode()}}}
    assert cloud.refreshes == ['fixture-refresh']


def test_manual_stop_closes_voice_only_without_provider_cancel(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())
    seen = []

    async def server(ws):
        seen.append(json.loads(await ws.recv()))
        await ws.send(json.dumps({'setupComplete': {}}))
        try:
            seen.append(json.loads(await ws.recv()))
        except Exception:
            pass

    async def client():
        session = await adapter.open(identity)
        await session.interrupt()
        assert [event async for event in session.events()] == [LiveInterrupted()]
        assert session.closed

    server.client = client
    run_server_test(monkeypatch, server)
    assert len(seen) == 1  # No undocumented cancel message was sent to Vertex.


def test_tool_call_uses_dedicated_response_message_without_execution(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())
    seen = {}

    async def server(ws):
        seen['setup'] = json.loads(await ws.recv())
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'toolCall': {'functionCalls': [{
            'id': 'read-1', 'name': 'get_current_work', 'args': {}}]}}))
        seen['response'] = json.loads(await ws.recv())
        await ws.send(json.dumps({'toolCallCancellation': {'ids': ['read-1']}}))
        await ws.send(json.dumps({'toolCall': {'functionCalls': [{
            'id': 'unsafe-1', 'name': 'publish_product', 'args': {}}]}}))

    async def client():
        session = await adapter.open(identity)
        with pytest.raises(ValueError, match='input PCM'):
            await session.send_audio(b'\x00' * 8194)
        events = session.events()
        assert await anext(events) == LiveToolCall('read-1', 'get_current_work', {})
        await session.respond_tool('read-1', 'get_current_work', {'assignments': []})
        assert await anext(events) == LiveToolCall('unsafe-1', 'publish_product', {})
        with pytest.raises(ValueError, match='tool response'):
            await session.respond_tool('unsafe-1', 'publish_product', {})
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)
    assert seen['response'] == {'toolResponse': {'functionResponses': [{
        'id': 'read-1', 'name': 'get_current_work',
        'response': {'assignments': []}}]}}


def test_fails_closed_on_bad_setup(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def no_setup(ws):
        await ws.recv()
        await ws.send(json.dumps({'serverContent': {}}))

    async def denied():
        with pytest.raises(ValueError, match='setup not confirmed'):
            await adapter.open(identity)

    no_setup.client = denied
    run_server_test(monkeypatch, no_setup)


def test_setup_close_logs_only_stage_and_numeric_code(environment, monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def rejected(ws):
        await ws.recv()
        await ws.close(code=1008, reason='sensitive provider details')

    async def denied():
        with pytest.raises(Exception):
            await adapter.open(identity)

    rejected.client = denied
    run_server_test(monkeypatch, rejected)
    assert 'stage=setup' in caplog.text
    assert 'ws_code=1008' in caplog.text
    assert 'sensitive provider details' not in caplog.text
    assert identity.project_id not in caplog.text


def test_cancelled_setup_closes_upstream_and_keeps_diagnostic_safe(environment,
                                                                  monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())
    setup_received = asyncio.Event()
    server_closed = asyncio.Event()

    async def stalled(ws):
        await ws.recv()
        setup_received.set()
        await ws.wait_closed()
        server_closed.set()

    async def cancelled():
        attempt = asyncio.create_task(adapter.open(identity))
        await asyncio.wait_for(setup_received.wait(), timeout=2)
        attempt.cancel()
        with pytest.raises(asyncio.CancelledError):
            await attempt
        await asyncio.wait_for(server_closed.wait(), timeout=2)

    stalled.client = cancelled
    run_server_test(monkeypatch, stalled)
    assert 'stage=setup class=CancelledError' in caplog.text
    assert identity.project_id not in caplog.text


def test_transcription_previews_do_not_commit_interrupted_reply(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}}))
        await ws.send(json.dumps({'inputTranscription': {'text': 'Quiero', 'finished': False}}))
        await ws.send(json.dumps({'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Quiero crear un producto', 'finished': True}}}))
        await ws.send(json.dumps({'serverContent': {'outputTranscription': {
            'text': 'Claro,', 'finished': False},
            'modelTurn': {'parts': [{'text': 'Este texto no se duplica en el historial.'}]}}}))
        await ws.send(json.dumps({'serverContent': {'interrupted': True}}))
        await ws.send(json.dumps({'outputTranscription': {
            'text': '¿Tienes archivos?', 'finished': True}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        finals = [event for event in events if isinstance(event, LiveTranscript)]
        assert [(event.role, event.text) for event in finals] == [
            ('user', 'Quiero crear un producto'), ('assistant', '¿Tienes archivos?')]
        assert finals[0].finalized_by == 'provider_finished'
        assert all(UUID(event.turn_id) for event in finals)
        assert events.count(LiveInterrupted()) == 1
        assert any(isinstance(event, LiveTranscriptPreview)
                   and event.text == 'Claro,' for event in events)
        assert all(event.text != 'Claro,' for event in finals)
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_model_text_is_committed_only_on_complete_turn_and_not_duplicated(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [
            {'text': 'Primera parte'}]}}}))
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [
            {'text': ' y segunda parte'}]}, 'turnComplete': True}}))
        # Transcription updates are independent and may arrive after the model
        # turn. They must not become a second assistant message.
        await ws.send(json.dumps({'serverContent': {'outputTranscription': {
            'text': 'Primera parte y segunda parte', 'finished': True}}}))
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [
            {'text': 'Otra respuesta'}]}, 'outputTranscription': {
            'text': 'Otra respuesta', 'finished': True}, 'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event for event in [event async for event in session.events()]
                  if isinstance(event, LiveTranscript)]
        assert [(event.role, event.text) for event in events] == [
            ('assistant', 'Primera parte y segunda parte'),
            ('assistant', 'Otra respuesta')]
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_partial_transcriptions_are_not_committed_by_turn_complete(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'inputTranscription': {'text': 'Necesito'}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'Claro'}}))
        await ws.send(json.dumps({'serverContent': {
            'inputTranscription': {'text': 'Necesito', 'finished': False},
            'outputTranscription': {'text': 'Claro', 'finished': False},
            'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert not any(isinstance(event, LiveTranscript) for event in events)
        assert [(event.role, event.text) for event in events
                if isinstance(event, LiveTranscriptPreview)] == [
                    ('user', 'Necesito'), ('assistant', 'Claro'),
                    ('assistant', '')]
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_interruption_keeps_user_final_transcript_in_same_frame(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {
            'outputTranscription': {'text': 'Respuesta cortada', 'finished': False}}}))
        await ws.send(json.dumps({'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}}))
        await ws.send(json.dumps({'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'},
            'serverContent': {'interrupted': True,
            'inputTranscription': {'text': 'Espera, otro producto', 'finished': True},
            'outputTranscription': {'text': 'Respuesta cortada', 'finished': True}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert isinstance(events[0], LiveTranscriptPreview)
        assert (events[0].role, events[0].text) == ('assistant', 'Respuesta cortada')
        assert events.count(LiveInterrupted()) == 1
        finals = [event for event in events if isinstance(event, LiveTranscript)]
        assert len(finals) == 1
        assert (finals[0].role, finals[0].text, finals[0].finalized_by) == (
            'user', 'Espera, otro producto', 'provider_finished')
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_usage_metadata_is_reduced_to_bounded_token_receipt(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'usageMetadata': {
            'promptTokenCount': 125, 'candidatesTokenCount': 35,
            'totalTokenCount': 160, 'cachedContentTokenCount': 0,
            'promptTokensDetails': [
                {'modality': 'AUDIO', 'tokenCount': 100},
                {'modality': 'TEXT', 'tokenCount': 25},
                {'modality': 'AUDIO', 'tokenCount': -1}],
            'irrelevantProviderField': 'never-persist-this',
            'toolUsePromptTokenCount': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert events == [LiveUsage({'promptTokenCount': 125,
            'candidatesTokenCount': 35, 'totalTokenCount': 160,
            'cachedContentTokenCount': 0, 'promptTokensDetails': [
                {'modality': 'AUDIO', 'tokenCount': 100},
                {'modality': 'TEXT', 'tokenCount': 25}]})]
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_transport_enforces_cumulative_audio_limits(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())
    monkeypatch.setattr('app.uony_live_vertex.MAX_AUDIO_BYTES', 64)
    monkeypatch.setattr('app.uony_live_vertex.MAX_OUTPUT_BYTES', 32)

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.recv()
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [{
            'inlineData': {'mimeType': 'audio/pcm;rate=24000',
                           'data': base64.b64encode(b'\x02\x00' * 17).decode()}}]}}}))

    async def client():
        session = await adapter.open(identity)
        await session.send_audio(b'\x01\x00' * 32)
        with pytest.raises(ValueError, match='input PCM limit'):
            await session.send_audio(b'\x01\x00')
        with pytest.raises(ValueError, match='output PCM limit'):
            await anext(session.events())
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_project_subject_scope_or_connection_change_never_opens_socket(environment):
    settings, database, identity = prepared(environment)
    cloud = FakeCloud()
    adapter = VertexLiveProvider(settings, database, cloud)

    async def check():
        with pytest.raises(ValueError, match='identity unavailable'):
            await adapter.open(LiveIdentity(identity.user_id, identity.google_subject,
                                            'other-project-123'))
        with pytest.raises(ValueError, match='identity unavailable'):
            await adapter.open(LiveIdentity(identity.user_id, 'other-subject',
                                            identity.project_id))
        with database.connect() as c:
            c.execute('UPDATE google_cloud_connections SET scope=%s WHERE user_id=%s',
                      ('openid email', identity.user_id))
        with pytest.raises(ValueError, match='identity unavailable'):
            await adapter.open(identity)
        assert cloud.refreshes == []

    asyncio.run(check())
    with pytest.raises(ValueError, match='unsupported'):
        VertexLiveProvider(settings, database, cloud, model='gemini-unknown', location='eu')
    with pytest.raises(ValueError, match='unsupported'):
        VertexLiveProvider(settings, database, cloud, location='global')
