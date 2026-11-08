"""Adversarial audio delivery checks; isolated DB and no Google/network audio."""
import asyncio
from dataclasses import replace
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.security import digest
from app.uony_live_adk_narration import VerifiedLiveSpeech
from app.uony_live_bridge import (LiveIdentity, LiveTranscript, _bind, _reserve,
                                  _save_transcript, _session_allowed)
from app.uony_live_delivery import LockedLiveSender
from app.uony_live_delivery_store import LiveDeliveryStore, delivery_metrics
from app.uony_live_handoff import route_final_turn
from app.uony_live_result_speech import LiveResultSpeech
from app.uony_session_cache import RedisSessionCache
from app.uony_session_continuity import SessionContinuity
from test_uony_live_handoff import prepared


@pytest.fixture
def delivery_case(environment):
    settings, _, db, account = prepared(environment)
    project = str(uuid4())
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (account[0], project))
    identity = _bind(db, LiveIdentity(str(account[0]), account[1], account[2]),
                     'delivery-faults', project)
    session, token, turn = str(uuid4()), digest(account[3]), str(uuid4())
    assert _reserve(db, identity, session, token)
    continuity = SessionContinuity(db, RedisSessionCache())
    lease = continuity.acquire(identity.user_id, identity.thread_id, session,
        google_subject=identity.google_subject, google_project_id=identity.project_id)
    spoken = '¿Tienes acceso a mi Drive?'
    assert _save_transcript(db, identity, session,
        LiveTranscript('user', turn, spoken, finalized_by='provider_finished'))
    admitted = route_final_turn(db, settings, identity, session, token, turn,
                                'use_drive_materials', spoken)
    assert admitted['status'] == 'queued'
    request = admitted['requestId']
    text = 'Hay dos carpetas visibles.'
    with db.connect() as c:
        c.execute("UPDATE uony_requests SET status='success',reply=%s WHERE request_id=%s",
                  (text, request))
        c.execute("""UPDATE uony_conversation_jobs SET status='success',finished_at=now()
            WHERE request_id=%s""", (request,))
    return SimpleNamespace(db=db, identity=identity, session=session, token=token,
        turn=turn, request=request, text=text, continuity=continuity, lease=lease,
        state={'status': 'success', 'reply': text}, project=project)


class Socket:
    def __init__(self):
        self.items = []

    async def send_json(self, packet):
        self.items.append(packet)

    async def send_bytes(self, frame):
        self.items.append(frame)


class Renderer:
    def __init__(self):
        self.calls = []

    async def __call__(self, identity, text):
        self.calls.append((identity, text))
        return VerifiedLiveSpeech((b'\1\0\2\0',), text,
                                  ({'totalTokenCount': 12},), 25)


def speech_for(case, renderer, socket, **extra):
    return LiveResultSpeech(case.db, case.identity, case.session, renderer,
        LockedLiveSender(socket), case.continuity, case.lease,
        validate=lambda: _session_allowed(case.db, case.identity,
                                          case.session, case.token), **extra)


def receipt(case):
    with case.db.connect() as c:
        return c.execute('SELECT * FROM uony_live_deliveries WHERE request_id=%s',
                         (case.request,)).fetchone()


async def until(predicate):
    async with asyncio.timeout(3):
        while not predicate():
            await asyncio.sleep(.005)


async def settled(speech):
    await until(lambda: speech.runner is not None and speech.runner.done())
    await speech.runner


def test_result_waits_until_user_stops_and_is_spoken_once(delivery_case):
    case = delivery_case

    async def run():
        renderer, socket = Renderer(), Socket()
        speech = speech_for(case, renderer, socket)
        speech.speech_started()
        await speech.announce(case.request, case.turn, case.state)
        await asyncio.sleep(.03)
        assert renderer.calls == [] and socket.items == []
        speech.speech_ended()
        await settled(speech)
        assert len(renderer.calls) == 1
        assert len([x for x in socket.items if isinstance(x, bytes)]) == 1
        event = next(x['eventId'] for x in socket.items
                     if isinstance(x, dict) and x.get('phase') == 'start')
        await speech.acknowledge(event, 'played')
        await speech.announce(case.request, case.turn, case.state)
        await settled(speech)
        assert len(renderer.calls) == 1
        await speech.close()

    asyncio.run(run())
    row = receipt(case)
    assert row['state'] == 'acknowledged' and row['sent_at'] is not None
    assert row['usage_state'] == 'observed' and row['usage']['totalTokenCount'] == 12
    assert row['acknowledged_at'] is not None


@pytest.mark.parametrize('failure', ['superseded', 'cloud_changed', 'heartbeat_expired'])
def test_invalid_session_never_starts_renderer(delivery_case, failure):
    case = delivery_case
    if failure == 'superseded':
        with case.db.connect() as c:
            c.execute('UPDATE uony_session_continuity SET fence=fence+1')
    else:
        with case.db.connect() as c:
            if failure == 'cloud_changed':
                c.execute("UPDATE google_cloud_connections SET status='reauthorize'")
            else:
                c.execute("UPDATE uony_live_sessions SET heartbeat_at=now()-interval '31 seconds'")

    async def run():
        renderer, socket = Renderer(), Socket()
        speech = speech_for(case, renderer, socket)
        await speech.announce(case.request, case.turn, case.state)
        await settled(speech)
        assert renderer.calls == [] and socket.items == []
        await speech.close()

    asyncio.run(run())
    assert receipt(case) is None


def test_barge_in_cancels_narration_without_retrying_or_cancelling_job(delivery_case):
    case = delivery_case

    async def run():
        started = asyncio.Event()
        calls, cancelled = [], []

        async def renderer(identity, text):
            calls.append(text)
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.append(True)
                raise

        socket = Socket()
        speech = speech_for(case, renderer, socket)
        await speech.announce(case.request, case.turn, case.state)
        await asyncio.wait_for(started.wait(), 3)
        speech.speech_started()
        await settled(speech)
        assert cancelled == [True] and socket.items == []
        speech.speech_ended()
        await speech.announce(case.request, case.turn, case.state)
        await settled(speech)
        assert calls == [case.text]
        await speech.close()

    asyncio.run(run())
    row = receipt(case)
    assert row['state'] == 'interrupted' and row['sent_at'] is None
    assert row['usage_state'] == 'unknown' and row['usage'] == {}
    with case.db.connect() as c:
        assert c.execute('SELECT status FROM uony_conversation_jobs WHERE request_id=%s',
                         (case.request,)).fetchone()['status'] == 'success'


def test_socket_failure_before_first_byte_is_not_audio_delivery(delivery_case):
    case = delivery_case

    class FailedSocket(Socket):
        async def send_bytes(self, frame):
            raise ConnectionError('fixture failure before audio bytes')

    async def run():
        renderer, socket = Renderer(), FailedSocket()
        speech = speech_for(case, renderer, socket)
        await speech.announce(case.request, case.turn, case.state)
        await settled(speech)
        assert not any(isinstance(x, bytes) for x in socket.items)
        assert {'type': 'interrupted'} in socket.items
        await speech.close()

    asyncio.run(run())
    row = receipt(case)
    assert row['state'] == 'unknown' and row['sent_at'] is None
    assert row['usage_state'] == 'observed' and row['usage']['totalTokenCount'] == 12
    with case.db.connect() as c:
        metrics = delivery_metrics(c, {'id': case.identity.user_id,
            'google_subject': case.identity.google_subject}, case.project)
    assert metrics[0]['resultToAudioP95Ms'] is None
    assert metrics[0]['endToPlaybackP95Ms'] is None


def test_partial_audio_envelope_marks_interruption_before_end():
    async def run():
        second = asyncio.Event()
        sent = []

        class PausingSocket(Socket):
            async def send_bytes(self, frame):
                if sent:
                    second.set()
                    await asyncio.Future()
                sent.append(frame)
                self.items.append(frame)

        socket = PausingSocket()
        sender = LockedLiveSender(socket)
        task = asyncio.create_task(sender.speech(str(uuid4()), str(uuid4()),
            (b'\1\0', b'\2\0', b'\3\0'), valid=lambda: True))
        await asyncio.wait_for(second.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert sent == [b'\1\0']
        end = next(i for i, item in enumerate(socket.items)
                   if isinstance(item, dict) and item.get('phase') == 'end')
        assert socket.items[end - 1] == {'type': 'interrupted'}

    asyncio.run(run())


def test_ack_requires_same_user_session_and_only_marks_played_after_client_ack(delivery_case):
    case = delivery_case

    async def run():
        speech = speech_for(case, Renderer(), Socket())
        await speech.announce(case.request, case.turn, case.state)
        await settled(speech)
        event = str(receipt(case)['event_id'])
        other_session = LiveDeliveryStore(case.db, case.identity, str(uuid4()))
        other_user = LiveDeliveryStore(case.db,
            replace(case.identity, user_id=str(uuid4())), case.session)
        assert other_session.acknowledge(event, 'played') is None
        assert other_user.acknowledge(event, 'played') is None
        assert receipt(case)['state'] == 'sending'
        await speech.acknowledge(event, 'played')
        assert receipt(case)['state'] == 'acknowledged'
        await speech.acknowledge(event, 'interrupted')
        assert receipt(case)['state'] == 'acknowledged'
        await speech.close()

    asyncio.run(run())


def test_interruption_during_durable_begin_finishes_receipt(delivery_case):
    case = delivery_case

    async def run():
        committed, release = Event(), Event()
        renderer, socket = Renderer(), Socket()
        speech = speech_for(case, renderer, socket)
        begin = speech.store.begin

        def delayed_begin(request):
            event = begin(request)
            committed.set()
            assert release.wait(3)
            return event

        speech.store.begin = delayed_begin
        await speech.announce(case.request, case.turn, case.state)
        assert await asyncio.to_thread(committed.wait, 2)
        speech.speech_started()
        # Let cancellation reach the await before the thread returns its ID.
        await asyncio.sleep(.02)
        release.set()
        await settled(speech)
        assert renderer.calls == [] and socket.items == []
        await speech.close()

    asyncio.run(run())
    assert receipt(case)['state'] == 'interrupted'


def test_closed_speech_does_not_admit_a_late_result(delivery_case):
    case = delivery_case

    async def run():
        renderer, socket = Renderer(), Socket()
        speech = speech_for(case, renderer, socket)
        await speech.close()
        await speech.announce(case.request, case.turn, case.state)
        await asyncio.sleep(.03)
        assert renderer.calls == [] and socket.items == []
        assert receipt(case) is None
        await speech.close()

    asyncio.run(run())


def test_result_waits_for_both_model_and_client_audio_to_finish(delivery_case):
    case = delivery_case

    async def run():
        renderer, socket = Renderer(), Socket()
        speech = speech_for(case, renderer, socket)
        speech.model_status('speaking')
        speech.client_playback('playing')
        await speech.announce(case.request, case.turn, case.state)
        await asyncio.sleep(.02)
        assert renderer.calls == [] and socket.items == []
        speech.model_status('listening')
        await asyncio.sleep(.02)
        assert renderer.calls == [] and socket.items == []
        speech.client_playback('idle')
        await settled(speech)
        assert len(renderer.calls) == 1
        assert len([x for x in socket.items if isinstance(x, bytes)]) == 1
        await speech.close()

    asyncio.run(run())


def test_playback_starting_during_render_is_not_cut_off_by_result(delivery_case):
    case = delivery_case

    async def run():
        entered, finish = asyncio.Event(), asyncio.Event()
        calls = []

        async def renderer(identity, text):
            calls.append(text)
            entered.set()
            await finish.wait()
            return VerifiedLiveSpeech((b'\1\0',), text, (), 25)

        socket = Socket()
        speech = speech_for(case, renderer, socket)
        await speech.announce(case.request, case.turn, case.state)
        await asyncio.wait_for(entered.wait(), 2)
        speech.client_playback('playing')
        finish.set()
        await asyncio.sleep(.06)
        assert socket.items == []
        speech.client_playback('idle')
        await settled(speech)
        assert calls == [case.text]
        assert [x for x in socket.items if isinstance(x, bytes)] == [b'\1\0']
        await speech.close()

    asyncio.run(run())


def test_early_interrupted_ack_releases_playback_without_claiming_audio_sent(delivery_case):
    case = delivery_case

    async def run():
        class MutedSocket(Socket):
            async def send_json(self, packet):
                self.items.append(packet)
                if packet.get('type') == 'speech_delivery' and packet['phase'] == 'start':
                    assert speech.verified_playback_pending
                    await speech.acknowledge(packet['eventId'], 'interrupted')
                    assert not speech.verified_playback_pending

        renderer, socket = Renderer(), MutedSocket()
        speech = speech_for(case, renderer, socket)
        await speech.announce(case.request, case.turn, case.state)
        await settled(speech)
        assert len(renderer.calls) == 1
        assert not speech.verified_playback_pending
        await speech.close()

    asyncio.run(run())
    row = receipt(case)
    assert row['state'] == 'interrupted' and row['sent_at'] is None
    assert row['acknowledged_at'] is not None
    assert row['usage_state'] == 'observed' and row['usage']['totalTokenCount'] == 12
