"""Recorrido conversacional determinista sobre la misma preparación del producto."""
from uuid import UUID
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody
from .products import find, present, fail
from .product_preparation import dto, apply, PreparationPatch, state_of
from .product_preparation_schema import ORDER, MODE_CHOICES


class FormResponse(StrictBody):
    formId: UUID = Field(strict=False)
    answers: dict[str, str]


DECLARATION = {
    'name': 'start_product_guide',
    'description': 'Continúa una ficha en esta conversación consultando requisitos Amazon y datos disponibles. Pregunta solo lo pendiente. offerModeChoice se usa exclusivamente si el cliente pide elegir entre formulario y módulo manual. No publica.',
    'parameters': {'type': 'OBJECT', 'properties': {'sku': {'type': 'STRING'}, 'offerModeChoice': {'type': 'BOOLEAN'}}, 'required': ['sku']},
}


def form_for(product, request_id, section=None):
    data = dto(product)
    state = state_of(product)
    if section is None and state['mode'] == 'guided' and len(state['sections']) == len(ORDER) and all(s['reviewed'] for s in state['sections'].values()):
        section = next((s['id'] for s in data['preparation']['sections'] if s['state'] == 'pending'), state['activeSection'])
    section = section or ('choice' if state['mode'] != 'guided' else state['activeSection'])
    context = {'kind': 'product_guide', 'sku': product['sku'], 'revision': product['revision'], 'section': section}
    if section == 'choice':
        return {'id': str(request_id), 'title': '¿Cómo prefieres completar tu producto?', 'context': context,
                'fields': [{'id': 'mode', 'label': 'Elige cómo quieres continuar', 'type': 'select', 'required': True, 'options': list(MODE_CHOICES)}]}
    info = next(item for item in data['preparation']['sections'] if item['id'] == section)
    fields = []
    for item in info['fields']:
        copied = dict(item)
        if copied['type'] == 'select' and not copied['value']:
            copied.pop('value')
        fields.append(copied)
    return {'id': str(request_id), 'title': f"{ORDER.index(section) + 1} de 8 · {info['label']}", 'fields': fields, 'context': context}


def guided_form(product, request_id, connection, user, requirements, section=None, offer=True):
    if requirements is not None and state_of(product)['mode'] == 'guided' and section != 'choice':
        from .product_requirements_guide import form_for as requirements_form
        prepare = getattr(requirements, 'prepare_for', requirements.get_for)
        result = prepare(connection, user, product['sku'])
        return requirements_form(result, request_id)
    return form_for(product, request_id, section)


def finalise_tools(context, connection, user, changes, request_id, requirements=None):
    target = context.guide_sku
    created = next((change['product'] for change in changes if change['previousSku'] is None), None)
    if not target:
        return None
    product = created if created and (not target or target == created['sku']) else present(find(connection, user, target))
    if not any(change['product']['id'] == product['id'] for change in changes):
        changes.append({'product': product, 'previousSku': product['sku']})
    choice = getattr(context,'guide_mode_choice',False)
    if not choice and state_of(product)['mode'] != 'guided':
        product = apply(connection,user,product['sku'],PreparationPatch(revision=product['revision'],mode='guided'),source='uony')['product']
    form = guided_form(product, request_id, connection, user, requirements, 'choice' if choice else None)
    # La preparación puede completar datos respaldados por fuentes y cambiar revisión.
    latest = present(find(connection, user, product['sku']))
    for change in changes:
        if change['product']['id'] == product['id']: change['product'] = latest
    return form


def introduction(form):
    if form is None:
        return 'Tu ficha está guardada. Continuaremos solo cuando haya un dato que necesite tu respuesta.'
    if form['context']['section'] == 'amazon_requirements':
        if form['context'].get('step') == 'reasoning':
            return (form.get('reasoning') or {}).get('message') or 'Estoy revisando tus documentos e imágenes antes de preguntarte.'
        return ('Necesito identificar la categoría para consultar lo que pide Amazon.'
                if form['context'].get('step') == 'source' else
                'Solo falta tu ayuda con los datos que no he podido resolver para Amazon.')
    if form['context']['section'] == 'choice':
        return 'El borrador está guardado. Elige si prefieres completarlo con un formulario interactivo o directamente en Producto.'
    section = form['context']['section']
    from .product_preparation_schema import BY_ID
    return BY_ID[section]['notice']


def submit(connection, user, body, form_response, requirements=None):
    saved = connection.execute("SELECT conversation_form FROM uony_requests WHERE user_id=%s AND thread_id=%s AND request_id=%s AND status='success'", (user['id'], body.threadId, form_response.formId)).fetchone()
    form = saved['conversation_form'] if saved else None
    context = form.get('context') if isinstance(form, dict) else None
    if not context or context.get('kind') != 'product_guide':
        fail('form_not_found', 'No encontramos este formulario en tu conversación.', 404)
    latest = connection.execute("SELECT request_id FROM uony_requests WHERE user_id=%s AND thread_id=%s AND status='success' ORDER BY created_at DESC LIMIT 1", (user['id'], body.threadId)).fetchone()
    if not latest or str(latest['request_id']) != str(form_response.formId):
        fail('form_expired', 'Este formulario ya tiene una versión más reciente. Continúa con el último formulario del chat.', 409)
    allowed_fields = {field['id'] for field in form['fields']}
    deferring = context.get('section') == 'amazon_requirements' and context.get('step') == 'fields' and form_response.answers == {'requirements_action': 'later'}
    if (not deferring and set(form_response.answers) - allowed_fields) or any(len(value.encode('utf-16-le')) // 2 > 3000 for value in form_response.answers.values()):
        fail('invalid_preparation', 'Revisa las respuestas: solo se admiten los campos de este formulario, con hasta 3000 caracteres.')
    product = present(find(connection, user, context['sku']))
    if product['revision'] != context['revision']:
        fail('product_conflict', 'La ficha ha cambiado. Pide a Uony continuar con la versión actual; tus respuestas se conservan.', 409)
    section = context['section']
    if section == 'amazon_requirements':
        if state_of(product)['mode'] != 'guided':
            fail('form_expired', 'La forma de completar el producto ha cambiado. Reanuda la guía.', 409)
        from .product_requirements_guide import respond
        updated, next_form, deferred = respond(requirements, connection, user, product, body, form)
        if next_form is None:
            updated = apply(connection, user, updated['sku'], PreparationPatch(
                revision=updated['revision'], section='atributos', reviewed=not deferred, advance=False), source='uony')['product']
            reply = ('Los requisitos de Amazon siguen pendientes de comprobar. Tus datos están guardados; podemos retomarlo cuando quieras.' if deferred else
                     'Ya están completos los datos que exige Amazon en esta revisión. La ficha está guardada; el producto aún no se ha enviado a Amazon.')
        else:
            reply = introduction(next_form)
        result = {'product': updated}
    elif section == 'choice':
        answers = form_response.answers
        if set(answers) != {'mode'} or answers['mode'] not in MODE_CHOICES:
            fail('invalid_preparation', 'Elige una de las dos formas de completar tu producto.')
        result = apply(connection, user, product['sku'], PreparationPatch(revision=product['revision'], mode=MODE_CHOICES[answers['mode']]), source='uony')
        next_form = guided_form(result['product'], body.requestId, connection, user, requirements) if result['preparation']['mode'] == 'guided' else None
        if requirements is not None and result['preparation']['mode'] == 'guided':
            result['product'] = present(find(connection, user, product['sku']))
        complete = (requirements.get_for(connection, user, product['sku'])['evaluation']['state'] == 'locally_valid'
                    if requirements is not None and result['preparation']['mode'] == 'guided' else False)
        reply = introduction(next_form) if next_form else (
            ('Los datos que exige Amazon ya están completos en esta revisión. Tu ficha está guardada.' if complete else
             'Hay requisitos de Amazon que todavía no puedo comprobar. Tus datos están guardados; no necesitas repetirlos.') if result['preparation']['mode'] == 'guided' else
            'Has elegido completar la ficha directamente en Producto. Los datos se guardan en el mismo borrador.')
    else:
        if state_of(product)['mode'] != 'guided':
            fail('form_expired', 'La forma de completar el producto ha cambiado. Reanuda la guía para continuar.', 409)
        result = apply(connection, user, product['sku'], PreparationPatch(revision=product['revision'], section=section, answers=form_response.answers, reviewed=True, advance=True), source='uony')
        next_form = guided_form(result['product'], body.requestId, connection, user, requirements, offer=False) if section != ORDER[-1] else None
        if section == ORDER[-1] and requirements is not None:
            from .product_requirements_guide import form_for as requirements_form
            evaluated = requirements.get_for(connection, user, product['sku'])
            if evaluated['evaluation']['state'] != 'unconfigured':
                next_form = requirements_form(evaluated, body.requestId)
        reply = introduction(next_form) if next_form else 'He guardado el recorrido de las ocho secciones. Los apartados sin datos siguen pendientes. La creación y revisión de imágenes, vídeo, 3D y A+, las comprobaciones normativas y la publicación siguen pendientes según los servicios disponibles. El producto no se ha publicado.'
    changes = [{'product': result['product'], 'previousSku': product['sku']}]
    usage = {'calls': 0, 'formRepairCalls': 0, 'totalTokenCount': 0}
    model = 'uonify-guide'
    reason = 'Guía de producto; análisis y deducción registrados por separado'
    actions = []
    if requirements is not None and next_form and next_form.get('context', {}).get('step') == 'reasoning':
        actions = requirements.get_for(connection, user, product['sku'])['evaluation'].get('connectionActions', [])
    connection.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,project_id,requested_model,effort,selection_reason,product_context,form_response,reply,usage,product_changes,conversation_form,connection_actions) VALUES(%s,%s,%s,%s,'success',%s,'uonify-guide',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                       (user['id'], body.requestId, body.threadId, body.text, model, body.model, body.effort, reason, Jsonb(body.productContext.model_dump()) if body.productContext else None,
                        Jsonb(form_response.model_dump(mode='json')), reply, Jsonb(usage), Jsonb(changes), Jsonb(next_form) if next_form else None, Jsonb(actions)))
    return {'reply': reply, 'model': model, 'effort': body.effort, 'selectionReason': reason, 'productChanges': changes, 'connectionActions': actions, 'conversationForm': next_form}
