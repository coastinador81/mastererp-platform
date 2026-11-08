"""SVG sin recursos activos y ZIP con manifiesto completo y expansión acotada."""
from collections import Counter
from hashlib import sha256
from pathlib import PurePosixPath
from zipfile import ZipFile, BadZipFile
import io
import math
import mimetypes
import re
import stat
from defusedxml.ElementTree import fromstring
from .drive_extract import ExtractionError, IMAGE_MIMES, MAX_BYTES, XLSX, DOCX

SVG = 'image/svg+xml'
ZIP = {'application/zip', 'application/x-zip-compressed'}
BLEND = {'application/x-blender', 'application/x-blend'}
VECTOR = {'application/postscript', 'application/eps', 'application/illustrator', 'application/vnd.adobe.illustrator'}
ARCHIVE_VECTOR_PROFILE = 'ai-eps-v1'


def native_kind(mime, name):
    lower = name.casefold()
    if mime == SVG or lower.endswith('.svg'):
        return 'svg'
    if mime in ZIP or lower.endswith('.zip'):
        return 'zip'
    if mime in BLEND or lower.endswith('.blend'):
        return 'blend'
    if mime in VECTOR or lower.endswith(('.ai', '.eps')):
        return 'vector'
    return None


def deny_fetch(*args, **kwargs):
    raise ExtractionError('El SVG intenta cargar recursos externos. Incluye una versión autónoma sin enlaces.')


def static_css(value):
    """Resolver escapes CSS antes de decidir, sin confiar en fallos silenciosos del render."""
    from tinycss2 import parse_component_value_list
    stack = list(parse_component_value_list(value))
    while stack:
        token = stack.pop()
        if token.type == 'at-keyword' and token.lower_value == 'import':
            deny_fetch()
        if token.type == 'url':
            if not re.fullmatch(r'#[\w.-]{1,200}', token.value):
                deny_fetch()
        if token.type == 'function' and token.lower_name == 'url':
            args = [arg for arg in token.arguments if arg.type not in {'whitespace', 'comment'}]
            if len(args) != 1 or args[0].type not in {'string', 'hash'}:
                deny_fetch()
            reference = '#' + args[0].value if args[0].type == 'hash' else args[0].value
            if not re.fullmatch(r'#[\w.-]{1,200}', reference):
                deny_fetch()
        stack.extend(getattr(token, 'content', []))
        stack.extend(getattr(token, 'arguments', []))


def svg_dimensions(root):
    def dimension(value, default):
        if value is None:
            return default
        match = re.fullmatch(r'\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*', value)
        if not match:
            raise ExtractionError('Las dimensiones SVG no son válidas o requieren un contexto externo.')
        factor = {'px': 1, 'pt': 96 / 72, 'pc': 16, 'mm': 96 / 25.4, 'cm': 96 / 2.54, 'in': 96}
        return float(match[1]) * factor.get(match[2], 1)
    try:
        viewbox = root.get('viewBox', '').replace(',', ' ').split()
        if root.get('viewBox') is not None:
            if len(viewbox) != 4 or not all(math.isfinite(float(item)) for item in viewbox):
                raise ValueError('viewBox')
            width, height = float(viewbox[2]), float(viewbox[3])
        else:
            width, height = dimension(root.get('width'), 300), dimension(root.get('height'), 150)
    except (ValueError, OverflowError) as error:
        raise ExtractionError('Las dimensiones SVG no son válidas para lectura segura.') from error
    if not all(math.isfinite(v) and 0 < v <= 1000000 for v in (width, height)):
        raise ExtractionError('Las dimensiones SVG no son válidas para lectura segura.')
    return width, height


def svg_image(content):
    """Render estático acotado; DTD, entidades, scripts, imágenes remotas y CSS importado bloqueados."""
    if len(content) > 4 * 1024 * 1024:
        raise ExtractionError('El SVG supera 4 MiB. Simplifica el vector o aporta un PNG.')
    try:
        root = fromstring(content, forbid_dtd=True)
    except Exception as error:
        raise ExtractionError('El SVG no es XML seguro válido; no se ejecutan entidades ni DTD.') from error
    if root.tag.rsplit('}', 1)[-1] != 'svg':
        raise ExtractionError('El archivo no tiene una raíz SVG válida.')
    nodes = list(root.iter())
    if len(nodes) > 20000:
        raise ExtractionError('El SVG supera el presupuesto de 20.000 elementos.')
    units = []
    for i, node in enumerate(nodes):
        tag = node.tag.rsplit('}', 1)[-1] if isinstance(node.tag, str) else ''
        if tag in {'script', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set'}:
            raise ExtractionError('El SVG contiene elementos activos. Aporta una versión estática.')
        for key, value in node.attrib.items():
            key = key.rsplit('}', 1)[-1].casefold()
            if key.startswith('on'):
                raise ExtractionError('El SVG contiene eventos activos. Aporta una versión estática.')
            if key == 'href' and value and not re.fullmatch(r'#[\w.-]{1,200}', value):
                deny_fetch()
            if key == 'base' and value:
                deny_fetch()
            static_css(value)
        if tag == 'style':
            static_css(''.join(node.itertext()))
        text = ' '.join(node.itertext()).strip() if tag in {'text', 'title', 'desc'} else ''
        if text:
            units.append((f'SVG · {tag} {i + 1}', text))
    # El fetcher se mantiene bloqueado también para referencias CSS escapadas u ocultas.
    from cairosvg.surface import PNGSurface
    width, height = svg_dimensions(root)
    scale = min(1600 / width, 1600 / height)
    try:
        png = PNGSurface.convert(bytestring=content, unsafe=False, url_fetcher=deny_fetch,
                                 output_width=max(1, round(width * scale)), output_height=max(1, round(height * scale)))
    except ExtractionError:
        raise
    except Exception as error:
        raise ExtractionError('No se pudo renderizar este SVG. Aporta un PNG o PDF autónomo.') from error
    return png, units, {'elements': len(nodes), 'width': width, 'height': height, 'externalAccess': False}


def archive_entries(content, budget=None, depth=0):
    """Sin extraer rutas al disco. Cuenta el tamaño total también en ZIP anidados."""
    if depth > 2:
        raise ExtractionError('El ZIP supera dos niveles de anidación. Descomprime sus carpetas en Drive.')
    budget = budget if budget is not None else {'bytes': 0, 'entries': 0}
    try:
        archive = ZipFile(io.BytesIO(content))
    except BadZipFile as error:
        raise ExtractionError('El ZIP no es válido; aporta una copia sin cifrar.') from error
    with archive:
        entries = archive.infolist()
        if len(entries) > 2000:
            raise ExtractionError('El ZIP supera el presupuesto de 2.000 entradas por contenedor.')
        seen = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            normalized = str(path)
            mode = entry.external_attr >> 16
            if (path.is_absolute() or '..' in path.parts or '\\' in entry.filename or
                    ':' in entry.filename or '\x00' in entry.orig_filename or normalized == '.' or stat.S_ISLNK(mode)):
                raise ExtractionError('El ZIP contiene rutas inseguras o enlaces simbólicos; no se ha abierto.')
            if normalized in seen:
                raise ExtractionError('El ZIP contiene nombres duplicados ambiguos.')
            seen.add(normalized)
            if entry.flag_bits & 1:
                raise ExtractionError('El ZIP está cifrado. Proporciona una copia sin contraseña.')
            if entry.is_dir():
                continue
            budget['entries'] += 1
            budget['bytes'] += entry.file_size
            if (budget['entries'] > 2000 or budget['bytes'] > 80 * 1024 * 1024 or entry.file_size > MAX_BYTES
                    or entry.file_size / max(1, entry.compress_size) > 200):
                raise ExtractionError('El ZIP supera el presupuesto de expansión segura (80 MiB, 2.000 archivos o ratio 200).')
            try:
                with archive.open(entry) as member:
                    payload = member.read(MAX_BYTES + 1)
            except (BadZipFile, RuntimeError, NotImplementedError) as error:
                raise ExtractionError('Un miembro ZIP está corrupto, cifrado o usa una compresión no admitida.') from error
            if len(payload) != entry.file_size:
                raise ExtractionError('Un archivo ZIP no coincide con el tamaño declarado.')
            # Las imágenes mínimas de contenedor no siempre incluyen mime.types Office.
            mime = {'.xlsx': XLSX, '.docx': DOCX}.get(path.suffix.lower()) or mimetypes.guess_type(entry.filename)[0] or 'application/octet-stream'
            yield normalized, mime, payload, budget, depth


def archive_region(region, path, member_path, nested):
    asset = region.get('asset')
    if asset:
        asset = path + '/' + asset if nested else member_path + ' :: ' + asset
    return {**region, 'asset': asset or member_path}


def read_archive(content, extract_member, depth=0, budget=None):
    fragments, entries, warnings = [], [], []
    budget = budget if budget is not None else {'bytes': 0, 'entries': 0}
    for path, mime, payload, _, _ in archive_entries(content, budget, depth):
        checksum = sha256(payload).hexdigest()
        entry = {'path': path, 'bytes': len(payload), 'sha256': checksum, 'mimeType': mime}
        try:
            if native_kind(mime, path) == 'zip':
                child = read_archive(payload, extract_member, depth + 1, budget)
            else:
                child = extract_member(payload, mime, path)
            entry.update(status='read' if child.get('coverage', {}).get('complete', True) else 'partial',
                         coverage=child.get('coverage', {}))
            if child.get('readerMetadata'):
                entry['readerMetadata'] = child['readerMetadata']
            for part in child['fragments']:
                from .drive_segments import compact_locator
                member_path = path + '/' + part['archivePath'] if part.get('archivePath') else path
                nested = bool(part.get('archivePath'))
                mapped = {**part, 'key': 'zip-' + sha256((path + ':' + part['key']).encode()).hexdigest()[:28], 'archivePath': member_path}
                mapped['segments'] = []
                for segment in part.get('segments', []):
                    full = path + ' · ' + segment.get('fullLocator', segment['locator'])
                    citation = {**segment, 'locator': compact_locator(full), 'archivePath': member_path}
                    if full != citation['locator']:
                        citation['fullLocator'] = full
                    if segment.get('region'):
                        citation['region'] = archive_region(segment['region'], path, member_path, nested)
                    if segment.get('barcode', {}).get('region'):
                        citation['barcode'] = {**segment['barcode'],
                            'region': archive_region(segment['barcode']['region'], path, member_path, nested)}
                    if segment.get('formulaEvidence'):
                        citation['formulaEvidence'] = [{**item,
                            'locator': path + ' · ' + item['locator'],
                            'rowLocator': path + ' · ' + item['rowLocator'],
                            'archivePath': member_path} for item in segment['formulaEvidence']]
                    mapped['segments'].append(citation)
                if part.get('inline'):
                    mapped['visualLocator'] = compact_locator(path + ' · ' + part.get('visualLocator', 'Imagen'))
                if part.get('region'):
                    mapped['region'] = archive_region(part['region'], path, member_path, nested)
                if part.get('visual', {}).get('barcodes'):
                    mapped['visual'] = {**part['visual'], 'barcodes': [{**code,
                        'region': archive_region(code['region'], path, member_path, nested)}
                        for code in part['visual']['barcodes']]}
                fragments.append(mapped)
            warnings.extend(path + ': ' + warning for warning in child.get('warnings', []))
        except ExtractionError as error:
            entry.update(status='uninterpreted', reason=str(error))
            warnings.append(path + ': ' + str(error))
        entries.append(entry)
    counts = Counter(entry['status'] for entry in entries)
    return {'fragments': fragments, 'warnings': warnings, 'coverage': {
        'complete': not counts['partial'] and not counts['uninterpreted'], 'archive': True,
        'archiveEntries': entries, 'entriesRead': counts['read'], 'entriesPending': counts['uninterpreted'] + counts['partial'],
        'entriesPartial': counts['partial'],
        'archiveVectorProfile': ARCHIVE_VECTOR_PROFILE,
        'expandedBytes': budget['bytes'], 'entryCount': len(entries)}}
