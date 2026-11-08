"""Handoff durable Google→GCS para outputs inline, sin ejecutar HTTP."""

from dataclasses import asdict, dataclass
from uuid import NAMESPACE_URL, UUID, uuid5

from .creative_composite_quote import canonical_sha256
from .creative_generated_storage import (
    GeneratedStorageDraft, generated_storage_plan)
from .creative_google_preflight_receipt import GooglePreflightReceipt
from .creative_google_transport import GoogleDispatchResult
from .creative_storage_contracts import StorageReceipt


@dataclass(frozen=True)
class GoogleOutputStagingPlan:
    attempt_id: str
    request_sha256: str
    drafts: tuple[GeneratedStorageDraft, ...]


@dataclass(frozen=True)
class GoogleOutputStagingReceipt:
    snapshot: dict
    sha256: str


def google_output_staging_plan(
        result: GoogleDispatchResult, bucket: str,
        user_id: str) -> GoogleOutputStagingPlan:
    if not isinstance(result, GoogleDispatchResult):
        raise ValueError("Resultado Google no válido para staging.")
    try:
        UUID(result.attempt_id)
    except (TypeError, ValueError, AttributeError):
        raise ValueError("Intento Google no válido para staging.") from None
    # Voiceover PCM produce además un WAV derivado; dos IDs por output cubren
    # el máximo y generated_storage_plan exige exactamente los necesarios.
    maximum = len(result.outputs) * 2
    candidate_ids = tuple(str(uuid5(
        NAMESPACE_URL,
        f"uonify:{result.attempt_id}:google-output:{ordinal}"))
        for ordinal in range(maximum))
    for count in range(len(result.outputs), maximum + 1):
        try:
            drafts = generated_storage_plan(
                result, bucket, user_id, candidate_ids[:count])
        except ValueError as error:
            if "Cantidad de IDs" in str(error) and count < maximum:
                continue
            raise
        return GoogleOutputStagingPlan(
            result.attempt_id, result.request_sha256, drafts)
    raise ValueError("No se pudo cerrar el staging de outputs Google.")


def google_output_staging_receipt(
        result: GoogleDispatchResult, plan: GoogleOutputStagingPlan,
        receipts: tuple[StorageReceipt, ...],
        preflight: GooglePreflightReceipt) -> GoogleOutputStagingReceipt:
    if (not isinstance(result, GoogleDispatchResult)
            or result.state != "completed" or not result.outputs
            or not isinstance(plan, GoogleOutputStagingPlan)
            or plan.attempt_id != result.attempt_id
            or plan.request_sha256 != result.request_sha256
            or not isinstance(receipts, tuple)
            or len(receipts) != len(plan.drafts)
            or not isinstance(preflight, GooglePreflightReceipt)
            or canonical_sha256(preflight.snapshot) != preflight.sha256):
        raise ValueError("El staging Google no coincide con el resultado.")
    objects = []
    for draft, receipt in zip(plan.drafts, receipts):
        expected = draft.upload.expected
        if (not isinstance(receipt, StorageReceipt)
                or (receipt.bucket, receipt.name, receipt.mime_type,
                    receipt.byte_size, receipt.sha256)
                != (expected.bucket, expected.name, expected.mime_type,
                    expected.byte_size, expected.sha256)):
            raise ValueError("Un recibo GCS no coincide con el output Google.")
        objects.append({
            "assetId": draft.asset_id, "role": draft.role,
            "storageReceipt": asdict(receipt),
            "metadata": draft.metadata, "lineage": draft.lineage,
        })
    snapshot = {
        "schemaVersion": 1,
        "attemptId": result.attempt_id,
        "requestSha256": result.request_sha256,
        "dispatchReceipt": result.receipt,
        "preflightReceiptSha256": preflight.sha256,
        "objects": objects,
        "publicationAuthorized": False,
    }
    return GoogleOutputStagingReceipt(snapshot, canonical_sha256(snapshot))
