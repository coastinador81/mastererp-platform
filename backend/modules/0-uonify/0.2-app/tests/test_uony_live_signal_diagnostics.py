"""Offline diagnostics for Live control frames; never log voice payloads."""
import asyncio
import json

import pytest

from app.uony_live_bridge import LiveInterrupted, LiveTranscript
from app.uony_live_vertex import VertexLiveSession


class Frames:
    def __init__(self, frames):
        self.frames = frames
        self.closed = 0
        self.close_code = None

    def __aiter__(self):
        async def stream():
            for frame in self.frames:
                yield json.dumps(frame)
        return stream()

    async def close(self):
        self.closed += 1


def test_signal_counts_report_once_on_normal_close_without_voice_text(caplog):
    websocket = Frames([
        {'voiceActivity': {'voiceActivity': 'VOICE_ACTIVITY_START'}},
        {'voiceActivityDetectionSignal': {'activity': 'STARTED'}},
        {'serverContent': {'speechState': 'SPEECH_START'}},
        {'serverContent': {'interrupted': True, 'inputTranscription': {
            'text': 'private voice words', 'finished': True}}},
        {'serverContent': {'interrupted': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        assert sum(isinstance(event, LiveInterrupted) for event in events) == 2
        await session.close()
        await session.close()
        assert websocket.closed == 1
        assert session.signal_counts == {'interrupted': 2, 'voiceActivity': 1,
                                         'voiceActivityDetectionSignal': 1, 'speechState': 1}

    asyncio.run(run())
    assert caplog.text.count('Live signals interrupted=2 voiceActivity=1 vad=1 speechState=1') == 1
    assert 'private voice words' not in caplog.text


def test_signal_counts_report_after_stream_error_without_provider_values(caplog):
    websocket = Frames([{'serverContent': {'speechState': 'private status',
                                          'modelTurn': {'parts': 'private payload'}}}])

    async def run():
        session = VertexLiveSession(websocket)
        with pytest.raises(ValueError, match='invalid Live turn'):
            [event async for event in session.events()]
        await session.close()
        assert websocket.closed == 1
        assert session.signal_counts['speechState'] == 1

    asyncio.run(run())
    assert 'Live signals interrupted=0 voiceActivity=0 vad=0 speechState=1' in caplog.text
    assert 'private status' not in caplog.text
    assert 'private payload' not in caplog.text


def test_interim_and_preview_counters_never_log_spoken_words(caplog):
    websocket = Frames([
        {'serverContent': {'interimInputTranscription': {'text': 'private speech'}}},
        {'serverContent': {'inputTranscription': {
            'text': 'private speech final', 'finished': True}}},
        {'serverContent': {'turnComplete': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        [event async for event in session.events()]
        await session.close()
        assert session.transcription_counts == {
            'interimInputTranscription': 1, 'previews_emitted': 2, 'finals_emitted': 1}

    asyncio.run(run())
    assert 'interim=1 previews=2 finals=1' in caplog.text
    assert 'private speech' not in caplog.text


def test_input_finalization_provenance_is_counted_without_spoken_text(caplog):
    websocket = Frames([
        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}},
        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
        {'inputTranscription': {'text': 'private explicit', 'finished': True}},
        {'serverContent': {'turnComplete': True}},
        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}},
        {'inputTranscription': {'text': 'private heuristic'}},
        {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'reply'}]}}},
        {'serverContent': {'turnComplete': True}},
        {'inputTranscription': {'text': 'private late', 'finished': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        await session.close()
        return [event for event in events
                if isinstance(event, LiveTranscript) and event.role == 'user']

    finals = asyncio.run(run())
    assert [event.finalized_by for event in finals] == [
        'provider_finished', 'model_turn_complete', 'model_turn_complete']
    assert 'Live input finals provider=1 reply_boundary=0 model_complete=2' in caplog.text
    assert ('Live input markers pre_end=0 post_end=1 no_vad=1 '
            'unfinished=0 unspecified=1 read_only_boundary=0') in caplog.text
    assert 'private' not in caplog.text


def test_model_turn_complete_source_is_distinct_from_provider_finished(caplog):
    websocket = Frames([
        {'inputTranscription': {'text': 'private provisional'}},
        {'serverContent': {'turnComplete': True}},
    ])

    async def run():
        session = VertexLiveSession(websocket)
        events = [event async for event in session.events()]
        await session.close()
        return [event for event in events if isinstance(event, LiveTranscript)]

    finals = asyncio.run(run())
    assert len(finals) == 1 and finals[0].finalized_by == 'model_turn_complete'
    assert 'model_complete=1' in caplog.text
    assert 'private' not in caplog.text
