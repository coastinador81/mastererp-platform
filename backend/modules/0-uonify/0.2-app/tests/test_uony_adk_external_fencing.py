"""ADK cannot replay out-of-transaction effects after an uncertain call."""
from dataclasses import replace
from uuid import uuid4

import pytest

pytest.importorskip('google.adk.runners')

from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from app.blender_tools import BusinessTools
from app.uony_conversation_worker import ADK_ALLOWED_TOOLS, UNFENCED_TOOLS
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_adk_agent import FakeSdkClient, model_response, text, tool
from test_uony_conversation_queue import connected


@pytest.fixture
def sdk(monkeypatch):
    fake = FakeSdkClient()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: fake))
    return fake


def prepared(environment):
    settings, google, database = environment
    return replace(settings, adk_enabled=True), google, database


def connect(client, settings, google, database):
    ready(client, google, database)
    with database.connect() as connection:
        user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                  (google.subject,)).fetchone()['id']
        connected(connection, user, google, settings)
    return user


def approve_proposal_once(client, proposal, sku):
    """Only the customer's separate decision may persist an ADK proposal."""
    body = {'threadId': proposal['threadId'], 'requestId': str(uuid4()),
            'proposalHash': proposal['proposalHash'],
            'baseRevision': proposal['baseRevision'], 'action': 'approve'}
    url = '/api/uony/product-proposals/' + proposal['proposalId'] + '/decision'
    approved = client.post(url, json=body)
    assert approved.status_code == 200, approved.text
    assert approved.json()['productChanges'][0]['product']['sku'] == sku
    assert client.post(url, json=body).json() == approved.json()
    return approved.json()


def test_adk_allowlist_covers_every_currently_audited_local_tool():
    declared = {item['name'] for item in BusinessTools.declarations}
    assert ADK_ALLOWED_TOOLS == declared - UNFENCED_TOOLS
    assert 'remember_assignment' in ADK_ALLOWED_TOOLS
    assert ADK_ALLOWED_TOOLS.isdisjoint(UNFENCED_TOOLS)


def test_new_business_tool_is_not_declared_or_dispatched_by_adk(
        environment, sdk, monkeypatch):
    settings, google, database = prepared(environment)
    future = {'name': 'future_external_effect', 'description': 'QA only',
              'parameters': {'type': 'OBJECT', 'properties': {}}}
    monkeypatch.setattr(BusinessTools, 'declarations',
                        [*BusinessTools.declarations, future])
    original = BusinessTools.call

    def no_future_effect(self, name, args):
        if name == future['name']:
            pytest.fail('New tool escaped the ADK allowlist')
        return original(self, name, args)

    monkeypatch.setattr(BusinessTools, 'call', no_future_effect)
    sdk.responses = [model_response([tool(future['name'])])]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-future-tool',
                'text': 'Comprueba la herramienta futura'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        worker.run(worker.queue.claim('adk-future-tool-worker'))
        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'error'
        assert result['error']['code'] == 'invalid_response'
        declarations = {declaration.name for group in sdk.calls[0][2].tools or []
                        for declaration in group.function_declarations or []}
        assert future['name'] not in declarations
        assert ADK_ALLOWED_TOOLS - {'ask_user'} <= declarations
        assert 'ask_user' not in declarations  # No form was requested in this turn.


@pytest.mark.parametrize('name,args', (
    ('inspect_blender_scene', {}),
    ('render_blender_preview', {}),
    ('start_incident_resolution', {'incidentId': str(uuid4())}),
))
def test_new_request_id_cannot_dispatch_unfenced_tool_after_unknown(
        environment, sdk, monkeypatch, name, args):
    settings, google, database = prepared(environment)

    def forbidden(*_args, **_kwargs):
        pytest.fail('An out-of-transaction tool was dispatched')

    monkeypatch.setattr('app.blender_store.enqueue', forbidden)
    monkeypatch.setattr('app.incident_guide.IncidentTools.call', forbidden)
    sdk.responses = [TimeoutError(), model_response([tool(name, args)])]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-external-fence',
                'text': 'Comprueba esta operación de prueba'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        first = worker.queue.claim('adk-external-first')
        assert first['engine'] == 'adk'
        worker.run(first)
        assert client.get('/api/uony/requests/' + body['requestId']).json()['status'] == 'unknown'
        assert worker.queue.claim('no-automatic-replay') is None

        retry = {**body, 'requestId': str(uuid4()), 'retryOf': body['requestId']}
        assert client.post('/api/uony/messages', json=retry).status_code == 202
        second = worker.queue.claim('adk-external-second')
        assert second['engine'] == 'adk' and second['request_id'] != first['request_id']
        worker.run(second)
        result = client.get('/api/uony/requests/' + retry['requestId']).json()
        assert result['status'] == 'error'
        assert result['error']['code'] == 'invalid_response'
        with database.connect() as connection:
            jobs = connection.execute('SELECT count(*) AS n FROM blender_jobs WHERE user_id=%s',
                                      (user,)).fetchone()['n']
        assert jobs == 0 and len(sdk.calls) == 2


def test_prepared_product_requires_approval_after_successful_fenced_finish(
        environment, sdk):
    settings, google, database = prepared(environment)
    sku = 'ADK-FENCED-BASIC'
    sdk.responses = [model_response([tool('create_product',
        {'sku': sku, 'name': 'Basic Mini Bricks · prueba aislada'})]),
        TimeoutError(),
        model_response([tool('create_product',
            {'sku': sku, 'name': 'Basic Mini Bricks · prueba aislada'})]),
        text('He preparado el borrador.')]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-product-fence',
                'text': 'Crea este borrador de prueba'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        worker.run(worker.queue.claim('adk-product-first'))
        assert client.get('/api/uony/requests/' + body['requestId']).json()['status'] == 'unknown'
        with database.connect() as connection:
            before = connection.execute('SELECT count(*) AS n FROM products WHERE user_id=%s AND sku=%s',
                                        (user, sku)).fetchone()['n']
        assert before == 0

        retry = {**body, 'requestId': str(uuid4()), 'retryOf': body['requestId']}
        assert client.post('/api/uony/messages', json=retry).status_code == 202
        worker.run(worker.queue.claim('adk-product-second'))
        state = client.get('/api/uony/requests/' + retry['requestId']).json()
        assert state['status'] == 'success'
        assert state['response']['productChanges'] == []
        proposal = state['response']['productProposal']
        assert proposal['status'] == 'pending' and proposal['targetSku'] == sku
        with database.connect() as connection:
            after = connection.execute('SELECT count(*) AS n FROM products WHERE user_id=%s AND sku=%s',
                                       (user, sku)).fetchone()['n']
            proposals = connection.execute('SELECT count(*) AS n FROM uony_product_proposals '
                'WHERE user_id=%s AND target_sku=%s', (user, sku)).fetchone()['n']
        assert after == 0 and proposals == 1 and len(sdk.calls) == 4
        approve_proposal_once(client, proposal, sku)
        with database.connect() as connection:
            saved = connection.execute('SELECT count(*) AS n FROM products WHERE user_id=%s AND sku=%s',
                                       (user, sku)).fetchone()['n']
        assert saved == 1 and len(sdk.calls) == 4


def test_completed_adk_answer_cut_before_finish_cannot_duplicate_product_on_retry(
        environment, sdk):
    settings, google, database = prepared(environment)
    sku = 'ADK-CUT-BEFORE-FINISH'
    sdk.responses = [model_response([tool('create_product',
        {'sku': sku, 'name': 'Basic Mini Bricks · corte aislado'})]),
        text('Borrador preparado.'),
        model_response([tool('create_product',
            {'sku': sku, 'name': 'Basic Mini Bricks · corte aislado'})]),
        text('Borrador preparado.')]
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(),
                    legacy_sync=False) as client:
        user = connect(client, settings, google, database)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-before-finish',
                'text': 'Crea este borrador de prueba'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        original = worker.queue.provider_return

        def interrupted(job):
            original(job)
            raise RuntimeError('simulated crash after the final model answer')

        worker.queue.provider_return = interrupted
        worker.run(worker.queue.claim('adk-before-finish-first'))
        worker.queue.provider_return = original
        assert client.get('/api/uony/requests/' + body['requestId']).json()['status'] == 'unknown'
        with database.connect() as connection:
            before = connection.execute('SELECT count(*) AS n FROM products WHERE user_id=%s AND sku=%s',
                                        (user, sku)).fetchone()['n']
        assert before == 0

        retry = {**body, 'requestId': str(uuid4()), 'retryOf': body['requestId']}
        assert client.post('/api/uony/messages', json=retry).status_code == 202
        worker.run(worker.queue.claim('adk-before-finish-second'))
        state = client.get('/api/uony/requests/' + retry['requestId']).json()
        assert state['status'] == 'success'
        assert state['response']['productChanges'] == []
        proposal = state['response']['productProposal']
        assert proposal['status'] == 'pending' and proposal['targetSku'] == sku
        with database.connect() as connection:
            after = connection.execute('SELECT count(*) AS n FROM products WHERE user_id=%s AND sku=%s',
                                       (user, sku)).fetchone()['n']
            proposals = connection.execute('SELECT count(*) AS n FROM uony_product_proposals '
                'WHERE user_id=%s AND target_sku=%s', (user, sku)).fetchone()['n']
        assert after == 0 and proposals == 1 and len(sdk.calls) == 4
        approve_proposal_once(client, proposal, sku)
        with database.connect() as connection:
            saved = connection.execute('SELECT count(*) AS n FROM products WHERE user_id=%s AND sku=%s',
                                       (user, sku)).fetchone()['n']
        assert saved == 1 and len(sdk.calls) == 4
