import io
import json
import os
from uuid import uuid4
from unittest.mock import patch, Mock
import pytest
import requests
from PIL import Image
from openpyxl import Workbook
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from cryptography.fernet import Fernet
from app.drive_extract import extract, ExtractionError, XLSX
from app.drive_segments import FRAGMENT_CHARS
from app.product_materials import ProductMaterials
from app.product_materials_analyzer import validate_output, MaterialsAnalyzer, safe_diagnostics
from app.google_drive_provider import FOLDER, GoogleDriveProvider
from app.google_cloud_provider import CloudError
from material_start_copy import start_body, start_kwargs
from conftest import client_for, login
from test_uony import ready
from test_products import connect as connect_cloud
from test_google_cloud import Cloud


class FolderDrive(Cloud):
    def __init__(self):
        super().__init__()
        self.reads = []
        self.children = {
            'folder': [{'id': 'nested', 'name': 'Documentos', 'mimeType': FOLDER},
                       {'id': 'model', 'name': 'Diseño.blend', 'mimeType': 'application/octet-stream'},
                       {'id': 'shortcut', 'name': 'Otra carpeta', 'mimeType': 'application/vnd.google-apps.shortcut'}],
            'nested': [{'id': 'spec', 'name': 'Ficha.json', 'mimeType': 'application/json', 'modifiedTime': '2026-10-14T10:00:00Z'},
                       {'id': 'again', 'name': 'Ficha duplicada.json', 'mimeType': 'application/json'},
                       {'id': 'huge', 'name': 'Demasiado grande.png', 'mimeType': 'image/png', 'size': str(70 * 1024 * 1024)}]}
        self.data = json.dumps({'producto': 'Torre', 'piezas': 54, 'peso': None, 'estado': 'Diseño 3D; medidas nominales'}).encode()

    def metadata(self, token, identifier):
        if identifier in self.children:
            return {'id': identifier, 'name': 'Carpeta del producto', 'mimeType': FOLDER}
        return next(item for children in self.children.values() for item in children if item['id'] == identifier)

    def files(self, token, parent, page, search):
        assert not search
        entries = self.children[parent]
        return {'files': entries[:2] if not page else entries[2:], 'nextPageToken': 'page2' if not page else None}

    def content(self, token, identifier, max_bytes=None):
        self.reads.append((identifier, max_bytes))
        if identifier == 'model':
            return b'not-a-valid-blender-file', 'application/octet-stream', 'Diseño.blend'
        return self.data, 'application/json', 'Ficha.json'


class Analyzer:
    def __init__(self):
        self.calls = 0
        self.sources = []

    def analyze(self, token, project, product, sources):
        self.calls += 1
        self.sources.extend(sources)
        source = sources[0]
        proposals = [{'field': 'custom:piezas', 'label': 'Piezas (diseño)', 'value': '54 (diseño 3D)',
                      'evidence': [{'sourceId': source['id'], 'locator': '$.piezas', 'excerpt': '54'}]}] if any(
                          item['locator'] == '$.piezas' for item in source.get('segments', [])) else []
        return {**validate_output({'observations': [{'sourceId': item['id'], 'summary': 'Ficha de diseño con datos pendientes.'} for item in sources],
                                  'proposals': proposals}, sources),
                'usage': {'calls': 1, 'totalTokenCount': 400}}


def connect_drive(db, config):
    with db.connect() as c:
        user = c.execute('SELECT id FROM users').fetchone()['id']
        c.execute("INSERT INTO google_drive_connections(user_id,google_subject,email,refresh_encrypted,scope) VALUES(%s,'google-test-one','one@example.test',%s,'drive.readonly')",
                  (user, Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode()))


def run_queued(client, db, endpoint):
    job = client.get(endpoint).json()['job']
    assert job['status'] == 'queued', job
    with db.connect() as c:
        user_id = c.execute('SELECT user_id FROM product_material_jobs WHERE id=%s', (job['id'],)).fetchone()['user_id']
    client.app.state.materials.run(job['id'], user_id)
    return client.get(endpoint).json()['job']


def test_recursive_job_dedup_limits_provenance_replay_and_isolation(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        product = client.post('/api/products', json={'sku': 'MATERIALS', 'name': 'Torre'}).json()['product']
        endpoint = '/api/products/MATERIALS/materials'
        body = start_body({'requestId': str(uuid4()), 'revision': product['revision'], 'folderId': 'folder'})
        assert client.get(endpoint).json() == {'job': None, 'product': {'sku': 'MATERIALS', 'revision': 1}}
        assert client.post(endpoint + '/jobs', json=body, headers={'Origin': 'null'}).status_code == 403
        response = client.post(endpoint + '/jobs', json=body)
        assert response.status_code == 200, response.text
        job = run_queued(client, db, endpoint)
        assert job['status'] == 'ready', job
        assert job['processed'] == job['total'] == 5
        states = {source['id']: source['status'] for source in job['sources']}
        assert states['shortcut'] == 'skipped' and states['model'] == states['huge'] == 'error'
        assert next(source for source in job['sources'] if source['id'] == 'model').get('reason')
        assert sorted([states['spec'], states['again']]) == ['analyzed', 'duplicate']
        duplicate = next(source for source in job['sources'] if source['status'] == 'duplicate')
        assert states[duplicate['duplicateOf']] == 'analyzed'
        assert job['coverage']['fragmentsDone'] == 1 and job['coverage']['fragmentsPending'] == 0
        assert set(drive.reads) == {('spec', 64 * 1024 * 1024), ('again', 64 * 1024 * 1024), ('model', 64 * 1024 * 1024)}
        assert job['proposals'][0]['value'] == '54 (diseño 3D)'
        assert job['proposals'][0]['evidence'][0]['locator'] == '$.piezas'
        assert job['usage'] == {'calls': 1, 'totalTokenCount': 400}
        assert job['analysisModel'] == 'gemini-3.5-flash-lite' and job['analysisEffort'] == 'MINIMAL'
        assert client.get('/api/products').json()['products'][0] == product
        assert client.post(endpoint + '/jobs', json=body).json()['job'] == job
        assert analyzer.calls == 1
        assert client.post(endpoint + '/jobs', json={**body, 'folderId': 'nested'}).status_code == 409
        assert client.get(endpoint + '/jobs/' + job['id']).json()['job'] == job
        assert client.get(endpoint + '/jobs/not-an-id').status_code == 404
        google.subject, google.email = 'other', 'other@example.test'
        login(client, google)
        assert client.get(endpoint + '/jobs/' + job['id']).status_code == 404


def test_connections_revision_and_restart_are_explicit(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        client.post('/api/products', json={'sku': 'CHECK', 'name': 'Torre'})
        endpoint = '/api/products/CHECK/materials/jobs'
        body = start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'})
        error = client.post(endpoint, json=body)
        assert error.status_code == 409
        assert error.json()['connectionActions'] == [{'provider': 'drive', 'action': 'manage'}]
        connect_drive(db, config)
        assert client.post(endpoint, json=body).json()['connectionActions'] == [{'provider': 'cloud', 'action': 'manage'}]
        connect_cloud(db, config)
        assert client.post(endpoint, json={**body, 'revision': 2}).json()['error'] == 'product_conflict'
        service = ProductMaterials(config, db, drive, cloud, Analyzer())
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            first = service.start(c, user, 'CHECK', 1, 'folder', body['requestId'],
                                  **start_kwargs())
        service.recover()
        with db.connect() as c:
            recovered = service.get(c, user, 'CHECK')['job']
        assert recovered['id'] == first['id'] and recovered['status'] == 'queued'
        assert not recovered.get('error')
        assert service.queue.claim('worker-after-api-restart', first['id']) is not None
        assert drive.reads == []


@pytest.mark.parametrize('partial', [False, True])
def test_explicit_retry_reuses_successful_unchanged_sources_after_late_quota_error(environment, partial):
    config, google, db = environment
    drive, analyzer = FolderDrive(), Analyzer()
    drive.children = {'folder': [{'id': 'file' + str(index), 'name': str(index) + '.json', 'mimeType': 'application/json',
                                 'modifiedTime': '2026-10-14T10:00:00Z'} for index in range(3)]}
    drive.files = lambda token, parent, page, search: {'files': drive.children[parent]}
    def content(token, identifier, max_bytes=None):
        drive.reads.append(identifier)
        return json.dumps({'piezas': 54, 'identifier': identifier}).encode(), 'application/json', identifier + '.json'
    drive.content = content
    original_analyze = analyzer.analyze
    fail_second = True
    def analyze(*args):
        if fail_second and analyzer.calls == 1:
            raise CloudError('quota_exceeded')
        output = original_analyze(*args)
        if partial and fail_second:
            output['discardedProposalCount'] = 1
        return output
    analyzer.analyze = analyze
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        client.post('/api/products', json={'sku': 'RESUME', 'name': 'Torre'})
        endpoint = '/api/products/RESUME/materials'
        client.post(endpoint + '/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'}))
        failed = run_queued(client, db, endpoint)
        assert failed['status'] == 'error' and len(failed['proposals']) == 1
        assert sum(source['status'] == ('partial' if partial else 'analyzed') for source in failed['sources']) == 1
        assert failed['coverage']['fragmentsPending'] == 2
        fail_second = False
        drive.reads.clear()
        response = client.post(endpoint + '/jobs/' + failed['id'] + '/resume',
                               json={'requestId': str(uuid4()), 'revision': 1})
        assert response.status_code == 200, response.text
        resumed = run_queued(client, db, endpoint)
        assert resumed['status'] == 'ready' and resumed['id'] == failed['id']
        assert drive.reads == []  # Completed reads are durable even when a later provider call fails.
        assert analyzer.calls == 3 and resumed['usage']['calls'] == 4  # Three successes and one quota response.
        assert resumed['coverage']['fragmentsPending'] == 0
        assert sum(source['status'] == 'partial' for source in resumed['sources']) == int(partial)
        assert len(resumed['proposals'][0]['evidence']) == 3


def test_file_changed_since_discovery_is_not_used_as_evidence(environment):
    config, google, db = environment
    drive, analyzer = FolderDrive(), Analyzer()
    metadata = drive.metadata
    def changed(token, identifier):
        item = dict(metadata(token, identifier))
        if identifier == 'spec':
            item['modifiedTime'] = '2026-10-14T11:00:00Z'
        return item
    drive.metadata = changed
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        client.post('/api/products', json={'sku': 'CHANGED', 'name': 'Torre'})
        client.post('/api/products/CHANGED/materials/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'}))
        job = run_queued(client, db, '/api/products/CHANGED/materials')
        assert job['status'] == 'paused' and job['pauseReason'] == 'source_changed'
        assert not job['canResume']
        source = next(source for source in job['sources'] if source['id'] == 'spec')
        assert source['status'] == 'error' and 'cambió' in source['reason']
        assert all(evidence['sourceId'] != 'spec' for proposal in job['proposals'] for evidence in proposal['evidence'])


def test_documents_are_analyzed_before_images_and_each_fragment_is_independently_checkpointed(environment):
    config, google, db = environment
    drive, analyzer = FolderDrive(), Analyzer()
    drive.children = {'folder': [{'id': 'image' + str(index), 'name': str(index) + '.png', 'mimeType': 'image/png'} for index in range(5)] +
                       [{'id': 'spec', 'name': 'Ficha.json', 'mimeType': 'application/json'}]}
    drive.files = lambda token, parent, page, search: {'files': drive.children[parent]}
    def content(token, identifier, max_bytes=None):
        if identifier == 'spec':
            return drive.data, 'application/json', 'Ficha.json'
        output = io.BytesIO()
        Image.new('RGB', (8, 8), color=(int(identifier[-1]) + 1, 20, 30)).save(output, format='PNG')
        return output.getvalue(), 'image/png', identifier + '.png'
    drive.content = content
    groups, original_analyze = [], analyzer.analyze
    def analyze(*args):
        groups.append([source['id'] for source in args[-1]])
        return original_analyze(*args)
    analyzer.analyze = analyze
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        client.post('/api/products', json={'sku': 'ORDER', 'name': 'Torre'})
        client.post('/api/products/ORDER/materials/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'}))
        job = run_queued(client, db, '/api/products/ORDER/materials')
        assert job['status'] == 'ready'
        assert groups == [['spec'], ['image0'], ['image1'], ['image2'], ['image3'], ['image4']]
        assert job['coverage']['fragmentsDone'] == 6 and job['coverage']['fragmentsPending'] == 0
        assert {source['id'] for source in job['sources']} == {'spec', 'image0', 'image1', 'image2', 'image3', 'image4'}


def test_large_documents_are_fragmented_without_losing_characters(environment):
    config, google, db = environment
    drive, analyzer = FolderDrive(), Analyzer()
    sizes = [10000, 24000, 1000, 1000, 40000, 1000]
    drive.children = {'folder': [{'id': 'doc' + str(index), 'name': str(index) + '.json',
                                 'mimeType': 'application/json'} for index in range(len(sizes))]}
    drive.files = lambda token, parent, page, search: {'files': drive.children[parent]}
    def content(token, identifier, max_bytes=None):
        data = {'piezas': 54, 'contenido': 'x' * sizes[int(identifier[-1])], 'id': identifier}
        return json.dumps(data).encode(), 'application/json', identifier + '.json'
    drive.content = content
    groups, original_analyze = [], analyzer.analyze
    def analyze(*args):
        sources = args[-1]
        groups.append([source['id'] for source in sources])
        total = sum(len(segment['text']) for source in sources for segment in source['segments'])
        assert len(sources) == 1 and total <= FRAGMENT_CHARS
        return original_analyze(*args)
    analyzer.analyze = analyze
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        client.post('/api/products', json={'sku': 'BATCH', 'name': 'Torre'})
        client.post('/api/products/BATCH/materials/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'}))
        job = run_queued(client, db, '/api/products/BATCH/materials')
        assert job['status'] == 'ready'
        assert len(groups) > len(sizes)
        assert all(source['status'] == 'analyzed' for source in job['sources'])
        for index, size in enumerate(sizes):
            chunks = [segment['text'] for source in analyzer.sources if source['id'] == 'doc' + str(index)
                      for segment in source['segments'] if segment['locator'].startswith('$.contenido')]
            assert ''.join(chunks) == json.dumps('x' * size)
        assert job['coverage']['fragmentsDone'] == len(groups)


def test_failed_model_persists_error_without_product_mutation(environment):
    config, google, db = environment
    analyzer = Analyzer()
    def fail(*args):
        error = CloudError('quota_exceeded')
        error.diagnostics = {'stage': 'request', 'httpStatus': 429, 'raw': 'must-not-be-exposed'}
        raise error
    analyzer.analyze = fail
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        product = client.post('/api/products', json={'sku': 'FAIL', 'name': 'Torre'}).json()['product']
        client.post('/api/products/FAIL/materials/jobs', json=start_body({'requestId': str(uuid4()), 'revision': 1, 'folderId': 'folder'}))
        job = run_queued(client, db, '/api/products/FAIL/materials')
        assert job['status'] == 'error' and job['error']['code'] == 'quota_exceeded'
        assert job['error']['detail'] == {'stage': 'request', 'httpStatus': 429}
        assert job['proposals'] == [] and job['usage']['calls'] == 1
        assert job['canResume'] and job['coverage']['fragmentsPending'] == 1
        assert any(source['status'] == 'awaiting_analysis' for source in job['sources'])
        assert client.get('/api/products').json()['products'][0] == product


def test_json_xlsx_and_pdf_extraction_keep_actual_locators_and_pending_values():
    extracted = extract(b'{"fields":[{"label":"Peso","value":null,"status":"Pendiente"}]}', 'application/json', 'ficha.json')
    assert extracted['segments'][1] == {'locator': '$.fields[0].value', 'text': 'null'}
    assert extracted['segments'][2]['text'] == '"Pendiente"'
    book = Workbook()
    sheet = book.active
    sheet.title = 'Ficha'
    sheet.append(['Material', 'Madera'])
    sheet.append(['Peso', '=1+2'])
    output = io.BytesIO()
    book.save(output)
    extracted = extract(output.getvalue(), XLSX, 'ficha.xlsx')
    assert extracted['segments'][0] == {'locator': 'Ficha!fila 1', 'text': 'A: Material | B: Madera'}
    assert extracted['segments'][1]['text'] == 'A: Peso'
    assert 'fórmulas no se ejecutan' in extracted['warnings'][0]
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 30 200 Td (Piezas: 54 nominales) Tj ET')
    page[NameObject('/Contents')] = stream
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    output = io.BytesIO()
    writer.write(output)
    extracted = extract(output.getvalue(), 'application/pdf', 'ficha.pdf')
    assert extracted['segments'][0]['locator'] == 'Página 1'
    assert '54 nominales' in extracted['segments'][0]['text']


def test_hd_image_larger_than_twenty_mib_has_bounded_derivative_and_original_hash():
    original = Image.frombytes('RGB', (3000, 3000), os.urandom(3000 * 3000 * 3))
    output = io.BytesIO()
    original.save(output, format='PNG', compress_level=0)
    raw = output.getvalue()
    assert len(raw) > 20 * 1024 * 1024
    result = extract(raw, 'image/png', 'HD.png')
    assert result['image']['width'] == result['image']['height'] == 3000
    assert result['image']['analysisWidth'] == result['image']['analysisHeight'] == 1600
    assert result['image']['analysisBytes'] < 2 * 1024 * 1024
    assert result['bytes'] == len(raw) and len(result['sha256']) == 64
    assert result['inline']['mimeType'] == 'image/jpeg'


def test_citations_reject_foreign_or_invented_evidence():
    source = {'id': 'text', 'name': 'Ficha', 'segments': [{'locator': 'Página 1', 'text': 'Madera de haya; dimensiones nominales.'}]}
    base = {'field': 'custom:material', 'label': 'Material', 'value': 'Haya', 'evidence': [{'sourceId': 'text', 'locator': 'Página 1', 'excerpt': 'Madera de haya'}]}
    invalid = [{'sourceId': 'other', 'locator': 'Página 1', 'excerpt': 'Madera de haya'},
               {'sourceId': 'text', 'locator': 'Página 2', 'excerpt': 'Madera de haya'},
               {'sourceId': 'text', 'locator': 'Página 1', 'excerpt': 'Certificado CE'}]
    result = validate_output({'proposals': [base] + [{**base, 'evidence': [evidence]} for evidence in invalid]}, [source])
    assert len(result['proposals']) == 1
    assert result['proposals'][0]['status'] == 'proposed'


def test_truncation_is_visible_and_scanned_pdf_is_not_claimed_as_read():
    result = extract(('x' * 50000).encode(), 'text/plain', 'large.txt')
    assert result['truncated'] and len(result['segments'][0]['text']) == 48000
    assert any('Lectura parcial' in item for item in result['warnings'])
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    output = io.BytesIO()
    writer.write(output)
    with pytest.raises(ExtractionError, match='páginas como imágenes'):
        extract(output.getvalue(), 'application/pdf', 'scanned.pdf')


def test_drive_default_limit_remains_twenty_mib_and_explicit_analysis_is_bounded(environment):
    config, _, _ = environment
    provider = GoogleDriveProvider(config)
    provider.metadata = lambda *args: {'name': 'HD.png', 'mimeType': 'image/png', 'size': str(21 * 1024 * 1024)}
    with pytest.raises(CloudError) as error:
        provider.content('fixture', 'image')
    assert error.value.code == 'file_too_large'
    with pytest.raises(CloudError):
        provider.content('fixture', 'image', max_bytes=65 * 1024 * 1024)


@pytest.mark.parametrize('finish,text', [('MAX_TOKENS', '{"proposals":['), ('STOP', 'invalid json')])
def test_analyzer_preserves_billable_usage_when_response_cannot_be_used(finish, text):
    response = Mock(status_code=200)
    response.json.return_value = {'usageMetadata': {'totalTokenCount': 2468},
                                  'candidates': [{'finishReason': finish, 'content': {'parts': [{'text': text}]}}]}
    with patch('app.product_materials_analyzer.requests.post', return_value=response):
        with pytest.raises(CloudError) as caught:
            MaterialsAnalyzer().analyze('fixture', 'project-fixture', {'name': 'Torre'}, [])
    assert caught.value.code == 'invalid_response'
    assert caught.value.usage == {'calls': 1, 'totalTokenCount': 2468}
    expected = {'stage': 'finish_reason' if finish == 'MAX_TOKENS' else 'output_json',
                'httpStatus': 200, 'finishReason': finish}
    if finish == 'STOP':
        expected['reason'] = 'invalid_json'
    assert caught.value.diagnostics == expected


@pytest.mark.parametrize('count', [None, {}, -1, True, 'not-a-count'])
def test_analyzer_invalid_usage_metadata_does_not_hide_original_response_error(count):
    response = Mock(status_code=200)
    response.json.return_value = {'usageMetadata': {'totalTokenCount': count},
                                  'candidates': [{'finishReason': 'MAX_TOKENS'}]}
    with patch('app.product_materials_analyzer.requests.post', return_value=response):
        with pytest.raises(CloudError) as caught:
            MaterialsAnalyzer().analyze('fixture', 'project-fixture', {}, [])
    assert caught.value.code == 'invalid_response'
    assert caught.value.usage == {'calls': 1, 'totalTokenCount': 0, 'unconfirmedCalls': 1}


def test_analysis_uses_bounded_response_schema_and_no_raw_diagnostics():
    response = Mock(status_code=200)
    response.json.return_value = {'usageMetadata': {'totalTokenCount': 20},
        'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps({
            'observations': [{'sourceId': 'one', 'summary': 'Texto revisado.'}], 'proposals': []})}]}}]}
    source = {'id': 'one', 'name': 'Ficha', 'segments': [{'locator': 'Línea 1', 'text': 'Ficha del producto'}]}
    with patch('app.product_materials_analyzer.requests.post', return_value=response) as post:
        result = MaterialsAnalyzer().analyze('fixture', 'project-fixture', {}, [source])
    schema = post.call_args.kwargs['json']['generationConfig']['responseSchema']
    config = post.call_args.kwargs['json']['generationConfig']
    assert post.call_args.args[0].endswith('/models/gemini-3.5-flash-lite:generateContent')
    assert config['thinkingConfig'] == {'thinkingLevel': 'MINIMAL'}
    assert config['maxOutputTokens'] == 8192
    assert schema['required'] == ['observations', 'proposals']
    assert schema['properties']['observations']['maxItems'] == 1
    proposals = schema['properties']['proposals']
    assert proposals['maxItems'] == 16
    assert proposals['items']['properties']['evidence']['maxItems'] == 2
    source_field = proposals['items']['properties']['evidence']['items']['properties']['evidenceRef']
    assert source_field['type'] == 'STRING' and source_field['enum'] == ['e0']
    assert '"one"' not in json.dumps(schema)
    assert result['observations'] == {'one': 'Texto revisado.'}
    assert post.call_args.kwargs['timeout'] == (10, 180)
    assert safe_diagnostics({'stage': [], 'finishReason': {'private': 'value'}, 'httpStatus': True, 'raw': 'private'}) == {}


@pytest.mark.parametrize('exception,code,reason', [
    (requests.ReadTimeout('private endpoint and token'), 'analysis_timeout', 'timeout'),
    (requests.ConnectTimeout('private endpoint and token'), 'analysis_timeout', 'timeout'),
    (requests.ConnectionError('private endpoint and token'), 'google_unavailable', 'network')])
def test_timeout_and_network_errors_are_not_mislabelled_invalid_json(exception, code, reason):
    with patch('app.product_materials_analyzer.requests.post', side_effect=exception):
        with pytest.raises(CloudError) as caught:
            MaterialsAnalyzer().analyze('fixture', 'project-fixture', {}, [])
    assert caught.value.code == code
    assert caught.value.diagnostics == {'stage': 'request', 'reason': reason}
    assert caught.value.usage == {'calls': 1, 'totalTokenCount': 0, 'unconfirmedCalls': 1}
    assert 'private' not in str(caught.value.diagnostics)


def test_provider_400_is_a_request_configuration_error_not_a_connection_error():
    response = Mock(status_code=400)
    with patch('app.product_materials_analyzer.requests.post', return_value=response):
        with pytest.raises(CloudError) as caught:
            MaterialsAnalyzer().analyze('fixture', 'project-fixture', {}, [])
    assert caught.value.code == 'analysis_request_invalid'
    assert caught.value.diagnostics == {'stage': 'request', 'httpStatus': 400}
    assert caught.value.usage['unconfirmedCalls'] == 1
