"""Durable read-only followup receipts and exact-target status snapshots."""
from hashlib import sha256
from psycopg.types.json import Jsonb
from .uony_conversation_queue import ConversationQueue, error
from .uony_queue_state import safe_usage
from .uony_semantic_decision import serialize_decision
from .uony_semantic_work_status import _action, _ACTION_NAMES
from .uony_admission_budget import daily_count


def fingerprint(cloud):
    values = (cloud['google_subject'], cloud['project_id'],
              str(cloud['connected_at']), cloud['refresh_encrypted'])
    return sha256('\0'.join(values).encode()).hexdigest()


def expire(c, user):
    # A lost HTTP process cannot prove whether Google accepted its inference.
    # Expiration unlocks further questions, never replays this same request ID.
    c.execute('''UPDATE uony_written_followups SET state='unknown',
        error_code='consumption_unknown',finished_at=now(),updated_at=now(),
        usage=CASE WHEN provider_started_at IS NULL THEN usage
          ELSE usage || '{"attemptedCalls":1,"uncertainCalls":1}'::jsonb END
        WHERE user_id=%s AND state='started'
          AND deadline_at<now() ''', (user['id'],))


def visible(c, user, request_id):
    return c.execute('''SELECT f.* FROM uony_written_followups f
        JOIN uony_threads t ON t.user_id=f.user_id AND t.id=f.thread_id
        LEFT JOIN uony_projects p ON p.user_id=t.user_id AND p.id=t.project_id
        JOIN google_cloud_connections g ON g.user_id=f.user_id
        WHERE f.user_id=%s AND f.request_id=%s AND f.google_subject=%s
          AND g.google_subject=f.google_subject AND g.project_id=f.project_id
          AND g.status='connected' AND f.created_at>=g.connected_at
          AND t.deleted_at IS NULL
          AND (t.project_id IS NULL OR p.deleted_at IS NULL)
          AND (t.product_history_cutoff_at IS NULL
               OR f.created_at>=t.product_history_cutoff_at)''',
        (user['id'], request_id, user['google_subject'])).fetchone()


def inspect(c, user, request_id, queue):
    expire(c, user)
    row = visible(c, user, request_id)
    if not row:
        if c.execute('SELECT 1 FROM uony_written_followups WHERE user_id=%s AND request_id=%s',
                     (user['id'], request_id)).fetchone():
            raise error('request_not_found', 'Esta consulta pertenece a otra conexión o conversación.', 404)
        return None
    if row['state'] == 'success':
        return {**queue.inspect(c, user, request_id),
                'targetRequestId': str(row['target_request_id'])}
    state = 'running' if row['state'] == 'started' else row['state']
    result = queue.pending(request_id, row['thread_id'], state)
    result['targetRequestId'] = str(row['target_request_id'])
    result['progress'] = {'stage': 'consulting_google' if row['provider_started_at'] else 'preparing',
                          'seq': 1 if state == 'running' else 2, 'timingsMs': {}}
    if state != 'running':
        result['error'] = {'code': row['error_code'] or 'google_unavailable',
            'message': ('No pude confirmar esta consulta de estado. No la repetiré '
                        'automáticamente. El trabajo original conserva su estado.')}
    return result


def recent(c, user, queue):
    expire(c, user)
    rows = c.execute('''SELECT request_id FROM uony_written_followups
        WHERE user_id=%s AND state<>'success'
          AND (created_at>now()-interval '7 days' OR state='started')
        ORDER BY created_at DESC LIMIT 50''', (user['id'],)).fetchall()
    result = []
    for item in rows:
        row = visible(c, user, item['request_id'])
        if row:
            result.append({**inspect(c, user, row['request_id'], queue),
                'text': row['payload']['text'], 'model': row['model'],
                'effort': row['payload']['effort'], 'createdAt': row['created_at'].isoformat()})
    return result


def annotate_recent(c, user, requests):
    targets = c.execute('''SELECT request_id,target_request_id FROM uony_written_followups
        WHERE user_id=%s AND request_id=ANY(%s::uuid[])''',
        (user['id'], [item['requestId'] for item in requests])).fetchall()
    targets = {str(row['request_id']): str(row['target_request_id']) for row in targets}
    for item in requests:
        if item['requestId'] in targets:
            item['targetRequestId'] = targets[item['requestId']]


def history(c, user):
    """Keep the customer's text after an uncertain interpretation, without a job.

    There is no assistant/model answer to reconstruct. GET/recent retain the
    actual receipt and error; the thread retains only what the customer said.
    """
    rows = c.execute('''SELECT f.request_id,f.target_request_id,f.thread_id,
            f.payload->>'text' AS text,f.state,f.created_at
        FROM uony_written_followups f JOIN uony_threads t
          ON t.user_id=f.user_id AND t.id=f.thread_id
        LEFT JOIN uony_projects p ON p.user_id=t.user_id AND p.id=t.project_id
        JOIN google_cloud_connections g ON g.user_id=f.user_id
        WHERE f.user_id=%s AND f.google_subject=%s AND f.state<>'success'
          AND g.google_subject=f.google_subject AND g.project_id=f.project_id
          AND g.status='connected' AND f.created_at>=g.connected_at
          AND t.deleted_at IS NULL
          AND (t.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
          AND (t.product_history_cutoff_at IS NULL
               OR f.created_at>=t.product_history_cutoff_at)
        ORDER BY f.created_at DESC,f.request_id DESC LIMIT 200''',
        (user['id'], user['google_subject'])).fetchall()
    return [(row['thread_id'], row['created_at'], {'role': 'user', 'text': row['text'],
        'requestId': str(row['request_id']), 'targetRequestId': str(row['target_request_id']),
        'requestStatus': 'running' if row['state'] == 'started' else row['state']})
        for row in rows]


def target_reply(c, user, target, decision):
    """Only the referenced durable request can answer this question; no I/O."""
    if decision.action == 'clarify':
        return decision.clarification or '¿Qué quieres consultar sobre la solicitud en curso?'
    if decision.action != 'work_status':
        return ('La solicitud anterior sigue su propio recorrido. Durante su ejecución '
                'puedo consultar su estado; esta nueva petición no se ha ejecutado. '
                'Cuando termine, podrás enviarla como un nuevo mensaje.')
    envelope = target.get('semantic_decision')
    if envelope is None and target.get('source_live_turn_id'):
        handoff = c.execute('''SELECT semantic_decision FROM uony_live_handoffs
            WHERE user_id=%s AND request_id=%s''', (user['id'], target['request_id'])).fetchone()
        envelope = handoff['semantic_decision'] if handoff else None
    scope = c.execute('''SELECT operation FROM uony_drive_scopes WHERE user_id=%s AND request_id=%s''',
                      (user['id'], target['request_id'])).fetchone()  # Lote 6 (A1e): by data.
    action = _action({**target, 'semantic_decision': envelope,
                      'scope_operation': scope['operation'] if scope else None})
    if action is None:
        return ('Todavía no puedo identificar esa operación en la solicitud consultada. '
                'No he iniciado otra ejecución.')
    if action != decision.status_action:
        return ('Esa consulta se refiere a otra tarea. Puedo informar sobre la solicitud '
                'que sigue en curso, sin iniciar una nueva.')
    label = _ACTION_NAMES.get(action, 'trabajo solicitado')
    state = target['status']
    material = target.get('material_analysis')
    if action == 'drive_analyze' and isinstance(material, dict) and material.get('jobId'):
        row = c.execute('''SELECT status FROM product_material_jobs
            WHERE user_id=%s AND id=%s AND google_subject=%s AND project_id=%s''',
            (user['id'], material['jobId'], user['google_subject'], target['project_id'])).fetchone()
        if row:
            state = row['status']
            if state == 'ready':
                return 'El análisis de documentos ya terminó. Su resultado está guardado en esta conversación.'
    if state == 'queued':
        return f'El {label} está en la cola, pendiente de ejecución.'
    if state == 'running':
        return f'El {label} se está ejecutando. Aún no hay un resultado final.'
    if state == 'success' and target.get('reply'):
        return target['reply']
    if state == 'unknown':
        return 'No puedo confirmar el resultado del trabajo solicitado. No he iniciado otra ejecución.'
    return 'El trabajo solicitado no terminó correctamente. No he iniciado otra ejecución.'


def answered(c, user, body, receipt, reply, usage):
    """D8: the restricted agent's own reply, a terminal request of the thread."""
    usage = safe_usage(usage)
    attempted = min(6, max(1, usage.get('attemptedCalls', 1)))  # With retries (hallazgo B).
    completed = min(attempted, usage.get('calls', attempted))
    c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,
        model,project_id,requested_model,effort,selection_reason,reply,usage,created_at)
        VALUES(%s,%s,%s,%s,'success',%s,%s,%s,%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, body.text, receipt['model'],
         receipt['project_id'], body.model, body.effort, receipt['selection_reason'],
         reply, Jsonb(usage), receipt['created_at']))
    c.execute('''INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
        google_subject,project_id,payload,engine,status,progress_stage,progress_seq,
        provider_attempt_count,provider_completed_count,provider_started_at,
        provider_returned_at,finished_at,created_at,usage)
        VALUES(%s,%s,%s,%s,%s,%s,'adk','success','saved',1,%s,%s,%s,now(),now(),%s,%s)''',
        (user['id'], body.requestId, body.threadId, user['google_subject'],
         receipt['project_id'], Jsonb(body.model_dump(mode='json')), attempted, completed,
         receipt['provider_started_at'], receipt['created_at'], Jsonb(usage)))
    _settled(c, user, body, usage)


def parked(c, user, body, usage):
    """D8: this message continues as an agent job; the follow-up step is done."""
    _settled(c, user, body, safe_usage(usage))


def _settled(c, user, body, usage):
    changed = c.execute('''UPDATE uony_written_followups SET state='success',
        usage=%s,finished_at=now(),updated_at=now()
        WHERE user_id=%s AND request_id=%s AND state='started' RETURNING request_id''',
        (Jsonb(usage), user['id'], body.requestId)).fetchone()
    if not changed:
        raise error('already_attempted', 'Esta consulta ya terminó; no se repetirá.')


def finish(c, user, body, receipt, target, decision, *, reply_override=None):
    """Materialize a terminal response only after a real inference completed.

    Interpreter path, without callers since D8 (only uony_semantic_recovery's
    followup_complete, removed with the module in F1-7b)."""
    usage = safe_usage(decision.usage)
    envelope = serialize_decision(decision, body.text)
    reply = reply_override if reply_override is not None else target_reply(c, user, target, decision)
    c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,
        model,project_id,requested_model,effort,selection_reason,reply,usage,created_at)
        VALUES(%s,%s,%s,%s,'success',%s,%s,%s,%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, body.text, receipt['model'],
         receipt['project_id'], body.model, body.effort, receipt['selection_reason'],
         reply, Jsonb(usage), receipt['created_at']))
    c.execute('''INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
        google_subject,project_id,payload,engine,status,progress_stage,progress_seq,
        provider_attempt_count,provider_completed_count,provider_started_at,
        provider_returned_at,finished_at,created_at,usage,semantic_decision)
        VALUES(%s,%s,%s,%s,%s,%s,'adk','success','saved',1,1,1,%s,now(),now(),%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, user['google_subject'],
         receipt['project_id'], Jsonb(body.model_dump(mode='json')),
         receipt['provider_started_at'], receipt['created_at'], Jsonb(usage), Jsonb(envelope)))
    changed = c.execute('''UPDATE uony_written_followups SET state='success',
        semantic_decision=%s,usage=%s,finished_at=now(),updated_at=now()
        WHERE user_id=%s AND request_id=%s AND state='started' RETURNING request_id''',
        (Jsonb(envelope), Jsonb(usage), user['id'], body.requestId)).fetchone()
    if not changed:
        raise error('already_attempted', 'Esta consulta ya terminó; no se repetirá.')
