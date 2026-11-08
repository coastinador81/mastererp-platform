"""ADK call checkpoints in isolated PostgreSQL with a fake SDK client."""
from dataclasses import replace
from uuid import uuid4

import pytest

pytest.importorskip('google.adk.runners')

from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_adk_agent import FakeSdkClient, model_response, tool
from test_uony_conversation_queue import connected


@pytest.fixture
def sdk(monkeypatch):
    fake = FakeSdkClient()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: fake))
    return fake


def prepared(environment):
    settings, google, database = environment
    qa_settings = replace(settings, adk_enabled=True)
    return qa_settings, google, database


def connect(client, settings, google, database):
    ready(client, google, database)
    with database.connect() as connection:
        user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                  (google.subject,)).fetchone()['id']
        connected(connection, user, google, settings)
    return user


@pytest.mark.parametrize('failed_ordinal', (2, 3))
def test_second_or_third_call_failure_keeps_exact_durable_counts_and_never_replays(
        environment, sdk, failed_ordinal):
    settings, google, database = prepared(environment)
    sdk.responses = [model_response([tool('get_connection_status')])
                     for _ in range(failed_ordinal - 1)] + [TimeoutError()]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': f'adk-fail-{failed_ordinal}',
                'text': 'Consulta el estado de mi conexión'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('adk-checkpoint-qa')
        assert job['engine'] == 'adk'
        worker.run(job)
        state = client.get('/api/uony/requests/' + body['requestId']).json()
        assert state['status'] == 'unknown'
        assert state['error']['code'] == 'consumption_unknown'
        with database.connect() as connection:
            saved = connection.execute('SELECT provider_attempt_count,provider_completed_count,usage '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user, body['requestId'])).fetchone()
        assert saved['provider_attempt_count'] == failed_ordinal
        assert saved['provider_completed_count'] == failed_ordinal - 1
        assert saved['usage']['attemptedCalls'] == failed_ordinal
        assert saved['usage']['calls'] == failed_ordinal - 1
        assert saved['usage']['uncertainCalls'] >= 1
        assert saved['usage']['totalTokenCount'] == 9 * (failed_ordinal - 1)
        assert len(sdk.calls) == failed_ordinal
        assert worker.queue.claim('must-not-replay') is None
        assert client.post('/api/uony/messages', json=body).json()['status'] == 'unknown'
        assert client.post('/api/uony/messages', json={**body, 'requestId': str(uuid4())}).status_code == 409
        assert len(sdk.calls) == failed_ordinal


@pytest.mark.parametrize('commit_before_failure', (False, True))
def test_response_is_never_dispatched_to_tool_before_checkpoint(
        environment, sdk, commit_before_failure):
    settings, google, database = prepared(environment)
    sku = 'MUST-NOT-CREATE'
    sdk.responses = [model_response([tool('create_product',
        {'sku': sku, 'name': 'No debe guardarse'})])]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-checkpoint-order',
                'text': 'Crea un borrador de prueba'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('adk-checkpoint-qa')
        original = worker.queue.stream_complete
        def interrupt(saved_job, ordinal, usage):
            if commit_before_failure:
                original(saved_job, ordinal, usage)
            raise RuntimeError('simulated interruption at checkpoint')
        worker.queue.stream_complete = interrupt
        worker.run(job)
        state = client.get('/api/uony/requests/' + body['requestId']).json()
        assert state['status'] == 'unknown'
        with database.connect() as connection:
            saved = connection.execute('SELECT provider_attempt_count,provider_completed_count,usage '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user, body['requestId'])).fetchone()
            product = connection.execute('SELECT 1 FROM products WHERE user_id=%s AND sku=%s',
                                         (user, sku)).fetchone()
        assert saved['provider_attempt_count'] == 1
        assert saved['provider_completed_count'] == int(commit_before_failure)
        assert saved['usage']['attemptedCalls'] == 1
        assert saved['usage']['calls'] == int(commit_before_failure)
        assert saved['usage']['uncertainCalls'] >= 1
        assert saved['usage'].get('totalTokenCount', 0) == (9 if commit_before_failure else 0)
        assert product is None and len(sdk.calls) == 1
        assert worker.queue.claim('must-not-replay') is None


def test_expired_third_adk_call_keeps_completed_usage_and_requires_explicit_retry(environment):
    settings, google, database = prepared(environment)
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-expired-third',
                'text': 'Consulta el estado de mi conexión'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        queue = client.app.state.conversation_worker.queue
        job = queue.claim('crashed-adk-worker')
        assert job['engine'] == 'adk'
        queue.stream_attempt(job, 1)
        queue.stream_complete(job, 1, {'attemptedCalls': 1, 'calls': 1,
                                       'totalTokenCount': 9})
        queue.stream_attempt(job, 2)
        queue.stream_complete(job, 2, {'attemptedCalls': 2, 'calls': 2,
                                       'totalTokenCount': 18})
        queue.stream_attempt(job, 3)
        with database.connect() as connection:
            connection.execute("""UPDATE uony_conversation_jobs
                SET lease_until=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""", (user, body['requestId']))
        assert queue.recover()
        state = client.get('/api/uony/requests/' + body['requestId']).json()
        assert state['status'] == 'unknown'
        with database.connect() as connection:
            saved = connection.execute('SELECT provider_attempt_count,provider_completed_count,usage '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user, body['requestId'])).fetchone()
        assert saved['provider_attempt_count'] == 3
        assert saved['provider_completed_count'] == 2
        assert saved['usage']['attemptedCalls'] == 3
        assert saved['usage']['calls'] == 2
        assert saved['usage']['uncertainCalls'] >= 1
        assert saved['usage']['totalTokenCount'] == 18
        assert queue.claim('no-automatic-replay') is None


def test_reserved_call_is_unknown_if_worker_errors_before_returning_from_checkpoint(
        environment, sdk):
    settings, google, database = prepared(environment)
    sdk.responses = [model_response([tool('create_product',
        {'sku': 'RESERVATION-ONCE', 'name': 'No debe guardarse'})])]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-reservation-cut',
                'text': 'Prepara un borrador de prueba'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('adk-reservation-qa')
        original = worker.queue.stream_attempt

        def interrupted(saved_job, ordinal):
            original(saved_job, ordinal)
            raise RuntimeError('simulated interruption after reservation commit')

        worker.queue.stream_attempt = interrupted
        worker.run(job)
        state = client.get('/api/uony/requests/' + body['requestId']).json()
        assert state['status'] == 'unknown'
        with database.connect() as connection:
            saved = connection.execute('SELECT provider_attempt_count,provider_completed_count,usage '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user, body['requestId'])).fetchone()
            product = connection.execute('SELECT 1 FROM products WHERE user_id=%s AND sku=%s',
                                         (user, 'RESERVATION-ONCE')).fetchone()
        assert saved['provider_attempt_count'] == 1
        assert saved['provider_completed_count'] == 0
        assert saved['usage']['attemptedCalls'] == 1
        assert saved['usage']['uncertainCalls'] >= 1
        assert product is None and not sdk.calls
        assert worker.queue.claim('no-automatic-replay') is None
