"""Caption composition tests use fake sockets only; no Google calls or charge."""
import asyncio
from cryptography.fernet import Fernet
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.uony_live_bridge import (LiveIdentity, LiveSpeechStarted, LiveSpeechEnded,
    LiveTranscript, LiveTranscriptPreview, LiveStatus, LiveUsage)
from app.uony_live_caption_session import (LiveCaptionSession, LiveCaptionStatus,
    LiveCaptionUsage, open_captioned_session)
from app.uony_live_transcribe import TranscribeFinal, TranscribeInterim, TranscribeUsage
from app.uony_live_vertex import VertexLiveProvider, VertexLiveSession


class FakeStream:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.websocket = object()

    def push(self, event):
        self.queue.put_nowait(event)

    async def events(self):
        while (event := await self.queue.get()) is not None:
            yield event

    async def send_audio(self, pcm):
        self.sent.append(pcm)

    async def interrupt(self):
        self.closed = True
        self.push(None)

    async def respond_tool(self, call_id, name, response, scheduling=None):
        self.sent.append(('tool', call_id, name, response) if scheduling is None else
                         ('tool', call_id, name, response, scheduling))

    async def send_system_context(self, text):
        self.sent.append(('system', text))

    async def close(self):
        self.closed = True
        self.push(None)


async def until(events, predicate):
    for _ in range(300):
        if predicate(events):
            return
        await asyncio.sleep(0.005)
    raise AssertionError('event not delivered')


async def collect(session, output):
    async for event in session.events():
        output.append(event)


def finals(events):
    return [event for event in events if isinstance(event, LiveTranscript)
            and event.role == 'user']


def previews(events):
    return [event for event in events if isinstance(event, LiveTranscriptPreview)
            and event.role == 'user']


def test_caption_interim_and_final_are_preview_only_primary_is_canonical():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        turn = str(uuid4())
        await until(events, lambda e: LiveCaptionStatus('ready') in e)
        primary.push(LiveSpeechStarted(turn))
        await until(events, lambda e: LiveSpeechStarted(turn) in e)
        caption.push(TranscribeInterim('Quiero una'))
        await until(events, lambda e: len(previews(e)) == 1)
        assert previews(events)[0].text == 'Quiero una'
        assert finals(events) == []
        caption.push(TranscribeFinal('Quiero una lámpara'))
        await until(events, lambda e: len(previews(e)) == 2)
        assert finals(events) == []
        primary.push(LiveSpeechEnded(turn))
        await until(events, lambda e: LiveSpeechEnded(turn) in e)
        assert finals(events) == []  # Sidecar never commits a durable turn.
        primary.push(LiveTranscript('user', turn, 'Quiero una lámpara diferente'))
        await until(events, lambda e: len(finals(e)) == 1)
        assert finals(events)[0].text == 'Quiero una lámpara diferente'
        primary.push(LiveTranscriptPreview('user', turn, 'atrasado'))
        await asyncio.sleep(0.03)
        assert len(finals(events)) == 1
        assert 'atrasado' not in [item.text for item in previews(events)]
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_two_vad_one_sidecar_final_is_ambiguous_and_never_persisted():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        first, second = str(uuid4()), str(uuid4())
        primary.push(LiveSpeechStarted(first))
        primary.push(LiveSpeechEnded(first))
        primary.push(LiveSpeechStarted(second))
        await until(events, lambda e: any(isinstance(item, LiveSpeechStarted)
            and item.turn_id == second for item in e))
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        caption.push(TranscribeInterim('Podría ser de ambas frases'))
        caption.push(TranscribeFinal('Texto que abarca las dos frases'))
        await asyncio.sleep(0.03)
        assert previews(events) == []
        assert finals(events) == []
        primary.push(LiveSpeechEnded(second))
        primary.push(LiveTranscript('user', first, 'Primer producto'))
        primary.push(LiveTranscript('user', second, 'Segundo producto'))
        await until(events, lambda e: len(finals(e)) == 2)
        assert [(item.turn_id, item.text) for item in finals(events)] == [
            (first, 'Primer producto'), (second, 'Segundo producto')]
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_second_vad_after_completed_first_caption_keeps_previews_independent():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        first, second = str(uuid4()), str(uuid4())
        primary.push(LiveSpeechStarted(first))
        await until(events, lambda e: LiveSpeechStarted(first) in e)
        caption.push(TranscribeFinal('Primera frase'))
        await until(events, lambda e: len(previews(e)) == 1)
        primary.push(LiveSpeechStarted(second))  # END may be missing.
        await until(events, lambda e: any(isinstance(item, LiveSpeechStarted)
            and item.turn_id == second for item in e))
        assert finals(events) == []
        assert LiveCaptionStatus('unavailable') not in events
        caption.push(TranscribeInterim('Segunda frase'))
        await until(events, lambda e: len(previews(e)) == 2)
        assert previews(events)[1].turn_id == second
        primary.push(LiveTranscript('user', first, 'Primera confirmada'))
        primary.push(LiveTranscript('user', second, 'Segunda confirmada'))
        await until(events, lambda e: len(finals(e)) == 2)
        assert [item.text for item in finals(events)] == [
            'Primera confirmada', 'Segunda confirmada']
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_primary_final_is_immediate_even_when_caption_is_slow_or_missing():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        turn = str(uuid4())
        primary.push(LiveSpeechStarted(turn))
        primary.push(LiveSpeechEnded(turn))
        primary.push(LiveTranscript('user', turn, 'Texto Live'))
        await until(events, lambda e: len(finals(e)) == 1)
        assert finals(events)[0].text == 'Texto Live'
        caption.push(TranscribeFinal('Texto tardío diferente'))
        primary.push(LiveTranscript('user', turn, 'Otro Live duplicado'))
        await asyncio.sleep(0.03)
        assert len(finals(events)) == 1
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_caption_final_never_replaces_primary_final_for_same_turn():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        turn = str(uuid4())
        primary.push(LiveSpeechStarted(turn))
        primary.push(LiveSpeechEnded(turn))
        primary.push(LiveTranscript('user', turn, 'Texto primario'))
        await until(events, lambda e: len(finals(e)) == 1)
        caption.push(TranscribeFinal('Texto del sidecar'))
        await asyncio.sleep(0.03)
        assert finals(events)[0].text == 'Texto primario'
        assert previews(events) == []
        assert len(finals(events)) == 1
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_caption_usage_is_distinct_and_has_no_tool_channel():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        primary.push(LiveUsage({'promptTokenCount': 3}))
        caption.push(TranscribeUsage({'promptTokenCount': 7}))
        await until(events, lambda e: len(e) >= 3)
        assert LiveUsage({'promptTokenCount': 3}) in events
        assert LiveCaptionUsage({'promptTokenCount': 7}) in events
        await session.respond_tool('call', 'get_current_work', {'status': 'ok'})
        await session.respond_tool('call', 'get_current_work', {'status': 'done'},
                                   scheduling='WHEN_IDLE')
        await session.send_system_context('Trabajo terminado.')
        assert primary.sent == [
            ('tool', 'call', 'get_current_work', {'status': 'ok'}),
            ('tool', 'call', 'get_current_work', {'status': 'done'}, 'WHEN_IDLE'),
            ('system', 'Trabajo terminado.')]
        assert caption.sent == []
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_sidecar_failure_and_backpressure_leave_voice_running():
    class SlowCaption(FakeStream):
        def __init__(self):
            super().__init__()
            self.entered = asyncio.Event()
            self.release = asyncio.Event()

        async def send_audio(self, pcm):
            self.entered.set()
            await self.release.wait()
            await super().send_audio(pcm)

    async def run():
        primary, caption = FakeStream(), SlowCaption()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        await session.send_audio(b'\x00\x00' * 1024)
        await caption.entered.wait()
        for _ in range(20):
            await session.send_audio(b'\x00\x00' * 1024)
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        assert len(primary.sent) == 21
        primary.push(LiveStatus('listening'))
        await until(events, lambda e: LiveStatus('listening') in e)
        await session.send_audio(b'\x00\x00' * 32)
        assert len(primary.sent) == 22
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_caption_reader_error_is_isolated_and_does_not_leak_message(caplog):
    private = 'secret-transcription-value'

    class BrokenCaption(FakeStream):
        async def events(self):
            raise RuntimeError(private)
            yield  # Keep this an async generator.

    async def run():
        primary, caption = FakeStream(), BrokenCaption()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        primary.push(LiveStatus('listening'))
        await until(events, lambda e: LiveStatus('listening') in e)
        await session.send_audio(b'\x00\x00')
        assert primary.sent == [b'\x00\x00']
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())
    assert private not in caplog.text


def test_clean_caption_close_clears_preview_and_primary_voice_continues():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        turn = str(uuid4())
        primary.push(LiveSpeechStarted(turn))
        await until(events, lambda e: LiveSpeechStarted(turn) in e)
        caption.push(TranscribeInterim('Texto provisional'))
        await until(events, lambda e: len(previews(e)) == 1)
        caption.push(None)  # Google caption socket ends; primary is still open.
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        await until(events, lambda e: len(previews(e)) == 2)
        assert previews(events)[-1].text == ''
        primary.push(LiveSpeechEnded(turn))
        primary.push(LiveTranscript('user', turn, 'El dato confirmado'))
        await until(events, lambda e: len(finals(e)) == 1)
        assert finals(events)[0].text == 'El dato confirmado'
        primary.push(LiveStatus('listening'))
        await until(events, lambda e: LiveStatus('listening') in e)
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_missing_sidecar_final_disables_at_second_vad_before_wrong_mapping():
    async def run():
        primary, caption = FakeStream(), FakeStream()
        session = LiveCaptionSession(primary, caption)
        events = []
        collector = asyncio.create_task(collect(session, events))
        turns = [str(uuid4()) for _ in range(2)]
        for turn in turns:
            primary.push(LiveSpeechStarted(turn))
            primary.push(LiveSpeechEnded(turn))
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        caption.push(TranscribeInterim('No adjudicar al segundo'))
        await asyncio.sleep(0.03)
        assert previews(events) == []
        primary.push(LiveTranscript('user', turns[-1], 'Segundo seguro'))
        await until(events, lambda e: len(finals(e)) == 1)
        assert finals(events)[0].turn_id == turns[-1]
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_caption_setup_failure_keeps_primary_and_reports_state():
    class FailedProvider:
        async def open(self, identity, token):
            raise RuntimeError('fixture secret that must not be logged')

    async def run():
        primary = FakeStream()
        session = await open_captioned_session(primary,
            LiveIdentity('u', 's', 'fixture-project'), 'fixture-token', FailedProvider())
        events = []
        collector = asyncio.create_task(collect(session, events))
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        await session.send_audio(b'\x00\x00')
        assert primary.sent == [b'\x00\x00']
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


def test_caption_setup_has_short_timeout_without_blocking_primary(monkeypatch):
    monkeypatch.setattr('app.uony_live_caption_session.CAPTION_SETUP_TIMEOUT', 0.01)

    class HangingProvider:
        async def open(self, identity, token):
            await asyncio.Event().wait()

    async def run():
        primary = FakeStream()
        session = await open_captioned_session(primary,
            LiveIdentity('u', 's', 'fixture-project'), 'fixture-token', HangingProvider())
        await session.send_audio(b'\x00\x00')
        assert primary.sent == [b'\x00\x00']
        events = []
        collector = asyncio.create_task(collect(session, events))
        await until(events, lambda e: LiveCaptionStatus('unavailable') in e)
        primary.push(None)
        await collector
        await session.close()

    asyncio.run(run())


@pytest.mark.parametrize('pilot_enabled', [True, False])
def test_vertex_provider_opens_caption_only_for_pilot_with_verified_same_token(
        monkeypatch, pilot_enabled):
    """Exercise the real provider hook with fake sockets, OAuth, and caption."""
    identity = LiveIdentity('pilot-user', 'google-subject', 'fixture-project')
    cipher_key = Fernet.generate_key()
    settings = SimpleNamespace(encryption_key=cipher_key,
        live_pilot_user_ids=(identity.user_id,) if pilot_enabled else ())
    refresh = Fernet(cipher_key).encrypt(b'fixture-refresh').decode()
    row = {'refresh_encrypted': refresh, 'google_subject': identity.google_subject,
           'project_id': identity.project_id, 'connected_at': 'fixture-time'}
    token = 'verified-short-lived-token'
    observed = {'checks': 0, 'refreshes': [], 'caption_opens': [], 'caption_constructors': 0}

    class FakeCloud:
        def refresh(self, value):
            observed['refreshes'].append(value)
            return token

    class FakePrimarySocket:
        close_code = None

        def __init__(self):
            self.sent = []
            self.closed = False

        async def send(self, value):
            self.sent.append(value)

        async def recv(self):
            return json.dumps({'setupComplete': {}})

        async def close(self):
            self.closed = True

    primary_socket = FakePrimarySocket()

    async def fake_connect(uri, **kwargs):
        observed['primary_uri'] = uri
        observed['primary_headers'] = kwargs['additional_headers']
        return primary_socket

    caption = FakeStream()

    class FakeCaptionProvider:
        async def open(self, got_identity, got_token):
            observed['caption_opens'].append((got_identity, got_token))
            return caption

    def make_caption_provider():
        observed['caption_constructors'] += 1
        return FakeCaptionProvider()

    monkeypatch.setattr('app.uony_live_vertex.connect', fake_connect)
    monkeypatch.setattr('app.uony_live_vertex.VertexTranscribeProvider',
                        make_caption_provider)
    adapter = VertexLiveProvider(settings, None, FakeCloud(), caption_enabled=True)

    def checked_connection(got_identity):
        assert got_identity == identity
        observed['checks'] += 1
        return row

    monkeypatch.setattr(adapter, '_connection', checked_connection)

    async def run():
        session = await adapter.open(identity)
        if pilot_enabled:
            assert isinstance(session, LiveCaptionSession)
            assert session.caption is caption
        else:
            assert isinstance(session, VertexLiveSession)
        await session.close()

    asyncio.run(run())
    assert observed['checks'] == 2  # Before refresh and after refresh.
    assert observed['refreshes'] == ['fixture-refresh']
    assert observed['primary_headers'] == {'Authorization': f'Bearer {token}'}
    assert json.loads(primary_socket.sent[0])['setup']['model'] == (
        'projects/fixture-project/locations/eu/publishers/google/models/gemini-3.8-live')
    assert observed['caption_constructors'] == int(pilot_enabled)
    assert observed['caption_opens'] == ([(identity, token)] if pilot_enabled else [])
    assert primary_socket.closed
