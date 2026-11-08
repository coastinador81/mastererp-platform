"""Amplía lectores en el mismo trabajo sin repetir resultados ni decisiones del cliente."""
from copy import deepcopy
from uuid import UUID
from psycopg.types.json import Jsonb
from .drive_additional import native_kind, ARCHIVE_VECTOR_PROFILE
from .drive_extract import DOCX, XLSX, IMAGE_MIMES
from .product_materials_controls import CALLS_PER_WINDOW, TOKENS_PER_WINDOW, require_pinned_engine_project
from .product_materials_control_consent import (
    control_consent, record_control_consent, require_exact_control_replay,
)
from .products import find, fail, require_access

TARGET_READER = 'drive-segments-v2'
PDF_VISUAL_PROFILE = 'vectors-v1'
VISUAL_MIMES = {*IMAGE_MIMES, DOCX, XLSX, 'application/pdf',
                'application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet'}


def upgrade_eligible(source):
    kind = native_kind(source.get('mimeType', ''), source.get('name', ''))
    coverage = source.get('readingCoverage') or {}
    pdf_pending = source.get('mimeType') == 'application/pdf' and (
        coverage.get('pdfVisualProfile') != PDF_VISUAL_PROFILE or
        not source.get('readComplete'))
    vectors_pending = ((kind == 'zip' and coverage.get('archiveVectorProfile') != ARCHIVE_VECTOR_PROFILE) or
                       (kind == 'vector' and coverage.get('vectorReaderProfile') != ARCHIVE_VECTOR_PROFILE) or
                       (kind in ('zip', 'vector') and not source.get('readComplete')))
    return ((source.get('readerVersion') != TARGET_READER or pdf_pending or vectors_pending) and not source.get('changed') and
            (source.get('mimeType') in VISUAL_MIMES or bool(kind)))


def new_reader_work_conflict(c, row, sources):
    """Return why the worker cannot limit an upgrade to newly read units."""
    if not row['result'].get('discoveryComplete'):
        return 'La búsqueda anterior aún no terminó. Continúa ese análisis antes de ampliar lectores.'
    if any(source.get('status') not in ('analyzed', 'partial', 'duplicate', 'skipped') or
           (source.get('status') != 'skipped' and not source.get('readComplete'))
           for source in sources):
        return 'Quedan fuentes anteriores sin leer. Continúa ese análisis antes de ampliar lectores.'
    if c.execute("""SELECT id FROM product_material_fragments WHERE job_id=%s
        AND state NOT IN ('done','partial','superseded','split') LIMIT 1""", (row['id'],)).fetchone():
        return 'Quedan partes anteriores pendientes. Continúa ese análisis antes de ampliar lectores.'
    if c.execute("""SELECT id FROM product_material_calls WHERE job_id=%s
        AND state IN ('running','unknown') LIMIT 1""", (row['id'],)).fetchone():
        return 'Hay consumo anterior sin cerrar. Revísalo antes de ampliar lectores.'
    return None


def require_only_new_reader_work(c, row, sources):
    reason = new_reader_work_conflict(c, row, [source['data'] for source in sources])
    if reason:
        fail('materials_scope_conflict', reason, 409)


def request_upgrade(service, c, user, sku, job_id, revision, request_id, acknowledge_unknown=False,
                    *, consent_version=None, consent_text=None, consent_sha256=None):
    require_access(c, user)
    c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
    product = find(c, user, sku)
    product = c.execute('SELECT * FROM products WHERE id=%s AND user_id=%s AND deleted_at IS NULL FOR UPDATE',
                        (product['id'], user['id'])).fetchone()
    row = service.get_row(c, user, sku, job_id)
    row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s AND user_id=%s FOR UPDATE',
                    (row['id'], user['id'])).fetchone()
    payload = {'revision': revision, 'acknowledgeUnknownConsumption': acknowledge_unknown}
    request_id = UUID(str(request_id))
    previous = c.execute('SELECT * FROM product_material_controls WHERE user_id=%s AND request_id=%s',
                         (user['id'], request_id)).fetchone()
    if previous:
        if previous['job_id'] != row['id'] or previous['action'] != 'upgrade_readers' or previous['payload'] != payload:
            fail('materials_conflict', 'Esta solicitud pertenece a otra acción o revisión.', 409)
        require_exact_control_replay(c, user['id'], request_id,
                                     consent_version, consent_sha256, consent_text)
        return service.get(c, user, sku, job_id)
    consent = control_consent('upgrade_readers', consent_version, consent_sha256, consent_text)
    if product['revision'] != revision:
        fail('product_conflict', 'La ficha ha cambiado. Actualiza antes de ampliar la lectura.', 409)
    if row['status'] not in ('ready', 'paused', 'error') or row['result'].get('protocolVersion') != 2:
        fail('materials_conflict', 'Espera a que termine o se pause el análisis antes de ampliar la lectura.', 409)
    if row['result'].get('operation') in ('upgrade_readers', 'repair_evidence'):
        pending = 'revisión de evidencias' if row['result'].get('operation') == 'repair_evidence' else 'ampliación de lectura'
        fail('materials_conflict', f'Ya hay una {pending} pendiente. Reanuda ese trabajo para continuar.', 409)
    if row['result'].get('pauseReason') == 'source_changed':
        fail('materials_conflict', 'Una fuente cambió. Analiza su nueva versión antes de continuar.', 409)
    require_pinned_engine_project(service, c, user, row)
    active = c.execute("SELECT id FROM product_material_jobs WHERE user_id=%s AND status IN ('queued','running')",
                       (user['id'],)).fetchone()
    if active:
        fail('materials_running', 'Ya hay un análisis en curso en tu cuenta.', 409)
    sources = c.execute('SELECT source_id,data FROM product_material_sources WHERE job_id=%s FOR UPDATE', (row['id'],)).fetchall()
    selected = [source for source in sources if upgrade_eligible(source['data'])]
    if not selected:
        fail('materials_conflict', 'Este análisis ya utiliza los lectores disponibles. Se conservan los resultados.', 409)
    require_only_new_reader_work(c, row, sources)
    for source in selected:
        data = deepcopy(source['data'])
        data.update(pendingReaderUpgrade=True, readerUpgradeOriginalStatus=data.get('status'), readComplete=False, status='pending')
        data.pop('reason', None)
        c.execute('UPDATE product_material_sources SET data=%s,updated_at=now() WHERE job_id=%s AND source_id=%s',
                  (Jsonb(data), row['id'], source['source_id']))
    budget = service.queue.budget(c, row)
    result = deepcopy(row['result'])
    result.update(operation='upgrade_readers', stage='queued', pauseReason=None, error=None,
                  readerUpgrade={'targetVersion': TARGET_READER, 'selectedSources': len(selected),
                                 'sourceIds': [item['source_id'] for item in selected]})
    if result.get('facts'):
        result['facts']['stale'] = True
    c.execute('''UPDATE product_material_jobs SET status='queued',revision=%s,pause_requested=false,
        lease_token=NULL,lease_owner=NULL,lease_until=NULL,max_calls=%s,max_tokens=%s,result=%s,updated_at=now()
        WHERE id=%s''', (revision, budget['usedCalls'] + CALLS_PER_WINDOW,
                        budget['usedTokens'] + budget['reservedTokens'] + TOKENS_PER_WINDOW, Jsonb(result), row['id']))
    c.execute('INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload) VALUES(%s,%s,%s,%s,%s)',
              (user['id'], request_id, row['id'], 'upgrade_readers', Jsonb(payload)))
    record_control_consent(c, row, request_id, 'upgrade_readers', revision, consent)
    return service.get(c, user, sku, job_id)
