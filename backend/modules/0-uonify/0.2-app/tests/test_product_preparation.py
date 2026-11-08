"""Elección y ocho etapas reales, con historial, aislamiento y los mismos datos del editor."""
from unittest.mock import patch
from uuid import uuid4

import pytest
from psycopg.errors import CheckViolation
from psycopg.types.json import Jsonb
from conftest import client_for, login
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_provider import response
from test_subscription import complete
from app.product_preparation_schema import ORDER


def request(text='Crea un borrador del juego de madera con SKU GUIA-01.'):
    return {'requestId': str(uuid4()), 'threadId': 'guide-thread', 'text': text}


def create_from_chat(client):
    body = request('Crea el borrador GUIA-01 y déjame elegir entre formulario y módulo manual.')
    calls = response([{'functionCall': {'name': 'create_product', 'args': {'sku': 'GUIA-01', 'name': 'Juego de madera'}}}])
    with patch('app.uony_provider.requests.post', side_effect=[calls, response([{'text': 'El borrador está guardado.'}])]) as provider:
        result = client.post('/api/uony/messages', json=body)
        assert result.status_code == 200, result.text
        assert provider.call_count == 2
    proposal = result.json()['productProposal']
    assert result.json()['conversationForm'] is None
    assert client.get('/api/products').json()['products'] == []
    approved = client.post('/api/uony/product-proposals/' + proposal['proposalId'] + '/decision', json={
        'threadId': body['threadId'], 'requestId': str(uuid4()),
        'proposalHash': proposal['proposalHash'], 'baseRevision': None,
        'action': 'approve'})
    assert approved.status_code == 200, approved.text
    choice = response([{'functionCall': {'name': 'start_product_guide', 'args': {
        'sku': 'GUIA-01', 'offerModeChoice': True}}}])
    with patch('app.uony_provider.requests.post', side_effect=[choice,
        response([{'text': 'Puedes elegir cómo continuar.'}])]):
        continued = client.post('/api/uony/messages', json=request(
            'Ahora déjame elegir entre formulario y módulo manual para GUIA-01.'))
    assert continued.status_code == 200, continued.text
    return continued.json()


def answer(form, answers, **extra):
    return {**request('Mis respuestas para continuar.'), 'formResponse': {'formId': form['id'], 'answers': answers}, **extra}


def test_guided_category_can_wait_without_opening_general_questionnaire(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        result = create_from_chat(client)
        form = result['conversationForm']
        assert form['context'] == {'kind': 'product_guide', 'sku': 'GUIA-01', 'revision': 1, 'section': 'choice'}
        assert form['fields'][0]['options'] == ['Formulario interactivo', 'Módulo Producto']
        with db.connect() as c:
            c.execute('DELETE FROM google_cloud_connections')
        with patch('app.uony_provider.requests.post') as provider:
            start = client.post('/api/uony/messages', json=answer(form, {'mode': 'Formulario interactivo'}))
            assert start.status_code == 200, start.text
            form = start.json()['conversationForm']
            assert form['context']['section'] == 'amazon_requirements'
            assert 'Indicar el tipo de producto de Amazon' not in form['fields'][0]['options']
            body = answer(form, {'source': 'Completar la categoría más tarde'})
            saved = client.post('/api/uony/messages', json=body)
            assert saved.status_code == 200, saved.text
            result = saved.json()
            assert client.post('/api/uony/messages', json=body).json() == result
            provider.assert_not_called()
        assert result['conversationForm'] is None
        assert 'pendientes de comprobar' in result['reply']
        product = result['productChanges'][0]['product']
        assert product['channels']['amazon'] is False and product['status'] == 'draft'
        assert product['name'] == 'Juego de madera'
        assert not product['preparation']['sections']['atributos']['reviewed']
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['productChanges'][0]['product'] == product
    with client_for(config, google, cloud=Cloud()) as client:
        login(client, google)
        assert client.get('/api/products/GUIA-01/preparation').json()['product'] == product


@pytest.mark.parametrize('empty', ['', '   '])
def test_clearing_optional_guide_attributes_removes_only_their_own_fields(environment, empty):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        unrelated = {'id': 'customer_color', 'name': 'Color', 'value': 'Natural', 'type': 'text', 'isConfirmed': True}
        product = client.post('/api/products', json={'sku': 'OPTIONAL', 'name': 'Juego', 'customFields': [unrelated]}).json()['product']
        saved = client.patch('/api/products/OPTIONAL/preparation', json={'revision': product['revision'], 'section': 'atributos', 'answers': {'material': 'Madera', 'dimensions': '20 cm'}, 'reviewed': True})
        assert saved.status_code == 200, saved.text
        product = saved.json()['product']
        assert {f['id'] for f in product['customFields']} == {'customer_color', 'preparation_material', 'preparation_dimensions'}
        cleared = client.patch('/api/products/OPTIONAL/preparation', json={'revision': product['revision'], 'section': 'atributos', 'answers': {'dimensions': empty}, 'reviewed': True})
        assert cleared.status_code == 200, cleared.text
        product = cleared.json()['product']
        assert {f['id'] for f in product['customFields']} == {'customer_color', 'preparation_material'}
        assert all(f['isConfirmed'] for f in product['customFields'])
        assert unrelated in product['customFields']
        assert client.get('/api/products/OPTIONAL/preparation').json()['product'] == product


def test_manual_choice_and_editor_share_revision_state_and_conflict_protection(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        initial = create_from_chat(client)
        with patch('app.uony_provider.requests.post') as provider:
            manual = client.post('/api/uony/messages', json=answer(initial['conversationForm'], {'mode': 'Módulo Producto'}))
            assert manual.status_code == 200
            assert manual.json()['conversationForm'] is None
            provider.assert_not_called()
        product = manual.json()['productChanges'][0]['product']
        update = {'revision': product['revision'], 'section': 'atributos', 'answers': {'brand': 'Marca editada'}, 'reviewed': True, 'advance': True}
        result = client.patch('/api/products/GUIA-01/preparation', json=update)
        assert result.status_code == 200, result.text
        assert result.json()['preparation']['mode'] == 'manual'
        assert result.json()['preparation']['activeSection'] == 'auditoria'
        assert result.json()['product']['brand'] == 'Marca editada'
        assert client.patch('/api/products/GUIA-01/preparation', json=update).status_code == 409
        catalog = client.get('/api/products').json()['products'][0]
        assert catalog == result.json()['product']
        body = request('Quiero elegir cómo continuar la guía de GUIA-01.')
        with patch('app.uony_provider.requests.post', side_effect=[response([{'functionCall': {'name': 'start_product_guide', 'args': {'sku': 'GUIA-01', 'offerModeChoice': True}}}]), response([{'text': 'Continúa con el formulario.'}])]):
            resumed = client.post('/api/uony/messages', json=body)
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()['conversationForm']['context']['section'] == 'choice'
        assert resumed.json()['productChanges'][0]['product']['revision'] == catalog['revision']


def test_guide_checks_owner_origin_access_latest_form_and_product_revision(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        assert client.get('/api/products/NO/preparation').status_code == 401
        ready(client, google, db)
        connect(db, config)
        first = create_from_chat(client)['conversationForm']
        body = answer(first, {'mode': 'Formulario interactivo'})
        assert client.post('/api/uony/messages', json=body, headers={'Origin': 'null'}).status_code == 403
        result = client.post('/api/uony/messages', json=body)
        assert result.status_code == 200
        form = result.json()['conversationForm']
        assert client.post('/api/uony/messages', json=answer(first, {'mode': 'Módulo Producto'})).status_code == 409
        assert client.post('/api/uony/messages', json=answer(form, {'source': ''})).status_code == 400
        assert client.post('/api/uony/messages', json=answer(form, {'not_in_form': 'x'})).status_code == 400
        assert client.post('/api/uony/messages', json=answer(form, {'source': 'Completar la categoría más tarde'}, threadId='foreign-thread')).status_code == 404
        with db.connect() as c:
            c.execute('UPDATE products SET revision=revision+1')
        assert client.post('/api/uony/messages', json=answer(form, {'source': 'Completar la categoría más tarde'})).status_code == 409
        with db.connect() as c:
            c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.post('/api/uony/messages', json=answer(form, {'source': 'Completar la categoría más tarde'})).status_code == 403
        google.subject = 'other-guide-user'
        google.email = 'other-guide@example.test'
        ready(client,google,db)
        assert client.get('/api/products/GUIA-01/preparation').status_code == 404
        assert client.post('/api/uony/messages', json=answer(first, {'mode': 'Formulario interactivo'})).status_code == 404


def test_a_new_plain_reply_expires_the_previous_form(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        form = create_from_chat(client)['conversationForm']
        with patch('app.uony_provider.requests.post', return_value=response([{'text': 'El borrador sigue guardado.'}])):
            assert client.post('/api/uony/messages', json=request('Solo confirma que el borrador existe.')).status_code == 200
        assert client.post('/api/uony/messages', json=answer(form, {'mode': 'Formulario interactivo'})).status_code == 409


def test_custom_select_answers_remain_text_and_large_preparation_is_bounded_separately(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        product = client.post('/api/products', json={'sku': 'BRIEF', 'name': 'Producto'}).json()['product']
        for section in ORDER:
            data = client.get('/api/products/BRIEF/preparation').json()
            fields = next(s['fields'] for s in data['preparation']['sections'] if s['id'] == section)
            if section in ('atributos', 'descripciones'):
                continue
            answers = {f['id']: '界' * 3000 for f in fields}
            if section == 'imagenes':
                answers['source'] = 'https://drive.google.com/carpeta/ejemplo'
            saved = client.patch('/api/products/BRIEF/preparation', json={'revision': product['revision'], 'section': section, 'answers': answers, 'reviewed': True})
            assert saved.status_code == 200, saved.text
            product = saved.json()['product']
        data = client.get('/api/products/BRIEF/preparation').json()
        source = next(f for s in data['preparation']['sections'] if s['id'] == 'imagenes' for f in s['fields'] if f['id'] == 'source')
        assert source['type'] == 'textarea' and 'options' not in source
        assert source['value'] == 'https://drive.google.com/carpeta/ejemplo'
        assert len(str(product['preparation']).encode()) > 60000


def test_manual_empty_sections_remain_pending_and_do_not_generate_resources(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        result = create_from_chat(client)
        chosen = client.post('/api/uony/messages', json=answer(result['conversationForm'], {'mode': 'Módulo Producto'}))
        assert chosen.status_code == 200
        product = chosen.json()['productChanges'][0]['product']
        assert chosen.json()['conversationForm'] is None
        for section in ORDER:
            saved = client.patch('/api/products/GUIA-01/preparation', json={
                'revision': product['revision'], 'section': section, 'answers': {}, 'reviewed': True, 'advance': True})
            assert saved.status_code == 200, saved.text
            product = saved.json()['product']
        prepared = client.get('/api/products/GUIA-01/preparation').json()['preparation']
        assert prepared['briefReady'] is False
        assert prepared['sections'][0]['state'] == 'reviewed'
        assert all(section['state'] == 'pending' for section in prepared['sections'][1:])
        assert not product['channels']['amazon'] and product['status'] == 'draft'


def test_large_existing_text_is_never_truncated_or_overwritten_by_guide_notes(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        description = 'Descripción existente. ' * 220
        bullets = ['Viñeta extensa. ' * 80 for _ in range(4)]
        keywords = '😀' * 1600
        product = client.post('/api/products', json={'sku': 'LARGE', 'name': 'Existente', 'description': description, 'bullets': bullets}).json()['product']
        # La validación global conserva su límite de 60 KB; solo cambiamos una cadena corta para probar UTF-16.
        product = client.patch('/api/products/LARGE', json={'revision': product['revision'], 'keywords': keywords}).json()['product']
        data = client.get('/api/products/LARGE/preparation').json()
        section = next(s for s in data['preparation']['sections'] if s['id'] == 'descripciones')
        assert {'description_notes', 'bullets_notes', 'keywords_notes'} <= {f['id'] for f in section['fields']}
        assert all(len(f['value'].encode('utf-16-le')) // 2 <= 3000 for f in section['fields'])
        saved = client.patch('/api/products/LARGE/preparation', json={'revision': product['revision'], 'section': 'descripciones', 'answers': {'description_notes': 'Revisar el cierre.'}, 'reviewed': True, 'advance': True})
        assert saved.status_code == 200, saved.text
        result = saved.json()['product']
        assert result['description'] == description and result['bullets'] == bullets and result['keywords'] == keywords
        assert result['preparation']['sections']['descripciones']['answers']['description_notes'] == 'Revisar el cierre.'


def test_server_context_cannot_be_injected_through_model_and_database_rejects_unknown_action(environment):
    from app.conversation_forms import ConversationForms
    from test_conversation_forms import form_args
    assert ConversationForms(uuid4()).ask({**form_args(), 'context': {'kind': 'product_guide', 'sku': 'X', 'revision': 1, 'section': 'choice'}})['error'] == 'invalid_tool'
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        form = create_from_chat(client)['conversationForm']
        with pytest.raises(CheckViolation), db.connect() as c:
            c.execute('UPDATE uony_requests SET conversation_form=%s', (Jsonb({**form, 'context': {**form['context'], 'section': 'publish'}}),))
        assert client.delete('/api/uony/threads/guide-thread').status_code == 200
        with db.connect() as c:
            assert c.execute('SELECT form_response,conversation_form FROM uony_requests').fetchone() == {'form_response': None, 'conversation_form': None}
