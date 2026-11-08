"""Worker durable: leer, guardar y analizar unidades independientes sin descartar propuestas."""
from copy import deepcopy
from fastapi import HTTPException
from .google_cloud_provider import CloudError
from .products import require_access
from .drive_extract import ExtractionError
from .product_materials import MESSAGES
from .product_materials_analyzer import safe_diagnostics
from .product_materials_pipeline import discover, prepare_source, source_version, split_fragment
from .product_materials_queue import BudgetPause, LeaseLost, merge_proposals as merge_values
from .product_materials_resolution import apply_resolution, fragment_problem, minimal_fragments, DISCARD_WARNING


def identity(service, user_id, subject, project_id):
    with service.database.connect() as c:
        user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
        if not user or user['google_subject'] != subject:
            raise CloudError('reauthorize')
        require_access(c, user)
        if not project_id:
            raise CloudError('google_changed')  # Legacy jobs cannot choose a new billing project.
        return user, service.credentials(c, user, expected_project_id=project_id)


def merge_proposals(result, proposals):
    result['proposals'] = merge_values(result.get('proposals', []), proposals)
    return 0


def snapshot(service, row, user_id, result):
    """Cobertura por unidad; enviar contenido no equivale a validar todos sus hechos."""
    sources = service.queue.sources(row['id'], user_id)
    with service.database.connect() as c:
        fragments = minimal_fragments(c, row['id'])
    live = [f for f in fragments if f['state'] not in ('split', 'superseded')]
    by_source = {}
    for fragment in live:
        by_source.setdefault(fragment['source_id'], []).append(fragment)
    for source in sources:
        own = by_source.get(source['id'], [])
        if source.get('changed') or source['status'] in ('skipped', 'error'):
            continue
        if source.get('duplicateOf'):
            continue
        if source.get('readComplete'):
            waiting = any(f['state'] in ('pending', 'running', 'unknown', 'error') for f in own)
            partial = (source.get('truncated') or not source.get('readingCoverage', {}).get('complete', True)
                       or not own or any(fragment_problem(f, result.get('facts')) for f in own if f['state'] in ('done', 'partial')))
            status = 'awaiting_analysis' if waiting else 'partial' if partial else 'analyzed'
            summaries = [f['result'].get('observations', {}).get(source['id'], '') for f in own]
            summary = ' '.join(dict.fromkeys(x for x in summaries if x))[:2000]
            warnings = [w for w in source.get('warnings', []) if DISCARD_WARNING not in w]
            for f in own:
                for warning in f['result'].get('warnings', []):
                    if warning not in warnings and DISCARD_WARNING not in warning:
                        warnings.append(warning)
            updates = {'status': status, 'summary': summary, 'warnings': warnings,
                       'fragmentCoverage': {'total': len(own), 'done': sum(f['state'] in ('done', 'partial') for f in own)}}
            # Cada checkpoint conserva la cobertura completa, pero no reescribe las
            # demás fuentes cuando sólo avanzó una parte del análisis.
            if any(source.get(key) != value for key, value in updates.items()):
                source.update(updates)
                service.queue.save_source(row['id'], user_id, row['lease_token'], source, source.get('version', source_version(source)))
    by_id = {s['id']: s for s in sources}
    for source in sources:
        if source.get('duplicateOf'):
            status = 'duplicate' if by_id.get(source['duplicateOf'], {}).get('status') == 'analyzed' else 'partial'
            if source['status'] != status:
                source['status'] = status
                service.queue.save_source(row['id'], user_id, row['lease_token'], source, source.get('version', source_version(source)))
    result['sources'] = sources
    result['total'] = len(sources)
    result['processed'] = sum(bool(s.get('readComplete')) or s['status'] in ('skipped', 'error') for s in sources)
    result['coverage'] = {'sourcesTotal': len(sources), 'sourcesRead': sum(bool(s.get('readComplete')) for s in sources),
                          'fragmentsTotal': len(live), 'fragmentsDone': sum(f['state'] in ('done', 'partial') for f in live),
                          'fragmentsPending': sum(f['state'] not in ('done', 'partial') for f in live),
                          'fragmentsNeedingReview': sum(f['state'] == 'partial' for f in live)}
    result['unreviewed'] = sum(s['status'] not in ('analyzed', 'duplicate') for s in sources)
    result['coverageLimited'] = bool(result['unreviewed'])
    result['warnings'] = [f"{result['unreviewed']} fuentes tienen observaciones o una interpretación pendiente."] if result['unreviewed'] else []
    return apply_resolution(result, fragments)


def process_fragment(service, row, user_id, product, fragment, credentials, check_pause, checkpoint):
    queue, args = service.queue, (row['id'], user_id, row['lease_token'])
    if fragment['state'] in ('done', 'partial', 'superseded'):
        return
    check_pause()
    if fragment['state'] == 'split':
        children = [f for f in queue.fragments(row['id'], user_id, fragment['source_id']) if f['payload'].get('parentId') == fragment['id']]
        for child in children:
            process_fragment(service, row, user_id, product, child, credentials, check_pause, checkpoint)
        return
    drive_token = credentials()[0][1]  # Validate the pinned project before Drive access.
    # Revalidar autorización y versión antes de reutilizar un fragmento leído en otro turno.
    actual = service.drive.metadata(drive_token, fragment['source_id'])
    with service.database.connect() as c:
        stored = c.execute('SELECT data FROM product_material_sources WHERE job_id=%s AND source_id=%s', (row['id'], fragment['source_id'])).fetchone()['data']
    if actual.get('capabilities', {}).get('canDownload') is False:
        raise CloudError('permission_denied')
    if stored.get('modifiedTime') and actual.get('modifiedTime') != stored['modifiedTime']:
        stored.update(status='error', changed=True, reason='El archivo cambió antes de analizar esta parte. Inicia un análisis nuevo para revisar su versión actual.')
        queue.save_source(*args, stored, stored.get('version', source_version(stored)))
        raise BudgetPause('source_changed')
    analysis = queue.completed_call(row['id'], user_id, [fragment['id']])
    if analysis is None:
        payload = fragment['payload']
        estimate = sum(len(s['text']) for s in payload.get('segments', [])) // 3 + (4096 if payload.get('image') else 512)
        # A changed connection must not consume a provider-call reservation.
        credentials()
        call_id = queue.reserve_call(*args, [fragment['id']], estimated_input_tokens=estimate)
        try:
            # Re-read after reservation, as close to the POST as possible.
            # A known mismatch has made no provider call and releases its budget.
            token = credentials()[1][1]
        except Exception:
            queue.cancel_unstarted_call(*args, call_id)
            raise
        queue.finish_fragment(*args, fragment['id'], 'running')
        try:
            # The immutable job project is the billing target even if a later
            # connection update races this check.
            analysis = service.analyzer_for(row['engine']).analyze(token, row['project_id'], product, [payload])
        except CloudError as error:
            usage = getattr(error, 'usage', {'calls': 1, 'unconfirmedCalls': 1})
            if getattr(error, 'diagnostics', {}).get('finishReason') == 'MAX_TOKENS':
                # Registrar la salida incompleta antes de subdividir, también si reinicia
                # el proceso entre la respuesta facturada y la creación de las partes.
                analysis = {'proposals': [], 'observations': {}, 'coverageLimited': True,
                            'usage': usage, 'outputLimit': True}
                queue.finish_call(*args, call_id, usage, result=analysis)
            else:
                unknown = error.code in ('analysis_timeout', 'google_unavailable') and usage.get('unconfirmedCalls', 1)
                queue.finish_call(*args, call_id, usage, state='unknown' if unknown else 'error')
                queue.finish_fragment(*args, fragment['id'], 'unknown' if unknown else 'error', {'error': error.code})
                if unknown:
                    raise BudgetPause('consumption_unknown') from None
                raise
        else:
            queue.finish_call(*args, call_id, analysis.get('usage', {}), result=analysis)
    warnings = []
    limited = analysis.get('coverageLimited', False)
    children = split_fragment(fragment) if limited else []
    discarded = analysis.get('discardedProposalCount', 0)
    if discarded:
        warnings.append(f'{discarded} propuestas requieren comprobar su evidencia; se conserva el fragmento para revisión.')
    if limited and not children:
        warnings.append('Este fragmento agotó la salida del modelo. Conservamos los datos obtenidos; su detalle requiere revisión adicional.')
    if not analysis.get('observations', {}).get(fragment['source_id']):
        warnings.append('La fuente no recibió una observación individual; requiere revisión.')
    for child in children:
        queue.put_fragment(*args, child)
    state = 'split' if children else 'partial' if warnings else 'done'
    queue.finish_fragment(*args, fragment['id'], state, {**analysis, 'warnings': warnings})
    checkpoint()
    for child in children:
        child_row = next(f for f in queue.fragments(row['id'], user_id, fragment['source_id']) if f['id'] == child['id'])
        process_fragment(service, row, user_id, product, child_row, credentials, check_pause, checkpoint)


def run(service, job_id, user_id, lease_token=None):
    queue = service.queue
    if lease_token is None:
        row = queue.claim('explicit-worker', job_id)
        if not row:
            return
        lease_token = row['lease_token']
    with service.database.connect() as c:
        row = queue.assert_lease(c, job_id, user_id, lease_token)
        product_row = (c.execute('''SELECT data FROM products WHERE id=%s AND user_id=%s
            AND deleted_at IS NULL''', (row['product_id'], user_id)).fetchone()
            if row['product_id'] else None)
        intake_row = (c.execute('''SELECT folder_id FROM uony_product_intakes
            WHERE id=%s AND user_id=%s AND google_subject=%s''',
            (row['intake_id'], user_id, row['google_subject'])).fetchone()
            if row['intake_id'] else None)
    result = deepcopy(row['result'])
    result.update(stage='reading', error=None, pauseReason=None, canResume=False)
    result.setdefault('proposals', [])
    result.setdefault('sources', [])
    result.setdefault('warnings', [])
    result.pop('_downloadBlock', None)
    downloaded = 0
    def credentials():
        return identity(service, user_id, row['google_subject'], row['project_id'])[1]
    def check_pause():
        if queue.pause_requested(job_id, user_id, lease_token):
            raise BudgetPause('user_requested')
    def checkpoint(status='running'):
        snapshot(service, row, user_id, result)
        if status != 'running' and row['result'].get('operation') != 'reconcile':
            blocked = result.get('pauseReason') == 'source_changed' or (result.get('error') or {}).get('code') in ('permission_denied', 'reauthorize')
            if blocked:
                if result.get('facts'):
                    result['facts']['stale'] = True
            else:
                from .product_materials_reconcile import build_facts
                try:
                    result['facts'] = build_facts(service, row, user_id, product_row['data'] if product_row else {})
                    # La consolidación puede resolver una cita o una pregunta; proyectar
                    # con los hechos finales, no con el snapshot anterior.
                    snapshot(service, row, user_id, result)
                except LeaseLost:
                    raise
                except Exception:
                    # Una incidencia de consolidación no reabre llamadas al proveedor ni
                    # repite el mismo fallo al intentar guardar el estado de error.
                    status = 'error'
                    if result.get('facts'):
                        result['facts']['stale'] = True
                    result.update(stage='error', canResume=True, error={'code': 'facts_failed',
                        'message': 'No se pudo completar la verificación de los datos. Las fuentes y el análisis se conservan; puedes reintentar.'})
        queue.checkpoint(job_id, user_id, lease_token, result, status)
    try:
        with queue.keeping_lease(job_id, user_id, lease_token):
            if not service.engine_enabled_for(user_id, row['engine']):
                raise BudgetPause('engine_unavailable')
            if not row['project_id']:
                raise BudgetPause('project_unpinned')
            if not product_row and not intake_row:
                raise CloudError('invalid_file')
            if intake_row and intake_row['folder_id'] != row['folder_id']:
                raise BudgetPause('source_changed')
            product = ({k: v for k, v in product_row['data'].items()
                        if k in ('name', 'brand', 'category', 'sku')}
                       if product_row else {})
            if result.get('operation') == 'reconcile':
                if not product_row:
                    raise CloudError('invalid_file')
                from .product_materials_reconcile import reconcile_existing
                reconcile_existing(service, row, user_id, result, product_row['data'], credentials, check_pause, checkpoint)
                return
            if not result.get('discoveryComplete'):
                result['stage'] = 'discovering'
                discover(service, row, user_id, result, checkpoint, check_pause, credentials)
            result['stage'] = 'reading'
            sources = queue.sources(job_id, user_id)
            order = sorted(sources, key=lambda s: (s['status'] == 'skipped', s.get('mimeType', '').startswith('image/'), s['name']))
            hashes = {}
            for source in order:
                check_pause()
                if source['status'] == 'skipped':
                    continue
                before_download = downloaded
                try:
                    downloaded = prepare_source(service, row, user_id, source, credentials, downloaded, check_pause)
                    if source.get('sha256') in hashes:
                        source.update(duplicateOf=hashes[source['sha256']], status='duplicate')
                        for fragment in queue.fragments(job_id, user_id, source['id']):
                            if fragment['state'] == 'pending':
                                queue.finish_fragment(job_id, user_id, lease_token, fragment['id'], 'superseded')
                    elif source.get('sha256'):
                        source.pop('duplicateOf', None)
                        hashes[source['sha256']] = source['id']
                except BudgetPause:
                    raise
                except Exception as error:
                    code = error.code if isinstance(error, CloudError) else None
                    if code in ('reauthorize', 'permission_denied', 'quota_exceeded', 'google_changed') or isinstance(error, (HTTPException, LeaseLost)):
                        raise
                    message = str(error) if isinstance(error, ExtractionError) else MESSAGES.get(code, 'No se pudo leer esta fuente. Se conserva la incidencia sin darla por completa.')
                    source.update(status='error', reason=message)
                queue.save_source(job_id, user_id, lease_token, source, source.get('version', source_version(source)))
                result['downloadedBytes'] = result.get('downloadedBytes', 0) + max(0, downloaded - before_download)
                checkpoint()
            result['stage'] = 'analyzing'
            checkpoint()
            fragments = queue.fragments(job_id, user_id)
            order = {s['id']: i for i, s in enumerate(order)}
            fragments.sort(key=lambda f: (order.get(f['source_id'], 0), f['locator'], f['id']))
            for fragment in fragments:
                if fragment['payload'].get('parentId'):
                    continue
                process_fragment(service, row, user_id, product, fragment, credentials, check_pause, checkpoint)
            result.update(stage='ready', canResume=False, operation='analysis')
            checkpoint('ready')
    except LeaseLost:
        return  # Otro lease o la recuperación es dueño del estado; nunca sobrescribirlo.
    except BudgetPause as pause:
        result.update(stage='paused', pauseReason=pause.reason, canResume=pause.reason != 'source_changed')
        try:
            checkpoint('paused')
        except LeaseLost:
            pass
    except Exception as error:
        if isinstance(error, HTTPException):
            detail = error.detail if isinstance(error.detail, dict) else {}
            code, message = detail.get('error', 'analysis_failed'), detail.get('message', 'No se pudo continuar el análisis.')
        else:
            code = error.code if isinstance(error, CloudError) else 'analysis_failed'
            message = MESSAGES.get(code, 'El análisis se interrumpió. Se conserva el avance; puedes continuar con las partes pendientes.')
        result.update(stage='error', canResume=True, error={'code': code, 'message': message})
        diagnostics = safe_diagnostics(getattr(error, 'diagnostics', None))
        if diagnostics:
            result['error']['detail'] = diagnostics
        try:
            checkpoint('error')
        except LeaseLost:
            pass
