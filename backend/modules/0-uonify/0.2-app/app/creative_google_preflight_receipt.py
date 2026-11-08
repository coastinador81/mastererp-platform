"""Recibo pequeño y rehashable del preflight Google de solo lectura."""

from dataclasses import dataclass
from datetime import datetime

from .creative_composite_quote import canonical_sha256
from .creative_google_capabilities import GoogleCreativeCatalog
from .creative_google_preflight import (
    GoogleCreativePreflight, require_current_preflight)


@dataclass(frozen=True)
class GooglePreflightReceipt:
    snapshot: dict
    sha256: str


def google_preflight_receipt(
        preflight: GoogleCreativePreflight, catalog: GoogleCreativeCatalog,
        *, now: datetime) -> GooglePreflightReceipt:
    require_current_preflight(preflight, catalog, preflight.model, now=now)
    snapshot = {
        "schemaVersion": 1,
        "project": preflight.project,
        "model": preflight.model,
        "catalogSha256": preflight.catalog_sha256,
        "status": preflight.status,
        "checkedAt": preflight.checked_at.isoformat(),
        "expiresAt": preflight.expires_at.isoformat(),
        "enabledServices": list(preflight.enabled_services),
        "grantedPermissions": list(preflight.granted_permissions),
        "modelGenerationVerified": False,
        "dispatchReady": True,
    }
    return GooglePreflightReceipt(snapshot, canonical_sha256(snapshot))


def verify_google_preflight_receipt(
        receipt: GooglePreflightReceipt, preflight: GoogleCreativePreflight,
        catalog: GoogleCreativeCatalog, *, now: datetime) -> None:
    expected = google_preflight_receipt(preflight, catalog, now=now)
    if (not isinstance(receipt, GooglePreflightReceipt)
            or receipt != expected):
        raise ValueError("El recibo de preflight Google no coincide.")
