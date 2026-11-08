"""Opt-in Redis integration tests against a disposable local Redis instance."""
import os

import pytest

from app.uony_session_cache import RedisSessionCache, cache_key
from test_uony_session_continuity import continuity  # noqa: F401

pytestmark = pytest.mark.skipif(not os.environ.get('UONIFY_TEST_SESSION_REDIS_URL'),
    reason='requires an isolated local Redis test instance')


@pytest.fixture
def real_cache(monkeypatch):
    monkeypatch.setenv('UONIFY_SESSION_REDIS_URL', os.environ['UONIFY_TEST_SESSION_REDIS_URL'])
    cache = RedisSessionCache.from_env()
    assert cache.client.ping()
    try:
        yield cache
    finally:
        cache.client.close()


def test_redis_compare_and_set_prevents_late_version(continuity, real_cache):
    store, _, owner, _, session = continuity
    store.cache = real_cache
    try:
        lease = store.acquire(owner, '1er-producto', session)
        previous = store.restore(owner, '1er-producto')
        previous.pop('work')
        latest = store.checkpoint(lease)
        real_cache.put(previous)
        assert real_cache.get(owner, '1er-producto') == latest
        ttl = real_cache.client.ttl(cache_key(owner, '1er-producto'))
        assert 86390 <= ttl <= 86400
    finally:
        real_cache.delete(owner, '1er-producto')


def test_redis_lost_key_rehydrates_from_postgres(continuity, real_cache):
    store, _, owner, _, session = continuity
    store.cache = real_cache
    try:
        store.acquire(owner, '1er-producto', session)
        real_cache.delete(owner, '1er-producto')
        assert real_cache.get(owner, '1er-producto') is None
        restored = store.restore(owner, '1er-producto')
        restored.pop('work')
        assert real_cache.get(owner, '1er-producto') == restored
    finally:
        real_cache.delete(owner, '1er-producto')


def test_redis_outage_falls_back_then_rehydrates(continuity, real_cache):
    from redis import Redis
    from redis.backoff import NoBackoff
    from redis.retry import Retry
    store, _, owner, _, session = continuity
    broken = RedisSessionCache(Redis(host='127.0.0.1', port=1,
        socket_connect_timeout=0.05, socket_timeout=0.05,
        retry=Retry(NoBackoff(), 0)))
    store.cache = broken
    try:
        lease = store.acquire(owner, '1er-producto', session)
        assert broken.available is False
        saved = store.checkpoint(lease)
        assert store.is_current(lease)
        store.cache = real_cache
        restored = store.restore(owner, '1er-producto')
        restored.pop('work')
        assert restored == saved == real_cache.get(owner, '1er-producto')
    finally:
        broken.client.close()
        real_cache.delete(owner, '1er-producto')
