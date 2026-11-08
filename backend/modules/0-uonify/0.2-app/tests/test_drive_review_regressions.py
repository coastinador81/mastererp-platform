"""Regresiones independientes: ninguna caché o región omitida aparenta estar verificada."""
import io
from xml.etree import ElementTree as ET
from zipfile import ZipFile
import pytest
from openpyxl import Workbook
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject, RectangleObject
from app.drive_extract import DOCX, XLSX
from app.drive_segments import extract_parts
from app.product_materials_facts import consolidate_proposals
from tests.test_drive_visual_office import docx_with_image
from tests.test_drive_visual import table_pdf


def long_formula_workbook():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Producto'
    sheet['A1'] = '="' + 'x' * 6100 + '"'
    sheet['A2'] = 'Material: madera'
    source = io.BytesIO(); workbook.save(source)
    output = io.BytesIO()
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    with ZipFile(source) as original, ZipFile(output, 'w') as target:
        for item in original.infolist():
            binary = original.read(item.filename)
            if item.filename == 'xl/worksheets/sheet1.xml':
                xml = ET.fromstring(binary)
                cell = next(xml.iter(ns + 'c'))
                cell.set('t', 'str')
                cell.find(ns + 'v').text = 'Número de piezas: 54'
                binary = ET.tostring(xml)
            target.writestr(item, binary)
    return output.getvalue()


def zipped(binary, path):
    output = io.BytesIO()
    with ZipFile(output, 'w') as archive:
        archive.writestr(path, binary)
    return output.getvalue()


@pytest.mark.parametrize('nested', [False, True])
def test_split_formula_keeps_cache_uncertainty_and_cell_evidence_inside_zip(nested):
    binary = long_formula_workbook()
    if nested:
        binary = zipped(zipped(binary, 'datos/ficha.xlsx'), 'producto.zip')
    result = extract_parts(binary, 'application/zip' if nested else XLSX, 'datos.zip' if nested else 'ficha.xlsx')
    segments = [segment for part in result['fragments'] for segment in part['segments']]
    row = next(segment for segment in segments if 'Número de piezas: 54' in segment['text'])
    assert 'no recalculada' not in row['text']  # El marcador quedó en otra parte.
    assert row['formulaUncertain'] is True
    formula = row['formulaEvidence'][0]
    assert formula['cachedValue'] == 'Número de piezas: 54' and not formula['executed']
    expected = 'producto.zip · datos/ficha.xlsx · Producto!A1' if nested else 'Producto!A1'
    assert formula['locator'] == expected
    assert all('formulaUncertain' not in item for item in segments if item['text'] == 'A: Material: madera')
    source = {'id': 'source', 'version': 'v', 'name': 'datos.zip' if nested else 'ficha.xlsx',
              'readingCoverage': result['coverage']}
    fragments = [{'source_id': source['id'], 'version': 'v', 'payload': part} for part in result['fragments']]
    proposal = {'id': 'proposal', 'field': 'custom', 'label': 'Número de piezas', 'value': '54',
                'evidence': [{'sourceId': source['id'], 'locator': row['locator'], 'excerpt': 'Número de piezas: 54'}]}
    consolidated = consolidate_proposals([proposal], [source], fragments)
    fact = consolidated['proposals'][0]
    assert fact['supportStatus'] == 'needs_review'
    assert fact['supportReasons'][0]['code'] == 'formula_uncertain'
    assert fact['evidence'][0]['formulaEvidence'][0] == formula


def vector_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(300, 300)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 20 250 Td (Material: madera) Tj ET '
                    b'1 0 0 RG 2 w 30 30 m 100 30 l 65 100 l h S')
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO(); writer.write(output)
    return output.getvalue()


def test_native_pdf_text_does_not_hide_vector_graphics_from_visual_reading():
    result = extract_parts(vector_pdf(), 'application/pdf', 'vector.pdf')
    coverage = result['coverage']
    assert coverage['complete'] and coverage['pdfVisualProfile'] == 'vectors-v1'
    assert coverage['ocr']['units'] == 1
    assert any(part.get('inline') and part['region']['page'] == 1 for part in result['fragments'])
    assert any(segment['locator'] == 'Página 1' for part in result['fragments'] for segment in part['segments'])


def test_pdf_table_coordinates_use_local_top_left_even_when_mediabox_is_offset():
    page = PdfReader(io.BytesIO(table_pdf())).pages[0]
    page.mediabox = RectangleObject([10, 20, 310, 220])
    page.cropbox = RectangleObject([10, 20, 310, 220])
    writer = PdfWriter(); writer.add_page(page)
    output = io.BytesIO(); writer.write(output)
    result = extract_parts(output.getvalue(), 'application/pdf', 'offset.pdf')
    region = result['coverage']['tables'][0]['region']
    assert region['bbox'] == [10, 50, 270, 170]
    assert region['pageBox'] == 'media' and region['pageBoxBounds'] == [10, -20, 310, 180]
    assert region['width'] == 300 and region['height'] == 200
    visual = next(part['region'] for part in result['fragments'] if part.get('image'))
    assert visual['pageBox'] == 'visible' and visual['pageBoxPdfBounds'] == [10, 20, 310, 220]


@pytest.mark.parametrize('vml', [False, True])
def test_missing_referenced_office_image_is_explicitly_incomplete(vml):
    output = io.BytesIO()
    with ZipFile(io.BytesIO(docx_with_image())) as original, ZipFile(output, 'w') as target:
        for item in original.infolist():
            if '/media/' in item.filename:
                continue
            binary = original.read(item.filename)
            if vml and item.filename == 'word/document.xml':
                binary = binary.replace(b'<a:blip r:embed="image1"/>',
                    b'<v:imagedata xmlns:v="urn:schemas-microsoft-com:vml" r:id="image1"/>')
            target.writestr(item, binary)
    result = extract_parts(output.getvalue(), DOCX, 'incompleto.docx')
    coverage = result['coverage']
    assert not coverage['complete'] and result['truncated'] and coverage['embeddedVisualsPending']
    assert coverage['missingEmbeddedVisuals'] == ['word/media/image1.png']
    unit = coverage['visualUnits'][0]
    assert unit['status'] == 'missing_embedded_image'
    assert unit['placements'][0]['documentPart'] == 'word/document.xml'
    assert any('ausentes' in warning for warning in result['warnings'])


def test_missing_office_relationship_cannot_hide_declared_image():
    output = io.BytesIO()
    with ZipFile(io.BytesIO(docx_with_image())) as original, ZipFile(output, 'w') as target:
        target.writestr('word/document.xml', original.read('word/document.xml'))
    result = extract_parts(output.getvalue(), DOCX, 'sin-relacion.docx')
    assert not result['coverage']['complete']
    missing = result['coverage']['missingEmbeddedVisuals']
    assert missing == ['word/document.xml#relationship:image1']


@pytest.mark.parametrize('nested', [False, True])
def test_zip_keeps_internal_office_image_asset_and_original_pixel_coordinates(nested):
    binary = zipped(docx_with_image(), 'ficha.docx')
    if nested:
        binary = zipped(binary, 'producto.zip')
    result = extract_parts(binary, 'application/zip', 'materiales.zip')
    part = next(part for part in result['fragments'] if part.get('image'))
    expected = ('producto.zip/' if nested else '') + 'ficha.docx :: word/media/image1.png'
    assert part['region']['asset'] == expected
    assert part['region']['bbox'] == [0, 0, 1200, 400]
    ocr = next(segment for segment in part['segments'] if segment['method'] == 'ocr')
    assert ocr['region']['asset'] == expected
    assert ocr['region']['width'] == 1200 and ocr['region']['height'] == 400


def test_zip_svg_region_keeps_static_render_coordinate_basis():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'
    result = extract_parts(zipped(svg, 'simbolo.svg'), 'application/zip', 'simbolos.zip')
    region = next(part['region'] for part in result['fragments'] if part.get('image'))
    assert region['asset'] == 'simbolo.svg :: Render estático SVG'
    assert region['coordinateSpace'] == 'pixels'
