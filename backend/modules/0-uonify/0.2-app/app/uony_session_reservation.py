"""Atomic Live reservation and heartbeat-based orphan reclamation."""
from .access import workspace_access
from .google_cloud_provider import SCOPE
from .uony_session_transport import RECLAIM_AFTER_SECONDS


def reserve(database, identity, session_id, session_hash, session_limit, *,
            max_active, session_seconds, pilot_budget_available):
    with database.connect() as connection:
        # Take locks in the same owner-first order as thread erasure and Cloud
        # disconnect. A delete between bind and reserve must not leave a paid
        # Live socket attached to an already erased conversation.
        user = connection.execute('''SELECT * FROM users WHERE id=%s FOR SHARE''',
                                  (identity.user_id,)).fetchone()
        if (not user or user['deletion_requested_at']
                or user['google_subject'] != identity.google_subject
                or not user['onboarding_completed_at']
                or workspace_access(connection, user)['status'] != 'allowed'):
            return False
        browser_session = connection.execute('''SELECT 1 FROM sessions
            WHERE user_id=%s AND token_hash=%s AND expires_at>now() FOR SHARE''',
            (identity.user_id, session_hash)).fetchone()
        cloud = connection.execute('''SELECT google_subject,project_id,status,
            project_check,scope FROM google_cloud_connections
            WHERE user_id=%s FOR SHARE''', (identity.user_id,)).fetchone()
        thread = connection.execute('''SELECT deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s FOR SHARE''',
            (identity.user_id, identity.thread_id)).fetchone()
        if (not browser_session or not cloud
                or cloud['google_subject'] != identity.google_subject
                or cloud['project_id'] != identity.project_id
                or cloud['status'] != 'connected'
                or not (cloud['project_check'] or {}).get('ready')
                or SCOPE not in (cloud['scope'] or '').split()
                or not thread or thread['deleted_at']):
            return False
        # Serial admission across API instances, then one active socket per user.
        connection.execute('SELECT pg_advisory_xact_lock(71102026)')
        if not pilot_budget_available(connection, identity.user_id, session_limit):
            return False
        previous = connection.execute('''SELECT session_id FROM uony_live_sessions
            WHERE user_id=%s FOR UPDATE''', (identity.user_id,)).fetchone()
        active = connection.execute('''SELECT count(*) AS n FROM uony_live_sessions
            WHERE expires_at>now() AND heartbeat_at>now()-(%s*interval '1 second')''',
            (RECLAIM_AFTER_SECONDS,)).fetchone()['n']
        if active >= max_active:
            return False
        row = connection.execute('''INSERT INTO uony_live_sessions(user_id,session_id,thread_id,expires_at)
            VALUES(%s,%s,%s,now()+(%s * interval '1 second'))
            ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,
                thread_id=excluded.thread_id,
                expires_at=excluded.expires_at,heartbeat_at=now()
            WHERE uony_live_sessions.expires_at<=now()
               OR uony_live_sessions.heartbeat_at<=now()-(%s*interval '1 second')
            RETURNING session_id''', (identity.user_id, session_id, identity.thread_id,
                                     session_seconds,
                                     RECLAIM_AFTER_SECONDS)).fetchone()
        if row:
            if previous:
                # Reclaim only this socket lease. Do not refund pilot receipts,
                # restart provider calls or cancel its durable work.
                connection.execute('''UPDATE uony_live_usage SET state='unknown',updated_at=now()
                    WHERE user_id=%s AND session_id=%s AND state='started' ''',
                    (identity.user_id, previous['session_id']))
                connection.execute('''UPDATE uony_session_continuity SET active=false,
                    version=version+1,updated_at=now() WHERE user_id=%s AND session_id=%s''',
                    (identity.user_id, previous['session_id']))
            connection.execute('''INSERT INTO uony_live_pilot_admissions
                (user_id,session_id) VALUES(%s,%s)''',
                (identity.user_id, session_id))
            connection.execute('''INSERT INTO uony_live_usage
                (user_id,session_id,thread_id,state)
                VALUES(%s,%s,%s,'started')''',
                (identity.user_id, session_id, identity.thread_id))
        return bool(row)

