"""Guía y edición manual comparten datos, validaciones y revisiones de Producto."""
from copy import deepcopy
from typing import Literal
from fastapi import APIRouter, Request
from pydantic import Field
from .onboarding import StrictBody, require_user
from .security import require_origin
from .products import find, save, present, fail
from .product_preparation_schema import ORDER, SECTIONS, BY_ID, PRODUCT_FIELDS, CUSTOM_FIELDS, empty_state, validate_state, validate_answers


class PreparationPatch(StrictBody):
    revision: int = Field(ge=1)
    mode: Literal['guided', 'manual'] | None = None
    section: str | None = None
    answers: dict[str, str] | None = None
    reviewed: bool | None = None
    advance: bool = False


def state_of(product):
    return deepcopy(product.get('preparation') or empty_state())


def answers_of(product, section):
    state = state_of(product)
    answers = dict(state['sections'].get(section, {}).get('answers', {}))
    for key in PRODUCT_FIELDS.get(section, ()):
        value = product.get(key, '')
        text = '\n'.join(value) if key == 'bullets' and isinstance(value, list) else str(value)
        if len(text.encode('utf-16-le')) // 2 > 3000:
            answers.pop(key, None)
        else:
            answers[key] = text
    if section == 'atributos':
        custom = {f.get('id'): f.get('value', '') for f in product.get('customFields', [])}
        for key in CUSTOM_FIELDS:
            if 'preparation_' + key in custom:
                text = str(custom['preparation_' + key])
                if len(text.encode('utf-16-le')) // 2 <= 3000:
                    answers[key] = text
                else:
                    answers.pop(key, None)
    return answers


def fields_for(product, section):
    definitions = deepcopy(BY_ID[section]['fields'])
    answers = answers_of(product, section)
    custom = {f.get('id'): f.get('value', '') for f in product.get('customFields', [])}
    for definition in definitions:
        key = definition['id']
        value = product.get(key, '') if key in PRODUCT_FIELDS.get(section, ()) else custom.get('preparation_' + key, '') if section == 'atributos' and key in CUSTOM_FIELDS else ''
        text = '\n'.join(value) if isinstance(value, list) else str(value)
        if len(text.encode('utf-16-le')) // 2 > 3000:
            definition.update({'id': key + '_notes', 'label': 'Notas sobre ' + definition['label'].lower(), 'type': 'textarea', 'required': False})
            definition.pop('options', None)
        elif definition['type'] == 'select' and answers.get(key) and answers[key] not in definition['options']:
            # La respuesta propia sigue siendo texto declarado, no una elegibilidad verificada.
            definition.update({'type': 'textarea'})
            definition.pop('options', None)
    return definitions


def dto(product):
    state = state_of(product)
    sections = []
    for definition in SECTIONS:
        section = state['sections'].get(definition['id'])
        answers = answers_of(product, definition['id'])
        definitions = fields_for(product, definition['id'])
        notice = definition['notice']
        if any(f['id'].endswith('_notes') for f in definitions):
            notice += ' El texto extenso guardado se conserva íntegro. Aquí puedes anotar sugerencias; no se sustituye el original.'
        has_data = any(str(value).strip() for value in answers.values())
        sections.append({**deepcopy(definition), 'notice': notice, 'state': 'reviewed' if section and section['reviewed'] and has_data else 'saved' if section and has_data else 'pending',
                         'fields': [{**f, 'value': answers.get(f['id'], '')} for f in definitions]})
    return {'product': product, 'preparation': {**state, 'sections': sections, 'briefReady': all(s['state'] == 'reviewed' for s in sections)}}


def apply(connection, user, sku, patch, source='editor'):
    product = present(find(connection, user, sku))
    if patch.revision != product['revision']:
        fail('product_conflict', 'La ficha ha cambiado. Actualiza los datos antes de guardar; tus respuestas se conservan.', 409)
    state = state_of(product)
    updates = {}
    if patch.mode:
        state['mode'] = patch.mode
    if patch.section is not None:
        if patch.section not in ORDER:
            fail('invalid_preparation', 'La sección indicada no está disponible.')
        state['activeSection'] = patch.section
    if patch.answers is not None or patch.reviewed is not None or patch.advance:
        if not patch.section:
            fail('invalid_preparation', 'Indica qué sección quieres guardar.')
        if patch.answers is not None and set(patch.answers) - {f['id'] for f in fields_for(product, patch.section)}:
            fail('invalid_preparation', 'Hay respuestas que no pertenecen a los campos actuales de esta sección.')
        answers = answers_of(product, patch.section)
        answers.update(patch.answers or {})
        try:
            answers = validate_answers(patch.section, answers, complete=bool(patch.reviewed or patch.advance))
        except ValueError as error:
            fail('invalid_preparation', str(error))
        reviewed = bool(patch.reviewed if patch.reviewed is not None else patch.advance)
        state['sections'][patch.section] = {'answers': answers, 'reviewed': reviewed}
        for key in PRODUCT_FIELDS.get(patch.section, ()):
            if key in answers:
                updates[key] = [line.strip() for line in answers[key].splitlines() if line.strip()] if key == 'bullets' else answers[key]
        if patch.section == 'atributos':
            custom = deepcopy(product.get('customFields', []))
            for key, label in CUSTOM_FIELDS.items():
                if key not in answers:
                    continue
                identifier = 'preparation_' + key
                custom = [f for f in custom if f.get('id') != identifier]
                if answers[key].strip():
                    custom.append({'id': identifier, 'name': label, 'value': answers[key], 'type': 'text', 'options': [], 'isConfirmed': True, 'source': 'user'})
            updates['customFields'] = custom
        if patch.advance:
            index = ORDER.index(patch.section)
            state['activeSection'] = ORDER[min(index + 1, len(ORDER) - 1)]
    try:
        validate_state(state)
    except ValueError as error:
        fail('invalid_preparation', str(error))
    updated = save(connection, user, {**updates, 'revision': product['revision'], 'preparation': state}, product['sku'], source=source)
    return dto(updated)


def routes(settings, database):
    router = APIRouter(prefix='/api/products')

    @router.get('/{sku}/preparation')
    def get_preparation(sku: str, request: Request):
        with database.connect() as connection:
            return dto(present(find(connection, require_user(connection, request), sku)))

    @router.patch('/{sku}/preparation')
    def update_preparation(sku: str, body: PreparationPatch, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            return apply(connection, require_user(connection, request), sku, body)
    return router
