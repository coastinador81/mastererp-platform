"""Relectura dirigida de evidencia incompleta: nueva unidad, historial y consumo conservados."""
from copy import deepcopy
from hashlib import sha256
from uuid import UUID
from psycopg.types.json import Jsonb
from .products import find, fail, require_access
from .product_materials_controls import CALLS_PER_WINDOW, TOKENS_PER_WINDOW, require_pinned_engine_project
from .product_materials_control_consent import (
    control_consent, record_control_consent, require_exact_control_replay,
)
from .product_materials_resolution import project_resolution, minimal_fragments


def request_repair(service, c, user, sku, job_id, revision, request_id, acknowledge_unknown=False,
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
        if previous['job_id'] != row['id'] or previous['action'] != 'repair_evidence' or previous['payload'] != payload:
            fail('materials_conflict', 'Esta solicitud pertenece a otra acción o revisión.', 409)
        require_exact_control_replay(c, user['id'], request_id,
                                     consent_version, consent_sha256, consent_text)
        return service.get(c, user, sku, job_id)
    consent = control_consent('repair_evidence', consent_version, consent_sha256, consent_text)
    # The current visible copy does not quantify the additional 200-call,
    # 1M-token block. Keep new work closed until that decision is approved.
    fail('materials_repair_consent_required',
         'Esta reparación puede abrir otro bloque de hasta 200 llamadas y 1.000.000 de tokens en tu proyecto de Google. Tus resultados se conservan; espera a que puedas revisar y autorizar ese alcance.', 409)
    if product['revision'] != revision:
        fail('product_conflict', 'La ficha ha cambiado. Actualiza antes de resolver la lectura.', 409)
    if (row['status'] not in ('ready', 'paused', 'error') or row['result'].get('protocolVersion') != 2
            or row['result'].get('operation') in ('upgrade_readers', 'repair_evidence')
            or row['result'].get('pauseReason') == 'source_changed'):
        fail('materials_conflict', 'Termina o reanuda la operación pendiente antes de resolver la lectura.', 409)
    require_pinned_engine_project(service, c, user, row)
    active = c.execute("SELECT id FROM product_material_jobs WHERE user_id=%s AND status IN ('queued','running')", (user['id'],)).fetchone()
    if active:
        fail('materials_running', 'Ya hay un análisis en curso en tu cuenta.', 409)
    sources = [s['data'] for s in c.execute('SELECT data FROM product_material_sources WHERE job_id=%s', (row['id'],)).fetchall()]
    resolution = project_resolution(sources, minimal_fragments(c, row['id']), row['result'].get('facts'))
    selected = [i['fragmentId'] for i in resolution['issues'] if i.get('action') == 'repair_evidence']
    if not selected:
        fail('materials_conflict', 'No quedan partes con evidencia técnica reparable. Revisa los datos con Uony.', 409)
    unknown = c.execute("SELECT id FROM product_material_calls WHERE job_id=%s AND state='unknown' AND acknowledged_at IS NULL LIMIT 1", (row['id'],)).fetchone()
    if unknown and not acknowledge_unknown:
        fail('materials_consumption_unknown', 'Una llamada anterior pudo consumir recursos. Confirma la reanudación antes de resolver la lectura.', 409)
    if unknown:
        c.execute("UPDATE product_material_calls SET acknowledged_at=now() WHERE job_id=%s AND state='unknown' AND acknowledged_at IS NULL", (row['id'],))
    fragments = c.execute('SELECT * FROM product_material_fragments WHERE job_id=%s AND id=ANY(%s) FOR UPDATE', (row['id'], selected)).fetchall()
    repaired_ids = []
    for old in fragments:
        number = (old['payload'].get('repairRound') or 0) + 1
        identifier = sha256((old['id'] + ':evidence-refs-v1:' + str(number)).encode()).hexdigest()
        child = {**deepcopy(old['payload']), 'repairOf': old['id'], 'repairRound': number,
                 'citationProfile': 'evidence-refs-v1'}
        # La parte puede proceder de una subdivisión; el nuevo ID es una raíz reparable
        # y no debe saltarse por conservar el parentId de la subdivisión anterior.
        child.pop('parentId', None)
        c.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,payload,state)
                     VALUES(%s,%s,%s,%s,%s,%s,'pending') ON CONFLICT(job_id,id) DO NOTHING''',
                  (row['id'], identifier, old['source_id'], old['version'], old['locator'], Jsonb(child)))
        c.execute("UPDATE product_material_fragments SET state='superseded',payload=payload || %s,updated_at=now() WHERE job_id=%s AND id=%s",
                  (Jsonb({'repairReplacedBy': identifier}), row['id'], old['id']))
        repaired_ids.append(identifier)
    budget = service.queue.budget(c, row)
    result = deepcopy(row['result'])
    result.update(operation='repair_evidence', stage='queued', pauseReason=None, error=None,
                  evidenceRepair={'profile': 'evidence-refs-v1', 'selectedFragments': len(fragments),
                                  'fragmentIds': repaired_ids})
    if result.get('facts'):
        result['facts']['stale'] = True
    c.execute('''UPDATE product_material_jobs SET status='queued',revision=%s,pause_requested=false,
        lease_token=NULL,lease_owner=NULL,lease_until=NULL,max_calls=%s,max_tokens=%s,result=%s,updated_at=now()
        WHERE id=%s''', (revision, budget['usedCalls'] + CALLS_PER_WINDOW,
                        budget['usedTokens'] + budget['reservedTokens'] + TOKENS_PER_WINDOW, Jsonb(result), row['id']))
    c.execute('INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload) VALUES(%s,%s,%s,%s,%s)',
              (user['id'], request_id, row['id'], 'repair_evidence', Jsonb(payload)))
    record_control_consent(c, row, request_id, 'repair_evidence', revision, consent)
    return service.get(c, user, sku, job_id)
