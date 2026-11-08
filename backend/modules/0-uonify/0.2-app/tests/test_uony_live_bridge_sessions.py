"""Live session lifecycle and deadline tests; local provider only."""
import asyncio
from dataclasses import replace
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.security import digest
from app.uony_live_bridge import (MAX_AUDIO_BYTES, MAX_OUTPUT_BYTES, SESSION_SECONDS,
                                  LiveIdentity, LiveToolCall, LiveTranscript,
                                  LiveUsage, _bind, _reserve, _release,
                                  _save_transcript)
from test_uony_live_bridge import FakeLive, account_setup, bind, headers, work_counts


def test_eight_minute_pcm_budget_matches_live_duration():
    assert SESSION_SECONDS == 8 * 60
    assert MAX_AUDIO_BYTES == SESSION_SECONDS * 16_000 * 2
    assert MAX_OUTPUT_BYTES == SESSION_SECONDS * 24_000 * 2


def test_reserved_lease_includes_handshake_margin(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    identity = _bind(db, LiveIdentity(str(account[0]), account[1], account[2]),
                     'long-voice-lease', None)
    assert identity is not None
    session_id = str(uuid4())
    assert _reserve(db, identity, session_id, digest(account[3]))
    with db.connect() as connection:
        remaining = connection.execute('''SELECT extract(epoch FROM expires_at-now()) AS seconds
            FROM uony_live_sessions WHERE user_id=%s''', (account[0],)).fetchone()['seconds']
    assert remaining > SESSION_SECONDS + 90
    _release(db, identity, session_id)


def test_session_deadline_closes_without_starting_work(environment, monkeypatch, caplog):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    monkeypatch.setattr('app.uony_live_bridge.SESSION_SECONDS', 0.05)
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as websocket:
            bind(websocket, 'deadline-thread')
            with pytest.raises(WebSocketDisconnect) as expired:
                websocket.receive_json()
            assert expired.value.code == 4000
    assert 'reason=deadline' in caplog.text
    assert 'bridge_ws_code=4000' in caplog.text
    assert fake.sessions[0].closed
    assert work_counts(db) == (0, 0, 0)


def test_deadline_starts_after_live_is_ready(environment, monkeypatch):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    original_open = fake.open

    async def delayed_open(identity):
        await asyncio.sleep(0.35)
        return await original_open(identity)

    monkeypatch.setattr(fake, 'open', delayed_open)
    monkeypatch.setattr('app.uony_live_bridge.SESSION_SECONDS', 0.3)
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as websocket:
            bind(websocket, 'ready-start-thread')
            websocket.send_bytes(b'\x00\x00')
            assert websocket.receive_json()['type'] == 'ordinary_audio'
            assert websocket.receive_bytes() == b'\x00\x00'
    assert fake.sessions[0].closed


def test_bind_must_precede_provider_and_deleted_thread_cannot_reopen(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with db.connect() as connection:
        connection.execute('''INSERT INTO uony_threads(user_id,id,title,deleted_at)
            VALUES(%s,%s,%s,now())''', (account[0], 'deleted-voice-thread', ''))
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        for invalid in ({'type': 'interrupt'}, {'type': 'bind', 'threadId': '../wrong'},
                        {'type': 'bind', 'threadId': 'deleted-voice-thread'},
                        {'type': 'bind', 'threadId': 'valid', 'padding': 'x' * 200}):
            with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
                ws.send_json(invalid)
                with pytest.raises(WebSocketDisconnect) as rejected:
                    ws.receive_json()
                assert rejected.value.code == 1008
    assert fake.opened == []
    assert work_counts(db) == (0, 0, 0)


def test_thread_deleted_between_bind_and_reserve_never_opens_provider(environment,
                                                                      monkeypatch):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()

    def erase_after_bind(database, identity, thread_id, project_id):
        bound = _bind(database, identity, thread_id, project_id)
        assert bound is not None
        with database.connect() as connection:
            connection.execute('''UPDATE uony_threads SET deleted_at=now()
                WHERE user_id=%s AND id=%s''', (identity.user_id, thread_id))
        return bound

    monkeypatch.setattr('app.uony_live_bridge._bind', erase_after_bind)
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as websocket:
            websocket.send_json({'type': 'bind', 'threadId': 'deleted-during-bind',
                                 'projectId': None})
            with pytest.raises(WebSocketDisconnect) as rejected:
                websocket.receive_json()
            assert rejected.value.code == 1013
    assert fake.opened == []
    with db.connect() as connection:
        assert connection.execute('SELECT count(*) AS n FROM uony_live_sessions').fetchone()['n'] == 0
        assert connection.execute('SELECT count(*) AS n FROM uony_live_usage').fetchone()['n'] == 0


def test_one_active_session_per_account_and_global_limit_release(environment, monkeypatch):
    config, provider, db = environment
    accounts = account_setup(config, provider, db)
    enabled = replace(config, live_pilot_user_ids=tuple(str(row[0]) for row in accounts))
    monkeypatch.setattr('app.uony_live_bridge.MAX_ACTIVE_SESSIONS', 1)
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, accounts[0][3])) as first:
            bind(first, 'reserved-thread')
            for account in accounts:
                with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as second:
                    second.send_json({'type': 'bind', 'threadId': 'another-thread',
                                      'projectId': None})
                    with pytest.raises(WebSocketDisconnect) as rejected:
                        second.receive_json()
                    assert rejected.value.code == 1013
            assert len(fake.opened) == 1
        with client.websocket_connect('/api/uony/live', headers=headers(config, accounts[1][3])) as after:
            bind(after, 'after-release-thread')
        assert len(fake.opened) == 2
    with db.connect() as connection:
        assert connection.execute('SELECT count(*) AS n FROM uony_live_sessions').fetchone()['n'] == 0
    assert work_counts(db) == (0, 0, 0)


def test_reservation_is_durable_and_idempotently_released(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    identity = _bind(db, LiveIdentity(str(account[0]), account[1], account[2]),
                     'reservation-thread', None)
    assert identity is not None
    first, second = str(uuid4()), str(uuid4())
    assert _reserve(db, identity, first, digest(account[3])) is True
    assert _reserve(db, identity, second, digest(account[3])) is False
    _release(db, identity, first)
    _release(db, identity, first)
    with db.connect() as connection:
        assert connection.execute('SELECT count(*) AS n FROM uony_live_sessions').fetchone()['n'] == 0
        receipt = connection.execute('''SELECT state FROM uony_live_usage
            WHERE user_id=%s AND session_id=%s''', (account[0], first)).fetchone()
        assert receipt['state'] == 'unknown'


def test_final_voice_turns_survive_reconnect_and_are_erased_with_thread(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    thread_id = 'voice-history-thread'
    user_turn, assistant_turn = str(uuid4()), str(uuid4())
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            first = bind(ws, thread_id)
            fake.sessions[0].emit(LiveTranscript('user', user_turn, 'Quiero crear una lámpara.'))
            assert ws.receive_json() == {'type': 'transcript', 'role': 'user',
                'turnId': user_turn, 'text': 'Quiero crear una lámpara.', 'final': True}
            fake.sessions[0].emit(LiveTranscript('assistant', assistant_turn,
                                                '¿Tienes materiales o empezamos de cero?'))
            assert ws.receive_json() == {'type': 'transcript', 'role': 'assistant',
                'turnId': assistant_turn, 'text': '¿Tienes materiales o empezamos de cero?',
                'final': True, 'replyToTurnId': None}
        assert _save_transcript(db, fake.opened[0], first['sessionId'],
                                LiveTranscript('user', user_turn,
                                               'Quiero crear una lámpara.')) is False
        with pytest.raises(ValueError, match='conflicting Live transcript'):
            _save_transcript(db, fake.opened[0], first['sessionId'],
                             LiveTranscript('user', user_turn, 'Otra solicitud'))
        with db.connect() as connection:
            assert connection.execute('''SELECT count(*) AS n FROM uony_live_turns
                WHERE user_id=%s AND thread_id=%s''',
                (account[0], thread_id)).fetchone()['n'] == 2
        history = client.get('/api/uony/threads', headers=headers(config, account[3]))
        assert history.status_code == 200
        saved = next(item for item in history.json()['threads'] if item['id'] == thread_id)
        assert [(item['role'], item['text']) for item in saved['messages']] == [
            ('user', 'Quiero crear una lámpara.'),
            ('assistant', '¿Tienes materiales o empezamos de cero?')]
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            resumed = bind(ws, thread_id)
            assert resumed['sessionId'] != first['sessionId']
            assert 'Quiero crear una lámpara.' in fake.opened[-1].context
        assert client.delete(f'/api/uony/threads/{thread_id}',
                             headers=headers(config, account[3])).status_code == 200
        with pytest.raises(ValueError, match='thread unavailable'):
            _save_transcript(db, fake.opened[0], first['sessionId'],
                             LiveTranscript('user', str(uuid4()), 'No debe reaparecer'))
        with db.connect() as connection:
            assert connection.execute('''SELECT count(*) AS n FROM uony_live_turns
                WHERE user_id=%s AND thread_id=%s''',
                (account[0], thread_id)).fetchone()['n'] == 0
        assert all(item['id'] != thread_id for item in client.get('/api/uony/threads',
                   headers=headers(config, account[3])).json()['threads'])
    assert work_counts(db) == (0, 0, 0)


def test_only_owner_bound_read_only_work_tool_is_executed(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with db.connect() as connection:
        connection.execute('''INSERT INTO uony_assignments
            (user_id,id,google_subject,origin_request_id,origin_thread_id,label,objective)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (account[0], uuid4(), account[1], uuid4(), 'source-thread',
             'Lámpara', 'Preparar la ficha de la lámpara'))
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bind(ws, 'work-status-thread')
            session = fake.sessions[0]
            session.emit(LiveToolCall('read-1', 'get_current_work', {}))
            assert session.tool_response_event.wait(timeout=3)
            assert session.tool_responses == [('read-1', 'get_current_work', {
                'status': 'ok', 'retryable': False,
                'scope': 'account_assignments_and_thread_handoff',
                'assignmentScope': 'account', 'latestHandoffScope': 'current_thread',
                'driveChecked': False,
                'message': 'Encargos de la cuenta y último traspaso de esta conversación.',
                'assignments': [{'label': 'Lámpara', 'status': 'pending',
                                 'nextStep': 'clarify_source'}],
                'latestHandoff': None})]
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bind(ws, 'work-status-thread')
            fake.sessions[-1].emit(LiveToolCall('forged', 'publish_product', {}))
            with pytest.raises(WebSocketDisconnect) as rejected:
                ws.receive_json()
            assert rejected.value.code == 1011
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bind(ws, 'work-status-thread')
            fake.sessions[-1].emit(LiveToolCall('forged', 'get_current_work', {'userId': str(uuid4())}))
            with pytest.raises(WebSocketDisconnect) as rejected:
                ws.receive_json()
            assert rejected.value.code == 1011
    assert all(not session.tool_responses for session in fake.sessions[1:])
    assert work_counts(db) == (0, 0, 0)


def test_live_tool_calls_are_blocked_after_two_without_stopping_voice(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bind(ws, 'tool-cap-thread')
            session = fake.sessions[0]
            for index in range(3):
                session.tool_response_event.clear()
                session.emit(LiveToolCall(f'read-{index}', 'get_current_work', {}))
                assert session.tool_response_event.wait(timeout=3)
                assert len(session.tool_responses) == index + 1
            assert session.tool_responses[-1][2] == {
                'status': 'blocked', 'reason': 'tool_call_limit'}
            assert all(response[2]['status'] == 'no_results'
                       and response[2]['retryable'] is False
                       and response[2]['scope'] == 'account_assignments_and_thread_handoff'
                       and response[2]['assignmentScope'] == 'account'
                       and response[2]['latestHandoff'] is None
                       and response[2]['driveChecked'] is False
                       and response[2]['message'] for response in session.tool_responses[:2])
            turn_id = str(uuid4())
            session.emit(LiveTranscript('user', turn_id, 'Seguimos hablando.'))
            assert ws.receive_json()['turnId'] == turn_id
    assert work_counts(db) == (0, 0, 0)


def test_usage_receipt_is_saved_as_observed_and_may_be_partial(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    counts = {'promptTokenCount': 30, 'candidatesTokenCount': 12,
              'totalTokenCount': 42}
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bound = bind(ws, 'usage-thread')
            fake.sessions[0].emit(LiveUsage(counts))
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                with db.connect() as connection:
                    receipt = connection.execute('''SELECT state,usage FROM uony_live_usage
                        WHERE user_id=%s AND session_id=%s''',
                        (account[0], bound['sessionId'])).fetchone()
                if receipt and receipt['state'] == 'observed':
                    break
                time.sleep(0.02)
            assert receipt['state'] == 'observed' and receipt['usage'] == counts
    with db.connect() as connection:
        saved = connection.execute('''SELECT state,usage FROM uony_live_usage
            WHERE user_id=%s AND session_id=%s''',
            (account[0], bound['sessionId'])).fetchone()
        assert saved['state'] == 'observed' and saved['usage'] == counts
    assert work_counts(db) == (0, 0, 0)


def test_revoking_cloud_scope_closes_voice_without_starting_work(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bound = bind(ws, 'revoked-thread')
            with db.connect() as connection:
                connection.execute('''UPDATE google_cloud_connections SET scope='openid email'
                    WHERE user_id=%s''', (account[0],))
            with pytest.raises(WebSocketDisconnect) as revoked:
                ws.receive_json()
            assert revoked.value.code == 1008
    assert fake.sessions[0].closed
    with db.connect() as connection:
        assert connection.execute('SELECT count(*) AS n FROM uony_live_sessions').fetchone()['n'] == 0
        receipt = connection.execute('''SELECT state FROM uony_live_usage
            WHERE user_id=%s AND session_id=%s''',
            (account[0], bound['sessionId'])).fetchone()
        assert receipt['state'] == 'unknown'
    assert work_counts(db) == (0, 0, 0)


def test_logout_revokes_an_open_voice_socket(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as ws:
            bind(ws, 'logout-thread')
            result = client.post('/api/auth/logout', headers=headers(config, account[3]))
            assert result.status_code == 200
            with pytest.raises(WebSocketDisconnect) as revoked:
                ws.receive_json()
            assert revoked.value.code == 1008
    assert fake.sessions[0].closed
    assert work_counts(db) == (0, 0, 0)


def test_logout_during_provider_open_never_advertises_ready(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))

    class RevokedWhileOpening(FakeLive):
        async def open(self, identity):
            with db.connect() as connection:
                connection.execute('DELETE FROM sessions WHERE user_id=%s',
                                   (account[0],))
            return await super().open(identity)

    fake = RevokedWhileOpening()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as ws:
            ws.send_json({'type': 'bind', 'threadId': 'open-revoked',
                          'projectId': None})
            bound = ws.receive_json()
            assert bound['type'] == 'bound'
            ws.send_json({'type': 'ready', 'sessionId': bound['sessionId']})
            with pytest.raises(WebSocketDisconnect) as revoked:
                ws.receive_json()
            assert revoked.value.code == 1008
    assert fake.sessions[0].closed
    assert work_counts(db) == (0, 0, 0)
