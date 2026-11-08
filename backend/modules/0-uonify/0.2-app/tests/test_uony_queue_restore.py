"""An old backup is not proof that its queued work never reached a provider."""
from uuid import uuid4
import pytest
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from app.uony_conversation_queue import ConversationQueue, LeaseLost
from app.uony_queue_restore import quarantine_restored_work, RESTORE_HOLD
from app.uony_routes import Message
from test_uony_queue_reliability import database, seed


def test_quarantine_requires_explicit_offline_restore_precondition(database):
    with pytest.raises(ValueError):
        quarantine_restored_work(database, backup_reference='offline fixture', operator_reference='test')
    with database.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM uony_queue_restore_operations').fetchone()['n'] == 0


def test_restored_active_jobs_are_fenced_and_cannot_auto_replay(database):
    with database.connect() as c:
        _, running_request = seed(c)
    queue = ConversationQueue(database, ('adk',))
    stale_job = queue.claim('original-worker')
    queue.provider_start(stale_job)
    with database.connect() as c:
        queued_user, queued_request = seed(c)
        seed(c, status='success')
    result = quarantine_restored_work(database, backup_reference='synthetic-backup-1',
        operator_reference='offline-test', confirmed_workers_and_admissions_stopped=True)
    assert result['jobsQuarantined'] == 2 and result['requiresReconciliation']
    repeated = quarantine_restored_work(database, backup_reference='synthetic-backup-1-recheck',
        operator_reference='offline-test', confirmed_workers_and_admissions_stopped=True)
    assert repeated['jobsQuarantined'] == 0 and repeated['requiresReconciliation']
    assert repeated['jobsHeldForReconciliation'] == 2
    assert queue.claim('new-worker') is None
    assert queue.recover() is False
    assert not queue.renew_lease(stale_job)
    with pytest.raises(LeaseLost):
        queue.provider_return(stale_job)
    with database.connect() as c:
        saved = c.execute('SELECT request_id,status,error_code,usage FROM uony_conversation_jobs').fetchall()
        assert len([r for r in saved if r['status'] == 'success']) == 1
        held = {r['request_id']: r for r in saved if r['status'] == 'unknown'}
        assert held[queued_request]['error_code'] == RESTORE_HOLD
        assert held[queued_request]['usage'] == {}  # Neither fake zero cost nor fake model attempt.
        assert held[running_request]['usage']['attemptedCalls'] == 1
        response = queue.inspect(c, queued_user, queued_request)
        assert response['error']['code'] == RESTORE_HOLD
        assert 'copia restaurada' in response['error']['message']
        audit = c.execute('SELECT * FROM uony_queue_restore_operations WHERE quarantined_count>0').fetchone()
        assert audit['quarantined_count'] == 2
        assert c.execute('SELECT count(*) AS n FROM uony_queue_restore_quarantines').fetchone()['n'] == 2


def test_ordinary_retry_cannot_release_restore_hold(database):
    with database.connect() as c:
        user, request = seed(c)
        thread = c.execute('SELECT thread_id FROM uony_conversation_jobs').fetchone()['thread_id']
        original = Message(requestId=str(request), threadId=thread, text='Cuenta mis carpetas de Drive')
        c.execute('UPDATE uony_conversation_jobs SET payload=%s', (Jsonb(original.model_dump(mode='json')),))
    queue = ConversationQueue(database, ('adk',))
    quarantine_restored_work(database, backup_reference='synthetic-backup-2',
        operator_reference='offline-test', confirmed_workers_and_admissions_stopped=True)
    retry = original.model_copy(update={'requestId': uuid4(), 'retryOf': request})
    with database.connect() as c:
        with pytest.raises(HTTPException) as raised:
            queue.enqueue(c, user, retry, {}, '', '', None, 'adk')
        assert raised.value.detail['error'] == RESTORE_HOLD
        saved = c.execute('SELECT acknowledged_at,status FROM uony_conversation_jobs').fetchone()
        assert saved == {'acknowledged_at': None, 'status': 'unknown'}


def test_repeating_restore_quarantine_does_not_reset_completed_work(database):
    with database.connect() as c:
        seed(c, status='success')
    result = quarantine_restored_work(database, backup_reference='already-reconciled-fixture',
        operator_reference='offline-test', confirmed_workers_and_admissions_stopped=True)
    assert result['jobsQuarantined'] == 0 and not result['requiresReconciliation']
    with database.connect() as c:
        assert c.execute('SELECT status FROM uony_conversation_jobs').fetchone()['status'] == 'success'
