"""Offline binary-frame coverage for the Vertex Live WebSocket protocol."""
import json
from uuid import UUID

import pytest
from websockets.exceptions import ConnectionClosedError

from app.uony_live_bridge import (LiveSpeechEnded, LiveSpeechStarted,
                                  LiveTranscript, LiveTranscriptPreview, LiveUsage)
from app.uony_live_vertex import VertexLiveProvider, _decode_message
from test_uony_live_vertex import FakeCloud, prepared, run_server_test


def binary_json(value):
    return json.dumps(value, ensure_ascii=False).encode('utf-8')


def test_binary_setup_usage_and_transcripts(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.send(binary_json({'usageMetadata': {
            'promptTokenCount': 10, 'candidatesTokenCount': 3,
            'totalTokenCount': 13}}))
        await ws.send(binary_json({'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}}))
        await ws.send(binary_json({'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}}))
        await ws.send(binary_json({'inputTranscription': {
            'text': 'Quiero crear un producto', 'finished': True}}))
        await ws.send(binary_json({'serverContent': {'outputTranscription': {
            'text': '¿Tienes materiales?', 'finished': True}}}))
        await ws.send(binary_json({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert events[0] == LiveUsage({'promptTokenCount': 10,
                                      'candidatesTokenCount': 3, 'totalTokenCount': 13})
        assert isinstance(events[1], LiveSpeechStarted)
        assert isinstance(events[2], LiveSpeechEnded)
        assert events[1].turn_id == events[2].turn_id
        texts = [event for event in events if isinstance(
            event, (LiveTranscriptPreview, LiveTranscript))]
        assert [(event.role, event.text) for event in texts] == [
            ('user', 'Quiero crear un producto'),
            ('assistant', '¿Tienes materiales?'),
            ('user', 'Quiero crear un producto'),
            ('assistant', '¿Tienes materiales?')]
        assert [type(event) for event in texts] == [
            LiveTranscriptPreview, LiveTranscriptPreview,
            LiveTranscript, LiveTranscript]
        assert texts[0].turn_id == texts[2].turn_id == events[1].turn_id
        assert texts[1].turn_id == texts[3].turn_id
        assert texts[2].finalized_by == 'provider_finished'
        assert all(UUID(event.turn_id) for event in texts)
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


@pytest.mark.parametrize('invalid', [b'\xff', b'{', b'[]', b'null'])
def test_invalid_binary_json_is_rejected_without_payload(invalid):
    with pytest.raises(ValueError, match='invalid Live'):
        _decode_message(invalid)


def test_invalid_binary_event_fails_closed(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.send(b'\xff')

    async def client():
        session = await adapter.open(identity)
        with pytest.raises(ValueError, match='invalid Live encoding'):
            await anext(session.events())
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_unconfirmed_binary_setup_logs_only_safe_envelope(environment, monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'error': {
            'code': 400, 'message': 'private project ' + identity.project_id}}))

    async def client():
        with pytest.raises(ValueError, match='setup not confirmed'):
            await adapter.open(identity)

    server.client = client
    run_server_test(monkeypatch, server)
    assert 'frame_type=binary envelope=error error_code=400' in caplog.text
    assert identity.project_id not in caplog.text
    assert 'private project' not in caplog.text


def test_invalid_binary_setup_logs_only_frame_type(environment, monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(b'\xff private project')

    async def client():
        with pytest.raises(ValueError, match='invalid Live encoding'):
            await adapter.open(identity)

    server.client = client
    run_server_test(monkeypatch, server)
    assert 'Live setup invalid frame_type=binary' in caplog.text
    assert 'private project' not in caplog.text


@pytest.mark.parametrize('reply', [
    {'setupComplete': None},
    {'setupComplete': {}, 'error': {'code': 400, 'message': 'private project'}},
])
def test_malformed_setup_confirmation_is_rejected(environment, monkeypatch, reply):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json(reply))

    async def client():
        with pytest.raises(ValueError, match='setup not confirmed'):
            await adapter.open(identity)

    server.client = client
    run_server_test(monkeypatch, server)


def test_event_parser_failure_logs_only_safe_stream_shape(environment, monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.send(binary_json({'error': {
            'message': 'private project ' + identity.project_id}}))

    async def client():
        session = await adapter.open(identity)
        with pytest.raises(ValueError, match='unexpected Live event'):
            await anext(session.events())
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)
    assert 'Live stream failed class=ValueError frame_type=binary envelope=error ws_code=none' in caplog.text
    assert 'private project' not in caplog.text
    assert identity.project_id not in caplog.text


def test_abnormal_close_after_ready_logs_numeric_code_only(environment, monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.close(code=1008, reason='private project ' + identity.project_id)

    async def client():
        session = await adapter.open(identity)
        with pytest.raises(ConnectionClosedError):
            await anext(session.events())
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)
    assert 'Live stream ended class=ConnectionClosedError frame_type=none envelope=none ws_code=1008' in caplog.text
    assert 'private project' not in caplog.text
    assert identity.project_id not in caplog.text


def test_clean_close_after_ready_is_diagnostic_not_manual_stop(environment, monkeypatch, caplog):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.close(code=1000, reason='private project ' + identity.project_id)

    async def client():
        session = await adapter.open(identity)
        assert [event async for event in session.events()] == []
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)
    assert 'Live stream ended class=CleanClose frame_type=none envelope=none ws_code=1000' in caplog.text
    assert 'private project' not in caplog.text
    assert identity.project_id not in caplog.text


@pytest.mark.parametrize('control', [
    {'voiceActivity': {'voiceActivityType': 'SPEECH'}},
    {'voiceActivityDetectionSignal': {'vadSignalType': 'SPEECH'}},
])
def test_provider_voice_activity_controls_are_ignored_without_actions(
        environment, monkeypatch, control):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.send(binary_json(control))
        await ws.send(binary_json({'usageMetadata': {'totalTokenCount': 2}}))

    async def client():
        session = await adapter.open(identity)
        assert [event async for event in session.events()] == [LiveUsage({'totalTokenCount': 2})]
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


@pytest.mark.parametrize('control', [
    {'unexpectedVoiceEvent': {}},
    {'voiceActivity': {}, 'unexpectedVoiceEvent': {}},
])
def test_unknown_or_mixed_voice_control_still_fails_closed(environment, monkeypatch, control):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(binary_json({'setupComplete': {}}))
        await ws.send(binary_json(control))

    async def client():
        session = await adapter.open(identity)
        with pytest.raises(ValueError, match='unexpected Live event'):
            await anext(session.events())
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)
