"""Prefijo GCS reservado para outputs directos de Veo u Omni."""

from dataclasses import dataclass
import re

from .creative_bucket_readiness import bucket_metadata_endpoint
from .creative_google_generation_authority import (
    GoogleGenerationAuthority, GoogleGenerationFence,
    google_generation_authority_snapshot, google_generation_fence_snapshot)


_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


@dataclass(frozen=True)
class GoogleProviderOutputNamespace:
    bucket: str
    name_prefix: str
    uri: str


def google_provider_output_uri(bucket: str, owner_user_id: str, attempt_id: str,
                               operation_id: str) -> str:
    """§6 (constructor DELGADO del prefijo durable de Veo): compone el gs:// desde los
    CUATRO valores, sin el snapshot que valida todo el authority. Lo usa la reserva
    (reserve_once) al persistir output_prefix, y `google_provider_output_namespace`.
    google_project/google_location no entran en el prefijo (son del dispatch, los pina H5
    en el gate). Forma idéntica a `_VEO_OUTPUT_PREFIX` del transporte y al CHECK de la 129."""
    bucket_metadata_endpoint(bucket)
    for value, label in ((owner_user_id, "owner"), (attempt_id, "attempt"),
                         (operation_id, "operation")):
        if not isinstance(value, str) or not _UUID.fullmatch(value):
            raise ValueError(
                f"{label} del prefijo de salida no es un UUID canónico.")
    return (f"gs://{bucket}/creative/staging/google/{owner_user_id}/"
            f"{attempt_id}/provider/{operation_id}/")


def google_provider_output_namespace(
        bucket: str, authority: GoogleGenerationAuthority,
        fence: GoogleGenerationFence) -> GoogleProviderOutputNamespace:
    owner = google_generation_authority_snapshot(authority)
    attempt = google_generation_fence_snapshot(fence)
    uri = google_provider_output_uri(
        bucket, owner["ownerUserId"], attempt["attemptId"], owner["operationId"])
    return GoogleProviderOutputNamespace(
        bucket, uri[len(f"gs://{bucket}/"):], uri)
