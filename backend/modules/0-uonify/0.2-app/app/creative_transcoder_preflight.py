"""Preflight de solo lectura para el export opcional con Transcoder."""

from dataclasses import dataclass
from datetime import datetime, timedelta
import re

from .creative_google_preflight import GoogleCreativePreflightClient


_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_SERVICES = ("storage.googleapis.com", "transcoder.googleapis.com")
_PERMISSIONS = (
    "serviceusage.services.use", "transcoder.jobs.create",
    "transcoder.jobs.get",
)


@dataclass(frozen=True)
class TranscoderPreflight:
    schema_version: int
    project: str
    region: str
    status: str
    checked_at: datetime
    expires_at: datetime
    enabled_services: tuple[str, ...]
    granted_permissions: tuple[str, ...]
    billing_enabled: bool
    dispatch_ready: bool


def transcoder_preflight(
        client: GoogleCreativePreflightClient, token: str, project: str, *,
        now: datetime) -> TranscoderPreflight:
    """Comprueba infraestructura sin crear bucket, job ni consumo."""
    if (not isinstance(token, str) or not token
            or not isinstance(project, str) or not _PROJECT.fullmatch(project)
            or not isinstance(now, datetime) or not now.tzinfo):
        raise ValueError("Preflight Transcoder no válido.")
    resource = client.project(token, project)
    if (not isinstance(resource, dict) or resource.get("id") != project
            or not isinstance(resource.get("resource"), str)
            or not resource["resource"].startswith("projects/")):
        raise ValueError("El proyecto Google no está activo.")
    billing = client.billing_info(token, project)
    if not isinstance(billing, dict) or billing.get("enabled") is not True:
        raise ValueError("La facturación Google no está activa.")
    enabled = tuple(service for service in _SERVICES
                    if client.service_state(
                        token, resource["resource"], service) == "ENABLED")
    if enabled != _SERVICES:
        raise ValueError("Falta un servicio para Transcoder.")
    granted = client.permissions(token, project, _PERMISSIONS)
    if (not isinstance(granted, tuple) or granted != _PERMISSIONS
            or len(granted) != len(set(granted))):
        raise ValueError("Falta un permiso para Transcoder.")
    return TranscoderPreflight(
        1, project, "europe-west1", "infrastructure_ready", now,
        now + timedelta(minutes=10), enabled, granted, True, True)


def require_current_transcoder_preflight(
        value: TranscoderPreflight, project: str, *, now: datetime) -> None:
    """Exige el mismo proyecto y una prueba completa de diez minutos."""
    if (not isinstance(value, TranscoderPreflight)
            or not isinstance(now, datetime) or not now.tzinfo
            or value.schema_version != 1 or value.project != project
            or value.region != "europe-west1"
            or value.status != "infrastructure_ready"
            or value.enabled_services != _SERVICES
            or value.granted_permissions != _PERMISSIONS
            or value.billing_enabled is not True
            or value.dispatch_ready is not True
            or value.checked_at > now or value.expires_at <= now
            or value.expires_at - value.checked_at != timedelta(minutes=10)):
        raise ValueError("El preflight Transcoder no está vigente.")
