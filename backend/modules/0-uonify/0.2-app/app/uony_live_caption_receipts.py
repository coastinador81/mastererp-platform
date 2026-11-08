"""Persist only diagnostic receipt state for a potentially billable caption socket."""
import json

from psycopg.types.json import Jsonb


def record_caption_started(database, identity, session_id):
    with database.connect() as connection:
        row = connection.execute('''UPDATE uony_live_usage
            SET usage=coalesce(usage, '{}'::jsonb) ||
                jsonb_build_object('transcribeState', 'started'),updated_at=now()
            WHERE user_id=%s AND session_id=%s RETURNING session_id''',
            (identity.user_id, session_id)).fetchone()
        if not row:
            raise ValueError('Live caption receipt unavailable')


def finalize_caption_state(database, identity, session_id):
    with database.connect() as connection:
        connection.execute('''UPDATE uony_live_usage
            SET usage=coalesce(usage, '{}'::jsonb) ||
                jsonb_build_object('transcribeState', 'unknown'),updated_at=now()
            WHERE user_id=%s AND session_id=%s
                AND usage->>'transcribeState'='started' ''',
            (identity.user_id, session_id))


def record_caption_usage(database, identity, session_id, event):
    if not isinstance(event.counts, dict) or len(json.dumps(event.counts)) > 2048:
        raise ValueError('invalid Live caption usage')
    with database.connect() as connection:
        row = connection.execute('''UPDATE uony_live_usage
            SET usage=coalesce(usage, '{}'::jsonb) ||
                jsonb_build_object('transcribe', %s, 'transcribeState', 'observed'),
                updated_at=now()
            WHERE user_id=%s AND session_id=%s RETURNING session_id''',
            (Jsonb(event.counts), identity.user_id, session_id)).fetchone()
        if not row:
            raise ValueError('Live caption usage unavailable')
