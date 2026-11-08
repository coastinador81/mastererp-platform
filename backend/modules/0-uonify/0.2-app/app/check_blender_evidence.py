"""Consulta administrativa local, solo lectura y columnas permitidas; nunca imprime credenciales."""
import argparse
import json
import sys
from .database import Database
from .settings import load_settings


def evidence(database,email):
    with database.connect() as connection:
        connection.execute('SET TRANSACTION READ ONLY')
        user=connection.execute('SELECT id,email FROM users WHERE lower(email)=lower(%s)',(email,)).fetchone()
        if not user:
            return {'error':'account_not_found','message':'No se encuentra esa cuenta local.'}
        agents=connection.execute('''SELECT device_name,blender_version,last_seen_at,available,
            revoked_at IS NOT NULL AS revoked FROM blender_agents WHERE user_id=%s ORDER BY created_at DESC''',
            (user['id'],)).fetchall()
        jobs=connection.execute('''SELECT j.id,j.product_id,p.sku,p.data->>'name' AS product_name,
            j.source,j.operation,j.status,j.created_at,j.started_at,j.finished_at,j.local_duration_ms,
            coalesce(octet_length(j.preview),0) AS preview_bytes,
            j.result->'scene'->>'name' AS scene_name,j.result->'scene'->>'fileName' AS file_name,
            j.result->'scene'->>'objectCount' AS object_count
            FROM blender_jobs j LEFT JOIN products p ON p.user_id=j.user_id AND p.id=j.product_id
            WHERE j.user_id=%s ORDER BY j.created_at DESC LIMIT 20''',(user['id'],)).fetchall()
        usage=connection.execute('''SELECT count(*) AS calls,
            coalesce(sum(request_bytes),0)::bigint AS request_bytes,
            coalesce(sum(response_bytes),0)::bigint AS response_bytes,
            coalesce(sum(backend_duration_ms),0)::bigint AS backend_duration_ms
            FROM blender_coordination_usage WHERE user_id=%s''',(user['id'],)).fetchone()
        local=connection.execute('''SELECT coalesce(sum(local_duration_ms),0)::bigint AS local_duration_ms,
            coalesce(sum(octet_length(preview)),0)::bigint AS stored_preview_bytes,
            count(*) FILTER(WHERE status='unknown') AS unconfirmed_jobs
            FROM blender_jobs WHERE user_id=%s''',(user['id'],)).fetchone()
        return {'accountEmail':user['email'],'agents':agents,'jobs':jobs,'usage':{**usage,**local},
                'billing':'included_subscription','extraCharge':0,'estimatedCost':None}


def main():
    parser=argparse.ArgumentParser(description='Evidencia privada de Blender local: solo lectura, sin secretos.')
    parser.add_argument('--email',required=True,help='Cuenta Uonify autorizada para esta comprobación.')
    args=parser.parse_args()
    try:
        result=evidence(Database(load_settings().database),args.email)
        print(json.dumps(result,ensure_ascii=False,default=str,indent=2))
        return 1 if 'error' in result else 0
    except Exception:
        # La excepción podría contener conexión o configuración: no se imprime.
        print(json.dumps({'error':'evidence_unavailable','message':'No se pudo leer la evidencia local.'}))
        return 1


if __name__=='__main__':
    sys.exit(main())
