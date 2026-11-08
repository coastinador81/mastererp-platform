"""Imágenes internas y cachés Office; nunca ejecuta fórmulas, macros, enlaces ni OLE."""
import hashlib
import io
import posixpath
from PIL import Image, ImageOps, UnidentifiedImageError
from defusedxml.ElementTree import fromstring
from .drive_extract import ExtractionError, XLSX, safe_archive

REL_NS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
DRAW_NS = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
SHEET_DRAW_NS = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
DOC_REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def relationships(archive):
    result, external = {}, []
    for name in archive.namelist():
        if not name.endswith('.rels'):
            continue
        owner = name.replace('/_rels/', '/')[:-5]
        for item in fromstring(archive.read(name)).iter(REL_NS + 'Relationship'):
            target = item.get('Target', '')
            if item.get('TargetMode') == 'External':
                external.append({'owner': owner, 'relationship': item.get('Id'), 'status': 'not_fetched', 'type': item.get('Type', '').rsplit('/', 1)[-1]})
                continue
            path = posixpath.normpath(posixpath.join(posixpath.dirname(owner), target)) if not target.startswith('/') else target[1:]
            if path.startswith('../'):
                raise ExtractionError('Una relación Office sale de la raíz del documento.')
            result.setdefault(owner, {})[item.get('Id')] = path
    return result, external


def media_placements(archive, mapping):
    result = {}
    # Una relación ausente no debe ocultar una imagen declarada por el documento.
    owners = set(mapping) | {name for name in archive.namelist() if name.endswith('.xml')
                            and (name.startswith('word/') or '/drawings/' in name)}
    for owner in sorted(owners):
        links = mapping.get(owner, {})
        if owner not in archive.namelist() or not owner.endswith('.xml'):
            continue
        root = fromstring(archive.read(owner))
        anchors = list(root) if '/drawings/' in owner else [root]
        for anchor in anchors:
            origin = anchor.find(SHEET_DRAW_NS + 'from')
            location = {'documentPart': owner}
            if origin is not None:
                for key in ('row', 'col'):
                    item = origin.find(SHEET_DRAW_NS + key)
                    if item is not None and (item.text or '').isdigit():
                        location[key] = int(item.text) + 1
            nodes = list(anchor.iter(DRAW_NS + 'blip')) + list(anchor.iter('{urn:schemas-microsoft-com:vml}imagedata'))
            for node in nodes:
                ref = node.get(DOC_REL_NS + 'embed') or node.get(DOC_REL_NS + 'id')
                if ref:
                    target = links.get(ref) or f'{owner}#relationship:{ref}'
                    result.setdefault(target, []).append({**location, 'relationship': ref})
    return result


def cached_charts(archive, prefix, coverage):
    result = []
    ns = '{http://schemas.openxmlformats.org/drawingml/2006/chart}'
    for name in sorted(n for n in archive.namelist() if n.startswith(prefix + '/charts/') and n.endswith('.xml')):
        root = fromstring(archive.read(name))
        values = []
        for index, series in enumerate(root.iter(ns + 'ser'), 1):
            cached = [node.text for node in series.iter(ns + 'v') if node.text]
            if cached:
                values.append({'locator': f'{name} · Serie {index}',
                               'text': 'Caché de gráfico sin recalcular: ' + ' | '.join(cached),
                               'method': 'chart_cache', 'observational': True})
        coverage.setdefault('charts', []).append({'asset': name, 'status': 'cached_values' if values else 'unreadable',
                                                  'freshness': 'unknown', 'rendered': False})
        if values:
            digest = hashlib.sha256(name.encode()).hexdigest()[:16]
            result.append({'key': f'chart-{digest}', 'segments': values})
    return result


def office_visuals(content, mime, budget, warnings):
    from .drive_visual import inspect_image
    prefix = 'xl' if mime == XLSX else 'word'
    coverage = budget.coverage
    parts, unresolved = [], []
    with safe_archive(content) as archive:
        mapping, external = relationships(archive)
        placements = media_placements(archive, mapping)
        media = sorted(name for name in archive.namelist() if name.startswith(prefix + '/media/') and not name.endswith('/'))
        missing = sorted(asset for asset in placements if asset not in archive.namelist())
        for asset in missing:
            unresolved.append(asset)
            coverage['visualUnits'].append({'locator': asset, 'asset': asset,
                'status': 'missing_embedded_image', 'placements': placements[asset]})
        coverage['missingEmbeddedVisuals'] = missing
        coverage['embeddedVisuals'] = len(media)
        coverage['externalRelationships'] = external
        for asset in media:
            try:
                with Image.open(io.BytesIO(archive.read(asset))) as original:
                    if original.width * original.height > 50_000_000:
                        raise ExtractionError('Una imagen Office supera 50 megapíxeles.')
                    count = getattr(original, 'n_frames', 1)
                    for frame in range(count):
                        original.seek(frame)
                        image = ImageOps.exif_transpose(original.copy())
                        context = {'asset': asset, 'frame': frame + 1, 'placements': placements.get(asset, [])}
                        parts.extend(inspect_image(image, f'{asset} · Imagen {frame + 1}', budget, context))
            except (UnidentifiedImageError, OSError):
                unresolved.append(asset)
                coverage['visualUnits'].append({'locator': asset, 'asset': asset, 'status': 'unsupported_embedded_image'})
        parts.extend(cached_charts(archive, prefix, coverage))
        embedded = [name for name in archive.namelist() if name.startswith(prefix + '/embeddings/')]
        coverage['embeddedObjectsNotExecuted'] = embedded
    coverage['embeddedVisualsPending'] = bool(unresolved)
    warnings[:] = [warning for warning in warnings if 'imágenes incrustadas' not in warning and 'imágenes o gráficos incrustados' not in warning]
    if media:
        warnings.append('Office: imágenes internas inspeccionadas con OCR local y códigos; coordenadas referidas a cada imagen original.')
    if unresolved:
        coverage['complete'] = False
        warnings.append(f'Office: {len(unresolved)} imágenes internas están ausentes o tienen formato no raster admitido; aporta PNG o PDF para revisarlas.')
    if any(item.get('type') != 'hyperlink' for item in external) or embedded:
        coverage['complete'] = False
        warnings.append('Office: enlaces externos u objetos incrustados no se ejecutan. Aporta su contenido como fuentes independientes.')
    if coverage.get('charts'):
        warnings.append('Office: se conserva la caché del gráfico sin recalcular; la apariencia del gráfico queda pendiente de una copia PDF.')
        coverage['complete'] = False
    return parts
