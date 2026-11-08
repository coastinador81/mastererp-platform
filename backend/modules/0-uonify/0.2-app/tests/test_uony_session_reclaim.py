"""Orphan reservation recovery; never retry a provider or refund pilot usage."""
from dataclasses import replace
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.security import digest
from app.main import create_app
from app.uony_live_bridge import LiveIdentity, _bind, _reserve, _session_allowed
from app.uony_session_cache import RedisSessionCache
from app.uony_session_continuity import SessionContinuity, SessionSuperseded
from app.uony_session_transport import (SessionOutputGuard, OUTPUT_GRACE_SECONDS,
                                         RECLAIM_AFTER_SECONDS)
from test_uony_live_bridge import account_setup, work_counts, FakeLive, bind, headers


@pytest.fixture
def reserved(environment):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    identity = _bind(db, LiveIdentity(str(account[0]), account[1], account[2]),
                     '1er-producto-reclaim', None)
    token, session = digest(account[3]), str(uuid4())
    assert _reserve(db, identity, session, token)
    store = SessionContinuity(db, RedisSessionCache())
    lease = store.acquire(identity.user_id, identity.thread_id, session,
        google_subject=identity.google_subject, google_project_id=identity.project_id)
    return db, identity, token, session, store, lease


def _stale(db, seconds=31):
    with db.connect() as c:
        c.execute("UPDATE uony_live_sessions SET heartbeat_at=now()-(%s*interval '1 second')", (seconds,))


def test_live_owner_blocks_takeover_until_stale(reserved):
    db, identity, token, session, store, lease = reserved
    assert not _reserve(db, identity, str(uuid4()), token)
    _stale(db, 25)
    assert not _reserve(db, identity, str(uuid4()), token)
    assert store.heartbeat(lease)
    assert _session_allowed(db, identity, session, token)
    with db.connect() as c:
        age = c.execute('''SELECT extract(epoch FROM now()-heartbeat_at) AS age
            FROM uony_live_sessions''').fetchone()['age']
        assert age < 2


def test_orphan_reclaimed_with_new_receipt_and_old_owner_fenced(reserved):
    db, identity, token, session, store, lease = reserved
    _stale(db)
    new = str(uuid4())
    assert _reserve(db, identity, new, token)
    current = store.acquire(identity.user_id, identity.thread_id, new,
        google_subject=identity.google_subject, google_project_id=identity.project_id)
    assert current.fence > lease.fence
    assert not _session_allowed(db, identity, session, token)
    assert _session_allowed(db, identity, new, token)
    assert not store.is_current(lease)
    with pytest.raises(SessionSuperseded):
        store.heartbeat(lease)
    assert not store.close(lease)
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM uony_live_pilot_admissions').fetchone()['n'] == 2
        old = c.execute('SELECT state FROM uony_live_usage WHERE session_id=%s', (session,)).fetchone()
        assert old['state'] == 'unknown'
    assert work_counts(db) == (0, 0, 0)


def test_orphan_reclaim_does_not_refund_exhausted_pilot(reserved):
    db, identity, token, session, _, _ = reserved
    _stale(db)
    assert not _reserve(db, identity, str(uuid4()), token, session_limit=1)
    with db.connect() as c:
        assert str(c.execute('SELECT session_id FROM uony_live_sessions').fetchone()['session_id']) == session


def test_global_capacity_excludes_orphan_without_starting_jobs(reserved, monkeypatch):
    db, identity, token, _, _, _ = reserved
    monkeypatch.setattr('app.uony_live_bridge.MAX_ACTIVE_SESSIONS', 1)
    _stale(db)
    assert _reserve(db, identity, str(uuid4()), token)
    assert work_counts(db) == (0, 0, 0)


def test_orphan_reclaim_requires_current_cookie_and_cloud(reserved):
    db, identity, token, _, _, _ = reserved
    _stale(db)
    assert not _reserve(db, identity, str(uuid4()), 'wrong-session-hash')
    wrong_cloud = replace(identity, project_id='another-project')
    assert not _reserve(db, wrong_cloud, str(uuid4()), token)
    with db.connect() as c:
        c.execute("UPDATE google_cloud_connections SET status='reauthorize' WHERE user_id=%s", (identity.user_id,))
    assert not _reserve(db, identity, str(uuid4()), token)


def test_expired_heartbeat_cannot_be_revived(reserved):
    db, identity, token, session, store, lease = reserved
    _stale(db)
    assert not store.is_current(lease)
    assert not _session_allowed(db, identity, session, token)
    with pytest.raises(SessionSuperseded):
        store.heartbeat(lease)


def test_output_expires_before_server_can_reclaim():
    now = [100.0]
    guard = SessionOutputGuard(clock=lambda: now[0])
    guard.check()
    assert OUTPUT_GRACE_SECONDS < RECLAIM_AFTER_SECONDS
    now[0] += OUTPUT_GRACE_SECONDS
    with pytest.raises(ValueError, match='heartbeat_expired'):
        guard.check()
    guard.confirm(now[0])
    guard.check()
    guard.stop()
    with pytest.raises(ValueError):
        guard.check()


def test_cloud_change_never_restores_old_session_references(reserved):
    db, identity, _, _, store, lease = reserved
    turn = str(uuid4())
    store.checkpoint(lease, turn_id=turn)
    assert store.restore(identity.user_id, identity.thread_id,
        google_subject=identity.google_subject, google_project_id=identity.project_id)['state']['activeTurnId'] == turn
    with db.connect() as c:
        c.execute('UPDATE google_cloud_connections SET project_id=%s WHERE user_id=%s',
                  ('new-cloud', identity.user_id))
    assert store.restore(identity.user_id, identity.thread_id,
        google_subject=identity.google_subject, google_project_id=identity.project_id) is None
    assert store.restore(identity.user_id, identity.thread_id,
        google_subject=identity.google_subject, google_project_id='new-cloud') is None
    store.acquire(identity.user_id, identity.thread_id, lease.session_id,
        google_subject=identity.google_subject, google_project_id='new-cloud')
    assert store.restore(identity.user_id, identity.thread_id,
        google_subject=identity.google_subject, google_project_id='new-cloud')['state']['activeTurnId'] is None


def test_live_route_heartbeats_and_releases_snapshot(environment, monkeypatch):
    config, provider, db = environment
    account = account_setup(config, provider, db)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),))
    monkeypatch.setattr('app.uony_live_routes.HEARTBEAT_INTERVAL_SECONDS', 0.02)
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake), base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live', headers=headers(config, account[3])) as ws:
            bound = bind(ws, 'heartbeat-route')
            time.sleep(0.15)
            ws.send_bytes(b'\x00\x00')
            assert ws.receive_json()['type'] == 'ordinary_audio'
            assert ws.receive_bytes() == b'\x00\x00'
            with db.connect() as c:
                row = c.execute('SELECT version,active,session_id FROM uony_session_continuity').fetchone()
                assert row['version'] > 1 and row['active']
                assert str(row['session_id']) == bound['sessionId']
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM uony_live_sessions').fetchone()
            assert not c.execute('SELECT active FROM uony_session_continuity').fetchone()['active']
    assert len(fake.opened) == 1
