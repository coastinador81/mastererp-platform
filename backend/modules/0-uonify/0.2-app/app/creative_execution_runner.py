"""Inactive shared runner for already admitted creative execution jobs.

This is the only prepared caller of ``claim_creative_step``. A complete
handler registry is required before claiming so a partial worker cannot steal
another step kind. No scheduler, route or process activates this module.
"""

from dataclasses import dataclass
from queue import Empty, Queue
from threading import Thread
from typing import Protocol
from uuid import UUID, uuid4

from .creative_execution_coordinator import (CreativeAttemptClaim,
    CreativeLeaseLost, claim_creative_step, recover_expired_creative_attempts,
    renew_creative_lease)
from .creative_composite_quote import canonical_sha256


CREATIVE_STEP_KINDS = frozenset({
    'google_generation', 'storage_adopt', 'craft', 'candidate_adopt', 'review'})
_TERMINAL_ATTEMPT_STATES = frozenset({
    'succeeded', 'failed', 'unknown', 'cancelled'})
_RECONCILIATION_MAX_ATTEMPTS = 8


class CreativeClaimHandler(Protocol):
    def run(self, claim: CreativeAttemptClaim):
        ...

    def cancel(self, claim: CreativeAttemptClaim) -> bool:
        ...


@dataclass(frozen=True)
class CreativeRunnerResult:
    claim: CreativeAttemptClaim
    handler_result: object


@dataclass(frozen=True)
class CreativeDurableOutcome:
    status: str
    result_sha256: str


def _durable_success(database, claim: CreativeAttemptClaim
                     ) -> CreativeDurableOutcome | None:
    with database.connect() as connection:
        row = connection.execute('''SELECT a.status,a.result_sha256,
            a.result_receipt,a.job_id,a.step_id,a.attempt_no,
            a.claim_lease_token,a.fence_epoch,a.admission_sha256,
            a.claim_set_sha256,s.kind,s.provider_call
            FROM creative_execution_attempts a
            JOIN creative_execution_steps s ON s.user_id=a.user_id
              AND s.job_id=a.job_id AND s.step_id=a.step_id
            WHERE a.user_id=%s AND a.id=%s''',
            (claim.user_id, claim.attempt_id)).fetchone()
    if (row and row['status'] == 'succeeded'
            and isinstance(row['result_sha256'], str)
            and len(row['result_sha256']) == 64
            and isinstance(row['result_receipt'], dict)
            and canonical_sha256(row['result_receipt']) == row['result_sha256']
            and str(row['job_id']) == claim.job_id
            and str(row['step_id']) == claim.step_id
            and row['attempt_no'] == claim.attempt_no
            and str(row['claim_lease_token']) == claim.lease_token
            and row['fence_epoch'] == claim.fence_epoch
            and row['admission_sha256'] == claim.admission_sha256
            and row['claim_set_sha256'] == claim.claim_set_sha256
            and row['kind'] == claim.kind
            and row['provider_call'] == claim.provider_call):
        return CreativeDurableOutcome('succeeded', row['result_sha256'])
    return None


def _safe_durable_success(database, claim: CreativeAttemptClaim
                          ) -> CreativeDurableOutcome | None:
    try:
        return _durable_success(database, claim)
    except Exception:
        return None


def _verified_terminal_status(connection, claim: CreativeAttemptClaim
                              ) -> str | None:
    row = connection.execute('''SELECT a.status,a.job_id,a.step_id,
            a.attempt_no,a.claim_lease_token,a.fence_epoch,
            a.admission_sha256,a.claim_set_sha256,s.kind,s.provider_call
            FROM creative_execution_attempts a
            JOIN creative_execution_steps s ON s.user_id=a.user_id
              AND s.job_id=a.job_id AND s.step_id=a.step_id
            WHERE a.user_id=%s AND a.id=%s''',
        (claim.user_id, claim.attempt_id)).fetchone()
    if (not row or row['status'] not in _TERMINAL_ATTEMPT_STATES
            or str(row['job_id']) != claim.job_id
            or str(row['step_id']) != claim.step_id
            or row['attempt_no'] != claim.attempt_no
            or str(row['claim_lease_token']) != claim.lease_token
            or row['fence_epoch'] != claim.fence_epoch
            or row['admission_sha256'] != claim.admission_sha256
            or row['claim_set_sha256'] != claim.claim_set_sha256
            or row['kind'] != claim.kind
            or row['provider_call'] != claim.provider_call):
        return None
    return row['status']


def reconcile_handler_terminal(database, claim: CreativeAttemptClaim,
                               handler: CreativeClaimHandler) -> bool:
    """Release handler memory only after exact durable terminal evidence."""
    reconcile = getattr(handler, 'reconcile', None)
    if not callable(reconcile):
        return False
    with database.connect() as connection:
        status = _verified_terminal_status(connection, claim)
    if status is None:
        return False
    reconcile(claim, 'succeeded' if status == 'succeeded' else 'stopped')
    return True


def drain_runtime_reconciliations(database,
                                  handlers: dict[str, CreativeClaimHandler], *,
                                  batch_size: int = 100,
                                  lease_seconds: int = 60) -> dict:
    """Claim durable cleanup work and isolate failures per exact fence."""
    _validate_handlers(handlers)
    if (not isinstance(batch_size, int) or not 1 <= batch_size <= 1000
            or not isinstance(lease_seconds, int)
            or not 15 <= lease_seconds <= 900):
        raise ValueError('El lote de reconciliación creativa no es válido.')
    claimed = []
    with database.connect() as connection:
        rows = connection.execute('''SELECT *
            FROM creative_runtime_reconciliation_outbox
            WHERE kind<>'craft' AND (
                (status='pending' AND available_at<=clock_timestamp())
                OR (status='running' AND lease_until<=clock_timestamp()))
            ORDER BY created_at,user_id,attempt_id
            FOR UPDATE SKIP LOCKED LIMIT %s''', (batch_size,)).fetchall()
        for row in rows:
            token = uuid4()
            updated = connection.execute('''UPDATE
                creative_runtime_reconciliation_outbox
                SET status='running',lease_token=%s,
                    lease_until=clock_timestamp()+%s*interval '1 second',
                    attempt_count=attempt_count+1,updated_at=clock_timestamp()
                WHERE user_id=%s AND attempt_id=%s AND status=%s
                  AND kind<>'craft'
                RETURNING *''', (token, lease_seconds, row['user_id'],
                                 row['attempt_id'], row['status'])).fetchone()
            if updated:
                claimed.append(updated)
    claims = tuple((row, CreativeAttemptClaim(
        str(row['user_id']), str(row['job_id']), str(row['step_id']),
        str(row['attempt_id']), row['attempt_no'],
        str(row['claim_lease_token']), row['fence_epoch'], row['kind'],
        row['provider_call'], row['admission_sha256'],
        row['claim_set_sha256'])) for row in claimed)
    with database.connect() as connection:
        verified = tuple(
            (row, claim, _verified_terminal_status(connection, claim))
            for row, claim in claims)
    outcomes = []
    for row, claim, durable_status in verified:
        try:
            if durable_status != row['terminal_status']:
                raise ValueError('La transición durable ya no coincide.')
            reconcile = getattr(handlers[claim.kind], 'reconcile', None)
            if not callable(reconcile):
                raise ValueError('El handler no admite reconciliación.')
            reconcile(
                claim, 'succeeded' if durable_status == 'succeeded'
                else 'stopped')
        except Exception as error:
            outcomes.append((row, False, type(error).__name__[:120]))
        else:
            outcomes.append((row, True, None))
    done = retry_pending = dead = 0
    with database.connect() as connection:
        for row, success, error_code in outcomes:
            if success:
                applied = connection.execute('''UPDATE
                    creative_runtime_reconciliation_outbox
                    SET status='done',lease_token=NULL,lease_until=NULL,
                        last_error=NULL,completed_at=clock_timestamp(),
                        updated_at=clock_timestamp()
                    WHERE user_id=%s AND attempt_id=%s AND status='running'
                      AND lease_token=%s AND kind<>'craft' RETURNING 1''',
                    (row['user_id'], row['attempt_id'],
                     row['lease_token'])).fetchone()
                done += bool(applied)
            else:
                applied = connection.execute('''UPDATE
                    creative_runtime_reconciliation_outbox
                    SET status=CASE WHEN attempt_count >= %s
                                    THEN 'dead' ELSE 'pending' END,
                        lease_token=NULL,lease_until=NULL,last_error=%s,
                        available_at=CASE WHEN attempt_count >= %s
                            THEN available_at
                            ELSE clock_timestamp()
                              + LEAST(3600,power(2,attempt_count))
                                * interval '1 second' END,
                        updated_at=clock_timestamp()
                    WHERE user_id=%s AND attempt_id=%s AND status='running'
                      AND lease_token=%s AND kind<>'craft' RETURNING status''',
                    (_RECONCILIATION_MAX_ATTEMPTS, error_code,
                     _RECONCILIATION_MAX_ATTEMPTS, row['user_id'],
                     row['attempt_id'], row['lease_token'])).fetchone()
                if applied and applied['status'] == 'pending':
                    retry_pending += 1
                elif applied and applied['status'] == 'dead':
                    dead += 1
    return {'claimed': len(claimed), 'done': done,
            'retryPending': retry_pending, 'dead': dead}


def recover_and_reconcile_expired(database,
                                  handlers: dict[str, CreativeClaimHandler], *,
                                  max_claims: int = 3) -> dict:
    """Run the existing DB recovery, then retire exact handler tombstones."""
    _validate_handlers(handlers)
    with database.connect() as connection:
        recovered = recover_expired_creative_attempts(
            connection, max_claims=max_claims,
            excluded_kinds=('craft',))
    reconciliation = drain_runtime_reconciliations(database, handlers)
    return {**recovered, 'reconciledHandlers': reconciliation['done'],
            'reconciliationRetryPending': reconciliation['retryPending'],
            'reconciliationDead': reconciliation['dead']}


def _cancel_and_wait(handler: CreativeClaimHandler,
                     claim: CreativeAttemptClaim, outcomes: Queue,
                     cancel_wait_seconds: float, *,
                     already_stopped: bool = False) -> None:
    cancellation: Queue = Queue(maxsize=1)

    def cancel() -> None:
        try:
            cancellation.put(('returned', handler.cancel(claim)))
        except BaseException as error:
            cancellation.put(('raised', error))

    Thread(target=cancel, name=f'cancel-{claim.attempt_id}', daemon=True).start()
    try:
        cancel_state, cancel_value = cancellation.get(
            timeout=cancel_wait_seconds)
    except Empty:
        raise CreativeLeaseLost(
            'El handler no respondió a la cancelación creativa.') from None
    if cancel_state == 'raised':
        raise CreativeLeaseLost(
            'El handler falló al cancelar el efecto creativo.') from cancel_value
    if cancel_value is not True:
        raise CreativeLeaseLost('El handler no confirmó la cancelación creativa.')
    if already_stopped:
        return
    try:
        outcomes.get(timeout=cancel_wait_seconds)
    except Empty:
        raise CreativeLeaseLost(
            'El handler no terminó después de confirmar la cancelación.') from None


def _validate_handlers(handlers: dict[str, CreativeClaimHandler]) -> None:
    if (not isinstance(handlers, dict) or set(handlers) != CREATIVE_STEP_KINDS
            or any(not callable(getattr(value, 'run', None))
                   or not callable(getattr(value, 'cancel', None))
                   for value in handlers.values())):
        raise ValueError('El runner requiere handlers para todo el grafo creativo.')


def run_claim_with_heartbeat(database, claim: CreativeAttemptClaim,
                             handler: CreativeClaimHandler, *,
                             heartbeat_seconds: float = 30,
                             lease_seconds: int = 90,
                             cancel_wait_seconds: float = 5
                             ) -> CreativeRunnerResult:
    """Run without DB locks, renewing through short independent transactions."""
    if (not isinstance(claim, CreativeAttemptClaim)
            or not isinstance(heartbeat_seconds, (int, float))
            or not 0 < heartbeat_seconds <= lease_seconds / 3
            or not 15 <= lease_seconds <= 900
            or not isinstance(cancel_wait_seconds, (int, float))
            or not 0 < cancel_wait_seconds <= 30
            or not callable(getattr(handler, 'run', None))
            or not callable(getattr(handler, 'cancel', None))):
        raise ValueError('El heartbeat creativo no es válido.')
    outcomes: Queue = Queue(maxsize=1)

    prepare = getattr(handler, 'prepare', None)
    if callable(prepare):
        prepare(claim)

    def invoke() -> None:
        try:
            outcomes.put(('returned', handler.run(claim)))
        except BaseException as error:
            outcomes.put(('raised', error))

    Thread(target=invoke, name=f'creative-{claim.attempt_id}', daemon=True).start()
    while True:
        try:
            state, value = outcomes.get(timeout=heartbeat_seconds)
        except Empty:
            try:
                with database.connect() as connection:
                    renewed = renew_creative_lease(
                        connection, claim, lease_seconds=lease_seconds)
            except Exception as renewal_error:
                if durable := _safe_durable_success(database, claim):
                    return CreativeRunnerResult(claim, durable)
                _cancel_and_wait(
                    handler, claim, outcomes, cancel_wait_seconds)
                if durable := _safe_durable_success(database, claim):
                    return CreativeRunnerResult(claim, durable)
                raise CreativeLeaseLost(
                    'La renovación del lease creativo quedó incierta.') from renewal_error
            if renewed:
                continue
            try:
                state, value = outcomes.get(timeout=0.05)
            except Empty:
                if durable := _safe_durable_success(database, claim):
                    return CreativeRunnerResult(claim, durable)
                _cancel_and_wait(
                    handler, claim, outcomes, cancel_wait_seconds)
                if durable := _safe_durable_success(database, claim):
                    return CreativeRunnerResult(claim, durable)
                raise CreativeLeaseLost(
                    'El runner perdió el lease y canceló el efecto activo.')
        if state == 'raised':
            if durable := _safe_durable_success(database, claim):
                return CreativeRunnerResult(claim, durable)
            _cancel_and_wait(
                handler, claim, outcomes, cancel_wait_seconds,
                already_stopped=True)
            if durable := _safe_durable_success(database, claim):
                return CreativeRunnerResult(claim, durable)
            raise value
        return CreativeRunnerResult(claim, value)


def claim_and_run_one(database, settings, worker_id: str,
                      handlers: dict[str, CreativeClaimHandler], *,
                      job_id: UUID | None = None,
                      heartbeat_seconds: float = 30,
                      lease_seconds: int = 90,
                      cancel_wait_seconds: float = 5,
                      allow_expired_admission: bool = False
                      ) -> CreativeRunnerResult | None:
    """Claim once only after proving every selectable kind has a handler.

    `allow_expired_admission` (por defecto False = comportamiento idéntico del worker normal) se propaga
    al claim para el bypass HERMÉTICO de admisión caducada; solo lo activa el entrypoint de recuperación
    de adopción de un clip ya pagado (nunca el worker de despacho). No afecta a ninguna generación."""
    _validate_handlers(handlers)
    with database.connect() as connection:
        claim = claim_creative_step(
            connection, settings, worker_id, job_id,
            lease_seconds=lease_seconds,
            allow_expired_admission=allow_expired_admission)
    if claim is None:
        return None
    return run_claim_with_heartbeat(
        database, claim, handlers[claim.kind],
        heartbeat_seconds=heartbeat_seconds, lease_seconds=lease_seconds,
        cancel_wait_seconds=cancel_wait_seconds)
