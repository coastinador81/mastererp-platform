"""Ruta de CONFIRMACIÓN de generación clips-only — el acto del CLIENTE que abre el gate de gasto 090.

Es la única superficie HTTP del gasto de clips-only (el modelo no tiene ruta → no puede fabricar un
gasto). Monta el núcleo seguro `confirm_generation` con el reader/store reales (ledger 090 + migración
135). Mirror EXACTO del patrón de `creative_generation_routes.routes`: `require_user` saca el usuario de
la SESIÓN autenticada (cookie→sessions→users), NUNCA del cuerpo; `require_origin` cierra CSRF en el POST;
`StrictBody` rechaza campos extra.

SEGURIDAD:
  * session_user_id = require_user(c,request)['id'] → la confirmación se liga al usuario de la sesión.
    El cuerpo solo trae jobId + requestSha256 (NO user_id): un cliente no puede confirmar por otro.
  * DEFENSA EN PROFUNDIDAD (interfaz 27-10, decisión técnica): se exige job.thread_id == el {thread_id}
    del path, con el MISMO user de sesión, antes de confirmar. El thread no es la frontera de gasto (lo es
    sesión+job→user+sha), pero añade una comprobación barata de contexto de ruteo.
  * confirm_generation re-valida: job confirmable del PROPIO usuario, no despachado, y sha == el aprobado
    (anti-mutación); fail-closed.
  * ERROR UNIFORME (interfaz 27-10): TODO fallo — thread que no cuadra, job inexistente/ajeno, no
    confirmable, sha mutado — devuelve el MISMO 400 genérico `_NOT_CONFIRMABLE`, sin revelar la existencia
    del job ni el motivo. Mínima superficie, fail-closed.
  * require_user hace SELECT ... FOR UPDATE OF users → serializa confirmaciones concurrentes del mismo
    usuario; el INSERT ON CONFLICT DO NOTHING del store las hace idempotentes.
  * D-PROTECCIÓN: la respuesta no expone €, tokens ni ids internos (solo {status}).

STAGED + INERTE: `routes(...)` NO se incluye en main.create_app todavía. Montarla (include_router) +
el persist (b) del bucket vivo + la credencial PATH A son el CABLEADO que vuelve al Consultor + REA con
el OK del dueño. Hasta entonces, diseño a validar.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from .creative_clips_only_confirmation import (ClipsOnlyConfirmationError,
                                               confirm_generation)
from .creative_clips_only_confirmation_store import (
    PostgresGenerationConfirmationStore, StoredConfirmableReader)
from .onboarding import StrictBody, require_user
from .security import require_origin


class ConfirmClipGeneration(StrictBody):
    jobId: UUID = Field(strict=False)
    requestSha256: str = Field(pattern=r'^[0-9a-f]{64}$')


# Respuesta ÚNICA para todo fallo (sin revelar existencia del job ni el motivo).
_NOT_CONFIRMABLE = {'error': 'not_confirmable',
                    'message': 'No se pudo confirmar esta generación.'}


def routes(settings, database):
    router = APIRouter(
        prefix='/api/uony/threads/{thread_id}/creative-clips')
    reader = StoredConfirmableReader()
    store = PostgresGenerationConfirmationStore()

    @router.post('/confirmations')
    def confirm(thread_id: str, body: ConfirmClipGeneration, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            session_user_id = str(require_user(c, request)['id'])
            # Defensa en profundidad: el job debe ser del MISMO usuario Y de ESTE thread.
            in_thread = c.execute(
                '''SELECT 1 FROM creative_execution_jobs
                   WHERE user_id=%s AND id=%s AND thread_id=%s''',
                (session_user_id, str(body.jobId), thread_id)).fetchone()
            if not in_thread:
                raise HTTPException(400, detail=_NOT_CONFIRMABLE)
            try:
                confirm_generation(
                    c, reader=reader, store=store,
                    session_user_id=session_user_id, job_id=str(body.jobId),
                    request_sha256=body.requestSha256,
                    now=datetime.now(timezone.utc))
            except ClipsOnlyConfirmationError:
                raise HTTPException(400, detail=_NOT_CONFIRMABLE) from None
        return {'status': 'confirmed'}

    return router
