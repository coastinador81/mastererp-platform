"""Explicit OFFLINE quarantine after restoring an older database snapshot.

Precondition: API admissions and every worker are stopped. Never call this in
normal startup, an HTTP request, or to recover a mere lost Redis session.
A backup preceding provider_start cannot prove the original process did not
later execute. Keep restored active jobs held until external outcomes have
been reconciled; no automatic or ordinary user retry can release this hold.
"""
from uuid import uuid4

RESTORE_HOLD = 'restore_reconciliation_required'


def quarantine_restored_work(database, *, backup_reference, operator_reference,
                             confirmed_workers_and_admissions_stopped=False):
    if confirmed_workers_and_admissions_stopped is not True:
        raise ValueError('Stop workers and API admissions before quarantining a restored snapshot')
    for value in (backup_reference, operator_reference):
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= 200:
            raise ValueError('Provide bounded, non-secret backup and operator references')
    operation_id = uuid4()
    with database.connect() as c:
        # Same account-before-job lock order as admission, deletion and recovery.
        c.execute("""SELECT u.id FROM users u WHERE EXISTS (
            SELECT 1 FROM uony_conversation_jobs j WHERE j.user_id=u.id
            AND j.status IN ('queued','running')) ORDER BY u.id FOR UPDATE OF u""").fetchall()
        jobs = c.execute("""SELECT user_id,request_id,status FROM uony_conversation_jobs
            WHERE status IN ('queued','running') ORDER BY user_id,request_id FOR UPDATE""").fetchall()
        c.execute("""INSERT INTO uony_queue_restore_operations
            (id,backup_reference,operator_reference,quarantined_count) VALUES(%s,%s,%s,%s)""",
            (operation_id, backup_reference.strip(), operator_reference.strip(), len(jobs)))
        for job in jobs:
            c.execute("""INSERT INTO uony_queue_restore_quarantines
                (restore_id,user_id,request_id,prior_status) VALUES(%s,%s,%s,%s)""",
                (operation_id, job['user_id'], job['request_id'], job['status']))
            c.execute("""UPDATE uony_conversation_jobs SET status='unknown',error_code=%s,
                provider_error_code=NULL,acknowledged_at=NULL,provisional_text='',
                progress_seq=progress_seq+1,finished_at=now(),updated_at=now(),
                lease_token=NULL,lease_owner=NULL,lease_until=NULL
                WHERE user_id=%s AND request_id=%s""",
                (RESTORE_HOLD, job['user_id'], job['request_id']))
            # Keep the backup's usage evidence untouched. Unknown outcome does
            # not prove an attempted model call or a zero/positive cost.
            c.execute("""UPDATE uony_requests SET status='error',error_code=%s
                WHERE user_id=%s AND request_id=%s""",
                (RESTORE_HOLD, job['user_id'], job['request_id']))
        c.execute("""UPDATE uony_conversation_workers SET status='stopped',stopped_at=now()
            WHERE status<>'stopped'""")
        held = c.execute("""SELECT count(*) AS n FROM uony_conversation_jobs
            WHERE status='unknown' AND error_code=%s AND acknowledged_at IS NULL""",
            (RESTORE_HOLD,)).fetchone()['n']
    return {'restoreOperationId': str(operation_id), 'jobsQuarantined': len(jobs),
            'jobsHeldForReconciliation': held, 'requiresReconciliation': bool(held)}
