"""One narration attempt per durable result, with separate playback acknowledgement."""
from uuid import UUID, uuid4
from psycopg.types.json import Jsonb
from .uony_live_usage import usage_counts
from .uony_queue_state import configured_int


class LiveDeliveryStore:
    def __init__(self, database, identity, session_id):
        self.database, self.identity, self.session_id = database, identity, session_id

    def begin(self, request_id):
        with self.database.connect() as c:
            row = c.execute('''INSERT INTO uony_live_deliveries
                (user_id,request_id,event_id,session_id,state)
                SELECT h.user_id,h.request_id,%s,%s,'rendering'
                FROM uony_live_handoffs h JOIN uony_threads t
                  ON t.user_id=h.user_id AND t.id=h.thread_id
                JOIN uony_live_sessions s ON s.user_id=h.user_id
                JOIN users u ON u.id=h.user_id
                WHERE h.user_id=%s AND h.request_id=%s AND h.thread_id=%s
                  AND h.google_subject=%s AND h.google_project_id=%s
                  AND t.deleted_at IS NULL AND u.deletion_requested_at IS NULL
                  AND s.session_id=%s AND s.expires_at>now()
                ON CONFLICT(user_id,request_id) DO NOTHING RETURNING event_id''',
                (uuid4(), self.session_id, self.identity.user_id, UUID(request_id),
                 self.identity.thread_id, self.identity.google_subject,
                 self.identity.project_id, self.session_id)).fetchone()
            return str(row['event_id']) if row else None

    def reconcile_previous_session(self):
        with self.database.connect() as c:
            c.execute('''UPDATE uony_live_deliveries d SET state='unknown',
                usage_state=CASE WHEN usage_state='observed' THEN 'observed' ELSE 'unknown' END,
                updated_at=now() FROM uony_live_handoffs h
                WHERE d.user_id=%s AND d.session_id<>%s
                  AND d.state IN ('rendering','sending')
                  AND h.user_id=d.user_id AND h.request_id=d.request_id
                  AND h.thread_id=%s''',
                (self.identity.user_id, self.session_id, self.identity.thread_id))

    def update(self, event_id, state, *, usage=None):
        if state not in ('sending', 'interrupted', 'unknown', 'error'):
            raise ValueError('invalid_delivery_state')
        clean = usage_counts(usage or {})
        with self.database.connect() as c:
            return bool(c.execute('''UPDATE uony_live_deliveries
                SET state=%s,updated_at=now(),
                    rendered_at=CASE WHEN %s='sending' THEN now() ELSE rendered_at END,
                    usage_state=CASE WHEN %s THEN 'observed'
                      WHEN usage_state='observed' THEN usage_state ELSE 'unknown' END,
                    usage=CASE WHEN %s THEN %s ELSE usage END
                WHERE user_id=%s AND session_id=%s AND event_id=%s
                  AND state IN ('rendering','sending') RETURNING event_id''',
                (state, state, bool(clean), bool(clean), Jsonb(clean),
                 self.identity.user_id, self.session_id, UUID(event_id))).fetchone())

    def mark_sent(self, event_id):
        with self.database.connect() as c:
            c.execute('''UPDATE uony_live_deliveries SET sent_at=coalesce(sent_at,now())
                WHERE user_id=%s AND session_id=%s AND event_id=%s AND state='sending' ''',
                (self.identity.user_id, self.session_id, UUID(event_id)))

    def acknowledge(self, event_id, outcome):
        if outcome not in ('played', 'interrupted'):
            raise ValueError('invalid_playback_outcome')
        with self.database.connect() as c:
            row = c.execute('''UPDATE uony_live_deliveries d
                SET state=%s,acknowledged_at=now(),updated_at=now()
                FROM uony_live_sessions s,uony_live_handoffs h,uony_threads t
                WHERE d.user_id=%s AND d.event_id=%s AND d.session_id=%s
                  AND d.state='sending' AND s.user_id=d.user_id
                  AND s.session_id=d.session_id AND s.expires_at>now()
                  AND h.user_id=d.user_id AND h.request_id=d.request_id
                  AND t.user_id=h.user_id AND t.id=h.thread_id
                  AND t.id=%s AND t.deleted_at IS NULL
                RETURNING d.request_id,h.turn_id''',
                ('acknowledged' if outcome == 'played' else 'interrupted',
                 self.identity.user_id, UUID(event_id), self.session_id,
                 self.identity.thread_id)).fetchone()
            return ({'requestId': str(row['request_id']), 'turnId': str(row['turn_id'])}
                    if row else None)


def delivery_metrics(c, user, project_id=None, window_seconds=3600):
    params = (user['id'], user['google_subject'], window_seconds)
    scope = ''
    if project_id is not None:
        scope = ' AND t.project_id=%s'
        params += (project_id,)
    rows = c.execute('''SELECT d.state,count(*) AS samples,
        percentile_cont(.95) WITHIN GROUP (ORDER BY
          extract(epoch FROM d.sent_at-j.finished_at)*1000) AS first_audio_p95,
        percentile_cont(.99) WITHIN GROUP (ORDER BY
          extract(epoch FROM d.sent_at-j.finished_at)*1000) AS first_audio_p99,
        percentile_cont(.95) WITHIN GROUP (ORDER BY
          extract(epoch FROM d.acknowledged_at-j.created_at)*1000)
          FILTER(WHERE d.state='acknowledged') AS playback_p95
        FROM uony_live_deliveries d JOIN uony_conversation_jobs j
          ON j.user_id=d.user_id AND j.request_id=d.request_id
        JOIN uony_threads t ON t.user_id=j.user_id AND t.id=j.thread_id
        WHERE j.user_id=%s AND j.google_subject=%s AND t.deleted_at IS NULL
          AND d.created_at>=now()-%s*interval '1 second' ''' + scope + ' GROUP BY d.state', params).fetchall()
    return [{'state': row['state'], 'samples': row['samples'],
        **{key: round(float(row[column]), 2) if row[column] is not None else None
           for key, column in (('resultToAudioP95Ms', 'first_audio_p95'),
                               ('resultToAudioP99Ms', 'first_audio_p99'),
                               ('endToPlaybackP95Ms', 'playback_p95'))}}
        for row in rows]


def narration_budget_ms():
    return configured_int('UONIFY_LIVE_RESULT_AUDIO_BUDGET_MS', 5000, 100, 60000)
