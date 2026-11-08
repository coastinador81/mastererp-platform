"""Local PostgreSQL and simulated Redis; no provider requests or client data."""
import json
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.uony_session_cache import RedisSessionCache, cache_key
from app.uony_session_continuity import SessionContinuity, SessionSuperseded


class MemoryRedis:
    def __init__(self):
        self.data = {}
        self.failed = False

    def _check(self):
        if self.failed:
            raise ConnectionError('simulated outage')

    def get(self, key):
        self._check()
        return self.data.get(key)

    def set(self, key, value, ex):
        self._check()
        assert ex == 86400
        self.data[key] = value

    def delete(self, key):
        self._check()
        self.data.pop(key, None)

    def eval(self, script, keys, key, value, version, ttl):
        self._check()
        previous = json.loads(self.data[key]) if key in self.data else None
        if previous and previous['version'] > version:
            return 0
        self.set(key, value, ttl)
        return 1


@pytest.fixture
def continuity(environment):
    _, _, db = environment
    db.migrate()
    owner, other, session = uuid4(), uuid4(), uuid4()
    with db.connect() as c:
        for user in (owner, other):
            c.execute('''INSERT INTO users(id,google_subject,email)
                VALUES(%s,%s,'fixture@example.test')''', (user, str(user)))
            for thread in ('1er-producto', 'other-thread'):
                c.execute('''INSERT INTO uony_threads(user_id,id,title)
                    VALUES(%s,%s,'Synthetic session')''', (user, thread))
        c.execute('''INSERT INTO uony_live_sessions(user_id,session_id,thread_id,expires_at)
            VALUES(%s,%s,'1er-producto',now()+interval '5 minutes')''', (owner, session))
    redis = MemoryRedis()
    store = SessionContinuity(db, RedisSessionCache(redis))
    return store, redis, str(owner), str(other), str(session)


def _request(store, user, thread='1er-producto'):
    request = str(uuid4())
    with store.database.connect() as c:
        c.execute('''INSERT INTO uony_requests
            (user_id,request_id,thread_id,prompt,status,model,project_id)
            VALUES(%s,%s,%s,'fixture','running','fixture','fixture')''',
            (user, request, thread))
    return request


def test_recovery_persists_references_only(continuity):
    store, redis, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    turn, event, request = str(uuid4()), str(uuid4()), _request(store, owner)
    saved = store.checkpoint(lease, turn_id=turn, request_id=request,
                            event_id=event, delivery_state='sent')
    restored = store.restore(owner, '1er-producto')
    assert saved == {k: v for k, v in restored.items() if k != 'work'}
    assert restored['state']['activeTurnId'] == turn
    assert restored['state']['events'][0]['state'] == 'sent'
    assert restored['state']['events'][0]['sequence'] == 2
    assert 'prompt' not in json.dumps(restored)
    assert 'token' not in json.dumps(redis.data)
    with pytest.raises(TypeError):
        store.checkpoint(lease, access_token='forbidden')


def test_cache_outage_does_not_lose_checkpoint_or_change_owner(continuity):
    store, redis, owner, _, session = continuity
    redis.failed = True
    lease = store.acquire(owner, '1er-producto', session)
    turn = str(uuid4())
    store.checkpoint(lease, turn_id=turn)
    assert store.is_current(lease)
    assert store.restore(owner, '1er-producto')['state']['activeTurnId'] == turn
    assert store.cache.available is False
    redis.failed = False
    restored = store.restore(owner, '1er-producto')
    assert store.cache.available is True
    assert store.cache.get(owner, '1er-producto')['version'] == restored['version']


@pytest.mark.parametrize('version', [0, 1000000])
def test_stale_or_ahead_cache_never_overrides_postgres(continuity, version):
    store, redis, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    expected = store.checkpoint(lease, turn_id=str(uuid4()))
    corrupt = {**expected, 'version': version, 'state': {'permission': True}}
    redis.data[cache_key(owner, '1er-producto')] = json.dumps(corrupt)
    restored = store.restore(owner, '1er-producto')
    assert restored['state'] == expected['state']
    assert store.cache.get(owner, '1er-producto') == expected


def test_late_cache_writer_cannot_overwrite_new_version(continuity):
    store, _, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    earlier = store.checkpoint(lease, turn_id=str(uuid4()))
    later = store.checkpoint(lease, turn_id=str(uuid4()))
    store.cache.put(earlier)
    assert store.cache.get(owner, '1er-producto') == later


def test_reconnection_fences_old_writer_and_retains_work_refs(continuity):
    store, _, owner, _, session = continuity
    old = store.acquire(owner, '1er-producto', session)
    turn, request = str(uuid4()), _request(store, owner)
    store.checkpoint(old, turn_id=turn, request_id=request)
    new_session = str(uuid4())
    with store.database.connect() as c:
        c.execute('UPDATE uony_live_sessions SET session_id=%s WHERE user_id=%s',
                  (new_session, owner))
    current = store.acquire(owner, '1er-producto', new_session)
    assert current.fence == old.fence + 1
    assert not store.is_current(old) and store.is_current(current)
    with pytest.raises(SessionSuperseded):
        store.checkpoint(old, turn_id=str(uuid4()))
    assert store.close(old) is False
    assert store.restore(owner, '1er-producto')['state']['requests'][0]['requestId'] == request


def test_other_account_or_thread_cannot_restore_or_acquire(continuity):
    store, _, owner, other, session = continuity
    store.acquire(owner, '1er-producto', session)
    assert store.restore(other, '1er-producto') is None
    assert store.restore(owner, 'other-thread') is None
    for user, thread in ((other, '1er-producto'), (owner, 'other-thread')):
        with pytest.raises(SessionSuperseded):
            store.acquire(user, thread, session)


def test_expired_reservation_never_becomes_valid_via_cache(continuity):
    store, _, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    with store.database.connect() as c:
        c.execute("UPDATE uony_live_sessions SET expires_at=now()-interval '1 second'")
    assert not store.is_current(lease)
    with pytest.raises(SessionSuperseded):
        store.checkpoint(lease, turn_id=str(uuid4()))
    with pytest.raises(SessionSuperseded):
        store.acquire(owner, '1er-producto', session)


def test_foreign_request_reference_is_rejected(continuity):
    store, _, owner, other, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    for request in (_request(store, other), _request(store, owner, 'other-thread')):
        with pytest.raises(ValueError, match='outside_session_scope'):
            store.checkpoint(lease, request_id=request)


def test_ack_is_sticky_and_event_scope_cannot_change(continuity):
    store, _, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    turn, event = str(uuid4()), str(uuid4())
    store.checkpoint(lease, turn_id=turn, event_id=event, delivery_state='acknowledged')
    value = store.checkpoint(lease, turn_id=turn, event_id=event, delivery_state='sent')
    assert value['state']['events'][0]['state'] == 'acknowledged'
    with pytest.raises(ValueError, match='scope_changed'):
        store.checkpoint(lease, turn_id=str(uuid4()), event_id=event, delivery_state='sent')


def test_concurrent_checkpoints_keep_all_event_refs(continuity):
    store, _, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    def save(_):
        return store.checkpoint(lease, event_id=str(uuid4()), delivery_state='pending')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(save, range(12)))
    snapshot = store.restore(owner, '1er-producto')
    assert snapshot['version'] == 13
    assert len(snapshot['state']['events']) == 12
    assert len({event['sequence'] for event in snapshot['state']['events']}) == 12


def test_deleted_thread_cannot_rehydrate_cache_and_cascades_metadata(continuity):
    store, redis, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    with store.database.connect() as c:
        c.execute('DELETE FROM uony_threads WHERE user_id=%s AND id=%s',
                  (owner, '1er-producto'))
        assert not c.execute('SELECT 1 FROM uony_session_continuity').fetchone()
    assert store.restore(owner, '1er-producto') is None
    assert not redis.data
    assert not store.is_current(lease)


def test_deleted_account_is_not_restored_from_cache(continuity):
    store, _, owner, _, session = continuity
    lease = store.acquire(owner, '1er-producto', session)
    with store.database.connect() as c:
        c.execute('UPDATE users SET deletion_requested_at=now() WHERE id=%s', (owner,))
    assert store.restore(owner, '1er-producto') is None
    assert not store.is_current(lease)
    assert not store.close(lease)


def test_invalid_cache_payload_and_scope_keys_are_isolated():
    redis = MemoryRedis()
    cache = RedisSessionCache(redis)
    key = cache_key('a', 'bc')
    assert key != cache_key('ab', 'c')
    for raw in ('invalid-json', '[]', 'x' * 65537):
        redis.data[key] = raw
        assert cache.get('a', 'bc') is None


def test_work_recovers_even_when_process_died_before_checkpoint(continuity):
    store, _, owner, _, session = continuity
    store.acquire(owner, '1er-producto', session)
    request, turn = _request(store, owner), str(uuid4())
    with store.database.connect() as c:
        c.execute('''INSERT INTO uony_live_turns
            (user_id,thread_id,session_id,turn_id,role,text)
            VALUES(%s,'1er-producto',%s,%s,'user','Synthetic command')''',
            (owner, session, turn))
        c.execute('''INSERT INTO uony_live_handoffs
            (user_id,thread_id,session_id,turn_id,request_id,google_subject,
             google_project_id,intent)
            VALUES(%s,'1er-producto',%s,%s,%s,%s,'fixture','use_drive_materials')''',
            (owner, session, turn, request, owner))
        c.execute('''INSERT INTO uony_conversation_jobs
            (user_id,request_id,thread_id,google_subject,project_id,payload,status)
            VALUES(%s,%s,'1er-producto',%s,'fixture','{}','queued')''',
            (owner, request, owner))
    recovered = store.restore(owner, '1er-producto')
    assert recovered['state']['requests'] == []
    assert recovered['work'] == [{'requestId': request, 'turnId': turn,
                                  'sessionId': session, 'status': 'queued'}]
    with store.database.connect() as c:
        c.execute("UPDATE uony_conversation_jobs SET status='success'")
    assert store.restore(owner, '1er-producto')['work'][0]['status'] == 'success'
