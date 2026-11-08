"""Recovery/ownership/cost tests against PostgreSQL, without paid model requests."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.product_materials_queue import MaterialsQueue, LeaseLost, BudgetPause
from material_start_copy import start_body
from conftest import client_for, login
from test_uony import ready
from test_products import connect as connect_cloud
from test_google_cloud import Cloud
from test_product_materials import FolderDrive, connect_drive


def prepare(client, google, db, config):
    ready(client, google, db)
    connect_cloud(db, config)
    connect_drive(db, config)
    client.post('/api/products', json={'sku': 'DURABLE', 'name': 'Torre'})
    body = start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'})
    response = client.post('/api/products/DURABLE/materials/jobs', json=body)
    assert response.status_code == 200, response.text
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
    return client.app.state.materials, user, response.json()['job'], body


def fragment(queue, row, user, name='one'):
    args = (row['id'], user['id'], row['lease_token'])
    queue.save_source(*args, {'id': 'spec', 'name': 'Ficha', 'status': 'read'}, 'v1')
    queue.put_fragment(*args, {'id': name, 'sourceId': 'spec', 'version': 'v1', 'locator': 'p1',
                              'payload': {'id': 'spec', 'segments': [{'locator': 'p1', 'text': 'Madera'}]}})
    return args


def test_api_only_enqueues_and_duplicate_start_does_not_execute(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job, body = prepare(client, google, db, config)
        assert job['status'] == 'queued'
        assert drive.reads == []
        assert client.post('/api/products/DURABLE/materials/jobs', json=body).json()['job']['id'] == job['id']
        with db.connect() as c:
            assert service.get(c, user, 'DURABLE')['job']['budget']['maxCalls'] == 200
        assert drive.reads == []


def test_two_claimers_only_one_owner_and_recovery_ignores_live_lease(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        with ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(lambda worker: MaterialsQueue(db).claim(worker), ['worker-a', 'worker-b']))
        owned = [row for row in rows if row]
        assert len(owned) == 1
        row = owned[0]
        assert service.queue.recover() == 0
        assert service.queue.heartbeat(row['id'], user['id'], row['lease_token'])
        assert not service.queue.heartbeat(row['id'], user['id'], uuid4())
        with pytest.raises(LeaseLost):
            service.queue.checkpoint(row['id'], uuid4(), row['lease_token'], {})
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (row['id'],))
        assert service.queue.recover() == 1
        replacement = service.queue.claim('replacement')
        assert replacement['id'] == row['id'] and replacement['lease_token'] != row['lease_token']
        with pytest.raises(LeaseLost):
            service.queue.checkpoint(row['id'], user['id'], row['lease_token'], {'proposals': []})


def test_provider_uncertainty_requires_ack_and_never_retries_automatically(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('crashing-worker')
        args = fragment(service.queue, row, user)
        service.queue.reserve_call(*args, ['one'], estimated_input_tokens=500)
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (row['id'],))
        assert service.queue.recover() == 1
        assert service.queue.claim('other-worker') is None
        current = client.get('/api/products/DURABLE/materials').json()['job']
        assert current['status'] == 'paused' and current['pauseReason'] == 'consumption_unknown'
        assert current['budget']['usedCalls'] == current['budget']['unknownCalls'] == 1
        assert current['coverage']['fragmentsPending'] == 1
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/resume'
        body = {'requestId': str(uuid4()), 'revision': 1}
        assert client.post(endpoint, json=body).json()['error'] == 'materials_consumption_unknown'
        body['acknowledgeUnknownConsumption'] = True
        resumed = client.post(endpoint, json=body)
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()['job']['status'] == 'queued'
        assert client.post(endpoint, json=body).json()['job']['id'] == job['id']
        retry = service.queue.claim('explicit-retry')
        assert retry
        new_call = service.queue.reserve_call(retry['id'], user['id'], retry['lease_token'], ['one'])
        assert new_call
        with db.connect() as c:
            calls = c.execute('SELECT state,acknowledged_at FROM product_material_calls WHERE job_id=%s ORDER BY created_at', (row['id'],)).fetchall()
        assert calls[0]['state'] == 'unknown' and calls[0]['acknowledged_at']
        assert calls[1]['state'] == 'running'


def test_checkpoint_unions_over_80_proposals_and_preserves_reviewed_values(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('analysis-worker')
        args = fragment(service.queue, row, user)
        proposals = [{'id': 'p' + str(i), 'field': 'custom:p' + str(i), 'value': str(i),
                      'evidence': [{'sourceId': 'spec'}], 'status': 'proposed'} for i in range(101)]
        service.queue.finish_fragment(*args, 'one', 'done', {'proposals': proposals})
        with db.connect() as c:
            reviewed = [{**proposals[0], 'status': 'confirmed', 'confirmedValue': 'CLIENTE', 'confirmedField': 'custom:p0'}]
            service.update_proposals(c, user, 'DURABLE', job['id'], reviewed)
        service.queue.checkpoint(*args, {'proposals': proposals, 'stage': 'reading'})
        current = client.get('/api/products/DURABLE/materials').json()['job']
        assert len(current['proposals']) == 101
        confirmed = next(item for item in current['proposals'] if item['id'] == 'p0')
        assert confirmed['status'] == 'confirmed' and confirmed['confirmedValue'] == 'CLIENTE'
        assert current['coverage']['fragmentsDone'] == 1
        assert service.queue.fragments(job['id'], uuid4()) == []
        assert service.queue.sources(job['id'], uuid4()) == []


def test_budget_and_completed_response_survive_restart_without_new_call(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('worker')
        args = fragment(service.queue, row, user)
        with db.connect() as c:
            c.execute('UPDATE product_material_jobs SET max_calls=1 WHERE id=%s', (row['id'],))
        call_id = service.queue.reserve_call(*args, ['one'], estimated_input_tokens=100)
        result = {'proposals': [{'id': 'p1', 'status': 'proposed', 'value': 'Madera', 'evidence': []}]}
        service.queue.finish_call(*args, call_id, {'totalTokenCount': 150, 'calls': 1}, result=result)
        service.queue.finish_call(*args, call_id, {'totalTokenCount': 9999}, state='unknown')
        assert MaterialsQueue(db).completed_call(row['id'], user['id'], ['one']) == result
        with pytest.raises(BudgetPause) as exhausted:
            service.queue.reserve_call(*args, ['two'])
        assert exhausted.value.reason == 'budget_exhausted'
        service.queue.checkpoint(*args, {'stage': 'paused', 'pauseReason': exhausted.value.reason}, 'paused')
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/resume'
        body = {'requestId': str(uuid4()), 'revision': 1}
        before = client.get('/api/products/DURABLE/materials').json()['job']
        blocked = client.post(endpoint, json=body)
        assert blocked.status_code == 409
        assert blocked.json()['error'] == 'materials_budget_consent_required'
        assert client.post(endpoint, json=body).json()['error'] == 'materials_budget_consent_required'
        after = client.get('/api/products/DURABLE/materials').json()['job']
        assert after['status'] == 'paused' and after['budget'] == before['budget']
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_controls WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0


def test_pause_resume_control_revision_idempotency_and_owner(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id']
        body = {'requestId': str(uuid4()), 'revision': 1}
        assert client.post(endpoint + '/pause', json=body, headers={'Origin': 'null'}).status_code == 403
        paused = client.post(endpoint + '/pause', json=body)
        assert paused.status_code == 200 and paused.json()['job']['status'] == 'paused'
        assert service.queue.claim('worker') is None
        assert client.post(endpoint + '/pause', json=body).status_code == 200
        assert client.post(endpoint + '/resume', json=body).status_code == 409
        resume = {'requestId': str(uuid4()), 'revision': 2}
        assert client.post(endpoint + '/resume', json=resume).json()['error'] == 'product_conflict'
        resume['revision'] = 1
        assert client.post(endpoint + '/resume', json=resume).json()['job']['status'] == 'queued'
        row = service.queue.claim('worker')
        assert row
        assert client.post(endpoint + '/pause', json={'requestId': str(uuid4()), 'revision': 1}).json()['job']['pauseRequested']
        args = fragment(service.queue, row, user)
        with pytest.raises(BudgetPause) as paused:
            service.queue.reserve_call(*args, ['one'])
        assert paused.value.reason == 'user_requested'
        google.subject, google.email = 'other', 'other@example.test'
        login(client, google)
        assert client.post(endpoint + '/resume', json=resume).status_code in (403, 404)
        assert client.get(endpoint).status_code == 404


def test_error_checkpoint_marks_unsettled_provider_calls_unknown_before_resume(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('worker-with-write-failure')
        args = fragment(service.queue, row, user)
        service.queue.reserve_call(*args, ['one'], estimated_input_tokens=100)
        # Simulate a response received, followed by failed finish_call persistence.
        service.queue.checkpoint(*args, {'error': {'code': 'analysis_failed'}, 'stage': 'error'}, 'error')
        current = client.get('/api/products/DURABLE/materials').json()['job']
        assert current['status'] == 'paused' and current['pauseReason'] == 'consumption_unknown'
        assert current['budget']['unknownCalls'] == 1
        assert service.queue.fragments(row['id'], user['id'])[0]['state'] == 'unknown'
        assert service.queue.claim('replacement') is None
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/resume'
        response = client.post(endpoint, json={'requestId': str(uuid4()), 'revision': 1})
        assert response.status_code == 409 and response.json()['error'] == 'materials_consumption_unknown'


def test_original_start_request_stays_idempotent_after_resuming_at_new_product_revision(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, original = prepare(client, google, db, config)
        base = '/api/products/DURABLE/materials/jobs'
        assert client.post(base + '/' + job['id'] + '/pause', json={'requestId': str(uuid4()), 'revision': 1}).status_code == 200
        changed = client.patch('/api/products/DURABLE', json={'revision': 1, 'brand': 'Marca confirmada'})
        assert changed.status_code == 200 and changed.json()['product']['revision'] == 2
        resumed = client.post(base + '/' + job['id'] + '/resume', json={'requestId': str(uuid4()), 'revision': 2})
        assert resumed.status_code == 200 and resumed.json()['job']['revision'] == 2
        replayed = client.post(base, json=original)
        assert replayed.status_code == 200 and replayed.json()['job']['id'] == job['id']


@pytest.mark.parametrize('state', ['unknown', 'done', 'error'])
def test_uncertain_usage_retains_reservation_after_ack_and_requires_more_budget(environment, state):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('worker-with-unconfirmed-usage')
        args = fragment(service.queue, row, user)
        with db.connect() as c:
            c.execute('UPDATE product_material_jobs SET max_tokens=9000 WHERE id=%s', (row['id'],))
        call_id = service.queue.reserve_call(*args, ['one'], estimated_input_tokens=100)
        service.queue.finish_call(*args, call_id, {'calls': 1, 'totalTokenCount': 0, 'unconfirmedCalls': 1}, state=state)
        service.queue.checkpoint(*args, {'stage': 'paused', 'pauseReason': 'user_requested'}, 'paused')
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/resume'
        resumed = client.post(endpoint, json={'requestId': str(uuid4()), 'revision': 1,
                                             'acknowledgeUnknownConsumption': state == 'unknown'})
        assert resumed.status_code == 200, resumed.text
        budget = resumed.json()['job']['budget']
        assert budget['usedTokens'] == 0 and budget['reservedTokens'] == 8292 and budget['unknownCalls'] == 1
        retry = service.queue.claim('explicit-resume')
        retry_args = (retry['id'], user['id'], retry['lease_token'])
        with pytest.raises(BudgetPause) as exhausted:
            service.queue.reserve_call(*retry_args, ['one'], estimated_input_tokens=100)
        assert exhausted.value.reason == 'budget_exhausted'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM product_material_calls WHERE job_id=%s', (row['id'],)).fetchone()['n'] == 1
        service.queue.checkpoint(*retry_args, {'stage': 'paused', 'pauseReason': 'budget_exhausted'}, 'paused')
        before = client.get('/api/products/DURABLE/materials').json()['job']
        blocked = client.post(endpoint, json={'requestId': str(uuid4()), 'revision': 1})
        assert blocked.status_code == 409 and blocked.json()['error'] == 'materials_budget_consent_required'
        after = client.get('/api/products/DURABLE/materials').json()['job']
        assert after['status'] == 'paused' and after['budget'] == before['budget']
        assert after['budget']['reservedTokens'] == 8292  # Acknowledgment is not reconciliation.
        assert service.queue.claim('budget-without-consent') is None
