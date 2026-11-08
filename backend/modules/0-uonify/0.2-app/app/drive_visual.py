"""Derivados visuales con OCR local, códigos y zoom desde el original sin sobrescribirlo."""
import base64
import hashlib
import io
import time
import warnings as warning_module
from PIL import Image, ImageOps
from .drive_extract import ExtractionError, IMAGE_MIMES, XLSX, DOCX, MAX_PIXELS
from .drive_visual_ocr import recognize, decode_barcodes, region

MAX_VISUAL_UNITS = 256
MAX_VISUAL_PIXELS = 200_000_000
MAX_VISUAL_SECONDS = 300
MAX_DETAIL_REGIONS = 32


class VisualBudget:
    def __init__(self, coverage):
        self.coverage = coverage
        self.started = time.monotonic()
        self.units = self.pixels = 0
        coverage.setdefault('visualUnits', [])
        coverage.setdefault('ocr', {'engine': 'tesseract', 'units': 0, 'seconds': 0, 'externalCalls': 0, 'lowConfidenceLines': 0})
        coverage.setdefault('barcodes', [])

    def consume(self, image):
        self.units += 1
        self.pixels += image.width * image.height
        if image.width * image.height > MAX_PIXELS:
            raise ExtractionError('La imagen supera 50 megapíxeles; aporta una copia menor para lectura segura.')
        if self.units > MAX_VISUAL_UNITS or self.pixels > MAX_VISUAL_PIXELS or time.monotonic() - self.started > MAX_VISUAL_SECONDS:
            raise ExtractionError('La fuente supera el presupuesto visual seguro (256 unidades, 200 MP o 300 s). '
                                  'Divide la fuente para continuar; no se ha dado por leída.')


def opaque(image):
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
        rgba = image.convert('RGBA')
        output = Image.new('RGB', image.size, 'white')
        output.paste(rgba, mask=rgba.getchannel('A'))
        return output
    return image.convert('RGB')


def derivative(image):
    output = image.copy()
    output.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    output.save(buffer, 'JPEG', quality=92)
    return {'mimeType': 'image/jpeg', 'data': base64.b64encode(buffer.getvalue()).decode()}, {
        'width': image.width, 'height': image.height, 'analysisWidth': output.width,
        'analysisHeight': output.height, 'analysisBytes': buffer.tell()}


def detail_regions(lines, barcodes, width, height):
    """Agrupa texto que perdería legibilidad al reducir, sin enviar cada baldosa al modelo."""
    candidates = [line['region']['bbox'] for line in lines
                  if (line['region']['bbox'][3] - line['region']['bbox'][1]) * min(1, 1600 / max(width, height)) < 16]
    candidates.extend(item['region']['bbox'] for item in barcodes)
    grouped = {}
    for box in candidates:
        # El centro selecciona una zona estable, siempre recortada desde el original.
        center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        key = (int(center[0] // 900), int(center[1] // 900))
        expanded = [max(0, box[0] - 32), max(0, box[1] - 32), min(width, box[2] + 32), min(height, box[3] + 32)]
        previous = grouped.get(key)
        grouped[key] = expanded if previous is None else [min(previous[0], expanded[0]), min(previous[1], expanded[1]),
                                                         max(previous[2], expanded[2]), max(previous[3], expanded[3])]
    output = []
    for box in grouped.values():
        for y in range(int(box[1]), int(box[3]), 1300):
            for x in range(int(box[0]), int(box[2]), 1300):
                output.append([x, y, min(box[2], x + 1400), min(box[3], y + 1400)])
    return output


def inspect_image(image, locator, budget, context=None):
    image = opaque(image)
    budget.consume(image)
    context = context or {}
    lines, ocr = recognize(image, context)
    codes = decode_barcodes(image, context)
    coverage = budget.coverage
    coverage['ocr']['units'] += 1
    coverage['ocr']['lowConfidenceLines'] += ocr['lowConfidenceLines']
    coverage['ocr']['seconds'] = round(coverage['ocr']['seconds'] + ocr['seconds'], 3)
    coverage['barcodes'].extend({'locator': locator, **code} for code in codes)
    info = {'locator': locator, 'width': image.width, 'height': image.height, 'ocr': ocr,
            'barcodeCount': len(codes), 'status': 'read', **context}
    coverage['visualUnits'].append(info)
    whole_region = region([0, 0, image.width, image.height], *image.size, **context)
    segments = []
    for index, line in enumerate(lines, 1):
        segments.append({**line, 'locator': f'{locator} · OCR {index}'})
    for index, code in enumerate(codes, 1):
        validity = 'válida' if code['structureValid'] else 'no válida' if code['structureValid'] is False else 'no evaluable como GTIN'
        segments.append({'locator': f'{locator} · Código {index}', 'text': f"{code['format']}: {code['value']} · estructura {validity}",
                         'method': 'barcode', 'observational': True, 'region': code['region'], 'barcode': code})
    inline, dimensions = derivative(image)
    digest = hashlib.sha256((locator + str(image.size)).encode()).hexdigest()[:16]
    full = {'key': f'visual-{digest}', 'segments': segments, 'inline': inline, 'image': dimensions,
            'region': whole_region, 'visualLocator': f'{locator} · Vista completa', 'visual': {'ocr': ocr, 'barcodes': codes, 'kind': 'overview'}}
    parts = [full]
    details = detail_regions(lines, codes, *image.size)
    if len(details) > MAX_DETAIL_REGIONS:
        raise ExtractionError('La imagen requiere más de 32 ampliaciones de texto; divide la fuente para revisarla completa.')
    info['detailRegions'] = len(details)
    for index, box in enumerate(details, 1):
        box = [int(value) for value in box]
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        cropped = image.crop(box)
        # La ampliación visual conserva píxeles originales; no crea texto con IA.
        inline, dimensions = derivative(cropped)
        parts.append({'key': f'visual-{digest}-region-{index:03}', 'segments': [], 'inline': inline,
                      'image': dimensions, 'region': region(box, *image.size, **context),
                      'visualLocator': f'{locator} · Región {index}',
                      'visual': {'kind': 'detail', 'originalLocator': locator}})
    return parts


def extract_visuals(content, mime, name, coverage, warnings):
    """Añadir a los fragmentos textuales. Cobertura registra cada página/imagen aunque no tenga texto."""
    budget = VisualBudget(coverage)
    if mime in IMAGE_MIMES:
        parts = []
        with warning_module.catch_warnings():
            warning_module.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as original:
                count = getattr(original, 'n_frames', 1)
                if count > MAX_VISUAL_UNITS:
                    raise ExtractionError('La imagen contiene más de 256 páginas/fotogramas; divide la fuente.')
                coverage['frames'] = count
                for frame in range(count):
                    original.seek(frame)
                    if original.width * original.height > MAX_PIXELS:
                        raise ExtractionError('La imagen supera 50 megapíxeles; aporta una copia menor.')
                    image = ImageOps.exif_transpose(original.copy())
                    parts.extend(inspect_image(image, f'Imagen {frame + 1}', budget, {'frame': frame + 1}))
        return parts
    if mime == 'application/pdf':
        from .drive_visual_pdf import pdf_visuals
        return pdf_visuals(content, budget, warnings)
    if mime in {XLSX, DOCX}:
        from .drive_visual_office import office_visuals
        return office_visuals(content, mime, budget, warnings)
    return []
