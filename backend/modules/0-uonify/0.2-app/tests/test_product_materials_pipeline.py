"""Recorrido durable real PostgreSQL, proveedores de archivos/modelo controlados."""
import json
from uuid import uuid4
from unittest.mock import patch
import pytest
from psycopg.types.json import Jsonb
from conftest import client_for
from test_uony import ready
from test_products import connect as connect_cloud
from test_google_cloud import Cloud
from test_product_materials import connect_drive
from app.google_drive_provider import FOLDER
from app.google_cloud_provider import CloudError
from app.product_materials import ProductMaterials
from app.product_materials_analyzer import validate_output
from app.product_materials_queue import LeaseLost
from material_start_copy import start_body


class ManyFactsDrive(Cloud):
    def __init__(self, count=6, facts=20):
        super().__init__()
        self.reads = []
        self.files_data = {}
        self.entries = {}
        for index in range(count):
            identifier = f'file-{index:03}'
            content = json.dumps({f'fact_{index}_{n}': f'value-{index}-{n}' for n in range(facts)}).encode()
            self.files_data[identifier] = content
            self.entries[identifier] = {'id': identifier, 'name': f'{index:03}.json',
                'mimeType': 'application/json', 'size': str(len(content)), 'modifiedTime': '2026-10-14T10:00:00Z'}

    def metadata(self, token, identifier):
        if identifier == 'folder':
            return {'id': 'folder', 'name': 'Producto', 'mimeType': FOLDER}
        return dict(self.entries[identifier])

    def files(self, token, parent, page, search):
        assert parent == 'folder' and not page and not search
        return {'files': list(self.entries.values())}

    def content(self, token, identifier, max_bytes=None):
        self.reads.append(identifier)
        return self.files_data[identifier], 'application/json', self.entries[identifier]['name']


class FactsAnalyzer:
    def __init__(self):
        self.calls = []
        self.after_call = None
        self.timeout_once = False
        self.output_limit_once = False

    def analyze(self, token, project, product, sources):
        source = sources[0]
        self.calls.append((source['id'], tuple(item['locator'] for item in source['segments'])))
        if self.output_limit_once:
            self.output_limit_once = False
            error = CloudError('invalid_response')
            error.usage = {'calls': 1, 'totalTokenCount': 8192}
            error.diagnostics = {'stage': 'finish_reason', 'finishReason': 'MAX_TOKENS'}
            raise error
        if self.timeout_once:
            self.timeout_once = False
            error = CloudError('analysis_timeout')
            error.usage = {'calls': 1, 'unconfirmedCalls': 1, 'totalTokenCount': 0}
            raise error
        data = {'observations': [{'sourceId': source['id'], 'summary': 'Datos documentados.'}],
                'proposals': [{'field': 'custom:' + item['locator'][2:], 'label': item['locator'][2:],
                    'value': item['text'], 'evidence': [{'sourceId': source['id'], 'locator': item['locator'],
                    'excerpt': item['text']}]} for item in source['segments'][:16]]}
        result = {**validate_output(data, sources), 'usage': {'calls': 1, 'totalTokenCount': 200}}
        if self.after_call:
            self.after_call()
        return result


def setup(client, google, db, config):
    ready(client, google, db)
    connect_cloud(db, config)
    connect_drive(db, config)
    assert client.post('/api/products', json={'sku': 'PIPELINE', 'name': 'Producto prueba'}).status_code == 200
    body = start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'})
    response = client.post('/api/products/PIPELINE/materials/jobs', json=body)
    assert response.status_code == 200, response.text
    with db.connect() as connection:
        user = connection.execute('SELECT id FROM users').fetchone()['id']
    return response.json()['job']['id'], user, body


def get_job(client):
    return client.get('/api/products/PIPELINE/materials').json()['job']


def control(client, job_id, action, body=None):
    return client.post(f'/api/products/PIPELINE/materials/jobs/{job_id}/{action}',
                       json=body or {'requestId': str(uuid4()), 'revision': 1})


def pause_after_first_call(client, analyzer, job_id, user):
    def pause():
        analyzer.after_call = None
        assert control(client, job_id, 'pause').status_code == 200
    analyzer.after_call = pause
    client.app.state.materials.run(job_id, user)
    paused = get_job(client)
    assert paused['status'] == 'paused' and paused['pauseReason'] == 'user_requested'


def test_more_than_80_proposals_are_kept_and_saturated_parts_are_subdivided(environment):
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(), FactsAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, body = setup(client, google, db, config)
        assert get_job(client)['status'] == 'queued'
        client.app.state.materials.run(job_id, user)
        job = get_job(client)
        assert job['status'] == 'ready', job.get('error')
        assert len(job['proposals']) == len({proposal['id'] for proposal in job['proposals']}) == 120
        assert {proposal['field'] for proposal in job['proposals']} == {
            f'custom:fact_{i}_{n}' for i in range(6) for n in range(20)}
        assert all(source['status'] == 'analyzed' for source in job['sources'])
        assert len(analyzer.calls) == 18  # Seis padres saturados; doce hijos completos.
        assert job['coverage']['fragmentsPending'] == 0
        with db.connect() as connection:
            states = connection.execute('SELECT state,count(*) AS count FROM product_material_fragments GROUP BY state').fetchall()
        assert {row['state']: row['count'] for row in states} == {'split': 6, 'done': 12}
        replay = client.post('/api/products/PIPELINE/materials/jobs', json=body)
        assert replay.json()['job']['id'] == job_id and len(analyzer.calls) == 18


def test_budget_pause_survives_restart_without_unapproved_new_block(environment):
    config, google, db = environment
    drive, analyzer, cloud = ManyFactsDrive(count=3, facts=4), FactsAnalyzer(), Cloud()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=cloud) as client:
        job_id, user, _ = setup(client, google, db, config)
        with db.connect() as connection:
            connection.execute('UPDATE product_material_jobs SET max_calls=1 WHERE id=%s', (job_id,))
        client.app.state.materials.run(job_id, user)
        paused = get_job(client)
        assert paused['status'] == 'paused' and paused['pauseReason'] == 'budget_exhausted'
        assert paused['canResume'] is False
        assert len(paused['proposals']) == 4 and len(analyzer.calls) == 1
        resume_body = {'requestId': str(uuid4()), 'revision': 1}
        rejected = control(client, job_id, 'resume', resume_body)
        assert rejected.status_code == 409 and rejected.json()['error'] == 'materials_budget_consent_required'
        assert control(client, job_id, 'resume', resume_body).status_code == 409
        restarted = ProductMaterials(config, db, drive, cloud, analyzer)
        restarted.run(job_id, user)
        still_paused = get_job(client)
        assert still_paused['status'] == 'paused' and still_paused['budget'] == paused['budget']
        assert still_paused['proposals'] == paused['proposals']
        assert len(analyzer.calls) == 1
        assert drive.reads == ['file-000', 'file-001', 'file-002']
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS count FROM product_material_controls').fetchone()['count'] == 0
            historical_request = uuid4()
            connection.execute('''INSERT INTO product_material_controls
                (user_id,request_id,job_id,action,payload) VALUES(%s,%s,%s,%s,%s)''',
                (user, historical_request, job_id, 'resume',
                 Jsonb({'revision': 1, 'acknowledgeUnknownConsumption': False})))
        replay = control(client, job_id, 'resume', {'requestId': str(historical_request), 'revision': 1})
        assert replay.status_code == 200 and replay.json()['job']['id'] == job_id
        assert get_job(client)['status'] == 'paused' and len(analyzer.calls) == 1


def test_crash_after_provider_result_uses_saved_response_without_another_call(environment):
    config, google, db = environment
    drive, analyzer, cloud = ManyFactsDrive(count=1, facts=4), FactsAnalyzer(), Cloud()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=cloud) as client:
        job_id, user, _ = setup(client, google, db, config)
        service = client.app.state.materials
        original = service.queue.finish_fragment
        def simulate_crash(*args, **kwargs):
            if args[4] == 'done':
                raise LeaseLost()
            return original(*args, **kwargs)
        with patch.object(service.queue, 'finish_fragment', side_effect=simulate_crash):
            service.run(job_id, user)
        assert get_job(client)['status'] == 'running' and len(analyzer.calls) == 1
        with db.connect() as connection:
            connection.execute("UPDATE product_material_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (job_id,))
        restarted = ProductMaterials(config, db, drive, cloud, analyzer)
        assert restarted.recover() == 1
        restarted.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'ready' and len(result['proposals']) == 4, result
        assert result['sources'][0]['status'] == 'analyzed'
        assert len(analyzer.calls) == 1


def test_changed_source_is_not_analyzed_from_a_stale_checkpoint(environment):
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(count=2, facts=4), FactsAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        pause_after_first_call(client, analyzer, job_id, user)
        drive.entries['file-001']['modifiedTime'] = '2026-10-14T12:00:00Z'
        assert control(client, job_id, 'resume').status_code == 200
        client.app.state.materials.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'paused' and result['pauseReason'] == 'source_changed'
        assert result['canResume'] is False
        changed = next(source for source in result['sources'] if source['id'] == 'file-001')
        assert changed['changed'] is True and changed['status'] == 'error'
        assert 'cambió' in changed['reason']
        assert len(analyzer.calls) == 1 and len(result['proposals']) == 4
        assert control(client, job_id, 'resume').status_code == 409


def test_unknown_consumption_requires_explicit_acknowledgement_before_repeating(environment):
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(count=1, facts=4), FactsAnalyzer()
    analyzer.timeout_once = True
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        client.app.state.materials.run(job_id, user)
        paused = get_job(client)
        assert paused['pauseReason'] == 'consumption_unknown' and paused['budget']['unknownCalls'] == 1
        assert control(client, job_id, 'resume').status_code == 409
        assert len(analyzer.calls) == 1
        response = control(client, job_id, 'resume', {'requestId': str(uuid4()), 'revision': 1,
                                                    'acknowledgeUnknownConsumption': True})
        assert response.status_code == 200, response.text
        client.app.state.materials.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'ready' and len(result['proposals']) == 4
        assert result['budget']['usedCalls'] == 2 and result['budget']['unknownCalls'] == 1
        assert drive.reads == ['file-000']


def test_pause_from_client_keeps_result_and_only_continues_remaining_parts(environment):
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(count=2, facts=4), FactsAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        def pause_after_first():
            analyzer.after_call = None
            assert control(client, job_id, 'pause').status_code == 200
        analyzer.after_call = pause_after_first
        client.app.state.materials.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'paused' and result['pauseReason'] == 'user_requested'
        assert len(result['proposals']) == 4
        assert control(client, job_id, 'resume').status_code == 200
        client.app.state.materials.run(job_id, user)
        assert get_job(client)['status'] == 'ready' and len(analyzer.calls) == 2


def test_pause_while_saving_manifest_resumes_without_duplicate_or_missing_fragments(environment):
    config, google, db = environment
    drive, analyzer, cloud = ManyFactsDrive(count=1, facts=60), FactsAnalyzer(), Cloud()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=cloud) as client:
        job_id, user, _ = setup(client, google, db, config)
        service = client.app.state.materials
        original = service.queue.put_fragments
        manifest_ids = []
        def pause_after_manifest(*args):
            original(*args)
            manifest_ids.extend(fragment['id'] for fragment in args[3])
            assert control(client, job_id, 'pause').status_code == 200
        with patch.object(service.queue, 'put_fragments', side_effect=pause_after_manifest):
            service.run(job_id, user)
        assert get_job(client)['status'] == 'paused' and analyzer.calls == []
        assert len(manifest_ids) == 2
        with db.connect() as connection:
            saved = connection.execute('SELECT id FROM product_material_fragments').fetchall()
        assert {row['id'] for row in saved} == set(manifest_ids)
        assert control(client, job_id, 'resume').status_code == 200
        restarted = ProductMaterials(config, db, drive, cloud, analyzer)
        restarted.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'ready' and len(result['proposals']) == 60, result.get('error')
        assert result['sources'][0]['readingCoverage']['units'] == 60
        with db.connect() as connection:
            retained = connection.execute('SELECT id FROM product_material_fragments WHERE id=ANY(%s)',
                                          (manifest_ids,)).fetchall()
        assert {row['id'] for row in retained} == set(manifest_ids)
        assert drive.reads == ['file-000']  # El manifiesto leído no se vuelve a descargar.
        assert len(analyzer.calls) == 8


@pytest.mark.parametrize('crash_after_limit', [False, True])
def test_output_token_limit_subdivides_and_keeps_paid_marker_across_crash(environment, crash_after_limit):
    config, google, db = environment
    drive, analyzer, cloud = ManyFactsDrive(count=1, facts=4), FactsAnalyzer(), Cloud()
    analyzer.output_limit_once = True
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=cloud) as client:
        job_id, user, _ = setup(client, google, db, config)
        service = client.app.state.materials
        original = service.queue.put_fragment
        def crash_before_first_child(*args):
            if args[3]['payload'].get('parentId'):
                raise LeaseLost()
            return original(*args)
        if crash_after_limit:
            with patch.object(service.queue, 'put_fragment', side_effect=crash_before_first_child):
                service.run(job_id, user)
            assert get_job(client)['status'] == 'running' and len(analyzer.calls) == 1
            with db.connect() as connection:
                connection.execute("UPDATE product_material_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (job_id,))
            service = ProductMaterials(config, db, drive, cloud, analyzer)
            assert service.recover() == 1
        service.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'ready', result.get('error')
        assert len(result['proposals']) == 4 and result['sources'][0]['status'] == 'analyzed'
        assert len(analyzer.calls) == result['budget']['usedCalls'] == 3
        assert result['budget']['usedTokens'] == 8192 + 2 * 200
        with db.connect() as connection:
            limited = connection.execute("SELECT result FROM product_material_calls WHERE result->>'outputLimit'='true'").fetchall()
        assert len(limited) == 1 and limited[0]['result']['coverageLimited']


def test_confirmations_already_saved_while_paused_survive_resume(environment):
    from material_legacy_history import seed_previous_review
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(count=2, facts=4), FactsAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        pause_after_first_call(client, analyzer, job_id, user)
        seed_previous_review(db, client.app.state.materials, user, 'PIPELINE', job_id)
        product = client.get('/api/products').json()['products'][0]
        assert product['revision'] == 2 and len(product['customFields']) == 4
        assert all(proposal['status'] == 'confirmed' for proposal in get_job(client)['facts']['proposals'])
        assert control(client, job_id, 'resume', {'requestId': str(uuid4()), 'revision': 2}).status_code == 200
        client.app.state.materials.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'ready' and result['revision'] == 2
        assert len(result['proposals']) == 8
        assert sum(proposal['status'] == 'confirmed' for proposal in result['facts']['proposals']) == 4
        assert client.get('/api/products').json()['products'][0] == product


def test_transient_metadata_failure_recovers_read_source_without_redownload(environment):
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(count=2, facts=4), FactsAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        pause_after_first_call(client, analyzer, job_id, user)
        original = drive.metadata
        def unavailable(token, identifier):
            if identifier == 'file-001':
                raise CloudError('google_unavailable')
            return original(token, identifier)
        assert control(client, job_id, 'resume').status_code == 200
        with patch.object(drive, 'metadata', side_effect=unavailable):
            client.app.state.materials.run(job_id, user)
        failed = get_job(client)
        assert failed['status'] == 'error' and len(analyzer.calls) == 1
        source = next(item for item in failed['sources'] if item['id'] == 'file-001')
        assert source['status'] == 'error' and source['readComplete'] and source['reason']
        assert control(client, job_id, 'resume').status_code == 200
        client.app.state.materials.run(job_id, user)
        result = get_job(client)
        assert result['status'] == 'ready' and len(result['proposals']) == 8
        recovered = next(item for item in result['sources'] if item['id'] == 'file-001')
        assert recovered['status'] == 'analyzed' and 'reason' not in recovered
        assert len(analyzer.calls) == 2 and drive.reads == ['file-000', 'file-001']


def test_revoked_permission_of_completed_source_blocks_cached_facts_on_resume(environment):
    config, google, db = environment
    drive, analyzer = ManyFactsDrive(count=2, facts=4), FactsAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        pause_after_first_call(client, analyzer, job_id, user)
        paused = get_job(client)
        assert paused['status'] == 'paused' and len(paused['facts']['proposals']) == 4
        original = drive.metadata
        def revoked(token, identifier):
            if identifier == 'file-000':
                raise CloudError('permission_denied')
            return original(token, identifier)
        assert control(client, job_id, 'resume').status_code == 200
        with patch.object(drive, 'metadata', side_effect=revoked):
            client.app.state.materials.run(job_id, user)
        failed = get_job(client)
        assert failed['status'] == 'error' and failed['error']['code'] == 'permission_denied'
        assert failed['facts']['stale'] is True and len(analyzer.calls) == 1
        review = client.post('/api/uony/messages', json={'requestId': str(uuid4()), 'threadId': 'revoked-review',
            'text': 'Revisar los datos disponibles', 'materialAction': {'action': 'review', 'sku': 'PIPELINE', 'analysisId': job_id}})
        assert review.status_code == 409 and review.json()['error'] == 'analysis_not_ready'
        assert client.get('/api/products').json()['products'][0]['revision'] == 1
