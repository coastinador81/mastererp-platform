"""Regresión: una respuesta que pide completar un formulario debe entregarlo realmente."""
from unittest.mock import patch
from uuid import uuid4

import pytest
from app.conversation_forms import ConversationForms, DECLARATIONS, PRODUCT_SOURCES_FIELD
from app.google_cloud_provider import CloudError
from app.uony_provider import UonyProvider
from app.uony_form_guard import requests_missing_form, FORM_READY_REPLY
from conftest import client_for
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_provider import response
from test_conversation_forms import form_args, body, tool_response

CLAIM = 'Para empezar a preparar el borrador de tu producto para Amazon, dime qué producto es y cómo quieres proceder.\n\nPor favor, completa este breve formulario.'
STARTER = 'Quiero crear la ficha de un producto para Amazon. Muéstrame un formulario para empezar.'


class Context(dict):
    declarations = DECLARATIONS + [{'name': 'create_product', 'parameters': {'type': 'OBJECT', 'properties': {}}}]

    def __init__(self):
        super().__init__()
        self.conversation_forms = ConversationForms(uuid4())
        self.invocations = []

    def call(self, name, args):
        self.invocations.append((name, args))
        if name == 'ask_user':
            return self.conversation_forms.ask(args)
        return {'prepared': True}


def generate(context, replies):
    with patch('app.uony_provider.requests.post', side_effect=replies) as post:
        result = UonyProvider().generate('test-only', 'fixture-project', [{'role': 'user', 'parts': [{'text': STARTER}]}], context)
    return result, post


@pytest.mark.parametrize('text', [
    CLAIM, 'Por favor, completa este breve formulario.', 'Aquí tienes el formulario para continuar.', 'Te muestro aquí el formulario.',
    'Completa este formulario sin perder tu conversación.',
    'No te preocupes, aquí tienes el formulario.',
    'Si no tienes materiales, completa este formulario.',
    'Sin materiales previos, completa este formulario.',
    'No has conectado Amazon todavía, completa este formulario.',
    'El formulario está listo para que lo completes.',
    'Por favor, completa estos datos adicionales para avanzar en la ficha.',
    'Aquí tienes el formulario para preparar tu producto de Amazon.',
    'Aquí tienes el formulario de autorización en Google.',
])
def test_detects_missing_control_promises_and_direct_questions(text):
    assert requests_missing_form(text)


@pytest.mark.parametrize('text', [
    'Los formularios sirven para recopilar atributos.',
    'No necesitas completar ningún formulario.', 'No te muestro ningún formulario.',
    'Nunca te pido rellenar un formulario con contraseñas.',
    'Un buen título responde a «¿qué es el producto?».',
    'Ejemplo: «Por favor, completa este breve formulario».',
    'La ficha está guardada.', 'Puedes revisar el resultado cuando quieras.',
    'Un formulario puede contener campos de texto y opciones.',
    'Puedes rellenar el formulario de autorización en Google.',
    'En Google, completa su formulario oficial y vuelve al chat.',
    'El formulario no está listo.',
    '¿Qué producto quieres preparar?', '¿Tienes fotos o quieres empezar desde cero?',
    'Antes de empezar, dime qué producto es y si tienes fotos o prefieres empezar desde cero.',
])
def test_descriptions_and_natural_questions_do_not_claim_a_missing_control(text):
    assert not requests_missing_form(text)


def test_observed_terminal_claim_is_repaired_by_real_validated_tool_only():
    context = Context()
    (reply, usage), post = generate(context, [response([{'text': CLAIM}]), tool_response()])
    assert reply == FORM_READY_REPLY
    assert context.conversation_forms.present()['fields'] == form_args()['fields']
    assert usage == {'calls': 2, 'attemptedCalls': 2, 'uncertainCalls': 0, 'formRepairCalls': 1, 'totalTokenCount': 20}
    repair = post.call_args_list[1].kwargs['json']
    assert repair['toolConfig'] == {'functionCallingConfig': {'mode': 'ANY', 'allowedFunctionNames': ['ask_user']}}
    assert [d['name'] for d in repair['tools'][0]['functionDeclarations']] == ['ask_user']
    assert context.invocations == [('ask_user', form_args())]
    assert 'toolConfig' not in post.call_args_list[0].kwargs['json']


def test_one_natural_question_is_delivered_without_form_repair_or_mutation():
    context = Context()
    question = '¿Tienes fotos o documentos del producto, o partimos desde cero?'
    (reply, usage), post = generate(context, [response([{'text': question}])])
    assert reply == question and usage['calls'] == 1
    assert usage['formRepairCalls'] == 0 and post.call_count == 1
    assert context.invocations == [] and context.conversation_forms.present() is None


def test_validated_origin_choice_is_inline_with_no_extra_provider_call():
    context = Context()
    args = {'title': 'De dónde partimos', 'fields': [PRODUCT_SOURCES_FIELD]}
    (reply, usage), post = generate(context, [tool_response(args)])
    assert reply == PRODUCT_SOURCES_FIELD['label']
    assert context.conversation_forms.present()['presentation'] == 'inline_choice'
    assert usage['calls'] == 1 and usage['formRepairCalls'] == 0
    assert context.invocations == [('ask_user', args)] and post.call_count == 1


def test_rejected_form_is_corrected_before_terminal_response_can_be_accepted():
    context = Context()
    invalid = {**form_args(), 'fields': []}
    (reply, usage), _ = generate(context, [tool_response(invalid), tool_response()])
    assert reply == FORM_READY_REPLY and context.conversation_forms.present()
    assert usage['calls'] == 2 and usage['formRepairCalls'] == 1


def test_valid_form_uses_server_reply_without_an_extra_generation_or_repair():
    context = Context()
    (reply, usage), post = generate(context, [tool_response()])
    assert reply == FORM_READY_REPLY
    assert usage['calls'] == 1 and usage['formRepairCalls'] == 0
    assert all('toolConfig' not in call.kwargs['json'] for call in post.call_args_list)


@pytest.mark.parametrize('replies', [
    [response([{'text': CLAIM}])] * 3,
    [tool_response({**form_args(), 'fields': []})] * 3,
    [response([{'text': CLAIM}]), tool_response({**form_args(), 'fields': []}), response([{'text': CLAIM}])],
])
def test_exhausted_repair_never_delivers_a_phantom_form(replies):
    context = Context()
    with patch('app.uony_provider.requests.post', side_effect=replies) as post:
        with pytest.raises(CloudError) as raised:
            UonyProvider().generate('test-only', 'fixture', [], context)
    assert raised.value.code == 'form_unavailable' and post.call_count == 3
    assert raised.value.usage['formRepairCalls'] == 2
    assert context.conversation_forms.present() is None


def test_third_allowed_call_can_deliver_valid_form_without_fourth_call():
    (reply, usage), post = generate(Context(), [response([{'text': CLAIM}]), tool_response({**form_args(), 'fields': []}), tool_response()])
    assert reply == FORM_READY_REPLY and post.call_count == 3
    assert usage['formRepairCalls'] == 2


def test_repair_rejects_unexpected_mutation_before_execution():
    context = Context()
    create = response([{'functionCall': {'name': 'create_product', 'args': {}}}])
    with patch('app.uony_provider.requests.post', side_effect=[create, response([{'text': CLAIM}]), create]):
        with pytest.raises(CloudError) as raised:
            UonyProvider().generate('test-only', 'fixture', [], context)
    assert raised.value.code == 'form_unavailable'
    assert context.invocations == [('create_product', {})]


def test_repair_keeps_provider_permission_errors():
    from unittest.mock import Mock
    with patch('app.uony_provider.requests.post', side_effect=[response([{'text': CLAIM}]), Mock(status_code=401)]) as post:
        with pytest.raises(CloudError) as raised:
            UonyProvider().generate('test-only', 'fixture', [], Context())
    assert raised.value.code == 'reauthorize' and post.call_count == 2
    assert raised.value.usage['formRepairCalls'] == 1


def test_repaired_response_persists_replays_and_restores_from_same_thread(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        request = {**body(), 'text': STARTER}
        with patch('app.uony_provider.requests.post', side_effect=[response([{'text': CLAIM}]), tool_response()]) as post:
            result = client.post('/api/uony/messages', json=request)
            assert result.status_code == 200, result.text
            assert result.json()['conversationForm']['id'] == request['requestId']
            assert result.json()['conversationForm']['fields'] == form_args()['fields']
            assert client.post('/api/uony/messages', json=request).json() == result.json()
            assert post.call_count == 2
        history = client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]
        assert history['conversationForm'] == result.json()['conversationForm']
        with db.connect() as c:
            usage = c.execute('SELECT usage FROM uony_requests').fetchone()['usage']
            assert usage['formRepairCalls'] == 1
            assert c.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0


def test_failed_repair_keeps_failure_idempotency_and_never_commits_prepared_product(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        request = body()
        client.post('/api/products', json={'name': 'Original', 'sku': 'REPAIR-TEST'})
        mutation = response([{'functionCall': {'name': 'get_product', 'args': {'sku': 'REPAIR-TEST'}}}, {'functionCall': {'name': 'update_product', 'args': {'sku': 'REPAIR-TEST', 'revision': 1, 'changes': {'name': 'Cambio preparado'}}}}])
        with patch('app.uony_provider.requests.post', side_effect=[mutation, response([{'text': CLAIM}]), tool_response({**form_args(), 'fields': []})]) as post:
            result = client.post('/api/uony/messages', json=request)
            assert result.status_code == 503 and result.json()['error'] == 'form_unavailable'
            assert client.post('/api/uony/messages', json=request).status_code == 409
            assert post.call_count == 3
        history=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert len(history)==2 and history[1]['requestStatus']=='error'
        assert history[1]['model']=='uonify-guide'
        with db.connect() as c:
            row = c.execute('SELECT conversation_form,reply,status,usage,error_code FROM uony_requests').fetchone()
            assert row['status'] == 'error' and row['error_code'] == 'form_unavailable'
            assert row['conversation_form'] is None and row['reply'] is None
            assert row['usage']['formRepairCalls'] == 1
            assert c.execute('SELECT data FROM products').fetchone()['data']['name'] == 'Original'


@pytest.mark.parametrize('args', [
    {**form_args(), 'title': '   '},
    {**form_args(), 'title': '😀' * 61},
    {**form_args(), 'fields': [{**form_args()['fields'][0], 'label': '   '}]},
    {**form_args(), 'fields': [{**form_args()['fields'][0], 'label': '😀' * 51}]},
    {**form_args(), 'fields': [{**form_args()['fields'][0], 'value': '😀' * 1501}]},
    {**form_args(), 'fields': [{**form_args()['fields'][1], 'options': ['😀' * 81]}]},
])
def test_form_validation_matches_visible_browser_string_limits(args):
    forms = ConversationForms(uuid4())
    assert forms.ask(args)['error'] == 'invalid_tool'
    assert forms.present() is None
