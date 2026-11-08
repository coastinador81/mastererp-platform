"""ADK tool intent reaches the durable chat and product guide without Google I/O."""

from dataclasses import replace

import pytest

pytest.importorskip('google.adk.runners')

from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from conftest import client_for
from test_google_cloud import Cloud
from test_product_guide_idempotence import message, setup
from test_uony_adk_agent import FakeSdkClient, model_response, text, tool


def test_adk_guide_is_persisted_as_chat_form_for_same_product(
        environment, monkeypatch):
    config, google, database = environment
    qa_config = replace(config, adk_enabled=True)
    sdk = FakeSdkClient()
    sdk.responses = [
        model_response([tool('start_product_guide', {'sku': 'GUIDE-ONCE'})]),
        text('He preparado la guía.'),
    ]
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: sdk))
    cloud = Cloud()
    with client_for(qa_config, google, cloud=cloud,
                    uony=AdkAgentProvider(), legacy_sync=False) as client:
        user = setup(client, google, database, qa_config)
        confirmed = [
            {'id': 'weight', 'name': 'Peso del juego completo', 'value': '500 g'},
            {'id': 'rrp', 'name': 'PVPR', 'value': '19,90 EUR'},
            {'id': 'audience', 'name': 'Público objetivo',
             'value': 'Adultos y familias'},
            {'id': 'dangerous_goods', 'name': 'Mercancías peligrosas',
             'value': 'No aplicable'},
        ]
        saved = client.patch('/api/products/GUIDE-ONCE', json={
            'revision': 1,
            'customFields': [
                {**field, 'type': 'text', 'isConfirmed': True,
                 'source': 'Usuario · confirmado'}
                for field in confirmed
            ],
        })
        assert saved.status_code == 200, saved.text
        body = message(text='Continúa Basic Mini Bricks en el chat.')
        accepted = client.post('/api/uony/messages', json=body)
        assert accepted.status_code == 202, accepted.text
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('adk-guide-delivery')
        assert job and job['engine'] == 'adk'
        worker.run(job)

        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'success', result
        form = result['response']['conversationForm']
        assert form['context']['kind'] == 'product_guide'
        assert form['context']['sku'] == 'GUIDE-ONCE'
        assert form['context']['revision'] == 3
        assert form['fields'] and form['context']['section'] != 'choice'
        questions = ' '.join(field['label'] for field in form['fields']).casefold()
        assert not any(label in questions for label in
                       ('peso', 'pvpr', 'público', 'mercancías peligrosas'))
        assert result['response']['productChanges'][0]['product']['sku'] == 'GUIDE-ONCE'
        assert result['response']['reply'] != 'He preparado la guía.'

        thread = client.get('/api/uony/threads').json()['threads'][0]
        assert thread['messages'][-1]['conversationForm'] == form
        product = client.get('/api/products').json()['products'][0]
        assert product['sku'] == 'GUIDE-ONCE' and product['revision'] == 3
        assert {(field['id'], field['value']) for field in product['customFields']
                if field['id'] in {item['id'] for item in confirmed}} == {
                    (field['id'], field['value']) for field in confirmed}
        with database.connect() as connection:
            history = connection.execute(
                'SELECT revision FROM product_revisions WHERE user_id=%s '
                'AND product_id=%s ORDER BY revision',
                (user['id'], product['id'])).fetchall()
        assert [row['revision'] for row in history] == [1, 2, 3]
        assert cloud.calls == 1
        assert sdk.closed and len(sdk.calls) == 2
