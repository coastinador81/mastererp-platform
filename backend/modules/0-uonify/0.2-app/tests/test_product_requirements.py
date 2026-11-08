"""Evaluación real del esquema y persistencia de borradores; Amazon sustituido, cero envíos."""
from copy import deepcopy
from types import SimpleNamespace
import pytest
from cryptography.fernet import Fernet
from app.product_requirements import ProductRequirements
from app.product_requirements_fields import evaluate, apply
from app.amazon_catalog import MARKETPLACE
from conftest import client_for, login
from test_uony import ready


def value(kind='string', **extra):
    return {'type': 'array', 'minItems': 1, 'items': {'type': 'object', 'required': ['value'],
        'properties': {'value': {'type': kind, **extra}, 'marketplace_id': {'type': 'string'}, 'language_tag': {'type': 'string'}},
        'additionalProperties': False}}


SCHEMA = {'type': 'object', 'properties': {'item_name': value(maxLength=200), 'brand': value(minLength=1),
    'battery': value('boolean'), 'battery_count': value('integer', minimum=1, maximum=20),
    'material': value(enum=['wood', 'plastic'], enumNames=['Madera', 'Plástico'])},
    'required': ['item_name', 'brand', 'battery', 'material'], 'allOf': [
        {'if': {'required': ['battery'], 'properties': {'battery': {'contains': {'properties': {'value': {'const': True}}, 'required': ['value']}}}},
         'then': {'required': ['battery_count']}}]}


class Amazon:
    def __init__(self): self.schema_data = deepcopy(SCHEMA); self.reads = 0
    def authenticate(self, refresh): assert refresh == 'test-only-refresh'
    def schema(self, seller, market, product_type):
        assert seller == 'SELLER_TEST'; self.reads += 1
        return {'schema': deepcopy(self.schema_data), 'schemaHash': 'a' * 64,
                'definition': {'version': {'version': 'fixture-v1'}, 'productType': product_type}}
    def _get(self, path, params, operation):
        return {'productTypes': [{'marketplaceId': params['marketplaceIds'], 'productType': 'TOY'}]}
    def patch(self, *args): pytest.fail('Requisitos no deben publicar en Amazon')


@pytest.fixture
def requirement_env(environment):
    config, google, db = environment; amazon = Amazon()
    service = ProductRequirements(config, db, SimpleNamespace(ready=True), lambda _: amazon)
    with client_for(config, google, requirements=service) as client:
        ready(client, google, db)
        with db.connect() as c:
            user = c.execute('SELECT id FROM users').fetchone()['id']
            c.execute('INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted) VALUES(%s,%s,%s)',
                      (user, 'SELLER_TEST', Fernet(config.encryption_key).encrypt(b'test-only-refresh').decode()))
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks', 'brand': 'Uonify'}).json()['product']
        yield client, db, service, amazon, product, google


def configure(client, product):
    response = client.post('/api/products/BASIC/amazon-requirements', json={'revision': product['revision'], 'referenceAsin': 'B07NPPMZM8'})
    assert response.status_code == 200, response.text
    return response.json()


def answer(client, result, value_, attribute=None):
    field = result['evaluation']['fields'][0]
    return client.patch('/api/products/BASIC/amazon-requirements', json={'revision': result['product']['revision'],
        'evaluationId': result['evaluation']['evaluationId'], 'answers': {field['id']: value_}, **({'attribute': attribute} if attribute else {})})


def test_dynamic_branch_persistence_and_reopen(requirement_env):
    client, db, service, amazon, product, _ = requirement_env
    assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['state'] == 'unconfigured'
    result = configure(client, product)
    assert result['product']['revision'] == 2
    assert result['product']['amazonAttributes']['item_name'][0]['value'] == 'Basic Mini Bricks'
    assert result['evaluation']['fields'][0]['options'] == ['Sí', 'No']
    result = answer(client, result, 'Sí').json()
    assert result['evaluation']['fields'][0]['validation']['number'] == 'integer'
    bad = answer(client, result, '0')
    assert bad.status_code == 422, bad.text
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision'] == 3
    result = answer(client, result, '2').json()
    assert result['evaluation']['fields'][0]['options'] == ['Madera', 'Plástico']
    result = answer(client, result, 'Madera').json()
    assert result['evaluation']['state'] == 'locally_valid'
    assert result['evaluation']['localOnly'] is True
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product'] == result['product']
    assert amazon.reads == 1
    with db.connect() as c:
        revisions = c.execute('SELECT data FROM product_revisions ORDER BY revision').fetchall()
    assert revisions[-1]['data']['amazonAttributes']['material'][0]['value'] == 'wood'


def test_changes_in_manual_editor_and_dynamic_form_share_same_fields(requirement_env):
    client, _, _, _, product, _ = requirement_env
    result = configure(client, product)
    manual = client.patch('/api/products/BASIC', json={'revision': 2, 'brand': 'Nueva marca'}).json()['product']
    assert manual['amazonAttributes']['brand'][0]['value'] == 'Nueva marca'
    optional = client.get('/api/products/BASIC/amazon-requirements?attribute=brand').json()
    result = answer(client, optional, 'Marca corregida', 'brand').json()
    assert result['product']['brand'] == 'Marca corregida'
    stale = answer(client, optional, 'Respuesta antigua', 'brand')
    assert stale.status_code == 409
    assert answer(client, result, 'Respuesta inválida').status_code == 400


def test_snapshot_context_refresh_stale_and_account_isolation(requirement_env):
    client, db, _, amazon, product, google = requirement_env
    result = configure(client, product)
    with db.connect() as c:
        c.execute("UPDATE product_requirement_schemas SET fetched_at=now()-interval '25 hours'")
    stale = client.get('/api/products/BASIC/amazon-requirements').json()
    assert stale['evaluation']['state'] == 'stale' and stale['evaluation']['fields'] == []
    assert answer(client, result, 'Sí').status_code == 409
    result = client.post('/api/products/BASIC/amazon-requirements', json={'revision': 2, 'productType': 'TOY'}).json()
    assert result['evaluation']['state'] == 'needs_input' and amazon.reads == 2
    google.subject = 'other'; google.email = 'other@example.test'; login(client, google)
    assert client.get('/api/products/BASIC/amazon-requirements').status_code == 404


def test_protected_attributes_cannot_be_forged_and_unknown_values_not_saved(requirement_env):
    client, _, _, _, product, _ = requirement_env
    configured = configure(client, product)
    direct = client.patch('/api/products/BASIC', json={'revision': 2, 'amazonAttributes': {'material': [{'value': 'fake'}]}}).json()['product']
    assert 'material' not in direct['amazonAttributes']
    selected = client.get('/api/products/BASIC/amazon-requirements?attribute=material').json()
    assert answer(client, selected, 'Inventado', 'material').status_code == 400
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision'] == 3


def test_more_than_160_fields_is_incremental_not_blocked():
    schema = {'type': 'object', 'properties': {f'a{i}': {'title': f'Dato del producto {i + 1}', **value()} for i in range(200)}, 'required': [f'a{i}' for i in range(200)]}
    result = evaluate(schema, {}, MARKETPLACE)
    assert result['counts']['questions'] == 200 and len(result['fields']) == 1
    assert not result['needsReview']


def test_conditional_required_disappears_when_parent_answer_changes():
    attrs = {'battery': [{'value': True, 'marketplace_id': MARKETPLACE}]}
    first = evaluate(SCHEMA, attrs, MARKETPLACE, 'battery')
    updated, _ = apply(SCHEMA, attrs, MARKETPLACE, {first['fields'][0]['id']: 'No'}, 'battery')
    result = evaluate(SCHEMA, updated, MARKETPLACE)
    assert not next(item for item in result['attributes'] if item['id'] == 'battery_count')['required']


def test_new_answer_activates_pattern_in_same_batch_without_saving_invalid_data():
    schema = {'type': 'object', 'required': ['identifier'], 'properties': {
        'identifier': {'type': 'object', 'required': ['kind', 'value'], 'properties': {
            'kind': {'type': 'string', 'enum': ['ean', 'other']}, 'value': {'type': 'string'}},
            'if': {'required': ['kind'], 'properties': {'kind': {'const': 'ean'}}},
            'then': {'properties': {'value': {'pattern': '^[0-9]{13}$'}}}}}}
    plan = evaluate(schema, {}, MARKETPLACE)
    answers = {field['id']: 'EAN' if plan['specs'][field['id']]['path'][-1] == 'kind' else 'incorrecto'
               for field in plan['fields']}
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKETPLACE, answers)
    assert caught.value.status_code == 422
