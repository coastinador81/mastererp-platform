"""La conversación espera la deducción y renueva preguntas sin aceptar borradores antiguos."""
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.product_reasoning import unknown_consumption_message
from test_product_requirements_guide import guided, send


def body(**action):
    return {'requestId': str(uuid4()), 'threadId': 'guide-thread',
            'text': 'Revisa lo que puedes deducir antes de preguntarme.',
            'requirementsAction': {'action': 'prepare', 'sku': 'GUIA-01', **action}}


def configure(client, result):
    result = send(client, result['conversationForm'], {'source': 'Usar un producto parecido de Amazon'})
    return send(client, result['conversationForm'], {'asin': 'B07NPPMZM8'})


def test_chat_waits_then_refreshes_questions_without_calling_chat_model(guided):
    client, db, service, initial = guided
    configure(client, initial)
    current = client.get('/api/products/GUIA-01/amazon-requirements').json()
    queued = deepcopy(current)
    queued['evaluation'].update(state='reasoning', fields=[], reasoning={
        'id': str(uuid4()), 'status': 'queued',
        'message': 'Estoy revisando tus documentos e imágenes antes de preguntarte.'})
    request = body()
    with patch.object(service, 'prepare_for', return_value=queued) as prepare, patch('app.uony_provider.requests.post') as ai:
        started = client.post('/api/uony/messages', json=request)
        assert started.status_code == 200, started.text
        result = started.json()
        assert result['conversationForm']['context']['step'] == 'reasoning'
        assert result['conversationForm']['fields'] == []
        assert result['conversationForm']['reasoning']['status'] == 'queued'
        assert result['reply'] == queued['evaluation']['reasoning']['message']
        assert client.post('/api/uony/messages', json=request).json() == result
        assert prepare.call_count == 1
        ai.assert_not_called()
    completed = deepcopy(current)
    completed['evaluation']['reasoning'] = {'id': queued['evaluation']['reasoning']['id'], 'status': 'completed', 'message': 'Revisión terminada.'}
    with patch.object(service, 'prepare_for', return_value=completed), patch('app.uony_provider.requests.post') as ai:
        resumed = client.post('/api/uony/messages', json=body())
        assert resumed.status_code == 200, resumed.text
        form = resumed.json()['conversationForm']
        assert form['context']['step'] == 'fields'
        assert form['fields'] == current['evaluation']['fields']
        ai.assert_not_called()
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM uony_requests WHERE requirements_action IS NOT NULL').fetchone()['n'] == 2


def test_retry_and_unknown_usage_need_the_explicit_action_and_are_idempotent(guided):
    client, _, service, initial = guided
    configure(client, initial)
    current = client.get('/api/products/GUIA-01/amazon-requirements').json()
    current['evaluation'].update(state='reasoning', fields=[], reasoning={
        'id': str(uuid4()), 'status': 'unknown', 'message': 'No se pudo confirmar el consumo de este intento.'})
    request = body(retry=True, acknowledgeUnknown=True)
    with patch.object(service, 'prepare_for', return_value=current) as prepare:
        response = client.post('/api/uony/messages', json=request)
        assert response.status_code == 200, response.text
        assert response.json()['conversationForm']['reasoning']['status'] == 'unknown'
        assert prepare.call_args.kwargs == {'retry': True, 'acknowledge_unknown': True}
        changed = deepcopy(request)
        changed['requirementsAction']['retry'] = False
        assert client.post('/api/uony/messages', json=changed).status_code == 409
        assert prepare.call_count == 1


@pytest.mark.parametrize('calls,unknown', [(0, 0), (2, 0), (1, 1)])
def test_chat_preserves_previous_or_current_unknown_copy_and_explicit_consent(guided, calls, unknown):
    client, _, service, initial = guided
    configure(client, initial)
    current = client.get('/api/products/GUIA-01/amazon-requirements').json()
    usage = {'calls': calls, 'tokens': 100 if calls else 0, 'reserved': 100 if unknown else 0, 'unknown': unknown}
    message = unknown_consumption_message(usage)
    current['evaluation'].update(state='reasoning', fields=[], message=message, reasoning={
        'id': str(uuid4()), 'status': 'unknown', 'message': message, 'usage': usage,
        'canRetry': True, 'requiresConsumptionAcknowledgement': True})
    request = body()
    with patch.object(service, 'prepare_for', return_value=current) as prepare, patch('app.uony_provider.requests.post') as ai:
        response = client.post('/api/uony/messages', json=request)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['reply'] == result['conversationForm']['notice'] == message
        assert result['conversationForm']['reasoning'] == current['evaluation']['reasoning']
        assert result['conversationForm']['fields'] == []
        assert client.post('/api/uony/messages', json=request).json() == result
        assert prepare.call_count == 1 and prepare.call_args.kwargs == {'retry': False, 'acknowledge_unknown': False}
        stored = client.get('/api/uony/threads').json()['threads']
        entry = next(t for t in stored if t['id'] == 'guide-thread')['messages'][-1]
        assert entry['conversationForm']['reasoning'] == result['conversationForm']['reasoning']
        ai.assert_not_called()


def test_refresh_does_not_accept_answers_or_unknown_products(guided):
    client, _, _, initial = guided
    result = configure(client, initial)
    mixed = body()
    mixed['formResponse'] = {'formId': result['conversationForm']['id'], 'answers': {}}
    assert client.post('/api/uony/messages', json=mixed).status_code == 422
    foreign = body()
    foreign['requirementsAction']['sku'] = 'NO-ES-MIO'
    assert client.post('/api/uony/messages', json=foreign).status_code == 404


def test_finished_preparation_identifies_its_product_without_saving_again(guided):
    client, _, service, initial = guided
    configure(client, initial)
    current = client.get('/api/products/GUIA-01/amazon-requirements').json()
    completed = deepcopy(current)
    completed['evaluation'].update(state='locally_valid', fields=[])
    with patch.object(service, 'prepare_for', return_value=completed), patch('app.uony_provider.requests.post') as ai:
        request = body()
        response = client.post('/api/uony/messages', json=request)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['conversationForm'] is None
        assert result['productChanges'] == [{'product': current['product'], 'previousSku': 'GUIA-01'}]
        assert client.post('/api/uony/messages', json=request).json() == result
        history = client.get('/api/uony/threads').json()['threads']
        entry = next(t for t in history if t['id'] == 'guide-thread')['messages'][-1]
        assert entry['productChanges'] == result['productChanges']
        ai.assert_not_called()
    assert client.get('/api/products/GUIA-01/amazon-requirements').json()['product'] == current['product']


def test_database_accepts_only_valid_server_waiting_cards(guided):
    _, db, _, _ = guided
    form = {'id': str(uuid4()), 'title': 'Revisar documentos e imágenes', 'fields': [],
            'context': {'kind': 'product_guide', 'section': 'amazon_requirements',
                        'step': 'reasoning', 'sku': 'GUIA-01', 'revision': 1},
            'reasoning': {'id': None, 'status': 'stale', 'message': 'Revisa los materiales.',
                          'canRetry': True, 'requiresPreparation': True,
                          'usage': {'calls': 0, 'tokens': 0, 'reserved': 0, 'unknown': 0}}}
    invalid = []
    for key, value in [('status', 'invented'), ('canRetry', 'yes'), ('id', 'not-a-uuid'),
                       ('usage', {'tokens': -1}), ('execute', 'unsafe')]:
        bad = deepcopy(form); bad['reasoning'][key] = value; invalid.append(bad)
    bad = deepcopy(form); bad['context']['sku'] = '../other'; invalid.append(bad)
    bad = deepcopy(form); bad['fields'] = [{'id': 'answer'}]; invalid.append(bad)
    with db.connect() as c:
        valid = lambda value: c.execute('SELECT uony_conversation_form_valid(%s) AS ok', (Jsonb(value),)).fetchone()['ok']
        assert valid(form) is True
        assert all(valid(value) is False for value in invalid)
