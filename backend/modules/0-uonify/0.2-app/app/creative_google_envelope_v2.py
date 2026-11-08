"""Orquestación del envelope v2 (lado Google) — DISPATCH CERRADO.

Librería auto-contenida que cablea el camino single-POST de generación usando las
funciones REALES de la capa Google y un `EnvelopeJournal` INYECTADO (lo implementa
Interfaz sobre su ledger 088 / registry 089 al integrar). No crea migraciones, no
edita el coordinator/ledger de Interfaz, no cablea su runner y NO activa dispatch:
`gate_open` es un parámetro del punto de aprobación del llamador (nunca se fuerza a
True aquí) y la producción sigue cerrada por `PRODUCTION_GOOGLE_DISPATCH_ENABLED`.

Unidad 1: paso `google_generation` (provider_started solo tras Gate 119 + plan head
exacto; un único POST vía `dispatch_approved_google_once`; `provider_returned` con
handoff para `accepted`; unknown/failed/aborted registrados sin re-POST). La
persistencia multi-output y la adopción (`storage_adopt`) y la reconciliación por GET
son unidades posteriores.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Protocol, runtime_checkable

import requests

from .creative_google_capabilities import GoogleCreativeCatalog
from .creative_google_dispatch_gate import dispatch_approved_google_once
from .creative_google_generation_authority import (
    GoogleGenerationAuthority, GoogleGenerationFence,
    google_generation_authority_snapshot, google_generation_fence_snapshot)
from .creative_google_generation_handoff import (
    GoogleGenerationHandoff, accepted_google_generation_handoff,
    validate_handoff_inputs)
from .creative_google_input_ownership import GoogleOwnedInputBinding
from .creative_google_preflight import GoogleCreativePreflight
from .creative_google_preflight_receipt import GooglePreflightReceipt
from .creative_google_transport import (GoogleDispatchEmptyResult,
                                        GoogleDispatchError,
                                        GoogleDispatchRejectedFinal,
                                        GoogleDispatchRejectedRetryable,
                                        GoogleDispatchSafetyBlocked,
                                        GoogleDispatchUnknown,
                                        veo_output_authorization)
from .creative_google_staging_v2 import (google_staging_manifest_v2,
                                         google_staging_plan_v2)
from .creative_google_staging_adoption import (
    google_manifest_output_adoption_request,
    validate_google_staging_adoption_request)
from .creative_provider_adoption_transport import (
    ProviderAdoptionTransportConflict, ProviderAdoptionTransportError,
    ProviderAdoptionTransportUnknown)
from .creative_storage_contracts import StorageReceipt
from .creative_storage_transport import (StorageTransportConflict,
                                         StorageTransportError,
                                         StorageTransportUnknown)


class EnvelopeError(Exception):
    """La orquestación no puede avanzar con autoridad/fence incoherentes."""


class EnvelopeUncertain(Exception):
    """Un ejecutor inyectado (upload/rewrite) terminó incierto: pudo surtir efecto.

    El llamador traduce la incertidumbre real de su transporte (p.ej.
    ProviderAdoptionTransportUnknown / StorageTransportError) a esta excepción. El
    orquestador la registra como `unknown` y NO reintenta; cualquier otra excepción
    se propaga sin enmascararse (no se marca unknown por un bug)."""


class JournalReason(str, Enum):
    """Motivos categóricos del journal (condición: enum, no texto libre).

    El `detail` humano viaja aparte; esto fija la causa en un vocabulario cerrado.
    """
    ATTEMPT_OUT_OF_FENCE = "attempt_out_of_fence"
    DISPATCH_UNKNOWN = "dispatch_unknown"
    DISPATCH_REJECTED_RETRYABLE = "dispatch_rejected_retryable"
    DISPATCH_REJECTED_FINAL = "dispatch_rejected_final"
    DISPATCH_SAFETY_BLOCKED = "dispatch_safety_blocked"
    DISPATCH_EMPTY_RESULT = "dispatch_empty_result"
    DISPATCH_REJECTED_OTHER = "dispatch_rejected_other"
    PRE_POST_ABORTED = "pre_post_aborted"
    HANDOFF_UNVERIFIABLE = "handoff_unverifiable"
    STAGING_UPLOAD_UNKNOWN = "staging_upload_unknown"
    STAGING_UPLOAD_REJECTED = "staging_upload_rejected"
    STAGING_MANIFEST_INVALID = "staging_manifest_invalid"
    ADOPTION_UNKNOWN = "adoption_unknown"
    ADOPTION_REJECTED = "adoption_rejected"
    ADOPTION_NO_RECEIPT = "adoption_no_receipt"
    RECONCILE_UNKNOWN = "reconcile_unknown"
    RECONCILE_FAILED = "reconcile_failed"


@runtime_checkable
class EnvelopeJournal(Protocol):
    """Diario fenced inyectado. Lo implementa Interfaz sobre su ledger.

    Modela los estados de la propuesta §4. Cada método es un checkpoint durable del
    titular del lease vigente; el orquestador nunca persiste bytes ni abre dispatch.
    """

    def gate119_plan_head(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence) -> None:
        """Valida Gate 119 + plan head exacto. Debe LANZAR si no son vigentes."""

    def record_provider_started(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence) -> None:
        ...

    def record_provider_returned(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *, state: str,
            provider_operation: str | None) -> None:
        """Checkpoint durable del retorno del POST. Persiste el handle del
        proveedor (C1) ANTES de construir o validar el handoff."""

    def record_handoff_ready(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *, handoff_sha256: str) -> None:
        """Snapshot del handoff ya verificado (solo tras un 'accepted' válido)."""

    def record_unknown(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *, reason: 'JournalReason',
            detail: str | None = None) -> None:
        ...

    def record_rejected_retryable(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *, reason: 'JournalReason',
            detail: str | None = None) -> None:
        """Rechazo transitorio (408/429): nada producido; seguro reintentar."""

    def record_failed(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *, reason: 'JournalReason',
            detail: str | None = None) -> None:
        ...

    def record_aborted(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *, reason: 'JournalReason',
            detail: str | None = None) -> None:
        """Precondición pre-HTTP fallida: no se envió nada; seguro reintentar."""

    def record_adopting(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence) -> None:
        ...

    def record_succeeded(
            self, authority: GoogleGenerationAuthority,
            fence: GoogleGenerationFence, *,
            storage_receipts: tuple[StorageReceipt, ...]) -> None:
        ...


@dataclass(frozen=True)
class EnvelopeGenerationResult:
    state: str  # 'accepted' | 'completed'
    dispatch: object  # GoogleDispatchResult
    handoff: GoogleGenerationHandoff | None


@dataclass(frozen=True)
class ReconcileOutcome:
    status: str  # 'completed' | 'pending' | 'failed'
    poll: object  # resultado del ejecutor de poll (VeoPoll/OmniPoll o doble)


def validate_plan_head(authority: GoogleGenerationAuthority,
                       fence: GoogleGenerationFence) -> None:
    """Chequeo estructural reutilizable del plan head (autoridad + fence)."""
    google_generation_authority_snapshot(authority)
    google_generation_fence_snapshot(fence)


def _reservation(fence: GoogleGenerationFence) -> dict:
    return {"attemptId": fence.attempt_id, "status": "reserved"}


def _require_google_input_ownership(
        authority: GoogleGenerationAuthority,
        input_binding: GoogleOwnedInputBinding | None,
        allowed_buckets: tuple[str, ...]) -> None:
    """H6 (pre-POST): el binding de inputs pertenece al dueño del intento y sus buckets
    están en la allowlist de CONFIG (no del request ni del payload de la autoridad).

    No duplica `require_google_owned_inputs` (que reconstruye el binding y valida su
    integridad en `dispatch_once`): aquí se ata la propiedad a `authority.owner_user_id` y
    los buckets de ENTRADA a la configuración del servidor. Un fallo lanza ValueError y el
    llamador lo registra como `aborted` (0 HTTP). Los buckets de SALIDA (adopción) los
    cubre run_storage_adopt_step (H7/§6), no H6.
    """
    if input_binding is None:
        return
    if input_binding.owner_id != authority.owner_user_id:
        raise ValueError(
            "El binding de inputs no pertenece al dueño del intento.")
    allowed = tuple(allowed_buckets)
    for receipt in input_binding.receipts:
        if receipt.bucket not in allowed:
            raise ValueError(
                "Un bucket de input no está en la allowlist de configuración.")


def run_google_generation_step(
        journal: EnvelopeJournal, *,
        authority: GoogleGenerationAuthority, fence: GoogleGenerationFence,
        request_snapshot_json: str, request_sha256: str,
        catalog: GoogleCreativeCatalog, preflight: GoogleCreativePreflight,
        preflight_receipt: GooglePreflightReceipt, request_operation_id: str,
        token: str, session: requests.Session, now,
        input_binding: GoogleOwnedInputBinding | None = None,
        gate_open: bool = False,
        allowed_buckets: tuple[str, ...] = (),
        output_prefix: str | None = None,
        allowed_output_buckets: tuple[str, ...] = ()) -> EnvelopeGenerationResult:
    """Un único POST tras Gate 119 + plan head; registra el resultado sin re-POST.

    `gate_open` lo pasa el punto de aprobación del llamador (ligado al requestSha256 y
    a la habilitación del dueño); este módulo nunca lo fuerza a True. La producción
    permanece cerrada por `PRODUCTION_GOOGLE_DISPATCH_ENABLED`.
    """
    if authority.request_sha256 != request_sha256:
        raise EnvelopeError("La autoridad no corresponde al requestSha256 aprobado.")
    # H5: ata el proyecto de la autoridad al del preflight (preflight.project ya ==
    # catalog.project por require_current_preflight). Precondición estructural, como el
    # sha256: sin efecto en el journal todavía.
    if authority.google_project != preflight.project:
        raise EnvelopeError(
            "La autoridad no corresponde al proyecto del preflight.")
    # Gate 119 + plan head exacto: debe pasar ANTES de cualquier efecto.
    journal.gate119_plan_head(authority, fence)
    # C1: validar lo que NO depende del POST (request_operation_id, preflight) y H6
    # (propiedad del binding + allowlist de buckets de entrada) ANTES de
    # provider_started y del POST. Un fallo aquí aborta sin enviar nada.
    output_authorization = None
    try:
        validate_handoff_inputs(request_operation_id, preflight_receipt)
        _require_google_input_ownership(authority, input_binding, allowed_buckets)
        # §6: para un intento Veo durable, construye la autorización de salida desde el
        # prefijo PERSISTIDO en la reserva (output_prefix) + owner/attempt de la fila +
        # allowlist de SALIDA de config, con guarda de consistencia (owner/attempt del
        # prefijo). fail-closed: un prefijo que no case aborta pre-POST, 0 HTTP.
        if output_prefix is not None:
            output_authorization = veo_output_authorization(
                output_prefix, authority.owner_user_id, fence.attempt_id,
                allowed_output_buckets)
    except ValueError as error:
        journal.record_aborted(
            authority, fence, reason=JournalReason.PRE_POST_ABORTED,
            detail=str(error))
        raise
    # provider_started se registra ANTES del único POST.
    journal.record_provider_started(authority, fence)
    try:
        result = dispatch_approved_google_once(
            _reservation(fence), request_snapshot_json, request_sha256,
            catalog, preflight, token, session, now=now, gate_open=gate_open,
            input_binding=input_binding,
            expected_project=authority.google_project,
            expected_location=authority.google_location,
            output_authorization=output_authorization)
    except GoogleDispatchRejectedRetryable as error:
        # 408/429: rechazo transitorio; nada producido; seguro reintentar luego.
        journal.record_rejected_retryable(
            authority, fence, reason=JournalReason.DISPATCH_REJECTED_RETRYABLE,
            detail=str(error))
        raise
    except GoogleDispatchSafetyBlocked as error:
        # Parada de seguridad (RAI): rechazo determinista por contenido.
        journal.record_failed(
            authority, fence, reason=JournalReason.DISPATCH_SAFETY_BLOCKED,
            detail=str(error))
        raise
    except GoogleDispatchEmptyResult as error:
        # STOP sin medios (solo texto): refusal determinista, sin efecto adoptable.
        journal.record_failed(
            authority, fence, reason=JournalReason.DISPATCH_EMPTY_RESULT,
            detail=str(error))
        raise
    except GoogleDispatchRejectedFinal as error:
        # 4xx no transitorio: terminal, sin efecto adoptable.
        journal.record_failed(
            authority, fence, reason=JournalReason.DISPATCH_REJECTED_FINAL,
            detail=str(error))
        raise
    except GoogleDispatchUnknown as error:
        # 409/499/3xx/5xx/2xx≠200/red/200 ilegible: pudo enviarse; NO re-POST, reconciliar.
        journal.record_unknown(
            authority, fence, reason=JournalReason.DISPATCH_UNKNOWN,
            detail=str(error))
        raise
    except GoogleDispatchError as error:
        # Rechazo limpio sin clasificación más fina: terminal, causa distinta.
        journal.record_failed(
            authority, fence, reason=JournalReason.DISPATCH_REJECTED_OTHER,
            detail=str(error))
        raise
    except ValueError as error:
        # Invariante (verificada): dispatch_approved_google_once / dispatch_once solo
        # lanzan ValueError ANTES del POST (gate cerrado, preflight caducado,
        # endpoint/modelo/binding/medio-inline/token/fingerprint y, por H5,
        # proyecto/region del endpoint != autorizados); cualquier fallo
        # DESPUÉS del POST se envuelve como GoogleDispatchUnknown (A4). Por eso
        # 'aborted' implica que NO se envió nada. Reafirmar esto si se toca dispatch_once.
        journal.record_aborted(
            authority, fence, reason=JournalReason.PRE_POST_ABORTED,
            detail=str(error))
        raise
    if result.attempt_id != fence.attempt_id:
        # El handle también se registra aquí: un 'accepted' fuera del fence ya está
        # facturado y su operación no puede perderse.
        journal.record_provider_returned(
            authority, fence, state=result.state,
            provider_operation=result.provider_operation)
        journal.record_unknown(
            authority, fence, reason=JournalReason.ATTEMPT_OUT_OF_FENCE)
        raise EnvelopeError("El intento devuelto no coincide con el fence.")
    # C1: persistir el handle del proveedor en el checkpoint durable ANTES de
    # construir el handoff. Si la construcción falla tras un 'accepted' ya
    # facturado (p.ej. receipt inconsistente), el handle queda registrado y el
    # estado es 'unknown', nunca un handle perdido.
    journal.record_provider_returned(
        authority, fence, state=result.state,
        provider_operation=result.provider_operation)
    handoff = None
    if result.state == "accepted":
        try:
            handoff = accepted_google_generation_handoff(
                result, request_operation_id, preflight_receipt)
        except (ValueError, EnvelopeUncertain) as error:
            journal.record_unknown(
                authority, fence, reason=JournalReason.HANDOFF_UNVERIFIABLE,
                detail=str(error))
            raise EnvelopeUncertain(
                "Handoff Google no verificable tras un 'accepted'.") from error
        journal.record_handoff_ready(
            authority, fence, handoff_sha256=handoff.sha256)
    return EnvelopeGenerationResult(result.state, result, handoff)


def run_storage_adopt_step(
        journal: EnvelopeJournal, *,
        authority: GoogleGenerationAuthority, fence: GoogleGenerationFence,
        result, bucket: str, preflight_receipt: GooglePreflightReceipt,
        upload_staging, rewrite_adopt) -> tuple[StorageReceipt, ...]:
    """storage_adopt: inline `completed` → staging v2 → adopción canónica create-only.

    `upload_staging(artifact) -> StorageReceipt` y `rewrite_adopt(request) ->
    StorageReceipt` son ejecutores INYECTADOS (el transporte create-only real lo pone
    el llamador; los tests usan dobles). Este módulo no hace HTTP ni abre dispatch. Un
    ejecutor que termina incierto lanza `EnvelopeUncertain` → se registra `unknown` sin
    reintento (la reconciliación por GET es la unidad 3). Un staging a medias, un
    recibo alterado o una cardinalidad incorrecta hacen fallar cerrado y NO adoptan.
    """
    if getattr(result, "state", None) != "completed" or not getattr(
            result, "outputs", None):
        raise EnvelopeError("storage_adopt exige un resultado completed con outputs.")
    if (result.attempt_id != fence.attempt_id
            or result.request_sha256 != authority.request_sha256):
        raise EnvelopeError("El resultado no coincide con la autoridad/fence.")
    journal.record_adopting(authority, fence)
    # A4: tras record_adopting, ninguna excepción de los pasos de staging/adopción
    # escapa sin cerrar el journal. EnvelopeUncertain → unknown (pudo surtir efecto);
    # ValueError/Conflict del ejecutor o de la validación estructural → failed.
    try:
        plan = google_staging_plan_v2(result, bucket, authority, fence)
    except ValueError as error:
        journal.record_failed(
            authority, fence, reason=JournalReason.STAGING_MANIFEST_INVALID,
            detail=str(error))
        raise
    staging_receipts = []
    for artifact in plan.artifacts:
        try:
            staging_receipts.append(upload_staging(artifact))
        except (EnvelopeUncertain, StorageTransportUnknown) as error:
            journal.record_unknown(
                authority, fence, reason=JournalReason.STAGING_UPLOAD_UNKNOWN,
                detail=str(error))
            raise
        except (ValueError, StorageTransportError) as error:
            # StorageTransportConflict (colisión real) y StorageTransportError van
            # aquí; StorageTransportUnknown se capturó antes como incierto.
            journal.record_failed(
                authority, fence, reason=JournalReason.STAGING_UPLOAD_REJECTED,
                detail=str(error))
            raise
    try:
        manifest = google_staging_manifest_v2(
            result, plan, tuple(staging_receipts), preflight_receipt)
    except ValueError as error:
        # staging a medias / recibo alterado / cardinalidad: falla cerrado, no adopta.
        journal.record_failed(
            authority, fence, reason=JournalReason.STAGING_MANIFEST_INVALID,
            detail=str(error))
        raise
    finals = []
    for item in manifest.snapshot["outputs"]:
        try:
            request = google_manifest_output_adoption_request(item)
            validate_google_staging_adoption_request(request)
            adopted = rewrite_adopt(request)
        except (EnvelopeUncertain, StorageTransportUnknown,
                ProviderAdoptionTransportUnknown) as error:
            journal.record_unknown(
                authority, fence, reason=JournalReason.ADOPTION_UNKNOWN,
                detail=str(error))
            raise
        except (ValueError, StorageTransportError,
                ProviderAdoptionTransportError) as error:
            # Conflicto real de nombre (Storage/ProviderAdoptionTransportConflict),
            # error de transporte u otra validación determinista: no adopta. Los
            # inciertos (…TransportUnknown) ya se capturaron arriba.
            journal.record_failed(
                authority, fence, reason=JournalReason.ADOPTION_REJECTED,
                detail=str(error))
            raise
        if not isinstance(adopted, StorageReceipt):
            journal.record_failed(
                authority, fence, reason=JournalReason.ADOPTION_NO_RECEIPT)
            raise EnvelopeError("La adopción no devolvió un StorageReceipt final.")
        finals.append(adopted)
    journal.record_succeeded(
        authority, fence, storage_receipts=tuple(finals))
    return tuple(finals)


def run_reconcile_accepted_step(
        journal: EnvelopeJournal, *,
        authority: GoogleGenerationAuthority, fence: GoogleGenerationFence,
        provider_operation: str, poll) -> ReconcileOutcome:
    """Reabre un handle aceptado/incierto con una consulta de SOLO LECTURA del estado
    de la operación; NUNCA emite una generación.

    `poll(provider_operation) -> objeto con .status in {'completed','pending','failed'}`
    es el ejecutor inyectado (poll_veo_once / poll_omni_once en real; doble en test). Su
    única acción externa es un fetch del handle exacto: Omni usa GET y Veo usa un POST de
    solo lectura a `:fetchPredictOperation` (consulta de estado de la operación ya
    aceptada, con body solo `operationName`; NO es `:predict`/generación). Este
    orquestador no construye peticiones de generación ni toca dispatch: no puede re-enviar.

    - completed → devuelve el resultado para continuar con storage_adopt (import+rewrite
      create-only); no reescribe checkpoints de generación.
    - pending   → se difiere (dentro del presupuesto de polling); sin checkpoint nuevo.
    - failed    → record_failed (terminal).
    - EnvelopeUncertain del poll → record_unknown (sigue incierto; no re-POST).
    """
    if not isinstance(provider_operation, str) or not provider_operation.strip():
        raise EnvelopeError("Reapertura Google sin handle del proveedor.")
    try:
        outcome = poll(provider_operation)
    except EnvelopeUncertain as error:
        journal.record_unknown(
            authority, fence, reason=JournalReason.RECONCILE_UNKNOWN,
            detail=str(error))
        raise
    status = getattr(outcome, "status", None)
    if status == "failed":
        # H11: si el poll trae motivos/códigos (RAI o error de la operación), se llevan
        # al journal en el detalle (interno; el texto al cliente es otra capa).
        reasons = getattr(outcome, "reasons", ())
        detail = "el proveedor marcó el trabajo como fallido"
        if reasons:
            detail += "; motivos: " + ", ".join(str(reason) for reason in reasons)
        journal.record_failed(
            authority, fence, reason=JournalReason.RECONCILE_FAILED, detail=detail)
        return ReconcileOutcome("failed", outcome)
    if status == "completed":
        return ReconcileOutcome("completed", outcome)
    return ReconcileOutcome("pending", outcome)
