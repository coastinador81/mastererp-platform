"""Account-bound semantic interpretation with durable, non-replayed receipts."""
import asyncio
from dataclasses import dataclass
from dataclasses import field
from hashlib import sha256
import json
import logging
import time
from uuid import UUID

from psycopg.types.json import Jsonb

from .uony_account_lock import lock_account
from .uony_context import cloud_selection
from .uony_live_bridge import _session_allowed
from .uony_semantic_classifier import classify, semantic_error_diagnostics
from .uony_semantic_decision import restore_decision, serialize_decision
from .uony_live_semantic_history import semantic_thread_history
from .uony_live_handoff import request_id_for_turn
from .uony_semantic_failure import (CURRENT_BUDGET, SemanticBudget, SemanticFailure,
    RESERVE_SECONDS, PERSIST_RESERVE_SECONDS, bounded, require_semantic_budget,
    require_receipt_budget)


logger = logging.getLogger(__name__)

# The owner row is shared with every writer of this account. A 200 ms wait made
# ordinary contention fail spoken turns (20-10-2026); wait longer, within the
# turn deadline, and let uony_account_lock name the holder.
PREPARE_LOCK_MS = 1500
# One classifier attempt with the turn's full remaining time (a shorter attempt
# deadline is forwarded to Vertex and produced 504s), minus a share kept for
# admission, which waits for the same account lock after classification.
ADMISSION_RESERVE_SECONDS = 1.5

def _correlation_id(value):
    try:
        return str(UUID(str(value))) if isinstance(value, (str, UUID)) else None
    except ValueError:
        return None


def _usage_diagnostics(usage):
    if not isinstance(usage, dict):
        return {}
    return {key: value for key in ('attemptedCalls', 'calls', 'uncertainCalls')
            if type(value := usage.get(key)) is int and 0 <= value <= 1}


def _elapsed(started):
    return round(max(0, time.monotonic() - started) * 1000, 3)


class LiveSemanticInterpreter:
    def __init__(self, provider, database, settings, identity, session_id, session_hash):
        self.provider, self.database, self.settings = provider, database, settings
        self.identity, self.session_id, self.session_hash = identity, session_id, session_hash

    def _trace(self, event, phase, started, **measurements):
        session_id, turn_id = _correlation_id(self.session_id), _correlation_id(event.turn_id)
        request_id = str(request_id_for_turn(session_id, turn_id)) if session_id and turn_id else None
        logger.info('Live semantic telemetry %s', json.dumps({
            'type': 'live_semantic_timing', 'sessionId': session_id, 'turnId': turn_id,
            'requestId': request_id, 'phase': phase, 'elapsedMs': _elapsed(started),
            **measurements}, sort_keys=True))

    def _prepare(self, event):
        require_semantic_budget()
        identity = self.identity
        if not _session_allowed(self.database, identity, self.session_id, self.session_hash):
            raise ValueError('semantic_session_unavailable')
        with self.database.connect() as c:
            c.execute("SET LOCAL statement_timeout = '1000ms'")
            c.execute("SET LOCAL lock_timeout = '200ms'")
            user = lock_account(c, self.database, identity.user_id,
                                caller='live_semantic_prepare', patience_ms=PREPARE_LOCK_MS)
            cloud, model, _ = cloud_selection(c, user, 'auto', 'medium')
            conversation_model = model
            from .uony_semantic_recovery_store import model_for_thread
            model = model_for_thread(c, self.settings, user, identity.thread_id, cloud, model)
            if cloud['project_id'] != identity.project_id:
                raise ValueError('semantic_project_changed')
            voice = c.execute('''SELECT text,finalized_by,created_at FROM uony_live_turns
                WHERE user_id=%s AND thread_id=%s AND session_id=%s AND turn_id=%s
                  AND role='user' ''', (identity.user_id, identity.thread_id,
                                        self.session_id, event.turn_id)).fetchone()
            if not voice or voice['text'] != event.text.strip():
                raise ValueError('semantic_turn_mismatch')
            selected = c.execute('''SELECT folder_metadata FROM uony_product_intakes
                WHERE user_id=%s AND thread_id=%s AND google_subject=%s AND status='identified'
                ORDER BY created_at DESC LIMIT 1''',
                (identity.user_id, identity.thread_id, identity.google_subject)).fetchone()
            selected = selected['folder_metadata'] if selected else None
            prior = semantic_thread_history(c, identity, voice['created_at'])
            digest = sha256(event.text.strip().encode()).hexdigest()
            existing = c.execute('''SELECT text_sha256,state,decision,usage FROM uony_live_semantic_receipts
                WHERE user_id=%s AND session_id=%s AND turn_id=%s''',
                (identity.user_id, self.session_id, event.turn_id)).fetchone()
            if existing:
                if existing['text_sha256'] != digest or existing['state'] != 'success':
                    raise ValueError('semantic_attempt_already_reserved')
                require_receipt_budget(existing['usage'])
                return cloud, model, prior, selected, restore_decision(
                    existing['decision'], event.text.strip(), selected_folder=selected)
            require_semantic_budget()
            budget = CURRENT_BUDGET.get()
            usage = {'semanticDeadlineAt': budget.expires_at} if budget else {}
            from .uony_semantic_recovery_store import capture
            from .uony_routes import Message, ExpectedAssignmentFocus
            product = c.execute('SELECT project_id FROM uony_threads WHERE user_id=%s AND id=%s',
                (identity.user_id, identity.thread_id)).fetchone()
            body = Message(requestId=request_id_for_turn(self.session_id, event.turn_id),
                threadId=identity.thread_id, text=event.text.strip(), projectId=product['project_id'],
                expectedAssignmentFocus=ExpectedAssignmentFocus(
                    assignmentId=identity.focus_assignment_id, version=identity.focus_version)
                    if identity.focus_assignment_id else None)
            capture(c, user, body, cloud, prior, selected, channel='voice',
                created_at=voice['created_at'], deadline=budget.expires_at if budget else time.time()+20,
                model=conversation_model, semantic_model=model)
            c.execute('''INSERT INTO uony_live_semantic_receipts
                (user_id,thread_id,session_id,turn_id,text_sha256,state,usage)
                VALUES(%s,%s,%s,%s,%s,'started',%s)''',
                (identity.user_id, identity.thread_id, self.session_id, event.turn_id, digest, Jsonb(usage)))
            require_semantic_budget()
            return cloud, model, prior, selected, None

    def _finish(self, event, state, usage, elapsed, decision=None):
        with self.database.connect() as c:
            c.execute("SET LOCAL statement_timeout = '200ms'")
            if state == 'success':
                require_semantic_budget()
            row = c.execute('''SELECT state,usage FROM uony_live_semantic_receipts
                WHERE user_id=%s AND session_id=%s AND turn_id=%s FOR UPDATE''',
                (self.identity.user_id, self.session_id, event.turn_id)).fetchone()
            if not row or (state == 'success' and row['state'] != 'started'):
                return
            from .uony_semantic_recovery_store import finish_attempt, initial_attempt, validate_model
            if state == 'success':
                validate_model(c, self.settings, self.identity.user_id,
                    request_id_for_turn(self.session_id, event.turn_id))
            accepted = finish_attempt(c, self.identity.user_id,
                initial_attempt(request_id_for_turn(self.session_id, event.turn_id)),
                state, usage, decision)
            if state == 'success' and not accepted:
                raise ValueError('semantic_attempt_fenced')
            from .uony_semantic_failure import merge_semantic_usage
            merged = merge_semantic_usage(row['usage'], usage)
            c.execute('''UPDATE uony_live_semantic_receipts SET state=%s,usage=%s,
                elapsed_ms=%s,decision=%s,updated_at=now()
                WHERE user_id=%s AND session_id=%s AND turn_id=%s''',
                (state, Jsonb(merged), elapsed,
                 Jsonb(serialize_decision(decision, event.text.strip())) if decision else None,
                 self.identity.user_id, self.session_id, event.turn_id))
            if state == 'unknown':
                # A timed-out outer task can publish its notice first. Late
                # accounting may settle counters, never restore action authority.
                request_id = request_id_for_turn(self.session_id, event.turn_id)
                for table in ('uony_requests', 'uony_conversation_jobs'):
                    c.execute(f'''UPDATE {table} SET usage=usage || %s::jsonb
                        WHERE user_id=%s AND request_id=%s AND error_code='semantic_failure' ''',
                        (Jsonb(merged), self.identity.user_id, request_id))
            if state == 'success':
                # A cancelled to_thread call can still return. Roll back its
                # result rather than granting authority to a fenced attempt.
                require_semantic_budget()

    async def __call__(self, event):
        budget = CURRENT_BUDGET.get() or SemanticBudget()
        context = CURRENT_BUDGET.set(budget)
        try:
            return await self._interpret(event, budget)
        finally:
            CURRENT_BUDGET.reset(context)

    def _dispatch(self, event):
        from .uony_semantic_recovery_store import mark_dispatched, initial_attempt, validate_model
        with self.database.connect() as c:
            c.execute("SET LOCAL statement_timeout='200ms'")
            validate_model(c, self.settings, self.identity.user_id,
                request_id_for_turn(self.session_id, event.turn_id))
            mark_dispatched(c, self.identity.user_id,
                initial_attempt(request_id_for_turn(self.session_id, event.turn_id)))

    async def _interpret(self, event, budget):
        total_started = budget.started
        self._trace(event, 'prepare_started', total_started,
            remainingMs=round(budget.remaining()*1000, 3), reserveMs=RESERVE_SECONDS*1000)
        try:
            cloud, model, history, selected, replay = await bounded(
                asyncio.to_thread(self._prepare, event), budget.remaining(RESERVE_SECONDS),
                budget=budget)
        except BaseException as error:
            error.semantic_phase = 'preparation'
            self._trace(event, 'prepare_failed', total_started,
                        **semantic_error_diagnostics(error))
            raise
        self._trace(event, 'prepared', total_started)
        if replay is not None:
            budget.require()
            self._trace(event, 'receipt_replayed', total_started)
            return replay
        start = time.monotonic()
        observed_usage = {}
        provider_timeout_ms = None
        phase, phase_started = 'authentication', start
        try:
            self._trace(event, 'authentication_started', total_started)
            refresh = self.provider.cipher.decrypt(cloud['refresh_encrypted'].encode()).decode()
            token = await bounded(asyncio.to_thread(self.provider.cloud.refresh, refresh),
                                  budget.remaining(RESERVE_SECONDS), budget=budget)
            self._trace(event, 'authenticated', total_started, durationMs=_elapsed(phase_started))
            phase, phase_started = 'connection_revalidation', time.monotonic()
            current = await bounded(asyncio.to_thread(self.provider._connection, self.identity),
                                    budget.remaining(RESERVE_SECONDS), budget=budget)
            if any(current[key] != cloud[key] for key in
                   ('google_subject', 'project_id', 'connected_at', 'refresh_encrypted')):
                raise ValueError('semantic_connection_changed')
            self._trace(event, 'connection_revalidated', total_started,
                        durationMs=_elapsed(phase_started))
            phase, phase_started = 'classification', time.monotonic()
            self._trace(event, 'classification_started', total_started)
            budget.require()
            remaining = budget.remaining(RESERVE_SECONDS)
            if remaining <= 0:
                from .uony_semantic_failure import SemanticDeadlineExceeded
                raise SemanticDeadlineExceeded('semantic deadline expired')
            await bounded(asyncio.to_thread(self._dispatch, event),
                          budget.remaining(RESERVE_SECONDS), budget=budget)
            # One attempt with the whole remaining time. Vertex receives this as
            # its server deadline: a shorter per-attempt cap produced 504s.
            remaining = budget.remaining(RESERVE_SECONDS + ADMISSION_RESERVE_SECONDS)
            if remaining <= 0:
                from .uony_semantic_failure import SemanticDeadlineExceeded
                raise SemanticDeadlineExceeded('semantic deadline expired')
            provider_timeout_ms = round(remaining * 1000)
            decision = await classify(token, self.identity.project_id, model,
                event.text.strip(), history, selected, timeout_seconds=remaining)
            observed_usage = decision.usage
            budget.require()
            self._trace(event, 'classified', total_started, durationMs=_elapsed(phase_started),
                        providerTimeoutMs=provider_timeout_ms,
                        usage=_usage_diagnostics(decision.usage))
            phase, phase_started = 'persist_success', time.monotonic()
            await bounded(asyncio.to_thread(self._finish, event, 'success', decision.usage,
                int((time.monotonic()-start)*1000), decision), budget.remaining(), budget=budget)
            budget.require()
            self._trace(event, 'receipt_write_returned', total_started,
                        requestedState='success', durationMs=_elapsed(phase_started))
            return decision
        except BaseException as error:
            error.semantic_phase = phase
            from .uony_semantic_failure import merge_semantic_usage
            error.usage = merge_semantic_usage(observed_usage, getattr(error, 'usage', {}))
            # Cancellation after reservation is uncertain; it is never replayed
            # automatically just because another socket resumes the same turn.
            self._trace(event, 'failed', total_started, failedPhase=phase,
                durationMs=_elapsed(phase_started), usage=_usage_diagnostics(getattr(error, 'usage', {})),
                **({'providerTimeoutMs': provider_timeout_ms} if provider_timeout_ms else {}),
                **semantic_error_diagnostics(error))
            finishing = time.monotonic()
            try:
                await bounded(asyncio.to_thread(self._finish, event, 'unknown',
                    getattr(error, 'usage', {}), int((time.monotonic()-start)*1000)),
                    PERSIST_RESERVE_SECONDS)
            except BaseException as persistence_error:
                self._trace(event, 'receipt_write_failed', total_started,
                    requestedState='unknown', durationMs=_elapsed(finishing),
                    **semantic_error_diagnostics(persistence_error))
                # Do not replace the original provider failure with a failed
                # attempt to save it, and never claim the receipt was written.
                error.semantic_persistence_failed = True
                raise error from None
            self._trace(event, 'receipt_write_returned', total_started,
                        requestedState='unknown', durationMs=_elapsed(finishing))
            raise


@dataclass(frozen=True)
class SemanticResolution:
    event: object
    decision: object = None
    error: SemanticFailure | None = None
    handled: object = field(default=None, compare=False)
    budget: object = field(default=None, compare=False)


class SemanticEventStream:
    """Merge completions into the reducer without blocking VAD or playback cuts."""
    def __init__(self, interpreter, sender, thread_id):
        self.interpreter, self.sender, self.thread_id = interpreter, sender, thread_id
        self.queue = asyncio.Queue()
        self.tasks = {}
        self.latest = {}
        self.tail = None
        self.budgets = {}

    async def progress(self, turn_id, phase):
        await self.sender.event({'type': 'turn_progress', 'threadId': self.thread_id,
                                 'turnId': turn_id, 'phase': phase})

    async def start(self, event):
        self.latest[event.turn_id] = event
        task = self.tasks.get(event.turn_id)
        if task is not None:
            return
        budget = self.budgets[event.turn_id] = SemanticBudget()
        previous = self.tail
        handled = asyncio.Event()
        async def resolve():
            context = CURRENT_BUDGET.set(budget)
            phase = 'dependency'
            try:
                if previous is not None:
                    await bounded(previous.wait(), budget.remaining(RESERVE_SECONDS), budget=budget)
                phase = 'classification'
                decision = await bounded(self.interpreter(event), budget.remaining(), budget=budget)
                budget.require()
                await self.queue.put(SemanticResolution(self.latest[event.turn_id], decision,
                                                         handled=handled, budget=budget))
            except asyncio.CancelledError:
                handled.set()
                raise
            except Exception as error:
                budget.invalidate()
                await self.queue.put(SemanticResolution(self.latest[event.turn_id],
                    error=SemanticFailure.from_error(error, phase), handled=handled, budget=budget))
            finally:
                CURRENT_BUDGET.reset(context)
        self.tail = handled
        self.tasks[event.turn_id] = asyncio.create_task(resolve())
        try:
            await self.progress(event.turn_id, 'interpreting')
        except BaseException:
            budget.invalidate()
            self.tasks[event.turn_id].cancel()
            handled.set()
            raise

    async def advance(self, turn_id):
        # A new utterance cuts playback, not an already final instruction.
        # Completions remain ordered so a follow-up status sees its prior job.
        return None

    async def events(self, session):
        iterator = session.events().__aiter__()
        upstream = asyncio.create_task(anext(iterator))
        resolved = asyncio.create_task(self.queue.get())
        try:
            while True:
                done, _ = await asyncio.wait((upstream, resolved), return_when=asyncio.FIRST_COMPLETED)
                # Provider boundaries win a tie: a newly speaking customer must
                # not lose the microphone to a completion of their prior turn.
                if upstream in done:
                    try:
                        event = upstream.result()
                    except StopAsyncIteration:
                        break
                    yield event
                    upstream = asyncio.create_task(anext(iterator))
                if resolved in done:
                    yield resolved.result()
                    resolved = asyncio.create_task(self.queue.get())
        finally:
            for budget in self.budgets.values():
                budget.invalidate()
            tasks = [upstream, resolved, *self.tasks.values()]
            for task in tasks:
                task.cancel()
            await asyncio.wait(tasks, timeout=PERSIST_RESERVE_SECONDS)
            for task in tasks:
                if not task.done():
                    from .uony_semantic_failure import consume_task
                    task.add_done_callback(consume_task)
