"""Manifestación completa y fragmentada de las fuentes admitidas, sin recortes silenciosos."""
import hashlib
from .drive_extract import ExtractionError, IMAGE_MIMES, MAX_BYTES
from .drive_segment_readers import read_units

FRAGMENT_CHARS = 6000
FRAGMENT_SEGMENTS = 48
MAX_EXTRACTED_CHARS = 16 * 1024 * 1024
MAX_UNITS = 100000
EXTRACTOR_VERSION = 'drive-segments-v2'


def compact_locator(locator):
    """El localizador enviado a la IA coincide con el persistido, incluso en rutas largas."""
    if len(locator) <= 160:
        return locator
    return locator[:139] + '…#' + hashlib.sha256(locator.encode()).hexdigest()[:16]


class FragmentBuilder:
    def __init__(self, checksum):
        self.checksum = checksum
        self.fragments, self.current = [], []
        self.characters = self.units = self.current_chars = 0

    def flush(self):
        if not self.current:
            return
        self.fragments.append({'key': f'part-{len(self.fragments) + 1:06d}-{self.checksum[:12]}',
                               'segments': self.current})
        self.current, self.current_chars = [], 0

    def add(self, locator, value, metadata=None):
        text = str(value).replace('\x00', '').strip()
        if not text:
            return
        self.units += 1
        self.characters += len(text)
        if self.units > MAX_UNITS or self.characters > MAX_EXTRACTED_CHARS:
            raise ExtractionError('El contenido extraído supera el presupuesto de lectura segura '
                                  '(100.000 unidades o 16 Mi caracteres). No se ha dado por leído; '
                                  'divide la fuente en documentos menores para continuar.')
        chunks = [text[index:index + FRAGMENT_CHARS] for index in range(0, len(text), FRAGMENT_CHARS)]
        for index, chunk in enumerate(chunks):
            if self.current_chars + len(chunk) > FRAGMENT_CHARS or len(self.current) >= FRAGMENT_SEGMENTS:
                self.flush()
            full_locator = locator if len(chunks) == 1 else f'{locator} · parte {index + 1}/{len(chunks)}'
            segment = {**(metadata or {}), 'locator': compact_locator(full_locator), 'text': chunk}
            if len(full_locator) > 160:
                segment['fullLocator'] = full_locator
            self.current.append(segment)
            self.current_chars += len(chunk)


def normalize_parts(parts, checksum):
    """Acotar cada texto conservando regiones, métodos y relación con su original."""
    output = []
    for index, part in enumerate(parts):
        builder = FragmentBuilder(checksum)
        for segment in part.get('segments', []):
            builder.add(segment['locator'], segment['text'], segment)
        builder.flush()
        chunks = builder.fragments or [{'segments': []}]
        for number, chunk in enumerate(chunks):
            normalized = {**part, 'key': f"{part['key']}-{checksum[:12]}-{number}", 'segments': chunk['segments']}
            # Las continuaciones citan el texto completo leído; la vista está en la primera parte.
            if number:
                for key in ('inline', 'image', 'visualLocator'):
                    normalized.pop(key, None)
            if normalized.get('visualLocator'):
                normalized['visualLocator'] = compact_locator(normalized['visualLocator'])
            output.append(normalized)
    return output


def extract_parts(content, mime, name):
    """Lectura completa según formato; una incidencia nunca se oculta como éxito."""
    if len(content) > MAX_BYTES:
        raise ExtractionError('El archivo supera 64 MiB; conserva el original y aporta una copia para análisis.')
    from .drive_additional import native_kind, svg_image, read_archive
    from .drive_visual import extract_visuals
    checksum = hashlib.sha256(content).hexdigest()
    result = {'sha256': checksum, 'bytes': len(content), 'warnings': [], 'fragments': [],
              'extractorVersion': EXTRACTOR_VERSION, 'truncated': False,
              'coverage': {'complete': True, 'units': 0, 'characters': 0, 'fragments': 0}}
    builder = FragmentBuilder(checksum)
    coverage, warnings = result['coverage'], result['warnings']
    kind = native_kind(mime, name)
    try:
        if kind == 'blend':
            from .native_blend_reader import inspect_blend
            native = inspect_blend(content)
            coverage.update(native['coverage'])
            warnings.extend(native.get('warnings', []))
            result['readerMetadata'] = native.get('metadata', {})
            for locator, text in native['units']:
                builder.add(locator, text, {'method': 'blender_native', 'observational': True})
            builder.flush()
            result['fragments'] = [{**part, 'analysisMode': 'native_manifest'} for part in builder.fragments]
        elif kind == 'vector':
            from .drive_vector import read_vector
            vector = read_vector(content, mime, name, extract_parts)
            coverage.update(vector['coverage'])
            warnings.extend(vector['warnings'])
            result['readerMetadata'] = vector['readerMetadata']
            result['fragments'] = vector['fragments']
        elif kind == 'zip':
            archive = read_archive(content, extract_parts)
            coverage.update(archive['coverage'])
            warnings.extend(archive['warnings'])
            result['fragments'] = archive['fragments']
        else:
            if kind == 'svg':
                rendered, units, metadata = svg_image(content)
                result['readerMetadata'] = metadata
                coverage['svg'] = True
                warnings.append('SVG: las coordenadas visuales se refieren al render estático en píxeles; las dimensiones vectoriales originales se conservan en los metadatos.')
                for locator, text in units:
                    builder.add(locator, text, {'method': 'svg_text'})
                visual = extract_visuals(rendered, 'image/png', name, coverage, warnings)
                for part in visual:
                    part['region'] = {**part.get('region', {}), 'asset': 'Render estático SVG'}
                    for segment in part.get('segments', []):
                        segment['region'] = {**segment.get('region', {}), 'asset': 'Render estático SVG'}
            else:
                if mime not in IMAGE_MIMES:
                    formula_count = 0
                    for locator, text in read_units(content, mime, name, coverage, warnings):
                        # Asociar antes de dividir: un sufijo de parte o contenedor ZIP no
                        # debe convertir una caché de fórmula en texto nativo verificado.
                        formulas = coverage.get('formulaEvidence', [])
                        row_formulas = formulas[formula_count:]
                        formula_count = len(formulas)
                        metadata = {'formulaEvidence': row_formulas, 'formulaUncertain': True} if row_formulas else None
                        builder.add(locator, text, metadata)
                visual = extract_visuals(content, mime, name, coverage, warnings)
            builder.flush()
            result['fragments'] = builder.fragments + normalize_parts(visual, checksum)
        parts = result['fragments']
        units = sum(len(part.get('segments', [])) for part in parts)
        characters = sum(len(segment['text']) for part in parts for segment in part.get('segments', []))
        if units > MAX_UNITS or characters > MAX_EXTRACTED_CHARS:
            raise ExtractionError('El contenido supera 100.000 unidades o 16 Mi caracteres. Divide la fuente para continuar.')
        coverage.update(units=units, characters=characters, fragments=len(parts))
        result['truncated'] = not coverage.get('complete', True)
        if mime in IMAGE_MIMES and parts:
            result['image'] = next((part['image'] for part in parts if part.get('image')), {})
        return result
    except ExtractionError:
        raise
    except Exception as error:
        raise ExtractionError('No se ha podido interpretar el documento completo. Revisa su formato o aporta una copia válida; no se ha marcado como leído.') from error
