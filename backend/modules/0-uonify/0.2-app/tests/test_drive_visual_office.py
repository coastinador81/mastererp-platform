import io
from zipfile import ZipFile
import pytest
from PIL import Image
from openpyxl import Workbook
from openpyxl.drawing.image import Image as ExcelImage
from app.drive_extract import XLSX, DOCX, ExtractionError
from app.drive_segment_readers import read_xlsx
from app.drive_visual import extract_visuals
from tests.test_drive_visual import label, content


def workbook(cache=None, image=False, date_formula=False):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Producto'
    sheet.append(['Piezas', 'Total'])
    sheet.append([27, '=A2*2'])
    if date_formula:
        sheet['B2'].number_format = 'yyyy-mm-dd'
    if image:
        sheet.add_image(ExcelImage(io.BytesIO(content(label('EAN 8435833200006')))), 'C5')
    output = io.BytesIO(); book.save(output)
    if cache is None:
        return output.getvalue()
    changed = io.BytesIO()
    with ZipFile(output) as source, ZipFile(changed, 'w') as target:
        for item in source.infolist():
            binary = source.read(item.filename)
            if item.filename == 'xl/worksheets/sheet1.xml':
                binary = binary.replace(b'<v />', b'<v></v>').replace(b'<f>A2*2</f><v></v>', f'<f>A2*2</f><v>{cache}</v>'.encode())
            target.writestr(item, binary)
    return changed.getvalue()


def test_formula_expression_and_missing_cache_are_preserved_without_execution():
    coverage = {'complete': True}; warnings = []
    units = list(read_xlsx(workbook(), coverage, warnings))
    assert coverage['formulaCells'] == coverage['missingFormulaValues'] == 1
    evidence = coverage['formulaEvidence'][0]
    assert evidence['formula'] == '=A2*2' and evidence['cachedValue'] is None
    assert evidence['cacheStatus'] == 'missing' and evidence['executed'] is False
    assert evidence['locator'] == 'Producto!B2'
    assert '=A2*2' in units[-1][1] and 'sin valor guardado' in units[-1][1]
    assert coverage['complete'] is False


def test_cached_formula_is_present_but_freshness_not_claimed_or_recalculated():
    coverage = {'complete': True}; warnings = []
    units = list(read_xlsx(workbook(cache=999), coverage, warnings))
    assert coverage['formulaEvidence'][0]['cachedValue'] == 999
    assert coverage['formulaEvidence'][0]['freshness'] == 'unknown'
    assert coverage['uncertainFormulaValues'] == 1 and coverage['missingFormulaValues'] == 0
    assert '999' in units[-1][1] and '=A2*2' in units[-1][1]
    assert any('no se puede verificar' in warning for warning in warnings)


def test_embedded_excel_image_has_original_asset_and_anchor_evidence():
    coverage = {'complete': True}; warnings = []
    parts = extract_visuals(workbook(image=True), XLSX, 'ficha.xlsx', coverage, warnings)
    assert coverage['embeddedVisuals'] == 1 and coverage['embeddedVisualsPending'] is False
    assert parts[0]['region']['asset'] == 'xl/media/image1.png'
    placement = parts[0]['region']['placements'][0]
    assert placement['row'] == 5 and placement['col'] == 3
    assert any('8435833200006' in segment['text'] for part in parts for segment in part['segments'])
    assert parts[0]['visualLocator'].startswith('xl/media/image1.png')


def docx_with_image(external=False):
    output = io.BytesIO()
    with ZipFile(output, 'w') as archive:
        archive.writestr('word/document.xml', '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><a:blip r:embed="image1"/>
        </w:p></w:body></w:document>''')
        archive.writestr('word/_rels/document.xml.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
        ''' + ('''<Relationship Id="external1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
        Target="https://example.invalid/private.png" TargetMode="External"/>''' if external else '') + '</Relationships>')
        archive.writestr('word/media/image1.png', content(label('Material: madera')))
    return output.getvalue()


def test_embedded_word_image_text_is_ocr_observation_and_external_not_fetched():
    coverage = {'complete': True}; warnings = []
    parts = extract_visuals(docx_with_image(external=True), DOCX, 'ficha.docx', coverage, warnings)
    assert any('madera' in segment['text'] for part in parts for segment in part['segments'])
    assert parts[0]['region']['placements'][0]['documentPart'] == 'word/document.xml'
    assert coverage['externalRelationships'][0]['status'] == 'not_fetched'
    assert coverage['complete'] is False
    assert any('no se ejecutan' in warning for warning in warnings)


def test_unreadable_embedded_vector_has_explicit_pending_alternative():
    output = io.BytesIO()
    with ZipFile(output, 'w') as archive:
        archive.writestr('word/media/graphic.emf', b'not raster')
    coverage = {'complete': True}; warnings = []
    parts = extract_visuals(output.getvalue(), DOCX, 'word.docx', coverage, warnings)
    assert parts == [] and coverage['embeddedVisualsPending'] and not coverage['complete']
    assert coverage['visualUnits'][0]['status'] == 'unsupported_embedded_image'
    assert any('PNG o PDF' in warning for warning in warnings)


def test_date_formula_cache_serializes_and_retains_original_type():
    import json
    coverage = {'complete': True}
    list(read_xlsx(workbook(cache=44927, date_formula=True), coverage, []))
    evidence = coverage['formulaEvidence'][0]
    assert evidence['cachedValue'] == '2023-01-01T00:00:00'
    assert evidence['cachedType'] == 'datetime' and evidence['freshness'] == 'unknown'
    json.dumps(coverage)


def test_invalid_formula_infinity_is_json_safe_and_never_a_valid_numeric_value():
    import json
    coverage = {'complete': True}
    list(read_xlsx(workbook(cache='1E999'), coverage, []))
    assert coverage['invalidFormulaValues'] == 1 and coverage['complete'] is False
    assert coverage['formulaEvidence'][0]['cacheStatus'] == 'cached_error'
    json.dumps(coverage, allow_nan=False)
