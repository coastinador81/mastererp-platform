"""Integración de vectores/contenedores, con corpus piloto opcional montado de solo lectura."""
import hashlib
import io
import os
from pathlib import Path
import stat
import struct
import zipfile

from PIL import Image
import pytest

from app.drive_additional import SVG, archive_entries, read_archive, svg_image
from app.drive_extract import ExtractionError
from app.drive_segments import extract_parts


def svg(body='', attrs='viewBox="0 0 200 100"'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" {attrs}>{body}</svg>'.encode()


def archive(items, compression=zipfile.ZIP_STORED):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=compression) as file:
        for name, value in items:
            file.writestr(name, value)
    return output.getvalue()


def text_member(content, mime, name):
    return {'coverage': {'complete': True}, 'fragments': [
        {'key': 'part-1', 'segments': [{'locator': 'Línea 1', 'text': content.decode()}]}]}


def test_svg_preserves_aspect_ratio_text_and_internal_gradient():
    content = svg('<defs><linearGradient id="paint"><stop offset="0" stop-color="#123"/></linearGradient></defs>'
                  '<rect width="200" height="100" fill="url(#paint)"/><text x="10" y="30">Basic Mini Bricks</text>')
    png, units, metadata = svg_image(content)
    with Image.open(io.BytesIO(png)) as image:
        assert image.size == (1600, 800)
    assert any(text == 'Basic Mini Bricks' for _, text in units)
    assert metadata['externalAccess'] is False


def test_svg_dimensions_with_physical_units_convert_to_pixels_consistently():
    png, _, metadata = svg_image(svg(attrs='width="25.4mm" height="0.5in"'))
    assert metadata['width'] == pytest.approx(96)
    assert metadata['height'] == pytest.approx(48)
    with Image.open(io.BytesIO(png)) as image:
        assert image.size == (1600, 800)


@pytest.mark.parametrize('attrs', [
    'viewBox="0 0 nan 10"', 'viewBox="0 0 0 10"', 'viewBox="0 0 -1 10"',
    'viewBox="0 0 invalid 10"', 'viewBox="0 10 20"', 'viewBox="0 0 1000001 20"',
    'width="-20" height="10"', 'width="100%" height="10"', 'width="1e999" height="10"',
])
def test_svg_bad_dimensions_are_explicit_errors(attrs):
    with pytest.raises(ExtractionError, match='dimensiones'):
        svg_image(svg(attrs=attrs))


@pytest.mark.parametrize('content', [
    b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
    svg('<script>alert(1)</script>'), svg('<foreignObject><p>active</p></foreignObject>'),
    svg('<rect onclick="run()"/>'), svg('<image href="https://example.invalid/track.png"/>'),
    svg('<style>@import "https://example.invalid/style.css";</style>'),
    svg('<style>@im\\70ort "https://example.invalid/style.css";</style>'),
    svg('<style>rect { fill: u\\72l("https://example.invalid/paint.svg"); }</style>'),
    svg('<rect style="fill:url(https://example.invalid/a.svg)"/>'),
    svg('<rect fill="url(file:///etc/passwd)"/>'),
    svg('<rect fill="url(data:image/png;base64,AAAA)"/>'),
    svg('<rect xml:base="https://example.invalid/"/>'),
])
def test_svg_active_or_external_content_is_rejected_before_render(content):
    with pytest.raises(ExtractionError):
        svg_image(content)


def test_svg_integration_keeps_text_visual_and_source_hash():
    content = svg('<title>Uonify Basic</title><text x="10" y="50" font-size="24">54 piezas</text>')
    result = extract_parts(content, SVG, 'producto.svg')
    assert result['sha256'] == hashlib.sha256(content).hexdigest()
    assert result['coverage']['svg'] and result['coverage']['complete']
    assert any(part.get('inline') for part in result['fragments'])
    assert any(segment.get('method') == 'svg_text' and segment['text'] == '54 piezas'
               for part in result['fragments'] for segment in part['segments'])


@pytest.mark.parametrize('name', ['../outside.txt', '/etc/passwd', 'folder/../../outside.txt',
                                'C:/private.txt', 'folder\\private.txt', '.'])
def test_zip_rejects_unsafe_member_paths(name):
    with pytest.raises(ExtractionError, match='inseguras'):
        list(archive_entries(archive([(name, b'data')])))


def test_zip_rejects_symlinks_and_ambiguous_normalized_names():
    entry = zipfile.ZipInfo('link.txt')
    entry.create_system = 3
    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
    with pytest.raises(ExtractionError, match='simbólicos'):
        list(archive_entries(archive([(entry, b'/etc/passwd')])))
    with pytest.raises(ExtractionError, match='duplicados'):
        list(archive_entries(archive([('a//b.txt', b'1'), ('a/b.txt', b'2')])))


def test_zip_rejects_null_in_original_filename():
    payload = archive([('danger.txt', b'data')]).replace(b'danger.txt', b'dang\x00r.txt')
    with pytest.raises(ExtractionError, match='inseguras'):
        list(archive_entries(payload))


def test_zip_rejects_expansion_bombs_without_reading_payload():
    payload = archive([('large.txt', b'x' * 1024 * 1024)], zipfile.ZIP_DEFLATED)
    with pytest.raises(ExtractionError, match='expansión'):
        list(archive_entries(payload))


def test_zip_rejects_entry_count_budget_and_corruption():
    with pytest.raises(ExtractionError, match='2.000'):
        list(archive_entries(archive([(f'{i}.txt', b'x') for i in range(2001)])))
    with pytest.raises(ExtractionError, match='válido'):
        list(archive_entries(b'not a ZIP'))
    payload = bytearray(archive([('source.txt', b'original')]))
    offset = 30 + struct.unpack_from('<H', payload, 26)[0] + struct.unpack_from('<H', payload, 28)[0]
    payload[offset] = ord('X')
    with pytest.raises(ExtractionError, match='corrupto'):
        list(archive_entries(bytes(payload)))


def test_nested_zip_preserves_full_path_hash_and_locator():
    name = 'folder/' + 'a' * 180 + '.txt'
    payload = archive([('middle.zip', archive([(name, b'final source')]))])
    result = read_archive(payload, text_member)
    part = result['fragments'][0]
    assert part['archivePath'] == 'middle.zip/' + name
    assert part['segments'][0]['archivePath'] == part['archivePath']
    assert part['segments'][0]['fullLocator'] == 'middle.zip · ' + name + ' · Línea 1'
    assert len(part['segments'][0]['locator']) <= 160
    assert result['coverage']['archiveEntries'][0]['sha256']
    assert result['coverage']['complete']


def test_deep_nested_zip_records_failure_and_never_claims_complete():
    payload = archive([('leaf.txt', b'value')])
    for i in range(3):
        payload = archive([(f'level-{i}.zip', payload)])
    result = read_archive(payload, text_member)
    assert not result['coverage']['complete']
    assert result['coverage']['entriesPending'] == 1
    assert any('anidación' in warning for warning in result['warnings'])


def test_nested_zip_visual_regions_keep_actual_member_identity():
    def visual_member(content, mime, name):
        return {'coverage': {'complete': True}, 'fragments': [{'key': 'visual-1',
            'inline': {'mimeType': 'image/jpeg', 'data': 'test'}, 'visualLocator': 'Imagen 1',
            'region': {'bbox': [0, 0, 10, 10]}, 'segments': [{'locator': 'OCR 1', 'text': 'CE',
                'region': {'bbox': [1, 1, 2, 2]}}]}]}
    result = read_archive(archive([('inside.zip', archive([('mark.png', b'image')]))]), visual_member)
    part = result['fragments'][0]
    assert part['region']['asset'] == 'inside.zip/mark.png'
    assert part['segments'][0]['region']['asset'] == 'inside.zip/mark.png'
    assert part['visualLocator'] == 'inside.zip · mark.png · Imagen 1'


def test_zip_mixed_supported_and_uninterpreted_members_have_complete_inventory():
    payload = archive([('attributes.txt', b'Madera'), ('source.ai', b'native vector')])
    result = extract_parts(payload, 'application/zip', 'mixed.zip')
    assert result['coverage']['entryCount'] == 2
    assert result['coverage']['entriesRead'] == 1
    assert result['coverage']['entriesPending'] == 1
    assert not result['coverage']['complete'] and result['truncated']
    entries = result['coverage']['archiveEntries']
    assert entries[1]['status'] == 'uninterpreted' and entries[1]['reason']
    assert result['fragments'][0]['segments'][0]['archivePath'] == 'attributes.txt'


def pilot_sources():
    root = Path(os.environ.get('UONIFY_BMB_SOURCES', '/fixtures'))
    if not (root / 'age-warning.svg').is_file():
        pytest.skip('Monta las fuentes Basic Mini Bricks para la prueba real de solo lectura.')
    return root


def test_basic_mini_bricks_real_svg_sources():
    root = pilot_sources()
    for path in [root / 'age-warning.svg', root / 'reciclaje-oficial/mobius/recycling-symbol-original.svg']:
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        result = extract_parts(content, SVG, path.name)
        assert result['coverage']['svg'] and result['coverage']['complete']
        assert result['fragments'] and any(part.get('inline') for part in result['fragments'])
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
        assert result['readerMetadata']['externalAccess'] is False


def test_basic_mini_bricks_real_ce_zip_has_all_five_members():
    path = pilot_sources() / 'ce-oficial.zip'
    content = path.read_bytes()
    result = extract_parts(content, 'application/zip', path.name)
    assert result['coverage']['entryCount'] == 5
    assert result['coverage']['entriesRead'] == 5
    assert result['coverage']['entriesPending'] == 0
    assert result['coverage']['complete']
    assert result['coverage']['archiveVectorProfile'] == 'ai-eps-v1'
    vectors = [entry for entry in result['coverage']['archiveEntries'] if entry['path'] in ('CE.ai', 'CE.eps')]
    assert len(vectors) == 2
    assert all(entry['sha256'] == entry['readerMetadata']['sourceSha256'] for entry in vectors)
    # IDs de la lectura piloto anterior al adaptador AI/EPS (14-10-2026).
    # Incorporar los editables no invalida ni vuelve a facturar estas imágenes.
    historical = {'ce-mark.gif': 'zip-9aa6f7228bcf7bdd868a9e35d825',
                  'ce-mark.jpg': 'zip-3933148f83dba4cd6c90d6fce66c',
                  'ce-mark.png': 'zip-12906b2f693263d9ed0e24f35f98'}
    assert {part['archivePath']: part['key'] for part in result['fragments']
            if part['archivePath'] in historical} == historical
    assert hashlib.sha256(path.read_bytes()).hexdigest() == hashlib.sha256(content).hexdigest()
