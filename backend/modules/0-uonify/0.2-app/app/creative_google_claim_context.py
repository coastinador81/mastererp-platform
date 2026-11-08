"""Rehidrata la operación Google exacta ligada a un claim ya admitido."""

from dataclasses import dataclass
from uuid import UUID

from .creative_composite_quote import canonical_json, canonical_sha256
from .creative_execution_coordinator import CreativeAttemptClaim
from .creative_execution_rehydration import rehydrate_admitted_execution
from .creative_google_dispatch_codes import (CLAIM_STATE_INVALID,
                                            CodedDispatchError,
                                            REHYDRATE_INVALID,
                                            VERIFY_ENDPOINT_MODEL_INVALID,
                                            VERIFY_RECONSTRUCT_INVALID,
                                            VERIFY_SHA_SNAPSHOT_MISMATCH,
                                            VERIFY_STRUCT_INVALID)
from .creative_google_request_loader import google_request_from_snapshot


@dataclass(frozen=True)
class GoogleClaimContext:
    claim: CreativeAttemptClaim
    operation_id: str
    request_sha256: str
    request_snapshot_json: str
    request: object


def load_google_claim_context(c, claim: CreativeAttemptClaim
                              ) -> GoogleClaimContext:
    """Recarga ledger+grafo; el caller aún no puede iniciar el proveedor."""
    # F2b-split: cada rechazo pre-POST lleva su código estable (CodedDispatchError⊂ValueError → el envelope
    # lo trata igual, pre-POST, 0 cargo; el worker loguea el código). CLAIM_STATE (identidad/auth del claim),
    # REHYDRATE (re-validación del grafo). F2c-split: los 3 sitios «operación/reconstrucción persistida» se
    # separan en VERIFY_STRUCT (estructura) / VERIFY_RECONSTRUCT (reconstrucción) / VERIFY_ENDPOINT_MODEL
    # (endpoint-modelo) para pinar en el E2E cuál falla (el round-trip puro pasa offline con las 3).
    if (not isinstance(claim, CreativeAttemptClaim)
            or claim.kind != "google_generation" or not claim.provider_call
            or claim.execution_authorized or claim.publication_authorized):
        raise CodedDispatchError("El claim no corresponde a generación Google.",
                                 code=CLAIM_STATE_INVALID)
    owner = c.execute(
        "SELECT * FROM users WHERE id=%s FOR SHARE", (claim.user_id,)).fetchone()
    if (not owner or str(owner.get("id")) != claim.user_id
            or owner.get("deletion_requested_at")):
        raise CodedDispatchError("La identidad propietaria ya no está vigente.",
                                 code=CLAIM_STATE_INVALID)
    try:
        restored = rehydrate_admitted_execution(
            c, owner, UUID(claim.job_id), lock_reads=True)
    except ValueError as error:
        raise CodedDispatchError("La rehidratación del grafo admitido no validó.",
                                 code=REHYDRATE_INVALID) from error
    if restored.job_id != claim.job_id:
        raise CodedDispatchError("El trabajo Google no coincide con el claim.",
                                 code=CLAIM_STATE_INVALID)
    matches = tuple(step for step in restored.steps
                    if step.step_id == claim.step_id)
    if len(matches) != 1:
        raise CodedDispatchError("El step Google no pertenece al claim.",
                                 code=CLAIM_STATE_INVALID)
    step = matches[0]
    operation = step.payload.get("operation")
    snapshot = step.payload.get("requestSnapshot")
    if (step.kind != "google_generation" or not step.provider_call
            or not step.request_operation_id
            or not isinstance(operation, dict) or not isinstance(snapshot, dict)
            or operation.get("operationId") != step.request_operation_id
            or operation.get("requestSnapshot") != snapshot
            or not isinstance(operation.get("requestSha256"), str)):
        raise CodedDispatchError("La operación Google persistida no es verificable.",
                                 code=VERIFY_STRUCT_INVALID)
    snapshot_json = canonical_json(snapshot)
    # F2c discriminador (PURO, sin red/rebuild): ¿el sha persistido corresponde al hash canónico del snapshot
    # persistido? canonical_sha256(snapshot)==sha256(canonical_json(snapshot)); la cotización EXIGE (composite_
    # quote:142) que ese hash sea el requestSha256 persistido. Si aquí NO coincide, el sha se fijó sobre un
    # cuerpo DISTINTO del snapshot guardado (p.ej. storageUri inyectado en el cuerpo pero no en el sha, o un
    # bug de persistencia) → VERIFY_SHA_SNAPSHOT_MISMATCH. Si coincide pero la reconstrucción falla igual, es la
    # lógica de rebuild → VERIFY_RECONSTRUCT_INVALID. Separa las DOS familias de causa raíz en una sola E2E. El
    # round-trip PURO pasa offline con los constructores reales para toda entrada realista, así que este check
    # NO se dispara en el camino limpio (no cambia el comportamiento del clip legítimo). Pre-POST, 0 cargo.
    if canonical_sha256(snapshot) != operation["requestSha256"]:
        raise CodedDispatchError("El sha persistido no corresponde al snapshot persistido.",
                                 code=VERIFY_SHA_SNAPSHOT_MISMATCH)
    try:
        request = google_request_from_snapshot(
            snapshot_json, operation["requestSha256"])
    except ValueError as error:
        raise CodedDispatchError("La reconstrucción de la petición persistida falló.",
                                 code=VERIFY_RECONSTRUCT_INVALID) from error
    if (request.model != operation.get("model")
            or request.endpoint != operation.get("endpoint")):
        raise CodedDispatchError("La operación Google persistida cambió.",
                                 code=VERIFY_ENDPOINT_MODEL_INVALID)
    return GoogleClaimContext(
        claim, step.request_operation_id, operation["requestSha256"],
        snapshot_json, request)
