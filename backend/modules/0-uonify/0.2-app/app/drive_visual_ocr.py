"""OCR y códigos locales: el texto reconocido es observación, nunca certificación."""
import csv
import io
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from .drive_extract import ExtractionError

OCR_TIMEOUT = 30
MAX_OCR_OUTPUT = 8 * 1024 * 1024


def region(box, width, height, **context):
    return {'bbox': [round(float(value), 3) for value in box], 'width': width, 'height': height,
            'coordinateSpace': 'pixels', 'origin': 'top-left', **context}


def recognize(image, context=None):
    """Ejecuta Tesseract sobre un PNG privado; no carga URL, macros ni conexiones."""
    binary = shutil.which('tesseract')
    if not binary:
        raise ExtractionError('OCR local no disponible. Instala el lector Tesseract para completar esta fuente.')
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='uonify-ocr-') as directory:
        original = Path(directory) / 'original.png'
        image.save(original, 'PNG')
        command = [binary, str(original), 'stdout', '-l', 'eng+spa', '--psm', '11', 'tsv']
        environment = {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'OMP_THREAD_LIMIT': '1'}
        try:
            process = subprocess.run(command, capture_output=True, check=False, timeout=OCR_TIMEOUT,
                                     env=environment, cwd=directory)
        except subprocess.TimeoutExpired as error:
            raise ExtractionError('El OCR local agotó 30 segundos; la región queda pendiente para reintento.') from error
        if process.returncode or len(process.stdout) > MAX_OCR_OUTPUT:
            raise ExtractionError('El OCR no pudo completar la imagen dentro de sus límites seguros.')
    lines = {}
    for item in csv.DictReader(io.StringIO(process.stdout.decode('utf-8')), delimiter='\t', quoting=csv.QUOTE_NONE):
        text = item.get('text', '').strip()
        if item.get('level') != '5' or not text:
            continue
        confidence = max(0.0, min(100.0, float(item['conf'])))
        x, y, width, height = (int(item[field]) for field in ('left', 'top', 'width', 'height'))
        key = tuple(item[field] for field in ('block_num', 'par_num', 'line_num'))
        line = lines.setdefault(key, {'words': [], 'scores': [], 'boxes': []})
        line['words'].append(text)
        line['scores'].append(confidence)
        line['boxes'].append((x, y, x + width, y + height))
    result = []
    for line in lines.values():
        boxes = line['boxes']
        box = [min(p[0] for p in boxes), min(p[1] for p in boxes), max(p[2] for p in boxes), max(p[3] for p in boxes)]
        result.append({'text': ' '.join(line['words']), 'confidence': round(sum(line['scores']) / len(line['scores']), 2),
                       'method': 'ocr', 'observational': True, 'region': region(box, *image.size, **(context or {}))})
    return result, {'engine': 'tesseract', 'languages': ['eng', 'spa'], 'lines': len(result),
                    'lowConfidenceLines': sum(line['confidence'] < 80 for line in result),
                    'seconds': round(time.monotonic() - started, 3), 'externalCalls': 0,
                    'status': 'read' if result else 'no_text_detected'}


def valid_gtin(value):
    if len(value) not in {8, 12, 13, 14} or not value.isascii() or not value.isdigit():
        return False
    digits = list(map(int, value))
    return (sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(reversed(digits[:-1]))) + digits[-1]) % 10 == 0


def decode_barcodes(image, context=None):
    try:
        import zxingcpp
    except ImportError as error:
        raise ExtractionError('El decodificador local de códigos no está disponible.') from error
    results = []
    for code in zxingcpp.read_barcodes(image, try_rotate=True, try_downscale=True, try_invert=True):
        position = code.position
        corners = [position.top_left, position.top_right, position.bottom_left, position.bottom_right]
        box = [min(point.x for point in corners), min(point.y for point in corners),
               max(point.x for point in corners), max(point.y for point in corners)]
        value = code.text
        kind = str(code.format)
        gtin_format = any(token in kind.replace('-', '').replace('_', '').lower()
                          for token in ('ean13', 'ean8', 'upca', 'itf14'))
        valid = valid_gtin(value) if gtin_format else None
        results.append({'value': value, 'format': kind, 'structureValid': valid, 'decoded': True,
                        'method': 'barcode', 'observational': True,
                        'region': region(box, *image.size, **(context or {})),
                        'meaning': 'Contenido impreso decodificado; no prueba titularidad, registro ni conformidad.'})
    return results
