"""Desconectar durante una respuesta conserva datos y ofrece conexión en el chat."""
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4
from fastapi import HTTPException
from test_product_reasoning_continuity import continuity_env, completed  # noqa: F401
from test_product_reasoning_jobs import reasoning_env  # noqa: F401
from test_product_requirements import requirement_env  # noqa: F401
from test_products import connect
from test_uony_provider import response as model_response


def request():
    return {'requestId': str(uuid4()), 'threadId': 'continuity-chat',
        'text': 'Continúa con los datos que faltan para Amazon.',
        'requirementsAction': {'action': 'prepare', 'sku': 'BASIC'}}


def disconnect(service):
    def unavailable(*args, **kwargs):
        raise HTTPException(409, detail={'error': 'reauthorize',
            'message': 'Renueva la conexión de Google Cloud para continuar.',
            'connectionActions': [{'provider': 'cloud', 'action': 'manage'}]})
    service.materials.credentials = unavailable


def assert_connection_reply(client, response):
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['connectionActions'] == [{'provider': 'cloud', 'action': 'manage'}]
    assert result['conversationForm']['context']['step'] == 'reasoning'
    assert 'connectionActions' not in result['conversationForm']['reasoning']
    assert result['conversationForm']['reasoning']['status'] == 'error'
    thread = next(t for t in client.get('/api/uony/threads').json()['threads'] if t['id'] == 'continuity-chat')
    assert thread['messages'][-1]['connectionActions'] == result['connectionActions']
    assert thread['messages'][-1]['conversationForm'] == result['conversationForm']
    return result


def test_prepare_disconnected_persists_valid_form_and_connection_card(continuity_env):
    client, _, service, provider, *_ = continuity_env
    completed(continuity_env)
    initial = client.post('/api/uony/messages', json=request())
    assert initial.status_code == 200, initial.text
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    calls = deepcopy(provider.calls)
    disconnect(service)
    body = request()
    result = assert_connection_reply(client, client.post('/api/uony/messages', json=body))
    assert client.post('/api/uony/messages', json=body).json() == result
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product'] == before
    assert provider.calls == calls


def test_disconnect_while_answering_does_not_rollback_the_customer_answer(continuity_env):
    client, _, service, provider, *_ = continuity_env
    completed(continuity_env)
    initial = client.post('/api/uony/messages', json=request()).json()
    form = initial['conversationForm']
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    calls = deepcopy(provider.calls)
    disconnect(service)
    answers = {field['id']: field['options'][-1] for field in form['fields']}
    body = {'requestId': str(uuid4()), 'threadId': 'continuity-chat',
        'text': 'Guardar mi respuesta y continuar.', 'formResponse': {'formId': form['id'], 'answers': answers}}
    result = assert_connection_reply(client, client.post('/api/uony/messages', json=body))
    after = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    assert after['revision'] == before['revision'] + 1
    assert after['amazonAttributes'] != before['amazonAttributes']
    assert all(after['amazonAttributes'][key] == value for key, value in before['amazonAttributes'].items())
    assert client.post('/api/uony/messages', json=body).json() == result
    assert provider.calls == calls


def test_model_started_guide_also_preserves_the_real_connection_action(continuity_env):
    client, db, service, provider, *_ = continuity_env
    completed(continuity_env)
    assert client.post('/api/uony/messages', json=request()).status_code == 200
    connect(db, service.settings)
    calls = deepcopy(provider.calls)
    disconnect(service)
    body = {'requestId': str(uuid4()), 'threadId': 'continuity-chat', 'text': 'Continúa la ficha de BASIC.'}
    with patch('app.google_cloud_provider.GoogleCloudProvider.refresh', return_value='fixture-only'), patch(
        'app.uony_provider.requests.post', side_effect=[
            model_response([{'functionCall': {'name': 'start_product_guide', 'args': {'sku': 'BASIC'}}}]),
            model_response([{'text': 'Continuemos con la ficha.'}])]):
        assert_connection_reply(client, client.post('/api/uony/messages', json=body))
    assert provider.calls == calls
