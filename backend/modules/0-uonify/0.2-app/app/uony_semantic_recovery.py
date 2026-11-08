"""Explicit recovery uses saved input and new authority, never worker retryOf."""
import asyncio
import time
import logging
from psycopg.types.json import Jsonb
from .google_cloud_provider import CloudError
from .uony_semantic_classifier import classify
from .uony_semantic_decision import DRIVE_ACTIONS
from .uony_semantic_failure import (SemanticBudget, bounded, RESERVE_SECONDS,
                                   merge_semantic_usage)
from . import uony_semantic_recovery_store as store
from .uony_semantic_runtime import blocking


def _deadline(c, user, command_id):
    row = c.execute('''SELECT a.deadline_at FROM uony_semantic_requests r
        JOIN uony_semantic_attempts a ON a.user_id=r.user_id
          AND a.semantic_attempt_id=r.current_attempt_id
        WHERE r.user_id=%s AND r.logical_request_id=%s''', (user['id'], command_id)).fetchone()
    return row['deadline_at'].timestamp() if row else 0


def resolve(worker, user, job, body, cloud, model, decision, accounting):
    if decision is None or decision.action != 'recover_request':
        return body, decision, None
    def prepare():
        with worker.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            worker.validate(c, job, body)
            store.validate_model(c, getattr(worker, 'settings', None), user['id'], body.requestId)
            effective = store.model_for_thread(c, getattr(worker, 'settings', None),
                user, body.threadId, cloud, model)
            deadline = _deadline(c, user, body.requestId)
            row = store.reserve(c, user, body, cloud,
                deadline if deadline-time.time() > RESERVE_SECONDS else 0)
            if row:
                row['recovery_disposition'] = store.metadata(c, user, body.requestId)['disposition']
            reply = store.reply(c, user, body.requestId) if not row or not row.get('reserved') else None
            return deadline, row, reply, effective
    try:
        deadline, row, reply, effective_model = asyncio.run(blocking(prepare, seconds=.2))
    except TimeoutError as error:
        failure = CloudError('semantic_timeout')
        failure.usage, failure.semantic_usage_total = accounting.usage, True
        raise failure from error
    if not row or not row.get('reserved'):
        if (row and row.get('recovery_disposition') == 'blocked'
                and deadline-time.time() <= RESERVE_SECONDS):
            failure = CloudError('semantic_timeout')
            failure.usage, failure.semantic_usage_total = accounting.usage, True
            raise failure
        return body, decision, reply
    snapshot, attempt = row['snapshot'], row['semantic_attempt_id']
    if snapshot.get('effectiveSemanticModel') != effective_model:
        failure = CloudError('model_changed')
        failure.usage, failure.semantic_usage_total = accounting.usage, True
        def block_changed_model():
            with worker.database.connect() as c:
                c.execute("SET LOCAL statement_timeout='200ms'")
                store.finish_attempt(c, user['id'], attempt, 'error', {})
                c.execute('''UPDATE uony_semantic_recovery_commands SET disposition='blocked'
                    WHERE user_id=%s AND recovery_command_id=%s''', (user['id'], body.requestId))
        try:
            asyncio.run(blocking(block_changed_model, seconds=.2))
        except BaseException:
            failure.semantic_persistence_failed = True
        raise failure
    budget = SemanticBudget(seconds=max(0, deadline-time.time()))
    classifier = worker.semantic_classifier or classify
    base_usage, base_offset = dict(accounting.usage), accounting.offset
    observed_usage = {}
    dispatched = False
    def total(original):
        return {key: base_usage.get(key, 0)+original.get(key, 0)
            for key in set(base_usage) | set(original)
            if type(base_usage.get(key, 0)) is int and type(original.get(key, 0)) is int}
    def save_usage(usage):
        with worker.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            store.account_usage(c, user['id'], attempt, usage)
    async def call_model(token, remaining):
        nonlocal observed_usage, dispatched
        dispatched = True
        try:
            result = await classifier(token, cloud['project_id'], effective_model,
                snapshot['body']['text'], snapshot['history'], snapshot['selectedFolder'],
                timeout_seconds=remaining)
            observed_usage = result.usage
            return result
        except BaseException as error:
            observed_usage = getattr(error, 'usage', {})
            raise
        finally:
            if observed_usage:
                try:
                    await blocking(save_usage, observed_usage, seconds=.2)
                except BaseException:
                    logging.getLogger(__name__).warning('Recovery accounting persistence unavailable')
    def dispatch():
        budget.require()
        accounting.reserve(1)
        with worker.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            worker.validate(c, job, body)
            store.validate_model(c, getattr(worker, 'settings', None), user['id'], row['logical_request_id'])
            if store.current_scope(c, user, body, cloud) != row['scope']:
                raise CloudError('google_changed')
            budget.require()
            store.mark_dispatched(c, user['id'], attempt)
            budget.require()

    def complete(restored):
        budget.require()
        worker.queue.stream_complete(job, base_offset+1, accounting.usage)
        with worker.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            worker.validate(c, job, body)
            budget.require()
            if (store.current_scope(c, user, body, cloud) != row['scope']
                    or restored.action not in DRIVE_ACTIONS):
                store.finish_attempt(c, user['id'], attempt, 'error', restored.usage)
                c.execute('''UPDATE uony_semantic_recovery_commands SET disposition='blocked'
                    WHERE user_id=%s AND recovery_command_id=%s''', (user['id'], body.requestId))
                return store.reply(c, user, body.requestId)
            if not store.finish_attempt(c, user['id'], attempt, 'success', restored.usage, restored):
                raise CloudError('semantic_timeout')
            store.admit(c, user, row['logical_request_id'], body.requestId, attempt,
                        settings=getattr(worker, 'settings', None))
            budget.require()
        return None

    async def infer():
        token = await blocking(worker.cloud.refresh,
            worker.cipher.decrypt(cloud['refresh_encrypted'].encode()).decode(),
            seconds=budget.remaining(RESERVE_SECONDS), budget=budget)
        await blocking(dispatch, seconds=budget.remaining(RESERVE_SECONDS), budget=budget)
        remaining = budget.remaining(RESERVE_SECONDS)
        if remaining <= 0:
            raise CloudError('semantic_timeout')
        restored = await bounded(call_model(token, remaining), remaining, budget=budget)
        accounting.offset = base_offset+1
        accounting.usage = total(restored.usage)
        reply = await blocking(complete, restored, seconds=budget.remaining(), budget=budget)
        return restored, reply
    try:
        restored, reply = asyncio.run(infer())
        if reply is not None:
            return body, decision, reply
        from .uony_routes import Message
        original = Message.model_validate(snapshot['body']).model_copy(update={'requestId': body.requestId})
        return original, restored, None
    except BaseException as failure:
        usage = merge_semantic_usage(observed_usage, getattr(failure, 'usage', {}))
        if dispatched:
            usage = merge_semantic_usage({'attemptedCalls': 1, 'uncertainCalls': 1}, usage)
        else:
            try:
                # A local reservation that provably never dispatched has zero
                # additional consumption; settle it without another transport.
                asyncio.run(blocking(worker.queue.stream_not_dispatched, job,
                    base_offset+1, base_usage, seconds=.2))
            except BaseException:
                pass
        if isinstance(failure, TimeoutError):
            failure = CloudError('semantic_timeout')
        failure.usage = total(usage)
        failure.semantic_usage_total = True
        accounting.usage = failure.usage
        def cleanup():
            with worker.database.connect() as c:
                c.execute("SET LOCAL statement_timeout='200ms'")
                if not dispatched:
                    store.not_dispatched(c, user['id'], attempt)
                store.finish_attempt(c, user['id'], attempt, 'unknown' if dispatched else 'error', usage)
                c.execute('''UPDATE uony_semantic_recovery_commands SET disposition='reconciliation_required'
                    WHERE user_id=%s AND recovery_command_id=%s AND disposition<>'reclassified' ''',
                    (user['id'], body.requestId))
        try:
            asyncio.run(blocking(cleanup, seconds=.2))
        except BaseException:
            failure.semantic_persistence_failed = True
        raise failure


def followup_complete(service, c, user, body, receipt, target, prepared, decision):
    """A followup retains its own receipt; active work can only be observed."""
    from .uony_engine import enabled_engines, selected_engine
    from .uony_semantic_decision import serialize_decision
    from . import uony_followup_store
    if not store.finish_attempt(c, user['id'], store.initial_attempt(body.requestId),
                                'success', decision.usage, decision):
        raise CloudError('semantic_timeout')
    active = c.execute('''SELECT 1 FROM uony_conversation_jobs WHERE user_id=%s
        AND status IN ('queued','running')''', (user['id'],)).fetchone()
    if active:
        store.reserve(c, user, body, prepared['cloud'], 0)
        metadata = store.metadata(c, user, body.requestId)
        response = store.reply(c, user, body.requestId)
        if metadata and metadata['disposition'] == 'blocked' and metadata['businessRequestId'] is None:
            response = 'Hay otra petición en curso. He conservado esta orden de recuperación sin iniciar otra ejecución.'
        uony_followup_store.finish(c, user, body, receipt, target, decision,
                                  reply_override=response)
        return
    queue = service.queue
    queue.enqueue(c, user, body, prepared['cloud'], prepared['model'], receipt['selection_reason'],
        store.product_memory(c, user, body.threadId), selected_engine(service.settings, user['id']),
        allowed_engines=enabled_engines(service.settings, user['id']))
    envelope = Jsonb(serialize_decision(decision, body.text))
    c.execute('''UPDATE uony_conversation_jobs SET semantic_decision=%s,usage=%s,
        provider_attempt_count=1,provider_completed_count=1,
        provider_started_at=%s,provider_returned_at=NULL WHERE user_id=%s AND request_id=%s''',
        (envelope, Jsonb(decision.usage), receipt['provider_started_at'], user['id'], body.requestId))
    c.execute('''UPDATE uony_written_followups SET state='success',semantic_decision=%s,
        usage=%s,finished_at=now(),updated_at=now() WHERE user_id=%s AND request_id=%s''',
        (envelope, Jsonb(decision.usage), user['id'], body.requestId))
