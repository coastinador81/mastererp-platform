"""Idempotent user pause/resume; resuming uncertain calls is an explicit decision."""
from uuid import UUID
from psycopg.types.json import Jsonb
from .products import fail, find, require_access

CALLS_PER_WINDOW, TOKENS_PER_WINDOW = 200, 1000000


def require_pinned_engine_project(service, c, user, row):
    """Check an existing job before any action that can queue it again."""
    if not row['project_id']:
        fail('materials_project_unpinned', 'Este análisis antiguo no conservó el proyecto de Google. Inicia uno nuevo para evitar cargos en otro proyecto.', 409)
    if not service.engine_enabled_for(user['id'], row['engine']):
        fail('materials_engine_unavailable', 'El motor de este análisis no está disponible. Conservamos sus resultados sin cambiarlo por otro.', 409)
    current_project = service.credentials(c, user, refresh=False)[1][0]['project_id']
    if current_project != row['project_id']:
        fail('materials_project_changed', 'El proyecto de Google cambió. Inicia un análisis nuevo para evitar cargos en otro proyecto.', 409)


def control(service, c, user, sku, job_id, action, revision, request_id, acknowledge_unknown=False):
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
        if previous['job_id'] != row['id'] or previous['action'] != action or previous['payload'] != payload:
            fail('materials_conflict', 'Esta solicitud pertenece a otra acción o revisión.', 409)
        return service.get(c, user, sku, job_id)
    if product['revision'] != revision:
        fail('product_conflict', 'La ficha ha cambiado. Actualiza antes de continuar el análisis.', 409)
    if action == 'pause':
        if row['status'] not in ('queued', 'running', 'paused'):
            fail('materials_conflict', 'Este análisis no está en curso.', 409)
        if row['status'] == 'queued':
            c.execute("""UPDATE product_material_jobs SET status='paused',pause_requested=true,updated_at=now(),
                result=result || %s WHERE id=%s""", (Jsonb({'stage': 'paused', 'pauseReason': 'user_requested'}), row['id']))
        else:
            c.execute('UPDATE product_material_jobs SET pause_requested=true,updated_at=now() WHERE id=%s', (row['id'],))
    else:
        if row['status'] not in ('paused', 'error') or row['result'].get('protocolVersion') != 2 or row['result'].get('pauseReason') == 'source_changed':
            fail('materials_conflict', 'Este análisis no tiene una continuación pendiente. Los resultados se conservan.', 409)
        if row['result'].get('pauseReason') == 'budget_exhausted':
            fail('materials_budget_consent_required',
                 'Se agotó el presupuesto de este análisis. Abrir otro bloque puede consumir recursos de Google y requiere una autorización específica. Tus resultados se conservan.', 409)
        require_pinned_engine_project(service, c, user, row)
        active = c.execute("SELECT id FROM product_material_jobs WHERE user_id=%s AND status IN ('queued','running') AND id<>%s",
                           (user['id'], row['id'])).fetchone()
        if active:
            fail('materials_running', 'Ya hay un análisis en curso en tu cuenta.', 409)
        unknown = c.execute("""SELECT id FROM product_material_calls WHERE job_id=%s AND state='unknown'
            AND acknowledged_at IS NULL LIMIT 1""", (row['id'],)).fetchone()
        if unknown and not acknowledge_unknown:
            fail('materials_consumption_unknown', 'Una llamada anterior puede haber consumido recursos sin devolver resultado. Confirma la reanudación para repetir solo esa parte.', 409)
        if unknown:
            c.execute("UPDATE product_material_calls SET acknowledged_at=now() WHERE job_id=%s AND state='unknown' AND acknowledged_at IS NULL", (row['id'],))
        c.execute("UPDATE product_material_fragments SET state='pending',updated_at=now() WHERE job_id=%s AND state IN ('error','unknown')", (row['id'],))
        result = {**row['result'], 'stage': 'queued', 'pauseReason': None, 'error': None, 'canResume': False}
        if revision != row['revision']:
            result['resumedAtRevision'] = revision
        c.execute('''UPDATE product_material_jobs SET status='queued',revision=%s,pause_requested=false,
            lease_token=NULL,lease_owner=NULL,lease_until=NULL,max_calls=%s,max_tokens=%s,result=%s,updated_at=now()
            WHERE id=%s''', (revision, row['max_calls'], row['max_tokens'], Jsonb(result), row['id']))
    c.execute('INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload) VALUES(%s,%s,%s,%s,%s)',
              (user['id'], request_id, row['id'], action, Jsonb(payload)))
    return service.get(c, user, sku, job_id)
