"""Persist transport recovery references without duplicating chat or consent.

Call acquire only after the regular Live reservation. All methods are sync;
async bridges should run them with asyncio.to_thread. A cache failure never
changes authorization, cancels a job or prevents a PostgreSQL checkpoint.
"""
from copy import deepcopy
from dataclasses import dataclass
from uuid import UUID

from psycopg.types.json import Jsonb

from .uony_session_cache import RedisSessionCache
from .uony_session_transport import RECLAIM_AFTER_SECONDS

MAX_REFERENCES = 128
STATES = frozenset({'pending', 'sent', 'acknowledged', 'interrupted', 'unknown'})


class SessionSuperseded(Exception):
    """Another valid Live connection owns this thread, or access was revoked."""


@dataclass(frozen=True)
class SessionLease:
    user_id: str
    thread_id: str
    session_id: str
    fence: int


def _uuid(value):
    return str(UUID(str(value)))


def _public(row):
    return {'userId': str(row['user_id']), 'threadId': row['thread_id'],
        'sessionId': str(row['session_id']), 'fence': row['fence'],
        'version': row['version'], 'active': row['active'],
        'updatedAt': row['updated_at'].isoformat(),
        'state': deepcopy(row['snapshot'])}


def _owner(connection, user_id, thread_id):
    # Same lock order as admission/account deletion: account before thread.
    user = connection.execute('''SELECT id FROM users
        WHERE id=%s AND deletion_requested_at IS NULL FOR SHARE''',
        (user_id,)).fetchone()
    if not user:
        return False
    return connection.execute('''SELECT id FROM uony_threads
        WHERE user_id=%s AND id=%s AND deleted_at IS NULL FOR SHARE''',
        (user_id, thread_id)).fetchone() is not None


def _reserved(connection, user_id, thread_id, session_id, *, for_update=False):
    return connection.execute('''SELECT session_id FROM uony_live_sessions
        WHERE user_id=%s AND thread_id=%s AND session_id=%s
          AND expires_at>now() AND heartbeat_at>now()-(%s*interval '1 second') ''' +
        ('FOR UPDATE' if for_update else 'FOR SHARE'),
        (user_id, thread_id, session_id, RECLAIM_AFTER_SECONDS)).fetchone() is not None


def _cloud(connection, user_id, subject, project):
    if subject is None and project is None:
        return True
    if not subject or not project:
        return False
    return connection.execute('''SELECT 1 FROM google_cloud_connections
        WHERE user_id=%s AND google_subject=%s AND project_id=%s
          AND status='connected' FOR SHARE''', (user_id, subject, project)).fetchone() is not None


class SessionContinuity:
    def __init__(self, database, cache=None):
        self.database = database
        self.cache = cache if cache is not None else RedisSessionCache.from_env()

    def acquire(self, user_id, thread_id, session_id, *, google_subject=None, google_project_id=None):
        user_id, session_id = _uuid(user_id), _uuid(session_id)
        with self.database.connect() as c:
            if (not _owner(c, user_id, thread_id)
                    or not _cloud(c, user_id, google_subject, google_project_id)
                    or not _reserved(c, user_id, thread_id, session_id)):
                raise SessionSuperseded('session_not_reserved')
            row = c.execute('''INSERT INTO uony_session_continuity
                (user_id,thread_id,session_id,google_subject,google_project_id,fence,version)
                VALUES(%s,%s,%s,%s,%s,1,1)
                ON CONFLICT(user_id,thread_id) DO UPDATE
                SET session_id=excluded.session_id, fence=uony_session_continuity.fence+1,
                    version=uony_session_continuity.version+1,active=true,updated_at=now(),
                    snapshot=CASE WHEN uony_session_continuity.google_subject IS NOT DISTINCT FROM excluded.google_subject
                        AND uony_session_continuity.google_project_id IS NOT DISTINCT FROM excluded.google_project_id
                        THEN uony_session_continuity.snapshot
                        ELSE '{"activeTurnId":null,"requests":[],"events":[]}'::jsonb END,
                    google_subject=excluded.google_subject,google_project_id=excluded.google_project_id
                RETURNING *''',
                (user_id, thread_id, session_id, google_subject, google_project_id)).fetchone()
            snapshot = _public(row)
        self.cache.put(snapshot)
        return SessionLease(user_id, thread_id, session_id, row['fence'])

    def restore(self, user_id, thread_id, *, google_subject=None, google_project_id=None):
        user_id = _uuid(user_id)
        with self.database.connect() as c:
            row = None
            if (_owner(c, user_id, thread_id)
                    and _cloud(c, user_id, google_subject, google_project_id)):
                row = c.execute('''SELECT * FROM uony_session_continuity
                    WHERE user_id=%s AND thread_id=%s FOR SHARE''', (user_id, thread_id)).fetchone()
                if row and google_subject is not None and (
                        row['google_subject'], row['google_project_id']) != (google_subject, google_project_id):
                    row = None
            if row:
                value = _public(row)
                # Redis is read only after verifying the account and durable
                # version; neither an old nor a forged mirror grants access.
                cached = self.cache.get(user_id, thread_id)
                if cached != value:
                    self.cache.put(value, replace=True)
                work = c.execute('''SELECT h.request_id,h.turn_id,h.session_id,j.status
                    FROM uony_live_handoffs h JOIN uony_conversation_jobs j
                      ON j.user_id=h.user_id AND j.request_id=h.request_id
                        AND j.thread_id=h.thread_id
                    WHERE h.user_id=%s AND h.thread_id=%s
                      AND (%s::text IS NULL OR h.google_subject=%s)
                      AND (%s::text IS NULL OR h.google_project_id=%s)
                    ORDER BY h.created_at DESC LIMIT %s''',
                    (user_id, thread_id, google_subject, google_subject,
                     google_project_id, google_project_id, MAX_REFERENCES)).fetchall()
                value['work'] = [{'requestId': str(item['request_id']),
                    'turnId': str(item['turn_id']), 'sessionId': str(item['session_id']),
                    'status': item['status']} for item in work]
                return value
        self.cache.delete(user_id, thread_id)
        return None

    def heartbeat(self, lease):
        """Renew only a still-owned reservation; never revive an expired lease."""
        with self.database.connect() as c:
            if not _owner(c, lease.user_id, lease.thread_id) or not _reserved(
                    c, lease.user_id, lease.thread_id, lease.session_id, for_update=True):
                raise SessionSuperseded('session_not_reserved')
            row = c.execute('''UPDATE uony_session_continuity
                SET updated_at=now(),version=version+1
                WHERE user_id=%s AND thread_id=%s AND session_id=%s AND fence=%s AND active
                RETURNING *''',
                (lease.user_id, lease.thread_id, lease.session_id, lease.fence)).fetchone()
            if not row:
                raise SessionSuperseded('session_superseded')
            c.execute('''UPDATE uony_live_sessions SET heartbeat_at=now()
                WHERE user_id=%s AND session_id=%s''', (lease.user_id, lease.session_id))
        self.cache.put(_public(row))
        return True

    def is_current(self, lease):
        with self.database.connect() as c:
            return bool(_owner(c, lease.user_id, lease.thread_id)
                and _reserved(c, lease.user_id, lease.thread_id, lease.session_id)
                and c.execute('''SELECT 1 FROM uony_session_continuity
                    WHERE user_id=%s AND thread_id=%s AND session_id=%s
                      AND fence=%s AND active''',
                    (lease.user_id, lease.thread_id, lease.session_id, lease.fence)).fetchone())

    def checkpoint(self, lease, *, turn_id=None, request_id=None,
                   event_id=None, delivery_state=None):
        turn_id = _uuid(turn_id) if turn_id is not None else None
        request_id = _uuid(request_id) if request_id is not None else None
        event_id = _uuid(event_id) if event_id is not None else None
        if (event_id is None) != (delivery_state is None) or (
                delivery_state is not None and delivery_state not in STATES):
            raise ValueError('invalid_delivery_reference')
        with self.database.connect() as c:
            if not _owner(c, lease.user_id, lease.thread_id) or not _reserved(
                    c, lease.user_id, lease.thread_id, lease.session_id):
                raise SessionSuperseded('session_not_reserved')
            row = c.execute('''SELECT * FROM uony_session_continuity
                WHERE user_id=%s AND thread_id=%s AND session_id=%s
                  AND fence=%s AND active FOR UPDATE''',
                (lease.user_id, lease.thread_id, lease.session_id, lease.fence)).fetchone()
            if not row:
                raise SessionSuperseded('session_superseded')
            if request_id and not c.execute('''SELECT 1 FROM uony_requests
                    WHERE user_id=%s AND thread_id=%s AND request_id=%s''',
                    (lease.user_id, lease.thread_id, request_id)).fetchone():
                raise ValueError('request_outside_session_scope')
            state = deepcopy(row['snapshot'])
            if turn_id:
                state['activeTurnId'] = turn_id
            if request_id:
                references = state['requests']
                if not any(item['requestId'] == request_id for item in references):
                    references.append({'requestId': request_id, 'turnId': turn_id})
                state['requests'] = references[-MAX_REFERENCES:]
            if event_id:
                previous = next((item for item in state['events']
                    if item['eventId'] == event_id), None)
                if previous:
                    if (previous['requestId'], previous['turnId']) != (request_id, turn_id):
                        raise ValueError('event_scope_changed')
                    if previous['state'] not in ('acknowledged', 'interrupted'):
                        previous['state'] = delivery_state
                else:
                    state['events'].append({'eventId': event_id, 'turnId': turn_id,
                        'requestId': request_id, 'state': delivery_state,
                        'sequence': row['version'] + 1})
                state['events'] = state['events'][-MAX_REFERENCES:]
            row = c.execute('''UPDATE uony_session_continuity SET snapshot=%s,
                version=version+1,updated_at=now() WHERE user_id=%s AND thread_id=%s
                RETURNING *''', (Jsonb(state), lease.user_id, lease.thread_id)).fetchone()
            value = _public(row)
        self.cache.put(value)
        return value

    def close(self, lease):
        with self.database.connect() as c:
            if not _owner(c, lease.user_id, lease.thread_id):
                return False
            row = c.execute('''UPDATE uony_session_continuity
                SET active=false,version=version+1,updated_at=now()
                WHERE user_id=%s AND thread_id=%s AND session_id=%s AND fence=%s AND active
                RETURNING *''',
                (lease.user_id, lease.thread_id, lease.session_id, lease.fence)).fetchone()
        if row:
            self.cache.put(_public(row))
        return row is not None
