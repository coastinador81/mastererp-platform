"""Shared voice/text recovery ledger. A command never supplies its target ID."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from uuid import UUID, uuid4, uuid5
from psycopg.types.json import Jsonb
from .google_cloud_provider import CloudError
from .uony_assignments import focus_snapshot
from .product_memory import project as product_memory
from .uony_followup_store import fingerprint
from .uony_semantic_decision import DRIVE_ACTIONS, serialize_decision
from .uony_semantic_failure import merge_semantic_usage

NAMESPACE = UUID('8f83ab35-eb93-4d3c-a8da-739905941578')


def initial_attempt(request_id):
    return uuid5(NAMESPACE, 'semantic:' + str(request_id))


def selected_folder(c, user, thread_id):
    row = c.execute('''SELECT folder_metadata FROM uony_product_intakes
        WHERE user_id=%s AND thread_id=%s AND google_subject=%s AND status='identified'
        ORDER BY created_at DESC LIMIT 1''',
        (user['id'], thread_id, user['google_subject'])).fetchone()
    return row['folder_metadata'] if row else None


def current_scope(c, user, body, cloud):
    current = c.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s',
                        (user['id'],)).fetchone()
    if (not current or current['status'] != 'connected'
            or current['google_subject'] != user['google_subject']
            or current['project_id'] != cloud['project_id']):
        raise CloudError('google_changed')
    drive = c.execute('''SELECT google_subject,status,connected_at,scope,refresh_encrypted
        FROM google_drive_connections WHERE user_id=%s''', (user['id'],)).fetchone()
    drive_value = {k: str(v) for k, v in (drive or {}).items()}
    drive_digest = sha256(json.dumps(drive_value, sort_keys=True).encode()).hexdigest()
    focus, version = focus_snapshot(c, user, body.threadId)
    thread = c.execute('''SELECT project_id,deleted_at,product_history_cutoff_at
        FROM uony_threads WHERE user_id=%s AND id=%s''', (user['id'], body.threadId)).fetchone()
    if (not thread or thread['deleted_at'] or user.get('deletion_requested_at')
            or current['google_subject'] != user['google_subject']):
        raise CloudError('google_changed')
    return {'connection': fingerprint(current), 'drive': drive_digest,
        'productProject': str(thread['project_id']) if thread['project_id'] else None,
        'historyCutoff': str(thread['product_history_cutoff_at']),
        'focusId': str(focus) if focus else None, 'focusVersion': version,
        'memory': product_memory(c, user, body.threadId),
        'selectedFolder': selected_folder(c, user, body.threadId)}


def model_for_thread(c, settings, user, thread_id, cloud, conversation_model):
    """The canonical thread project, not an optional client field, selects a pilot."""
    from .uony_semantic_model import semantic_model
    thread = c.execute('SELECT project_id,deleted_at FROM uony_threads WHERE user_id=%s AND id=%s',
                       (user['id'], thread_id)).fetchone()
    fresh = c.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s', (user['id'],)).fetchone()
    if (not thread or thread['deleted_at'] or not fresh or fresh['status'] != 'connected'
            or fresh['google_subject'] != user['google_subject'] or fresh['project_id'] != cloud['project_id']):
        raise CloudError('google_changed')
    return semantic_model(settings, user, fresh, thread['project_id'], conversation_model)


def validate_model(c, settings, user_id, logical_id):
    from .uony_context import cloud_selection
    row = c.execute('''SELECT r.snapshot,r.thread_id,a.effective_semantic_model
        FROM uony_semantic_requests r JOIN uony_semantic_attempts a
          ON a.user_id=r.user_id AND a.semantic_attempt_id=r.current_attempt_id
        WHERE r.user_id=%s AND r.logical_request_id=%s''', (user_id, logical_id)).fetchone()
    if not row or row['effective_semantic_model'] is None:
        return  # Pre-ledger jobs do not acquire a new inference or recovery right.
    user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
    body = row['snapshot']['body']
    cloud, selected, _ = cloud_selection(c, user, body.get('model','auto'), body.get('effort','medium'))
    effective = model_for_thread(c, settings, user, row['thread_id'], cloud, selected)
    if effective != row['effective_semantic_model']:
        raise CloudError('model_changed')


def capture(c, user, body, cloud, history, selected, *, channel, created_at, deadline,
            model=None, semantic_model=None):
    """Call before inference, under the account lock, never reconstruct legacy input."""
    attempt = initial_attempt(body.requestId)
    scope = current_scope(c, user, body, cloud)
    snapshot = {'body': body.model_dump(mode='json'), 'history': list(history)[-8:],
                'selectedFolder': selected, 'conversationModel': model,
                'effectiveSemanticModel': semantic_model or model}
    existing = c.execute('''SELECT snapshot FROM uony_semantic_requests
        WHERE user_id=%s AND logical_request_id=%s''', (user['id'], body.requestId)).fetchone()
    if existing:
        if existing['snapshot']['body'] != snapshot['body']:
            raise CloudError('invalid_response')
        return attempt
    c.execute('''INSERT INTO uony_semantic_requests(user_id,logical_request_id,thread_id,
        google_subject,project_id,channel,snapshot,scope,current_attempt_id,created_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, user['google_subject'], cloud['project_id'],
         channel, Jsonb(snapshot), Jsonb(scope), attempt, created_at))
    c.execute('''INSERT INTO uony_semantic_attempts(user_id,semantic_attempt_id,
        logical_request_id,state,deadline_at,effective_semantic_model)
        VALUES(%s,%s,%s,'started',%s,%s)''',
        (user['id'], attempt, body.requestId, datetime.fromtimestamp(deadline, timezone.utc),
         semantic_model or model))
    return attempt


def mark_dispatched(c, user_id, attempt_id):
    changed = c.execute('''UPDATE uony_semantic_attempts a SET
        usage=usage || '{"attemptedCalls":1,"uncertainCalls":1}'::jsonb,updated_at=now()
        FROM uony_semantic_requests r WHERE a.user_id=%s AND a.semantic_attempt_id=%s
          AND a.state='started' AND a.deadline_at>now() AND r.user_id=a.user_id
          AND r.logical_request_id=a.logical_request_id AND r.current_attempt_id=a.semantic_attempt_id
          AND COALESCE((a.usage->>'attemptedCalls')::integer,0)=0
        RETURNING a.semantic_attempt_id''', (user_id, attempt_id)).fetchone()
    if not changed:
        raise CloudError('semantic_timeout')


def account_usage(c, user_id, attempt_id, usage):
    row = c.execute('''SELECT usage FROM uony_semantic_attempts WHERE user_id=%s
        AND semantic_attempt_id=%s FOR UPDATE''', (user_id, attempt_id)).fetchone()
    if row:
        c.execute('''UPDATE uony_semantic_attempts SET usage=%s,updated_at=now()
            WHERE user_id=%s AND semantic_attempt_id=%s''',
            (Jsonb(merge_semantic_usage(row['usage'], usage)), user_id, attempt_id))


def not_dispatched(c, user_id, attempt_id):
    """Only a live caller that never entered transport can clear its reservation."""
    c.execute('''UPDATE uony_semantic_attempts SET usage=usage ||
        '{"attemptedCalls":0,"calls":0,"uncertainCalls":0}'::jsonb
        WHERE user_id=%s AND semantic_attempt_id=%s AND state='started'
          AND COALESCE((usage->>'calls')::integer,0)=0''', (user_id, attempt_id))


def finish_attempt(c, user_id, attempt_id, state, usage, decision=None):
    row = c.execute('''SELECT a.*,r.current_attempt_id,r.snapshot
        FROM uony_semantic_attempts a JOIN uony_semantic_requests r
          ON r.user_id=a.user_id AND r.logical_request_id=a.logical_request_id
        WHERE a.user_id=%s AND a.semantic_attempt_id=%s FOR UPDATE OF a,r''',
        (user_id, attempt_id)).fetchone()
    if not row:
        return False
    merged = merge_semantic_usage(row['usage'], usage)
    active = (row['state'] == 'started' and row['current_attempt_id'] == attempt_id
              and row['deadline_at'] > datetime.now(timezone.utc))
    accepted = state == 'success' and active
    saved_state = state if state != 'success' else 'success' if accepted else 'unknown'
    if row['state'] != 'started':
        saved_state = row['state']
    envelope = serialize_decision(decision, row['snapshot']['body']['text']) if accepted else None
    c.execute('''UPDATE uony_semantic_attempts SET state=%s,usage=%s,
        decision=COALESCE(%s,decision),updated_at=now()
        WHERE user_id=%s AND semantic_attempt_id=%s''',
        (saved_state, Jsonb(merged), Jsonb(envelope) if envelope else None, user_id, attempt_id))
    if accepted:
        c.execute('''UPDATE uony_semantic_requests SET action=%s,is_control=%s
            WHERE user_id=%s AND logical_request_id=%s AND current_attempt_id=%s''',
            (decision.action, decision.action == 'recover_request', user_id,
             row['logical_request_id'], attempt_id))
    return accepted


def reserve(c, user, body, cloud, deadline):
    """Resolve one prior input, lock it, then reconcile before considering inference."""
    previous = c.execute('''SELECT * FROM uony_semantic_recovery_commands
        WHERE user_id=%s AND recovery_command_id=%s''', (user['id'], body.requestId)).fetchone()
    if previous:
        return {'replay': True, 'logical_request_id': previous['logical_request_id']}
    current = c.execute('''SELECT created_at FROM uony_semantic_requests
        WHERE user_id=%s AND logical_request_id=%s''', (user['id'], body.requestId)).fetchone()
    before = current['created_at'] if current else datetime.now(timezone.utc)
    row = c.execute('''SELECT * FROM uony_semantic_requests WHERE user_id=%s AND thread_id=%s
        AND google_subject=%s AND project_id=%s AND logical_request_id<>%s
        AND created_at<%s AND NOT is_control ORDER BY created_at DESC LIMIT 1 FOR UPDATE''',
        (user['id'], body.threadId, user['google_subject'], cloud['project_id'],
         body.requestId, before)).fetchone()
    # A changed topic, unsupported operation, or pre-ledger request is not a target.
    if not row or row['action'] is not None and row['action'] not in DRIVE_ACTIONS:
        return None
    logical = row['logical_request_id']
    newer = c.execute('''SELECT 1 FROM uony_requests q WHERE q.user_id=%s AND q.thread_id=%s
        AND q.created_at>%s AND q.created_at<%s AND q.request_id NOT IN (%s,%s)
        AND NOT EXISTS(SELECT 1 FROM uony_semantic_requests control
          WHERE control.user_id=q.user_id AND control.logical_request_id=q.request_id AND control.is_control)
        LIMIT 1''', (user['id'], body.threadId, row['created_at'], before, body.requestId, logical)).fetchone()
    if newer:
        return None
    disposition, attempt = 'blocked', None
    valid_scope = current_scope(c, user, body, cloud) == row['scope']
    business = (c.execute('''SELECT status FROM uony_conversation_jobs
        WHERE user_id=%s AND request_id=%s''',
        (user['id'], row['business_request_id'])).fetchone() if row['business_request_id'] else None)
    if valid_scope and row['business_request_id']:
        disposition = ('reused' if business and business['status'] == 'success' else
                       'observing' if business and business['status'] in ('queued','running')
                       else 'reconciliation_required')
        attempt = row['current_attempt_id']
    elif valid_scope:
        prior = c.execute('''SELECT * FROM uony_semantic_attempts WHERE user_id=%s
            AND semantic_attempt_id=%s FOR UPDATE''', (user['id'], row['current_attempt_id'])).fetchone()
        if (row['action'] is None and prior['state'] == 'started'
                and prior['recovery_command_id'] is None
                and prior['deadline_at'] > datetime.now(timezone.utc)):
            # This turn may itself become a recovery command. Until its initial
            # meaning is known, do not invent an original-request relationship.
            return None
        if prior['state'] == 'started' and prior['deadline_at'] > datetime.now(timezone.utc):
            disposition, attempt = 'observing', prior['semantic_attempt_id']
        elif deadline > datetime.now(timezone.utc).timestamp():
            c.execute('''UPDATE uony_semantic_attempts SET state='unknown',updated_at=now()
                WHERE user_id=%s AND semantic_attempt_id=%s AND state='started' ''',
                (user['id'], prior['semantic_attempt_id']))
            attempt = uuid4()
            c.execute('''INSERT INTO uony_semantic_attempts(user_id,semantic_attempt_id,
                logical_request_id,recovery_command_id,state,deadline_at,effective_semantic_model)
                VALUES(%s,%s,%s,%s,'started',%s,%s)''',
                (user['id'], attempt, logical, body.requestId,
                 datetime.fromtimestamp(deadline, timezone.utc), row['snapshot'].get('effectiveSemanticModel')))
            c.execute('''UPDATE uony_semantic_requests SET current_attempt_id=%s
                WHERE user_id=%s AND logical_request_id=%s''', (attempt, user['id'], logical))
            disposition = 'observing'
            row['reserved'] = True
    c.execute('''INSERT INTO uony_semantic_recovery_commands(user_id,recovery_command_id,
        logical_request_id,semantic_attempt_id,disposition) VALUES(%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, logical, attempt, disposition))
    return {**row, 'semantic_attempt_id': attempt}


def admit(c, user, logical_id, request_id, attempt_id, *, settings=None):
    validate_model(c, settings, user['id'], logical_id)
    row = c.execute('''SELECT r.*,a.state,a.deadline_at,a.decision
        FROM uony_semantic_requests r JOIN uony_semantic_attempts a
          ON a.user_id=r.user_id AND a.semantic_attempt_id=r.current_attempt_id
        WHERE r.user_id=%s AND r.logical_request_id=%s FOR UPDATE OF r''',
        (user['id'], logical_id)).fetchone()
    if not row:
        return  # Legacy jobs keep their existing guards, never gain recovery authority.
    if row['business_request_id']:
        if row['business_request_id'] != request_id:
            raise CloudError('execution_unknown')
        return
    action = (row['decision'] or {}).get('decision', {}).get('action')
    if (row['current_attempt_id'] != attempt_id or row['state'] != 'success'
            or row['deadline_at'] <= datetime.now(timezone.utc) or action not in DRIVE_ACTIONS):
        raise CloudError('invalid_response')
    c.execute('''UPDATE uony_semantic_requests SET business_execution_id=%s,
        business_request_id=%s,execution_state='admitted' WHERE user_id=%s AND logical_request_id=%s''',
        (uuid5(NAMESPACE, 'business:' + str(logical_id)), request_id, user['id'], logical_id))
    c.execute('''UPDATE uony_semantic_recovery_commands SET disposition='reclassified'
        WHERE user_id=%s AND recovery_command_id=%s AND semantic_attempt_id=%s''',
        (user['id'], request_id, attempt_id))


def begin_effect(c, user, job, body=None, *, settings=None):
    row = c.execute('''SELECT execution_state,scope,logical_request_id FROM uony_semantic_requests
        WHERE user_id=%s AND business_request_id=%s FOR UPDATE''',
        (user['id'], job['request_id'])).fetchone()
    if not row:
        return
    validate_model(c, settings, user['id'], row['logical_request_id'])
    if row['execution_state'] != 'admitted':
        raise CloudError('execution_unknown')
    if body is not None and current_scope(c, user, body, {'project_id': job['project_id']}) != row['scope']:
        raise CloudError('google_changed')
    c.execute('''UPDATE uony_semantic_requests SET execution_state='started',execution_lease_token=%s
        WHERE user_id=%s AND business_request_id=%s''',
        (job['lease_token'], user['id'], job['request_id']))


def metadata(c, user, command_id):
    row = c.execute('''SELECT k.*,r.business_execution_id,r.business_request_id,j.status,
        attempt.recovery_command_id AS observed_request_id
        FROM uony_semantic_recovery_commands k JOIN uony_semantic_requests r
          ON r.user_id=k.user_id AND r.logical_request_id=k.logical_request_id
        LEFT JOIN uony_conversation_jobs j
          ON j.user_id=r.user_id AND j.request_id=r.business_request_id
        LEFT JOIN uony_semantic_attempts attempt ON attempt.user_id=k.user_id
          AND attempt.semantic_attempt_id=k.semantic_attempt_id
        WHERE k.user_id=%s AND k.recovery_command_id=%s AND r.google_subject=%s''',
        (user['id'], command_id, user['google_subject'])).fetchone()
    if not row:
        return None
    return {key: str(row[name]) if row[name] is not None else None for key, name in (
        ('logicalRequestId','logical_request_id'), ('recoveryCommandId','recovery_command_id'),
        ('semanticAttemptId','semantic_attempt_id'), ('businessExecutionId','business_execution_id'),
        ('businessRequestId','business_request_id'))} | {
            'disposition': row['disposition'], 'businessStatus':
            'unknown' if row['status'] == 'cancelled' else row['status'],
            'observedRequestId': str(row['observed_request_id'])
                if row['disposition']=='observing' and row['observed_request_id'] else None}


def reply(c, user, command_id):
    data = metadata(c, user, command_id)
    if data is None:
        return '¿Qué petición de Drive quieres recuperar? No puedo identificar una solicitud anterior inequívoca.'
    disposition = data['disposition']
    if disposition == 'reused':
        result = c.execute('''SELECT reply FROM uony_requests WHERE user_id=%s AND request_id=%s''',
                           (user['id'], data['businessRequestId'])).fetchone()
        return 'Recupero el resultado guardado de la petición anterior, sin repetirla: ' + (result['reply'] or '')
    if disposition == 'observing':
        return ('La petición anterior sigue en curso. Consulto su estado; no he iniciado otra ejecución.'
                if data['businessRequestId'] else
                'La recuperación anterior sigue interpretándose. No he iniciado otro intento ni otra ejecución.')
    if disposition == 'reconciliation_required':
        return 'No puedo confirmar el resultado de la petición anterior. Conservo su ejecución y no la repetiré.'
    return 'El contexto, la conexión o el tiempo disponible cambió. No he recuperado ni repetido la petición anterior.'
