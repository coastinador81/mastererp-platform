"""Cambiar lectores mantiene el trabajo, las decisiones y el consumo ya registrados."""
from copy import deepcopy
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.product_materials_upgrade import TARGET_READER, PDF_VISUAL_PROFILE, ARCHIVE_VECTOR_PROFILE, upgrade_eligible
from material_control_copy import control_body
from conftest import client_for, login
from test_product_materials import FolderDrive
from test_product_materials_durable import prepare
from test_google_cloud import Cloud


def product_snapshot(client, sku='DURABLE'):
    response = client.get('/api/products')
    assert response.status_code == 200, response.text
    return next(product for product in response.json()['products'] if product['sku'] == sku)


def completed(client, google, db, config):
    service, user, job, _ = prepare(client, google, db, config)
    row = service.queue.claim('fixture-reader-upgrade', job['id'])
    args = (row['id'], user['id'], row['lease_token'])
    source = {'id': 'pack', 'name': 'Packaging.pdf', 'mimeType': 'application/pdf', 'version': 'original-v1',
              'readerVersion': 'drive-segments-v1', 'readComplete': True, 'status': 'analyzed'}
    service.queue.save_source(*args, source, source['version'])
    service.queue.save_source(*args, {'id': 'spec', 'name': 'Ficha.json', 'mimeType': 'application/json',
                                    'readerVersion': 'drive-segments-v1', 'readComplete': True, 'status': 'analyzed'}, 'original-json')
    service.queue.put_fragment(*args, {'id': 'finished', 'sourceId': 'pack', 'version': source['version'], 'state': 'done',
                                     'payload': {'segments': [{'locator': 'Página 1', 'text': 'Marca: UONIFY'}]}})
    facts = {'version': 1, 'proposals': [{'id': 'fact', 'status': 'confirmed', 'confirmedValue': 'UONIFY'}], 'rejections': []}
    service.queue.checkpoint(*args, {**row['result'], 'stage': 'ready',
                                     'discoveryComplete': True, 'facts': facts}, 'ready')
    endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/upgrade-readers'
    return service, user, job, endpoint, facts


@pytest.mark.parametrize('name,mime,expected', [
    ('p.png', 'image/png', True), ('p.pdf', 'application/pdf', True), ('p.svg', 'application/octet-stream', True),
    ('p.blend', 'application/octet-stream', True), ('p.zip', 'application/zip', True),
    ('p.json', 'application/json', False), ('p.csv', 'text/csv', False),
    ('Drive Doc', 'application/vnd.google-apps.document', True),
])
def test_upgrade_targets_only_formats_with_added_readers(name, mime, expected):
    source = {'name': name, 'mimeType': mime}
    assert upgrade_eligible(source) is expected
    assert not upgrade_eligible({**source, 'readerVersion': TARGET_READER, 'readComplete': True,
                                 'readingCoverage': {'pdfVisualProfile': PDF_VISUAL_PROFILE,
                                                     'archiveVectorProfile': ARCHIVE_VECTOR_PROFILE}})
    assert not upgrade_eligible({**source, 'changed': True})


def test_pdf_reader_v2_still_needs_visual_profile_and_complete_reading():
    source = {'name': 'p.pdf', 'mimeType': 'application/pdf', 'readerVersion': TARGET_READER,
              'readComplete': True}
    assert upgrade_eligible(source)
    source['readingCoverage'] = {'pdfVisualProfile': PDF_VISUAL_PROFILE}
    assert not upgrade_eligible(source)
    assert upgrade_eligible({**source, 'readComplete': False})


def test_zip_reader_v2_requires_vector_profile_and_complete_reading():
    source = {'name': 'p.zip', 'mimeType': 'application/zip', 'readerVersion': TARGET_READER,
              'readComplete': True}
    assert upgrade_eligible(source)
    source['readingCoverage'] = {'archiveVectorProfile': ARCHIVE_VECTOR_PROFILE}
    assert not upgrade_eligible(source)
    assert upgrade_eligible({**source, 'readComplete': False})


def test_upgrade_is_idempotent_preserves_confirmed_facts_product_and_completed_fragments(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job, endpoint, facts = completed(client, google, db, config)
        before = product_snapshot(client)
        assert client.get('/api/products/DURABLE/materials').json()['job']['readerUpgradeAvailable']
        body = control_body('upgrade_readers')
        response = client.post(endpoint, json=body)
        assert response.status_code == 200, response.text
        upgraded = response.json()['job']
        assert upgraded['id'] == job['id'] and upgraded['status'] == 'queued'
        assert upgraded['operation'] == 'upgrade_readers'
        assert upgraded['readerUpgrade']['sourceIds'] == ['pack']
        assert upgraded['facts']['proposals'] == facts['proposals'] and upgraded['facts']['stale']
        sources = {item['id']: item for item in upgraded['sources']}
        assert sources['pack']['pendingReaderUpgrade'] and not sources['pack']['readComplete']
        assert sources['pack']['version'] == 'original-v1'
        assert sources['spec']['readComplete'] and sources['spec']['status'] == 'analyzed'
        assert upgraded['coverage']['fragmentsDone'] == 1
        assert client.post(endpoint, json=body).json()['job'] == upgraded
        assert client.post(endpoint, json={**body, 'revision': 2}).status_code == 409
        assert product_snapshot(client) == before
        assert drive.reads == []
        assert service.queue.fragments(job['id'], user['id'])[0]['state'] == 'done'


def test_upgrade_enforces_revision_identity_origin_and_current_reader(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, endpoint, _ = completed(client, google, db, config)
        body = control_body('upgrade_readers', revision=2)
        assert client.post(endpoint, json=body).json()['error'] == 'product_conflict'
        body['revision'] = 1
        assert client.post(endpoint, json=body, headers={'Origin': 'null'}).status_code == 403
        with db.connect() as c:
            c.execute("UPDATE product_material_sources SET data=data || %s WHERE job_id=%s AND source_id='pack'",
                      (Jsonb({'readerVersion': TARGET_READER, 'readComplete': True,
                              'readingCoverage': {'pdfVisualProfile': PDF_VISUAL_PROFILE}}), job['id']))
        assert not client.get('/api/products/DURABLE/materials').json()['job']['readerUpgradeAvailable']
        assert client.post(endpoint, json=body).status_code == 409
        google.subject, google.email = 'foreign', 'foreign@example.test'
        login(client, google)
        assert client.post(endpoint, json=body).status_code in (403, 404)


def test_upgrade_cannot_hide_unknown_consumption_or_open_a_new_budget_window(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, endpoint, _ = completed(client, google, db, config)
        with db.connect() as c:
            c.execute("INSERT INTO product_material_calls(id,job_id,lease_token,fragment_ids,state,reserved_tokens,total_tokens) VALUES(%s,%s,%s,%s,'unknown',2500,400)",
                      (uuid4(), job['id'], uuid4(), Jsonb(['finished'])))
        body = control_body('upgrade_readers')
        assert client.get('/api/products/DURABLE/materials').json()['job']['readerUpgradeAvailable'] is False
        assert client.post(endpoint, json=body).json()['error'] == 'materials_scope_conflict'
        before = client.get('/api/products/DURABLE/materials').json()['job']['budget']
        body['acknowledgeUnknownConsumption'] = True
        response = client.post(endpoint, json=body)
        assert response.status_code == 409 and response.json()['error'] == 'materials_scope_conflict'
        assert client.get('/api/products/DURABLE/materials').json()['job']['budget'] == before
        assert service.queue.fragments(job['id'], user['id'])[0]['state'] == 'done'


def test_upgrade_rejects_unrelated_pending_fragment_before_budget_or_control(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job, endpoint, _ = completed(client, google, db, config)
        with db.connect() as c:
            c.execute('''INSERT INTO product_material_fragments
                (job_id,id,source_id,version,locator,state,payload)
                VALUES(%s,'unrelated-pending','spec','original-json','$.sku','pending',%s)''',
                (job['id'], Jsonb({'id': 'spec', 'segments': [{'locator': '$.sku', 'text': 'OTHER'}]})))
            original = c.execute('SELECT max_calls,max_tokens,result FROM product_material_jobs WHERE id=%s',
                                 (job['id'],)).fetchone()
        assert client.get('/api/products/DURABLE/materials').json()['job']['readerUpgradeAvailable'] is False
        response = client.post(endpoint, json=control_body('upgrade_readers'))
        assert response.status_code == 409 and response.json()['error'] == 'materials_scope_conflict'
        with db.connect() as c:
            assert c.execute('SELECT max_calls,max_tokens,result FROM product_material_jobs WHERE id=%s',
                             (job['id'],)).fetchone() == original
            assert c.execute("SELECT state FROM product_material_fragments WHERE job_id=%s AND id='unrelated-pending'",
                             (job['id'],)).fetchone()['state'] == 'pending'
            assert c.execute('SELECT count(*) n FROM product_material_controls WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_control_authorizations WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_calls WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0
        service.run(job['id'], user['id'])
        assert drive.reads == []


def test_upgrade_rejects_an_unfinished_previous_source(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, _, job, endpoint, _ = completed(client, google, db, config)
        with db.connect() as c:
            c.execute("UPDATE product_material_sources SET data=data || %s WHERE job_id=%s AND source_id='pack'",
                      (Jsonb({'readComplete': False, 'status': 'partial'}), job['id']))
        assert client.get('/api/products/DURABLE/materials').json()['job']['readerUpgradeAvailable'] is False
        response = client.post(endpoint, json=control_body('upgrade_readers'))
        assert response.status_code == 409 and response.json()['error'] == 'materials_scope_conflict'


def test_changed_source_needs_new_analysis_and_not_reader_upgrade(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, _, job, endpoint, _ = completed(client, google, db, config)
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET status='paused',result=result || %s WHERE id=%s",
                      (Jsonb({'pauseReason': 'source_changed'}), job['id']))
        response = client.post(endpoint, json=control_body('upgrade_readers'))
        assert response.status_code == 409
        assert 'nueva versión' in response.json()['message']


def test_paused_upgrade_must_resume_instead_of_opening_another_window(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, _, job, endpoint, _ = completed(client, google, db, config)
        assert client.post(endpoint, json=control_body('upgrade_readers')).status_code == 200
        pause = endpoint.replace('/upgrade-readers', '/pause')
        assert client.post(pause, json={'requestId': str(uuid4()), 'revision': 1}).status_code == 200
        current = client.get('/api/products/DURABLE/materials').json()['job']
        assert current['canResume'] and not current['readerUpgradeAvailable']
        response = client.post(endpoint, json=control_body('upgrade_readers'))
        assert response.status_code == 409 and 'Reanuda' in response.json()['message']


def test_paused_evidence_repair_cannot_be_replaced_with_reader_upgrade(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, _, job, endpoint, _ = completed(client, google, db, config)
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET status='paused',result=result || %s WHERE id=%s",
                      (Jsonb({'operation': 'repair_evidence', 'stage': 'paused', 'pauseReason': 'user_requested'}), job['id']))
        response = client.post(endpoint, json=control_body('upgrade_readers'))
        assert response.status_code == 409 and 'revisión de evidencias' in response.json()['message']
