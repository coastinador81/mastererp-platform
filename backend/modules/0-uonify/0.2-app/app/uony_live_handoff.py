"""Route a *final* voice turn into the existing durable Uony conversation.

The model may classify an intent, but the server supplies the exact persisted
customer words. Downstream server code evaluates whether those words authorize
a specific action; this boundary never trusts the model's intent as permission.
"""
import re
import unicodedata
from uuid import UUID, uuid5
from psycopg.types.json import Jsonb

from fastapi import HTTPException

from .access import workspace_access
from .google_cloud_provider import SCOPE
from .product_memory import project as product_memory
from .uony_assignments import focus_snapshot
from .uony_context import cloud_selection
from .uony_conversation_queue import ConversationQueue
from .uony_engine import enabled_engines, selected_engine
from .uony_live_bridge import _session_allowed
from .uony_admission_budget import admission_budget, daily_count
from .uony_semantic_failure import CURRENT_BUDGET, require_semantic_budget, require_receipt_budget
from .uony_account_lock import lock_account
from .uony_refusal import refused


INTENTS = frozenset({'create_product', 'use_drive_materials', 'creative_plan', 'semantic_request',
                     'drive_request'})
MAX_HANDOFFS_PER_SESSION = 8
# Admission waits for the account lock like any other writer of this account.
# A 200 ms wait failed a correctly interpreted turn (LockNotAvailable,
# 20-10-2026 01:10:34 UTC); the voice interpreter reserves this time for it.
ADMISSION_STATEMENT_MS = 1500
ADMISSION_LOCK_MS = 1000
ADMISSION_FLOOR_MS = 300
REQUEST_NAMESPACE = UUID('b5b1988d-895f-4fb8-bfd8-8994caee8ccc')


def request_id_for_turn(session_id: str, turn_id: str) -> UUID:
    """Stable across duplicate tool calls, socket loss and process restarts."""
    return uuid5(REQUEST_NAMESPACE, f'{UUID(session_id)}:{UUID(turn_id)}')


def _spoken_quote(value):
    """Tolerate whitespace and a final full stop, not meaning-bearing commas.

    In particular, "No quiero" and "No, quiero" must never compare equal.
    Question marks, negations, accents and internal punctuation stay intact.
    """
    value = unicodedata.normalize('NFKC', value).casefold().strip()
    value = re.sub(r'\s+', ' ', value)
    value = re.sub(r'\s*([,;:!?¿¡])\s*', r'\1 ', value).strip()
    return value[:-1].rstrip() if value.endswith('.') else value


def route_final_turn(database, settings, identity, session_id, session_hash,
                     turn_id, intent, spoken_text, *, semantic_decision=None, drive_scope=None):
    require_semantic_budget()
    # A typed Drive request carries its own server-resolved scope (audit F0.1).
    if intent not in INTENTS or (intent == 'drive_request') != (drive_scope is not None):
        return {'status': 'blocked', 'reason': 'invalid_intent'}
    if intent == 'use_drive_materials':
        # Untyped Drive admissions are closed on every route (audit F0.2/F0.3):
        # only the typed drive_request with a server-emitted scope remains.
        return {'status': 'blocked', 'reason': 'drive_unavailable'}
    if not isinstance(spoken_text, str) or not 1 <= len(spoken_text) <= 3000:
        return {'status': 'blocked', 'reason': 'invalid_quote'}
    try:
        UUID(session_id)
        UUID(turn_id)
    except (ValueError, TypeError, AttributeError):
        return {'status': 'blocked', 'reason': 'invalid_turn'}
    if (identity.user_id not in settings.live_pilot_user_ids or
            not _session_allowed(database, identity, session_id, session_hash)):
        return {'status': 'blocked', 'reason': 'session_unavailable'}

    with database.connect() as c:
        budget = CURRENT_BUDGET.get()
        if budget:
            # The classifier leaves admission its own reserve; the floor only
            # prevents a ~1 ms timeout at the very edge of the turn deadline.
            millis = max(ADMISSION_FLOOR_MS, min(ADMISSION_STATEMENT_MS,
                                                 int(budget.remaining()*1000)))
            c.execute("SELECT set_config('statement_timeout',%s,true)", (str(millis),))
            c.execute("SELECT set_config('lock_timeout',%s,true)", (str(min(200, millis)),))
            # Serializes admission, deletion and competing Live sockets for this
            # account. This is the same owner lock used by /uony/messages.
            user = lock_account(c, database, identity.user_id, caller='live_admission',
                                patience_ms=min(ADMISSION_LOCK_MS, millis))
        else:
            user = c.execute('''SELECT * FROM users WHERE id=%s FOR UPDATE''',
                             (identity.user_id,)).fetchone()
        if (not user or user['deletion_requested_at'] or
                user['google_subject'] != identity.google_subject or
                not user.get('onboarding_completed_at') or
                workspace_access(c, user)['status'] != 'allowed'):
            return {'status': 'blocked', 'reason': 'access_changed'}
        session = c.execute('''SELECT 1 FROM uony_live_sessions
            WHERE user_id=%s AND session_id=%s AND thread_id=%s
              AND expires_at>now()''',
            (user['id'], session_id, identity.thread_id)).fetchone()
        thread = c.execute('''SELECT project_id,deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s FOR SHARE''',
            (user['id'], identity.thread_id)).fetchone()
        cloud = c.execute('''SELECT google_subject,project_id,status,scope,project_check
            FROM google_cloud_connections WHERE user_id=%s''',
            (user['id'],)).fetchone()
        if (not session or not thread or thread['deleted_at'] or not cloud or
                cloud['google_subject'] != identity.google_subject or
                cloud['project_id'] != identity.project_id or
                cloud['status'] != 'connected' or
                not (cloud['project_check'] or {}).get('ready') or
                SCOPE not in (cloud['scope'] or '').split()):
            return {'status': 'blocked', 'reason': 'connection_changed'}

        voice = c.execute('''SELECT text,finalized_by FROM uony_live_turns
            WHERE user_id=%s AND thread_id=%s AND session_id=%s
              AND turn_id=%s AND role='user' FOR SHARE''',
            (user['id'], identity.thread_id, session_id, turn_id)).fetchone()
        if not voice:
            return {'status': 'blocked', 'reason': 'final_transcript_required'}
        exact = _spoken_quote(voice['text'])
        if _spoken_quote(spoken_text) != exact:
            return {'status': 'blocked', 'reason': 'turn_mismatch'}
        semantic_receipt = c.execute('''SELECT usage FROM uony_live_semantic_receipts
            WHERE user_id=%s AND session_id=%s AND turn_id=%s''',
            (user['id'], session_id, turn_id)).fetchone() if semantic_decision is not None else None
        if refused(exact):
            if intent != 'semantic_request':
                return {'status': 'blocked', 'reason': 'intent_not_confirmed'}
        decision = None
        if intent == 'semantic_request':
            from .uony_semantic_decision import restore_decision
            from .uony_live_provenance import voice_action_allowed
            try:
                decision = restore_decision(semantic_decision, voice['text'])
            except Exception:
                return {'status': 'blocked', 'reason': 'semantic_decision_required'}
            if (decision.action != 'conversation'
                    and not voice_action_allowed(decision.action, voice['finalized_by'])):
                return {'status': 'blocked', 'reason': 'final_transcript_required'}
            if refused(exact) and decision.action not in ('clarify', 'conversation', 'work_status'):
                return {'status': 'blocked', 'reason': 'intent_not_confirmed'}
        elif semantic_decision is not None:
            return {'status': 'blocked', 'reason': 'unexpected_semantic_decision'}
        else:
            from .uony_live_provenance import (PRIMARY_METADATA_SOURCES, PRIMARY_ACTION_SOURCES,
                                               METADATA_OPERATIONS)
            # The typed operation, never the words, sets the evidence bar:
            # reading content and every non-Drive action need the primary final
            # (audit F0.2); only Drive metadata accepts a read-only boundary.
            allowed = (PRIMARY_METADATA_SOURCES if drive_scope is not None and
                       drive_scope['operation'] in METADATA_OPERATIONS else PRIMARY_ACTION_SOURCES)
            if voice['finalized_by'] not in allowed:
                return {'status': 'blocked', 'reason': 'final_transcript_required'}

        request_id = request_id_for_turn(session_id, turn_id)
        previous = c.execute('''SELECT intent,google_subject,google_project_id,
                thread_id,request_id,semantic_decision FROM uony_live_handoffs
            WHERE user_id=%s AND session_id=%s AND turn_id=%s''',
            (user['id'], session_id, turn_id)).fetchone()
        if previous:
            # ADK-FLUJOS T03: the semantic route and a Live tool call may both
            # admit this turn. The first admission governs; the other recovers
            # its single receipt whatever intent it proposed, never a new job.
            if (previous['google_subject'] != identity.google_subject or
                    previous['google_project_id'] != identity.project_id or
                    previous['thread_id'] != identity.thread_id or
                    previous['request_id'] != request_id):
                return {'status': 'blocked', 'reason': 'turn_already_routed'}
            try:
                state = ConversationQueue(database, enabled_engines(settings),
                    getattr(settings, 'conversation_active_limit', 256)).inspect(c, user, request_id)
            except HTTPException as error:
                # A repeated provider call can arrive after the queue record
                # disappears or is no longer visible. The durable handoff
                # still proves admission: never enqueue it again, and do not
                # end the voice socket over an unavailable prior result.
                if error.status_code != 404:
                    raise
                return {'status': 'blocked', 'reason': 'request_not_found'}
            return {'status': state['status'], 'requestId': str(request_id),
                    'threadId': identity.thread_id, 'turnId': turn_id, 'replayed': True}

        if semantic_receipt:
            require_receipt_budget(semantic_receipt['usage'])

        used = c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
            WHERE user_id=%s AND session_id=%s''',
            (user['id'], session_id)).fetchone()['n']
        if used >= MAX_HANDOFFS_PER_SESSION:
            return {'status': 'blocked', 'reason': 'session_handoff_limit'}
        # Match /uony/messages: a synchronous structured action may be running
        # without a queue row. Do not admit a voice request across that action.
        recovery_observation = (decision is not None and decision.action == 'recover_request'
            and c.execute('''SELECT 1 FROM uony_conversation_jobs WHERE user_id=%s
                AND status IN ('queued','running')''', (user['id'],)).fetchone())
        snapshot = decision is not None and (decision.action in ('work_status', 'clarify')
                                             or recovery_observation)
        if not snapshot and c.execute('''SELECT 1 FROM uony_requests WHERE user_id=%s
            AND status='running' AND created_at>now()-interval '4 minutes' ''',
            (user['id'],)).fetchone():
            return {'status': 'blocked', 'reason': 'busy'}

        focus_id, focus_version = focus_snapshot(c, user, identity.thread_id)
        bound_focus = (identity.focus_assignment_id, identity.focus_version)
        current_focus = (str(focus_id) if focus_id else None, focus_version)
        if current_focus != bound_focus:
            # A prior handoff in this *same* Live session may have created an
            # assignment and advanced focus. Permit exactly those transitions,
            # never an intervening selection from another tab or workflow.
            own_focus = c.execute('''SELECT a.id FROM uony_assignments a
                JOIN uony_live_handoffs h ON h.user_id=a.user_id
                    AND h.request_id=a.origin_request_id
                WHERE h.user_id=%s AND h.session_id=%s AND h.thread_id=%s
                  AND a.google_subject=%s
                ORDER BY h.created_at DESC,a.created_at DESC,a.id DESC''',
                (user['id'], session_id, identity.thread_id,
                 identity.google_subject)).fetchall()
            expected_version = identity.focus_version + len(own_focus)
            if (not own_focus or focus_version != expected_version or
                    str(own_focus[0]['id']) != current_focus[0]):
                return {'status': 'blocked', 'reason': 'focus_changed'}

        # Only the customer's plain words enter the queue here. Downstream
        # action handling must validate access and any action-specific scope;
        # the model's intent label is never an approval by itself.
        from .uony_routes import ExpectedAssignmentFocus, Message
        expected_focus = (ExpectedAssignmentFocus(assignmentId=focus_id,
            version=focus_version) if focus_id else None)
        body = Message(requestId=request_id, threadId=identity.thread_id,
            text=voice['text'], projectId=thread['project_id'], model='auto',
            effort='medium', expectedAssignmentFocus=expected_focus)
        count = daily_count(c, user)
        if count >= admission_budget(settings, user, thread['project_id']):
            return {'status': 'blocked', 'reason': 'daily_limit'}
        try:
            row, selected, reason = cloud_selection(c, user, body.model, body.effort)
            queue = ConversationQueue(database, enabled_engines(settings),
                getattr(settings, 'conversation_active_limit', 256))
            # to_thread inherits the shared attempt fence. A late worker may
            # finish reads, but it must not admit a new action after expiry.
            require_semantic_budget()
            if semantic_receipt:
                require_receipt_budget(semantic_receipt['usage'])
            if decision:
                from .uony_semantic_recovery_store import validate_model
                validate_model(c, settings, user['id'], request_id)
            if snapshot:
                from .uony_semantic_work_status import record_status_snapshot
                if recovery_observation:
                    from .uony_semantic_recovery_store import reserve
                    reserve(c, user, body, row, 0)
                result = record_status_snapshot(c, user, body, row, selected, reason,
                    product_memory(c, user, identity.thread_id),
                    selected_engine(settings, user['id']), decision)
            else:
                result = queue.enqueue(c, user, body, row, selected, reason,
                    product_memory(c, user, identity.thread_id),
                    selected_engine(settings, user['id']),
                    allowed_engines=enabled_engines(settings, user['id']))
        except HTTPException as error:
            detail = error.detail if isinstance(error.detail, dict) else {}
            return {'status': 'blocked', 'reason': detail.get('error', 'admission_failed')}

        c.execute('''INSERT INTO uony_live_handoffs
            (user_id,thread_id,session_id,turn_id,request_id,google_subject,
             google_project_id,intent,semantic_decision,drive_operation)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (user['id'], identity.thread_id, session_id, turn_id, request_id,
             identity.google_subject, identity.project_id, intent,
             Jsonb(semantic_decision) if semantic_decision else None,
             drive_scope['operation'] if drive_scope else None))
        if drive_scope and drive_scope['operation'] != 'access':
            # Emitted in the same transaction as the admission (audit F0.1, 2b).
            from .uony_drive_scope import emit
            emit(c, user['id'], request_id, drive_scope['operation'], drive_scope['kind'],
                 drive_scope['target'], source='voice_call')
        if decision and decision.action.startswith('drive_') and decision.action != 'drive_assist':
            from .uony_semantic_recovery_store import admit, initial_attempt
            admit(c, user, request_id, request_id, initial_attempt(request_id), settings=settings)
        # Raising inside the connection context rolls back an admission that
        # expired during SQL. Already committed jobs are never cancelled here.
        require_semantic_budget()
        if semantic_receipt:
            require_receipt_budget(semantic_receipt['usage'])
        return {'status': result['status'], 'requestId': str(request_id),
                'threadId': identity.thread_id, 'turnId': turn_id, 'replayed': False}
