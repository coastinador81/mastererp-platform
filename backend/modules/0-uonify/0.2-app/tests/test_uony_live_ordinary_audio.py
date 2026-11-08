"""Barge-in during a held ordinary reply must not revive its late PCM."""
import asyncio
from contextlib import suppress
from types import SimpleNamespace
from uuid import uuid4
import pytest

from app.uony_live_audio_gate import LiveActionAudioGate
from app.uony_live_bridge import LiveAudio, LiveSpeechStarted, LiveStatus, LiveTranscript
from app.uony_live_delivery import LockedLiveSender
from app.uony_live_ordinary_audio import OrdinaryAudioStream
from app.uony_live_output_epoch import LiveOutputEpoch
from app.uony_live_router import LiveTurnRouter
from app.uony_live_vertex import VertexLiveSession
from test_uony_live_signal_diagnostics import Frames
from test_uony_live_vad import VOICE_START, audio_frame


class Socket:
    def __init__(self):
        self.items = []
        self.block = False
        self.sending = asyncio.Event()
        self.release = asyncio.Event()

    async def send_json(self, payload):
        self.items.append(payload)

    async def send_bytes(self, pcm):
        self.sending.set()
        if self.block:
            await self.release.wait()
        self.items.append(pcm)


class Speech:
    def __init__(self):
        self.state = 'listening'

    def model_status(self, state):
        self.state = state

    def speech_started(self):
        pass

    def speech_ended(self):
        pass


async def settled(predicate):
    async with asyncio.timeout(2):
        while not predicate():
            await asyncio.sleep(0)


def test_cut_cancels_blocked_held_audio_and_rejects_late_generation():
    async def run():
        socket, speech = Socket(), Speech()
        socket.block = True
        stream = OrdinaryAudioStream(LockedLiveSender(socket), speech)
        old, new, turn = str(uuid4()), str(uuid4()), str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', old), LiveAudio(b'\2\0', old)])
        await socket.sending.wait()
        await stream.cut(turn)
        socket.block = False
        stream.enqueue([LiveAudio(b'\3\0', old), LiveAudio(b'\4\0', new, turn)])
        stream.finish(new)
        await settled(lambda: any(isinstance(item, dict) and item['phase'] == 'end'
                    and item['generationId'] == new for item in socket.items))
        assert [item for item in socket.items if isinstance(item, bytes)] == [b'\4\0']
        envelopes = [item for item in socket.items if isinstance(item, dict)]
        assert [(item['phase'], item['generationId']) for item in envelopes] == [
            ('start', old), ('end', old), ('start', new), ('end', new)]
        await stream.close()
    asyncio.run(run())


def test_complete_before_barge_in_still_invalidates_old_playback_generation():
    async def run():
        socket = Socket()
        stream = OrdinaryAudioStream(LockedLiveSender(socket), Speech())
        old = str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', old)])
        stream.finish(old)
        await settled(lambda: any(isinstance(item, dict) and item['phase'] == 'end'
                                 for item in socket.items))
        await stream.cut(str(uuid4()))
        stream.enqueue([LiveAudio(b'\2\0', old)])
        await asyncio.sleep(0)
        assert [item for item in socket.items if isinstance(item, bytes)] == [b'\1\0']
        await stream.close()
    asyncio.run(run())


def test_cut_before_start_lock_acquired_does_not_send_orphan_end():
    async def run():
        socket = Socket()
        sender = LockedLiveSender(socket)
        stream = OrdinaryAudioStream(sender, Speech())
        await sender.lock.acquire()
        stream.enqueue([LiveAudio(b'\1\0', str(uuid4()))])
        await settled(lambda: stream.owns_lane)
        await stream.cut(str(uuid4()))
        assert not sender.audio_lane.locked()
        sender.lock.release()
        assert socket.items == []
        await stream.close()
    asyncio.run(run())


def test_verified_envelope_cannot_enter_open_ordinary_lane():
    async def run():
        socket, sender = Socket(), None
        sender = LockedLiveSender(socket)
        stream = OrdinaryAudioStream(sender, Speech())
        old = str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', old)])
        await settled(lambda: b'\1\0' in socket.items)
        verified = asyncio.create_task(sender.speech('event', 'request', [b'\2\0'],
                                                   valid=lambda: True))
        await asyncio.sleep(0)
        assert b'\2\0' not in socket.items
        stream.finish(old)
        await verified
        assert [(item['type'], item['phase']) for item in socket.items
                if isinstance(item, dict)] == [('ordinary_audio', 'start'),
            ('ordinary_audio', 'end'), ('speech_delivery', 'start'),
            ('speech_delivery', 'end')]
        await stream.close()
    asyncio.run(run())


def test_gate_retains_source_generation_and_reply_identity():
    gate = LiveActionAudioGate(hold_until_final=True)
    turn, generation = str(uuid4()), str(uuid4())
    gate.start(turn)
    audio = LiveAudio(b'\1\0', generation, turn)
    assert gate.capture(audio) == ()
    frames, _ = gate.finalize(turn, suppress=False)
    assert frames[0] is audio


def test_input_end_alone_never_renames_old_generation():
    epoch = LiveOutputEpoch()
    first = epoch.ensure('first')
    epoch.voice_start()
    assert not epoch.voice_end('second')
    assert epoch.ensure('second') == first
    assert epoch.delimiter('second')
    assert epoch.ensure('second') != first


def test_old_complete_during_new_voice_waits_for_new_input_end():
    epoch = LiveOutputEpoch()
    first = epoch.ensure('first')
    epoch.voice_start()
    epoch.complete()
    assert epoch.ensure('second') == first
    assert epoch.voice_end('second')
    assert epoch.ensure('second') != first


def test_vertex_interrupted_late_pcm_and_old_complete_do_not_reopen_audio():
    async def run():
        old, stale, fresh = b'\1\0', b'\2\0', b'\3\0'
        session = VertexLiveSession(Frames([audio_frame(old),
            {'voiceActivity': VOICE_START},
            {'serverContent': {'interrupted': True}}, audio_frame(stale),
            {'serverContent': {'turnComplete': True}}, audio_frame(stale),
            {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
            audio_frame(fresh), {'serverContent': {'turnComplete': True}}]))
        events = [item async for item in session.events()]
        audio = [item for item in events if isinstance(item, LiveAudio)]
        assert [item.pcm for item in audio] == [old, fresh]
        assert audio[0].generation_id != audio[1].generation_id
        assert audio[1].reply_to_turn_id
    asyncio.run(run())


def test_router_reads_vad_while_ordinary_flush_is_blocked(monkeypatch):
    import app.uony_live_router as module
    monkeypatch.setattr(module, '_save_transcript', lambda *args: True)
    monkeypatch.setattr(module, 'metadata_turn_allowed', lambda *args: False)
    monkeypatch.setattr(module, 'contextual_intent', lambda *args, **kw: None)
    async def run():
        socket = Socket()
        socket.block = True
        queue = asyncio.Queue()
        class Session:
            async def events(self):
                while True:
                    yield await queue.get()
        class Delivery:
            speech = Speech()
            async def unconfirmed(self, *args):
                pass
        router = LiveTurnRouter(None, None, SimpleNamespace(), 's', 'h', Session(),
            Delivery(), LockedLiveSender(socket), LiveActionAudioGate(hold_until_final=True))
        task = asyncio.create_task(router.run())
        first, second, generation = str(uuid4()), str(uuid4()), str(uuid4())
        for event in (LiveSpeechStarted(first), LiveStatus('speaking', generation),
                LiveAudio(b'\1\0', generation, first),
                LiveTranscript('user', first, 'Hola', finalized_by='provider_finished')):
            queue.put_nowait(event)
        await socket.sending.wait()
        queue.put_nowait(LiveSpeechStarted(second))
        await settled(lambda: any(isinstance(item, dict) and
            item.get('type') == 'speech_started' and item.get('turnId') == second
            for item in socket.items))
        assert not any(isinstance(item, bytes) for item in socket.items)
        assert generation in router.ordinary.invalid
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    asyncio.run(run())


def test_wire_end_waits_for_matching_playback_ack_before_verified_voice():
    async def run():
        socket, speech = Socket(), Speech()
        sender = LockedLiveSender(socket)
        stream = OrdinaryAudioStream(sender, speech)
        generation = str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', generation)])
        stream.finish(generation)
        await settled(lambda: stream.active is None and generation in stream.playback_pending)
        assert speech.state == 'speaking'
        stream.acknowledge(str(uuid4()), 'played')
        assert speech.state == 'speaking'
        assert await sender.speech('e', 'r', [b'\2\0'], valid=lambda: True,
                    can_start=lambda: speech.state == 'listening') is False
        stream.acknowledge(generation, 'played')
        assert speech.state == 'listening'
        count = len(socket.items)
        stream.enqueue([LiveAudio(b'\3\0', generation)])
        await asyncio.sleep(0)
        assert len(socket.items) == count
        assert speech.state == 'listening'
        await sender.speech('e', 'r', [b'\2\0'], valid=lambda: True,
                            can_start=lambda: speech.state == 'listening')
        assert b'\2\0' in socket.items
        await stream.close()
    asyncio.run(run())


def test_interrupted_playback_ack_rejects_late_generation():
    async def run():
        socket = Socket()
        stream = OrdinaryAudioStream(LockedLiveSender(socket), Speech())
        generation = str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', generation)])
        stream.finish(generation)
        await settled(lambda: b'\1\0' in socket.items)
        stream.acknowledge(generation, 'interrupted')
        stream.enqueue([LiveAudio(b'\2\0', generation)])
        await asyncio.sleep(0)
        assert b'\2\0' not in socket.items
        await stream.close()
    asyncio.run(run())


def test_cut_during_committed_start_reconciles_and_closes_envelope():
    async def run():
        class SlowStart(Socket):
            async def send_json(self, payload):
                self.items.append(payload)
                if payload.get('phase') == 'start':
                    self.sending.set()
                    await self.release.wait()
        socket = SlowStart()
        sender = LockedLiveSender(socket)
        stream = OrdinaryAudioStream(sender, Speech())
        stream.enqueue([LiveAudio(b'\1\0', str(uuid4()))])
        await socket.sending.wait()
        cut = asyncio.create_task(stream.cut(str(uuid4())))
        await asyncio.sleep(0)
        socket.release.set()
        await cut
        assert [item['phase'] for item in socket.items] == ['start', 'end']
        assert not sender.audio_lane.locked()
        await stream.close()
    asyncio.run(run())


def test_cut_with_uncertain_open_fails_immediately_before_another_turn():
    async def run():
        class UncertainStart(Socket):
            async def send_json(self, payload):
                self.items.append(payload)
                self.sending.set()
                await self.release.wait()
        socket = UncertainStart()
        sender = LockedLiveSender(socket)
        stream = OrdinaryAudioStream(sender, Speech())
        stream.enqueue([LiveAudio(b'\1\0', str(uuid4()))])
        await socket.sending.wait()
        with pytest.raises(RuntimeError, match='boundary uncertain'):
            await stream.cut(str(uuid4()))
        assert not sender.audio_lane.locked()
        assert not any(isinstance(item, bytes) for item in socket.items)
        assert [item['phase'] for item in socket.items] == ['start']
    asyncio.run(run())


def test_vertex_input_end_without_output_delimiter_still_drops_old_pcm():
    async def run():
        session = VertexLiveSession(Frames([audio_frame(b'\1\0'),
            {'voiceActivity': VOICE_START},
            {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}},
            audio_frame(b'\2\0'), {'serverContent': {'interrupted': True}},
            audio_frame(b'\3\0'), {'serverContent': {'turnComplete': True}}]))
        audio = [item async for item in session.events() if isinstance(item, LiveAudio)]
        assert [item.pcm for item in audio] == [b'\1\0', b'\3\0']
        assert audio[0].generation_id != audio[1].generation_id
    asyncio.run(run())


def test_bridge_accepts_ordinary_ack_and_keeps_voice_session(environment):
    from dataclasses import replace
    from fastapi.testclient import TestClient
    from app.main import create_app
    from test_uony_live_bridge import FakeLive, account_setup, bind, headers, work_counts
    config, provider, database = environment
    account = account_setup(config, provider, database)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(config, account[3])) as ws:
            bind(ws, 'ordinary-ack')
            generation = str(uuid4())
            fake.sessions[0].emit(LiveAudio(b'\1\0', generation))
            fake.sessions[0].emit(LiveStatus('listening', generation))
            packet = ws.receive_json()
            if packet.get('type') == 'status':
                packet = ws.receive_json()
            assert packet['type'] == 'ordinary_audio' and packet['phase'] == 'start'
            assert ws.receive_bytes() == b'\1\0'
            packet = ws.receive_json()
            if packet.get('type') == 'status':
                packet = ws.receive_json()
            assert packet['type'] == 'ordinary_audio' and packet['phase'] == 'end'
            ws.send_json({'type': 'ordinary_ack', 'generationId': generation,
                          'outcome': 'played'})
            fake.sessions[0].emit(LiveTranscript('user', str(uuid4()), 'Hola'))
            packet = ws.receive_json()
            while packet.get('type') == 'status':
                packet = ws.receive_json()
            assert packet['type'] == 'transcript' and packet['text'] == 'Hola'
            assert work_counts(database) == (0, 0, 0)


def test_cut_during_committed_end_preserves_exactly_one_end():
    async def run():
        class SlowEnd(Socket):
            async def send_json(self, payload):
                self.items.append(payload)
                if payload.get('phase') == 'end':
                    self.sending.set()
                    await self.release.wait()
        socket = SlowEnd()
        sender = LockedLiveSender(socket)
        stream = OrdinaryAudioStream(sender, Speech())
        generation = str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', generation)])
        stream.finish(generation)
        await settled(lambda: any(isinstance(item, dict) and item['phase'] == 'end'
                                 for item in socket.items))
        cut = asyncio.create_task(stream.cut(str(uuid4())))
        await asyncio.sleep(0)
        socket.release.set()
        await cut
        assert [item['phase'] for item in socket.items if isinstance(item, dict)] == [
            'start', 'end']
        assert not sender.audio_lane.locked()
        await stream.close()
    asyncio.run(run())


def test_output_failure_closes_router_without_waiting_for_another_provider_event():
    async def run():
        class BrokenAudio(Socket):
            async def send_bytes(self, pcm):
                raise ValueError('output unavailable')
        class Session:
            async def events(self):
                yield LiveAudio(b'\1\0', str(uuid4()))
                await asyncio.Event().wait()
        router = LiveTurnRouter(None, None, SimpleNamespace(), 's', 'h', Session(),
            SimpleNamespace(speech=Speech()), LockedLiveSender(BrokenAudio()),
            LiveActionAudioGate(hold_until_final=True))
        with pytest.raises(ValueError, match='output unavailable'):
            await asyncio.wait_for(router.run(), timeout=1)
        assert not router.sender.audio_lane.locked()
    asyncio.run(run())


def test_router_vad_then_final_without_vad_advances_focus_but_late_old_final_does_not(monkeypatch):
    import app.uony_live_router as module
    monkeypatch.setattr(module, '_save_transcript', lambda *args: True)
    monkeypatch.setattr(module, 'metadata_turn_allowed', lambda *args: False)
    monkeypatch.setattr(module, 'contextual_intent', lambda *args, **kw: None)
    async def run():
        socket, queue = Socket(), asyncio.Queue()
        class Session:
            async def events(self):
                while True:
                    yield await queue.get()
        class Delivery:
            speech = Speech()
            async def unconfirmed(self, *args):
                pass
        router = LiveTurnRouter(None, None, SimpleNamespace(), 's', 'h', Session(),
            Delivery(), LockedLiveSender(socket), LiveActionAudioGate(hold_until_final=True))
        task = asyncio.create_task(router.run())
        first, second = str(uuid4()), str(uuid4())
        queue.put_nowait(LiveSpeechStarted(first))
        queue.put_nowait(LiveTranscript('user', first, 'Hola', finalized_by='provider_finished'))
        queue.put_nowait(LiveAudio(b'\1\0', str(uuid4()), first))
        await settled(lambda: b'\1\0' in socket.items)
        queue.put_nowait(LiveTranscript('user', second, 'Otro tema', finalized_by='provider_finished'))
        queue.put_nowait(LiveTranscript('user', first, 'Hola', finalized_by='provider_finished'))
        queue.put_nowait(LiveAudio(b'\2\0', str(uuid4()), second))
        await settled(lambda: b'\2\0' in socket.items)
        assert router.ordinary.latest_turn == second
        assert router.audio_gate.turn_id == second
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    asyncio.run(run())
