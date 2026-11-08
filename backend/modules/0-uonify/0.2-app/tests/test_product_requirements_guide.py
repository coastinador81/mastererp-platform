"""Chat → PTD → respuestas tipadas → ficha real; Amazon sustituido solo en test."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from cryptography.fernet import Fernet
import pytest
from conftest import client_for, login
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_product_preparation import create_from_chat, answer, request
from test_uony_provider import response
from app.product_requirements import ProductRequirements


def value(title, kind='string', **extra):
    return {'title': title, 'type': 'array', 'minItems': 1, 'items': {
        'type': 'object', 'required': ['value'], 'properties': {
            'value': {'title': title, 'type': kind, **extra},
            'marketplace_id': {'type': 'string'}}}}


SCHEMA = {'type': 'object', 'properties': {
    'item_name': value('Nombre', minLength=1), 'brand': value('Marca', minLength=1),
    'batteries_required': value('¿Necesita pilas?', 'boolean'),
    'battery_count': value('Número de pilas', 'integer', minimum=1, maximum=12)},
    'required': ['item_name', 'brand', 'batteries_required'],
    'allOf': [{'if': {'required': ['batteries_required'], 'properties': {
        'batteries_required': {'contains': {'properties': {'value': {'const': True}}, 'required': ['value']}}}},
        'then': {'required': ['battery_count']}}]}


class RequirementsAmazon:
    def authenticate(self, _refresh):
        pass

    def schema(self, seller, market, product_type):
        assert product_type == 'TABLETOP_GAME'
        return {'schema': deepcopy(SCHEMA), 'schemaHash': 'a' * 64,
                'definition': {'version': {'version': 'test-v1'}}}

    def _get(self, path, params, operation):
        assert operation == 'catalog_item'
        return {'productTypes': [{'marketplaceId': params['marketplaceIds'], 'productType': 'TABLETOP_GAME'}]}


@pytest.fixture
def guided(environment):
    config, google, db = environment
    service = ProductRequirements(config, db, SimpleNamespace(ready=True), lambda _: RequirementsAmazon())
    with client_for(config, google, cloud=Cloud(), requirements=service) as client:
        ready(client, google, db)
        connect(db, config)
        with db.connect() as c:
            user = c.execute('SELECT id FROM users').fetchone()['id']
            c.execute('INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted) VALUES(%s,%s,%s)',
                      (user, 'TEST_SELLER', Fernet(config.encryption_key).encrypt(b'test-only').decode()))
        initial = create_from_chat(client)
        result = client.post('/api/uony/messages', json=answer(initial['conversationForm'], {'mode': 'Formulario interactivo'}))
        assert result.status_code == 200, result.text
        yield client, db, service, result.json()


def send(client, form, answers):
    result = client.post('/api/uony/messages', json=answer(form, answers))
    assert result.status_code == 200, result.text
    return result.json()


def test_chat_configures_from_reference_reevaluates_persists_and_replays(guided):
    client, db, service, result = guided
    assert result['conversationForm']['context']['step'] == 'source'
    result = send(client, result['conversationForm'], {'source': 'Usar un producto parecido de Amazon'})
    assert result['conversationForm']['fields'][0]['id'] == 'asin'
    result = send(client, result['conversationForm'], {'asin': 'B07NPPMZM8'})
    with patch('app.uony_provider.requests.post') as ai:
        for _ in range(4):
            form = result['conversationForm']
            if form is None:
                break
            fields = form['fields']
            values = {f['id']: ('Sí' if 'pilas para funcionar' in f['label'] else '2' if 'Cuántas pilas' in f['label'] else 'Uonify') for f in fields}
            if any('Cuántas pilas' in f['label'] for f in fields):
                bad = client.post('/api/uony/messages', json=answer(form, {f['id']: '-1' for f in fields}))
                assert bad.status_code == 422, bad.text
                assert bad.json()['message'] == '«¿Cuántas pilas necesita?»: El valor debe ser 1 o mayor.'
            body = answer(form, values)
            saved = client.post('/api/uony/messages', json=body)
            assert saved.status_code == 200, saved.text
            assert client.post('/api/uony/messages', json=body).json() == saved.json()
            result = saved.json()
        ai.assert_not_called()
    assert result['conversationForm'] is None
    product = client.get('/api/products').json()['products'][0]
    assert product['brand'] == 'Uonify'
    assert product['amazonAttributes']['batteries_required'][0]['value'] is True
    assert product['amazonAttributes']['battery_count'][0]['value'] == 2
    assert product['status'] == 'draft' and not product['channels']['amazon']
    current = client.get('/api/products/GUIA-01/amazon-requirements').json()
    assert current['evaluation']['state'] == 'locally_valid'
    assert current['product'] == product
    restored = client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]
    assert restored['productChanges'][0]['product'] == product
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_requirement_schemas').fetchone()['n'] == 1


def test_manual_edit_invalidates_pending_question_and_resume_uses_persisted_data(guided):
    client, _, _, result = guided
    result = send(client, result['conversationForm'], {'source': 'Usar un producto parecido de Amazon'})
    result = send(client, result['conversationForm'], {'asin': 'B07NPPMZM8'})
    form = result['conversationForm']
    product = result['productChanges'][0]['product']
    saved = client.patch('/api/products/GUIA-01', json={'revision': product['revision'], 'brand': 'Marca manual'})
    assert saved.status_code == 200
    stale = client.post('/api/uony/messages', json=answer(form, {f['id']: f.get('options', ['Uonify'])[0] for f in form['fields']}))
    assert stale.status_code == 409
    calls = [response([{'functionCall': {'name': 'start_product_guide', 'args': {'sku': 'GUIA-01'}}}]), response([{'text': 'Continuamos.'}])]
    with patch('app.uony_provider.requests.post', side_effect=calls):
        resumed = client.post('/api/uony/messages', json=request('Continúa la preparación de GUIA-01.'))
    assert resumed.status_code == 200, resumed.text
    form = resumed.json()['conversationForm']
    assert all('Marca' not in field['label'] for field in form['fields'])
    assert client.get('/api/products/GUIA-01/amazon-requirements').json()['product']['amazonAttributes']['brand'][0]['value'] == 'Marca manual'


def test_missing_media_or_attributes_can_wait_without_marking_amazon_complete(guided):
    client, _, _, result = guided
    result = send(client, result['conversationForm'], {'source': 'Usar un producto parecido de Amazon'})
    result = send(client, result['conversationForm'], {'asin': 'B07NPPMZM8'})
    result = send(client, result['conversationForm'], {'requirements_action': 'later'})
    assert 'pendientes de comprobar' in result['reply']
    assert result['conversationForm'] is None
    data = client.get('/api/products/GUIA-01/amazon-requirements').json()
    assert data['evaluation']['state'] == 'needs_input'
    assert data['product']['preparation']['sections']['atributos']['reviewed'] is False
    assert result['conversationForm'] is None  # Aplazar no abre ocho preguntas creativas.


def test_disconnected_amazon_offers_connection_inside_the_conversation(guided):
    client, db, _, result = guided
    result = send(client, result['conversationForm'], {'source': 'Usar un producto parecido de Amazon'})
    with db.connect() as c:
        c.execute('DELETE FROM amazon_connections')
    result = client.post('/api/uony/messages', json=answer(result['conversationForm'], {'asin': 'B07NPPMZM8'}))
    assert result.status_code == 409
    assert result.json()['connectionActions'] == [{'provider': 'amazon', 'action': 'manage'}]


def test_resuming_completed_requirements_does_not_offer_another_model_questionnaire(guided):
    client, _, _, result = guided
    result = send(client, result['conversationForm'], {'source': 'Usar un producto parecido de Amazon'})
    result = send(client, result['conversationForm'], {'asin': 'B07NPPMZM8'})
    for _ in range(4):
        form = result['conversationForm']
        if form is None:
            break
        result = send(client, form, {f['id']: 'No' if 'pilas para funcionar' in f['label'] else 'Uonify'
                                    for f in form['fields']})
    assert result['conversationForm'] is None
    calls = [response([{'functionCall': {'name': 'start_product_guide', 'args': {'sku': 'GUIA-01'}}}]),
             response([{'text': 'Continuamos con más datos.'}])]
    with patch('app.uony_provider.requests.post', side_effect=calls):
        resumed = client.post('/api/uony/messages', json=request('Continúa la preparación de GUIA-01.'))
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()['conversationForm'] is None
    assert 'completos según los requisitos consultados' in resumed.json()['reply']
