"""OCR real atraviesa proceso, cola, almacenamiento y consolidación sin certificarse como texto nativo."""
from unittest.mock import patch
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials_pipeline import ManyFactsDrive, setup, get_job
from tests.test_drive_visual import label, content
from app.product_materials_analyzer import validate_output


class ImageDrive(ManyFactsDrive):
    def __init__(self):
        super().__init__(count=1, facts=0)
        binary = content(label('Basic Mini Bricks'))
        self.files_data['file-000'] = binary
        self.entries['file-000'].update(name='Producto.png', mimeType='image/png', size=str(len(binary)))

    def content(self, token, identifier, max_bytes=None):
        self.reads.append(identifier)
        return self.files_data[identifier], 'image/png', self.entries[identifier]['name']


class OCRAnalyzer:
    def analyze(self, token, project, product, sources):
        source = sources[0]
        evidence = next(segment for segment in source['segments'] if segment.get('method') == 'ocr')
        data = {'observations': [{'sourceId': source['id'], 'summary': 'Nombre impreso observado.'}],
                'proposals': [{'field': 'name', 'label': 'Nombre del producto', 'value': 'Basic Mini Bricks',
                               'evidence': [{'sourceId': source['id'], 'locator': evidence['locator'], 'excerpt': evidence['text']}]}]}
        return {**validate_output(data, sources), 'usage': {'calls': 1, 'totalTokenCount': 50}}


def test_real_ocr_source_and_region_survive_durable_pipeline_and_need_human_review(environment):
    config, google, db = environment
    drive, analyzer = ImageDrive(), OCRAnalyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), client_for(config, google, drive=drive, cloud=Cloud()) as client:
        job_id, user, _ = setup(client, google, db, config)
        client.app.state.materials.run(job_id, user)
        job = get_job(client)
        assert job['status'] == 'ready', job.get('error')
        source = job['sources'][0]
        assert source['readerVersion'] == 'drive-segments-v2'
        assert source['readingCoverage']['ocr']['units'] == 1
        assert source['readingCoverage']['ocr']['externalCalls'] == 0
        fact = next(fact for fact in job['facts']['proposals'] if fact['canonicalField'] == 'name')
        assert fact['supportStatus'] == 'needs_review'
        assert fact['supportReasons'][0]['code'] == 'ocr_pending'
        citation = fact['evidence'][0]
        assert citation['method'] == 'ocr' and citation['confidence'] >= 80
        assert citation['region']['frame'] == 1 and citation['region']['width'] == 1200
        with db.connect() as connection:
            stored = connection.execute('SELECT payload FROM product_material_fragments WHERE job_id=%s', (job_id,)).fetchone()['payload']
        assert stored['visualLocator'] == 'Imagen 1 · Vista completa'
        assert stored['segments'][0]['region'] == citation['region']
        assert client.get('/api/products').json()['products'][0]['name'] == 'Producto prueba'
