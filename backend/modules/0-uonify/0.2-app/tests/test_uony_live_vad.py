"""Offline voice-activity boundaries for the Live bridge."""
import asyncio
import base64
from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient
from google.genai import types

from app.main import create_app
from app.uony_live_bridge import (LiveAudio, LiveSpeechEnded, LiveSpeechStarted, LiveStatus,
                                  LiveTranscript, LiveTranscriptPreview, LiveUsage)
from app.uony_live_vertex import VertexLiveSession
from test_uony_live_bridge import (FakeLive, account_setup, bind, headers, work_counts)
from test_uony_live_signal_diagnostics import Frames


VOICE_START = types.VoiceActivity(
    voice_activity_type=types.VoiceActivityType.ACTIVITY_START).model_dump(
        mode='json', by_alias=True, exclude_none=True)


def test_sdk_voice_activity_uses_wire_alias():
    assert VOICE_START == {'voiceActivityType': 'ACTIVITY_START'}


def audio_frame(sample):
    return {'serverContent': {'modelTurn': {'parts': [{'inlineData': {
        'mimeType': 'audio/pcm;rate=24000',
        'data': base64.b64encode(sample).decode()}}]}}}


def test_activity_start_after_turn_complete_flushes_playback_then_delivers_next_turn():
    old, new = b'\x01\0' * 16, b'\x02\0' * 16
    websocket = Frames([
        audio_frame(old),
        {'serverContent': {'turnComplete': True}},
        {'voiceActivity': VOICE_START},
        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
        {'serverContent': {'inputTranscription': {'text': 'Sigue con el otro',
                                                  'finished': True}}},
        audio_frame(new),
        {'serverContent': {'turnComplete': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        assert events[:4] == [LiveStatus('speaking'), LiveAudio(old),
                              LiveStatus('listening'), LiveSpeechStarted()]
        ended = next(event for event in events if isinstance(event, LiveSpeechEnded))
        preview = next(event for event in events if isinstance(event, LiveTranscriptPreview))
        final = next(event for event in events if isinstance(event, LiveTranscript))
        assert events[3].turn_id == ended.turn_id == preview.turn_id == final.turn_id
        assert (final.role, final.text, final.finalized_by) == (
            'user', 'Sigue con el otro', 'provider_finished')
        assert [event.pcm for event in events if isinstance(event, LiveAudio)] == [old, new]
        assert [event.state for event in events if isinstance(event, LiveStatus)] == [
            'speaking', 'listening', 'speaking', 'listening']
        await session.close()

    asyncio.run(run())


def test_activity_start_during_reply_suppresses_old_audio_without_provider_interrupt():
    old, stale, new = b'\x01\0' * 16, b'\x02\0' * 16, b'\x03\0' * 16
    websocket = Frames([
        audio_frame(old),
        {'voiceActivity': VOICE_START},
        audio_frame(stale),
        {'serverContent': {'outputTranscription': {'text': 'respuesta cortada',
                                                   'finished': True}}},
        {'serverContent': {'inputTranscription': {'text': 'Ahora sigue',
                                                  'finished': True}}},
        {'serverContent': {'turnComplete': True}},
        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
        audio_frame(new),
        {'serverContent': {'outputTranscription': {'text': 'Respuesta nueva',
                                                   'finished': True},
                           'turnComplete': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        assert sum(isinstance(event, LiveSpeechStarted) for event in events) == 1
        assert [event.pcm for event in events if isinstance(event, LiveAudio)] == [old, new]
        assert [(event.role, event.text) for event in events
                if isinstance(event, LiveTranscript)] == [
                    ('user', 'Ahora sigue'), ('assistant', 'Respuesta nueva')]
        await session.close()

    asyncio.run(run())


def test_activity_start_after_text_preview_discards_unheard_reply():
    stale = b'\x02\0' * 16
    websocket = Frames([
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Respuesta no oída'}]}}},
        {'voiceActivity': VOICE_START},
        audio_frame(stale),
        {'serverContent': {'turnComplete': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        assert isinstance(events[0], LiveTranscriptPreview)
        assert events[0].text == 'Respuesta no oída'
        assert events[1] == LiveSpeechStarted()
        assert not any(isinstance(event, (LiveAudio, LiveTranscript)) for event in events)
        await session.close()

    asyncio.run(run())


def test_barge_in_discards_even_finished_assistant_segment_before_turn_complete():
    websocket = Frames([
        {'serverContent': {'outputTranscription': {
            'text': 'Respuesta todavía en reproducción', 'finished': True}}},
        {'voiceActivity': VOICE_START},
        {'serverContent': {'turnComplete': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        assert any(isinstance(event, LiveTranscriptPreview) and event.role == 'assistant'
                   for event in events)
        assert sum(isinstance(event, LiveSpeechStarted) for event in events) == 1
        assert not any(isinstance(event, LiveTranscript) and event.role == 'assistant'
                       for event in events)
        await session.close()

    asyncio.run(run())


def test_activity_start_in_content_frame_precedes_usage_and_discards_stale_reply():
    old, stale, new = b'\x01\0' * 16, b'\x02\0' * 16, b'\x03\0' * 16
    combined = audio_frame(stale)
    combined['voiceActivity'] = VOICE_START
    combined['usageMetadata'] = {'totalTokenCount': 3}
    combined['serverContent']['inputTranscription'] = {
        'text': 'Nuevo turno', 'finished': True}
    combined['serverContent']['outputTranscription'] = {
        'text': 'Respuesta vieja', 'finished': True}
    websocket = Frames([audio_frame(old), combined,
                        {'serverContent': {'turnComplete': True}},
                        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
                        audio_frame(new)])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        assert events[:2] == [LiveStatus('speaking'), LiveAudio(old)]
        assert events[2] == LiveSpeechStarted()
        assert isinstance(events[3], LiveUsage)
        assert events[3].counts == {'totalTokenCount': 3}
        assert isinstance(events[4], LiveTranscriptPreview)
        assert isinstance(events[5], LiveTranscript)
        assert events[4].turn_id == events[5].turn_id
        assert (events[5].role, events[5].text) == ('user', 'Nuevo turno')
        assert [event.pcm for event in events if isinstance(event, LiveAudio)] == [old, new]
        assert all(not isinstance(event, LiveTranscript) or event.role != 'assistant'
                   for event in events)
        await session.close()

    asyncio.run(run())


def test_bridge_speech_start_is_control_only_then_new_turn_is_saved(environment):
    config, provider, database = environment
    account = account_setup(config, provider, database)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as websocket:
            bind(websocket, 'vad-control-thread')
            fake.sessions[0].emit(LiveSpeechStarted())
            assert websocket.receive_json() == {'type': 'speech_started'}
            with database.connect() as connection:
                assert connection.execute('SELECT count(*) AS n FROM uony_live_turns').fetchone()['n'] == 0
            assert work_counts(database) == (0, 0, 0)
            fake.sessions[0].emit(LiveTranscript('user', str(uuid4()), 'Sigue con este'))
            delivered = websocket.receive_json()
            assert (delivered['type'], delivered['role'], delivered['text']) == (
                'transcript', 'user', 'Sigue con este')
            with database.connect() as connection:
                assert connection.execute('SELECT count(*) AS n FROM uony_live_turns').fetchone()['n'] == 1
            assert work_counts(database) == (0, 0, 0)


def test_bridge_preview_is_not_saved_or_executed_and_final_keeps_turn_id(environment):
    config, provider, database = environment
    account = account_setup(config, provider, database)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    turn_id = str(uuid4())
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as websocket:
            bind(websocket, 'preview-control-thread')
            fake.sessions[0].emit(LiveTranscriptPreview('user', turn_id, 'Quiero'))
            assert websocket.receive_json() == {'type': 'transcript_preview',
                'role': 'user', 'turnId': turn_id, 'text': 'Quiero'}
            with database.connect() as connection:
                assert connection.execute(
                    'SELECT count(*) AS n FROM uony_live_turns').fetchone()['n'] == 0
            assert work_counts(database) == (0, 0, 0)
            fake.sessions[0].emit(LiveTranscript('user', turn_id, 'Quiero una ficha'))
            assert websocket.receive_json() == {'type': 'transcript',
                'role': 'user', 'turnId': turn_id, 'text': 'Quiero una ficha', 'final': True}
            with database.connect() as connection:
                assert connection.execute(
                    'SELECT count(*) AS n FROM uony_live_turns').fetchone()['n'] == 1
            assert work_counts(database) == (0, 0, 0)
