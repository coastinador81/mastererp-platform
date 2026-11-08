"""Preflight Google sin generación, separado de aprobación y dispatch."""

from dataclasses import dataclass
from datetime import datetime, timedelta
import re
from typing import Protocol

from .creative_google_capabilities import GoogleCreativeCatalog
from .creative_google_dispatch_codes import (
    BILLING_INACTIVE, CHECKED_FUTURE, CodedDispatchError, EXPIRED, FIELD,
    PERMISSION_MISSING, PROJECT_INACTIVE, SERVICE_MISSING)


_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_KNOWN_SERVICES = frozenset({
    "aiplatform.googleapis.com", "storage.googleapis.com",
    "texttospeech.googleapis.com", "transcoder.googleapis.com",
})
_VERTEX_PERMISSIONS = frozenset({"aiplatform.endpoints.predict"})
_TRANSCODER_PERMISSIONS = frozenset({
    "transcoder.jobs.create", "transcoder.jobs.get",
})


class GoogleCreativePreflightClient(Protocol):
    def project(self, token: str, project: str) -> dict | None:
        ...

    def billing_info(self, token: str, project: str) -> dict:
        ...

    def service_state(self, token: str, resource: str, service: str) -> str:
        ...

    def permissions(self, token: str, project: str,
                    requested: tuple[str, ...]) -> tuple[str, ...]:
        ...


@dataclass(frozen=True)
class GoogleCreativePreflight:
    schema_version: int
    project: str
    model: str
    catalog_sha256: str
    status: str
    checked_at: datetime
    expires_at: datetime
    enabled_services: tuple[str, ...]
    granted_permissions: tuple[str, ...]
    model_generation_verified: bool
    dispatch_ready: bool


def creative_google_preflight(
        client: GoogleCreativePreflightClient, token: str,
        catalog: GoogleCreativeCatalog, model: str,
        required_services: tuple[str, ...], *,
        now: datetime) -> GoogleCreativePreflight:
    """Comprueba cuenta/proyecto/servicios/IAM sin consumir generación."""
    capabilities = {item.model: item for item in catalog.capabilities}
    capability = capabilities.get(model)
    primary_service = ("texttospeech.googleapis.com"
                       if capability is not None
                       and capability.service == "cloud_text_to_speech"
                       else "aiplatform.googleapis.com")
    if (not isinstance(token, str) or not token
            or not isinstance(now, datetime) or not now.tzinfo
            or not isinstance(catalog, GoogleCreativeCatalog)
            or catalog.project != catalog.project.strip()
            or not _PROJECT.fullmatch(catalog.project)
            or not _HASH.fullmatch(catalog.catalog_sha256)
            or capability is None
            or not isinstance(required_services, tuple)
            or not required_services
            or len(required_services) != len(set(required_services))
            or any(item not in _KNOWN_SERVICES for item in required_services)
            or primary_service not in required_services):
        raise ValueError("Preflight creativo Google no válido.")
    project = client.project(token, catalog.project)
    if (not isinstance(project, dict) or project.get("id") != catalog.project
            or not isinstance(project.get("resource"), str)
            or not project["resource"].startswith("projects/")):
        raise CodedDispatchError("El proyecto Google no está activo.",
                                 code=PROJECT_INACTIVE)
    billing = client.billing_info(token, catalog.project)
    if not isinstance(billing, dict) or billing.get("enabled") is not True:
        raise CodedDispatchError("La facturación Google no está activa.",
                                 code=BILLING_INACTIVE)
    enabled = tuple(service for service in required_services
                    if client.service_state(
                        token, project["resource"], service) == "ENABLED")
    if enabled != required_services:
        raise CodedDispatchError("Falta un servicio Google requerido.",
                                 code=SERVICE_MISSING)
    required_permissions = {"serviceusage.services.use"}
    if primary_service == "aiplatform.googleapis.com":
        required_permissions.update(_VERTEX_PERMISSIONS)
    if "transcoder.googleapis.com" in required_services:
        required_permissions.update(_TRANSCODER_PERMISSIONS)
    requested = tuple(sorted(required_permissions))
    granted = client.permissions(token, catalog.project, requested)
    if (not isinstance(granted, tuple) or set(granted) != set(requested)
            or len(granted) != len(set(granted))):
        raise CodedDispatchError("Falta un permiso Google requerido.",
                                 code=PERMISSION_MISSING)
    return GoogleCreativePreflight(
        1, catalog.project, model, catalog.catalog_sha256,
        "infrastructure_ready", now, now + timedelta(minutes=10),
        enabled, tuple(sorted(granted)), False, True)


def require_current_preflight(
        preflight: GoogleCreativePreflight, catalog: GoogleCreativeCatalog,
        model: str, *, now: datetime) -> None:
    """Revalida la identidad exacta; nunca convierte esto en prueba del modelo.

    F3-split: MISMAS condiciones, código más fino por capa (sin debilitar, behavior-preserving). FIELD cubre
    identidad/estructura + los guards de tipo/None + la ventana; CHECKED_FUTURE = checked_at>now (guard
    anti-futuro/tamper, síntoma de dos-relojes); EXPIRED = expires_at<=now (TTL agotado). FIELD va PRIMERO para
    que los guards de tipo/None protejan las comparaciones temporales (idéntico al OR con corto-circuito original)."""
    if (not isinstance(preflight, GoogleCreativePreflight)
            or not isinstance(now, datetime) or not now.tzinfo
            or preflight.status != "infrastructure_ready"
            or preflight.project != catalog.project
            or preflight.catalog_sha256 != catalog.catalog_sha256
            or preflight.model != model
            or preflight.model_generation_verified is not False
            or preflight.dispatch_ready is not True
            or preflight.expires_at - preflight.checked_at != timedelta(minutes=10)):
        raise CodedDispatchError("El preflight creativo Google no está vigente.",
                                 code=FIELD)
    if preflight.checked_at > now:
        raise CodedDispatchError("El preflight creativo Google no está vigente.",
                                 code=CHECKED_FUTURE)
    if preflight.expires_at <= now:
        raise CodedDispatchError("El preflight creativo Google no está vigente.",
                                 code=EXPIRED)
