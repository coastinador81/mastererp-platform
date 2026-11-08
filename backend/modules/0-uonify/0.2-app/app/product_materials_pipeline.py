"""Descubrimiento y lectura con checkpoints; los originales permanecen en Drive."""
from hashlib import sha256
import json
from .drive_extract import supported, MAX_BYTES, ExtractionError
from .drive_segments import EXTRACTOR_VERSION
from .drive_extract_process import extract_isolated as extract_parts
from .google_cloud_provider import CloudError
from .google_drive_provider import FOLDER, public_file
from .product_materials_queue import BudgetPause

MAX_DOWNLOAD_BLOCK = 1024 * 1024 * 1024


def source_version(source):
    keys = {k: source.get(k) for k in ('id', 'modifiedTime', 'size', 'mimeType')}
    return sha256(json.dumps(keys, sort_keys=True).encode()).hexdigest()


def discover(service, row, user_id, result, checkpoint, check_pause, credentials):
    token = credentials()[0][1]
    folder = service.drive.metadata(token, row['folder_id'])
    if folder.get('mimeType') != FOLDER:
        raise CloudError('invalid_file')
    result['folderName'] = folder['name']
    cursor = result.setdefault('discovery', {'queue': [[row['folder_id'], folder['name']]], 'visited': [], 'page': None, 'pages': []})
    seen = {s['id'] for s in result['sources']}
    pages_this_run = 0
    while cursor['queue']:
        check_pause()
        identifier, path = cursor['queue'][0]
        if identifier in cursor['visited']:
            cursor['queue'].pop(0)
            continue
        listing = service.drive.files(credentials()[0][1], identifier, cursor['page'], '')
        for item in listing.get('files', []):
            if item.get('mimeType') == FOLDER:
                if item['id'] not in cursor['visited'] and not any(q[0] == item['id'] for q in cursor['queue']):
                    cursor['queue'].append([item['id'], path + '/' + item['name']])
                continue
            if item['id'] in seen:
                continue
            seen.add(item['id'])
            source = {**public_file(item), 'path': path + '/' + item['name'], 'status': 'pending',
                      'url': 'https://drive.google.com/file/d/' + item['id'] + '/view', 'warnings': []}
            if not supported(item):
                source.update(status='skipped', reason='Formato no interpretable todavía. Aporta PDF, imágenes o una tabla exportada; el original se conserva.')
            result['sources'].append(source)
            service.queue.save_source(row['id'], user_id, row['lease_token'], source, source_version(source))
        page = listing.get('nextPageToken')
        if page and page in cursor['pages']:
            raise ExtractionError('Drive repitió una página. El descubrimiento está pendiente; no se ha dado por completo.')
        if page:
            cursor['page'] = page
            cursor['pages'].append(page)
        else:
            cursor['visited'].append(identifier)
            cursor['queue'].pop(0)
            cursor['page'], cursor['pages'] = None, []
        result['total'] = len(result['sources'])
        checkpoint()
        pages_this_run += 1
        if pages_this_run >= 500 and cursor['queue']:
            raise BudgetPause('discovery_limit')
    result['discoveryComplete'] = True
    checkpoint()


def prepare_source(service, row, user_id, source, credentials, downloaded, check_pause):
    """Persistir todos los fragmentos antes de marcar como leída una fuente."""
    queue, job_id, lease = service.queue, row['id'], row['lease_token']
    actual = service.drive.metadata(credentials()[0][1], source['id'])
    if actual.get('capabilities', {}).get('canDownload') is False:
        raise CloudError('permission_denied')
    for key in ('modifiedTime', 'size', 'mimeType'):
        if source.get(key) and actual.get(key) and actual[key] != source[key]:
            source.update(status='error', reason='El archivo cambió desde esta selección. Inicia un análisis nuevo para revisar la nueva versión.', changed=True)
            queue.save_source(job_id, user_id, lease, source, source.get('version', source_version(source)))
            raise BudgetPause('source_changed')
    if source.get('readComplete'):
        if source.get('status') == 'error' and not source.get('changed'):
            source.update(status='read')
            source.pop('reason', None)
            queue.save_source(job_id, user_id, lease, source, source.get('version', source_version(source)))
        return downloaded
    declared = int(source.get('size', 0))
    if declared > MAX_BYTES:
        raise CloudError('file_too_large')
    if downloaded + declared > MAX_DOWNLOAD_BLOCK:
        raise BudgetPause('download_limit')
    content, mime, name = service.drive.content(credentials()[0][1], source['id'], max_bytes=MAX_BYTES)
    downloaded += len(content)
    latest = service.drive.metadata(credentials()[0][1], source['id'])
    if actual.get('modifiedTime') and latest.get('modifiedTime') != actual['modifiedTime']:
        source.update(status='error', reason='El archivo cambió mientras se descargaba. Inicia un análisis nuevo para revisar su versión actual.', changed=True)
        queue.save_source(job_id, user_id, lease, source, source.get('version', source_version(source)))
        raise BudgetPause('source_changed')
    extraction = extract_parts(content, mime, name)
    del content
    # La identidad del original no cambia por instalar un lector mejor. Conserva las
    # citas/decisiones históricas; la versión del lector tiene su propio campo.
    previous_hash = source.get('sha256')
    if previous_hash and previous_hash != extraction['sha256']:
        source.update(status='error', changed=True, reason='El contenido del archivo cambió. Analiza su versión actual en una nueva selección.')
        queue.save_source(job_id, user_id, lease, source, source.get('version', source_version(source)))
        raise BudgetPause('source_changed')
    version = source.get('version') if previous_hash else None
    version = version or source_version(source) + ':' + extraction['sha256']
    source.update({k: extraction[k] for k in ('sha256', 'bytes', 'image', 'readerMetadata') if k in extraction})
    source.update(version=version, warnings=extraction.get('warnings', []),
                  readingCoverage=extraction.get('coverage', {}))
    source.pop('reason', None)
    previous = queue.fragments(job_id, user_id, source['id']) if previous_hash else []
    # Las unidades textuales idénticas ya pagadas no vuelven al modelo. Las imágenes
    # enriquecidas con OCR/regiones sí se analizan como nuevas unidades.
    reusable = {json.dumps(f['payload'].get('segments', []), sort_keys=True, ensure_ascii=False): f
                for f in previous if f['state'] in ('done', 'partial') and not f['payload'].get('image')}
    pending = []
    for part in extraction['fragments']:
        check_pause()
        fragment_id = sha256((source['id'] + ':' + version + ':' + EXTRACTOR_VERSION + ':' + part['key']).encode()).hexdigest()
        payload = {**part, 'id': source['id'], 'name': source['name'], 'readerVersion': EXTRACTOR_VERSION}
        old = reusable.get(json.dumps(part.get('segments', []), sort_keys=True, ensure_ascii=False)) if not part.get('image') else None
        native = part.get('analysisMode') == 'native_manifest'
        state = 'done' if native else old['state'] if old else 'pending'
        analysis = {'observations': {source['id']: 'Inspección nativa: escenas, objetos, unidades, geometría nominal, materiales, texturas y cámaras. Las dimensiones de diseño no acreditan medidas físicas.'}} if native else old.get('result', {}) if old else {}
        pending.append({'id': fragment_id, 'sourceId': source['id'], 'version': version, 'state': state,
                        'result': analysis, 'locator': part.get('visualLocator') or (part.get('segments') or [{}])[0].get('locator', 'Archivo'),
                        'payload': payload})
    queue.save_source(job_id, user_id, lease, source, version)
    queue.put_fragments(job_id, user_id, lease, pending)
    # Una unidad pendiente del lector anterior está cubierta por el nuevo manifiesto.
    # Conservar su historial no debe volver a cobrar su interpretación.
    current_ids = {item['id'] for item in pending}
    for old in previous:
        if old['id'] not in current_ids and old['state'] in ('pending', 'running', 'unknown', 'error'):
            queue.finish_fragment(job_id, user_id, lease, old['id'], 'superseded')
    source.pop('pendingReaderUpgrade', None)
    source.update(readComplete=True, readerVersion=EXTRACTOR_VERSION, status='read', truncated=not extraction.get('coverage', {}).get('complete', True))
    source['excerpts'] = [{'locator': s['locator'], 'text': s['text'][:600]} for p in extraction['fragments'][:1] for s in p.get('segments', [])[:6]]
    queue.save_source(job_id, user_id, lease, source, version)
    return downloaded


def split_fragment(fragment):
    """Subdividir la entrada saturada, conservando todos sus caracteres y citas."""
    payload = fragment['payload']
    segments = payload.get('segments', [])
    if not segments or payload.get('image'):
        return []
    if len(segments) > 1:
        middle = len(segments) // 2
        groups = [segments[:middle], segments[middle:]]
    elif len(segments[0]['text']) > 160:
        segment = segments[0]
        middle = len(segment['text']) // 2
        # Solapamiento mantiene palabras y relaciones que caen en el límite.
        groups = [[{**segment, 'text': segment['text'][:middle + 40]}], [{**segment, 'text': segment['text'][middle - 40:]}]]
    else:
        return []
    depth = payload.get('splitDepth', 0)
    if depth >= 12:
        return []
    return [{'id': sha256((fragment['id'] + ':' + str(index)).encode()).hexdigest(),
             'sourceId': fragment['source_id'], 'version': fragment['version'], 'locator': group[0]['locator'],
             'payload': {**payload, 'segments': group, 'parentId': fragment['id'], 'splitDepth': depth + 1}}
            for index, group in enumerate(groups)]
