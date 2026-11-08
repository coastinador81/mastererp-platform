"""A spoken Drive order uses the existing queue and its own saved receipt."""
from dataclasses import replace
from pathlib import Path
import time
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import digest
from app.uony_live_bridge import LiveSpeechEnded, LiveSpeechStarted, LiveStatus, LiveTranscript
from app.uony_live_handoff import route_final_turn
from app.uony_live_transcription import LiveTranscriptionState
from test_google_cloud import Cloud
from test_uony_drive_instruction_flow import Drive, NoModel
from test_uony_live_bridge import FakeLive, account_setup, bind, headers
from test_uony_live_handoff import tool


@pytest.mark.parametrize('finished_before_end', [True, False])
def test_spoken_access_question_with_preface_returns_verified_answer_without_material_job(
        finished_before_end,
        environment):
    settings, provider, db = environment
    account = account_setup(settings, provider, db)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))
    drive, cloud, model, live = Drive(), Cloud(), NoModel(), FakeLive()
    with db.connect() as c:
        c.execute('''INSERT INTO uony_model_checks
            (user_id,project_id,google_subject,model,effort)
            VALUES(%s,%s,%s,'gemini-3.5-flash','medium')''',
            (account[0], account[2], account[1]))
        c.execute('''UPDATE google_cloud_connections SET refresh_encrypted=%s
            WHERE user_id=%s''',
            (Fernet(settings.encryption_key).encrypt(
                b'fixture-refresh-only').decode(), account[0]))
        c.execute('''INSERT INTO google_drive_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status)
            VALUES(%s,%s,%s,%s,'drive.readonly','connected')''',
            (account[0], account[1], 'live-drive@example.test',
             Fernet(settings.encryption_key).encrypt(
                 b'fixture-refresh-only').decode()))

    spoken = 'Una pregunta, ¿tienes acceso a mi Drive?'
    state = LiveTranscriptionState()
    turn_id = state._voice_start()
    state._user_transcription({'text': spoken,
        **({'finished': True} if finished_before_end else {})})
    assert state._voice_end() == turn_id
    final = state._complete_user_turn()
    assert final.finalized_by == 'read_only_boundary'
    with TestClient(create_app(enabled, provider=provider, cloud=cloud,
            drive=drive, uony=model, live=live),
            base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'spoken-drive-access')
            live.sessions[0].emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            live.sessions[0].emit(LiveSpeechEnded(turn_id))
            assert ws.receive_json()['type'] == 'speech_ended'
            # A provisional reply before the final input is held and discarded
            # when the server classifies the turn as a real Drive operation.
            early_reply = str(uuid4())
            verified_reply = 'Ya puedo consultar tu Drive. ¿Qué quieres que busque o analice?'
            live.sessions[0].emit(LiveTranscript('assistant', early_reply,
                verified_reply, reply_to_turn_id=turn_id))
            legacy_reply = str(uuid4())
            live.sessions[0].emit(LiveTranscript('assistant', legacy_reply,
                verified_reply))
            live.sessions[0].emit(final)
            assert ws.receive_json()['type'] == 'transcript'
            queued = ws.receive_json()
            assert queued['type'] == 'handoff' and queued['status'] == 'queued'
            assert queued['turnId'] == turn_id
            tool(live.sessions[0], spoken, intent='use_drive_materials')
            worker = client.app.state.conversation_worker
            job = None
            deadline = time.monotonic() + 2
            while job is None and time.monotonic() < deadline:
                job = worker.queue.claim('spoken-drive-access-fixture')
                if job is None:
                    time.sleep(0.02)
            assert job and str(job['request_id']) == queued['requestId']
            worker.run(job)
            terminal = ws.receive_json()
            assert terminal['type'] == 'handoff' and terminal['status'] == 'success'
            assert terminal['requestId'] == queued['requestId']
            receipt = client.get('/api/uony/requests/' + queued['requestId'],
                                 headers=headers(settings, account[3])).json()
            assert receipt['status'] == 'success'
            assert receipt['response']['reply'] == (
                'Ya puedo consultar tu Drive. ¿Qué quieres que busque o analice?')
            assert receipt['response'].get('materialAnalysis') is None
            # The same turn must show one canonical response after refresh.
            late_reply = str(uuid4())
            live.sessions[0].emit(LiveTranscript('assistant', late_reply,
                verified_reply, reply_to_turn_id=turn_id))
            live.sessions[0].emit(LiveStatus('listening'))
            assert ws.receive_json() == {'type': 'status', 'state': 'listening'}
            next_turn = str(uuid4())
            live.sessions[0].emit(LiveTranscript('user', next_turn, 'Gracias.'))
            assert ws.receive_json()['type'] == 'transcript'
            live.sessions[0].emit(LiveTranscript('assistant', str(uuid4()),
                'De nada.', reply_to_turn_id=next_turn))
            assert ws.receive_json()['type'] == 'transcript'
            later_same_text = str(uuid4())
            live.sessions[0].emit(LiveTranscript('assistant', later_same_text,
                verified_reply))
            assert ws.receive_json()['type'] == 'transcript'
            backfill = (Path(__file__).resolve().parents[1] / 'migrations' /
                        '083_backfill_live_access_reply.sql').read_text()
            with db.connect() as c:
                c.execute(backfill)
                rows = c.execute('''SELECT turn_id,reply_to_turn_id FROM uony_live_turns
                    WHERE turn_id IN (%s,%s)''', (legacy_reply, later_same_text)).fetchall()
            linked = {str(row['turn_id']):str(row['reply_to_turn_id'])
                      if row['reply_to_turn_id'] else None for row in rows}
            assert linked == {later_same_text:None}
            history = client.get('/api/uony/threads',
                                 headers=headers(settings, account[3])).json()
            messages = next(t['messages'] for t in history['threads']
                            if t['id'] == 'spoken-drive-access')
            replies = [m for m in messages if m['role'] == 'assistant']
            assert [m['text'] for m in replies] == [verified_reply, 'De nada.',
                                                   verified_reply]
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM uony_live_handoffs').fetchone()['n'] == 1
            assert c.execute('''SELECT count(*) AS n FROM uony_live_turns
                WHERE role='assistant' AND turn_id=%s''', (late_reply,)).fetchone()['n'] == 0
        assert drive.probes == 1 and drive.lookups == [] and drive.reads == []
        assert model.calls == 0


def test_final_spoken_drive_order_starts_one_job_without_fiche_or_second_consent(
        environment):
    settings, provider, db = environment
    account = account_setup(settings, provider, db)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))
    drive, cloud, model, live = Drive(), Cloud(), NoModel(), FakeLive()
    with db.connect() as c:
        c.execute('''INSERT INTO uony_model_checks
            (user_id,project_id,google_subject,model,effort)
            VALUES(%s,%s,%s,'gemini-3.5-flash','medium')''',
            (account[0], account[2], account[1]))
        c.execute('''UPDATE google_cloud_connections SET refresh_encrypted=%s
            WHERE user_id=%s''',
            (Fernet(settings.encryption_key).encrypt(
                b'fixture-refresh-only').decode(), account[0]))
        c.execute('''INSERT INTO google_drive_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status)
            VALUES(%s,%s,%s,%s,'drive.readonly','connected')''',
            (account[0], account[1], 'live-drive@example.test',
             Fernet(settings.encryption_key).encrypt(
                 b'fixture-refresh-only').decode()))

    spoken = 'Analiza la carpeta de Drive llamada Basic Mini Bricks.'
    with TestClient(create_app(enabled, provider=provider, cloud=cloud,
            drive=drive, uony=model, live=live),
            base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bound = bind(ws, 'spoken-drive-order')
            turn_id = str(uuid4())
            live.sessions[0].emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            live.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript'
            first = ws.receive_json()
            assert first['type'] == 'handoff'
            assert first['turnId'] == turn_id
            assert first['status'] == 'queued'
            live.sessions[0].tool_response_event.clear()
            tool(live.sessions[0], spoken, intent='use_drive_materials')
            assert live.sessions[0].tool_responses == []

            worker = client.app.state.conversation_worker
            queued = None
            deadline = time.monotonic() + 2
            while queued is None and time.monotonic() < deadline:
                queued = worker.queue.claim('spoken-drive-fixture')
                if queued is None:
                    time.sleep(0.02)
            assert queued and str(queued['request_id']) == first['requestId']
            worker.run(queued)
            terminal = ws.receive_json()
            assert terminal['type'] == 'handoff' and terminal['status'] == 'success'
            assert terminal['requestId'] == first['requestId']
            assert live.sessions[0].tool_response_event.wait(2)
            assert live.sessions[0].tool_responses[-1][2]['status'] == 'success'
            receipt = client.get('/api/uony/requests/' + first['requestId'],
                                 headers=headers(settings, account[3])).json()
            assert receipt['status'] == 'success', receipt
            assert receipt['response']['conversationForm'] is None
            material = receipt['response']['materialAnalysis']
            assert material['jobId'] and material['intakeId']
            assert 'iniciado el análisis' in receipt['response']['reply']

            # The handoff's durable route is idempotent after the worker has
            # finished, including when a socket retry repeats the final turn.
            replay = route_final_turn(db, enabled, live.opened[0],
                bound['sessionId'], digest(account[3]), turn_id,
                'use_drive_materials', spoken)
            assert replay['requestId'] == first['requestId']
            assert replay['replayed'] is True
            assert replay['status'] == 'success'

        with db.connect() as c:
            job = c.execute('''SELECT product_id,intake_id,request_id,status
                FROM product_material_jobs WHERE user_id=%s''',
                (account[0],)).fetchone()
            assert job and job['product_id'] is None
            assert str(job['intake_id']) == material['intakeId']
            assert str(job['request_id']) == first['requestId']
            assert job['status'] == 'queued'
            assert c.execute('''SELECT count(*) AS n FROM product_material_jobs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
            assert c.execute('''SELECT count(*) AS n FROM products
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
            authorization = c.execute('''SELECT source,instruction_text,
                conversation_thread_id FROM product_material_job_authorizations
                WHERE job_id=%s''', (material['jobId'],)).fetchone()
            assert authorization == {
                'source': 'chat_instruction',
                'instruction_text': spoken,
                'conversation_thread_id': 'spoken-drive-order',
            }
        assert model.calls == 0
        assert drive.reads == []  # The material worker has not run.
