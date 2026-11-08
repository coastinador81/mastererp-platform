import io
import json
from zipfile import ZipFile
import pytest
from PIL import Image
from openpyxl import Workbook
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from app.drive_extract import ExtractionError, XLSX, DOCX
from app.drive_segments import extract_parts, FRAGMENT_CHARS, FRAGMENT_SEGMENTS


def segments(result):
    return [segment for part in result['fragments'] for segment in part['segments']]


def all_text(result):
    return '\n'.join(segment['text'] for segment in segments(result))


def pdf(pages, encrypted=False):
    writer = PdfWriter()
    for text in pages:
        page = writer.add_blank_page(300, 300)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
        stream = DecodedStreamObject()
        stream.set_data(('BT /F1 12 Tf 20 200 Td (' + text + ') Tj ET').encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    if encrypted:
        writer.encrypt('test-password')
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def excel(book):
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def test_pdf_reads_after_page_60_and_tracks_every_page():
    content = pdf([f'PAGINA-{i + 1}' for i in range(71)])
    result = extract_parts(content, 'application/pdf', 'largo.pdf')
    assert result['coverage']['pages'] == 71 and result['coverage']['complete']
    assert len(segments(result)) == 71
    assert segments(result)[-1] == {'locator': 'Página 71', 'text': 'PAGINA-71'}
    assert not result['truncated']


def test_pdf_encryption_fails_and_blank_page_gets_explicit_visual_inspection():
    with pytest.raises(ExtractionError, match='cifrado'):
        extract_parts(pdf(['texto'], encrypted=True), 'application/pdf', 'cifrado.pdf')
    result = extract_parts(pdf(['texto', '']), 'application/pdf', 'mixto.pdf')
    assert result['coverage']['complete'] is True
    assert result['coverage']['visualReviewPages'] == []
    assert segments(result)[0]['text'] == 'texto'
    second = next(unit for unit in result['coverage']['visualUnits'] if unit.get('page') == 2)
    assert second['status'] == 'read' and second['ocr']['status'] == 'no_text_detected'
    assert any('OCR' in warning for warning in result['warnings'])


def test_large_json_preserves_tail_stable_keys_and_bounded_fragments():
    value = {f'field_{index}': 'valor-' + str(index) + '-' + 'x' * 130 for index in range(1200)}
    content = json.dumps(value).encode()
    first = extract_parts(content, 'application/json', 'ficha.json')
    second = extract_parts(content, 'application/json', 'ficha.json')
    assert first == second
    assert first['coverage']['leaves'] == first['coverage']['units'] == 1200
    assert first['coverage']['characters'] > 48000 and first['coverage']['complete']
    assert segments(first)[-1]['locator'] == '$.field_1199'
    assert value['field_1199'] in segments(first)[-1]['text']
    assert all(len(part['segments']) <= FRAGMENT_SEGMENTS for part in first['fragments'])
    assert all(sum(len(segment['text']) for segment in part['segments']) <= FRAGMENT_CHARS
               for part in first['fragments'])
    assert len({part['key'] for part in first['fragments']}) == len(first['fragments'])


def test_long_scalar_and_long_locator_are_preserved_without_cutting():
    key = 'long-key-' + 'a' * 240
    scalar = 'principio-' + 'x' * 17000 + '-FIN'
    result = extract_parts(json.dumps({key: scalar}).encode(), 'application/json', 'ficha.json')
    pieces = segments(result)
    assert ''.join(piece['text'] for piece in pieces) == json.dumps(scalar)
    assert all(len(piece['locator']) <= 160 for piece in pieces)
    assert len({piece['locator'] for piece in pieces}) == 3
    assert all(key in piece['fullLocator'] for piece in pieces)


def test_json_empty_values_paths_and_deep_nodes_are_not_lost():
    data = {'a.b': 'literal', 'a': {'b': 'nested'}, 'list': [], 'obj': {}, 'pending': None}
    node = data
    for _ in range(25):
        node = {'child': node}
    result = extract_parts(json.dumps(node).encode(), 'application/json', 'ficha.json')
    assert result['coverage']['leaves'] == 5
    assert any('[]' == part['text'] for part in segments(result))
    assert len({part['locator'] for part in segments(result)}) == 5
    assert result['coverage']['complete']


@pytest.mark.parametrize('content', [b'{"a":1,"a":2}', b'{invalid'])
def test_json_ambiguous_or_invalid_is_explicit_error(content):
    with pytest.raises(ExtractionError):
        extract_parts(content, 'application/json', 'ficha.json')


def test_excel_reads_every_sheet_row_column_and_long_cell():
    book = Workbook(write_only=True)
    for index in range(21):
        sheet = book.create_sheet('Hoja-' + str(index))
        sheet.append(['Referencia', 'Unidad'])
        if index == 0:
            for row in range(2101):
                sheet.append(['SKU-' + str(row), 'mm'])
        if index == 20:
            sheet.append(['x' * 4000 + '-ULTIMO-CARACTER'] + ['dato'] * 80 + ['COLUMNA-82'])
    result = extract_parts(excel(book), XLSX, 'grande.xlsx')
    text = all_text(result)
    assert 'SKU-2100' in text and '-ULTIMO-CARACTER' in text and 'COLUMNA-82' in text
    assert 'A (Referencia): SKU-2100' in text and 'B (Unidad): mm' in text
    assert result['coverage']['sheets'] == 21
    assert result['coverage']['rows'] == 2123
    assert result['coverage']['sheetCoverage'][-1]['columns'] == 82
    assert result['coverage']['complete']


def test_excel_missing_formula_cache_never_becomes_an_empty_valid_value():
    book = Workbook()
    book.active.append(['Medida', 'Total'])
    book.active.append([42, '=A2*2'])
    result = extract_parts(excel(book), XLSX, 'formula.xlsx')
    assert result['coverage']['formulaCells'] == result['coverage']['missingFormulaValues'] == 1
    assert result['coverage']['complete'] is False
    assert 'Fórmula sin valor guardado' in all_text(result)
    assert any('Recalcula' in warning for warning in result['warnings'])


def test_csv_preserves_long_cells_quoted_newlines_and_header_context():
    data = 'producto;descripción;unidad\nA;"' + 'x' * 140000 + '\nFINAL-CELDA";mm\nZ;ultima;cm'
    result = extract_parts(data.encode(), 'text/csv', 'productos.csv')
    assert result['coverage']['rows'] == 3 and result['coverage']['complete']
    assert 'FINAL-CELDA' in all_text(result) and '3 (unidad): cm' in all_text(result)


def test_docx_reads_last_paragraph_header_and_footnote_without_cutting():
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    def xml(text):
        return f'<w:document xmlns:w="{ns}"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>'
    output = io.BytesIO()
    with ZipFile(output, 'w') as archive:
        archive.writestr('word/document.xml', xml('x' * 50000 + '-COLA-DOCUMENTO'))
        archive.writestr('word/header1.xml', xml('MARCA EN CABECERA'))
        archive.writestr('word/footnotes.xml', xml('UNIDAD EN NOTA'))
    result = extract_parts(output.getvalue(), DOCX, 'ficha.docx')
    assert result['coverage']['sections'] == 3
    assert all(item in all_text(result) for item in ['-COLA-DOCUMENTO', 'MARCA EN CABECERA', 'UNIDAD EN NOTA'])


def test_invalid_text_encoding_never_silently_replaces_data():
    with pytest.raises(ExtractionError, match='codificación'):
        extract_parts(b'Marca Espa\xf1a', 'text/plain', 'ficha.txt')
    result = extract_parts('Marca España'.encode('utf-16'), 'text/plain', 'ficha.txt')
    assert 'España' in all_text(result)


def test_safety_budget_is_explicit_error_instead_of_successful_prefix(monkeypatch):
    monkeypatch.setattr('app.drive_segments.MAX_EXTRACTED_CHARS', 32)
    with pytest.raises(ExtractionError, match='presupuesto de lectura segura'):
        extract_parts(b'Primero\n' + b'x' * 40 + b'\nULTIMO', 'text/plain', 'ficha.txt')


def test_image_preserves_original_dimensions_and_analysis_derivative():
    output = io.BytesIO()
    Image.new('RGB', (2000, 1000), 'white').save(output, 'PNG')
    result = extract_parts(output.getvalue(), 'image/png', 'producto.png')
    assert result['image']['width'] == 2000 and result['image']['analysisWidth'] == 1600
    assert result['coverage']['complete'] and len(result['fragments']) == 1
    assert result['fragments'][0]['inline']['mimeType'] == 'image/jpeg'
