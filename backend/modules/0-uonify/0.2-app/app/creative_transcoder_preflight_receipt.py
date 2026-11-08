"""Recibo durable y sin credenciales del preflight Transcoder."""

from dataclasses import dataclass
from datetime import datetime

from .creative_composite_quote import canonical_sha256
from .creative_transcoder_preflight import (
    TranscoderPreflight, require_current_transcoder_preflight)


@dataclass(frozen=True)
class TranscoderPreflightReceipt:
    snapshot: dict
    sha256: str


def transcoder_preflight_receipt(
        preflight: TranscoderPreflight, *,
        now: datetime) -> TranscoderPreflightReceipt:
    require_current_transcoder_preflight(
        preflight, preflight.project, now=now)
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_transcoder_preflight",
        "project": preflight.project,
        "region": preflight.region,
        "status": preflight.status,
        "checkedAt": preflight.checked_at.isoformat(),
        "expiresAt": preflight.expires_at.isoformat(),
        "enabledServices": list(preflight.enabled_services),
        "grantedPermissions": list(preflight.granted_permissions),
        "billingEnabled": True,
        "dispatchReady": True,
        "jobCreated": False,
    }
    return TranscoderPreflightReceipt(snapshot, canonical_sha256(snapshot))


def verify_transcoder_preflight_receipt(
        receipt: TranscoderPreflightReceipt,
        preflight: TranscoderPreflight, *, now: datetime) -> None:
    expected = transcoder_preflight_receipt(preflight, now=now)
    if (not isinstance(receipt, TranscoderPreflightReceipt)
            or receipt != expected):
        raise ValueError("El recibo de preflight Transcoder no coincide.")
