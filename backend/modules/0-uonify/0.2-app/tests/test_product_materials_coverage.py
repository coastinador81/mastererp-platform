"""Coverage is explicit; saturated units split and no global proposal ceiling discards data."""
import io
import json
from unittest.mock import patch
from uuid import uuid4
from psycopg.types.json import Jsonb
from openpyxl import Workbook
from app.drive_extract import XLSX
from app.drive_segments import extract_parts
from app.product_materials_analyzer import validate_output
from app.product_materials_queue import merge_proposals
from material_start_copy import start_body
from conftest import client_for
from test_uony import ready
from test_products import connect as connect_cloud
from test_google_cloud import Cloud
from test_product_materials import FolderDrive, connect_drive, run_queued


def proposal(index):
    return {'id': 'p_' + str(index), 'field': 'custom:field' + str(index), 'label': 'Atributo', 'value': str(index),
            'evidence': [{'sourceId': 'one', 'locator': '$.value', 'excerpt': '54'}], 'status': 'proposed'}


def test_global_proposals_are_not_capped_and_reviewed_values_are_not_replaced():
    previous = [proposal(index) for index in range(79)]
    previous[0].update(status='confirmed', confirmedValue='Valor confirmado')
    current = merge_proposals(previous, [proposal(index) for index in range(100)])
    assert len(current) == 100
    assert current[0]['status'] == 'confirmed' and current[0]['confirmedValue'] == 'Valor confirmado'


def test_saturated_fragment_splits_and_preserves_parent_and_child_proposals(environment):
    config, google, db = environment
    drive = FolderDrive()
    drive.children = {'folder': [{'id': 'one', 'name': 'Ficha.json', 'mimeType': 'application/json'}]}
    drive.files = lambda *args: {'files': drive.children['folder']}
    drive.content = lambda *args, **kwargs: (b'{"value":54,"detail":"Madera de haya"}', 'application/json', 'Ficha.json')
    class SaturatedAnalyzer:
        calls = 0
        def analyze(self, token, project, product, sources):
            self.calls += 1
            source = sources[0]
            count, start = (16, 79) if self.calls == 1 else (1, 93 + self.calls)
            proposals = [proposal(index) for index in range(start, start + count)]
            for item in proposals:
                item['evidence'] = [{'sourceId': 'one', **source['segments'][0]}]
            return {'proposals': proposals, 'coverageLimited': self.calls == 1,
                    'observations': {'one': 'Fragmento revisado.'}, 'usage': {'calls': 1, 'totalTokenCount': 100}}
    analyzer = SaturatedAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        client.post('/api/products', json={'sku': 'COVERAGE', 'name': 'Torre'})
        endpoint = '/api/products/COVERAGE/materials'
        started = client.post(endpoint + '/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'})).json()['job']
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET result=jsonb_set(result,'{proposals}',%s) WHERE id=%s",
                      (Jsonb([proposal(index) for index in range(79)]), started['id']))
        job = run_queued(client, db, endpoint)
        assert job['status'] == 'ready' and analyzer.calls == 3
        assert len(job['proposals']) == 97
        assert job['coverage']['fragmentsTotal'] == job['coverage']['fragmentsDone'] == 2
        assert job['coverage']['fragmentsPending'] == job['coverage']['fragmentsPartial'] == 0
        assert job['sources'][0]['status'] == 'analyzed'
        with db.connect() as c:
            fragments = c.execute('SELECT state,payload,result FROM product_material_fragments WHERE job_id=%s', (started['id'],)).fetchall()
        assert sorted(fragment['state'] for fragment in fragments) == ['done', 'done', 'split']
        assert len(next(fragment for fragment in fragments if fragment['state'] == 'split')['result']['proposals']) == 16


def test_invalid_candidates_remain_visible_as_review_work_per_fragment(environment):
    config, google, db = environment
    drive = FolderDrive()
    drive.children = {'folder': [{'id': 'one', 'name': 'Ficha.json', 'mimeType': 'application/json'}]}
    drive.files = lambda *args: {'files': drive.children['folder']}
    drive.content = lambda *args, **kwargs: (b'{"value":54}', 'application/json', 'Ficha.json')
    class EvidenceAnalyzer:
        def analyze(self, token, project, product, sources):
            return {'proposals': [proposal(0)], 'discardedProposalCount': 3,
                    'observations': {'one': 'Fuente revisada.'}, 'usage': {'calls': 1, 'totalTokenCount': 100}}
    with patch('app.product_materials.MaterialsAnalyzer', return_value=EvidenceAnalyzer()), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        client.post('/api/products', json={'sku': 'EVIDENCE', 'name': 'Torre'})
        endpoint = '/api/products/EVIDENCE/materials'
        client.post(endpoint + '/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'}))
        job = run_queued(client, db, endpoint)
        assert job['status'] == 'ready' and job['coverageLimited']
        assert job['sources'][0]['status'] == 'partial'
        resolution = job['resolution']
        assert resolution['technicalPendingCount'] == 1
        assert resolution['historicalRejectionCount'] == 3
        assert resolution['issues'][0]['action'] == 'repair_evidence'
        assert resolution['issues'][0]['sourceId'] == 'one'
        assert job['repairAvailable'] is False
        assert job['sources'][0]['resolutionSummary'] == {
            'technicalPendingCount': 1, 'historicalDiscardCount': 3}
        with db.connect() as c:
            stored = c.execute('SELECT result FROM product_material_fragments WHERE job_id=%s',
                               (job['id'],)).fetchone()['result']
        assert stored['discardedProposalCount'] == 3
        assert any('3 propuestas' in warning and 'evidencia' in warning for warning in stored['warnings'])
        assert job['coverage']['fragmentsPartial'] == 1 and job['coverage']['fragmentsPending'] == 0
        assert len(job['proposals']) == 1


def test_raw_batch_cap_is_recorded_even_when_validation_rejects_all_candidates():
    source = {'id': 'one', 'segments': [{'locator': '$.value', 'text': '54'}]}
    output = validate_output({'observations': [], 'proposals': [{'field': 'invalid'}] * 16}, [source])
    assert output['proposals'] == []
    assert output['discardedProposalCount'] == 16
    assert output['coverageLimited'] is True


def test_overlong_spreadsheet_cells_and_deep_json_are_read_in_full():
    book = Workbook()
    book.active.append(['Texto', 'x' * 2500])
    output = io.BytesIO()
    book.save(output)
    spreadsheet = extract_parts(output.getvalue(), XLSX, 'ficha.xlsx')
    assert spreadsheet['coverage']['complete'] and not spreadsheet['truncated']
    assert 'x' * 2500 in ''.join(segment['text'] for fragment in spreadsheet['fragments'] for segment in fragment['segments'])
    value = 'dato final'
    for _ in range(24):
        value = {'child': value}
    document = extract_parts(json.dumps(value).encode(), 'application/json', 'deep.json')
    assert document['coverage']['complete'] and not document['truncated']
    assert document['fragments'][0]['segments'][0]['text'] == '"dato final"'


def test_hybrid_image_citations_keep_exact_ocr_and_unique_visual_region():
    from app.product_materials_analyzer import validate_output
    source = {'id': 'hybrid', 'image': {'width': 3000}, 'visualLocator': 'Página 1 · Región 2',
              'segments': [{'locator': 'Página 1 · OCR 1', 'text': 'Modelo Basic Mini Bricks',
                            'method': 'ocr', 'observational': True}]}
    def result(locator, excerpt):
        return validate_output({'proposals': [{'field': 'custom:model', 'label': 'Modelo', 'value': 'Basic Mini Bricks',
            'evidence': [{'sourceId': 'hybrid', 'locator': locator, 'excerpt': excerpt}]}]}, [source])
    assert len(result('Página 1 · OCR 1', 'Basic Mini Bricks')['proposals']) == 1
    assert len(result('Página 1 · Región 2', 'Se observa Basic Mini Bricks')['proposals']) == 1
    assert not result('Imagen', 'Se observa Basic Mini Bricks')['proposals']
    assert not result('Página 2 · OCR 1', 'Basic Mini Bricks')['proposals']
    assert not result('Página 1 · OCR 1', 'Inventado')['proposals']
