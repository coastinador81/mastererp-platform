"""Revisión semántica durable sobre originales ya leídos, sin alterar la ficha."""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID
from psycopg.types.json import Jsonb
from .products import find, fail, require_access
from .product_materials_queue import BudgetPause
from .product_materials_controls import require_pinned_engine_project


def request_reconciliation(service, c, user, sku, job_id, revision, request_id):
    require_access(c, user)
    c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
    product = find(c, user, sku)
    product = c.execute('SELECT * FROM products WHERE id=%s AND user_id=%s AND deleted_at IS NULL FOR UPDATE',
                        (product['id'], user['id'])).fetchone()
    row = service.get_row(c, user, sku, job_id)
    row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s FOR UPDATE', (row['id'],)).fetchone()
    request_id, payload = UUID(str(request_id)), {'revision': revision}
    previous = c.execute('SELECT * FROM product_material_controls WHERE user_id=%s AND request_id=%s',
                         (user['id'], request_id)).fetchone()
    if previous:
        if previous['job_id'] != row['id'] or previous['action'] != 'reconcile' or previous['payload'] != payload:
            fail('materials_conflict', 'Esta solicitud pertenece a otra acción o revisión.', 409)
        return service.get(c, user, sku, job_id)
    if product['revision'] != revision:
        fail('product_conflict', 'La ficha ha cambiado. Actualiza antes de comprobar las fuentes.', 409)
    if row['status'] not in ('ready', 'paused', 'error') or row['result'].get('protocolVersion') != 2:
        fail('materials_conflict', 'Espera a que el análisis termine o se pause para unificar sus datos.', 409)
    if row['result'].get('operation') in ('upgrade_readers', 'repair_evidence'):
        fail('materials_conflict', 'Termina o reanuda la lectura pendiente antes de comprobar sus datos.', 409)
    if row['result'].get('pauseReason') == 'source_changed':
        fail('materials_conflict', 'Una fuente cambió. Analiza su nueva versión antes de revisar estos datos.', 409)
    require_pinned_engine_project(service, c, user, row)
    active = c.execute("SELECT id FROM product_material_jobs WHERE user_id=%s AND status IN ('queued','running')",
                       (user['id'],)).fetchone()
    if active:
        fail('materials_running', 'Ya hay un análisis en curso en tu cuenta.', 409)
    result = {**row['result'], 'operation': 'reconcile', 'stage': 'reconciling',
              'reconciliation': {'status': 'queued', 'checkedSources': 0},
              'pauseReason': None, 'error': None}
    c.execute("""UPDATE product_material_jobs SET status='queued',revision=%s,result=%s,
        pause_requested=false,lease_token=NULL,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=%s""",
              (revision, Jsonb(result), row['id']))
    c.execute('INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload) VALUES(%s,%s,%s,%s,%s)',
              (user['id'], request_id, row['id'], 'reconcile', Jsonb(payload)))
    return service.get(c, user, sku, job_id)


def build_facts(service, row, user_id, product):
    from .product_materials_facts import consolidate_proposals
    with service.database.connect() as c:
        latest = service.queue.assert_lease(c, row['id'], user_id, row['lease_token'])
    fragments = service.queue.fragments(row['id'], user_id)
    sources = service.queue.sources(row['id'], user_id)
    # Los candidatos originales conservan tanto citas aceptadas como rechazadas; nunca
    # reconstruirlos de una lista ya consolidada que haya perdido alternativas.
    candidates = deepcopy(latest['result'].get('proposals', []))
    known = {p['id']: p for p in candidates}
    for fragment in fragments:
        if fragment['state'] == 'superseded':
            continue
        for proposal in fragment.get('result', {}).get('candidates', []):
            if proposal['id'] not in known:
                candidates.append(deepcopy(proposal))
                known[proposal['id']] = candidates[-1]
            else:
                for citation in proposal.get('evidence', []):
                    if citation not in known[proposal['id']].get('evidence', []):
                        known[proposal['id']].setdefault('evidence', []).append(deepcopy(citation))
    facts = consolidate_proposals(candidates, sources, fragments, product=product)
    rejected_ids = {item['id'] for item in facts.get('rejections', [])}
    candidate_ids = {item['id'] for item in candidates}
    historical = 0
    for fragment in fragments:
        if fragment['state'] == 'superseded':
            continue
        extraction = fragment.get('result', {})
        if extraction.get('discardedProposalCount') and 'rejections' not in extraction:
            historical += extraction['discardedProposalCount']
        for rejection in extraction.get('rejections', []):
            if rejection['id'] in candidate_ids:
                continue  # El verificador ya ha recuperado o rechazado este candidato.
            identifier = fragment['id'] + ':' + rejection['id']
            if identifier not in rejected_ids:
                facts.setdefault('rejections', []).append({**rejection, 'id': identifier,
                    'sourceId': fragment['source_id'], 'fragmentId': fragment['id']})
                rejected_ids.add(identifier)
    facts['historicalRejectionsWithoutCandidate'] = historical
    facts.setdefault('summary', {})['rejectionCount'] = len(facts.get('rejections', []))
    from .product_materials_decisions import restore_decisions
    restore_decisions(facts, latest['result'].get('facts', {}).get('proposals', []), product)
    revision_scope = ('productRevision' if latest['product_id'] else 'intakeRevision')
    return {'version': 1, **facts, 'checkedAt': datetime.now(timezone.utc).isoformat(),
            revision_scope: latest['revision']}


def reconcile_existing(service, row, user_id, result, product, credentials, check_pause, checkpoint):
    from .google_cloud_provider import CloudError
    sources = service.queue.sources(row['id'], user_id)
    result.update(stage='reconciling', reconciliation={'status': 'running', 'checkedSources': 0})
    for index, source in enumerate(sources):
        check_pause()
        actual = service.drive.metadata(credentials()[0][1], source['id'])
        if actual.get('capabilities', {}).get('canDownload') is False:
            raise CloudError('permission_denied')
        changed = any(source.get(k) and actual.get(k) and source[k] != actual[k]
                      for k in ('modifiedTime', 'size', 'mimeType'))
        if changed:
            source.update(status='error', changed=True, reason='La fuente cambió. Analiza su versión actual antes de confirmar estos datos.')
            from .product_materials_pipeline import source_version
            service.queue.save_source(row['id'], user_id, row['lease_token'], source, source.get('version', source_version(source)))
            raise BudgetPause('source_changed')
        result['reconciliation']['checkedSources'] = index + 1
        # La cobertura de extracción no ha cambiado: no reescribir todas las fuentes
        # por cada metadato comprobado (coste cuadrático en carpetas grandes).
        service.queue.checkpoint(row['id'], user_id, row['lease_token'], result)
    result['facts'] = build_facts(service, row, user_id, product)
    pending = [f for f in service.queue.fragments(row['id'], user_id)
               if f['state'] in ('pending', 'running', 'unknown', 'error')]
    result.update(operation='analysis', reconciliation={'status': 'ready', 'checkedSources': len(sources)},
                  stage='paused' if pending else 'ready', pauseReason='user_requested' if pending else None)
    checkpoint('paused' if pending else 'ready')


def update_facts(service, c, user, sku, job_id, proposals):
    row = service.get_row(c, user, sku, job_id)
    row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s FOR UPDATE', (row['id'],)).fetchone()
    facts = deepcopy(row['result'].get('facts', {}))
    if facts.get('version') != 1 or row['status'] not in ('ready', 'paused', 'error'):
        fail('materials_conflict', 'Vuelve a comprobar las fuentes antes de confirmar estos datos.', 409)
    updates = {p['id']: p for p in proposals}
    if not set(updates).issubset({p['id'] for p in facts['proposals']}):
        fail('materials_conflict', 'Estas propuestas pertenecen a otra comprobación.', 409)
    facts['proposals'] = [updates.get(p['id'], p) for p in facts['proposals']]
    from .product_materials_resolution import apply_resolution, minimal_fragments
    result = deepcopy(row['result'])
    result['facts'] = facts
    result['sources'] = [s['data'] for s in c.execute('SELECT data FROM product_material_sources WHERE job_id=%s', (row['id'],)).fetchall()]
    apply_resolution(result, minimal_fragments(c, row['id']))
    c.execute("UPDATE product_material_jobs SET result=%s,updated_at=now() WHERE id=%s",
              (Jsonb(result), row['id']))
