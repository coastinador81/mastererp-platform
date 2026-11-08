"""Resolución conversacional: edición, revisión explícita y comprobación de Amazon."""
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody
from .products import fail
from .incident_fields import clean, plan_fields, apply_answers, review_rows, get_at
from .incident_schema_validation import validate_attributes, validation_errors


class IncidentAction(StrictBody):
    incidentId: UUID = Field(strict=False)
    action: Literal['start', 'check'] = 'start'


DECLARATIONS = [
    {'name': 'list_product_incidents', 'description': 'Consulta incidencias reales de los productos de esta cuenta. Distingue pendientes de confirmación, resueltas y errores de conexión. No modifica ni envía productos.',
     'parameters': {'type': 'OBJECT', 'properties': {'sku': {'type': 'STRING'}}}},
    {'name': 'start_incident_resolution', 'description': 'Abre en el chat el formulario validado para una incidencia conocida. El servidor muestra edición, revisión o comprobación según su estado real. No autoriza ni envía cambios a Amazon.',
     'parameters': {'type': 'OBJECT', 'properties': {'incidentId': {'type': 'STRING'}}, 'required': ['incidentId']}},
]


def context_for(incident, step, **extra):
    return {'kind': 'product_incident', 'incidentId': incident['id'], 'revision': incident['revision'], 'step': step, **extra}


def choice_form(incident, request_id, step, label, options, **extra):
    return {'id': str(request_id), 'title': clean(f"{incident['sku']} · Incidencia", 120),
            'context': context_for(incident, step, **extra),
            'fields': [{'id': 'action', 'label': label, 'type': 'select', 'required': True, 'closed': True, 'options': options}]}


def review_form(incident, context, request_id):
    correction = incident.get('correction') or {}
    form = choice_form(incident, request_id, 'review', '¿Autorizas enviar esta corrección a Amazon?',
                       ['Enviar corrección a Amazon', 'Modificar la corrección', 'Dejar pendiente'],
                       schemaHash=correction.get('schemaHash'))
    form['review'] = review_rows(context['attributes'], correction.get('attributes', {}), context['schema'])
    form['submitLabel'] = 'Confirmar elección'
    return 'Revisa los valores anteriores y los propuestos. Solo se enviarán a Amazon si eliges expresamente «Enviar corrección a Amazon» y confirmas.', form


def editing(context, request_id, candidate=None, names=None, only_missing=False):
    incident = context['incident']
    candidate, fields, specs, names = plan_fields(context['schema'], candidate or context['attributes'],
                                                  names or incident['attributeNames'], incident['marketplaceId'])
    for field in fields:
        path = specs[field['id']]['path']
        if field.get('value') and get_at(candidate, path) != get_at(context['attributes'], path):
            field['hint'] = 'Propuesta conservada de tus respuestas anteriores; revisa el motivo de Amazon antes de confirmarla.'
    if only_missing:
        errors = validation_errors(context['schema'], candidate)
        bad = []
        for error in errors:
            if error.validator == 'required' and isinstance(error.instance, dict):
                bad.extend(list(error.absolute_path) + [key] for key in error.validator_value if key not in error.instance)
            else: bad.append(list(error.absolute_path))
        fields = [field for field in fields if not field.get('value') or any(
            specs[field['id']]['path'][:len(path)] == path for path in bad if path)]
    if not fields:
        fail('incident_support_required', 'No hay campos editables que permitan corregir esta incidencia. Revisa el mensaje de Amazon o contacta con su soporte.', 409)
    state = context_for(incident, 'edit', schemaHash=context['schemaHash'], snapshotVersion=context['snapshotVersion'],
                        baseline=context['attributes'], candidate=candidate, names=names, remaining=fields[8:], specs=specs)
    return 'Completa o corrige estos datos. Las opciones y el formato proceden de los requisitos actuales de Amazon; los valores mostrados son los de tu catálogo.', {
        'id': str(request_id), 'title': clean(f"Corregir {incident['sku']}", 120), 'context': state, 'fields': fields[:8],
        'submitLabel': 'Revisar corrección' if len(fields) <= 8 else 'Continuar',
    }


def start(service, user_id, incident_id, request_id, check=False, force_edit=False):
    incident = service.get(user_id, incident_id)
    if check:
        result = service.sync(user_id, sku=incident['sku'], marketplace_id=incident['marketplaceId'])
        if result.get('sync', {}).get('state') == 'error':
            return result['sync'].get('message') or 'No se ha podido comprobar Amazon. Conservamos el estado anterior.', choice_form(incident, request_id, 'waiting', '¿Quieres volver a comprobarlo?', ['Comprobar estado en Amazon', 'Dejar pendiente'])
        incident = service.get(user_id, incident_id)
    if incident['status'] == 'resolved':
        return 'Amazon ya no reporta esta incidencia tras comprobar el resultado. Está resuelta.', None
    if incident['status'] == 'awaiting_amazon':
        message = 'La corrección está pendiente de confirmación. Enviarla no significa que la incidencia esté resuelta; podemos volver a comprobar su estado.'
        return message, choice_form(incident, request_id, 'waiting', '¿Cómo quieres continuar?', ['Comprobar estado en Amazon', 'Dejar pendiente'])
    if incident.get('supportRequired') or not incident.get('attributeNames'):
        message = 'Esta incidencia requiere una acción adicional o soporte de Amazon: ' + clean(incident['message'], 1400)
        return message, choice_form(incident, request_id, 'waiting', 'Después de completar la acción indicada, comprueba el resultado.', ['Comprobar estado en Amazon', 'Dejar pendiente'])
    try:
        context = service.context(user_id, incident_id)
        incident = context['incident']
        if incident['status'] == 'resolved': return 'Amazon ya no reporta esta incidencia. Está resuelta.', None
        if incident['status'] == 'awaiting_amazon':
            return 'Amazon sigue procesando la corrección. Mantendremos la incidencia pendiente hasta comprobar su resultado.', choice_form(incident, request_id, 'waiting', '¿Cómo quieres continuar?', ['Comprobar estado en Amazon', 'Dejar pendiente'])
        if incident['status'] == 'correction_ready' and incident.get('correction') and not force_edit:
            return review_form(incident, context, request_id)
        reply, form = editing(context, request_id, candidate={**context['attributes'], **incident['correction']['attributes']} if incident.get('correction') else None)
        reasons = [item.get('message') for item in incident.get('submissionIssues', []) if isinstance(item, dict) and item.get('message')]
        reason = '; '.join(reasons) if reasons else incident['message']
        return 'Amazon indica: ' + clean(reason, 1400) + '\n\n' + reply, form
    except HTTPException as error:
        if error.detail.get('error') not in ('unsupported_amazon_schema', 'incident_needs_review', 'incident_support_required'):
            raise
        return error.detail['message'], choice_form(incident, request_id, 'waiting', 'Puedes comprobarla de nuevo cuando haya cambios.', ['Comprobar estado en Amazon', 'Dejar pendiente'])


def saved_form(connection, user, body):
    saved = connection.execute("SELECT conversation_form FROM uony_requests WHERE user_id=%s AND thread_id=%s AND request_id=%s AND status='success'", (user['id'], body.threadId, body.formResponse.formId)).fetchone()
    form = saved['conversation_form'] if saved else None
    if not isinstance(form, dict) or form.get('context', {}).get('kind') != 'product_incident':
        return None
    latest = connection.execute("SELECT request_id FROM uony_requests WHERE user_id=%s AND thread_id=%s AND status='success' ORDER BY created_at DESC LIMIT 1", (user['id'], body.threadId)).fetchone()
    if not latest or str(latest['request_id']) != str(body.formResponse.formId):
        fail('form_expired', 'Esta pregunta ya tiene una versión más reciente. Continúa con el último formulario de tu conversación.', 409)
    return form


def respond(service, user_id, body, form):
    context = form['context']; identifier = context['incidentId']
    incident = service.get(user_id, identifier)
    if context['step'] in ('edit', 'review') and incident['revision'] != context['revision']:
        fail('incident_conflict', 'La incidencia ha cambiado. Abre de nuevo «Resolver con Uony» para trabajar con su estado actual; tus respuestas se conservan.', 409)
    answers = body.formResponse.answers
    if set(answers) - {field['id'] for field in form['fields']}:
        fail('invalid_incident_answers', 'El formulario solo acepta los campos que aparecen en esta pregunta.')
    if context['step'] in ('review', 'waiting'):
        action = answers.get('action')
        if action not in form['fields'][0]['options'] or set(answers) != {'action'}:
            fail('invalid_incident_answers', 'Elige una de las acciones del formulario; no se ha enviado ningún cambio.')
        if action == 'Dejar pendiente': return 'La incidencia queda pendiente. Puedes retomarla desde este chat o desde Producto.', None
        if action == 'Modificar la corrección': return start(service, user_id, identifier, body.requestId, force_edit=True)
        if action == 'Comprobar estado en Amazon': return start(service, user_id, identifier, body.requestId, check=True)
        if action == 'Enviar corrección a Amazon' and context['step'] == 'review':
            service.submit(user_id, identifier, incident['revision'], str(body.requestId), validate_attributes)
            return start(service, user_id, identifier, body.requestId)
        fail('invalid_incident_action', 'Esta acción necesita una revisión y confirmación actuales.', 409)
    if context['step'] == 'pick':
        selected = context.get('choices', {}).get(answers.get('action'))
        if not selected: fail('invalid_incident_answers', 'Elige una incidencia de la lista.')
        return start(service, user_id, selected, body.requestId)
    if context['step'] != 'edit': fail('form_expired', 'Reabre la incidencia para continuar con su estado actual.', 409)
    fresh = service.context(user_id, identifier)
    if fresh['schemaHash'] != context['schemaHash'] or fresh['attributes'] != context['baseline'] or fresh['incident']['revision'] != context['revision']:
        fail('incident_conflict', 'Amazon ha actualizado la ficha o sus requisitos. Reabre la incidencia para revisar los valores actuales antes de enviar.', 409)
    candidate = apply_answers(context['candidate'], context['specs'], form['fields'], answers)
    if context['remaining']:
        next_context = {**context, 'candidate': candidate, 'remaining': context['remaining'][8:]}
        return 'Las respuestas se conservan en esta conversación. Continúa con los campos restantes.', {
            'id': str(body.requestId), 'title': form['title'], 'context': next_context,
            'fields': context['remaining'][:8], 'submitLabel': 'Continuar' if len(context['remaining']) > 8 else 'Revisar corrección'}
    if validation_errors(fresh['schema'], candidate):
        reply, next_form = editing(fresh, body.requestId, candidate, context['names'], only_missing=True)
        return 'Al revisar el conjunto, Amazon exige completar o corregir estos campos adicionales. ' + reply, next_form
    replacements = {name: candidate[name] for name in context['names'] if name in candidate and candidate[name] != fresh['attributes'].get(name)}
    if not replacements:
        return 'No has cambiado ningún valor. La incidencia sigue pendiente; revisa el motivo que comunica Amazon antes de preparar otra corrección.', choice_form(incident, body.requestId, 'waiting', '¿Quieres comprobar el estado?', ['Comprobar estado en Amazon', 'Dejar pendiente'])
    prepared = service.prepare(user_id, identifier, incident['revision'], replacements, str(body.requestId), validate_attributes)
    return review_form(prepared, fresh, body.requestId)


def reserve(connection, user, body):
    connection.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,project_id,requested_model,effort,selection_reason,product_context,form_response,incident_action) VALUES(%s,%s,%s,%s,'running','uonify-guide','uonify-guide',%s,%s,'Resolución de incidencias sin consumo de IA',%s,%s,%s)",
        (user['id'], body.requestId, body.threadId, body.text, body.model, body.effort,
         Jsonb(body.productContext.model_dump()) if body.productContext else None,
         Jsonb(body.formResponse.model_dump(mode='json')) if body.formResponse else None,
         Jsonb(body.incidentAction.model_dump(mode='json')) if body.incidentAction else None))
    connection.commit()  # Libera el lock de usuario antes de las operaciones del servicio.


def execute(service, connection, user, body, form=None):
    if service is None: fail('incidents_unavailable', 'La conexión de incidencias no está disponible. Tus datos se conservan.', 503)
    reserve(connection, user, body)
    try:
        reply, next_form = respond(service, user['id'], body, form) if form else start(service, user['id'], body.incidentAction.incidentId, body.requestId, check=body.incidentAction.action == 'check')
        connection.execute("UPDATE uony_requests SET status='success',reply=%s,usage=%s,conversation_form=%s WHERE user_id=%s AND request_id=%s", (reply, Jsonb({'calls': 0, 'totalTokenCount': 0}), Jsonb(next_form) if next_form else None, user['id'], body.requestId))
        return {'reply': reply, 'model': 'uonify-guide', 'effort': body.effort, 'selectionReason': 'Resolución de incidencias sin consumo de IA',
                'productChanges': [], 'connectionActions': [], 'conversationForm': next_form, 'incidentsChanged': True}
    except Exception as error:
        connection.execute("UPDATE uony_requests SET status='error',error_code='incident_action_failed' WHERE user_id=%s AND request_id=%s", (user['id'], body.requestId))
        connection.commit()
        if isinstance(error, HTTPException) and isinstance(error.detail, dict) and error.detail.get('error') in ('amazon_disconnected', 'amazon_reconnect'):
            error.detail['connectionActions'] = [{'provider': 'amazon', 'action': 'manage'}]
        raise


class IncidentTools:
    def __init__(self, service, user_id, request_id):
        self.service, self.user_id, self.request_id = service, user_id, request_id
        self.result = None

    def call(self, name, args):
        try:
            if self.service is None: fail('incidents_unavailable', 'Las incidencias de Amazon no están disponibles ahora.', 503)
            if not isinstance(args, dict): fail('invalid_tool', 'Argumentos no válidos.')
            if name == 'list_product_incidents' and not (set(args) - {'sku'}):
                if 'sku' in args and not isinstance(args['sku'], str): fail('invalid_tool', 'El SKU debe ser texto.')
                result = self.service.listing(self.user_id, sku=args.get('sku'))
                items = result if isinstance(result, list) else result.get('incidents', [])
                if items:
                    first = items[0]
                    choices = {clean(f"{index + 1}. {item['sku']} · {item['message']}", 160): item['id'] for index, item in enumerate(items[:20])}
                    form = choice_form(first, self.request_id, 'pick', '¿Qué incidencia quieres revisar con Uony?', list(choices), choices=choices)
                    self.result = ('Selecciona la incidencia que quieres revisar. Su estado se comprobará antes de preparar cambios.', form)
                return {'incidents': [{key: item.get(key) for key in ('id', 'sku', 'marketplaceName', 'message', 'status', 'severity')} for item in items[:20]],
                        'moreAvailable': len(items) > 20, 'sync': result.get('sync') if isinstance(result, dict) else None,
                        'summary': result.get('summary') if isinstance(result, dict) else {'active': len(items)}}
            if name == 'start_incident_resolution' and set(args) == {'incidentId'}:
                identifier = UUID(args['incidentId'])
                self.result = start(self.service, self.user_id, identifier, self.request_id)
                return {'prepared': True, 'message': 'El servidor presentará el siguiente paso dentro de esta conversación. No se ha autorizado ninguna publicación.'}
            fail('invalid_tool', 'Herramienta o argumentos no admitidos.')
        except (ValueError, TypeError): return {'error': 'invalid_tool', 'message': 'Identifica una incidencia de tu cuenta.'}
        except HTTPException as error: return error.detail
