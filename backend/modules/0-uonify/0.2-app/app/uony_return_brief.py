"""Read-only return brief and explicit, versioned follow-up for one linked product."""
import hashlib
import json
from datetime import datetime, timezone, timedelta
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Request
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody, require_user
from .products import fail, require_access
from .product_memory import _thread, project as product_memory
from .product_reasoning import MESSAGES as REASONING_MESSAGES, blocked_retry
from .product_requirements_fields import evaluate
from .security import require_origin
from .google_account import connection_matches
from .uony_amazon_publication import read as amazon_publication


def _digest(value):
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


class FollowUp(StrictBody):
    requestId: UUID = Field(strict=False)
    action: Literal['defer', 'resolve']
    pendingId: str = Field(min_length=1, max_length=120, pattern=r'^[a-z_]+:[A-Za-z0-9_-]+$')
    expectedVersion: int = Field(ge=0)
    productRevision: int = Field(ge=1)
    sourceFingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')


def _binding(c, user, thread_id, lock=False):
    # The brief reads the binding before product memory. Keep both views on
    # one product revision until the transaction ends, including background
    # writers that do not take the user's row lock.
    suffix = ' FOR UPDATE OF b FOR SHARE OF p' if lock else ' FOR SHARE OF p'
    return c.execute('''SELECT b.product_id,b.google_subject,b.version AS link_version,p.sku,p.data,p.revision,p.updated_at,
            p.deleted_at FROM uony_thread_products b
        JOIN products p ON p.user_id=b.user_id AND p.id=b.product_id
        WHERE b.user_id=%s AND b.thread_id=%s''' + suffix,
        (user['id'], thread_id)).fetchone()


def _latest(c, table, user, product_id, revision=None):
    if table == 'product_reasoning_jobs':
        return c.execute('''SELECT id,status,revision,updated_at,applied_revision,result
            FROM product_reasoning_jobs
            WHERE user_id=%s AND product_id=%s AND google_subject=%s
            ORDER BY coalesce((revision=%s OR applied_revision=%s),false) DESC,
                updated_at DESC,created_at DESC,id DESC LIMIT 1''',
            (user['id'], product_id, user['google_subject'], revision, revision)).fetchone()
    return c.execute('''SELECT id,status,revision,updated_at FROM product_material_jobs
        WHERE user_id=%s AND product_id=%s AND google_subject=%s
        ORDER BY created_at DESC,id DESC LIMIT 1''',
        (user['id'], product_id, user['google_subject'])).fetchone()


def _reasoning_connection_required(c, user):
    """Mirror the local Drive/Cloud preflight without refreshing tokens."""
    drive = c.execute('''SELECT status,google_subject FROM google_drive_connections
        WHERE user_id=%s''', (user['id'],)).fetchone()
    cloud = c.execute('''SELECT status,google_subject,project_id,project_check
        FROM google_cloud_connections WHERE user_id=%s''', (user['id'],)).fetchone()
    return (not connection_matches(user, drive) or drive['status'] != 'connected'
            or not connection_matches(user, cloud) or cloud['status'] != 'connected'
            or not cloud['project_id'] or not (cloud['project_check'] or {}).get('ready'))


def _pending(kind, identifier, label, source):
    return {'id': f'{kind}:{identifier}', 'kind': kind, 'label': label,
            'sourceFingerprint': _digest(source)}


def _requirements(c, user, binding):
    context = binding['data'].get('amazonRequirementsContext')
    if not isinstance(context, dict) or not all(context.get(k) for k in ('sellerId', 'marketplaceId')):
        return 'not_started', None, None
    schema = c.execute('''SELECT schema,metadata,fetched_at FROM product_requirement_schemas
        WHERE user_id=%s AND product_id=%s AND seller_id=%s AND marketplace_id=%s''',
        (user['id'], binding['product_id'], context['sellerId'], context['marketplaceId'])).fetchone()
    if not schema:
        return 'source_missing', None, _pending('amazon_requirements', 'schema',
            'Revisar los requisitos guardados de Amazon', [binding['revision'], context])
    account = c.execute('SELECT seller_id FROM amazon_connections WHERE user_id=%s',
                        (user['id'],)).fetchone()
    if not account or account['seller_id'] != context['sellerId'] or datetime.now(timezone.utc) - schema['fetched_at'] > timedelta(hours=24):
        source = [binding['revision'], context, schema['fetched_at'], account['seller_id'] if account else None]
        return 'source_stale', schema, _pending('amazon_requirements', 'schema',
            'Actualizar los requisitos de Amazon', source)
    plan = evaluate(schema['schema'], binding['data'].get('amazonAttributes') or {}, context['marketplaceId'])
    if plan['valid']:
        return 'locally_valid_not_published', schema, None
    count = plan['counts'].get('missing', 0) + plan['counts'].get('invalid', 0) + plan['counts'].get('questions', 0)
    source = [binding['revision'], context, schema['metadata'].get('schemaHash'), schema['fetched_at'], count]
    return 'needs_input', schema, _pending('amazon_requirements', 'fields',
        f'Revisar {count} dato(s) pendiente(s) para Amazon' if count else 'Revisar datos para Amazon', source)


def _preparation(binding):
    state = binding['data'].get('preparation')
    if not isinstance(state, dict) or not isinstance(state.get('sections'), dict):
        return 'not_started', []
    pending = []
    sections = state['sections']
    for section_id in sorted(sections):
        section = sections[section_id]
        if not isinstance(section, dict) or section.get('reviewed') is True:
            continue
        if not isinstance(section.get('answers'), dict) or not any(str(v).strip() for v in section['answers'].values()):
            continue
        pending.append(_pending('preparation', section_id,
            'Revisar el apartado ' + section_id.replace('_', ' '),
            [binding['revision'], section_id, section['answers']]))
    return ('needs_review' if pending else 'saved_without_pending'), pending


def _latest_event(c, user, thread_id, product_id, pending_id):
    return c.execute('''SELECT action,pending_snapshot,source_fingerprint,version
        FROM uony_return_followups WHERE user_id=%s AND thread_id=%s AND product_id=%s
          AND pending_id=%s ORDER BY version DESC LIMIT 1''',
        (user['id'], thread_id, product_id, pending_id)).fetchone()


def build(c, user, thread_id):
    """Only local SELECTs. Never schedules work or checks an external service."""
    _thread(c, user, thread_id)
    binding = _binding(c, user, thread_id)
    if not binding or binding['deleted_at'] or binding['google_subject'] != user['google_subject']:
        return {'product': None, 'confirmedFacts': [], 'status': None, 'pending': [],
            'completedFollowUps': [], 'followUpHistory': [], 'trackingVersion': 0,
            'sourceFingerprint': None,
            'nextAction': 'choose_product', 'summary': 'Elige una ficha para continuar desde esta conversación.'}, []
    memory = product_memory(c, user, thread_id)
    material = _latest(c, 'product_material_jobs', user, binding['product_id'])
    reasoning = _latest(c, 'product_reasoning_jobs', user, binding['product_id'], binding['revision'])
    requirements_state, schema, requirements_pending = _requirements(c, user, binding)
    preparation_state, preparation_pending = _preparation(binding)
    publication, publication_summary = amazon_publication(c, user, binding)
    material_state = memory['materialState'] if memory else 'none'
    reasoning_state = reasoning['status'] if reasoning else 'none'
    if reasoning and reasoning_state == 'completed' and reasoning['applied_revision'] != binding['revision']:
        reasoning_state = 'stale'
    elif reasoning and reasoning_state in ('queued', 'running', 'error', 'unknown') and reasoning['revision'] != binding['revision']:
        reasoning_state = 'stale'
    reasoning_detail = None
    if reasoning and reasoning_state in ('error', 'unknown'):
        unconfirmed = c.execute('''SELECT 1 FROM product_reasoning_calls call
            JOIN product_reasoning_jobs job ON job.id=call.job_id
            WHERE job.user_id=%s AND job.product_id=%s
              AND (call.state='unknown' OR coalesce((call.usage->>'unconfirmedCalls')::integer,0)>0)
              AND call.acknowledged_at IS NULL LIMIT 1''',
            (user['id'], binding['product_id'])).fetchone()
        # The stored provider error describes the previous attempt. It must not
        # permanently block a deliberate retry after local connections are ready.
        previous_connection_failure = bool(reasoning['result'].get('connectionMessage'))
        connection_blocked = _reasoning_connection_required(c, user)
        retry_blocked = reasoning_state == 'error' and blocked_retry(reasoning['result'])
        needs_ack = reasoning_state == 'unknown' or bool(unconfirmed)
        reasoning_detail = {'id': str(reasoning['id']), 'status': reasoning_state,
            'message': ('Revisa la conexión de Google y su proyecto para continuar. Tus datos se conservan.'
                        if connection_blocked else
                        'La comprobación necesita revisión antes de otro intento. Tus datos se conservan.'
                        if retry_blocked else
                        'La última comprobación detectó un problema de permisos de Google. Revisa Cloud y Drive antes de otro intento; tus datos se conservan.'
                        if previous_connection_failure else REASONING_MESSAGES[reasoning_state]),
            'canRetry': not retry_blocked and not connection_blocked,
            'connectionRequired': connection_blocked,
            'previousConnectionFailure': previous_connection_failure,
            'requiresConsumptionAcknowledgement': needs_ack,
            'revision': reasoning['revision']}
    candidates = []
    if material:
        material_labels = {
            'permission_required': 'Restablecer el acceso a los materiales guardados',
            'analysis_pending': 'Esperar el análisis de materiales iniciado',
            'review_required': 'Revisar el análisis de materiales guardado',
        }
        if material_state in material_labels:
            candidates.append(_pending('materials', str(material['id']),
                material_labels[material_state], [material['id'], material['status'],
                    material['revision'], material['updated_at'], material_state]))
    if reasoning and reasoning_state in ('queued', 'running', 'error', 'unknown', 'stale'):
        label = 'Esperar la revisión de IA iniciada' if reasoning_state in ('queued', 'running') else 'Revisar la comprobación de IA guardada'
        candidates.append(_pending('reasoning', str(reasoning['id']), label,
            [reasoning['id'], reasoning_state, reasoning['revision'], reasoning['updated_at']]))
    if requirements_pending:
        candidates.append(requirements_pending)
    candidates.extend(preparation_pending)
    state = {'material': material_state, 'reasoning': reasoning_state,
             'reasoningDetail': reasoning_detail,
             'amazonRequirements': requirements_state, 'preparation': preparation_state,
             'amazonPublication': publication['phase'],
             'amazonPublicationDetail': publication}
    cloud = c.execute('''SELECT project_id FROM google_cloud_connections
        WHERE user_id=%s AND google_subject=%s''',
        (user['id'], user['google_subject'])).fetchone()
    source_fingerprint = _digest({'threadId': thread_id, 'productId': binding['product_id'],
        'revision': binding['revision'],
        'linkVersion': binding['link_version'],
        'googleProjectId': cloud['project_id'] if cloud else None,
        'subject': user['google_subject'], 'state': state,
        'material': material,
        'reasoning': {k: v for k, v in reasoning.items() if k != 'result'} if reasoning else None,
        'schema': [schema['metadata'], schema['fetched_at']] if schema else None,
        'pending': candidates})
    version_row = c.execute('''SELECT max(version) AS version FROM uony_return_followups
        WHERE user_id=%s AND thread_id=%s AND product_id=%s''',
        (user['id'], thread_id, binding['product_id'])).fetchone()
    version = version_row['version'] or 0
    history_rows = c.execute('''SELECT action,pending_id,pending_snapshot,version,created_at
        FROM uony_return_followups WHERE user_id=%s AND thread_id=%s AND product_id=%s
        ORDER BY version DESC LIMIT 10''',
        (user['id'], thread_id, binding['product_id'])).fetchall()
    history = [{'action': row['action'], 'pendingId': row['pending_id'],
        'label': row['pending_snapshot'].get('label', ''), 'version': row['version'],
        'at': row['created_at'].isoformat()} for row in history_rows]
    open_items = []
    for item in candidates:
        event = _latest_event(c, user, thread_id, binding['product_id'], item['id'])
        deferred = bool(event and event['action'] == 'defer' and
                        event['pending_snapshot'].get('sourceFingerprint') == item['sourceFingerprint'])
        open_items.append({**item, 'followUp': 'deferred' if deferred else 'open'})
    outstanding = c.execute('''SELECT * FROM (
        SELECT DISTINCT ON (pending_id) pending_id,action,pending_snapshot,version
        FROM uony_return_followups WHERE user_id=%s AND thread_id=%s AND product_id=%s
        ORDER BY pending_id,version DESC) latest
        WHERE action='defer' ORDER BY version DESC LIMIT 12''',
        (user['id'], thread_id, binding['product_id'])).fetchall()
    current_ids = {item['id'] for item in candidates}
    completed = [{'id': row['pending_id'], 'label': row['pending_snapshot'].get('label', ''),
                  'canResolve': True} for row in outstanding if row['pending_id'] not in current_ids][:3]
    active = [item for item in open_items if item['followUp'] == 'open']
    shown = (active + [item for item in open_items if item['followUp'] == 'deferred'])[:3]
    action_by_kind = {'materials': 'wait_for_analysis' if material_state == 'analysis_pending' else
                      'reconnect_drive' if material_state == 'permission_required' else 'review_materials',
                      'reasoning': 'wait_for_ai' if reasoning_state in ('queued', 'running') else 'review_ai',
                      'amazon_requirements': 'review_amazon_requirements',
                      'preparation': 'review_preparation'}
    next_action = action_by_kind[active[0]['kind']] if active else (
        'continue_in_chat' if candidates else
        'review_amazon_requirements' if requirements_state == 'not_started' else 'continue_in_chat')
    name = (binding['data'].get('name') or binding['sku'])[:100]
    fact_count = len(memory['confirmedFacts']) if memory else 0
    summary = (f'La ficha de {name} sigue guardada. He recuperado {fact_count} dato(s) confirmado(s). '
               + publication_summary)
    if active:
        summary += f' Hay {len(active)} asunto(s) por atender; puedes continuar desde aquí.'
    elif completed:
        summary += ' Hay seguimientos que puedes cerrar después de revisar el cambio guardado.'
    elif candidates:
        summary += ' Los asuntos actuales están aplazados; puedes retomarlos desde esta conversación.'
    elif requirements_state == 'not_started':
        summary += ' El siguiente paso sugerido es revisar los requisitos de Amazon.'
    return {'product': memory['product'] if memory else None,
        'confirmedFacts': memory['confirmedFacts'] if memory else [], 'status': state,
        'pending': shown, 'completedFollowUps': completed, 'followUpHistory': history,
        'trackingVersion': version,
        'sourceFingerprint': source_fingerprint, 'nextAction': next_action,
        'summary': summary, 'productUpdatedAt': binding['updated_at'].isoformat()}, candidates


def _replay(c, user, thread_id, body, payload):
    previous = c.execute('SELECT * FROM uony_return_followups WHERE user_id=%s AND request_id=%s',
                         (user['id'], body.requestId)).fetchone()
    if not previous:
        return None
    if previous['google_subject'] != user['google_subject']:
        fail('account_changed', 'La identidad de Google de este seguimiento ha cambiado.', 409)
    if previous['thread_id'] != thread_id or previous['payload'] != payload:
        fail('request_conflict', 'Este identificador corresponde a otra acción.', 409)
    return {'event': {'requestId': str(previous['request_id']), 'action': previous['action'],
        'pendingId': previous['pending_id'], 'trackingVersion': previous['version']}}


def update(c, user, thread_id, body):
    _thread(c, user, thread_id)
    payload = body.model_dump(mode='json')
    replay = _replay(c, user, thread_id, body, payload)
    if replay:
        return replay
    binding = _binding(c, user, thread_id, lock=True)
    # A concurrent request can commit while we wait on the thread-product lock.
    # Read it again before comparing versions so the same requestId is replayed.
    replay = _replay(c, user, thread_id, body, payload)
    if replay:
        return replay
    if not binding or binding['deleted_at'] or binding['google_subject'] != user['google_subject']:
        fail('product_not_linked', 'Esta conversación ya no tiene vinculada esa ficha.', 409)
    brief, candidates = build(c, user, thread_id)
    if (body.expectedVersion != brief['trackingVersion'] or
            body.productRevision != binding['revision'] or
            body.sourceFingerprint != brief['sourceFingerprint']):
        fail('return_brief_conflict', 'La ficha o su seguimiento cambió. Revisa el resumen antes de continuar.', 409)
    item = next((item for item in candidates if item['id'] == body.pendingId), None)
    last = _latest_event(c, user, thread_id, binding['product_id'], body.pendingId)
    if body.action == 'defer':
        if not item:
            fail('pending_not_current', 'Este asunto ya no está pendiente en la ficha actual.', 409)
        if last and last['action'] == 'defer' and last['pending_snapshot'].get('sourceFingerprint') == item['sourceFingerprint']:
            fail('already_deferred', 'Este asunto ya está aplazado en esta versión.', 409)
    else:
        if item:
            fail('pending_still_current', 'Este asunto sigue pendiente en los datos guardados; revísalo antes de cerrarlo.', 409)
        if not last or last['action'] != 'defer':
            fail('followup_not_found', 'No hay un seguimiento aplazado que cerrar.', 404)
        item = last['pending_snapshot']
    version = brief['trackingVersion'] + 1
    c.execute('''INSERT INTO uony_return_followups
        (user_id,request_id,thread_id,product_id,google_subject,version,action,
         pending_id,product_revision,source_fingerprint,payload,pending_snapshot)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, thread_id, binding['product_id'], user['google_subject'],
         version, body.action, body.pendingId, binding['revision'], brief['sourceFingerprint'],
         Jsonb(payload), Jsonb(item)))
    return {'event': {'requestId': str(body.requestId), 'action': body.action,
                      'pendingId': body.pendingId, 'trackingVersion': version}}


def routes(settings, database):
    router = APIRouter(prefix='/threads')

    @router.get('/{thread_id}/return-brief')
    def get_brief(thread_id: str, request: Request):
        with database.connect() as c:
            user = require_user(c, request)
            require_access(c, user)
            return {'returnBrief': build(c, user, thread_id)[0]}

    @router.post('/{thread_id}/return-brief/follow-up')
    def follow_up(thread_id: str, body: FollowUp, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            user = require_user(c, request)
            require_access(c, user)
            return update(c, user, thread_id, body)

    return router
