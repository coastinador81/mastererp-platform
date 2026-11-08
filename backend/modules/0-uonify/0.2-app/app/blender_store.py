"""Conexión local por cuenta, trabajos acotados y consumo observado, sin tarifas inventadas."""
from datetime import datetime, timezone
from uuid import uuid4
from .access import workspace_access
from .products import fail

COST_POLICY = {'execution':'local','billing':'included_subscription','extraCharge':0}
OPERATIONS = {'inspect_scene','render_preview'}


def iso(value):
    return value.isoformat() if value else None


def require_access(connection, user):
    if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status'] != 'allowed':
        fail('access_required','Activa tu acceso a Uonify para utilizar Blender.',403)


def expire_jobs(connection, user_id):
    connection.execute("""UPDATE blender_jobs SET status='unknown',
        error='No se ha confirmado el resultado. No se repetirá automáticamente.',finished_at=now()
        WHERE user_id=%s AND status='running' AND lease_expires_at<now()""",(user_id,))
    connection.execute("""UPDATE blender_jobs SET status='failed',
        error='El trabajo caducó antes de llegar a Blender.',finished_at=now()
        WHERE user_id=%s AND status='queued' AND created_at<now()-interval '5 minutes'""",(user_id,))


def present_job(row):
    return {'id':str(row['id']),'operation':row['operation'],'status':row['status'],
            'productId':str(row['product_id']) if row.get('product_id') else None,
            'result':row['result'],'error':row['error'],
            'previewUrl':f"/api/connections/blender-local/previews/{row['id']}" if row.get('has_preview') else None,
            'createdAt':iso(row['created_at']),'startedAt':iso(row['started_at']),
            'finishedAt':iso(row['finished_at']),'localDurationMs':row['local_duration_ms']}


def find_job(connection, user_id, job_id):
    row=connection.execute('SELECT *,preview IS NOT NULL AS has_preview FROM blender_jobs WHERE user_id=%s AND id=%s',
                           (user_id,job_id)).fetchone()
    if not row: fail('blender_job_not_found','No se encuentra este trabajo de Blender.',404)
    return row


def connected(agent):
    return bool(agent and not agent['revoked_at'] and agent['available'] and agent['last_seen_at'] and
                (datetime.now(timezone.utc)-agent['last_seen_at']).total_seconds()<30)


def active_agent(connection, user_id):
    return connection.execute('SELECT * FROM blender_agents WHERE user_id=%s AND revoked_at IS NULL',(user_id,)).fetchone()


def require_product(connection,user_id,product_id):
    if product_id is not None and not connection.execute('''SELECT 1 FROM products
        WHERE user_id=%s AND id=%s AND deleted_at IS NULL''',(user_id,product_id)).fetchone():
        fail('product_not_found','No se encuentra este producto en tu cuenta.',404)


def latest_job(connection,user_id,product_id=None,preview_only=False):
    require_product(connection,user_id,product_id)
    query='SELECT *,preview IS NOT NULL AS has_preview FROM blender_jobs WHERE user_id=%s'
    params=[user_id]
    if product_id is not None:
        query+=' AND product_id=%s';params.append(product_id)
    if preview_only:query+=" AND operation='render_preview' AND status='completed' AND preview IS NOT NULL"
    row=connection.execute(query+' ORDER BY created_at DESC LIMIT 1',params).fetchone()
    return present_job(row) if row else None


def status(connection, user, include_usage=True, product_id=None):
    require_product(connection,user['id'],product_id)
    expire_jobs(connection,user['id'])
    agent=active_agent(connection,user['id'])
    state='connected' if connected(agent) else 'offline' if agent else 'disconnected'
    result={'status':state,'productId':str(product_id) if product_id else None,'deviceName':agent['device_name'] if agent else None,
            'blenderVersion':agent['blender_version'] if agent else None,
            'lastSeenAt':iso(agent['last_seen_at']) if agent else None,
            'scene':agent['scene'] if agent else None,'capabilities':agent['capabilities'] if agent else [],
            'costPolicy':dict(COST_POLICY),
            'accessAllowed':bool(user.get('onboarding_completed_at')) and workspace_access(connection,user)['status']=='allowed'}
    if include_usage:
        metrics=connection.execute('''SELECT count(*) AS calls,coalesce(sum(request_bytes),0) AS request_bytes,
            coalesce(sum(response_bytes),0) AS response_bytes,coalesce(sum(backend_duration_ms),0) AS backend_duration_ms
            FROM blender_coordination_usage WHERE user_id=%s''',(user['id'],)).fetchone()
        local=connection.execute('''SELECT coalesce(sum(local_duration_ms),0) AS duration,
            coalesce(sum(octet_length(preview)),0) AS stored_bytes FROM blender_jobs WHERE user_id=%s''',(user['id'],)).fetchone()
        result['usage']={'calls':int(metrics['calls']),'requestBytes':int(metrics['request_bytes']),
                         'responseBytes':int(metrics['response_bytes']),'backendDurationMs':int(metrics['backend_duration_ms']),
                         'localDurationMs':int(local['duration']),'storedPreviewBytes':int(local['stored_bytes']),'estimatedCost':None}
        result['lastJob']=latest_job(connection,user['id'],product_id)
        result['lastPreview']=latest_job(connection,user['id'],product_id,preview_only=True)
    return result


def enqueue(connection, user, request_id, operation, source='nexus', product_id=None):
    # También serializa llamadas internas, sin depender del bloqueo previo de la ruta.
    user=connection.execute('SELECT * FROM users WHERE id=%s FOR UPDATE',(user['id'],)).fetchone()
    if not user:fail('session_required','La cuenta ya no está disponible.',401)
    require_access(connection,user)
    require_product(connection,user['id'],product_id)
    expire_jobs(connection,user['id'])
    previous=connection.execute('SELECT *,preview IS NOT NULL AS has_preview FROM blender_jobs WHERE user_id=%s AND request_id=%s',
                                (user['id'],request_id)).fetchone()
    if previous:
        if previous['operation']!=operation or previous['product_id']!=product_id:
            fail('request_conflict','Este identificador corresponde a otra operación o producto.',409)
        return present_job(previous)
    agent=active_agent(connection,user['id'])
    if not connected(agent): fail('blender_offline','Abre Blender y el conector local antes de continuar.',409)
    if operation not in agent['capabilities']: fail('blender_capability_unavailable','El conector no ofrece esta operación.',409)
    if connection.execute("SELECT 1 FROM blender_jobs WHERE user_id=%s AND status IN ('queued','running')",(user['id'],)).fetchone():
        fail('blender_busy','Blender ya tiene un trabajo en curso.',409)
    row=connection.execute('''INSERT INTO blender_jobs(id,user_id,agent_id,request_id,operation,source,product_id)
        VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING *,false AS has_preview''',
        (uuid4(),user['id'],agent['id'],request_id,operation,source,product_id)).fetchone()
    return present_job(row)


def disconnect(connection, user_id):
    connection.execute('UPDATE blender_agents SET revoked_at=now(),available=false WHERE user_id=%s AND revoked_at IS NULL',(user_id,))
    connection.execute("""UPDATE blender_jobs SET status=CASE WHEN status='running' THEN 'unknown' ELSE 'failed' END,
        error='El conector se ha desvinculado. No se repetirá el trabajo.',finished_at=now()
        WHERE user_id=%s AND status IN ('queued','running')""",(user_id,))
