"""Recibo durable del step Google, previo a cualquier adopción de assets."""

from dataclasses import dataclass
import re
from uuid import UUID

from .creative_composite_quote import canonical_sha256
from .creative_google_output_staging import GoogleOutputStagingReceipt
from .creative_google_preflight_receipt import GooglePreflightReceipt
from .creative_google_transport import GoogleDispatchResult


_HASH = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True)
class GoogleGenerationHandoff:
    snapshot: dict
    sha256: str


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f"{label} Google no válido.") from None
    if parsed != value:
        raise ValueError(f"{label} Google no canónico.")
    return parsed


def _preflight_sha(preflight: GooglePreflightReceipt) -> str:
    if (not isinstance(preflight, GooglePreflightReceipt)
            or not _HASH.fullmatch(preflight.sha256)
            or canonical_sha256(preflight.snapshot) != preflight.sha256):
        raise ValueError("Preflight Google no verificable.")
    return preflight.sha256


def validate_handoff_inputs(request_operation_id: object,
                            preflight: GooglePreflightReceipt) -> None:
    """Validación PRE-POST (C1): comprueba lo que NO depende del resultado del POST
    (formato de request_operation_id y verificabilidad del preflight). Permite
    abortar ANTES de facturar una llamada cuyo handoff fallaría con seguridad.
    Lanza ValueError si algo no es válido."""
    _uuid(request_operation_id, "Operación aprobada")
    _preflight_sha(preflight)


def _dispatch(result: GoogleDispatchResult) -> dict:
    if (not isinstance(result, GoogleDispatchResult)
            or not _HASH.fullmatch(result.request_sha256)
            or not isinstance(result.receipt, dict)
            or result.receipt.get("attemptId") != result.attempt_id
            or result.receipt.get("requestSha256") != result.request_sha256
            or result.receipt.get("state") != result.state
            or result.receipt.get("providerOperation")
            != result.provider_operation):
        raise ValueError("Dispatch Google no verificable.")
    _uuid(result.attempt_id, "Intento")
    return result.receipt


def accepted_google_generation_handoff(
        result: GoogleDispatchResult, request_operation_id: str,
        preflight: GooglePreflightReceipt) -> GoogleGenerationHandoff:
    """Representa el handle asíncrono; hacer poll nunca implica otro POST."""
    dispatch = _dispatch(result)
    if (result.state != "accepted" or result.outputs
            or not isinstance(result.provider_operation, str)
            or not result.provider_operation.strip()):
        raise ValueError("La generación Google no dejó un handle aceptado.")
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_generation_handoff",
        "state": "accepted",
        "attemptId": result.attempt_id,
        "requestOperationId": _uuid(
            request_operation_id, "Operación aprobada"),
        "requestSha256": result.request_sha256,
        "provider": dispatch.get("provider"),
        "providerOperation": result.provider_operation,
        "dispatchReceipt": dispatch,
        "preflightReceiptSha256": _preflight_sha(preflight),
        "storageReceipts": [],
        "publicationAuthorized": False,
    }
    return GoogleGenerationHandoff(snapshot, canonical_sha256(snapshot))


def staged_google_generation_handoff(
        result: GoogleDispatchResult, request_operation_id: str,
        staging: GoogleOutputStagingReceipt,
        preflight: GooglePreflightReceipt) -> GoogleGenerationHandoff:
    """Representa outputs inline después de obtener recibos GCS."""
    dispatch = _dispatch(result)
    if (result.state != "completed" or not result.outputs
            or result.provider_operation is not None
            or not isinstance(staging, GoogleOutputStagingReceipt)
            or canonical_sha256(staging.snapshot) != staging.sha256
            or staging.snapshot.get("attemptId") != result.attempt_id
            or staging.snapshot.get("requestSha256") != result.request_sha256
            or staging.snapshot.get("dispatchReceipt") != dispatch
            or staging.snapshot.get("preflightReceiptSha256")
            != preflight.sha256
            or staging.snapshot.get("publicationAuthorized") is not False):
        raise ValueError("El staging Google no permite cerrar el handoff.")
    objects = staging.snapshot.get("objects")
    if not isinstance(objects, list) or not objects:
        raise ValueError("El staging Google no contiene objetos durables.")
    receipts = [item.get("storageReceipt") if isinstance(item, dict) else None
                for item in objects]
    if any(not isinstance(item, dict) for item in receipts):
        raise ValueError("El staging Google no contiene recibos ordenados.")
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_generation_handoff",
        "state": "staged",
        "attemptId": result.attempt_id,
        "requestOperationId": _uuid(
            request_operation_id, "Operación aprobada"),
        "requestSha256": result.request_sha256,
        "provider": dispatch.get("provider"),
        "providerOperation": None,
        "dispatchReceipt": dispatch,
        "preflightReceiptSha256": _preflight_sha(preflight),
        "stagingReceiptSha256": staging.sha256,
        "outputs": objects,
        "storageReceipts": receipts,
        "publicationAuthorized": False,
    }
    return GoogleGenerationHandoff(snapshot, canonical_sha256(snapshot))
