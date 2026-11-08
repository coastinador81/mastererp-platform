"""CLI INERTE (go-live, owner-gated): re-encola un storage_adopt 'failed' y re-conduce SOLO la adopción
de un clip YA generado y pagado (0 POST Veo, 0 re-cargo). La ejecuta la interfaz desde el contenedor api
con OK explícito del dueño, job a job. NO se importa en el arranque ni lo monta main.py; es un comando
aparte, espejo del bootstrap de conexión de run_clips_only_worker.

Uso:  python -m app.requeue_failed_internal_step_cli --job <uuid>

Resuelve el user_id dueño del job y su paso storage_adopt desde el job_id, abre UNA transacción con la
conexión de la app (misma vía que el worker) y llama requeue_failed_internal_step — guard hermético:
kind='storage_adopt' + provider_call=false + padre google_generation 'succeeded' con EXACTAMENTE 1 intento
succeeded; jamás re-encola una generación (no re-POST = 0 cargo). Imprime el resultado en JSON.

ADMISIÓN: el claim posterior del worker revalida la cotización (expires_at) y fallaría un step de un job
caducado. Ejecútese ANTES de expires_at. (La recuperación post-caducidad exigiría un bypass del claim path
—require_unexpired=False solo para storage_adopt— que NO se incluye aquí; pídelo si hace falta.)"""
import argparse
import json
import sys
from uuid import UUID

from .settings import load_settings
from .database import Database
from .creative_execution_coordinator import requeue_failed_internal_step


def _resolve_job(c, job_id: str):
    job = c.execute(
        'SELECT user_id FROM creative_execution_jobs WHERE id=%s', (job_id,)).fetchone()
    if not job:
        return None, None
    step = c.execute(
        '''SELECT step_id FROM creative_execution_steps
           WHERE user_id=%s AND job_id=%s AND kind='storage_adopt' LIMIT 1''',
        (job['user_id'], job_id)).fetchone()
    return job['user_id'], (step['step_id'] if step else None)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog='python -m app.requeue_failed_internal_step_cli',
        description=('Re-encola un storage_adopt failed para re-conducir la adopción '
                     'de un clip ya pagado (0 cargo).'))
    parser.add_argument('--job', required=True, help='UUID del creative_execution_job')
    args = parser.parse_args(argv)
    try:
        job_id = str(UUID(str(args.job)))
    except ValueError:
        print(json.dumps({'requeued': False, 'reason': 'invalid_job_id'}))
        return 2
    settings = load_settings()
    database = Database(settings.database)
    with database.connect() as c:
        user_id, step_id = _resolve_job(c, job_id)
        if not user_id or not step_id:
            result = {'requeued': False, 'reason': 'job_or_adoption_step_not_found'}
        else:
            result = requeue_failed_internal_step(c, str(user_id), job_id, str(step_id))
    print(json.dumps(result, default=str))
    return 0 if result.get('requeued') else 1


if __name__ == '__main__':
    sys.exit(main())
