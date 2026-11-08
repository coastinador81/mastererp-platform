"""(d) Persistencia de la confirmación por generación (mundo 090). SQL — vuelve al Consultor + REA.

Implementa los puertos de `creative_clips_only_confirmation` sobre la tabla `creative_execution_confirmations`
(migración 135) + la lectura de confirmabilidad del ledger 090. Todo keyed por (user_id, job_id,
request_sha256); DESAMBIGUA por request_sha256 (un job con varios clips → varias operaciones
google_generation, cada una su request_sha256). STAGED + INERTE: sin ruta montada ni llamador vivo; la ruta
FastAPI y el cableado (el handler que invoca confirm_generation con el user de la SESIÓN) vuelven al
Consultor + REA. D-PROTECCIÓN: no expone coste ni ids al cliente.
"""
from __future__ import annotations

from .creative_clips_only_confirmation import (ConfirmableGeneration,
                                               GenerationConfirmation)


class StoredConfirmableReader:
    """`ConfirmableGenerationReader` sobre el ledger 090. Un job es confirmable para un request_sha256 si:
    es del usuario, está admitido/held y aún no despachado (dispatch_authorized=false), y ese sha es el de
    una operación google_generation con llamada a proveedor de su cotización (match
    operationId↔step.request_operation_id). FUENTE AUTORITATIVA = el array de operaciones de la cotización
    en `q.quote_snapshot->'execution'->'requestOperations'` (la MISMA que rehidrata el ledger 090:
    rehydration._rehydrate_execution lee quote_snapshot['execution']['requestOperations']; cada op tiene
    operationId/requestSnapshot/requestSha256). El quote_snapshot es inmutable (ligado por quote_sha256),
    así que el sha confirmado solo puede ser el de una operación REALMENTE cotizada = anti-mutación en DB."""

    def confirmable(self, c, *, user_id: str, job_id: str,
                    request_sha256: str) -> ConfirmableGeneration | None:
        row = c.execute(
            '''SELECT 1 FROM creative_execution_jobs j
               JOIN creative_execution_approvals a
                 ON a.user_id=j.user_id AND a.id=j.approval_id
               JOIN creative_execution_quotes q
                 ON q.user_id=a.user_id AND q.id=a.quote_id
               WHERE j.user_id=%s AND j.id=%s
                 AND j.status IN ('queued','held') AND j.dispatch_authorized=false
                 AND EXISTS (
                     SELECT 1 FROM creative_execution_steps s
                     WHERE s.user_id=j.user_id AND s.job_id=j.id
                       AND s.kind='google_generation' AND s.provider_call=true
                       AND EXISTS (
                           SELECT 1 FROM jsonb_array_elements(
                               q.quote_snapshot->'execution'->'requestOperations') op
                           WHERE op->>'requestSha256'=%s
                             AND op->>'operationId'=s.request_operation_id::text))''',
            (user_id, job_id, request_sha256)).fetchone()
        if not row:
            return None
        return ConfirmableGeneration(user_id=user_id, job_id=job_id,
                                     request_sha256=request_sha256, confirmable=True)


class PostgresGenerationConfirmationStore:
    """`GenerationConfirmationStore`: persiste la confirmación en la txn de la petición del cliente. El
    trigger write-once/account_write_allowed (migración 135) protege el contenido; ON CONFLICT DO NOTHING
    hace la escritura idempotente (re-confirmar el mismo (user,job,sha) no muta nada)."""

    def record(self, c, confirmation: GenerationConfirmation) -> None:
        c.execute(
            '''INSERT INTO creative_execution_confirmations
               (user_id, job_id, request_sha256, source, confirmed_at)
               VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (user_id, job_id, request_sha256) DO NOTHING''',
            (confirmation.user_id, confirmation.job_id, confirmation.request_sha256,
             confirmation.source, confirmation.confirmed_at))


def generation_confirmation_fetch(database):
    """`fetch` para el `StoredGenerationConfirmationLookup` del gate: el gate_decider corre SIN conexión,
    así que gestiona su propia lectura. Devuelve la GenerationConfirmation persistida o None."""
    def fetch(*, user_id, job_id, request_sha256):
        with database.connect() as c:
            row = c.execute(
                '''SELECT source, confirmed_at FROM creative_execution_confirmations
                   WHERE user_id=%s AND job_id=%s AND request_sha256=%s''',
                (user_id, job_id, request_sha256)).fetchone()
        if not row:
            return None
        return GenerationConfirmation(
            user_id=user_id, job_id=job_id, request_sha256=request_sha256,
            confirmed_at=row['confirmed_at'], source=row['source'])
    return fetch
