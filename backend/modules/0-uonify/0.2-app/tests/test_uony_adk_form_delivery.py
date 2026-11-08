"""A valid ADK question reaches the existing durable chat in one model call."""

from dataclasses import replace

import pytest

pytest.importorskip('google.adk.runners')

from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from app.uony_form_guard import FORM_READY_REPLY
from conftest import client_for
from test_conversation_forms import body, form_args
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_adk_agent import FakeSdkClient, model_response, tool


def test_adk_question_is_persisted_and_replayed_without_second_post(environment, monkeypatch):
    config, google, database = environment
    qa_config = replace(config, adk_enabled=True)
    sdk = FakeSdkClient()
    sdk.responses = [model_response([tool('ask_user', form_args())], tokens=17),
                     TimeoutError('a second provider POST must not happen')]
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: sdk))
    cloud = Cloud()
    request = body()

    with client_for(qa_config, google, cloud=cloud,
                    uony=AdkAgentProvider(), legacy_sync=False) as client:
        ready(client, google, database)
        connect(database, qa_config)
        accepted = client.post('/api/uony/messages', json=request)
        assert accepted.status_code == 202, accepted.text
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('adk-form-delivery')
        assert job and job['engine'] == 'adk'
        worker.run(job)

        result = client.get('/api/uony/requests/' + request['requestId']).json()
        expected_form = {'id': request['requestId'], **form_args()}
        assert result['status'] == 'success', result
        assert result['response']['reply'] == FORM_READY_REPLY
        assert result['response']['conversationForm'] == expected_form
        assert result['response']['productChanges'] == []
        thread = client.get('/api/uony/threads').json()['threads'][0]
        assert thread['messages'][-1]['conversationForm'] == expected_form
        assert client.get('/api/products').json()['products'] == []
        with database.connect() as connection:
            saved = connection.execute(
                'SELECT status,conversation_form,usage FROM uony_requests '
                'WHERE request_id=%s', (request['requestId'],)).fetchone()
        assert saved['status'] == 'success'
        assert saved['conversation_form'] == expected_form
        assert saved['usage']['calls'] == saved['usage']['attemptedCalls'] == 1
        assert saved['usage']['totalTokenCount'] == 17
        assert saved['usage']['uncertainCalls'] == 0
        assert cloud.calls == 1
        assert sdk.closed and len(sdk.calls) == 1
