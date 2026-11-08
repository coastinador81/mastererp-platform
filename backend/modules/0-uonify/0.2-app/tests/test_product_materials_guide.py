"""La confirmación conversa, persiste y reevalúa; no ejecuta IA ni publica."""
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.products import find
from app.product_materials_guide import ACCEPT, REJECT
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_provider import response
from conftest import login


def message(**extra):
    return {'requestId': str(uuid4()), 'threadId': 'drive-guide', 'text': 'Revisar datos de Drive', **extra}


class Materials:
    def __init__(self):
        self.job = {'id': str(uuid4()), 'status': 'ready', 'sources': [{'id': 'source1', 'name': 'Ficha.pdf'}],
                    'proposals': [
                        {'id': 'name', 'field': 'name', 'label': 'Nombre', 'value': 'Basic Mini Bricks'},
                        {'id': 'brand', 'field': 'brand', 'label': 'Marca', 'value': 'Uonify'},
                        {'id': 'material', 'field': 'material', 'label': 'Material', 'value': 'Madera'},
                        {'id': 'unknown', 'field': 'wood_species', 'label': 'Especie de madera', 'value': 'Pendiente de comprobar'},
                    ]}
        for p in self.job['proposals']:
            p.update(status='proposed', evidence=[{'sourceId': 'source1', 'locator': 'Página 1', 'excerpt': p['value']}])

    def get(self, connection, user, sku, job_id=None):
        product = find(connection, user, sku)
        assert job_id in (None, self.job['id'])
        return {'job': deepcopy(self.job), 'product': {'sku': sku, 'revision': product['revision']}}

    def update_proposals(self, connection, user, sku, job_id, proposals):
        find(connection, user, sku)
        assert job_id == self.job['id']
        self.job['proposals'] = deepcopy(proposals)

    def update_facts(self, connection, user, sku, job_id, proposals):
        find(connection, user, sku)
        assert job_id == self.job['id']
        self.job['facts']['proposals'] = deepcopy(proposals)


@pytest.fixture
def setup(environment):
    config, google, db = environment
    materials = Materials()
    with TestClient(create_app(config, provider=google, cloud=Cloud(), materials=materials), base_url=config.origin) as client:
        client.headers['Origin'] = config.origin
        ready(client, google, db)
        connect(db, config)
        created = client.post('/api/products', json={'name': 'Borrador', 'sku': 'DRIVE-01', 'customFields': [
            {'id': 'existing', 'name': 'Dato manual', 'value': 'Conservar', 'type': 'text', 'isConfirmed': True}]}).json()['product']
        yield client, db, google, materials, created


def review(client, materials):
    result = client.post('/api/uony/messages', json=message(materialAction={'action': 'review', 'sku': 'DRIVE-01', 'analysisId': materials.job['id']}))
    assert result.status_code == 200, result.text
    return result.json()['conversationForm']


def answer(client, form, **answers):
    return client.post('/api/uony/messages', json=message(formResponse={'formId': form['id'], 'answers': answers}))


def historical_form(db, materials, product):
    from psycopg.types.json import Jsonb
    form = {'id': str(uuid4()), 'title': 'Revisar datos encontrados en Drive',
        'fields': [{'id': 'p0', 'label': 'Datos de diseño', 'type': 'text', 'required': False}],
        'context': {'kind': 'drive_analysis', 'sku': product['sku'], 'revision': product['revision'],
                    'section': 'review', 'analysisId': materials.job['id'], 'proposalIds': ['name']}}
    with db.connect() as c:
        user = c.execute('SELECT id FROM users').fetchone()['id']
        c.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,status,model,project_id,conversation_form) VALUES(%s,%s,'drive-guide','Revisión histórica','Responde','success','uonify-guide','uonify-guide',%s)",
                  (user, form['id'], Jsonb(form)))
    return form


def test_material_review_goes_to_amazon_context_without_reviewing_all_source_facts(setup):
    client, _, _, materials, product = setup
    original = deepcopy(materials.job)
    with patch('app.uony_provider.requests.post') as ai:
        form = review(client, materials)
        ai.assert_not_called()
    assert form['context']['kind'] == 'product_guide'
    assert form['context']['section'] == 'amazon_requirements'
    assert form['context']['step'] == 'source'
    assert not any(f['id'].startswith('p0') for f in form['fields'])
    current = client.get('/api/products').json()['products'][0]
    assert current['name'] == product['name'] and current['customFields'] == product['customFields']
    assert materials.job == original
    assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['conversationForm'] == form


def test_obsolete_form_answers_are_not_applied_and_history_is_preserved(setup):
    client, db, _, materials, product = setup
    form = historical_form(db, materials, product)
    original = deepcopy(materials.job)
    response = answer(client, form, p0='SUSTITUIR FICHA', review_action=ACCEPT)
    assert response.status_code == 200, response.text
    assert response.json()['conversationForm']['context']['section'] == 'amazon_requirements'
    assert 'sustituido' in response.json()['reply']
    current = client.get('/api/products').json()['products'][0]
    assert current['name'] == product['name'] and current['customFields'] == product['customFields']
    assert materials.job == original
    with db.connect() as c:
        assert c.execute('SELECT conversation_form FROM uony_requests WHERE request_id=%s', (form['id'],)).fetchone()['conversation_form'] == form
    assert answer(client, form, p0='otra vez').status_code == 409


def test_obsolete_form_does_not_restore_an_older_product_revision(setup):
    client, db, _, materials, product = setup
    form = historical_form(db, materials, product)
    updated = client.patch('/api/products/DRIVE-01', json={'revision': product['revision'], 'name': 'Nombre conservado'}).json()['product']
    response = answer(client, form, p0='Nombre obsoleto')
    assert response.status_code == 200, response.text
    assert client.get('/api/products').json()['products'][0]['name'] == updated['name']


def test_pending_job_and_cross_user_are_still_protected(setup):
    client, _, google, materials, _ = setup
    materials.job['status'] = 'running'
    pending = client.post('/api/uony/messages', json=message(materialAction={'action': 'review', 'sku': 'DRIVE-01', 'analysisId': materials.job['id']}))
    assert pending.status_code == 409
    google.subject = 'other'; google.email = 'other@example.test'; login(client, google)
    assert client.get('/api/products/DRIVE-01/materials').status_code == 404


def test_agent_materials_card_follows_creation_in_a_separate_turn(setup):
    client, _, _, _, _ = setup
    calls = [response([{'functionCall': {'name': 'create_product', 'args': {'name': 'Otro', 'sku': 'DRIVE-02'}}}]),
             response([{'functionCall': {'name': 'show_product_materials', 'args': {'sku': 'DRIVE-02'}}}]),
             response([{'text': 'El borrador está guardado.'}]),
             response([{'functionCall': {'name': 'show_product_materials', 'args': {'sku': 'DRIVE-02'}}}]),
             response([{'text': 'Elige una carpeta.'}])]
    with patch('app.uony_provider.requests.post', side_effect=calls):
        created = client.post('/api/uony/messages', json=message(text='Crea otro borrador desde mis materiales de Drive.'))
        assert created.status_code == 202, created.text
        worker=client.app.state.conversation_worker
        worker.run(worker.queue.claim('materials-guide-fixture'))
        first=client.get(created.json()['pollUrl']).json()
        assert first['status']=='success', first
        assert 'materialAnalysis' not in first['response']
        assert first['response']['productChanges'] == []
        proposal = first['response']['productProposal']
        assert proposal['status'] == 'pending' and proposal['action'] == 'create'
        assert proposal['targetSku'] == 'DRIVE-02'
        assert [p['sku'] for p in client.get('/api/products').json()['products']] == ['DRIVE-01']
        # La tarjeta de materiales se rechazó porque preparar una propuesta
        # no guarda la ficha. Solo la aprobación explícita crea y vincula el
        # borrador; entonces el cliente puede pedir materiales en otro turno.
        approved = client.post(
            '/api/uony/product-proposals/' + proposal['proposalId'] + '/decision',
            json={'threadId': proposal['threadId'], 'requestId': str(uuid4()),
                  'proposalHash': proposal['proposalHash'],
                  'baseRevision': proposal['baseRevision'], 'action': 'approve'})
        assert approved.status_code == 200, approved.text
        assert approved.json()['productChanges'][0]['product']['sku'] == 'DRIVE-02'
        result = client.post('/api/uony/messages', json=message(text='Ahora muestra los materiales de DRIVE-02.'))
        assert result.status_code == 202, result.text
        worker.run(worker.queue.claim('materials-guide-fixture'))
    state=client.get(result.json()['pollUrl']).json()
    assert state['status']=='success', state
    assert state['response']['materialAnalysis'] == {'sku': 'DRIVE-02', 'revision': 1}
    assert state['response']['conversationForm'] is None
    assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['materialAnalysis'] == state['response']['materialAnalysis']



@pytest.mark.parametrize('status', ['error', 'paused'])
def test_partial_materials_preserve_facts_and_do_not_ask_their_arbitrary_fields(setup, status):
    client, _, _, materials, _ = setup
    materials.job['status'] = status
    original = deepcopy(materials.job)
    response = client.post('/api/uony/messages', json=message(materialAction={'action': 'review', 'sku': 'DRIVE-01', 'analysisId': materials.job['id']}))
    assert response.status_code == 200, response.text
    assert 'incompleto' in response.json()['reply']
    assert response.json()['conversationForm']['context']['section'] == 'amazon_requirements'
    assert materials.job == original
