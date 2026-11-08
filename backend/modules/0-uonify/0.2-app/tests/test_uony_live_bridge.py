"""Local-only Live bridge contract; no Google requests or paid model calls."""
import asyncio
from dataclasses import replace
import json
from threading import Event
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from starlette.websockets import WebSocketDisconnect

import app.uony_live_bridge as live_bridge
from app.main import create_app
from app.google_cloud_provider import SCOPE
from app.security import SESSION_COOKIE, digest
from app.settings import load_settings
from app.uony_live_bridge import (LiveAudio, LiveInterrupted, LiveToolCall,
                                  LiveTranscript, LiveUsage, LiveIdentity, _bind, _reserve,
                                  _release, _save_transcript)
from conftest import login
from test_subscription import complete


class FakeSession:
    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.events_queue = asyncio.Queue()
        self.received = []
        self.interruptions = 0
        self.closed = False
        self.tool_responses = []
        self.tool_response_event = Event()

    def emit(self, event):
        if isinstance(event, LiveTranscript) and not event.finalized_by:
            event = replace(event, finalized_by='provider_finished')
        self.loop.call_soon_threadsafe(self.events_queue.put_nowait, event)

    async def send_audio(self, pcm):
        self.received.append(pcm)
        await self.events_queue.put(LiveAudio(pcm))

    async def interrupt(self):
        self.interruptions += 1
        await self.events_queue.put(LiveInterrupted())

    async def respond_tool(self, call_id, name, response, scheduling=None):
        self.tool_responses.append((call_id, name, response))
        self.tool_response_event.set()

    async def send_system_context(self, text):
        self.received.append(('system_context', text))

    async def events(self):
        while True:
            yield await self.events_queue.get()

    async def close(self):
        self.closed = True


class FakeLive:
    def __init__(self):
        self.opened = []
        self.sessions = []

    async def open(self, identity):
        self.opened.append(identity)
        session = FakeSession()
        self.sessions.append(session)
        return session


def account_setup(config, provider, db):
    accounts = []
    with TestClient(create_app(config, provider=provider), base_url=config.origin) as client:
        client.headers['Origin'] = config.origin
        for number in (1, 2):
            provider.subject = f'live-test-{number}'
            provider.email = f'live-{number}@example.test'
            login(client, provider)
            cookie = client.cookies.get(SESSION_COOKIE)
            complete(client)
            with db.connect() as connection:
                user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                          (provider.subject,)).fetchone()
                connection.execute('UPDATE users SET onboarding_completed_at=now() WHERE id=%s',
                                   (user['id'],))
                connection.execute('''INSERT INTO access_periods
                    (id,user_id,kind,starts_at,ends_at,source_reference)
                    VALUES (%s,%s,'trial',now(),now()+interval '1 day',%s)''',
                    (uuid4(), user['id'], f'live-fixture-{number}'))
                connection.execute('''INSERT INTO google_cloud_connections
                    (user_id,google_subject,email,refresh_encrypted,scope,status,project_id,project_check)
                    VALUES (%s,%s,%s,'fixture-encrypted',%s,'connected',%s,%s)''',
                    (user['id'], provider.subject, provider.email, SCOPE, f'live-project-{number}',
                     Jsonb({'ready': True})))
            accounts.append((user['id'], provider.subject, f'live-project-{number}', cookie))
            # A new login from the same browser invalidates its previous session.
            # Separate the two test browsers so both account tokens remain valid.
            client.cookies.clear()
    return accounts


def headers(config, cookie=None, origin=None, **extra):
    result = {'origin': config.origin if origin is None else origin,
              'host': '127.0.0.1:5173'}
    if cookie:
        result['cookie'] = f'{SESSION_COOKIE}={cookie}'
    result.update(extra)
    return result


def work_counts(db):
    with db.connect() as connection:
        return tuple(connection.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n']
                     for table in ('uony_requests', 'uony_conversation_jobs', 'product_material_jobs'))


def denied(client, config, cookie=None, origin=None, path='/api/uony/live', **extra):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(path, headers=headers(config, cookie, origin, **extra)):
            pass


def bind(websocket, thread_id, project_id=None):
    websocket.send_json({'type': 'bind', 'threadId': thread_id,
                         'projectId': str(project_id) if project_id else None})
    bound = websocket.receive_json()
    assert bound['type'] == 'bound' and bound['threadId'] == thread_id
    assert isinstance(bound['sessionId'], str) and bound['sessionId']
    websocket.send_json({'type': 'ready', 'sessionId': bound['sessionId']})
    assert websocket.receive_json() == {
        'type': 'status', 'state': 'ready',
        'audioProtocol': 'scoped-v1',
        'inputFormat': 'pcm_s16le_16000', 'outputFormat': 'pcm_s16le_24000'}
    return bound


def test_real_live_pilot_file_requires_an_explicit_paid_session_limit(tmp_path, monkeypatch):
    pilot = str(uuid4())
    (tmp_path / 'google-oauth.json').write_text(json.dumps({'web': {}}))
    (tmp_path / 'postgres-password').write_text('test-only')
    (tmp_path / 'encryption-key').write_text('test-only')
    file = tmp_path / 'live-pilot-users.json'
    monkeypatch.setenv('UONIFY_SECRETS_DIR', str(tmp_path))
    file.write_text(json.dumps({'userIds': [pilot], 'sessionLimit': 1}))
    config = load_settings()
    assert config.live_pilot_user_ids == (pilot,)
    assert config.live_pilot_session_limit == 1
    for invalid in ({'userIds': [pilot]},
                    {'userIds': [pilot], 'sessionLimit': 0},
                    {'userIds': [pilot], 'sessionLimit': True},
                    {'userIds': [pilot, pilot], 'sessionLimit': 1}):
        file.write_text(json.dumps(invalid))
        with pytest.raises(RuntimeError, match='piloto live-pilot-users.json'):
            load_settings()


def test_single_live_admission_is_durable_after_disconnect_and_api_restart(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as first:
            bind(first, 'single-live-thread')
        status = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert status.status_code == 200
        assert status.json()['liveVoice'] == 'pilot_exhausted'
    # A new API process sees the durable receipt and cannot open Vertex again.
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        status = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert status.json()['liveVoice'] == 'pilot_exhausted'
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect('/api/uony/live',
                                          headers=headers(config, account[3])):
                pass
        assert rejected.value.code == 1008
    assert len(fake.opened) == 1
    with db.connect() as connection:
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_pilot_admissions
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_usage
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_sessions
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
    assert work_counts(db) == (0, 0, 0)


def test_failure_after_reserve_but_before_provider_does_not_spend_pilot(environment,
                                                                        monkeypatch):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)
    fake = FakeLive()
    original = live_bridge._session_allowed
    monkeypatch.setattr(live_bridge, '_session_allowed', lambda *_: False)
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as socket:
            socket.send_json({'type': 'bind', 'threadId': 'pre-provider-stop', 'projectId': None})
            bound = socket.receive_json()
            assert bound['type'] == 'bound'
            socket.send_json({'type': 'ready', 'sessionId': bound['sessionId']})
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1008
        status = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert status.json()['liveVoice'] == 'pilot_ready'
    assert fake.opened == []
    with db.connect() as connection:
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_pilot_admissions
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_usage
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
    monkeypatch.setattr(live_bridge, '_session_allowed', original)
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as socket:
            bind(socket, 'pre-provider-stop')
    assert len(fake.opened) == 1


def test_client_stop_after_bound_does_not_open_vertex_or_spend_pilot(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as socket:
            socket.send_json({'type': 'bind', 'threadId': 'stopped-after-bound', 'projectId': None})
            assert socket.receive_json()['type'] == 'bound'
            socket.close()
        assert client.get('/api/uony/services', headers=headers(config, account[3]))\
            .json()['liveVoice'] == 'pilot_ready'
    assert fake.opened == []
    with db.connect() as connection:
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_pilot_admissions
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_usage
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0


def test_wrong_ready_ack_is_rejected_before_provider(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as socket:
            socket.send_json({'type': 'bind', 'threadId': 'wrong-ready', 'projectId': None})
            assert socket.receive_json()['type'] == 'bound'
            socket.send_json({'type': 'ready', 'sessionId': 'different-session'})
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1008
        assert client.get('/api/uony/services', headers=headers(config, account[3]))\
            .json()['liveVoice'] == 'pilot_ready'
    assert fake.opened == []


def test_attempted_provider_keeps_one_shot_when_open_fails(environment, caplog):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)

    class FailingLive:
        async def open(self, identity):
            raise RuntimeError('secret marker must never appear in diagnostics')

    with TestClient(create_app(enabled, provider=provider, live=FailingLive()),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as socket:
            socket.send_json({'type': 'bind', 'threadId': 'provider-open-failure', 'projectId': None})
            bound = socket.receive_json()
            assert bound['type'] == 'bound'
            socket.send_json({'type': 'ready', 'sessionId': bound['sessionId']})
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 1011
        status = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert status.json()['liveVoice'] == 'pilot_exhausted'
    assert 'secret marker' not in caplog.text
    with db.connect() as connection:
        assert connection.execute('''SELECT count(*) AS n FROM uony_live_pilot_admissions
            WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
        row = connection.execute('''SELECT state,usage FROM uony_live_usage
            WHERE user_id=%s''', (account[0],)).fetchone()
        assert row['state'] == 'unknown' and row['usage'] == {}


@pytest.mark.parametrize('delete_kind', ('thread', 'project'))
def test_erasing_live_conversation_keeps_opaque_one_shot_receipt(environment, delete_kind):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)
    fake = FakeLive()
    thread_id = 'erased-live-thread'
    project_id = uuid4()
    if delete_kind == 'project':
        with db.connect() as connection:
            connection.execute('''INSERT INTO uony_projects(user_id,id,name)
                VALUES(%s,%s,'Voice test')''', (account[0], project_id))
            connection.execute('''INSERT INTO uony_threads(user_id,id,project_id,title)
                VALUES(%s,%s,%s,'Voice test')''',
                (account[0], thread_id, project_id))
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as first:
            bind(first, thread_id, project_id if delete_kind == 'project' else None)
            fake.sessions[0].emit(LiveTranscript('user', str(uuid4()), 'Hola Uony.'))
            assert first.receive_json()['type'] == 'transcript'
        target = (f'/api/uony/threads/{thread_id}' if delete_kind == 'thread'
                  else f'/api/uony/projects/{project_id}')
        erased = client.delete(target, headers=headers(config, account[3]))
        assert erased.status_code == 200
        with db.connect() as connection:
            assert connection.execute('''SELECT count(*) AS n FROM uony_live_turns
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            assert connection.execute('''SELECT count(*) AS n FROM uony_live_usage
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            assert connection.execute('''SELECT count(*) AS n FROM uony_live_pilot_admissions
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
        status = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert status.status_code == 200
        assert status.json()['liveVoice'] == 'pilot_exhausted'
        denied(client, config, account[3])
    assert len(fake.opened) == 1
    assert work_counts(db) == (0, 0, 0)


def test_bridge_is_closed_by_default_and_requires_session_origin_and_server_project(environment):
    config, provider, db = environment
    accounts = account_setup(config, provider, db)
    fake = FakeLive()
    with TestClient(create_app(config, provider=provider, live=fake), base_url=config.origin) as client:
        denied(client, config, accounts[0][3])
    assert fake.opened == []

    one_account = replace(config, live_pilot_user_ids=(str(accounts[0][0]),))
    with TestClient(create_app(one_account, provider=provider, live=fake), base_url=config.origin) as client:
        denied(client, config, accounts[1][3])

    enabled = replace(config, live_pilot_user_ids=(str(accounts[0][0]), str(accounts[1][0])))
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        denied(client, config)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/uony/live', headers={
                'host': '127.0.0.1:5173', 'cookie': f'{SESSION_COOKIE}={accounts[0][3]}'}):
                pass
        denied(client, config, accounts[0][3], 'https://attacker.example')
        denied(client, config, accounts[0][3], 'null')
        denied(client, config, accounts[0][3], path='/api/uony/live?projectId=forged')
        denied(client, config, accounts[0][3], authorization='Bearer forged')
        with db.connect() as connection:
            connection.execute('''UPDATE google_cloud_connections SET google_subject='other-user'
                WHERE user_id=%s''', (accounts[1][0],))
        denied(client, config, accounts[1][3])
        with db.connect() as connection:
            connection.execute('''UPDATE google_cloud_connections SET scope='openid email'
                WHERE user_id=%s''', (accounts[0][0],))
        denied(client, config, accounts[0][3])
    assert fake.opened == []
    assert work_counts(db) == (0, 0, 0)


def test_services_advertises_live_only_for_a_ready_allowlisted_account(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    fake = FakeLive()
    with TestClient(create_app(config, provider=provider, live=fake),
                    base_url=config.origin) as client:
        ordinary = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert ordinary.status_code == 200
        assert ordinary.json()['liveVoice'] == 'not_integrated'
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        ready = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert ready.status_code == 200
        assert ready.json()['liveVoice'] == 'pilot_ready'
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET scope='openid email' WHERE user_id=%s",
                      (account[0],))
        revoked = client.get('/api/uony/services', headers=headers(config, account[3]))
        assert revoked.status_code == 200
        assert revoked.json()['liveVoice'] == 'not_integrated'


def test_two_accounts_audio_interrupt_disconnect_without_jobs(environment, caplog):
    config, provider, db = environment
    accounts = account_setup(config, provider, db)
    enabled = replace(config, live_pilot_user_ids=tuple(str(row[0]) for row in accounts))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with (client.websocket_connect('/api/uony/live', headers=headers(config, accounts[0][3])) as first,
              client.websocket_connect('/api/uony/live', headers=headers(config, accounts[1][3])) as second):
            bind(first, 'first-voice-thread')
            bind(second, 'second-voice-thread')
            first_pcm, second_pcm = b'\x01\0' * 32, b'\x02\0' * 32
            first.send_bytes(first_pcm)
            second.send_bytes(second_pcm)
            assert second.receive_json()['type'] == 'ordinary_audio'
            assert first.receive_json()['type'] == 'ordinary_audio'
            assert second.receive_bytes() == second_pcm
            assert first.receive_bytes() == first_pcm
            first.send_json({'type': 'interrupt'})
            assert first.receive_json()['phase'] == 'end'
            assert first.receive_json() == {'type': 'interrupted'}
            assert fake.sessions[0].received == [first_pcm]
            assert fake.sessions[1].received == [second_pcm]
            assert fake.sessions[0].interruptions == 1
            assert fake.sessions[1].interruptions == 0
        assert all(session.closed for session in fake.sessions)
    assert [(item.user_id, item.google_subject, item.project_id, item.thread_id)
            for item in fake.opened] == [
        (str(row[0]), row[1], row[2], thread_id) for row,thread_id in zip(
            accounts, ('first-voice-thread', 'second-voice-thread'))]
    assert work_counts(db) == (0, 0, 0)
    assert 'interruptions_sent=1' in caplog.text


def test_rejects_executable_controls_and_oversized_audio(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as websocket:
            bind(websocket, 'controls-thread')
            websocket.send_json({'type': 'tool', 'name': 'analyze_drive'})
            with pytest.raises(WebSocketDisconnect) as denied_control:
                websocket.receive_json()
            assert denied_control.value.code == 1008
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as websocket:
            bind(websocket, 'controls-thread')
            websocket.send_bytes(b'\0' * 8194)
            with pytest.raises(WebSocketDisconnect) as denied_audio:
                websocket.receive_json()
            assert denied_audio.value.code == 1009
    assert all(session.closed for session in fake.sessions)
    assert all(not session.received for session in fake.sessions)
    assert work_counts(db) == (0, 0, 0)
