"""A provisional Drive question cannot audibly pre-empt its verified handoff."""
from dataclasses import replace
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.main import create_app
from app.uony_live_audio_gate import LiveActionAudioGate, MAX_HELD_PCM_BYTES
from app.uony_live_bridge import (LiveAudio, LiveSpeechStarted, LiveStatus,
                                  LiveTranscript, LiveTranscriptPreview)
from test_google_cloud import Cloud
from test_uony_drive_instruction_flow import Drive, NoModel
from test_uony_live_bridge import FakeLive, account_setup, bind, headers


def test_preview_before_vad_preserves_gate_and_non_action_releases_audio():
    gate = LiveActionAudioGate()
    gate.preview('one', '¿Cuántas carpetas tengo en Drive?')
    gate.start('one')  # Google may send inputTranscription before VAD start.
    assert gate.armed_before_first_pcm == 1
    assert gate.capture(b'\0\0') == ()
    assert gate.finalize('one', suppress=False) == ((b'\0\0',), ())
    assert gate.capture(b'\1\0') == (b'\1\0',)
    gate.start('two')
    assert gate.capture(b'\2\0') == (b'\2\0',)


def test_action_audio_is_bounded_and_dropped_after_verified_handoff():
    gate = LiveActionAudioGate()
    gate.start('one')
    gate.preview('one', '¿Podrías indicarme cuántas carpetas tengo allí?')
    assert gate.capture(b'\0\0') == ()
    assert gate.finalize('one', suppress=True) == ((), ())
    assert gate.capture(b'\1\0') == ()
    gate.start('two')
    assert gate.capture(b'\2\0') == (b'\2\0',)
    gate.preview('two', 'Comprueba acceso a Drive')
    assert gate.capture(b'\0' * (MAX_HELD_PCM_BYTES + 2)) == ()
    assert gate.dropped_over_limit == 1
    assert gate.held_bytes == 0
    assert gate.finalize('two', suppress=False) == ((), ())


def test_no_preview_cannot_retract_already_forwarded_audio():
    gate = LiveActionAudioGate()
    gate.start('one')
    assert gate.capture(b'\0\0') == (b'\0\0',)
    gate.preview('one', '¿Cuántas carpetas hay en Drive?')
    assert gate.armed_after_first_pcm == 1
    assert gate.capture(b'\1\0') == ()


def test_admission_gate_holds_audio_even_without_drive_preview():
    gate = LiveActionAudioGate(hold_until_final=True)
    gate.start('one')
    assert gate.capture(b'\0\0') == ()
    assert gate.finalize('one', suppress=True) == ((), ())
    assert gate.capture(b'\1\0') == ()
    gate.start('two')
    assert gate.capture(b'\2\0') == ()
    assert gate.finalize('two', suppress=False) == ((b'\2\0',), ())
    assert gate.capture(b'\3\0') == (b'\3\0',)


def test_long_customer_speech_does_not_exhaust_audio_retention(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr('app.uony_live_audio_gate.time.monotonic', lambda: clock[0])
    gate = LiveActionAudioGate(hold_until_final=True)
    gate.start('long-customer-turn')
    clock[0] += 40
    assert gate.capture(b'\1\0') == ()
    assert gate.dropped_over_limit == 0
    assert gate.finalize('long-customer-turn', suppress=False) == ((b'\1\0',), ())


def test_actual_audio_retention_still_expires(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr('app.uony_live_audio_gate.time.monotonic', lambda: clock[0])
    gate = LiveActionAudioGate(hold_until_final=True)
    gate.start('waiting-final')
    assert gate.capture(b'\1\0') == ()
    clock[0] += 16
    assert gate.capture(b'\2\0') == ()
    assert gate.dropped_over_limit == 1
    assert gate.finalize('waiting-final', suppress=False) == ((), ())


def test_spoken_drive_preview_holds_false_audio_until_verified_handoff(environment):
    settings, provider, db = environment
    account = account_setup(settings, provider, db)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))
    drive, cloud, model, live = Drive(), Cloud(), NoModel(), FakeLive()
    workspace_project = uuid4()
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (account[0], workspace_project))
        c.execute('''INSERT INTO uony_model_checks
            (user_id,project_id,google_subject,model,effort)
            VALUES(%s,%s,%s,'gemini-3.5-flash','medium')''',
            (account[0], account[2], account[1]))
        encrypted = Fernet(settings.encryption_key).encrypt(b'fixture-refresh-only').decode()
        c.execute('''UPDATE google_cloud_connections SET refresh_encrypted=%s
            WHERE user_id=%s''', (encrypted, account[0]))
        c.execute('''INSERT INTO google_drive_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status)
            VALUES(%s,%s,%s,%s,'drive.readonly','connected')''',
            (account[0], account[1], 'live-drive@example.test', encrypted))
    with TestClient(create_app(enabled, provider=provider, cloud=cloud,
            drive=drive, uony=model, live=live), base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'audio-gate-drive', workspace_project)
            session = live.sessions[0]
            turn_id = str(uuid4())
            spoken = '¿Cuántas carpetas hay en mi Drive?'
            session.emit(LiveTranscriptPreview('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript_preview'
            session.emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            session.emit(LiveStatus('speaking'))
            session.emit(LiveAudio(b'\0\0\0\0'))
            session.emit(LiveTranscriptPreview('assistant', str(uuid4()),
                'No puedo contar tus carpetas.', reply_to_turn_id=turn_id))
            session.emit(LiveTranscript('user', turn_id, spoken,
                finalized_by='provider_finished'))
            assert ws.receive_json()['type'] == 'transcript'
            handoff = ws.receive_json()
            assert handoff['type'] == 'handoff' and handoff['status'] == 'queued'
            session.emit(LiveAudio(b'\1\0\1\0'))
            session.emit(LiveStatus('listening'))
            assert ws.receive_json() == {'type': 'status', 'state': 'listening'}
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s AND thread_id=%s''',
                (account[0], 'audio-gate-drive')).fetchone()['n'] == 1


def test_ordinary_spoken_reply_pcm_flows_after_final_admission(environment):
    settings, provider, db = environment
    account = account_setup(settings, provider, db)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))
    live = FakeLive()
    workspace_project = uuid4()
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (account[0], workspace_project))
    with TestClient(create_app(enabled, provider=provider, live=live),
            base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'audio-gate-greeting', workspace_project)
            session = live.sessions[0]
            turn_id = str(uuid4())
            session.emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            session.emit(LiveTranscriptPreview('user', turn_id, 'Hola, ¿cómo estás?'))
            assert ws.receive_json()['type'] == 'transcript_preview'
            session.emit(LiveTranscript('user', turn_id, 'Hola, ¿cómo estás?',
                finalized_by='provider_finished'))
            assert ws.receive_json()['type'] == 'transcript'
            session.emit(LiveStatus('speaking'))
            assert ws.receive_json() == {'type': 'status', 'state': 'speaking'}
            session.emit(LiveAudio(b'\0\0\1\0'))
            assert ws.receive_json()['type'] == 'ordinary_audio'
            assert ws.receive_bytes() == b'\0\0\1\0'


def test_false_positive_drive_preview_restores_text_and_audio(environment):
    settings, provider, db = environment
    account = account_setup(settings, provider, db)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))
    live = FakeLive()
    project_id = uuid4()
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (account[0], project_id))
    with TestClient(create_app(enabled, provider=provider, live=live),
            base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'audio-gate-non-action', project_id)
            session = live.sessions[0]
            turn_id, assistant_id = str(uuid4()), str(uuid4())
            session.emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            session.emit(LiveTranscriptPreview('user', turn_id, 'Mi Drive'))
            assert ws.receive_json()['type'] == 'transcript_preview'
            session.emit(LiveStatus('speaking'))
            session.emit(LiveTranscriptPreview('assistant', assistant_id,
                'De acuerdo.', reply_to_turn_id=turn_id))
            session.emit(LiveAudio(b'\2\0\3\0'))
            session.emit(LiveTranscript('assistant', assistant_id,
                'De acuerdo.', reply_to_turn_id=turn_id))
            session.emit(LiveTranscript('user', turn_id,
                'Hablemos de otra cosa.', finalized_by='provider_finished'))
            assert ws.receive_json()['type'] == 'transcript'
            assert ws.receive_json()['type'] == 'transcript_preview'
            assert ws.receive_json() == {'type': 'status', 'state': 'speaking'}
            assert ws.receive_json()['type'] == 'ordinary_audio'
            assert ws.receive_bytes() == b'\2\0\3\0'
            final = ws.receive_json()
            assert final['type'] == 'transcript' and final['role'] == 'assistant'
            assert final['text'] == 'De acuerdo.'
