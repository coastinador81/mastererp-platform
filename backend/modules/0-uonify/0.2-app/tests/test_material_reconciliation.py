"""La revisión usa originales persistidos, controla versiones y no aplica valores sola."""
from uuid import uuid4
from copy import deepcopy
from unittest.mock import patch
from psycopg.types.json import Jsonb
from conftest import client_for, login
from test_product_materials import FolderDrive, run_queued, Analyzer
from test_product_materials_durable import prepare
from test_google_cloud import Cloud


def completed_fixture(client, google, db, config):
    service, user, job, _ = prepare(client, google, db, config)
    service.analyzer = Analyzer()
    endpoint = '/api/products/DURABLE/materials'
    job = run_queued(client, db, endpoint)
    assert job['status'] == 'ready'
    return service, user, job, endpoint


def test_reconcile_is_durable_idempotent_and_keeps_originals_product_calls(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job, endpoint = completed_fixture(client, google, db, config)
        before = client.get('/api/products/DURABLE').json()
        reads, calls = list(drive.reads), service.analyzer.calls
        body = {'requestId': str(uuid4()), 'revision': 1}
        action = endpoint + '/jobs/' + job['id'] + '/reconcile'
        response = client.post(action, json=body)
        assert response.status_code == 200, response.text
        assert response.json()['job']['status'] == 'queued'
        assert response.json()['job']['operation'] == 'reconcile'
        assert client.post(action, json=body).json()['job']['id'] == job['id']
        result = run_queued(client, db, endpoint)
        assert result['facts']['version'] == 1 and result['reconciliation']['status'] == 'ready'
        assert result['reconciliation']['checkedSources'] == len(job['sources'])
        assert result['facts']['proposals']
        assert drive.reads == reads and service.analyzer.calls == calls
        assert client.get('/api/products/DURABLE').json() == before
        assert client.post(action, json=body).json()['job']['status'] == 'ready'
        assert client.post(action, json={**body, 'revision': 2}).status_code == 409
        assert client.post(action, json={'requestId': str(uuid4()), 'revision': 1}, headers={'Origin': 'null'}).status_code == 403
        google.subject, google.email = 'foreign', 'foreign@example.test'
        login(client, google)
        assert client.post(action, json=body).status_code in (403, 404)


def test_reconciliation_revalidates_changed_source_and_does_not_replace_confirmed_product(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job, endpoint = completed_fixture(client, google, db, config)
        before = client.get('/api/products/DURABLE').json()
        drive.children['nested'][0]['modifiedTime'] = '2026-10-15T10:00:00Z'
        response = client.post(endpoint + '/jobs/' + job['id'] + '/reconcile',
                               json={'requestId': str(uuid4()), 'revision': 1})
        assert response.status_code == 200
        result = run_queued(client, db, endpoint)
        assert result['status'] == 'paused' and result['pauseReason'] == 'source_changed'
        assert not result['canResume']
        assert client.get('/api/products/DURABLE').json() == before


def test_facts_review_status_survives_reconciliation(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, endpoint = completed_fixture(client, google, db, config)
        facts = deepcopy(job['facts']['proposals'])
        facts[0].update(status='rejected', reviewDecision='discarded', reviewedRevision=1)
        with db.connect() as c:
            service.update_facts(c, user, 'DURABLE', job['id'], facts)
        client.post(endpoint + '/jobs/' + job['id'] + '/reconcile',
                    json={'requestId': str(uuid4()), 'revision': 1})
        result = run_queued(client, db, endpoint)
        assert result['facts']['proposals'][0]['status'] == 'rejected'
        assert result['facts']['proposals'][0]['reviewDecision'] == 'discarded'


def test_reconciliation_restarts_without_provider_calls(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, endpoint = completed_fixture(client, google, db, config)
        calls = service.analyzer.calls
        client.post(endpoint + '/jobs/' + job['id'] + '/reconcile',
                    json={'requestId': str(uuid4()), 'revision': 1})
        row = service.queue.claim('interrupted-reconciliation')
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (row['id'],))
        service.queue.recover()
        result = run_queued(client, db, endpoint)
        assert result['status'] == 'ready' and result['facts']['version'] == 1
        assert service.analyzer.calls == calls


def test_consolidation_failure_persists_once_and_resumes_without_model_repetition(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        service.analyzer = Analyzer()
        with patch('app.product_materials_reconcile.build_facts', side_effect=ValueError('malformed-data')) as build:
            result = run_queued(client, db, '/api/products/DURABLE/materials')
        assert result['status'] == 'error' and result['error']['code'] == 'facts_failed'
        assert build.call_count == 1
        calls = service.analyzer.calls
        client.post('/api/products/DURABLE/materials/jobs/' + job['id'] + '/resume',
                    json={'requestId': str(uuid4()), 'revision': 1})
        result = run_queued(client, db, '/api/products/DURABLE/materials')
        assert result['status'] == 'ready' and result['facts']['version'] == 1
        assert service.analyzer.calls == calls
