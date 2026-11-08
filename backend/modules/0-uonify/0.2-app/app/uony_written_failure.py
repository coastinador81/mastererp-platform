"""Lote 6, point 5 («Consultor google», 21-10-2026): a written turn never ends in a dead end.

A written ADK turn commits every customer effect only in finish(), in one
transaction with its terminal state (uony_conversation_worker.finish). Its tools
only prepare in memory or read; the only rows written during the turn are Drive
authorisation and audit records and the attempt log. So a failed written turn has
no effect to protect: it ends in 'error' with capa 2's RETRY_LATER, and the same
message may be sent again. A voice handoff and the classic engine keep their rules.

The customer's natural answer to RETRY_LATER («¿Lo intento de nuevo?») must work
too. Only the IMMEDIATELY previous turn of the thread counts, and only when it is
such a failure: the agent sees it, and the Drive emitter may take the name of the
resource from the customer's own words of that turn, never from model or document
text.
"""
from .uony_conversation_queue import FAILURE_MESSAGES, RETRY_LATER, failure_message
from .uony_engine import ADK


def handed_off(c, job):
    """Whether this request came from a Live (voice) turn."""
    return c.execute('SELECT 1 FROM uony_live_handoffs WHERE user_id=%s AND request_id=%s',
                     (job['user_id'], job['request_id'])).fetchone() is not None


def written_failure(c, job, engine, tools_run, reason):
    """The typed reason a written ADK failure ends with instead of unknown; None
    for a voice handoff or another engine, which keep their own rules."""
    from .uony_drive_scope import touched_drive  # Local: the Drive emitter imports this module.
    if engine != ADK or handed_off(c, job):
        return None
    if reason:
        return reason
    return ('uncertain_no_effect' if tools_run == 0 and not touched_drive(c, job)
            else 'uncertain_read_only')


def released_unknown_text(status, engine, code, acknowledged_at, handed_off, provider_code=None):
    """Lote 7, P2 («Consultor google»): a written ADK order left unknown whose identical
    resend is released (migration 130 or a retry) kept no effect, since only finish()
    writes; it reads like a written failure since lote 6c. None for any other order."""
    if ((status, engine, code) != ('unknown', ADK, 'consumption_unknown')
            or acknowledged_at is None or handed_off):
        return None
    access = provider_code in ('reauthorize', 'permission_denied')
    return FAILURE_MESSAGES[provider_code] if access else RETRY_LATER


def previous_failure(c, user_id, thread_id, request_id):
    """The immediately previous turn of this thread when it is a written failure
    the customer read as RETRY_LATER: {'requestId', 'prompt', 'createdAt'}.
    None if any request or voice turn came after it, or it is not that failure.
    QA-04 (what content already entered) stays the emitter's, via just_read."""
    current = c.execute('''SELECT created_at FROM uony_requests
        WHERE user_id=%s AND request_id=%s''', (user_id, request_id)).fetchone()
    if not current or not thread_id:
        return None
    row = c.execute('''SELECT r.request_id, r.prompt, r.created_at, j.status, j.engine,
            j.error_code, j.provider_error_code, j.acknowledged_at,
            EXISTS (SELECT 1 FROM uony_live_handoffs h
                WHERE h.user_id=r.user_id AND h.request_id=r.request_id) AS handed_off
        FROM uony_requests r LEFT JOIN uony_conversation_jobs j
          ON j.user_id=r.user_id AND j.request_id=r.request_id
        WHERE r.user_id=%s AND r.thread_id=%s AND r.request_id<>%s AND r.created_at<%s
        ORDER BY r.created_at DESC, r.request_id DESC LIMIT 1''',
        (user_id, thread_id, request_id, current['created_at'])).fetchone()
    if not row:
        return None
    released = released_unknown_text(row['status'], row['engine'], row['error_code'],
                                     row['acknowledged_at'], row['handed_off'],
                                     row['provider_error_code']) == RETRY_LATER
    if not released and (row['status'] != 'error' or row['engine'] != ADK or row['handed_off']
            or failure_message(row['error_code'], row['provider_error_code']) != RETRY_LATER):
        return None
    spoken = c.execute('''SELECT 1 FROM uony_live_turns WHERE user_id=%s AND thread_id=%s
        AND created_at>%s LIMIT 1''', (user_id, thread_id, row['created_at'])).fetchone()
    if spoken:
        return None
    return {'requestId': str(row['request_id']), 'prompt': row['prompt'], 'createdAt': row['created_at']}
