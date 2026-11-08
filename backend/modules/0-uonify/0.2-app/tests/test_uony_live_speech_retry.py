"""Verified audio waits for the ordinary lane without rendering or acting twice."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.uony_live_delivery import LockedLiveSender
from app.uony_live_bridge import LiveAudio
from app.uony_live_ordinary_audio import OrdinaryAudioStream
from app.uony_live_result_speech import LiveResultSpeech


class Socket:
    def __init__(self):
        self.items = []
        self.closed = []

    async def send_json(self, item):
        self.items.append(item)

    async def send_bytes(self, frame):
        self.items.append(frame)

    async def close(self, **kwargs):
        self.closed.append(kwargs)


class Store:
    def __init__(self):
        self.begins = []
        self.states = []
        self.sent = []

    def begin(self, request):
        self.begins.append(request)
        return str(uuid4())

    def update(self, event, state, **kwargs):
        self.states.append(state)
        return True

    def mark_sent(self, event):
        self.sent.append(event)

    def acknowledge(self, event, outcome):
        return {'requestId': 'request', 'turnId': 'turn'}


async def until(predicate):
    async with asyncio.timeout(2):
        while not predicate():
            await asyncio.sleep(.001)


async def waiting_result():
    socket = Socket()
    sender = LockedLiveSender(socket)
    calls, attempts = [], []

    async def render(identity, text):
        calls.append(text)
        return SimpleNamespace(frames=(b'\1\0', b'\2\0'), usages=(), elapsed_ms=5)

    original = sender.speech

    async def send(*args, **kwargs):
        result = await original(*args, **kwargs)
        attempts.append(result)
        return result

    sender.speech = send
    speech = LiveResultSpeech(None, None, 'session', render, sender)
    speech.store = Store()
    await sender.audio_lane.acquire()
    await speech.announce('request', 'turn', {'status': 'success', 'reply': 'Dato verificado.'})
    await until(lambda: speech.store.states == ['sending'])
    speech.model_status('speaking')
    speech.client_playback('playing')
    sender.audio_lane.release()
    await until(lambda: attempts == [False])
    assert socket.items == [] and not speech.runner.done()
    return speech, socket, calls, attempts


def test_busy_lane_reuses_verified_frames_after_both_playback_signals_finish():
    async def run():
        speech, socket, calls, attempts = await waiting_result()
        speech.model_status('listening')
        await asyncio.sleep(.02)
        assert attempts == [False] and socket.items == []
        speech.client_playback('idle')
        await asyncio.wait_for(speech.runner, 2)
        assert calls == ['Dato verificado.']
        assert attempts == [False, True]
        assert speech.store.begins == ['request']
        assert speech.store.states == ['sending']
        assert len(speech.store.sent) == 1
        assert socket.items[1:3] == [b'\1\0', b'\2\0']
        assert [x['phase'] for x in socket.items if isinstance(x, dict)] == ['start', 'end']
        await speech.close()
    asyncio.run(run())


@pytest.mark.parametrize('stop', ['new_speech', 'closed'])
def test_waiting_result_is_cancelled_without_re_render_when_customer_interrupts(stop):
    async def run():
        speech, socket, calls, attempts = await waiting_result()
        if stop == 'new_speech':
            speech.speech_started()
            await asyncio.wait_for(speech.runner, 2)
        else:
            await speech.close()
        speech.model_status('listening')
        speech.client_playback('idle')
        assert calls == ['Dato verificado.'] and attempts == [False]
        assert socket.items == []
        assert speech.store.states == ['sending', 'interrupted']
        assert speech.store.sent == []
        await speech.close()
    asyncio.run(run())


def test_waiting_result_rechecks_authority_before_sending_frames():
    async def run():
        speech, socket, calls, attempts = await waiting_result()
        speech.validate = lambda: False
        speech.model_status('listening')
        speech.client_playback('idle')
        await asyncio.wait_for(speech.runner, 2)
        assert calls == ['Dato verificado.'] and attempts == [False]
        assert socket.items == []
        assert speech.store.states == ['sending', 'interrupted']
        await speech.close()
    asyncio.run(run())


def test_ordinary_audio_waits_for_verified_playback_ack_not_only_wire_end():
    async def run():
        socket, calls = Socket(), []
        sender = LockedLiveSender(socket)

        async def render(identity, text):
            calls.append(text)
            return SimpleNamespace(frames=(b'\1\0',), usages=(), elapsed_ms=5)

        speech = LiveResultSpeech(None, None, 'session', render, sender)
        speech.store = Store()
        await speech.announce('request', 'turn', {'status': 'success', 'reply': 'Dato.'})
        await until(lambda: speech.runner.done())
        stream = OrdinaryAudioStream(sender, speech)
        generation = str(uuid4())
        stream.enqueue([LiveAudio(b'\2\0', generation)])
        stream.finish(generation)
        await asyncio.sleep(.02)
        assert b'\2\0' not in socket.items
        event = next(x['eventId'] for x in socket.items if isinstance(x, dict))
        await speech.acknowledge(str(uuid4()), 'played')
        await asyncio.sleep(.01)
        assert b'\2\0' not in socket.items
        await speech.acknowledge(event, 'played')
        await until(lambda: b'\2\0' in socket.items)
        assert calls == ['Dato.']
        assert [x['type'] for x in socket.items if isinstance(x, dict)] == [
            'speech_delivery', 'speech_delivery', 'ordinary_audio', 'ordinary_audio']
        await stream.close()
        await speech.close()
    asyncio.run(run())


def test_new_customer_turn_cancels_waiting_ordinary_and_releases_verified_playback():
    async def run():
        socket = Socket()
        sender = LockedLiveSender(socket)
        speech = LiveResultSpeech(None, None, 'session', None, sender)
        stream = OrdinaryAudioStream(sender, speech)
        speech._reserve_playback('verified-event')
        old, new, turn = str(uuid4()), str(uuid4()), str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', old)])
        await asyncio.sleep(0)
        speech.speech_started()
        await stream.cut(turn)
        assert socket.items == [] and not speech.verified_playback_pending
        speech.speech_ended()
        stream.enqueue([LiveAudio(b'\2\0', old), LiveAudio(b'\3\0', new, turn)])
        stream.finish(new)
        await until(lambda: b'\3\0' in socket.items)
        assert [x for x in socket.items if isinstance(x, bytes)] == [b'\3\0']
        await stream.close()
        await speech.close()
    asyncio.run(run())


def test_verified_playback_reserved_while_ordinary_waits_for_lane_is_rechecked():
    async def run():
        entered = asyncio.Event()

        class ObservedLock:
            def __init__(self):
                self.lock = asyncio.Lock()

            async def acquire(self):
                entered.set()
                await self.lock.acquire()

            def release(self):
                self.lock.release()

        socket = Socket()
        sender = LockedLiveSender(socket)
        sender.audio_lane = ObservedLock()
        await sender.audio_lane.lock.acquire()
        speech = LiveResultSpeech(None, None, 'session', None, sender)
        speech.store = Store()
        stream = OrdinaryAudioStream(sender, speech)
        generation = str(uuid4())
        stream.enqueue([LiveAudio(b'\1\0', generation)])
        stream.finish(generation)
        await entered.wait()
        speech._reserve_playback('verified-event')
        sender.audio_lane.release()
        await asyncio.sleep(.02)
        assert socket.items == [] and not sender.audio_lane.lock.locked()
        await speech.acknowledge('verified-event', 'played')
        await until(lambda: b'\1\0' in socket.items)
        await stream.close()
        await speech.close()
    asyncio.run(run())


@pytest.mark.parametrize('phase', ['start', 'end'])
def test_cancelled_verified_boundary_is_reconciled_before_next_envelope(phase):
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        class Delayed(Socket):
            async def send_json(self, item):
                self.items.append(item)
                if item.get('phase') == phase and item.get('eventId') == 'first':
                    entered.set()
                    await release.wait()

        socket = Delayed()
        sender = LockedLiveSender(socket)
        task = asyncio.create_task(sender.speech('first', 'request', (b'\1\0',),
                                               valid=lambda: True))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        await asyncio.sleep(0)
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not sender.audio_lane.locked() and not sender.lock.locked()
        assert await sender.speech('second', 'request', (b'\2\0',), valid=lambda: True)
        assert [(x['eventId'], x['phase']) for x in socket.items
                if isinstance(x, dict) and x.get('type') == 'speech_delivery'] == [
            ('first', 'start'), ('first', 'end'), ('second', 'start'), ('second', 'end')]
        if phase == 'start':
            assert b'\1\0' not in socket.items
            assert socket.items[1] == {'type': 'interrupted'}
        assert socket.closed == []
    asyncio.run(run())


@pytest.mark.parametrize('phase', ['start', 'end'])
def test_uncertain_verified_boundary_closes_socket_and_refuses_later_audio(phase):
    async def run():
        entered = asyncio.Event()
        class Uncertain(Socket):
            async def send_json(self, item):
                self.items.append(item)
                if item.get('phase') == phase:
                    entered.set()
                    await asyncio.Future()

        socket = Uncertain()
        sender = LockedLiveSender(socket)
        task = asyncio.create_task(sender.speech('event', 'request', (b'\1\0',),
                                               valid=lambda: True))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with pytest.raises(RuntimeError, match='boundary uncertain'):
            await task
        assert socket.closed == [{'code': 1011, 'reason': 'voice_delivery_uncertain'}]
        with pytest.raises(RuntimeError, match='boundary uncertain'):
            await sender.audio(b'\2\0')
        with pytest.raises(RuntimeError, match='boundary uncertain'):
            await sender.event({'type': 'status'})
        assert b'\2\0' not in socket.items
        assert not sender.audio_lane.locked() and not sender.lock.locked()
    asyncio.run(run())
