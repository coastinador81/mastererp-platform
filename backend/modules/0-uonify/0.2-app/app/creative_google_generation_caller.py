"""Caller/handler INERTE del paso `google_generation` (clips-only §2.2).

Orquesta UN SOLO POST por intento llamando una única vez a
`run_google_generation_step` con el `CreativeExecutionEnvelopeJournal` concreto.
La disciplina dura (un POST, abort pre-POST con 0 HTTP, un `unknown` que nunca
re-POSTea, recovery por el prefijo persistido) ya vive en el envelope v2 y en
`poll_veo_once`; aquí NO se reintenta `predictLongRunning` ni se reabre una
generación — este módulo solo compone.

Ensambla el contexto de la petición a través de un `context_loader` INYECTADO (lo
cablea interfaz: reconstruir la autoridad desde el grafo/admission persistidos,
construir la petición Veo 3.1 Fast primer-fotograma, acuñar el token, reservar el
`output_prefix` §6/129, cargar catálogo/preflight). El punto de aprobación
server-side es `gate_decider(claim, request_sha256) -> bool` (condición §7.1 del
veredicto: `gate_open` deriva de una aprobación verificable del lado servidor);
por defecto FAIL-CLOSED (False), así que sin cablear no hay dispatch. Además
`checkpoint_provider_started` queda cerrado por el piloto de dispatch (vacío) y el
handler NO se registra en el arranque: inerte de principio a fin.

Reusa el runner inactivo `creative_execution_runner.py` vía la forma handler
(run/cancel). `cancel` confirma que no hay efecto local que detener: un POST único no
deja hilo cancelable; la operación en vuelo la resuelve la recuperación durable
(poll → promote/unknown), nunca un re-POST.

Vuelve al Consultor para el verdict de código (un-POST, abort pre-POST, gate
server-side) y a interfaz para cablear el `context_loader` + flags + infra.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import requests

from .creative_execution_coordinator import CreativeAttemptClaim
from .creative_envelope_journal import CreativeExecutionEnvelopeJournal
from .creative_google_capabilities import GoogleCreativeCatalog
from .creative_google_envelope_v2 import (EnvelopeGenerationResult,
                                          run_google_generation_step)
from .creative_google_generation_authority import (GoogleGenerationAuthority,
                                                   GoogleGenerationFence)
from .creative_google_input_ownership import GoogleOwnedInputBinding
from .creative_google_preflight import GoogleCreativePreflight
from .creative_google_preflight_receipt import GooglePreflightReceipt


@dataclass(frozen=True)
class GoogleGenerationStepContext:
    """Todo lo que `run_google_generation_step` necesita, además de autoridad/fence.

    Lo ensambla interfaz en su integración (petición Veo primer-fotograma, token,
    prefijo §6/129, allowlists de config). Este módulo lo pasa tal cual: no lo inventa.
    """
    request_snapshot_json: str
    request_sha256: str
    catalog: GoogleCreativeCatalog
    preflight: GoogleCreativePreflight
    preflight_receipt: GooglePreflightReceipt
    request_operation_id: str
    token: str
    input_binding: GoogleOwnedInputBinding | None
    allowed_buckets: tuple[str, ...]
    output_prefix: str | None
    allowed_output_buckets: tuple[str, ...]


@runtime_checkable
class GoogleGenerationContextLoader(Protocol):
    """Reconstruye autoridad + fence + contexto de la petición para un claim fenced."""

    def load(self, c, claim: CreativeAttemptClaim, now) -> tuple[
            GoogleGenerationAuthority, GoogleGenerationFence,
            GoogleGenerationStepContext]:
        ...


def _fail_closed_gate(claim: CreativeAttemptClaim, request_sha256: str) -> bool:
    """Aprobación server-side ausente por defecto: sin dispatch (fail-closed §7.1)."""
    return False


def run_google_generation_once(
        database, settings, claim: CreativeAttemptClaim, *,
        context_loader: GoogleGenerationContextLoader,
        session: requests.Session, now,
        gate_decider=_fail_closed_gate,
        max_attempts: int = 3) -> EnvelopeGenerationResult:
    """Un intento, un POST. Carga el contexto, decide el gate server-side y delega en
    el envelope (que hace el único POST y registra el resultado sin re-POST)."""
    if not isinstance(claim, CreativeAttemptClaim) or claim.kind != 'google_generation':
        raise ValueError('El claim no es una generación Google.')
    with database.connect() as c:
        # SINGLE-NOW (A): el `now`=T0 del worker se pasa al loader para que el preflight se ACUÑE con el
        # MISMO instante con el que luego se VALIDA en el gate (run_google_generation_step now=now). Sin esto
        # el reader acuñaba con su propio reloj (T1>T0) ⇒ checked_at>now ⇒ PREFLIGHT_INVALID determinista.
        authority, fence, ctx = context_loader.load(c, claim, now)
    if not isinstance(ctx, GoogleGenerationStepContext):
        raise ValueError('El contexto de generación Google no es canónico.')
    # Punto de aprobación server-side ligado al requestSha256 aprobado (§7.1).
    gate_open = gate_decider(claim, ctx.request_sha256) is True
    journal = CreativeExecutionEnvelopeJournal(
        database, settings, max_attempts=max_attempts)
    return run_google_generation_step(
        journal, authority=authority, fence=fence,
        request_snapshot_json=ctx.request_snapshot_json,
        request_sha256=ctx.request_sha256, catalog=ctx.catalog,
        preflight=ctx.preflight, preflight_receipt=ctx.preflight_receipt,
        request_operation_id=ctx.request_operation_id, token=ctx.token,
        session=session, now=now, input_binding=ctx.input_binding,
        gate_open=gate_open, allowed_buckets=ctx.allowed_buckets,
        output_prefix=ctx.output_prefix,
        allowed_output_buckets=ctx.allowed_output_buckets)


@dataclass(frozen=True)
class GoogleGenerationHandlerResult:
    state: str
    provider_operation: str | None


class GoogleGenerationClaimHandler:
    """Forma handler (run/cancel) para el runner inactivo. NO se registra al arranque.

    `session_factory() -> requests.Session` y `clock() -> now` los aporta interfaz; el
    `gate_decider` es el punto de aprobación server-side (fail-closed por defecto).
    """

    def __init__(self, database, settings, *,
                 context_loader: GoogleGenerationContextLoader,
                 session_factory, clock, gate_decider=_fail_closed_gate,
                 max_attempts: int = 3) -> None:
        self.database = database
        self.settings = settings
        self.context_loader = context_loader
        self.session_factory = session_factory
        self.clock = clock
        self.gate_decider = gate_decider
        self.max_attempts = max_attempts

    def run(self, claim: CreativeAttemptClaim) -> GoogleGenerationHandlerResult:
        session = self.session_factory()
        try:
            result = run_google_generation_once(
                self.database, self.settings, claim,
                context_loader=self.context_loader, session=session,
                now=self.clock(), gate_decider=self.gate_decider,
                max_attempts=self.max_attempts)
        finally:
            close = getattr(session, 'close', None)
            if callable(close):
                close()
        provider_operation = getattr(
            getattr(result, 'dispatch', None), 'provider_operation', None)
        return GoogleGenerationHandlerResult(result.state, provider_operation)

    def cancel(self, claim: CreativeAttemptClaim) -> bool:
        # Un POST único no deja efecto local cancelable; la operación en vuelo la
        # resuelve la recuperación durable (poll → promote/unknown), nunca un re-POST.
        return True
