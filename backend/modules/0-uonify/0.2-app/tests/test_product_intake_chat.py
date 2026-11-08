"""Controlled model/tool loop; persisted chat and Basic intake, without external AI."""
from unittest.mock import Mock, patch
from uuid import uuid4
from requests import Timeout
import pytest
from conftest import client_for
from test_google_cloud import Cloud
from test_google_drive import connect as connect_drive
from test_products import connect as connect_cloud
from test_product_intake import MetadataDrive
from test_uony import ready
from test_uony_provider import response
from app.conversation_forms import PRODUCT_SOURCES_FIELD


def message(text, **extra):
    return {'requestId': str(uuid4()), 'threadId': 'basic-intake', 'text': text, **extra}


def tool(name, args):
    return response([{'functionCall': {'name': name, 'args': args}}])


def test_materials_before_identity_replays_hydrates_and_creates_only_after_confirmation(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, cloud=Cloud(), drive=drive) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(client, drive)
        body = message('Quiero preparar un producto para Amazon. Ya tengo sus archivos en Drive.')
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('show_product_intake', {}), response([{'text': 'Selecciona tus materiales.'}])
        ]) as provider:
            result = client.post('/api/uony/messages', json=body)
            assert result.status_code == 200, result.text
            data = result.json()
            assert data['productChanges'] == [] and data['conversationForm'] is None
            assert 'productIntake' in data and 'materialAnalysis' not in data
            assert client.post('/api/uony/messages', json=body).json() == data
            assert provider.call_count == 2
        assert client.get('/api/products').json()['products'] == []
        assert drive.metadata_calls == []
        history = client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert history[-1]['productIntake'] == data['productIntake']
        base = '/api/uony/product-intakes/' + data['productIntake']['id']
        identified = client.post(base + '/folder', json={
            'threadId': body['threadId'], 'requestId': str(uuid4()),
            'revision': data['productIntake']['revision'], 'folderId': 'basic-folder'})
        assert identified.status_code == 200, identified.text
        assert identified.json()['suggestedName'] == 'Basic Mini Bricks'
        assert client.get('/api/products').json()['products'] == []
        confirmation = {'threadId': body['threadId'], 'requestId': str(uuid4()),
                        'revision': identified.json()['revision'], 'name': 'Basic Mini Bricks'}
        saved = client.post(base + '/product', json=confirmation)
        assert saved.status_code == 200, saved.text
        assert client.post(base + '/product', json=confirmation).json() == saved.json()
        products = client.get('/api/products').json()['products']
        assert len(products) == 1 and products[0]['name'] == 'Basic Mini Bricks'
        assert products[0]['sku'] == saved.json()['product']['sku']
        assert client.get(base, params={'threadId': body['threadId']}).json()['status'] == 'linked'
        client.post('/api/products', json={'sku': 'OTHER', 'name': 'Otro producto'})
        class Continue:
            def generate(self, token, project, history, status, **kwargs):
                selected = status['productIntake']['product']
                assert selected['sku'] == products[0]['sku'] and selected['revision'] == 1
                assert selected['name'] == 'Basic Mini Bricks'
                assert status['productContext'] == {'sku': selected['sku'], 'revision': 1}
                assert status['productMemory']['product']['sku'] == selected['sku']
                saved_product = status.call('get_product', {'sku': selected['sku']})['product']
                assert saved_product == products[0]
                return 'La ficha seleccionada sigue guardada.', {'calls': 0}
        with patch('app.uony_provider.UonyProvider.generate', new=Continue().generate):
            continued = client.post('/api/uony/messages', json=message('Continúa con él.'))
        assert continued.status_code == 200, continued.text
        assert continued.json()['productChanges'] == [] and 'productIntake' not in continued.json()
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_calls').fetchone()['n'] == 0


def test_failed_model_does_not_leave_an_intake_or_product(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        failure = response([])
        failure.status_code = 429
        with patch('app.uony_provider.requests.post', side_effect=[tool('show_product_intake', {}), failure]):
            result = client.post('/api/uony/messages', json=message('Tengo documentos para mi ficha.'))
        assert result.status_code == 503
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_product_intakes').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0


def test_card_prepared_at_last_model_step_needs_no_extra_generation(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('get_connection_status', {}), tool('list_products', {}), tool('show_product_intake', {})
        ]) as provider:
            result = client.post('/api/uony/messages', json=message('Tengo los archivos para crear una ficha.'))
        assert result.status_code == 200, result.text
        assert result.json()['productIntake']['revision'] == 1
        assert result.json()['conversationForm'] is None
        assert provider.call_count == 3
        assert client.get('/api/products').json()['products'] == []


def test_no_files_asks_one_useful_question_after_empty_catalogue_without_creating_product(environment):
    config, google, db = environment
    prompt = ('Quiero preparar para Amazon un producto que ya tengo. Todavía no tengo archivos '
              'ni una ficha creada. Ayúdame a empezar.')
    question = '¿Qué producto es y para qué sirve?'
    body = message(prompt)
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('list_products', {}), response([{'text': question}]),
        ]) as provider:
            result = client.post('/api/uony/messages', json=body)
        assert result.status_code == 200, result.text
        data = result.json()
        assert provider.call_count == 2
        catalogue = provider.call_args_list[1].kwargs['json']['contents'][-1]['parts'][0]['functionResponse']
        assert catalogue == {'name': 'list_products', 'response': {'products': [], 'hasMore': False}}
        assert data['reply'] == question
        assert data['conversationForm'] is None
        assert data['productChanges'] == [] and 'productIntake' not in data
        assert data['connectionActions'] == [] and 'materialAnalysis' not in data
        assert client.post('/api/uony/messages', json=body).json() == data
        history = client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]
        assert history['conversationForm'] is None
        with db.connect() as connection:
            for table in ('products', 'uony_product_intakes', 'product_material_jobs'):
                assert connection.execute(f'SELECT count(*) n FROM {table}').fetchone()['n'] == 0


def test_natural_origin_question_is_data_not_drive_analysis_authorization(environment):
    config, google, db = environment
    first = message('Quiero preparar Basic Mini Bricks para Amazon; aún no sé por dónde empezar.')
    selection = message('Tengo una carpeta en Drive')
    question = PRODUCT_SOURCES_FIELD['label']
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('list_products', {}), response([{'text': question}]),
        ]) as provider:
            initial = client.post('/api/uony/messages', json=first)
            assert initial.status_code == 200, initial.text
            assert provider.call_count == 2
        assert initial.json()['conversationForm'] is None
        assert initial.json()['reply'] == question
        assert 'ask_user' not in {item['name'] for item in
            provider.call_args_list[0].kwargs['json']['tools'][0]['functionDeclarations']}
        assert client.post('/api/uony/messages', json=first).json() == initial.json()
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('show_product_intake', {}), response([{'text': 'Elige la carpeta para identificarla.'}]),
        ]) as provider:
            next_step = client.post('/api/uony/messages', json=selection)
            assert next_step.status_code == 200, next_step.text
            assert provider.call_count == 2
            contents = provider.call_args_list[0].kwargs['json']['contents']
            assert contents[-1]['parts'] == [{'text': selection['text']}]
        assert next_step.json()['productIntake']['revision'] == 1
        assert next_step.json()['conversationForm'] is None
        with db.connect() as connection:
            for table in ('products', 'product_material_jobs', 'product_material_calls'):
                assert connection.execute(f'SELECT count(*) n FROM {table}').fetchone()['n'] == 0
        history = client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert history[1]['conversationForm'] is None
        assert history[-1]['productIntake'] == next_step.json()['productIntake']


def test_natural_origin_question_can_be_answered_without_a_form(environment):
    config, google, db = environment
    first = message('Quiero crear un producto en Amazon.')
    answer = message('Partimos desde cero, no tengo fotos ni documentos.')
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        with patch('app.uony_provider.requests.post', return_value=response([
            {'text': PRODUCT_SOURCES_FIELD['label']}
        ])) as provider:
            asked = client.post('/api/uony/messages', json=first)
            assert asked.status_code == 200, asked.text
            assert provider.call_count == 1
        assert asked.json()['conversationForm'] is None
        with patch('app.uony_provider.requests.post', return_value=response([
            {'text': 'Empezamos desde cero. ¿Qué incluye el producto?'}
        ])) as provider:
            next_step = client.post('/api/uony/messages', json=answer)
            assert next_step.status_code == 200, next_step.text
            assert provider.call_count == 1
        assert next_step.json()['conversationForm'] is None
        assert '¿Qué incluye' in next_step.json()['reply']
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0


@pytest.mark.parametrize('unused_provider_failure', [Mock(status_code=429), Timeout('simulated')])
def test_no_files_delivers_natural_question_without_a_third_generation(environment, unused_provider_failure):
    config, google, db = environment
    prompt = ('Quiero preparar para Amazon un producto que ya tengo. Todavía no tengo archivos '
              'ni una ficha creada. Ayúdame a empezar.')
    question = '¿Qué producto es y para qué sirve?'
    body = message(prompt)
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('list_products', {}), response([{'text': question}]), unused_provider_failure,
        ]) as provider:
            result = client.post('/api/uony/messages', json=body)
            assert result.status_code == 200, result.text
            assert provider.call_count == 2
            assert client.post('/api/uony/messages', json=body).json() == result.json()
            assert provider.call_count == 2
        assert result.json()['conversationForm'] is None
        assert result.json()['reply'] == question
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['conversationForm'] is None
        with db.connect() as connection:
            usage = connection.execute('SELECT usage FROM uony_requests WHERE request_id=%s',
                                       (body['requestId'],)).fetchone()['usage']
            assert usage['attemptedCalls'] == 2 and usage['uncertainCalls'] == 0
            assert connection.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0


@pytest.mark.parametrize('provider_failure', [Mock(status_code=429), Timeout('simulated')])
def test_no_files_first_call_failure_does_not_invent_a_form_or_retry(environment, provider_failure):
    config, google, db = environment
    body = message('Quiero preparar para Amazon un producto que ya tengo. No tengo archivos. Ayúdame a empezar.')
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        assert client.get('/api/uony/services').json()['lastResponseAt'] is None
        with patch('app.uony_provider.requests.post', side_effect=[provider_failure]) as provider:
            result = client.post('/api/uony/messages', json=body)
            assert result.status_code == 503, result.text
            provider.assert_called_once()
        assert client.get('/api/uony/services').json()['lastResponseAt'] is None
        with db.connect() as connection:
            row = connection.execute('SELECT usage,conversation_form,status FROM uony_requests WHERE request_id=%s',
                                     (body['requestId'],)).fetchone()
            assert row['conversation_form'] is None and row['status'] == 'error'
            assert row['usage']['attemptedCalls'] == 1 and row['usage']['calls'] == 0
            assert row['usage']['uncertainCalls'] == 1
            assert connection.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0


@pytest.mark.parametrize('prompt,existing', [
    ('Tengo los archivos de un producto para Amazon.', False),
    ('Tengo la ficha técnica en Drive, pero no tengo archivos en este ordenador para el producto de Amazon.', False),
    ('Tengo documentos del producto para Amazon, pero no tengo archivos escaneados.', False),
    ('Quiero preparar un producto para Amazon. No tengo archivos en este ordenador.', False),
    ('Quiero preparar para Amazon un producto que ya tengo: Basic Mini Bricks. No tengo archivos.', False),
    ('Quiero preparar para Amazon un juego de equilibrio de madera con 54 piezas. No tengo archivos.', False),
    ('Quiero preparar para Amazon un producto. No tengo archivos.', True),
])
def test_first_call_failure_does_not_guess_sources_or_ignore_existing_products(environment, prompt, existing):
    from app.products import save
    config, google, db = environment
    body = message(prompt)
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        if existing:
            with db.connect() as connection:
                user = connection.execute('SELECT * FROM users').fetchone()
                save(connection, user, {'sku': 'BASIC', 'name': 'Basic Mini Bricks'})
        failure = Mock(status_code=429)
        with patch('app.uony_provider.requests.post', return_value=failure) as provider:
            result = client.post('/api/uony/messages', json=body)
            assert result.status_code == 503, result.text
            provider.assert_called_once()
        with db.connect() as connection:
            row = connection.execute('SELECT conversation_form,status FROM uony_requests WHERE request_id=%s',
                                     (body['requestId'],)).fetchone()
            assert row['conversation_form'] is None and row['status'] == 'error'
            assert connection.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == int(existing)


def test_creation_does_not_force_a_module_choice_and_explicit_guide_stays_in_chat(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('create_product', {'sku': 'NO-FILES', 'name': 'Juego artesanal'}),
            response([{'text': 'El borrador está guardado.'}])
        ]):
            created = client.post('/api/uony/messages', json=message('No tengo archivos. Guarda mi juego artesanal.'))
        assert created.status_code == 200, created.text
        assert created.json()['conversationForm'] is None
        assert created.json()['productProposal']['targetSku'] == 'NO-FILES'
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('create_product', {'sku': 'CHAT-GUIDE', 'name': 'Otro juego'}),
            tool('start_product_guide', {'sku': 'CHAT-GUIDE'}),
            response([{'text': 'Continuamos aquí.'}])
        ]):
            guided = client.post('/api/uony/messages', json=message('Guarda este otro juego y seguimos su ficha aquí.'))
        assert guided.status_code == 200, guided.text
        result = guided.json()
        proposal = result['productProposal']
        assert result['conversationForm'] is None and result['productChanges'] == []
        assert client.get('/api/products').json()['products'] == []
        approved = client.post('/api/uony/product-proposals/' + proposal['proposalId'] + '/decision', json={
            'threadId': proposal['threadId'], 'requestId': str(uuid4()),
            'proposalHash': proposal['proposalHash'], 'baseRevision': None,
            'action': 'approve'})
        assert approved.status_code == 200, approved.text
        with patch('app.uony_provider.requests.post', side_effect=[
            tool('start_product_guide', {'sku': 'CHAT-GUIDE'}),
            response([{'text': 'Seguimos con la guía.'}])
        ]):
            continued = client.post('/api/uony/messages', json=message('Continúa la guía de este juego.'))
        assert continued.status_code == 200, continued.text
        assert continued.json()['conversationForm']['context']['section'] != 'choice'
        assert client.get('/api/products/CHAT-GUIDE/preparation').json()['preparation']['mode'] == 'guided'


def test_search_is_bounded_literal_owner_scoped_and_does_not_pick_ambiguous_products(environment):
    from app.product_tools import ProductTools
    from app.products import save
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            for i in range(102):
                save(c, user, {'sku': f'BASIC-{i}', 'name': 'Basic Mini Bricks' + (' %_' if i == 0 else '')})
        tools = ProductTools({}, db, user, None)
        page = tools.call('list_products', {})
        assert len(page['products']) == 100 and page['hasMore'] is True
        exact = tools.call('list_products', {'query': '%_'})
        assert len(exact['products']) == 1 and exact['hasMore'] is False
        assert exact['products'][0]['sku'] == 'BASIC-0'
        assert tools.call('list_products', {'query': 'basic-101'})['products'][0]['sku'] == 'BASIC-101'
        assert tools.call('list_products', {'query': 'not found'}) == {'products': [], 'hasMore': False}
        assert tools.call('list_products', {'query': 'x' * 161})['error'] == 'invalid_tool'
        assert tools.call('list_products', {'user_id': str(user['id'])})['error'] == 'invalid_tool'
        google.subject, google.email = 'other-basic', 'other@example.test'
        ready(client, google, db)
        with db.connect() as c:
            other = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
        assert ProductTools({}, db, other, None).call('list_products', {'query': 'Basic'}) == {
            'products': [], 'hasMore': False}
        assert tools.pending is None


def test_intake_has_one_interactive_destination_but_allows_connection_controls(environment):
    from app.blender_tools import BusinessTools
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
        context = BusinessTools({}, db, user, None, uuid4(), thread_id='basic-intake')
        assert context.call('show_product_intake', {})['prepared']
        for name in ('ask_user', 'start_incident_resolution', 'list_product_incidents', 'create_product', 'update_product'):
            assert context.call(name, {})['error'] == 'intake_pending'
        assert context.conversation_forms.present() is None
        assert context.incidents.result is None and context.pending is None
        assert context.call('show_connection', {'provider': 'drive'})['prepared']
