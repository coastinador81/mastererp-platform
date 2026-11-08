"""Worker durable e independiente del piloto clips-only; la API solo encola trabajo.

ESPEJO de run_conversation_worker.py / run_material_worker.py: proceso aparte cuyo CMD es
`python -m app.run_clips_only_worker`. Construye los 2 handlers REALES (build_clips_only_real_handlers,
creative_clips_only_bootstrap) + el registry de los 5 CREATIVE_STEP_KINDS (build_clips_only_handlers,
creative_clips_only_worker_bootstrap: 2 reales + 3 stubs fail-closed + belt C-WRK-1) y corre el bucle del
runner: claim_and_run_one por iteración + recover_and_reconcile_expired periódico.

INERTE / STAGED: NO se auto-arranca en import (solo bajo `if __name__ == '__main__'`) y NO lo importa main.py;
es el CMD de un servicio worker aparte que arranca la ACTIVACIÓN de go-live (owner-gated). El bucle NO lleva
guard del flag maestro a propósito: la secuencia de go-live arranca el worker con
PRODUCTION_GOOGLE_DISPATCH_ENABLED=False (idle: sin confirmación de cliente no hay paso que reclamar) y el
despacho REAL lo cierran, por-claim y aguas abajo, el gate_decider (confirmación client_explicit vigente) +
el flag maestro (dispatch gate del handler de generación) + el WIF de producción. Fail-closed por diseño.
VUELVE a Consultor + REA.
"""
import logging
import os
import signal
import time
import traceback
from threading import Event
from uuid import uuid4

from .settings import load_settings
from .database import Database
from .google_cloud_provider import GoogleCloudProvider
from .creative_clips_only_bootstrap import build_clips_only_real_handlers
from .creative_clips_only_worker_bootstrap import build_clips_only_handlers
from .creative_execution_runner import (claim_and_run_one,
                                        recover_and_reconcile_expired)
from .creative_google_dispatch_codes import classify_dispatch_error

# Recuperación periódica de reclamaciones expiradas (lease 90s) + reconciliación de tombstones exactos, como
# el purge_expired cada 600s del worker de conversación pero acotado al runner creativo. 60s = pronto tras
# vencer un lease de 90s, sin martillear la BD en cada iteración.
_RECOVER_INTERVAL_SECONDS = 60.0


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    settings = load_settings()
    database = Database(settings.database)
    database.migrate()
    cloud = GoogleCloudProvider(settings)
    generation_handler, storage_adopt_handler = build_clips_only_real_handlers(
        database, settings, cloud)
    handlers = build_clips_only_handlers(
        google_generation_handler=generation_handler,
        storage_adopt_handler=storage_adopt_handler)
    worker_id, stop = 'clips-only-' + uuid4().hex, Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    recovered_at = 0.0
    while not stop.is_set():
        try:
            # Recuperación periódica (y una vez al arrancar: recovered_at=0 ⇒ corre en la 1ª iteración).
            if time.monotonic() - recovered_at > _RECOVER_INTERVAL_SECONDS:
                recover_and_reconcile_expired(database, handlers)
                recovered_at = time.monotonic()
            # Una reclamación por iteración; None = cola vacía ⇒ espera corta interrumpible por la señal.
            if claim_and_run_one(database, settings, worker_id, handlers) is None:
                stop.wait(1)
        except Exception as error:
            # F1+F4 (diagnóstico, D-PROTECCIÓN-safe): loguea el CÓDIGO estable + el TIPO de excepción + un
            # rastro SANEADO del traceback (file:line:func, últimos ~6 marcos) SIN el mensaje/args de la
            # excepción — ahí podrían viajar credenciales / gs:// / project-id / respuesta del cliente; el
            # tipo (nombre de clase) y la ubicación (nuestro propio código) NO. Rompe el punto ciego
            # recurrente (28-10: UNCLASSIFIED = excepción CRUDA cuya causa se perdía en el log terso). El
            # código sigue siendo el 1er token ⇒ el grep discriminante del E2E queda intacto. Solo
            # observabilidad: NO cambia el despacho (0 cargo, flag sigue cerrando el gate aguas abajo).
            code = classify_dispatch_error(error)
            frames = ' <- '.join(
                '%s:%d:%s' % (os.path.basename(f.filename), f.lineno, f.name)
                for f in traceback.extract_tb(error.__traceback__)[-6:])
            logging.error('Clips-only worker failure: %s | %s | %s',
                          code, type(error).__name__, frames)
            stop.wait(3)


if __name__ == '__main__':
    main()
