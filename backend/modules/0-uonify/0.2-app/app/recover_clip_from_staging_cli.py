"""CLI de RECUPERACIÓN por STAGING (go-live, owner-gated): re-conduce la adopción de un clip YA
generado+pagado cuyo LRO Veo puede haber caducado, por el camino STAGING-by-prefix (lista el objeto en
GCS SIN poll al LRO → adopta al nombre canónico create-only), 0 POST Veo, 0 re-cargo.

Uso:  python -m app.recover_clip_from_staging_cli --job <uuid>

Ejecútala la interfaz desde el contenedor api con OK explícito del dueño, job a job. NO se importa en el
arranque ni la monta main.py; es un comando aparte, espejo del bootstrap de conexión del worker.

DIFERENCIA con `requeue_failed_internal_step_cli` (que solo re-encola y deja que el worker NORMAL adopte
por POLL = `GoogleAdoptionClaimHandler` → `run_google_adoption_once`): esta CLI re-encola Y reclama ella
misma el storage_adopt con el handler de STAGING (`GoogleStagingRecoveryClaimHandler` →
`adopt_from_staging`), pasando `allow_expired_admission=True`. Necesaria cuando el LRO ya es viejo y el
poll no devuelve `done=true` (el objeto persiste en GCS aunque fetchPredictOperation ya no responda done).

MONEY-SAFE (verifíquenlo Consultor+REA; es spend/dispatch-adjacent):
  * Adopción `provider_call=false`: `adopt_from_staging` = LIST GET del prefijo op-scoped persistido +
    rewrite GCS create-only (412→recibo existente). 0 POST Veo, 0 re-cargo.
  * `requeue_failed_internal_step` es HERMÉTICO: re-encola SOLO un storage_adopt (provider_call=false) con
    error_code re-conducible, y SOLO si el padre google_generation está 'succeeded' con EXACTAMENTE un
    intento succeeded durable (prueba de que se generó y se cobró). NUNCA re-encola una generación.
  * Tras un requeue OK, la generación del job es 'succeeded' (terminal) ⇒ `claim_and_run_one(job_id=...)`
    NO puede reclamarla (solo toma pasos 'queued'); solo reclama el storage_adopt re-encolado.
  * `allow_expired_admission` relaja SOLO la vigencia de la cotización PARA storage_adopt
    (creative_execution_coordinator claim_creative_step: el bypass se condiciona a kind=='storage_adopt');
    NUNCA relaja una puerta de gasto ni la vigencia de una generación.
  * Esta CLI NO lleva el gate-check de `run_clips_only_worker_once` (PRODUCTION_GOOGLE_DISPATCH_ENABLED) A
    PROPÓSITO: la recuperación es SOLO-adopción y corre con el gate maestro en False (imagen jB-original).
    El handler de generación del registry nunca se reclama (step terminal) y, si se reclamara, el dispatch
    gate aguas abajo (flag False + gate_decider) lo cerraría igualmente ⇒ 0 POST por construcción.

Resultado: adopta el clip a SU PROPIO asset (asset_id job-scoped del fix de entrega) → entrega a Drive.
Si el objeto de staging caducó (0 objetos, pasada la ventana de render) ⇒ terminal limpio
'staging_absent_past_deadline' (0 re-cargo; el clip no es recuperable sin re-generar). Imprime JSON.
VUELVE a Consultor + REA.
"""
import argparse
import json
import sys
import time
from uuid import UUID, uuid4

import requests

from .settings import load_settings
from .database import Database
from .google_cloud_provider import GoogleCloudProvider
from .creative_clips_only_adoption_loader import ClipsOnlyAdoptionLoader
from .creative_clips_only_bootstrap import (build_clips_only_real_handlers,
                                            make_token_provider_factory)
from .creative_clips_only_worker_bootstrap import build_clips_only_handlers
from .creative_google_adoption_runner import GoogleStagingRecoveryClaimHandler
from .creative_execution_coordinator import requeue_failed_internal_step
from .creative_execution_runner import claim_and_run_one

# Cota de iteraciones: una adopción de un clip ya renderizado = 1 claim síncrono; el margen cubre una
# continuación de rewrite ('adopting_continuation'). NO es un bucle de espera: claim_and_run_one corre el
# handler síncronamente hasta terminar cada intento.
_MAX_CLAIMS = 5


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


def _job_status(database, job_id: str):
    with database.connect() as c:
        row = c.execute(
            'SELECT status FROM creative_execution_jobs WHERE id=%s', (job_id,)).fetchone()
        return row['status'] if row else None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog='python -m app.recover_clip_from_staging_cli',
        description=('Re-conduce la adopción por STAGING de un clip ya pagado '
                     '(0 POST Veo, 0 re-cargo).'))
    parser.add_argument('--job', required=True, help='UUID del creative_execution_job')
    args = parser.parse_args(argv)
    try:
        job_id = str(UUID(str(args.job)))
    except ValueError:
        print(json.dumps({'recovered': False, 'reason': 'invalid_job_id'}))
        return 2

    settings = load_settings()
    database = Database(settings.database)
    cloud = GoogleCloudProvider(settings)

    # 1) Re-encolar el storage_adopt 'failed' (guard hermético: solo adopción, nunca generación).
    with database.connect() as c:
        user_id, step_id = _resolve_job(c, job_id)
        if not user_id or not step_id:
            print(json.dumps({'recovered': False,
                              'reason': 'job_or_adoption_step_not_found'}))
            return 1
        requeue = requeue_failed_internal_step(c, str(user_id), job_id, str(step_id))
    if not requeue.get('requeued'):
        print(json.dumps({'recovered': False, 'stage': 'requeue', **requeue},
                         default=str))
        return 1

    # 2) Registry con el handler de STAGING para storage_adopt (NO el de poll). El handler de generación
    #    (real, nunca reclamado: su step es terminal) + los 3 stubs fail-closed los pone build_clips_only_
    #    handlers con su belt C-WRK-1. El asset_id job-scoped lo aporta el ClipsOnlyAdoptionLoader del fix.
    generation_handler, _poll_adopt = build_clips_only_real_handlers(
        database, settings, cloud)
    factory = make_token_provider_factory(database, settings, cloud)
    staging_handler = GoogleStagingRecoveryClaimHandler(
        database, settings,
        context_loader=ClipsOnlyAdoptionLoader(token_provider_factory=factory),
        session_factory=lambda: requests.Session(), max_attempts=_MAX_CLAIMS)
    handlers = build_clips_only_handlers(
        google_generation_handler=generation_handler,
        storage_adopt_handler=staging_handler)

    # 3) Reclamar+correr SOLO este job hasta terminal (allow_expired_admission relaja la vigencia SOLO para
    #    storage_adopt). claim_and_run_one es síncrono (corre el handler hasta terminar el intento).
    worker_id = 'clips-recover-' + uuid4().hex
    for _ in range(_MAX_CLAIMS):
        claim_and_run_one(database, settings, worker_id, handlers,
                          job_id=UUID(job_id), allow_expired_admission=True)
        status = _job_status(database, job_id)
        if status in ('succeeded', 'failed'):
            break
        time.sleep(1)

    final = _job_status(database, job_id)
    print(json.dumps({'recovered': final == 'succeeded', 'job_status': final},
                     default=str))
    return 0 if final == 'succeeded' else 1


if __name__ == '__main__':
    sys.exit(main())
