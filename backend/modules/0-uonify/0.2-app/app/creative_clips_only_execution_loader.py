"""Adaptador `execution_loader` para el ClipsOnlyLiveProvider (cabling de interfaz). STAGED + INERTE.

El `ClipsOnlyLiveProvider.resolve()` llama `execution_loader(c, owner, claim)` y pasa el resultado a
`validate_active_execution_scope` (creative_execution_ledger), que exige un dict con 'planId'/'planRevision'.
Este adaptador reconstruye ESE dict desde las filas durables del job del claim, SIN red ni gasto:
rehidrata la ejecución admitida (ledger 090), toma su `quote_id`, y devuelve
`creative_execution_quotes.quote_snapshot['execution']` — la MISMA fuente que usa el resto de la familia
creativa (creative_craft_authority.py:189, creative_clips_only_live_provider.py:25). Reusa la conexión/txn
`c` del resolve (ya tiene el FOR SHARE sobre users). Fail-closed DETERMINISTA: cualquier incoherencia
(job no rehidratable, quote ausente, snapshot sin 'execution') ⇒ ValueError y 0 despacho.
"""
from __future__ import annotations

from uuid import UUID

from .creative_google_dispatch_codes import EXECUTION_LOADER_INVALID


class ClipsOnlyExecutionLoaderError(ValueError):
    """Fail-closed DETERMINISTA: no se pudo reconstruir el 'execution' durable del claim.

    Extiende ValueError (no Exception) para alinear con los rechazos deterministas de la familia
    clips-only (ClipsOnlyContextError, run_google_generation_once): el recover lo clasifica terminal y
    no re-encola un fallo que volvería a fallar. 0 POST: corre antes de cualquier despacho.

    F1: porta dispatch_code=EXECUTION_LOADER_INVALID para el log del worker (sin exponer el mensaje).
    """

    dispatch_code = EXECUTION_LOADER_INVALID


def clips_only_execution_loader(c, owner: dict, claim) -> dict:
    """Devuelve el dict `execution` (planId/planRevision/requestOperations/…) del quote del job del claim.

    `c` es la conexión/txn del `resolve` del live_provider (reusa la misma; no abre otra). `owner` es la
    fila de `users` ya cargada (FOR SHARE) por el resolve.
    """
    from .creative_execution_rehydration import rehydrate_admitted_execution
    restored = rehydrate_admitted_execution(
        c, owner, UUID(str(claim.job_id)), lock_reads=True)
    quote_id = getattr(restored, 'quote_id', None)
    if not quote_id:
        raise ClipsOnlyExecutionLoaderError('La ejecución rehidratada no trae quote_id.')
    row = c.execute(
        'SELECT quote_snapshot FROM creative_execution_quotes WHERE user_id=%s AND id=%s',
        (owner['id'], quote_id)).fetchone()
    snapshot = row.get('quote_snapshot') if row else None
    if not isinstance(snapshot, dict):
        raise ClipsOnlyExecutionLoaderError('La cotización del job no tiene quote_snapshot.')
    execution = snapshot.get('execution')
    if not isinstance(execution, dict):
        raise ClipsOnlyExecutionLoaderError('El quote_snapshot no contiene un execution válido.')
    return execution
