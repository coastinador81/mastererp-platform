"""Extractores acotados. Nunca ejecutan documentos, fórmulas, macros ni código del cliente."""
import base64
import csv
import hashlib
import io
import json
import warnings
from zipfile import ZipFile, BadZipFile
from PIL import Image, ImageOps
from pypdf import PdfReader
from openpyxl import load_workbook
from defusedxml.ElementTree import fromstring

MAX_BYTES = 64 * 1024 * 1024
MAX_TEXT = 48000
MAX_PARTS = 1000
MAX_PIXELS = 50000000
IMAGE_MIMES = {'image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/bmp', 'image/gif'}
TEXT_MIMES = {'text/plain', 'text/csv', 'application/json', 'text/markdown'}
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
NATIVE = {'application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation'}


class ExtractionError(ValueError):
    pass


def supported(item):
    from .drive_additional import native_kind
    return bool(native_kind(item.get('mimeType', ''), item.get('name', ''))) or item.get('mimeType') in IMAGE_MIMES | TEXT_MIMES | NATIVE | {XLSX, DOCX, 'application/pdf'}


def safe_archive(content):
    archive = ZipFile(io.BytesIO(content))
    entries = archive.infolist()
    if len(entries) > 2000 or sum(x.file_size for x in entries) > 80 * 1024 * 1024:
        archive.close()
        raise ExtractionError('El documento comprimido supera el límite de lectura segura.')
    return archive


def extract(content, mime, name):
    if len(content) > MAX_BYTES:
        raise ExtractionError('El archivo supera 64 MiB; conserva el original y aporta una copia para análisis.')
    result = {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content), 'segments': [], 'warnings': []}
    if mime in IMAGE_MIMES:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as original:
                width, height = original.size
                if getattr(original, 'n_frames', 1) > 1:
                    result['warnings'].append('Imagen con varias páginas o fotogramas: solo se analiza el primero; aporta los restantes por separado.')
                    result['truncated'] = True
                if width * height > MAX_PIXELS:
                    raise ExtractionError('La imagen supera 50 megapíxeles; aporta un derivado para análisis.')
                image = ImageOps.exif_transpose(original)
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
                    rgba = image.convert('RGBA')
                    background = Image.new('RGB', image.size, 'white')
                    background.paste(rgba, mask=rgba.getchannel('A'))
                    image = background
                else:
                    image = image.convert('RGB')
                output = io.BytesIO()
                image.save(output, format='JPEG', quality=88)
                result.update({'image': {'width': width, 'height': height, 'analysisWidth': image.width,
                                        'analysisHeight': image.height, 'analysisBytes': output.tell()},
                               'inline': {'mimeType': 'image/jpeg', 'data': base64.b64encode(output.getvalue()).decode()}})
        return result

    chars = 0
    def add(locator, text):
        nonlocal chars, truncated
        text = str(text).strip().replace('\x00', '')
        if not text:
            return True
        remaining = MAX_TEXT - chars
        if remaining <= 0 or len(result['segments']) >= MAX_PARTS:
            return False
        if len(str(locator)) > 160:
            truncated = True
        result['segments'].append({'locator': str(locator)[:160], 'text': text[:remaining]})
        chars += min(remaining, len(text))
        return len(text) <= remaining

    truncated = False
    if mime == 'application/pdf':
        reader = PdfReader(io.BytesIO(content), strict=False)
        if reader.is_encrypted:
            raise ExtractionError('El PDF está cifrado. Proporciona una copia sin contraseña.')
        for index, page in enumerate(reader.pages):
            if index >= 60:
                truncated = True
                break
            stream = page.get_contents()
            if stream is not None and len(stream.get_data()) > 8 * 1024 * 1024:
                raise ExtractionError('Una página PDF supera el límite de lectura segura.')
            if not add('Página ' + str(index + 1), page.extract_text() or ''):
                truncated = True
                break
        if not result['segments']:
            raise ExtractionError('El PDF no contiene texto extraíble. Aporta sus páginas como imágenes para el análisis visual.')
    elif mime == XLSX:
        with safe_archive(content):
            book = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
            try:
                for sheet in book.worksheets[:20]:
                    for index, row in enumerate(sheet.iter_rows(max_row=2000, max_col=80)):
                        if any(cell.value is not None and len(str(cell.value)) > 2000 for cell in row):
                            truncated = True
                        text = ' | '.join(f'{cell.column_letter}: {str(cell.value)[:2000]}' for cell in row if cell.value is not None)
                        if not add(f'{sheet.title}!fila {index + 1}', text):
                            truncated = True
                            break
                    if (sheet.max_row or 0) > 2000 or (sheet.max_column or 0) > 80:
                        truncated = True
                    if chars >= MAX_TEXT:
                        break
                truncated |= len(book.worksheets) > 20
                result['warnings'].append('Excel: se leen valores guardados; las fórmulas no se ejecutan ni se recalculan.')
            finally:
                book.close()
    elif mime == DOCX:
        with safe_archive(content) as archive:
            root = fromstring(archive.read('word/document.xml'))
            namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            for index, paragraph in enumerate(root.iter(namespace + 'p')):
                if not add(f'Párrafo {index + 1}', ''.join(node.text or '' for node in paragraph.iter(namespace + 't'))):
                    truncated = True
                    break
    elif mime in TEXT_MIMES:
        text = content.decode('utf-8-sig', errors='replace')
        if mime == 'application/json' or name.lower().endswith('.json'):
            value = json.loads(text)
            def flatten(node, path='$', depth=0):
                nonlocal truncated
                if depth > 20:
                    truncated = True
                    return [(path, '[Estructura demasiado profunda]')]
                if isinstance(node, dict):
                    return (item for key, val in node.items() for item in flatten(val, path + '.' + str(key), depth + 1))
                if isinstance(node, list):
                    return (item for index, val in enumerate(node) for item in flatten(val, path + '[' + str(index) + ']', depth + 1))
                return [(path, json.dumps(node, ensure_ascii=False))]
            for locator, value in flatten(value):
                if not add(locator, value):
                    truncated = True
                    break
        elif mime == 'text/csv':
            for index, row in enumerate(csv.reader(io.StringIO(text))):
                if not add(f'Fila {index + 1}', ' | '.join(row)):
                    truncated = True
                    break
        else:
            for index, line in enumerate(text.splitlines()):
                if not add(f'Línea {index + 1}', line):
                    truncated = True
                    break
    else:
        raise ExtractionError('Este formato se conserva como referencia, pero todavía no se analiza.')
    if truncated:
        result['warnings'].append('Lectura parcial: se alcanzó el límite de páginas, filas, estructura o texto; faltan partes por revisar.')
    result['truncated'] = truncated
    return result
