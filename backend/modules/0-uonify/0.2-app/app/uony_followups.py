"""Written follow-ups (D8, «Consultor google» 21-10-2026), without the interpreter.

A message written while the account's current work runs is answered at once
by a restricted agent (uony_followup_agent): the facts of that work, or this
same message left parked as the next order (queue_order), which the queue
releases when that work ends. Without active work it is an ordinary agent
request with F0. The HTTP contract and the receipts (targetRequestId) stay.
"""
import logging
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb

from .access import workspace_access
from .onboarding import require_user
from .security import require_origin
from .uony_context import cloud_selection, conversation_context
from .uony_engine import ADK, adk_enabled_for, enabled_engines, selected_engine
from .uony_projects import check_thread
from .uony_conversation_queue import ConversationQueue, error
from .uony_queue_state import safe_usage
from .uony_call_policy import CallPolicy
from .uony_admission_budget import admission_budget
from .uony_followup_agent import INSTRUCTION, TOOLS, FollowupTools, current_work
from .product_memory import project as product_memory
from . import uony_followup_store as store

_FAILURE_CODES = frozenset(('google_unavailable', 'invalid_response', 'quota_exceeded',
    'permission_denied', 'model_unavailable', 'reauthorize', 'tool_limit',
    'access_required', 'google_changed', 'model_changed', 'request_not_found',
    'thread_deleted', 'thread_project_conflict', 'assignment_focus_required',
    'assignment_focus_conflict', 'already_attempted', 'google_required', 'deadline_exceeded',
    'agent_unanswered'))


def log_failure(request_id, phase, failure):
    code = (failure.detail.get('error') if isinstance(failure, HTTPException)
            and isinstance(failure.detail, dict) else getattr(failure, 'code', None))
    code = code if isinstance(code, str) and code in _FAILURE_CODES else 'unclassified'
    logging.getLogger(__name__).warning('written_followup_failed request_id=%s phase=%s type=%s code=%s',
        request_id, phase, type(failure).__name__, code)


class FollowupLedger:
    """D8 attempts (hallazgo B), recorded in the follow-up's own row before each
    is sent: it has no request row until it ends, so no uony_provider_attempts.
    In flight an attempt counts as uncertain and unresolved; a completed call
    leaves the agent's exact usage, and a failure brings it with the error."""

    def __init__(self, record):
        self.record, self.usage = record, {}

    def _sending(self):
        self.usage.update(attemptedCalls=self.usage.get('attemptedCalls', 0) + 1,
                          uncertainCalls=max(1, self.usage.get('uncertainCalls', 0)),
                          unresolvedCalls=1)
        self.record(self.usage)

    def attempt(self, ordinal, timeout_ms):
        self._sending()

    def retries_left(self):
        """The job's caps hold here too (lote 6): 3 retries and 6 attempts."""
        attempted = self.usage.get('attemptedCalls', 0)
        retried = attempted - self.usage.get('calls', 0) - 1
        return max(0, min(3 - retried, 6 - attempted))

    def retry(self, ordinal, kind, code, elapsed_ms, timeout_ms, attempt=1):
        self._sending()

    def failed(self, ordinal, attempt, kind, code, elapsed_ms):
        pass

    def completed(self, ordinal, attempt, usage, elapsed_ms):
        self.usage = safe_usage(usage)
        self.record(self.usage)


class WrittenFollowups:
    def __init__(self, settings, database, cloud, queue, require_focus):
        self.settings, self.database, self.cloud = settings, database, cloud
        self.queue, self.require_focus = queue, require_focus
        self.cipher = Fernet(settings.encryption_key)

    def _scope(self, c, request, body, target_id):
        user = require_user(c, request)
        if (not user.get('onboarding_completed_at')
                or workspace_access(c, user)['status'] != 'allowed'):
            raise error('access_required', 'Activa tu acceso a Uonify para consultar esta solicitud.', 403)
        if not adk_enabled_for(self.settings, user['id']):
            raise error('engine_unavailable', 'La consulta simultánea no está habilitada para esta cuenta.')
        thread = check_thread(c, user, body)
        if not thread:
            raise error('thread_not_found', 'No se encuentra esta conversación.', 404)
        self.require_focus(c, user, body)
        cloud, model, reason = cloud_selection(c, user, body.model, body.effort)
        target = ConversationQueue.visible(c, user, target_id)
        cutoff = c.execute('''SELECT product_history_cutoff_at FROM uony_threads
            WHERE user_id=%s AND id=%s''', (user['id'], body.threadId)).fetchone()
        if (not target or target['thread_id'] != body.threadId
                or target['project_id'] != cloud['project_id']
                or target['created_at'] < cloud['connected_at']
                or (cutoff['product_history_cutoff_at'] and
                    target['created_at'] < cutoff['product_history_cutoff_at'])
                or c.execute('''SELECT 1 FROM uony_written_followups
                    WHERE user_id=%s AND request_id=%s''', (user['id'], target_id)).fetchone()):
            raise error('request_not_found', 'No se encuentra esa tarea en esta conversación y conexión.', 404)
        return user, cloud, model, reason, target

    def prepare(self, request, body, target_id):
        if body.requestId == target_id or any((body.productContext, body.productAction,
                body.formResponse, body.incidentAction, body.materialAction,
                body.requirementsAction, body.retryOf)):
            raise error('invalid_followup', 'Esta vía solo admite una pregunta de texto sobre la solicitud.', 422)
        with self.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            user, cloud, model, reason, target = self._scope(c, request, body, target_id)
            store.expire(c, user)
            previous = c.execute('''SELECT * FROM uony_written_followups
                WHERE user_id=%s AND request_id=%s''', (user['id'], body.requestId)).fetchone()
            if previous:
                if (previous['payload'] != body.model_dump(mode='json')
                        or previous['target_request_id'] != target_id
                        or previous['connection_fingerprint'] != store.fingerprint(cloud)):
                    raise error('request_conflict', 'Este identificador corresponde a otra consulta.')
                return {'replay': store.inspect(c, user, body.requestId, self.queue)}
            if c.execute('SELECT 1 FROM uony_requests WHERE user_id=%s AND request_id=%s',
                         (user['id'], body.requestId)).fetchone():
                raise error('request_conflict', 'Este identificador ya corresponde a otro mensaje.')
            if c.execute('''SELECT 1 FROM uony_written_followups
                WHERE user_id=%s AND state='started' ''', (user['id'],)).fetchone():
                raise error('followup_busy', 'Todavía estoy atendiendo tu mensaje anterior.')
            limit = admission_budget(self.settings, user, body.projectId)
            if store.daily_count(c, user) >= limit:
                raise error('daily_limit', f'Has alcanzado el límite de {limit} peticiones diarias de esta integración.', 429)
            # Use the same global admission lock, without acquiring a job lease.
            self.queue.require_global_capacity(c)
            c.execute('''INSERT INTO uony_written_followups
                (user_id,request_id,target_request_id,thread_id,google_subject,
                 project_id,connection_fingerprint,payload,model,selection_reason,state)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'started')''',
                (user['id'], body.requestId, target_id, body.threadId,
                 user['google_subject'], cloud['project_id'], store.fingerprint(cloud),
                 Jsonb(body.model_dump(mode='json')), model, reason))
            return {'user_id': user['id'], 'cloud': cloud, 'model': model,
                    'active': target['status'] in ('queued', 'running')}

    def _validated(self, c, request, body, target_id, prepared):
        user, cloud, model, _, _ = self._scope(c, request, body, target_id)
        store.expire(c, user)
        row = c.execute('''SELECT * FROM uony_written_followups
            WHERE user_id=%s AND request_id=%s FOR UPDATE''',
            (user['id'], body.requestId)).fetchone()
        if (user['id'] != prepared['user_id'] or not row or row['state'] != 'started'
                or row['connection_fingerprint'] != store.fingerprint(cloud)
                or row['model'] != model):
            raise error('google_changed', 'La conexión o el estado de esta consulta cambió; no se repetirá.')
        return user, cloud, row

    def _order(self, request, body, target_id, prepared, *, parked):
        """This message as an ordinary agent request (F0), parked behind the
        account's current work when there is one."""
        with self.database.connect() as c:
            user, cloud, row = self._validated(c, request, body, target_id, prepared)
            self.queue.enqueue(c, user, body, cloud, row['model'], row['selection_reason'],
                               product_memory(c, user, body.threadId),
                               selected_engine(self.settings, user['id']),
                               allowed_engines=enabled_engines(self.settings, user['id']),
                               parked=parked)
        return {'status': 'queued'}

    def _park(self, request, body, target_id, prepared):
        try:
            return self._order(request, body, target_id, prepared, parked=True)
        except HTTPException as failure:
            detail = failure.detail if isinstance(failure.detail, dict) else {}
            return {'error': detail.get('error', 'busy'), 'message': detail.get(
                'message', 'Ahora no puedo dejar esta orden en cola.')}

    def _work(self, request, body, target_id, prepared):
        with self.database.connect() as c:
            user, _, _ = self._validated(c, request, body, target_id, prepared)
            return current_work(c, user, target_id)

    def _record(self, request, body, target_id, prepared, usage):
        with self.database.connect() as c:
            user, _, _ = self._validated(c, request, body, target_id, prepared)
            c.execute('''UPDATE uony_written_followups SET usage=%s,updated_at=now(),
                provider_started_at=coalesce(provider_started_at,now())
                WHERE user_id=%s AND request_id=%s''', (Jsonb(safe_usage(usage)), user['id'], body.requestId))

    def _answer(self, request, body, target_id, prepared):
        """The restricted agent, now; same thread and history, two tools."""
        from .uony_conversation_worker import AGENT_EFFORT, AGENT_MODEL
        from .uony_routes import services
        tools = FollowupTools(lambda: self._work(request, body, target_id, prepared),
                              lambda: self._park(request, body, target_id, prepared))
        with self.database.connect() as c:
            user, cloud, _ = self._validated(c, request, body, target_id, prepared)
            history, _, _ = conversation_context(c, user, body, self.database, services(c, user))
        token = self.cloud.refresh(self.cipher.decrypt(cloud['refresh_encrypted'].encode()).decode())
        provider = request.app.state.conversation_worker.providers.get(ADK)
        ledger = FollowupLedger(lambda usage: self._record(request, body, target_id, prepared, usage))
        try:
            reply, usage = provider.generate(token, cloud['project_id'], history, tools,
                model=AGENT_MODEL, effort=AGENT_EFFORT, only_tools=TOOLS, instruction=INSTRUCTION,
                policy=CallPolicy.written(AGENT_EFFORT), ledger=ledger)
        except Exception as failure:
            if not tools.parked:
                # The agent's own count is exact (a 429 consumed nothing).
                failure.usage = getattr(failure, 'usage', None) or dict(ledger.usage)
                raise
            # The order is already parked; it answers later.
            reply, usage = None, getattr(failure, 'usage', None) or ledger.usage
        with self.database.connect() as c:
            user, _, receipt = self._validated(c, request, body, target_id, prepared)
            if tools.parked:
                store.parked(c, user, body, usage)
            else:
                store.answered(c, user, body, receipt, reply, usage)
            return store.inspect(c, user, body.requestId, self.queue)

    def failed(self, user_id, request_id, failure):
        with self.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            user = c.execute('SELECT * FROM users WHERE id=%s FOR UPDATE', (user_id,)).fetchone()
            if not user or user.get('deletion_requested_at'):
                return None
            row = c.execute('''SELECT * FROM uony_written_followups
                WHERE user_id=%s AND request_id=%s FOR UPDATE''', (user_id, request_id)).fetchone()
            if not row or row['state'] != 'started':
                return None
            usage = safe_usage(getattr(failure, 'usage', None) or row['usage'])
            # Hallazgo B: unknown only if a call was left unresolved after a
            # possible consumption (the ledger marks every attempt in flight).
            unresolved = usage.get('unresolvedCalls', 0) > 0
            code = ('consumption_unknown' if unresolved else
                    failure.detail.get('error', 'google_unavailable') if isinstance(failure, HTTPException)
                    and isinstance(failure.detail, dict) else getattr(failure, 'code', 'google_unavailable'))
            state = 'unknown' if unresolved else 'error'
            c.execute('''UPDATE uony_written_followups SET state=%s,error_code=%s,
                usage=%s,finished_at=now(),updated_at=now()
                WHERE user_id=%s AND request_id=%s AND state='started' ''',
                (state, code, Jsonb(usage), user_id, request_id))
            try:
                return store.inspect(c, user, request_id, self.queue)
            except HTTPException:
                # Commit the outcome even if the connection was revoked meanwhile.
                # Never disclose a stale response in that scope.
                return None

    def run(self, request, body, target_id):
        prepared = self.prepare(request, body, target_id)
        if 'replay' in prepared:
            return prepared['replay']
        phase = 'admission'
        try:
            if not prepared['active']:
                # No current work: an ordinary agent request, with F0.
                self._order(request, body, target_id, prepared, parked=False)
                with self.database.connect() as c:
                    user, _, _ = self._validated(c, request, body, target_id, prepared)
                    store.parked(c, user, body, {})
                    return store.inspect(c, user, body.requestId, self.queue)
            phase = 'restricted_agent'
            return self._answer(request, body, target_id, prepared)
        except Exception as failure:
            log_failure(body.requestId, phase, failure)
            result = self.failed(prepared['user_id'], body.requestId, failure)
            if result is not None:
                return result
            raise


def routes(settings, database, cloud, queue, Message, require_focus):
    router = APIRouter()
    service = WrittenFollowups(settings, database, cloud, queue, require_focus)

    @router.post('/requests/{target_id}/followups')
    def followup(target_id: UUID, body: Message, request: Request):
        # Synchronous on purpose: FastAPI runs it in its thread pool, where the
        # restricted agent's own event loop may run.
        require_origin(request, settings.origin)
        result = service.run(request, body, target_id)
        return JSONResponse(result, status_code=202 if result['status'] in ('queued', 'running') else 200,
                            headers={'Cache-Control': 'no-store'})

    return router
