"""Bounded Redis mirror; never an authority for execution or permission."""
import hashlib
import json
import logging
import os

logger = logging.getLogger(__name__)
TTL_SECONDS = 86400
MAX_BYTES = 65536

# PostgreSQL serializes versions. A late cache write cannot overwrite a newer
# mirror. A PostgreSQL restore may lower the version; restore() replaces that
# mirror explicitly after consulting the durable authority.
PUT_NEWER = """
local previous = redis.call('GET', KEYS[1])
if previous then
  local ok, value = pcall(cjson.decode, previous)
  if ok and tonumber(value.version) and tonumber(value.version) > tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
"""


def cache_key(user_id, thread_id):
    digest = hashlib.sha256(f'{user_id}\0{thread_id}'.encode()).hexdigest()
    return f'uony:continuity:v1:{digest}'


class RedisSessionCache:
    def __init__(self, client=None):
        self.client = client
        self.available = client is not None

    @classmethod
    def from_env(cls):
        url = os.environ.get('UONIFY_SESSION_REDIS_URL', '').strip()
        if not url:
            return cls()
        from redis import Redis
        from redis.backoff import NoBackoff
        from redis.retry import Retry
        return cls(Redis.from_url(url, socket_connect_timeout=0.1,
            socket_timeout=0.1, retry=Retry(NoBackoff(), 0),
            decode_responses=True, max_connections=16))

    def _call(self, action):
        if self.client is None:
            return None
        try:
            result = action()
            self.available = True
            return result
        except Exception as error:
            if self.available:
                # Never log URLs, payloads or provider/session credentials.
                logger.warning('session_cache_unavailable error_class=%s',
                               type(error).__name__)
            self.available = False
            return None

    def get(self, user_id, thread_id):
        raw = self._call(lambda: self.client.get(cache_key(user_id, thread_id)))
        if not isinstance(raw, str) or len(raw.encode()) > MAX_BYTES:
            return None
        try:
            value = json.loads(raw)
            return value if isinstance(value, dict) else None
        except (ValueError, TypeError):
            return None

    def put(self, snapshot, *, replace=False):
        raw = json.dumps(snapshot, separators=(',', ':'), sort_keys=True)
        if len(raw.encode()) > MAX_BYTES:
            raise ValueError('continuity_cache_limit')
        key = cache_key(snapshot['userId'], snapshot['threadId'])
        if replace:
            self._call(lambda: self.client.set(key, raw, ex=TTL_SECONDS))
        else:
            self._call(lambda: self.client.eval(PUT_NEWER, 1, key, raw,
                snapshot['version'], TTL_SECONDS))

    def delete(self, user_id, thread_id):
        self._call(lambda: self.client.delete(cache_key(user_id, thread_id)))
