"""Offline Live transcription boundaries; loopback WebSocket only."""
import json
from uuid import UUID

from google.genai import types

from app.uony_live_bridge import LiveTranscript, LiveTranscriptPreview
from app.uony_live_vertex import VertexLiveProvider
from test_uony_live_vertex import FakeCloud, prepared, run_server_test


def test_sdk_interim_input_transcription_uses_live_wire_alias():
    content = types.LiveServerContent(interim_input_transcription=types.Transcription(
        text='Quiero'))
    assert content.model_dump(mode='json', by_alias=True, exclude_none=True) == {
        'interimInputTranscription': {'text': 'Quiero'}}


def test_missing_finished_fragments_commit_once_at_turn_complete(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'inputTranscription': {'text': 'Quiero'}}))
        await ws.send(json.dumps({'serverContent': {
            'inputTranscription': {'text': 'Quiero una lámpara'}}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'Claro'}}))
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [
            {'text': 'Este texto del modelo no se duplica'}]},
            'outputTranscription': {'text': 'Claro, podemos'}}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'empezar'}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'cola tardía'}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'cola tardía',
                                                          'finished': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event for event in [event async for event in session.events()]
                  if isinstance(event, LiveTranscript)]
        assert [(event.role, event.text) for event in events] == [
            ('user', 'Quiero una lámpara'), ('assistant', 'Claro, podemos empezar')]
        assert all(UUID(event.turn_id) for event in events)
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_assistant_segment_and_trailing_words_commit_once_at_turn_complete(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'Respuesta final',
                                                          'finished': True}}))
        await ws.send(json.dumps({'outputTranscription': {'text': 'cola sin finished'}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        stream = session.events()
        preview = await anext(stream)
        revised = await anext(stream)
        transcript = await anext(stream)
        assert isinstance(preview, LiveTranscriptPreview)
        assert isinstance(revised, LiveTranscriptPreview)
        assert isinstance(transcript, LiveTranscript)
        assert preview.turn_id == revised.turn_id == transcript.turn_id
        assert (preview.text, revised.text) == (
            'Respuesta final', 'Respuesta final cola sin finished')
        assert (transcript.role, transcript.text, transcript.finalized_by) == (
            'assistant', 'Respuesta final cola sin finished', 'model_turn_complete')
        assert [event async for event in stream] == []
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_interim_input_is_visible_before_late_final_with_same_id(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {
            'interimInputTranscription': {'text': 'Quiero un'}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Quiero un producto', 'finished': True}}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert len(events) == 3
        assert isinstance(events[0], LiveTranscriptPreview)
        assert isinstance(events[1], LiveTranscriptPreview)
        assert isinstance(events[2], LiveTranscript)
        assert [event.text for event in events] == [
            'Quiero un', 'Quiero un producto', 'Quiero un producto']
        assert len({event.turn_id for event in events}) == 1
        assert session.transcription_counts == {
            'interimInputTranscription': 1, 'previews_emitted': 2, 'finals_emitted': 1}
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_interim_top_level_without_vad_end_remains_preview_only(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'interimInputTranscription': {'text': 'Necesito'},
                                  'serverContent': {}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Necesito una ficha', 'finished': True}}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert [type(event) for event in events] == [
            LiveTranscriptPreview, LiveTranscriptPreview]
        assert events[0].text == 'Necesito'
        assert events[-1].text == 'Necesito una ficha'
        assert len({event.turn_id for event in events}) == 1
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_interim_revision_replaces_preview_and_late_unspecified_final_uses_boundary(
        environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'interimInputTranscription': {
            'text': 'Quiero una mesa'}}}))
        await ws.send(json.dumps({'serverContent': {'interimInputTranscription': {
            'text': 'Quiero una lámpara'}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Quiero una lámpara'}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert [type(event) for event in events] == [
            LiveTranscriptPreview, LiveTranscriptPreview, LiveTranscript]
        assert [event.text for event in events] == [
            'Quiero una mesa', 'Quiero una lámpara', 'Quiero una lámpara']
        assert len({event.turn_id for event in events}) == 1
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_late_unspecified_input_remains_provisional_without_new_boundary(
        environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'interimInputTranscription': {
            'text': 'Quiero un'}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Quiero un producto'}}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert [(event.role, event.text) for event in events
                if isinstance(event, LiveTranscriptPreview)] == [
                    ('user', 'Quiero un'), ('user', 'Quiero un producto')]
        assert not any(isinstance(event, LiveTranscript) for event in events)
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_new_voice_activity_withdraws_interim_without_final(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'interimInputTranscription': {
            'text': 'Texto provisional'}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))
        await ws.send(json.dumps({'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert [event.text for event in events
                if isinstance(event, LiveTranscriptPreview)] == ['Texto provisional', '']
        assert not any(isinstance(event, LiveTranscript) for event in events)
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_model_text_preview_precedes_final_without_output_transcription(
        environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [
            {'text': 'Te escucho'}]}}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert [type(event) for event in events] == [
            LiveTranscriptPreview, LiveTranscript]
        assert events[0].text == events[1].text == 'Te escucho'
        assert events[0].turn_id == events[1].turn_id
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_finished_assistant_stays_final_across_later_model_turn(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'outputTranscription': {
            'text': 'Respuesta', 'finished': True}}}))
        await ws.send(json.dumps({'serverContent': {'modelTurn': {'parts': [
            {'text': 'Respuesta'}]}}}))
        await ws.send(json.dumps({'serverContent': {'outputTranscription': {
            'text': 'Respuesta', 'finished': True}, 'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert len([event for event in events if isinstance(event, LiveTranscript)]) == 1
        assert len([event for event in events if isinstance(event, LiveTranscriptPreview)]) == 1
        assert [event.text for event in events] == ['Respuesta', 'Respuesta']
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_finished_marker_without_vad_or_model_end_does_not_commit_action(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'text': 'Mi producto', 'finished': False}}}))
        await ws.send(json.dumps({'serverContent': {'inputTranscription': {
            'finished': True}}}))

    async def client():
        session = await adapter.open(identity)
        events = [event async for event in session.events()]
        assert [type(event) for event in events] == [LiveTranscriptPreview]
        assert events[0].text == 'Mi producto'
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


def test_late_input_is_not_merged_into_next_vad_bounded_turn(environment, monkeypatch):
    settings, database, identity = prepared(environment)
    adapter = VertexLiveProvider(settings, database, FakeCloud())

    async def server(ws):
        await ws.recv()
        await ws.send(json.dumps({'setupComplete': {}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))
        await ws.send(json.dumps({'inputTranscription': {'text': 'cola tardía'}}))
        await ws.send(json.dumps({'voiceActivity': {'voiceActivity': 'VOICE_ACTIVITY_START'}}))
        await ws.send(json.dumps({'inputTranscription': {'text': 'Nuevo encargo'}}))
        await ws.send(json.dumps({'serverContent': {'turnComplete': True}}))

    async def client():
        session = await adapter.open(identity)
        all_events = [event async for event in session.events()]
        events = [event for event in all_events if isinstance(event, LiveTranscript)]
        assert [(event.role, event.text) for event in events] == [
            ('user', 'Nuevo encargo')]
        assert [(event.role, event.text) for event in all_events
                if isinstance(event, LiveTranscriptPreview)] == [
                    ('user', 'cola tardía'), ('user', ''), ('user', 'Nuevo encargo')]
        await session.close()

    server.client = client
    run_server_test(monkeypatch, server)


