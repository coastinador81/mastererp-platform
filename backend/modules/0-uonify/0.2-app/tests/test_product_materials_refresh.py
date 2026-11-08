"""Selective replacement is local, atomic and preserves paid history and decisions."""
from copy import deepcopy
from hashlib import sha256
import json
from uuid import uuid4
import pytest
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from app.drive_segments import extract_parts
from app.drive_extract import ExtractionError
from app.product_materials_pipeline import source_version
from app.product_materials_refresh import apply_verified_refresh, product_field_changes, verify_equivalence
from app.product_materials_refresh_extract import prepare_replacement
from app.product_materials_facts import consolidate_proposals
from app.product_materials_values import value_supported
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials import FolderDrive
from test_product_materials_durable import prepare


def documents():
    old = {'revision': 1, 'fields': [
        {'id': 'dimensions.item.width', 'label': 'Pieza · ancho', 'value': 25, 'unit': 'mm',
         'status': 'Diseño 3D', 'note': 'Dimensión nominal, pendiente de validación.'},
        {'id': 'material', 'label': 'Material', 'value': 'Madera', 'unit': '',
         'status': 'Declarado', 'note': ''},
        {'id': 'weight', 'label': 'Peso', 'value': None, 'unit': 'g', 'status': 'Pendiente'}]}
    new = deepcopy(old)
    new['revision'] = 2
    new['fields'][0].update(value=2.5, unit='cm', status='Confirmado por el dueño', note='Medida definitiva.')
    return [json.dumps(doc, ensure_ascii=False).encode() for doc in (old, new)]


def replacement(content, source_id='spec', name='Ficha.json', mime='application/json'):
    metadata = {'id': source_id, 'name': name, 'mimeType': mime,
                'size': str(len(content)), 'modifiedTime': '2026-10-15T11:00:00Z'}
    return {'sourceId': source_id, 'content': content, 'name': name, 'mimeType': mime,
            'metadata': metadata, 'allowedMetadataPaths': ['$.revision']}


def authorization():
    return {'statement': 'El dueño confirma la medida definitiva y autoriza sustituir la ficha.',
            'fieldIds': ['dimensions.item.width'], 'affectedAttributes': ['item_dimensions']}


def seed(service, user, row, content, db):
    source = {**replacement(content)['metadata'], 'modifiedTime': '2026-10-14T10:00:00Z',
              'sha256': sha256(content).hexdigest(), 'readComplete': True, 'status': 'read',
              'readingCoverage': {'complete': True}}
    source['version'] = source_version(source) + ':' + source['sha256']
    queue = service.queue
    args = row['id'], user['id'], row['lease_token']
    queue.save_source(*args, source, source['version'])
    parts = extract_parts(content, 'application/json', 'Ficha.json')['fragments']
    fragments = [{'id': 'old-' + str(i), 'sourceId': 'spec', 'version': source['version'],
        'state': 'done', 'locator': part['segments'][0]['locator'],
        'payload': {**part, 'id': 'spec'}, 'result': {'observations': {'spec': 'Lectura anterior'}}}
        for i, part in enumerate(parts)]
    queue.put_fragments(*args, fragments)
    candidate = {'id': 'old-width', 'field': 'custom:pieza_ancho', 'label': 'Pieza · ancho', 'value': '25 mm',
                 'status': 'proposed', 'evidence': [{'sourceId': 'spec', 'sourceVersion': source['version'],
                                                   'locator': '$.fields[0].value', 'excerpt': '25'}]}
    facts = {'version': 1, **consolidate_proposals([candidate], [source], fragments)}
    facts['proposals'][0].update(status='confirmed', confirmedValue='25 mm', confirmationOrigin='user_reviewed')
    for i in range(39):
        facts['proposals'].append({'id': 'confirmed-' + str(i), 'canonicalField': 'custom:kept_' + str(i),
            'field': 'custom:kept_' + str(i), 'label': 'Conservado ' + str(i), 'value': str(i),
            'status': 'confirmed', 'confirmedValue': str(i), 'confirmationOrigin': 'user_reviewed',
            'evidence': [], 'channel': 'product', 'scope': 'product', 'claimType': 'declared'})
    call_id = queue.reserve_call(*args, ['old-0'])
    queue.finish_call(*args, call_id, {'calls': 1, 'totalTokenCount': 123}, result={'paid': True})
    queue.checkpoint(*args, {'sources': [source], 'facts': facts, 'proposals': [candidate],
                             'operation': 'analysis', 'stage': 'ready'}, 'ready')
    return source, facts


def run(service, db, user, job, item, request_id=None, auth=None, callback=None, revision=1):
    with db.connect() as c:
        return apply_verified_refresh(service, c, user, 'DURABLE', job['id'], revision,
            request_id or uuid4(), [item], auth or authorization(),
            verify_source=callback or (lambda _user, _id: item['metadata']), extract=extract_parts)


def test_replacement_archives_all_sources_preserves_40_decisions_and_paid_calls(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('seed')
        old, new = documents()
        source, facts = seed(service, user, row, old, db)
        item = {**replacement(new), 'expectedVersion': source['version'], 'expectedSha256': source['sha256']}
        request_id = uuid4()
        with db.connect() as c:
            before_calls = c.execute('SELECT * FROM product_material_calls').fetchall()
        summary = run(service, db, user, job, item, request_id)
        assert summary['continuitySafe'] and summary['changedFieldIds'] == ['dimensions.item.width']
        assert summary['previousMaterialSignature'] != summary['currentMaterialSignature']
        assert run(service, db, user, job, item, request_id) == summary
        with db.connect() as c:
            history = c.execute('SELECT * FROM product_material_refreshes').fetchall()
            current = service.get(c, user, 'DURABLE', job['id'])['job']
            assert c.execute('SELECT * FROM product_material_calls').fetchall() == before_calls
            assert c.execute('SELECT revision FROM products').fetchone()['revision'] == 1
            assert len(history) == 1
            assert history[0]['manifest']['version'] == 1
            assert history[0]['manifest']['fragmentsBefore'][0]['state'] == 'done'
            assert history[0]['manifest']['sourcesBefore'] == [source]
            assert c.execute("SELECT state FROM product_material_fragments WHERE id='old-0'").fetchone()['state'] == 'superseded'
        confirmed = [p for p in current['facts']['proposals'] if p['status'] == 'confirmed']
        assert len(confirmed) == 40
        for original in facts['proposals']:
            updated = next(p for p in confirmed if p['id'] == original['id'])
            assert {k: v for k, v in updated.items() if k not in ('supersededByRefresh', 'reviewable', 'historicalEvidence')} == {
                k: v for k, v in original.items() if k != 'reviewable'}
        new_fact = next(p for p in current['facts']['proposals'] if p.get('origin') == 'documentary_refresh')
        assert new_fact['status'] == 'proposed' and new_fact['claimType'] == 'declared'
        assert new_fact['supportStatus'] == 'supported' and new_fact['value'] == '25 mm'
        assert new_fact['evidence'][0]['sourceVersion'] != source['version']
        assert current['resolution']['technicalPendingCount'] == 0


@pytest.mark.parametrize('failure', ['metadata', 'race', 'revision', 'stored_version', 'unauthorized_field'])
def test_conflicts_leave_every_source_fragment_and_decision_unchanged(environment, failure):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('seed')
        old, new = documents()
        source, _ = seed(service, user, row, old, db)
        if failure == 'unauthorized_field':
            document = json.loads(new); document['fields'][1]['value'] = 'Metal'
            new = json.dumps(document).encode()
        item = {**replacement(new), 'expectedVersion': source['version'], 'expectedSha256': source['sha256']}
        if failure == 'stored_version': item['expectedVersion'] = 'other-version'
        count = 0
        def verify(_user, _id):
            nonlocal count
            count += 1
            return {**item['metadata'], **({'modifiedTime': 'changed'} if failure == 'metadata' or failure == 'race' and count == 2 else {})}
        with db.connect() as c:
            before = c.execute('SELECT result FROM product_material_jobs').fetchone()['result']
        with pytest.raises((HTTPException, ExtractionError)):
            run(service, db, user, job, item, callback=verify, revision=2 if failure == 'revision' else 1)
        with db.connect() as c:
            assert c.execute('SELECT result FROM product_material_jobs').fetchone()['result'] == before
            assert c.execute('SELECT count(*) AS n FROM product_material_refreshes').fetchone()['n'] == 0
            assert c.execute('SELECT data FROM product_material_sources').fetchone()['data'] == source


def test_nonstructured_document_read_is_explicitly_not_semantically_reviewed():
    old = replacement(b'Ancho: 25 mm', name='Ficha.txt', mime='text/plain')['metadata']
    prepared = prepare_replacement(old, [], replacement(b'Ancho: 2.5 cm', name='Ficha.txt', mime='text/plain'),
                                   authorization(), extract=extract_parts)
    assert prepared['source']['readComplete']
    assert prepared['source']['semanticStatus'] == 'extraction_only'
    assert not prepared['continuitySafe'] and prepared['candidates'] == []
    assert all(f['result']['extractionOnly'] and f['state'] == 'partial' for f in prepared['fragments'])


@pytest.mark.parametrize('value,excerpt,context,expected', [
    ('25 mm', '2.5', '$.fields[0].unit: "cm"', True),
    ('25 mm', '2.5', '$.fields[0].unit: "mm"', False),
    ('2.5 cm', '25', '$.fields[0].unit: "mm"', True),
    ('25 mm', '2.5', '$.fields[0].unit: "cm"\n$.fields[0].unit: "mm"', False),
    ('246 × 174 × 54 mm', '"24,6 × 17,4 × 5,4"', '$.fields[0].unit: "cm"', True),
    ('25 mm', '2.5', '$.fields[0].unit: "kg"', False),
])
def test_json_sibling_units_are_compared_after_exact_conversion(value, excerpt, context, expected):
    assert value_supported('custom:dimension', value, excerpt, context) is expected


def bindings_fixture():
    old, new = documents()
    source = replacement(old)['metadata']
    fragments = extract_parts(old, 'application/json', 'Ficha.json')['fragments']
    prepared = prepare_replacement(source, fragments, replacement(new), authorization(), extract=extract_parts)
    product = {'customFields': [{'id': 'width', 'name': 'Pieza · ancho · diseño nominal',
        'type': 'textarea', 'value': '25 mm', 'isConfirmed': True}]}
    auth = {**authorization(), 'customFieldBindings': [{'fieldId': 'dimensions.item.width', 'customFieldId': 'width'}]}
    return product, prepared, auth


def test_bindings_keep_identity_and_only_propose_exact_authorized_product_change():
    product, prepared, auth = bindings_fixture()
    result = product_field_changes(product, [prepared], auth)
    assert result == [{'id': 'width', 'fieldId': 'dimensions.item.width', 'before': product['customFields'][0],
        'after': {**product['customFields'][0], 'name': 'Pieza · ancho', 'value': '2.5 cm'}}]
    assert product['customFields'][0]['value'] == '25 mm'
    product['customFields'][0]['name'] = 'Pieza · alto · diseño nominal'
    with pytest.raises(HTTPException):
        product_field_changes(product, [prepared], auth)


@pytest.mark.parametrize('reverse', [False, True])
def test_conflicting_structured_field_ids_never_choose_last_document(reverse):
    product, prepared, auth = bindings_fixture()
    old, new = documents()
    new = json.loads(new); new['fields'][0]['value'] = 9
    second = prepare_replacement(replacement(old, 'other')['metadata'],
        extract_parts(old, 'application/json', 'Ficha.json')['fragments'],
        replacement(json.dumps(new).encode(), 'other'), authorization(), extract=extract_parts)
    with pytest.raises(HTTPException):
        product_field_changes(product, [second, prepared] if reverse else [prepared, second], auth)


def test_pdf_tuple_equivalence_requires_literal_axis_order_and_matching_axis_value():
    _, master, _ = bindings_fixture()
    body = 'Orden: largo × ancho × alto. Pieza 75 × 25 × 15 mm'
    derivative = replacement(body.encode(), 'pdf', 'Ficha.txt', 'text/plain')
    derivative['equivalence'] = {'sourceId': 'spec', 'statement': 'Mismo dato declarado.',
        'fieldIds': ['dimensions.item.width'], 'proofs': [{'fieldId': 'dimensions.item.width',
            'locator': 'Texto', 'excerpt': 'Pieza 75 × 25 × 15 mm', 'tupleIndex': 1,
            'axes': ['largo', 'ancho', 'alto'], 'axesLocator': 'Texto', 'axesExcerpt': 'Orden: largo × ancho × alto.'}]}
    prepared = prepare_replacement(derivative['metadata'], [], derivative, authorization(), extract=extract_parts)
    locator = prepared['fragments'][0]['payload']['segments'][0]['locator']
    derivative['equivalence']['proofs'][0].update(locator=locator, axesLocator=locator)
    verify_equivalence([master, prepared], [{}, derivative])
    assert prepared['continuitySafe']
    prepared['continuitySafe'] = True
    derivative['equivalence']['proofs'][0]['tupleIndex'] = 0
    verify_equivalence([master, prepared], [{}, derivative])
    assert not prepared['continuitySafe']


def test_snapshots_are_selective_and_unaffected_source_rows_are_untouched(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, _ = prepare(client, google, db, config)
        row = service.queue.claim('seed'); args = (row['id'], user['id'], row['lease_token'])
        service.queue.save_source(*args, {'id': 'untouched', 'name': 'Foto', 'version': 'v1'}, 'v1')
        service.queue.put_fragment(*args, {'id': 'untouched-fragment', 'sourceId': 'untouched', 'version': 'v1',
            'state': 'done', 'payload': {'segments': [{'locator': 'p1', 'text': 'Unchanged'}]}})
        old, new = documents(); source, _ = seed(service, user, row, old, db)
        with db.connect() as c:
            previous = c.execute("SELECT * FROM product_material_fragments WHERE source_id='untouched'").fetchone()
        item = {**replacement(new), 'expectedVersion': source['version'], 'expectedSha256': source['sha256']}
        run(service, db, user, job, item)
        with db.connect() as c:
            assert c.execute("SELECT * FROM product_material_fragments WHERE source_id='untouched'").fetchone() == previous
            manifest = c.execute('SELECT manifest FROM product_material_refreshes').fetchone()['manifest']
            assert manifest['selectiveSnapshots']
            assert {s['id'] for s in manifest['sourcesBefore']} == {'spec'}
            assert {f['source_id'] for f in manifest['fragmentsBefore']} == {'spec'}
            assert manifest['newFragmentHashes']
