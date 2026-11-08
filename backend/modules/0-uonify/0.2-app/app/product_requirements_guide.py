"""Preguntas PTD dentro de la guía: cada respuesta guarda y reevalúa el mismo producto."""
import re
from urllib.parse import urlparse
from .products import fail

SOURCE_OPTIONS = ['Usar un producto parecido de Amazon', 'Indicar el tipo de producto de Amazon',
                  'Completar la categoría más tarde']
LEGACY_OPTIONS = {'Usar un ASIN de referencia': SOURCE_OPTIONS[0],
                  'Continuar con los datos generales por ahora': SOURCE_OPTIONS[2]}
REFRESH = 'Actualizar los requisitos guardados'


def form_for(result, request_id):
    product, evaluation = result['product'], result['evaluation']
    context = {'kind': 'product_guide', 'sku': product['sku'], 'revision': product['revision'],
               'section': 'amazon_requirements', 'step': 'source'}
    form = {'id': str(request_id), 'title': 'Completar los datos para Amazon', 'context': context}
    if evaluation.get('reasoning'):
        form['reasoning'] = evaluation['reasoning']
    if evaluation['state'] == 'reasoning':
        context['step'] = 'reasoning'
        return {**form, 'fields': [], 'title': 'Revisar documentos e imágenes',
                'notice': evaluation.get('reasoning', {}).get('message') or
                          'Uony está comprobando lo que puede deducir antes de preguntarte.'}
    if evaluation['state'] in ('locally_valid', 'needs_review'):
        return None
    if evaluation['state'] == 'needs_input' and evaluation.get('fields'):
        context.update(step='fields', evaluationId=evaluation['evaluationId'])
        return {**form, 'fields': evaluation['fields'], 'submitLabel': 'Guardar y continuar',
                'notice': 'Solo te preguntaré los datos que necesita Amazon y que no puedo obtener de tus documentos. '
                          'Tus respuestas se guardan en esta ficha.'}
    options = [SOURCE_OPTIONS[0], SOURCE_OPTIONS[2]]
    if evaluation.get('productType'):
        options.insert(0, REFRESH)
    return {**form, 'notice': evaluation.get('message') or 'Identifiquemos los requisitos de Amazon para este producto.',
            'fields': [{'id': 'source', 'label': '¿Tienes un producto parecido en Amazon para identificar su categoría?',
                        'type': 'select', 'required': True, 'closed': True, 'options': options}]}


def identifying(form, request_id, step):
    by_reference = step == 'reference'
    return {'id': str(request_id), 'title': 'Identificar el tipo de producto en Amazon',
            'context': {**form['context'], 'step': step},
            'notice': 'Usaré ese producto para consultar lo que pide su categoría. Sus características no se copiarán al tuyo.' if by_reference else
                      'Esta opción manual necesita el código de categoría facilitado por Amazon.',
            'fields': [{'id': 'asin' if by_reference else 'productType',
                        'label': 'Pega el enlace de un producto parecido de Amazon' if by_reference else 'Código de categoría facilitado por Amazon',
                        'type': 'text', 'required': True,
                        'hint': 'También puedes usar su código ASIN, que aparece en la información del producto.' if by_reference else 'Copia el código de categoría exactamente como aparece en Amazon.'}]}


def reference_asin(value):
    text = value.strip()
    if re.fullmatch(r'[a-zA-Z0-9]{10}', text):
        return text.upper()
    parsed = urlparse(text)
    if parsed.scheme in ('https', 'http') and re.fullmatch(r'(?:www\.)?amazon\.(?:es|de|fr|it|nl|se|pl|com|com\.be|co\.uk|ie)', parsed.hostname or ''):
        match = re.search(r'/(?:dp|gp/product|gp/aw/d)/([a-zA-Z0-9]{10})(?:[/?]|$)', parsed.path)
        if match: return match.group(1).upper()
    fail('invalid_asin', 'Pega el enlace completo del producto en Amazon o su código ASIN de diez letras y números.', 422)


def respond(service, connection, user, product, body, form):
    """Devuelve producto, siguiente formulario y aplazamiento explícito de los requisitos."""
    if service is None:
        fail('requirements_unavailable', 'No podemos comprobar los requisitos ahora. Tu ficha se conserva.', 503)
    context, answers = form['context'], body.formResponse.answers
    step = context.get('step')
    if step == 'fields' and answers == {'requirements_action': 'later'}:
        return product, None, True
    if step == 'source':
        source = answers.get('source')
        if set(answers) != {'source'} or source not in form['fields'][0]['options']:
            fail('invalid_requirements_answers', 'Elige una de las opciones de esta pregunta.')
        source = LEGACY_OPTIONS.get(source, source)
        if source == SOURCE_OPTIONS[2]:
            return product, None, True
        if source in SOURCE_OPTIONS[:2]:
            return product, identifying(form, body.requestId, 'reference' if source == SOURCE_OPTIONS[0] else 'type'), False
        current = service.get_for(connection, user, product['sku'])['evaluation']
        result = service.configure_for(connection, user, product['sku'], product['revision'],
                                       product_type=current.get('productType'), marketplace_id=current.get('marketplaceId'))
    elif step in ('reference', 'type'):
        key = 'asin' if step == 'reference' else 'productType'
        if set(answers) != {key} or not answers[key].strip():
            fail('invalid_requirements_answers', 'Completa el identificador para consultar los requisitos.')
        result = service.configure_for(connection, user, product['sku'], product['revision'],
                                       reference_asin=reference_asin(answers[key]) if step == 'reference' else None,
                                       product_type=answers[key].strip().upper() if step == 'type' else None)
    elif step == 'fields':
        result = service.answer_for(connection, user, product['sku'], product['revision'], context['evaluationId'], answers)
    else:
        fail('form_expired', 'Reanuda la guía para consultar los requisitos actuales.', 409)
    next_form = form_for(result, body.requestId)
    return result['product'], next_form, next_form is None and result['evaluation']['state'] != 'locally_valid'
