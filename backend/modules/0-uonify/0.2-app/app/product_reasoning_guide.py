"""Reanudar requisitos actuales desde el chat sin aceptar respuestas antiguas."""
from typing import Literal
from uuid import UUID
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody
from .products import fail, find, present, save
from .product_preparation import state_of
from .product_requirements_guide import form_for


class RequirementsAction(StrictBody):
    action: Literal['prepare']
    sku: str = Field(min_length=1, max_length=80)
    retry: bool = False
    acknowledgeUnknown: bool = False
    expectedRevision: int | None = Field(default=None, ge=1)
    expectedLinkVersion: int | None = Field(default=None, ge=1)
    expectedReasoningId: UUID | None = Field(default=None, strict=False)
    expectedReasoningStatus: Literal['error', 'unknown'] | None = None
    expectedSourceFingerprint: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$')


def _scoped_retry(connection, user, body, original):
    action = body.requirementsAction
    values = (action.expectedRevision, action.expectedLinkVersion, action.expectedReasoningId,
              action.expectedReasoningStatus, action.expectedSourceFingerprint)
    if not any(value is not None for value in values):
        return False
    if not action.retry or not all(value is not None for value in values) or body.productContext:
        fail('invalid_reasoning_retry', 'Actualiza el resumen de esta ficha antes de volver a comprobarla.', 422)
    # Keep the billed project stable from the card's CAS check through enqueue.
    # The worker independently checks the persisted project before reservation.
    connection.execute('''SELECT project_id FROM google_cloud_connections
        WHERE user_id=%s AND google_subject=%s FOR SHARE''',
        (user['id'], user['google_subject'])).fetchone()
    from .uony_return_brief import build
    brief, _ = build(connection, user, body.threadId)
    product = brief['product']
    detail = (brief['status'] or {}).get('reasoningDetail')
    if (not product or product['sku'].casefold() != original['sku'].casefold()
            or product['revision'] != action.expectedRevision
            or product['linkVersion'] != action.expectedLinkVersion
            or brief['sourceFingerprint'] != action.expectedSourceFingerprint
            or not detail or detail['id'] != str(action.expectedReasoningId)
            or detail['status'] != action.expectedReasoningStatus
            or not detail['canRetry']):
        fail('return_brief_conflict', 'La ficha o su comprobación cambió. Actualiza el resumen antes de continuar.', 409)
    if detail['requiresConsumptionAcknowledgement'] and not action.acknowledgeUnknown:
        fail('reasoning_consumption_unknown', 'Confirma el posible consumo adicional antes de volver a intentarlo.', 409)
    # El trabajador puede terminar mientras se abre la tarjeta. Bloqueamos su fila
    # y volvemos a leer el resumen dentro de la misma transacción.
    row = connection.execute('''SELECT id,status,revision FROM product_reasoning_jobs
        WHERE user_id=%s AND product_id=%s AND google_subject=%s
        ORDER BY coalesce((revision=%s OR applied_revision=%s),false) DESC,
            updated_at DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE''',
        (user['id'], original['id'], user['google_subject'], action.expectedRevision,
         action.expectedRevision)).fetchone()
    if (not row or row['id'] != action.expectedReasoningId
            or row['status'] != action.expectedReasoningStatus
            or row['revision'] != action.expectedRevision
            or build(connection, user, body.threadId)[0]['sourceFingerprint'] != action.expectedSourceFingerprint):
        fail('return_brief_conflict', 'La comprobación cambió. Actualiza el resumen antes de continuar.', 409)
    return True


def execute(service, connection, user, body):
    if service is None:
        fail('requirements_unavailable', 'No podemos revisar los requisitos ahora. Tus datos se conservan.', 503)
    action = body.requirementsAction
    original = present(find(connection, user, action.sku))
    scoped_retry = _scoped_retry(connection, user, body, original)
    preparation = state_of(original)
    if preparation['mode'] != 'guided' and not scoped_retry:
        preparation['mode'] = 'guided'
        save(connection, user, {'revision': original['revision'], 'preparation': preparation},
             action.sku, source='uony')
    result = service.prepare_for(connection, user, action.sku, retry=action.retry,
                                 acknowledge_unknown=action.acknowledgeUnknown,
                                 **({'expected_reasoning_id': action.expectedReasoningId}
                                    if scoped_retry else {}))
    product, evaluation = result['product'], result['evaluation']
    form = form_for(result, body.requestId)
    from .product_guide import introduction
    reply = introduction(form) if form else (
        'Los datos necesarios están completos según los requisitos consultados. La ficha está guardada.'
        if evaluation['state'] == 'locally_valid' else
        'Hay requisitos que todavía necesitan comprobarse. Tus datos siguen guardados.')
    # La respuesta siempre identifica su ficha, aunque solo haya actualizado las
    # preguntas. Así el chat sustituye su seguimiento anterior sin deducirlo del texto.
    changes = [{'product': product, 'previousSku': product['sku']}]
    # Las llamadas de deducción y su consumo se registran en su trabajo durable,
    # no como una respuesta adicional del modelo de chat.
    usage = {'calls': 0, 'totalTokenCount': 0}
    actions = evaluation.get('connectionActions', [])
    reason = 'Revisión de requisitos; deducción y consumo registrados por separado'
    connection.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,
        project_id,requested_model,effort,selection_reason,product_context,requirements_action,
        reply,usage,product_changes,conversation_form,connection_actions)
        VALUES(%s,%s,%s,%s,'success','uonify-guide','uonify-guide',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, body.text, body.model, body.effort, reason,
         Jsonb(body.productContext.model_dump()) if body.productContext else None,
         Jsonb(action.model_dump(mode='json')), reply, Jsonb(usage), Jsonb(changes), Jsonb(form) if form else None, Jsonb(actions)))
    return {'reply': reply, 'model': 'uonify-guide', 'effort': body.effort,
            'selectionReason': reason, 'productChanges': changes, 'connectionActions': actions,
            'conversationForm': form}
