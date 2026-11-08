"""Report persisted work for the requested action without re-executing it."""
from .uony_account_lock import lock_account
from .uony_semantic_decision import restore_decision
from .google_cloud_provider import CloudError

# Saving the failure notice and reconciling an uncertain admission wait for the
# account lock like admission does. At 150-200 ms both failed on 20-10-2026 and
# the customer read «No se ha podido confirmar el guardado del aviso».
NOTICE_LOCK_MS = 1000
NOTICE_PERSIST_SECONDS = 1.6
RECONCILE_LOCK_MS = 1000
RECONCILE_SECONDS = 1.6

_ACTION_NAMES = {
    'drive_access': 'comprobación de acceso a Drive',
    'drive_count': 'recuento de carpetas de Drive',
    'drive_search': 'búsqueda de carpeta en Drive',
    'drive_analyze': 'análisis de documentos de Drive',
}

# Lote 6 (A1e, «Consultor google»): a written job is known by the scope the
# server emitted for it, never by the words of its prompt.
_SCOPE_ACTIONS = {'access': 'drive_access', 'count': 'drive_count',
                  'list': 'drive_search', 'read': 'drive_analyze'}


def _action(row):
    if row.get('semantic_decision') is not None:
        try:
            return restore_decision(row['semantic_decision'], row['prompt'],
                                    selected_folder={'id': 'already-bound'}).action
        except CloudError:
            return None
    return _SCOPE_ACTIONS.get(row.get('scope_operation'))


def status_reply(connection, user, job, body, decision):
    """The lookup is fenced by tenant, Google identity, project and thread.

    A count-status question cannot reuse the most recent access-check job. The
    question's own queued job and future jobs are excluded from this lookup.
    """
    wanted = decision.status_action
    label = _ACTION_NAMES[wanted]
    rows = connection.execute('''SELECT r.request_id,
            COALESCE(logical.snapshot->'body'->>'text',r.prompt) AS prompt,r.reply,r.status,
            r.material_analysis,COALESCE(v.created_at,r.created_at) AS created_at,j.status AS job_status,
            COALESCE(attempt.decision,h.semantic_decision,j.semantic_decision) AS semantic_decision,
            scope.operation AS scope_operation
        FROM uony_requests r JOIN uony_conversation_jobs j
          ON j.user_id=r.user_id AND j.request_id=r.request_id
        LEFT JOIN uony_drive_scopes scope
          ON scope.user_id=r.user_id AND scope.request_id=r.request_id
        LEFT JOIN uony_live_handoffs h
          ON h.user_id=r.user_id AND h.request_id=r.request_id
        LEFT JOIN uony_semantic_requests logical ON logical.user_id=r.user_id
          AND logical.business_request_id=r.request_id
        LEFT JOIN uony_semantic_attempts attempt ON attempt.user_id=logical.user_id
          AND attempt.semantic_attempt_id=logical.current_attempt_id
        LEFT JOIN uony_live_turns v ON v.user_id=h.user_id AND v.session_id=h.session_id
          AND v.turn_id=h.turn_id AND v.role='user'
        WHERE r.user_id=%s AND r.thread_id=%s AND j.google_subject=%s
          AND j.project_id=%s AND r.request_id<>%s
          AND r.created_at<=(SELECT created_at FROM uony_requests
              WHERE user_id=%s AND request_id=%s)
        ORDER BY COALESCE(v.created_at,r.created_at) DESC,r.request_id DESC LIMIT 40''',
        (user['id'], body.threadId, user['google_subject'], job['project_id'],
         job['request_id'], user['id'], job['request_id'])).fetchall()
    matching = next((row for row in rows if _action(row) == wanted), None)
    latest_failure = connection.execute('''SELECT r.usage,COALESCE(v.created_at,r.created_at) AS created_at
        FROM uony_requests r JOIN uony_conversation_jobs j
          ON j.user_id=r.user_id AND j.request_id=r.request_id
        LEFT JOIN uony_live_handoffs h ON h.user_id=r.user_id AND h.request_id=r.request_id
        LEFT JOIN uony_live_turns v ON v.user_id=h.user_id AND v.session_id=h.session_id
          AND v.turn_id=h.turn_id AND v.role='user'
        WHERE r.user_id=%s AND r.thread_id=%s AND j.google_subject=%s AND j.project_id=%s
          AND r.request_id<>%s AND j.status IN ('error','unknown')
          AND r.usage ? 'semanticFailure'
          AND r.created_at<=(SELECT created_at FROM uony_requests WHERE user_id=%s AND request_id=%s)
        ORDER BY COALESCE(v.created_at,r.created_at) DESC LIMIT 1''',
        (user['id'], body.threadId, user['google_subject'], job['project_id'],
         job['request_id'], user['id'], job['request_id'])).fetchone()
    if latest_failure and (matching is None or latest_failure['created_at'] >= matching['created_at']):
        from .uony_semantic_failure import saved_semantic_failure
        failed = saved_semantic_failure(latest_failure['usage'])
        if failed:
            # No guessed action for an uninterpreted turn. State the known
            # failure and never use an older result as its completion evidence.
            return failed['message'] + (f' El resultado anterior del {label} no confirma el estado de esta petición.'
                                        if matching is not None else '')
    latest_attempt = connection.execute('''SELECT h.request_id,v.created_at
        FROM uony_live_semantic_receipts s JOIN uony_live_turns v
          ON v.user_id=s.user_id AND v.thread_id=s.thread_id
          AND v.session_id=s.session_id AND v.turn_id=s.turn_id AND v.role='user'
        LEFT JOIN uony_live_handoffs h ON h.user_id=s.user_id
          AND h.session_id=s.session_id AND h.turn_id=s.turn_id
        WHERE s.user_id=%s AND s.thread_id=%s AND s.state='success'
          AND s.decision->'decision'->>'action'=%s
          AND v.created_at<=(SELECT created_at FROM uony_requests
              WHERE user_id=%s AND request_id=%s)
        ORDER BY v.created_at DESC,s.turn_id DESC LIMIT 1''',
        (user['id'],body.threadId,wanted,user['id'],job['request_id'])).fetchone()
    # A newer interpreted-but-blocked turn must not inherit an older success.
    # Legacy written work may legitimately be newer than the last voice receipt.
    if (latest_attempt and (matching is None or
            latest_attempt['created_at']>matching['created_at']) and
            (matching is None or latest_attempt['request_id']!=matching['request_id'])):
        matching=None
    if matching is None:
        # Lote 6 (A1e): a written job not scoped yet has no known action; it is
        # still the work in progress, never «no hay … iniciado».
        unknown = next((row for row in rows if row['job_status'] in ('queued', 'running')
                        and _action(row) is None), None)
        if unknown:
            where = 'está en la cola' if unknown['job_status'] == 'queued' else 'se está ejecutando'
            return f'Tu petición anterior {where}. Aún no hay un resultado final.'
        article = 'una' if wanted in ('drive_access','drive_search') else 'un'
        ending='iniciada' if article=='una' else 'iniciado'
        return f'No hay {article} {label} {ending} en esta conversación.'
    state = matching['job_status']
    material = matching.get('material_analysis')
    if wanted == 'drive_analyze' and isinstance(material, dict) and material.get('jobId'):
        analysis = connection.execute('''SELECT status FROM product_material_jobs
            WHERE user_id=%s AND id=%s AND google_subject=%s AND project_id=%s''',
            (user['id'], material['jobId'], user['google_subject'], job['project_id'])).fetchone()
        if analysis:
            state = analysis['status']
            if state == 'ready':
                return 'El análisis de documentos ya terminó. Su resultado está guardado en esta conversación.'
    if state == 'queued':
        return f'El {label} está en la cola, pendiente de ejecución.'
    if state == 'running':
        return f'El {label} se está ejecutando. Aún no hay un resultado final.'
    if state == 'success' and matching.get('reply'):
        return matching['reply']
    return f'El {label} no terminó correctamente. Conservamos la solicitud; no he iniciado otra ejecución.'


def record_status_snapshot(c, user, body, cloud, selected, reason, memory, engine, decision):
    """Persist a read-only answer while the owner's real job remains active.

    Caller holds the owner row lock and has already validated thread, Google
    identity, session and final transcript. This is not execution admission:
    snapshots start terminal, never acquire a worker lease or provider attempt.
    """
    from fastapi import HTTPException
    from psycopg.types.json import Jsonb
    from .uony_conversation_queue import ConversationQueue
    from .uony_engine import ENGINES

    if (decision.action not in ('work_status', 'clarify', 'recover_request') or engine not in ENGINES
            or decision.evidence != body.text.strip()
            or cloud['google_subject'] != user['google_subject']):
        raise CloudError('invalid_response')
    previous = ConversationQueue.visible(c, user, body.requestId)
    if previous:
        if (previous['prompt'] != body.text or previous['thread_id'] != body.threadId
                or previous['project_id'] != cloud['project_id']):
            raise HTTPException(409, detail={'error': 'request_conflict'})
        return ConversationQueue.pending(body.requestId, body.threadId, previous['status'])
    c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,
        model,project_id,requested_model,effort,selection_reason,product_context)
        VALUES(%s,%s,%s,%s,'success',%s,%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, body.text, selected, cloud['project_id'],
         body.model, body.effort, reason,
         Jsonb(body.productContext.model_dump() if body.productContext else None)))
    job = {'project_id': cloud['project_id'], 'request_id': body.requestId}
    reply = (status_reply(c, user, job, body, decision) if decision.action == 'work_status'
             else decision.clarification or '¿Qué necesitas que haga y sobre qué carpeta?')
    if decision.action == 'recover_request':
        from .uony_semantic_recovery_store import reply as recovery_reply
        reply = recovery_reply(c, user, body.requestId)
    c.execute('''UPDATE uony_requests SET reply=%s WHERE user_id=%s AND request_id=%s''',
              (reply, user['id'], body.requestId))
    c.execute('''INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
        google_subject,project_id,payload,memory_snapshot,engine,status,
        progress_stage,progress_seq,finished_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,'success','saved',1,now())''',
        (user['id'], body.requestId, body.threadId, user['google_subject'],
         cloud['project_id'], Jsonb(body.model_dump(mode='json')), Jsonb(memory), engine))
    return ConversationQueue.pending(body.requestId, body.threadId, 'success')


def record_semantic_failure(database, settings, identity, session_id, session_hash,
                            event, failure):
    """Store a terminal technical notice, never an execution or clarification.

    The handoff row supplies stable recovery correlation only. Error jobs cannot
    be claimed and provider consumption remains in the semantic receipt ledger.
    """
    from psycopg.types.json import Jsonb
    from .uony_live_bridge import _session_allowed
    from .uony_live_handoff import request_id_for_turn
    from .uony_engine import selected_engine
    from .uony_semantic_failure import saved_semantic_failure, merge_semantic_usage
    if (identity.user_id not in settings.live_pilot_user_ids or
            not _session_allowed(database, identity, session_id, session_hash)):
        raise ValueError('semantic_session_unavailable')
    request_id = request_id_for_turn(session_id, event.turn_id)
    with database.connect() as c:
        c.execute("SET LOCAL statement_timeout = '200ms'")
        c.execute("SET LOCAL lock_timeout = '200ms'")
        owner = lock_account(c, database, identity.user_id,
                             caller='semantic_failure_notice', patience_ms=NOTICE_LOCK_MS)
        thread = c.execute('''SELECT project_id,deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s FOR SHARE''',
            (identity.user_id, identity.thread_id)).fetchone()
        voice = c.execute('''SELECT text,created_at FROM uony_live_turns WHERE user_id=%s
            AND thread_id=%s AND session_id=%s AND turn_id=%s AND role='user' ''',
            (identity.user_id, identity.thread_id, session_id, event.turn_id)).fetchone()
        if (not owner or owner['deletion_requested_at'] or
                owner['google_subject'] != identity.google_subject or not thread or
                thread['deleted_at'] or not voice or voice['text'] != event.text.strip()):
            raise ValueError('semantic_failure_identity_changed')
        previous = c.execute('''SELECT status,usage FROM uony_requests
            WHERE user_id=%s AND request_id=%s''', (identity.user_id, request_id)).fetchone()
        if previous:
            if previous['status'] != 'error' or not saved_semantic_failure(previous['usage']):
                # Never overwrite an action that admission already committed.
                raise ValueError('semantic_failure_already_admitted')
            return saved_semantic_failure(previous['usage'])
        receipt = c.execute('''SELECT usage FROM uony_live_semantic_receipts
            WHERE user_id=%s AND session_id=%s AND turn_id=%s FOR UPDATE''',
            (identity.user_id, session_id, event.turn_id)).fetchone()
        usage = {**merge_semantic_usage((receipt or {}).get('usage'), failure.usage),
                 'semanticFailure': failure.payload()}
        from .uony_semantic_recovery_store import finish_attempt, initial_attempt
        finish_attempt(c, identity.user_id, initial_attempt(request_id), 'unknown', failure.usage)
        c.execute('''UPDATE uony_live_semantic_receipts SET state='unknown',
            usage=usage || %s::jsonb,decision=NULL,updated_at=now()
            WHERE user_id=%s AND session_id=%s AND turn_id=%s''',
            (Jsonb(usage), identity.user_id, session_id, event.turn_id))
        payload = {'requestId': str(request_id), 'threadId': identity.thread_id,
            'text': event.text.strip(), 'projectId': str(thread['project_id']) if thread['project_id'] else None,
            'model': 'auto', 'effort': 'medium'}
        c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,
            model,project_id,requested_model,effort,selection_reason,reply,usage,error_code,created_at)
            VALUES(%s,%s,%s,%s,'error','auto',%s,'auto','medium','semantic_failure',%s,%s,'semantic_failure',%s)''',
            (identity.user_id, request_id, identity.thread_id, event.text.strip(),
             identity.project_id, failure.payload()['message'], Jsonb(usage), voice['created_at']))
        c.execute('''INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
            google_subject,project_id,payload,memory_snapshot,engine,status,
            progress_stage,progress_seq,finished_at,error_code,usage)
            VALUES(%s,%s,%s,%s,%s,%s,'[]'::jsonb,%s,'error','saved',1,now(),'semantic_failure',%s)''',
            (identity.user_id, request_id, identity.thread_id, identity.google_subject,
             identity.project_id, Jsonb(payload), selected_engine(settings, owner['id']), Jsonb(usage)))
        c.execute('''INSERT INTO uony_live_handoffs(user_id,thread_id,session_id,turn_id,
            request_id,google_subject,google_project_id,intent)
            VALUES(%s,%s,%s,%s,%s,%s,%s,'semantic_request')''',
            (identity.user_id, identity.thread_id, session_id, event.turn_id,
             request_id, identity.google_subject, identity.project_id))
    return saved_semantic_failure(usage)


async def deliver_semantic_failure(router, event, failure):
    import asyncio
    import logging
    from .uony_live_handoff import request_id_for_turn
    from .uony_semantic_failure import bounded, PERSIST_RESERVE_SECONDS
    logger = logging.getLogger(__name__)
    turn = event.event
    packet = {'type': 'semantic_failure', 'threadId': router.identity.thread_id,
        'turnId': turn.turn_id,
        'requestId': str(request_id_for_turn(router.session_id, turn.turn_id)),
        **failure.payload()}
    # ADK-FLUJOS §3/T03: one admission rules, so the notice waits for the
    # durable answer. A Live call that already admitted this turn wins; telling
    # «No he iniciado ninguna acción» would contradict running work (real voice,
    # 20-10-2026).
    try:
        saved = await bounded(asyncio.to_thread(record_semantic_failure, router.database,
            router.settings, router.identity, router.session_id, router.session_hash,
            turn, failure), NOTICE_PERSIST_SECONDS)
        persistence = 'saved'
        packet.update(saved or {})
    except ValueError as error:
        if str(error) == 'semantic_failure_already_admitted':
            logger.warning('Live semantic failure superseded by an admitted turn')
            return
        persistence = 'unknown'
        logger.warning('Live semantic notice persistence failed: %s', type(error).__name__)
    except Exception as error:
        persistence = 'unknown'
        logger.warning('Live semantic notice persistence failed: %s', type(error).__name__)
    try:
        await bounded(router.sender.event({**packet, 'persistence': persistence}),
                      PERSIST_RESERVE_SECONDS)
    except Exception as error:
        logger.warning('Live semantic notice send failed: %s', type(error).__name__)


def reconcile_semantic_admission(database, identity, session_id, turn_id):
    """Owner lock waits for any in-flight admission before proving absence."""
    from .uony_live_handoff import request_id_for_turn
    request_id = request_id_for_turn(session_id, turn_id)
    with database.connect() as c:
        c.execute("SET LOCAL statement_timeout = '200ms'")
        c.execute("SET LOCAL lock_timeout = '150ms'")
        user = lock_account(c, database, identity.user_id, caller='admission_reconcile',
                            patience_ms=RECONCILE_LOCK_MS, columns='google_subject')
        if not user or user['google_subject'] != identity.google_subject:
            raise ValueError('semantic_admission_identity_changed')
        row = c.execute('''SELECT j.status FROM uony_conversation_jobs j
            JOIN uony_threads t ON t.user_id=j.user_id AND t.id=j.thread_id
            JOIN uony_live_handoffs h ON h.user_id=j.user_id AND h.request_id=j.request_id
            WHERE j.user_id=%s AND j.request_id=%s AND j.thread_id=%s
              AND j.google_subject=%s AND j.project_id=%s AND t.deleted_at IS NULL
              AND h.session_id=%s AND h.turn_id=%s''',
            (identity.user_id, request_id, identity.thread_id, identity.google_subject,
             identity.project_id, session_id, turn_id)).fetchone()
        if not row:
            return None
        return {'status': row['status'], 'requestId': str(request_id),
            'threadId': identity.thread_id, 'turnId': turn_id, 'replayed': False}


async def deliver_admission_unknown(router, event):
    """Unavailable reconciliation is not evidence that execution never began."""
    import logging
    from .uony_live_handoff import request_id_for_turn
    from .uony_semantic_failure import SemanticFailure, bounded, PERSIST_RESERVE_SECONDS
    failure = SemanticFailure('admission', 'admission', 'semantic_admission_unknown')
    try:
        await bounded(router.sender.event({'type': 'semantic_failure',
            'threadId': router.identity.thread_id, 'turnId': event.turn_id,
            'requestId': str(request_id_for_turn(router.session_id, event.turn_id)),
            **failure.payload(), 'persistence': 'unknown'}), PERSIST_RESERVE_SECONDS)
    except Exception as error:
        logging.getLogger(__name__).warning('Live uncertain admission notice failed: %s', type(error).__name__)



def late_verified_read(database, identity, session_id, event):
    """Reuse only an exact, completed read decision after primary corroboration."""
    from hashlib import sha256
    from .uony_live_provenance import PRIMARY_ACTION_SOURCES
    from .uony_semantic_failure import require_receipt_budget, SemanticDeadlineExceeded
    if event.finalized_by not in PRIMARY_ACTION_SOURCES:
        return None
    text = event.text.strip()
    with database.connect() as connection:
        receipt = connection.execute('''SELECT r.decision,r.usage
            FROM uony_live_semantic_receipts r JOIN uony_live_turns t
              ON t.user_id=r.user_id AND t.thread_id=r.thread_id
             AND t.session_id=r.session_id AND t.turn_id=r.turn_id AND t.role=r.role
            WHERE r.user_id=%s AND r.thread_id=%s AND r.session_id=%s AND r.turn_id=%s
              AND r.role='user' AND r.state='success' AND r.text_sha256=%s
              AND t.text=%s AND t.finalized_by IN ('provider_finished','primary_vad_closed')''',
            (identity.user_id, identity.thread_id, session_id, event.turn_id,
             sha256(text.encode()).hexdigest(), text)).fetchone()
    if not receipt:
        return None
    try:
        require_receipt_budget(receipt['usage'])
        decision = restore_decision(receipt['decision'], text)
    except (CloudError, TypeError, ValueError, SemanticDeadlineExceeded):
        return None
    from .uony_live_provenance import METADATA_ACTIONS
    return decision if decision.action in METADATA_ACTIONS else None


async def corroborate_late_primary(router, event, routed, recovered, answer):
    """Primary evidence after its caption-classified turn resolved may only
    finish that exact completed read; it never starts another classification.

    Applies to the current turn too: on 20-10-2026 a spoken Drive read whose
    primary transcript arrived after the caption-based resolution was dropped
    silently because only previous turns were corroborated.
    """
    import asyncio
    import logging
    from .uony_live_provenance import PRIMARY_ACTION_SOURCES
    from .uony_semantic_failure import SemanticBudget, bounded, PERSIST_RESERVE_SECONDS
    logger = logging.getLogger(__name__)
    if (event.finalized_by not in PRIMARY_ACTION_SOURCES or event.turn_id in routed
            or event.turn_id in recovered):
        return
    try:
        decision = await bounded(asyncio.to_thread(late_verified_read, router.database,
            router.identity, router.session_id, event), PERSIST_RESERVE_SECONDS)
    except Exception as error:
        logger.warning('Live late primary read failed: %s', type(error).__name__)
        return
    if decision is None:
        return
    recovered.add(event.turn_id)
    logger.info('Live late primary corroborated action=%s turn_id=%s',
                decision.action, event.turn_id)
    start_semantic_handler(router, answer(None, event.turn_id, 'semantic_request',
        event.text.strip(), decision, historical=router.ordinary.previous_turn(event.turn_id)),
        router.semantic.budgets.get(event.turn_id) or SemanticBudget())



async def admit_semantic_turn(router, turn_id, intent, spoken_text, decision, route, *, drive=None):
    import asyncio
    import logging
    from .uony_semantic_failure import CURRENT_BUDGET, bounded, PERSIST_RESERVE_SECONDS, SemanticFailure
    from .uony_live_semantic import SemanticResolution
    from .uony_live_bridge import LiveTranscript
    from .uony_semantic_decision import serialize_decision
    logger = logging.getLogger(__name__)
    if decision is not None and decision.action.startswith('drive_'):
        # Audit F0.1-F0.3: Drive is admitted only through the typed Live call
        # with a server-emitted scope. The raw route has none (fail-closed until
        # F3); on the ADK route the interpreter keeps only server metadata.
        if getattr(getattr(router, 'session', None), 'tool_owner', None) != 'adk':
            return {'status': 'blocked', 'reason': 'drive_unavailable'}
        if decision.action in ('drive_assist', 'drive_analyze'):
            return None
    budget = CURRENT_BUDGET.get()
    async def admit():
        return await asyncio.to_thread(route, router.database, router.settings,
            router.identity, router.session_id, router.session_hash, turn_id, intent, spoken_text,
            **({'semantic_decision': serialize_decision(decision, spoken_text)}
               if decision is not None else {}), **({'drive_scope': drive} if drive else {}))
    try:
        outcome = (await bounded(admit(), budget.remaining(), budget=budget)
                   if budget else await admit())
    except Exception as error:
        if not budget:
            raise
        budget.invalidate()
        logger.warning('Live admission failed, reconciling: %s', type(error).__name__)
        try:
            outcome = await bounded(asyncio.to_thread(reconcile_semantic_admission,
                router.database, router.identity, router.session_id, turn_id), RECONCILE_SECONDS)
        except Exception:
            await deliver_admission_unknown(router,
                LiveTranscript('user', turn_id, spoken_text))
            return
        if outcome is None:
            resolution = SemanticResolution(LiveTranscript('user', turn_id, spoken_text))
            await deliver_semantic_failure(router, resolution,
                SemanticFailure('admission', 'admission', 'semantic_admission_failed'))
            return
    return outcome


async def observe_handoff(router, outcome, turn_id, call_id, decision, historical):
    import logging
    from .uony_semantic_failure import bounded, PERSIST_RESERVE_SECONDS
    logger = logging.getLogger(__name__)
    historical = (historical or turn_id != router.audio_gate.turn_id
                  or router.ordinary.previous_turn(turn_id))
    # Drive closed on this route, or the refusal veto: the server says a fixed
    # text, never the model and never «repeat» («Consultor google» F0, Q2 and
    # veto condition c). The tool answer tells the model not to repeat it.
    server_notice = (not outcome.get('requestId') and
                     outcome.get('reason') in ('drive_unavailable', 'intent_not_confirmed'))
    if server_notice:
        outcome = {**outcome, 'notice': 'server'}
    try:
        await bounded(router.delivery.watch(outcome, turn_id, call_id, announce=not historical),
                      PERSIST_RESERVE_SECONDS)
    except Exception as error:
        logger.warning('Live delivery watch failed: %s', type(error).__name__)
    if outcome.get('requestId') and not outcome.get('replayed'):
        try:
            await bounded(router.sender.event({'type': 'handoff',
                'turnId': outcome['turnId'], 'requestId': outcome['requestId'],
                'threadId': outcome['threadId'], 'status': outcome['status'],
                **({'intent': decision.action} if decision is not None else {})}),
                PERSIST_RESERVE_SECONDS)
        except Exception as error:
            logger.warning('Live handoff delivery failed: %s', type(error).__name__)
    elif server_notice:
        from .uony_drive_scope import DRIVE_NOTICES
        logger.warning('Live admission blocked reason=%s turn_id=%s', outcome['reason'], turn_id)
        await bounded(router.delivery.speech.say_notice(turn_id, DRIVE_NOTICES[outcome['reason']]),
                      PERSIST_RESERVE_SECONDS)
    elif decision is not None and not outcome.get('requestId'):
        # Only codes: the customer's words never reach this log.
        logger.warning('Live admission blocked reason=%s action=%s turn_id=%s',
                       outcome.get('reason'), decision.action, turn_id)
        # Only a hearing doubt asks to repeat aloud; «busy» and other admission
        # blocks keep the written notice (real voice, 20-10-2026: «¿Cómo va?»).
        await bounded(router.delivery.unconfirmed(turn_id, decision.evidence,
            intent='semantic_request',
            speak=outcome.get('reason') == 'final_transcript_required'),
            PERSIST_RESERVE_SECONDS)


def start_semantic_handler(router, awaitable, budget=None):
    import asyncio
    from .uony_semantic_failure import CURRENT_BUDGET, consume_task
    context = CURRENT_BUDGET.set(budget)
    try:
        task = asyncio.create_task(awaitable)
    finally:
        CURRENT_BUDGET.reset(context)
    router.semantic_handlers.add(task)
    task.add_done_callback(router.semantic_handlers.discard)
    task.add_done_callback(consume_task)
