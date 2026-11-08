"""Reanudar un lector mejor no factura las mismas unidades pendientes dos veces."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4

import pytest

from material_control_copy import control_body
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials import Analyzer, FolderDrive
from test_product_materials_durable import prepare


class UpgradeDrive(FolderDrive):
    def __init__(self, duplicate=False):
        super().__init__()
        self.data = b'unchanged original bytes'
        self.children = {'folder': [{'id': 'original', 'name': 'A.png', 'mimeType': 'image/png',
                                    'modifiedTime': '2026-10-14T10:00:00Z'}]}
        if duplicate:
            self.children['folder'].append({'id': 'copy', 'name': 'Z.png', 'mimeType': 'image/png',
                                           'modifiedTime': '2026-10-14T10:00:00Z'})

    def content(self, token, identifier, max_bytes=None):
        self.reads.append(identifier)
        item = self.metadata(token, identifier)
        return self.data, item['mimeType'], item['name']


def seed(client, google, db, config, drive, old_state='done', duplicate=False):
    service, user, job, _ = prepare(client, google, db, config)
    row = service.queue.claim('legacy-fixture', job['id'])
    args = (row['id'], user['id'], row['lease_token'])
    for item in drive.children['folder']:
        source = {**item, 'version': 'legacy-original-' + item['id'], 'readerVersion': 'drive-segments-v1',
                  'sha256': sha256(drive.data).hexdigest(), 'readComplete': True, 'status': 'analyzed'}
        if item['id'] == 'copy':
            source.update(duplicateOf='original', status='duplicate')
        service.queue.save_source(*args, source, source['version'])
        fragment = {'id': 'legacy-' + item['id'], 'sourceId': item['id'], 'version': source['version'],
                    'state': 'superseded' if item['id'] == 'copy' else old_state,
                    'payload': {'id': item['id'], 'segments': [{'locator': 'Línea 1', 'text': 'Material: madera'}],
                                **({'image': {'width': 10, 'height': 10}} if duplicate else {})}}
        service.queue.put_fragment(*args, fragment)
        if old_state == 'done':
            service.queue.finish_fragment(*args, fragment['id'], fragment['state'], {
                'observations': {item['id']: 'Observación anterior conservada.'}})
    service.queue.checkpoint(*args, {**row['result'], 'discoveryComplete': True,
        'stage': 'paused', 'pauseReason': 'user_requested'}, 'paused')
    endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/upgrade-readers'
    response = client.post(endpoint, json=control_body('upgrade_readers'))
    if old_state == 'pending':
        assert response.status_code == 409 and response.json()['error'] == 'materials_scope_conflict'
    else:
        assert response.status_code == 200, response.text
    return service, user, job


def extraction(content, native=False, image=False):
    part = {'key': 'new-unit', 'segments': [{'locator': 'Línea 1', 'text': 'Material: madera'}]}
    if native:
        part['analysisMode'] = 'native_manifest'
    if image:
        part['image'] = {'width': 10, 'height': 10}
    return {'sha256': sha256(content).hexdigest(), 'bytes': len(content), 'warnings': [],
            'coverage': {'complete': True, 'units': 1}, 'fragments': [part]}


def test_upgrade_does_not_consume_a_pending_legacy_fragment(environment):
    config, google, db = environment
    drive, analyzer = UpgradeDrive(), Analyzer()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job = seed(client, google, db, config, drive, old_state='pending')
        service.analyzer = analyzer
        before = client.get('/api/products/DURABLE/materials').json()['job']
        service.run(job['id'], user['id'])
        assert client.get('/api/products/DURABLE/materials').json()['job'] == before
        assert service.queue.fragments(job['id'], user['id'])[0]['state'] == 'pending'
        assert analyzer.calls == 0 and drive.reads == []
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_controls WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0


def test_legacy_duplicate_marker_still_deduplicates_new_reader_fragments(environment, monkeypatch):
    config, google, db = environment
    drive, analyzer = UpgradeDrive(duplicate=True), Analyzer()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job = seed(client, google, db, config, drive, old_state='done', duplicate=True)
        service.analyzer = analyzer
        monkeypatch.setattr('app.product_materials_pipeline.extract_parts',
                            lambda content, mime, name: extraction(content, image=True))
        service.run(job['id'], user['id'])
        current = client.get('/api/products/DURABLE/materials').json()['job']
        assert current['status'] == 'ready', current
        assert analyzer.calls == 1
        sources = {item['id']: item for item in current['sources']}
        assert sources['copy']['status'] == 'duplicate' and sources['copy']['duplicateOf'] == 'original'
        assert 'duplicateOf' not in sources['original']
        fragments = service.queue.fragments(job['id'], user['id'])
        assert all(item['state'] == 'superseded' for item in fragments if item['source_id'] == 'copy')
        assert next(item for item in fragments if item['id'] == 'legacy-original')['state'] == 'done'
        assert sources['original']['version'] == 'legacy-original-original'


def test_failed_manifest_commit_keeps_paid_units_without_opening_another_upgrade(environment, monkeypatch):
    config, google, db = environment
    drive, analyzer = UpgradeDrive(), Analyzer()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job = seed(client, google, db, config, drive, old_state='done')
        service.analyzer = analyzer
        material = extraction(drive.data)
        material['fragments'].append({'key': 'new-details',
            'segments': [{'locator': 'Línea 2', 'text': 'Color: azul'}]})
        material['coverage']['units'] = 2
        monkeypatch.setattr('app.product_materials_pipeline.extract_parts',
                            lambda content, mime, name: deepcopy(material))
        real_put = service.queue.put_fragments
        attempts = []

        def fail_first_manifest(*args):
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError('Injected transaction failure before manifest persistence')
            return real_put(*args)

        monkeypatch.setattr(service.queue, 'put_fragments', fail_first_manifest)
        service.run(job['id'], user['id'])
        failed = client.get('/api/products/DURABLE/materials').json()['job']
        source = failed['sources'][0]
        assert source['status'] == 'error'
        assert source['readerVersion'] == 'drive-segments-v1'
        assert not source['readComplete']
        assert analyzer.calls == 0
        from app.product_materials_upgrade import upgrade_eligible
        assert upgrade_eligible(source)
        assert [item['id'] for item in service.queue.fragments(job['id'], user['id'])] == ['legacy-original']
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id'] + '/upgrade-readers'
        retry = client.post(endpoint, json=control_body('upgrade_readers'))
        assert retry.status_code == 409 and retry.json()['error'] == 'materials_scope_conflict'
        service.run(job['id'], user['id'])
        complete = client.get('/api/products/DURABLE/materials').json()['job']
        assert complete == failed and analyzer.calls == 0
        fragments = service.queue.fragments(job['id'], user['id'])
        assert len(fragments) == 1 and fragments[0]['state'] == 'done'
        assert next(item for item in fragments if item['id'] == 'legacy-original')['result']['observations']


@pytest.mark.parametrize('mime,reader,profile,complete,changed,expected', [
    ('application/pdf', 'drive-segments-v2', None, True, False, True),
    ('application/pdf', 'drive-segments-v2', 'vectors-v1', True, False, False),
    ('application/pdf', 'drive-segments-v2', 'vectors-v1', False, False, True),
    ('application/pdf', 'drive-segments-v2', None, True, True, False),
    ('image/png', 'drive-segments-v2', None, True, False, False),
    ('application/pdf', 'drive-segments-v1', 'vectors-v1', True, False, True),
])
def test_pdf_profile_upgrade_is_selective(mime, reader, profile, complete, changed, expected):
    from app.product_materials_upgrade import upgrade_eligible
    assert upgrade_eligible({'mimeType': mime, 'readerVersion': reader, 'readComplete': complete,
        'changed': changed, 'readingCoverage': {'pdfVisualProfile': profile}}) is expected


@pytest.mark.parametrize('fail_manifest', [False, True])
def test_pdf_same_v2_upgrade_preserves_fragments_and_calls_and_adds_only_new_visual(environment, monkeypatch, fail_manifest):
    from app.product_materials_upgrade import upgrade_eligible
    config, google, db = environment
    drive, analyzer = UpgradeDrive(), Analyzer()
    drive.children['folder'][0].update(name='A.pdf', mimeType='application/pdf')
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job = seed(client, google, db, config, drive)
        service.analyzer = analyzer
        material = extraction(drive.data)
        material['fragments'].append({'key': 'page-1-image', 'image': {'width': 10, 'height': 10},
            'segments': [{'locator': 'Página 1 · Imagen', 'text': 'Caja azul'}]})
        monkeypatch.setattr('app.product_materials_pipeline.extract_parts',
                            lambda content, mime, name: deepcopy(material))
        service.run(job['id'], user['id'])
        first = client.get('/api/products/DURABLE/materials').json()['job']
        assert first['status'] == 'ready' and analyzer.calls == 1
        assert first['sources'][0]['readerVersion'] == 'drive-segments-v2'
        assert upgrade_eligible(first['sources'][0])
        original_fragments = {item['id']: item for item in service.queue.fragments(job['id'], user['id'])}
        with db.connect() as c:
            original_calls = c.execute('SELECT id,state,result FROM product_material_calls WHERE job_id=%s ORDER BY id', (job['id'],)).fetchall()
        material['coverage']['pdfVisualProfile'] = 'vectors-v1'
        material['fragments'].append({'key': 'page-2-vector', 'image': {'width': 10, 'height': 10},
            'segments': [{'locator': 'Página 2 · Vector', 'text': 'Gráfico de embalaje'}]})
        endpoint = '/api/products/DURABLE/materials/jobs/' + job['id']
        upgrade = client.post(endpoint + '/upgrade-readers', json=control_body('upgrade_readers'))
        assert upgrade.status_code == 200, upgrade.text
        assert client.post(endpoint + '/pause', json={'revision': 1, 'requestId': str(uuid4())}).status_code == 200
        overlapping = client.post(endpoint + '/upgrade-readers', json=control_body('upgrade_readers'))
        assert overlapping.status_code == 409 and 'Ya hay una ampliación' in overlapping.json()['message']
        assert client.post(endpoint + '/resume', json={'revision': 1, 'requestId': str(uuid4())}).status_code == 200
        if fail_manifest:
            real_put = service.queue.put_fragments
            with monkeypatch.context() as fault:
                fault.setattr(service.queue, 'put_fragments', lambda *args: (_ for _ in ()).throw(RuntimeError('manifest unavailable')))
                service.run(job['id'], user['id'])
            failed = client.get('/api/products/DURABLE/materials').json()['job']
            assert failed['sources'][0]['status'] == 'error'
            assert failed['sources'][0]['readerVersion'] == 'drive-segments-v2'
            assert not failed['sources'][0]['readComplete'] and upgrade_eligible(failed['sources'][0])
            assert analyzer.calls == 1 and service.queue.put_fragments == real_put
            retry = client.post(endpoint + '/upgrade-readers', json=control_body('upgrade_readers'))
            assert retry.status_code == 409 and retry.json()['error'] == 'materials_scope_conflict'
            assert service.queue.fragments(job['id'], user['id']) == list(original_fragments.values())
            assert analyzer.calls == 1
            return
        service.run(job['id'], user['id'])
        complete = client.get('/api/products/DURABLE/materials').json()['job']
        assert complete['status'] == 'ready' and analyzer.calls == 2
        assert complete['sources'][0]['version'] == first['sources'][0]['version']
        assert complete['sources'][0]['readingCoverage']['pdfVisualProfile'] == 'vectors-v1'
        assert not upgrade_eligible(complete['sources'][0])
        fragments = {item['id']: item for item in service.queue.fragments(job['id'], user['id'])}
        assert len(fragments) == len(original_fragments) + 1
        for identifier, original in original_fragments.items():
            assert fragments[identifier] == original
        with db.connect() as c:
            calls = c.execute('SELECT id,state,result FROM product_material_calls WHERE job_id=%s ORDER BY id', (job['id'],)).fetchall()
        assert len(calls) == len(original_calls) + 1 and all(item in calls for item in original_calls)
        assert client.post(endpoint + '/upgrade-readers', json=control_body('upgrade_readers')).status_code == 409
        service.run(job['id'], user['id'])
        assert analyzer.calls == 2
