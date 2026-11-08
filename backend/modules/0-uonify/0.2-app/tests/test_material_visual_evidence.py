"""DATA-12: la región y el método del original determinan el tipo de respaldo."""
from io import BytesIO
import pytest
from openpyxl import Workbook
from app.product_materials_facts import consolidate_proposals
from app.drive_extract import XLSX
from app.drive_segments import extract_parts

REGION = {'page': 2, 'bbox': [120, 80, 320, 160], 'coordinateSpace': 'pixels',
          'width': 1200, 'height': 1800, 'origin': 'top-left'}


def run(segment=None, evidence=None, payload=None, source=None, label='Marca', value='UONIFY'):
    record = {'id': 's', 'name': 'pack.pdf', 'version': 'v2', **(source or {})}
    fragment = {'id': 'f', 'source_id': 's', 'version': 'v2', 'payload': payload or {'segments': [segment]}}
    proposal = {'id': 'p', 'field': 'custom:field', 'label': label, 'value': value, 'status': 'proposed',
                'evidence': [evidence or {'sourceId': 's', 'locator': segment['locator'], 'excerpt': segment['text']}]}
    return consolidate_proposals([proposal], [record], [fragment])['proposals'][0]


def test_ocr_keeps_exact_coordinates_without_promoting_it_to_documentary_fact():
    fact = run(segment={'locator': 'Página 2 · OCR 5', 'text': 'Marca: UONIFY',
                        'method': 'ocr', 'confidence': 92.5, 'region': REGION, 'observational': True})
    assert fact['supportStatus'] == 'needs_review'
    assert fact['claimType'] == 'visual_observation'
    assert fact['evidence'][0]['region'] == REGION
    assert fact['evidence'][0]['confidence'] == 92.5
    assert fact['supportReasons'][0]['code'] == 'ocr_pending'


def test_native_pdf_text_keeps_documentary_support_even_with_image_in_same_fragment():
    fact = run(payload={'image': {'width': 1200}, 'segments': [{'locator': 'Página 2', 'text': 'Marca: UONIFY', 'method': 'pdf_text', 'region': REGION}]},
               evidence={'sourceId': 's', 'locator': 'Página 2', 'excerpt': 'Marca: UONIFY'})
    assert fact['supportStatus'] == 'supported'
    assert fact['claimType'] == 'declared'
    assert fact['evidence'][0]['region'] == REGION


def test_model_cannot_replace_reader_coordinates_or_confidence():
    fact = run(segment={'locator': 'OCR 1', 'text': 'Marca: UONIFY', 'method': 'ocr', 'region': REGION, 'confidence': 40},
               evidence={'sourceId': 's', 'locator': 'OCR 1', 'excerpt': 'Marca: UONIFY', 'region': {'page': 100}, 'confidence': 100})
    assert fact['evidence'][0]['region'] == REGION
    assert fact['evidence'][0]['confidence'] == 40


def test_barcode_decoder_proves_observation_not_ownership():
    fact = run(label='EAN', value='8435833200006', segment={'locator': 'Página 2 · Código 1', 'text': 'EAN-13: 8435833200006',
               'method': 'barcode', 'format': 'EAN-13', 'structureValid': True, 'region': REGION})
    assert fact['supportStatus'] == 'needs_review'
    assert fact['evidence'][0]['structureValid'] is True
    assert fact['supportReasons'][0]['code'] == 'barcode_observed'


def test_visual_region_uses_exact_locator_and_never_generic_first_image():
    sources = [{'id': 's', 'name': 'pack.pdf', 'version': 'v2'}]
    fragments = [{'id': f'f{i}', 'source_id': 's', 'version': 'v2', 'payload': {'image': {'width': 1200},
                 'visualLocator': f'Imagen · página {i}', 'region': {**REGION, 'page': i}}} for i in (1, 2)]
    proposals = [{'id': key, 'field': 'brand', 'label': 'Marca', 'value': 'UONIFY', 'evidence': [
        {'sourceId': 's', 'locator': locator, 'excerpt': 'Marca UONIFY'}]} for key, locator in [('exact', 'Imagen · página 2'), ('generic', 'Imagen')]]
    result = consolidate_proposals(proposals, sources, fragments)
    visual = next(f for f in result['proposals'] if f['claimType'] == 'visual_observation')
    assert visual['evidence'][0]['fragmentId'] == 'f2'
    assert visual['evidence'][0]['region']['page'] == 2
    assert any(r['code'] == 'citation_missing' and r['proposalId'] == 'generic' for r in result['rejections'])


def test_blender_object_dimensions_stay_nominal_and_out_of_commercial_facts():
    fact = run(label='Pieza · largo', value='75 mm', segment={'locator': 'Blender · Objeto Bloque · Geometría nominal', 'text': 'Pieza largo: 75 mm'},
               source={'name': 'tower.blend', 'readerMetadata': {'format': 'blend'}})
    assert fact['supportStatus'] == 'supported'
    assert fact['channel'] == 'production'
    assert fact['claimType'] == 'nominal'
    assert fact['scope'] == 'asset:s:Blender · Objeto Bloque'
    assert fact['reviewable'] is False


def test_formula_cached_value_is_not_presented_as_current_verified_value():
    fact = run(label='Número de piezas', value='54', segment={'locator': 'Hoja 1!Fila 2',
               'text': 'Número de piezas: 54; fórmula: =SUM(A1:A54); valor guardado: 54; no recalculado'})
    assert fact['supportStatus'] == 'needs_review'
    assert fact['supportReasons'][0]['code'] == 'formula_uncertain'


def test_old_visual_region_is_rejected_when_its_source_version_changed():
    sources = [{'id': 's', 'name': 'pack.png', 'version': 'v2'}]
    fragments = [{'id': 'f', 'source_id': 's', 'version': 'v1', 'payload': {'image': {'width': 1200}}}]
    proposals = [{'id': 'p', 'field': 'brand', 'label': 'Marca', 'value': 'UONIFY', 'evidence': [
        {'sourceId': 's', 'locator': 'Imagen', 'excerpt': 'Marca UONIFY'}]}]
    result = consolidate_proposals(proposals, sources, fragments)
    assert result['proposals'][0]['supportStatus'] == 'unsupported'
    assert result['rejections'][0]['code'] == 'source_version_changed'


def test_formula_operands_without_cached_result_cannot_become_product_facts():
    fact = run(label='Número de piezas', value='54', segment={'locator': 'Producto!fila 2',
               'text': 'A: Número de piezas | B: [Fórmula sin valor guardado; pendiente de cálculo en la fuente] [fórmula: =SUM(A1:A54); caché: missing; no recalculada]'},
               source={'readingCoverage': {'formulaEvidence': [{'locator': 'Producto!B2', 'rowLocator': 'Producto!fila 2',
                   'formula': '=SUM(A1:A54)', 'cachedValue': None, 'cacheStatus': 'missing', 'freshness': 'unknown', 'executed': False}]}})
    assert fact['supportStatus'] == 'unsupported'
    assert fact['reviewable'] is False


def test_formula_metadata_is_kept_with_its_exact_row_and_cached_value():
    formula = {'locator': 'Producto!B2', 'rowLocator': 'Producto!fila 2', 'formula': '=A1*2',
               'cachedValue': 54, 'cacheStatus': 'cached_unverified', 'freshness': 'unknown', 'executed': False}
    fact = run(label='Número de piezas', value='54', segment={'locator': 'Producto!fila 2',
               'text': 'A: Número de piezas | B: 54 [fórmula: =A1*2; caché: cached_unverified; no recalculada]'},
               source={'readingCoverage': {'formulaEvidence': [formula]}})
    assert fact['supportStatus'] == 'needs_review'
    assert fact['evidence'][0]['formulaEvidence'] == [formula]


def test_barcode_decoder_metadata_survives_exact_citation():
    barcode = {'value': '8435833200006', 'format': 'EAN-13', 'structureValid': True, 'decoded': True, 'region': REGION}
    fact = run(label='EAN', value='8435833200006', segment={'locator': 'Código 1', 'text': 'EAN-13: 8435833200006',
               'method': 'barcode', 'barcode': barcode, 'region': REGION})
    assert fact['evidence'][0]['barcode'] == barcode
    assert fact['supportStatus'] == 'needs_review'


def test_nested_blender_file_keeps_native_asset_scope_inside_zip():
    fact = run(label='Pieza · largo', value='75 mm', segment={
        'locator': 'escenas/tower.blend · Blender · Objeto Bloque · Geometría nominal', 'text': 'Pieza largo: 75 mm'},
        source={'name': 'recursos.zip'})
    assert fact['channel'] == 'production'
    assert fact['claimType'] == 'nominal'
    assert fact['reviewable'] is False


def test_chart_cache_does_not_become_verified_documentary_measurement():
    fact = run(label='Número de piezas', value='54', segment={
        'locator': 'xl/charts/chart1.xml · Serie 1', 'text': 'Caché de gráfico sin recalcular: 54',
        'method': 'chart_cache', 'observational': True})
    assert fact['supportStatus'] == 'needs_review'
    assert fact['claimType'] == 'visual_observation'


@pytest.mark.parametrize('prefix', ['', 'x' * 6100])
@pytest.mark.parametrize('quote', ['Número de piezas: 54', 'complete_segment'])
def test_long_formula_without_cache_never_proposes_its_operand_as_a_result(prefix, quote):
    workbook = Workbook()
    workbook.active.title = 'Producto'
    workbook.active['A1'] = '="' + prefix + 'Número de piezas: 54' + 'x' * 6100 + '"'
    content = BytesIO()
    workbook.save(content)
    extracted = extract_parts(content.getvalue(), XLSX, 'Ficha.xlsx')
    fragments = [{'id': part['key'], 'source_id': 's', 'version': 'v1', 'payload': part}
                 for part in extracted['fragments']]
    segment = next(segment for part in extracted['fragments'] for segment in part['segments']
                   if 'Número de piezas: 54' in segment['text'])
    assert segment['formulaEvidence'][0]['cacheStatus'] == 'missing'
    proposal = {'id': 'operand', 'field': 'custom:numero_piezas', 'label': 'Número de piezas',
                'value': '54', 'evidence': [{'sourceId': 's', 'locator': segment['locator'],
                   'excerpt': segment['text'] if quote == 'complete_segment' else quote}]}
    facts = consolidate_proposals([proposal], [{'id': 's', 'name': 'Ficha.xlsx', 'version': 'v1',
                                   'readingCoverage': extracted['coverage']}], fragments)
    assert facts['proposals'][0]['supportStatus'] == 'unsupported'
    assert facts['proposals'][0]['reviewable'] is False
