"""Recorrido HTTP real del chat con Amazon aislado: nunca publica en una cuenta real."""
from copy import deepcopy
from uuid import uuid4
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from app.incident_fields import plan_fields, apply_answers
from app.incident_schema_validation import validate_attributes, validation_errors
from conftest import client_for, login
from test_uony import ready
from test_subscription import complete
from test_amazon_incidents import incident_env, applied

MARKET = 'A1RKKUPIHCS9HS'


def schema():
    return {'type': 'object', 'required': ['item_weight'], 'properties': {
        'item_weight': {'title': 'Peso del artículo', 'type': 'array', 'minItems': 1, 'items': {
            'type': 'object', 'required': ['value', 'unit'], 'properties': {
                'value': {'title': 'Cantidad', 'type': 'number', 'minimum': 0.01},
                'unit': {'title': 'Unidad', 'type': 'string', 'enum': ['grams', 'kilograms'], 'enumNames': ['Gramos', 'Kilogramos']},
                'marketplace_id': {'type': 'string'}}, 'additionalProperties': False}}}}


class Incidents:
    def __init__(self):
        self.owner = None; self.sent = 0; self.version = 1; self.problem = True; self.sync_error = False
        self.item = {'id': str(uuid4()), 'sku': 'BASIC-01', 'marketplaceId': MARKET, 'message': 'Revisa el peso.',
                     'attributeNames': ['item_weight'], 'status': 'needs_attention', 'revision': 1, 'correction': None}
        self.attributes = {'item_weight': [{'value': 0.2, 'unit': 'kilograms', 'marketplace_id': MARKET}]}
        self.schema = schema()

    def get(self, user_id, identifier):
        if self.owner is None: self.owner = user_id
        if user_id != self.owner or str(identifier) != self.item['id']:
            raise HTTPException(404, detail={'error': 'incident_not_found', 'message': 'Incidencia no disponible.'})
        return deepcopy(self.item)

    def context(self, user_id, identifier):
        self.version += 1
        return {'incident': self.get(user_id, identifier), 'attributes': deepcopy(self.attributes), 'schema': self.schema,
                'schemaHash': 'same-schema', 'snapshotVersion': self.version, 'productType': 'TOY'}

    def prepare(self, user, identifier, revision, attributes, request_id, validator):
        assert isinstance(request_id, str)
        assert self.get(user, identifier)['revision'] == revision
        validator(self.schema, {**self.attributes, **attributes}, set(attributes))
        self.item.update(status='correction_ready', revision=revision + 1,
                         correction={'attributes': attributes, 'schemaHash': 'same-schema'})
        return self.get(user, identifier)

    def submit(self, user, identifier, revision, request_id, validator):
        assert isinstance(request_id, str)
        assert self.get(user, identifier)['revision'] == revision
        assert self.item['status'] == 'correction_ready'
        validator(self.schema, {**self.attributes, **self.item['correction']['attributes']}, set(self.item['correction']['attributes']))
        self.sent += 1
        self.item.update(status='awaiting_amazon', revision=revision + 1)
        return self.get(user, identifier)

    def sync(self, user, **kwargs):
        self.get(user, self.item['id'])
        if self.sync_error: return {'sync': {'state': 'error', 'message': 'Amazon no responde; se conserva el estado.'}}
        if self.item['status'] == 'awaiting_amazon' and not self.problem:
            self.item.update(status='resolved', revision=self.item['revision'] + 1)
        return {'sync': {'state': 'ok'}}


def request(service=None, **kwargs):
    result = {'requestId': str(uuid4()), 'threadId': 'incident-flow', 'text': 'Revisar incidencia', **kwargs}
    if service: result['incidentAction'] = {'incidentId': service.item['id'], 'action': 'start'}
    return result


def answer(form, values, **kwargs):
    return request(formResponse={'formId': form['id'], 'answers': values}, **kwargs)


def test_edit_review_explicit_send_processing_check_resolved_replay(environment):
    config, google, db = environment; service = Incidents()
    with client_for(config, google, incidents=service) as client:
        ready(client, google, db)
        capabilities = client.get('/api/uony/services').json()
        assert capabilities['amazonIncidents'] == 'integrated'
        assert capabilities['amazonPublication'] == 'not_integrated'
        with patch('app.uony_provider.requests.post') as ai:
            first = client.post('/api/uony/messages', json=request(service))
            assert first.status_code == 200, first.text
            form = first.json()['conversationForm']
            assert form['context']['step'] == 'edit'
            assert form['fields'][1]['closed']
            result = client.post('/api/uony/messages', json=answer(form, {'field0': '0,3', 'field1': 'Kilogramos'}))
            assert result.status_code == 200, result.text
            review = result.json()['conversationForm']
            assert review['context']['step'] == 'review' and review['review']
            assert service.sent == 0 and service.item['status'] == 'correction_ready'
            # A phrase in text alone cannot submit, nor can a fabricated action.
            invalid = client.post('/api/uony/messages', json=answer(review, {'action': 'Sí, hazlo'}))
            assert invalid.status_code == 400 and service.sent == 0
            send = answer(review, {'action': 'Enviar corrección a Amazon'})
            response = client.post('/api/uony/messages', json=send)
            assert response.status_code == 200, response.text
            assert service.sent == 1 and service.item['status'] == 'awaiting_amazon'
            assert client.post('/api/uony/messages', json=send).status_code == 200
            assert service.sent == 1
            wait = response.json()['conversationForm']
            response = client.post('/api/uony/messages', json=answer(wait, {'action': 'Comprobar estado en Amazon'}))
            assert response.status_code == 200 and service.item['status'] == 'awaiting_amazon'
            service.problem = False
            response = client.post('/api/uony/messages', json=answer(response.json()['conversationForm'], {'action': 'Comprobar estado en Amazon'}))
            assert response.status_code == 200, response.text
            assert response.json()['conversationForm'] is None and service.item['status'] == 'resolved'
            ai.assert_not_called()
        history = client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert history[-1]['conversationForm'] is None
        assert any(m.get('conversationForm', {}).get('context', {}).get('step') == 'review' for m in history if isinstance(m.get('conversationForm'), dict))


def test_old_form_other_thread_other_user_and_listing_change_are_rejected(environment):
    config, google, db = environment; service = Incidents()
    with client_for(config, google, incidents=service) as client:
        ready(client, google, db)
        first = client.post('/api/uony/messages', json=request(service)).json()['conversationForm']
        second = client.post('/api/uony/messages', json=request(service)).json()['conversationForm']
        values = {'field0': '1', 'field1': 'Gramos'}
        assert client.post('/api/uony/messages', json=answer(first, values)).status_code == 409
        assert client.post('/api/uony/messages', json=answer(second, values, threadId='other-thread')).status_code == 404
        service.attributes['item_weight'][0]['value'] = 0.4
        result = client.post('/api/uony/messages', json=answer(second, values))
        assert result.status_code == 409 and service.sent == 0
        google.subject = 'other-incident-owner'; google.email = 'other@example.test'
        login(client, google)
        complete(client)
        with db.connect() as c:
            other = c.execute('SELECT id FROM users WHERE email=%s', (google.email,)).fetchone()['id']
            c.execute("UPDATE users SET onboarding_completed_at=now() WHERE id=%s", (other,))
            c.execute("INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference) VALUES(%s,%s,'trial',now(),now()+interval '1 day',%s)", (uuid4(),other,'fixture-'+str(uuid4())))
        assert client.post('/api/uony/messages', json=request(service)).status_code == 404


def test_sync_failure_does_not_clear_or_request_resubmission(environment):
    config, google, db = environment; service = Incidents(); service.item['status'] = 'awaiting_amazon'; service.sync_error = True
    with client_for(config, google, incidents=service) as client:
        ready(client, google, db)
        body = request(service); body['incidentAction']['action'] = 'check'
        result = client.post('/api/uony/messages', json=body)
        assert result.status_code == 200, result.text
        assert 'no responde' in result.json()['reply'] and service.item['status'] == 'awaiting_amazon'
        assert 'Enviar corrección a Amazon' not in result.json()['conversationForm']['fields'][0]['options']


def test_schema_controls_open_enum_numbers_boolean_refs_and_foreign_markets():
    data = schema(); data['properties']['material'] = {'type': 'array', 'items': {'type': 'object', 'required': ['value'], 'properties': {
        'value': {'anyOf': [{'type': 'string', 'enum': ['Wood']}, {'type': 'string'}]}}}}
    data['properties']['battery'] = {'type': 'array', 'items': {'type': 'object', 'properties': {'value': {'type': 'boolean'}}, 'required': ['value']}}
    attrs = {'item_weight': [{'value': 1, 'unit': 'grams', 'marketplace_id': 'OTHER'}]}
    candidate, fields, specs, _ = plan_fields(data, attrs, ['material', 'battery', 'item_weight'], MARKET)
    assert candidate['item_weight'] == attrs['item_weight']
    open_field = next(f for f in fields if f.get('options') == ['Wood'])
    bool_field = next(f for f in fields if f.get('options') == ['Sí', 'No'])
    assert not open_field['closed'] and bool_field['closed']
    result = apply_answers(candidate, specs, [open_field, bool_field], {open_field['id']: 'Metal', bool_field['id']: 'No'})
    assert result['material'][0]['value'] == 'Metal' and result['battery'][0]['value'] is False


def test_full_schema_conditions_and_amazon_vocabulary_are_enforced():
    data = {'type': 'object', 'properties': {'items': {'type': 'array', 'selectors': ['market'], 'uniqueItems': True, 'maxUniqueItems': 1,
            'items': {'type': 'object'}}, 'name': {'type': 'string', 'maxUtf8ByteLength': 3}},
            'if': {'required': ['items']}, 'then': {'required': ['name']}}
    with pytest.raises(HTTPException): validate_attributes(data, {'items': [{'market': 'ES'}, {'market': 'ES', 'value': 1}]}, {'items'})
    assert validation_errors(data, {'items': [{'market': 'ES'}], 'name': 'áá'})
    assert not validation_errors(data, {'items': [{'market': 'ES'}], 'name': 'a'})


def test_http_chat_uses_real_incident_service_persistence_and_reconciliation(incident_env):
    _, _, db, client, user, amazon, service = incident_env
    incident = service.sync(user)['incidents'][0]
    body = request(incidentAction={'incidentId': incident['id'], 'action': 'start'})
    started = client.post('/api/uony/messages', json=body)
    assert started.status_code == 200, started.text
    form = started.json()['conversationForm']
    proposed = client.post('/api/uony/messages', json=answer(form, {'field0': 'Título corregido'}))
    assert proposed.status_code == 200, proposed.text
    review = proposed.json()['conversationForm']
    assert review['review'] == [{'label': 'item_name', 'before': 'Valor: Anterior', 'after': 'Valor: Título corregido'}]
    assert not amazon.calls and service.get(user, incident['id'])['status'] == 'correction_ready'
    body = answer(review, {'action': 'Enviar corrección a Amazon'})
    sent = client.post('/api/uony/messages', json=body)
    assert sent.status_code == 200, sent.text
    assert service.get(user, incident['id'])['status'] == 'awaiting_amazon'
    assert client.post('/api/uony/messages', json=body).status_code == 200 and len(amazon.calls) == 1
    applied(incident_env, clear=False)
    # A processed correction with the issue still present requires another review.
    assert service.get(user, incident['id'])['status'] == 'needs_attention'
    resumed = client.post('/api/uony/messages', json=request(incidentAction={'incidentId': incident['id'], 'action': 'start'}))
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()['conversationForm']['context']['step'] == 'edit'
    proposed = client.post('/api/uony/messages', json=answer(resumed.json()['conversationForm'], {'field0': 'Título definitivo'}))
    assert proposed.status_code == 200, proposed.text
    sent = client.post('/api/uony/messages', json=answer(proposed.json()['conversationForm'], {'action': 'Enviar corrección a Amazon'}))
    assert sent.status_code == 200 and len(amazon.calls) == 2
    applied(incident_env)
    checked = client.post('/api/uony/messages', json=request(incidentAction={'incidentId': incident['id'], 'action': 'check'}))
    assert checked.status_code == 200 and checked.json()['conversationForm'] is None
    assert service.get(user, incident['id'])['status'] == 'resolved'


def test_current_catalog_text_is_preserved_exactly():
    data = {'type': 'object', 'properties': {'description': {'type': 'array', 'items': {'type': 'object', 'required': ['value'],
            'properties': {'value': {'type': 'string'}}}}}}
    attrs = {'description': [{'value': '<p>Temperatura < 20 °C</p>'}]}
    _, fields, _, _ = plan_fields(data, attrs, ['description'], MARKET)
    assert fields[0]['value'] == attrs['description'][0]['value']
