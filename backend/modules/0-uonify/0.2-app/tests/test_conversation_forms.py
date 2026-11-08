"""Contratos conversacionales: campos seguros, persistencia, aislamiento y reentrada."""
from copy import deepcopy
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from psycopg.errors import CheckViolation
from psycopg.types.json import Jsonb
from app.conversation_forms import ConversationForms, PRODUCT_SOURCES_FIELD
from app.connection_tools import ConnectionActions
from conftest import client_for, login
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_provider import response


def form_args():
    return {'title': 'Prepara tu producto', 'fields': [
        {'id': 'product', 'label': '¿Qué producto quieres preparar?', 'type': 'text', 'required': True},
        {'id': 'materials', 'label': 'Materiales disponibles', 'type': 'select', 'required': True,
         'options': ['Tengo materiales', 'Empezar desde cero']},
        {'id': 'details', 'label': 'Detalles del producto', 'type': 'textarea', 'required': False},
    ]}


def body():
    return {'requestId': str(uuid4()), 'threadId': 'form-chat',
            'text': 'Muéstrame un formulario para preparar mi producto para Amazon.'}


def tool_response(args=None):
    return response([{'functionCall': {'name': 'ask_user', 'args': form_args() if args is None else args}}])


def test_form_has_server_id_repeats_without_mutation_and_only_one_per_request():
    identifier = uuid4()
    forms = ConversationForms(identifier)
    assert forms.present() is None
    first = forms.ask(form_args())
    assert first['prepared'] and first['formId'] == str(identifier)
    assert forms.ask(form_args()) == first
    assert forms.ask({**form_args(), 'title': 'Otra pregunta'})['error'] == 'one_form'
    copy = forms.present()
    copy['fields'][0]['label'] = 'Modificado fuera'
    assert forms.present() == {'id': str(identifier), **form_args()}


def test_only_information_choice_receives_server_inline_marker():
    form = {'title': 'De dónde partimos', 'fields': [PRODUCT_SOURCES_FIELD]}
    forms = ConversationForms(uuid4())
    assert forms.ask(form)['prepared']
    saved = forms.present()
    assert saved['presentation'] == 'inline_choice'
    assert saved['fields'] == [PRODUCT_SOURCES_FIELD]
    assert ConversationForms(uuid4()).ask({**form, 'presentation': 'inline_choice'})['error'] == 'invalid_tool'
    authorization = {'title': 'Permiso', 'fields': [{**PRODUCT_SOURCES_FIELD,
        'id': 'authorize', 'label': '¿Autorizas el análisis?',
        'options': ['Sí, autorizo', 'Ahora no']}]}
    other = ConversationForms(uuid4())
    assert other.ask(authorization)['prepared']
    assert 'presentation' not in other.present()


def test_database_accepts_only_the_exact_server_inline_choice(environment):
    config, provider, db = environment
    form = ConversationForms(uuid4())
    assert form.ask({'title': 'De dónde partimos', 'fields': [PRODUCT_SOURCES_FIELD]})['prepared']
    with client_for(config, provider):
        with db.connect() as connection:
            assert connection.execute('SELECT uony_conversation_form_valid(%s) AS ok',
                (Jsonb(form.present()),)).fetchone()['ok'] is True
            historical = {'id': str(uuid4()), **form_args()}
            assert connection.execute('SELECT uony_conversation_form_valid(%s) AS ok',
                (Jsonb(historical),)).fetchone()['ok'] is True
            for malformed in (
                {**form.present(), 'presentation': 'authorize'},
                {**form.present(), 'fields': [{**PRODUCT_SOURCES_FIELD, 'options': ['Sí, autorizo', 'Ahora no']}]},
                {**form.present(), 'context': {'kind': 'product_guide'}},
            ):
                assert connection.execute('SELECT uony_conversation_form_valid(%s) AS ok',
                    (Jsonb(malformed),)).fetchone()['ok'] is False


@pytest.mark.parametrize('args', [
    None, [], {}, {**form_args(), 'id': 'client-controlled'},
    {**form_args(), 'title': 'x' * 121}, {**form_args(), 'fields': []},
    {**form_args(), 'fields': form_args()['fields'] * 3},
    {**form_args(), 'title': '<script>bad()</script>'},
    {**form_args(), 'title': 'Visita https://example.test'},
    {**form_args(), 'title': 'Contraseña de Google'},
    {**form_args(), 'fields': [{'id': 'password', 'label': 'Dato', 'type': 'text', 'required': True}]},
    {**form_args(), 'fields': [{'id': 'constructor', 'label': 'Dato', 'type': 'text', 'required': True}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Número de tarjeta', 'type': 'text', 'required': True}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Dato', 'type': 'url', 'required': True}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Dato', 'type': 'text', 'required': 'true'}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Dato', 'type': 'text', 'required': True, 'url': 'https://example.test'}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Dato', 'type': 'select', 'required': True, 'options': ['Uno', 'Uno']}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Dato', 'type': 'select', 'required': True, 'options': ['Uno'], 'value': 'Otro'}]},
    {**form_args(), 'fields': [{'id': 'x', 'label': 'Dato', 'type': 'text', 'required': True, 'options': ['Uno']}]},
    {**form_args(), 'fields': [form_args()['fields'][0], form_args()['fields'][0]]},
])
def test_invalid_model_forms_are_not_exposed_or_executed(args):
    forms = ConversationForms(uuid4())
    assert forms.ask(args)['error'] == 'invalid_tool'
    assert forms.present() is None


def test_form_persists_and_replays_and_recovers_without_provider_calls(environment):
    config, google, db = environment
    request = body()
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[tool_response()]) as post:
            result = client.post('/api/uony/messages', json=request)
            assert result.status_code == 200, result.text
            expected = {'id': request['requestId'], **form_args()}
            assert result.json()['conversationForm'] == expected
            assert client.post('/api/uony/messages', json=request).json() == result.json()
            assert post.call_count == 1
            assert client.post('/api/uony/messages', json={**request, 'text': 'Cambio'}).status_code == 409
        with db.connect() as c:
            assert c.execute('SELECT conversation_form FROM uony_requests').fetchone()['conversation_form'] == expected
            assert c.execute('SELECT count(*) AS count FROM products').fetchone()['count'] == 0
    with client_for(config, google, cloud=Cloud()) as client:
        login(client, google)
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['conversationForm'] == expected
        google.subject = 'other-form-account'
        google.email = 'other-form@example.test'
        login(client, google)
        assert client.get('/api/uony/threads').json() == {'threads': []}
        assert client.delete('/api/uony/threads/form-chat').status_code == 404
        google.subject = 'google-test-one'
        google.email = 'one@example.test'
        login(client, google)
        assert client.delete('/api/uony/threads/form-chat').status_code == 200
        with db.connect() as c:
            assert c.execute('SELECT conversation_form FROM uony_requests').fetchone()['conversation_form'] is None


def test_failed_model_does_not_persist_form_or_expose_it_on_retry(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        request = body()
        invalid = {**form_args(), 'fields': []}
        with patch('app.uony_provider.requests.post', side_effect=[tool_response(invalid), Mock(status_code=429)]):
            assert client.post('/api/uony/messages', json=request).status_code == 503
            assert client.post('/api/uony/messages', json=request).status_code == 409
        with db.connect() as c:
            assert c.execute('SELECT conversation_form FROM uony_requests').fetchone()['conversation_form'] is None
        messages=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert len(messages)==2 and messages[1]['requestStatus']=='unknown'
        assert messages[1].get('conversationForm') is None


def test_connection_options_allow_only_known_providers_and_use_current_status():
    tools = ConnectionActions({'googleCloud': 'reauthorize', 'drive': 'connected', 'blenderLocal': {'status': 'offline'}})
    assert tools.show({'provider': 'cloud'})['observedConnectionStatus'] == 'reauthorize'
    assert tools.show({'provider': 'drive'})['primaryAction'] == 'Gestionar conexión'
    assert tools.show({'provider': 'blender'})['observedConnectionStatus'] == 'offline'
    tools.show({'provider': 'drive'})
    assert len(tools.present()) == 3
    for args in ({'provider': 'slack'}, {'provider': 'drive', 'userId': 'other'}, {'provider': []}, None):
        assert tools.show(args)['error'] == 'invalid_tool'
    assert len(tools.present()) == 3


def test_multi_connection_controls_and_form_persist_together(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        calls = [{'functionCall': {'name': 'show_connection', 'args': {'provider': provider}}} for provider in ('cloud', 'drive', 'blender')]
        with patch('app.uony_provider.requests.post', side_effect=[response(calls), tool_response()]):
            result = client.post('/api/uony/messages', json=body())
        assert result.status_code == 200, result.text
        expected = [{'provider': provider, 'action': 'manage'} for provider in ('cloud', 'drive', 'blender')]
        assert result.json()['connectionActions'] == expected
        assert result.json()['conversationForm']
        history = client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]
        assert history['connectionActions'] == expected and history['conversationForm']


@pytest.mark.parametrize('mutation', [
    lambda data: {**data, 'id': str(uuid4())},
    lambda data: {**data, 'url': 'https://example.test'},
    lambda data: {**data, 'fields': [data['fields'][0], data['fields'][0]]},
    lambda data: {**data, 'fields': [{**data['fields'][0], 'type': None}]},
])
def test_database_rejects_form_with_wrong_identity_or_invalid_shape(environment, mutation):
    config, google, db = environment
    request = body()
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        with patch('app.uony_provider.requests.post', return_value=response([{'text': 'Hola.'}])):
            assert client.post('/api/uony/messages', json=request).status_code == 200
        data = {'id': request['requestId'], **form_args()}
        with pytest.raises(CheckViolation), db.connect() as c:
            c.execute('UPDATE uony_requests SET conversation_form=%s', (Jsonb(mutation(deepcopy(data))),))


def test_missing_google_and_expired_authorization_offer_chat_controls_without_model(environment):
    from app.google_cloud_provider import CloudError
    config, google, db = environment
    cloud = Cloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        with patch('app.uony_provider.requests.post') as post:
            result = client.post('/api/uony/messages', json=body())
            assert result.status_code == 409
            assert result.json()['error'] == 'google_required'
            assert result.json()['connectionActions'] == [{'provider': 'cloud', 'action': 'manage'}]
            post.assert_not_called()
        connect(db, config)
        with patch.object(cloud, 'refresh', side_effect=CloudError('reauthorize')), patch('app.uony_provider.requests.post') as post:
            result = client.post('/api/uony/messages', json=body())
            assert result.status_code == 503
            assert result.json()['connectionActions'] == [{'provider': 'cloud', 'action': 'manage'}]
            post.assert_not_called()
