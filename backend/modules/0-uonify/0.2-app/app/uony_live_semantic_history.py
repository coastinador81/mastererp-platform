"""Bound semantic context to one live thread, owner and Google connection."""
from datetime import datetime
from .uony_semantic_failure import saved_semantic_failure


def semantic_thread_history(connection, identity, before):
    """Merge prior voice and canonical worker replies without current/future input.

    Live turns predate identity columns, so a connection's start is the oldest
    safe boundary for those rows. Jobs carry their own Google identity/project.
    A reconnecting socket may reuse history within that connection and thread.
    A previous Live turn's saved failure is visible once committed, even if the
    next utterance began before that failure was saved; its source turn must
    still precede the current utterance.
    """
    if not isinstance(before, datetime) or before.tzinfo is None:
        raise ValueError('invalid semantic history cutoff')
    scope = connection.execute('''SELECT g.connected_at,t.product_history_cutoff_at FROM users u
        JOIN google_cloud_connections g ON g.user_id=u.id
        JOIN uony_threads t ON t.user_id=u.id AND t.id=%s
        LEFT JOIN uony_projects p ON p.user_id=t.user_id AND p.id=t.project_id
        WHERE u.id=%s AND u.google_subject=%s AND u.deletion_requested_at IS NULL
          AND g.google_subject=%s AND g.project_id=%s AND g.status='connected'
          AND t.deleted_at IS NULL
          AND (t.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))''',
        (identity.thread_id, identity.user_id, identity.google_subject,
         identity.google_subject, identity.project_id)).fetchone()
    if not scope:
        raise ValueError('semantic_history_scope_unavailable')
    since = max(scope['connected_at'], scope['product_history_cutoff_at']
                or scope['connected_at'])
    voice = connection.execute('''SELECT v.role,v.text,v.created_at,v.turn_id
        FROM uony_live_turns v
        WHERE v.user_id=%s AND v.thread_id=%s AND v.created_at>=%s AND v.created_at<%s
          AND NOT (v.role='assistant' AND EXISTS (
            SELECT 1 FROM uony_live_handoffs h WHERE h.user_id=v.user_id
              AND h.thread_id=v.thread_id AND h.session_id=v.session_id
              AND h.turn_id=v.reply_to_turn_id))
        ORDER BY v.created_at DESC,v.turn_id DESC LIMIT 16''',
        (identity.user_id, identity.thread_id, since, before)).fetchall()
    jobs = connection.execute('''SELECT r.request_id,r.prompt,r.reply,r.status,r.error_code,
            r.usage AS request_usage,r.created_at,j.status AS job_status,
            j.error_code AS job_error_code,
            COALESCE(j.finished_at,j.updated_at) AS replied_at,
            h.request_id IS NOT NULL AS from_live,
            h.google_subject AS handoff_subject,h.google_project_id AS handoff_project,
            source.created_at AS source_turn_at
        FROM uony_requests r JOIN uony_conversation_jobs j
          ON j.user_id=r.user_id AND j.request_id=r.request_id
        LEFT JOIN uony_live_handoffs h
          ON h.user_id=r.user_id AND h.request_id=r.request_id
          AND h.thread_id=r.thread_id
        LEFT JOIN uony_live_turns source
          ON source.user_id=h.user_id AND source.thread_id=h.thread_id
          AND source.session_id=h.session_id AND source.turn_id=h.turn_id
          AND source.role='user'
        WHERE r.user_id=%s AND r.thread_id=%s AND r.project_id=%s
          AND j.google_subject=%s AND j.project_id=%s
          AND ((r.created_at>=%s AND r.created_at<%s) OR
            (r.status='error' AND r.error_code='semantic_failure'
             AND j.status='error' AND j.error_code='semantic_failure'
             AND h.google_subject=%s AND h.google_project_id=%s
             AND source.created_at>=%s AND source.created_at<%s))
        ORDER BY r.created_at DESC,r.request_id DESC LIMIT 16''',
        (identity.user_id, identity.thread_id, identity.project_id,
         identity.google_subject, identity.project_id, since, before,
         identity.google_subject, identity.project_id, since, before)).fetchall()
    history = [(row['created_at'], 0 if row['role'] == 'user' else 1,
                str(row['turn_id']), row['role'], row['text']) for row in voice]
    for row in jobs:
        key = str(row['request_id'])
        if not row['from_live']:
            history.append((row['created_at'], 0, key, 'user', row['prompt']))
        if row['status'] == 'success' and row['reply'] and row['replied_at'] < before:
            history.append((row['replied_at'], 1, key, 'assistant', row['reply']))
        elif (row['status'] == row['job_status'] == 'error'
                and row['error_code'] == row['job_error_code'] == 'semantic_failure'
                and row['source_turn_at'] is not None
                and row['handoff_subject'] == identity.google_subject
                and row['handoff_project'] == identity.project_id
                and since <= row['source_turn_at'] < before):
            # Reconstruct the notice from a typed server receipt. Never pass a
            # saved provider body, arbitrary reply or forged message to Gemini.
            failure = saved_semantic_failure(row['request_usage'])
            if failure is not None:
                text = (f"Estado de la solicitud anterior ({failure['category']}, "
                    f"{failure['code']}; ejecución {failure['execution']}): "
                    f"{failure['message']}")
                history.append((row['replied_at'], 1, key, 'assistant', text))
    history.sort(key=lambda entry: entry[:3])
    return [{'role': role, 'text': text[:3000]}
            for _, _, _, role, text in history[-8:]]
