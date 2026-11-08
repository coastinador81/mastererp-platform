"""Corpus controlado: OCR real, PDF escaneado/tablas, texto pequeño y código decodificado."""
import io
import subprocess
import pytest
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from app.drive_extract import ExtractionError
from app.drive_visual import extract_visuals, detail_regions
from app.drive_visual_ocr import valid_gtin, recognize, decode_barcodes


def label(text='Basic Mini Bricks', size=(1200, 400), font_size=36):
    image = Image.new('RGB', size, 'white')
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', font_size)
    ImageDraw.Draw(image).text((50, 50), text, font=font, fill='black')
    return image


def content(image, format='PNG', **kwargs):
    output = io.BytesIO()
    image.save(output, format, **kwargs)
    return output.getvalue()


def table_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(300, 200)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject()
    stream.set_data(b'0.5 w 20 50 260 120 re S 150 50 m 150 170 l S 20 110 m 280 110 l S '
                    b'BT /F1 12 Tf 30 140 Td (Material) Tj ET BT /F1 12 Tf 160 140 Td (Cantidad) Tj ET '
                    b'BT /F1 12 Tf 30 80 Td (Madera) Tj ET BT /F1 12 Tf 160 80 Td (54) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    out = io.BytesIO(); writer.write(out)
    return out.getvalue()


def test_ocr_real_keeps_original_coordinates_confidence_and_no_external_cost():
    coverage = {'complete': True}
    parts = extract_visuals(content(label()), 'image/png', 'label.png', coverage, [])
    found = [segment for part in parts for segment in part['segments'] if 'Basic Mini Bricks' in segment['text']]
    assert found and found[0]['method'] == 'ocr' and found[0]['observational']
    assert found[0]['confidence'] >= 80
    assert found[0]['region']['width'] == 1200 and found[0]['region']['bbox'][0] >= 50
    assert coverage['ocr']['externalCalls'] == 0 and coverage['ocr']['seconds'] > 0
    assert parts[0]['visualLocator'] == 'Imagen 1 · Vista completa'


def test_small_label_generates_crop_from_original_without_second_ocr_call():
    coverage = {'complete': True}
    parts = extract_visuals(content(label('SKU BASIC MINI BRICKS', (4000, 2000), 24)), 'image/png', 'small.png', coverage, [])
    details = [part for part in parts if part['visual']['kind'] == 'detail']
    assert details and coverage['ocr']['units'] == 1
    assert details[0]['region']['width'] == 4000
    assert details[0]['image']['width'] <= 1400
    assert details[0]['image']['analysisWidth'] == details[0]['image']['width']
    assert details[0]['visualLocator'] != parts[0]['visualLocator']


def test_multi_frame_tiff_reads_every_frame_without_first_only_truncation():
    coverage = {'complete': True}
    binary = content(label('PRIMERA PAGINA'), 'TIFF', save_all=True, append_images=[label('SEGUNDA PAGINA')])
    parts = extract_visuals(binary, 'image/tiff', 'pages.tiff', coverage, [])
    assert coverage['frames'] == coverage['ocr']['units'] == 2
    assert {part['region']['frame'] for part in parts} == {1, 2}
    assert any('SEGUNDA' in segment['text'] for part in parts for segment in part['segments'])


def test_scanned_pdf_all_pages_have_ocr_and_page_coordinate_evidence():
    coverage = {'complete': False, 'visualReviewPages': [1, 2]}
    warnings = ['PDF no contiene texto extraíble; OCR pendiente']
    binary = content(label('MATERIAL MADERA'), 'PDF', resolution=150, save_all=True, append_images=[label('CANTIDAD 54')])
    parts = extract_visuals(binary, 'application/pdf', 'scan.pdf', coverage, warnings)
    assert coverage['pages'] == 2 and coverage['visualReviewPages'] == [] and coverage['complete']
    assert {part['region']['page'] for part in parts if part.get('region')} == {1, 2}
    assert any('MADERA' in segment['text'] for part in parts for segment in part['segments'])
    assert any('54' in segment['text'] for part in parts for segment in part['segments'])
    assert all(part['region']['dpi'] == 300 for part in parts if part.get('region'))


def test_native_pdf_table_preserves_headers_values_and_real_table_bounds():
    coverage = {'complete': True}
    parts = extract_visuals(table_pdf(), 'application/pdf', 'table.pdf', coverage, [])
    segments = [segment for part in parts for segment in part['segments']]
    assert any('1 (Material): Madera' in segment['text'] and '2 (Cantidad): 54' in segment['text'] for segment in segments)
    assert segments[0]['method'] == 'pdf_table'
    assert segments[0]['region']['coordinateSpace'] == 'pdf_points'
    assert coverage['tables'][0]['rows'] == 2 and coverage['ocr']['units'] == 1
    assert coverage['pdfVisualProfile'] == 'vectors-v1'


def test_real_barcode_decoder_not_digit_guessing_and_checksum_validation():
    import zxingcpp
    code = zxingcpp.create_barcode('8435833200006', zxingcpp.BarcodeFormat.EAN13)
    image = Image.fromarray(code.to_image(scale=4))
    decoded = decode_barcodes(image)
    assert decoded[0]['value'] == '8435833200006' and decoded[0]['structureValid'] is True
    assert decoded[0]['observational'] and decoded[0]['region']['bbox'][2] > 0
    assert decode_barcodes(label('8435833200006')) == []
    assert valid_gtin('8435833200006') and not valid_gtin('8435833200007')
    assert not valid_gtin('８４３５８３３２００００６')


def test_barcode_is_traceable_visual_observation_with_no_ownership_claim():
    import zxingcpp
    image = Image.fromarray(zxingcpp.create_barcode('8435833200006', zxingcpp.BarcodeFormat.EAN13).to_image(scale=4))
    coverage = {'complete': True}
    parts = extract_visuals(content(image), 'image/png', 'barcode.png', coverage, [])
    segments = [segment for part in parts for segment in part['segments'] if segment['method'] == 'barcode']
    assert len(segments) == 1 and segments[0]['barcode']['structureValid']
    assert 'no prueba titularidad' in segments[0]['barcode']['meaning']
    assert coverage['barcodes'][0]['decoded']


def test_ocr_timeout_is_explicit_pending_error_not_empty_success(monkeypatch):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('tesseract', 30)
    monkeypatch.setattr('app.drive_visual_ocr.subprocess.run', timeout)
    with pytest.raises(ExtractionError, match='pendiente'):
        recognize(label())


def test_visual_budget_does_not_silently_drop_remaining_pages(monkeypatch):
    monkeypatch.setattr('app.drive_visual.MAX_VISUAL_UNITS', 1)
    binary = content(label(), 'TIFF', save_all=True, append_images=[label()])
    with pytest.raises(ExtractionError, match='divide'):
        extract_visuals(binary, 'image/tiff', 'many.tiff', {'complete': True}, [])


def test_long_small_print_regions_are_tiled_from_original_without_shrinking_again():
    lines = [{'region': {'bbox': [10, 20, 4000, 35]}}]
    regions = detail_regions(lines, [], 4100, 2000)
    assert len(regions) > 1 and all(box[2] - box[0] <= 1400 for box in regions)
    assert regions[0][0] == 0 and regions[-1][2] >= 4000
