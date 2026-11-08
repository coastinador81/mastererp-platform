"""Borrado acotado de generaciones GCS del staging privado de Google.

No decide cuándo limpiar. El coordinador compartido debe acreditar primero que
los assets finales son durables. Este transporte nunca borra fuera de staging.
"""

from dataclasses import dataclass
import re
from urllib.parse import quote
from uuid import UUID

import requests

from .creative_bucket_readiness import bucket_metadata_endpoint
from .creative_composite_quote import canonical_sha256
from .creative_google_staging_manifest_reader import MANIFEST_MIME
from .creative_storage_contracts import StorageReceipt


_EXTENSIONS = {
    "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg",
    "image/webp": "webp", "audio/mpeg": "mp3",
    "audio/L16;codec=pcm;rate=24000": "pcm", "audio/wav": "wav",
    MANIFEST_MIME: "json",
}


class GoogleStagingCleanupUnknown(Exception):
    """No se pudo demostrar si la generación de staging sigue activa."""


@dataclass(frozen=True)
class GoogleStagingCleanupRequest:
    method: str
    endpoint: str
    reconcile_endpoint: str
    source: StorageReceipt


@dataclass(frozen=True)
class GoogleStagingCleanupReceipt:
    snapshot: dict
    sha256: str


def _uuid(value: object) -> None:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError("Identidad Google de staging no válida.") from None
    if parsed != value:
        raise ValueError("Identidad Google de staging no canónica.")


def _validate_source(source: StorageReceipt) -> None:
    if (not isinstance(source, StorageReceipt)
            or not isinstance(source.generation, int)
            or isinstance(source.generation, bool) or source.generation <= 0
            or source.mime_type not in _EXTENSIONS
            or not isinstance(source.byte_size, int)
            or isinstance(source.byte_size, bool) or source.byte_size <= 0
            or not re.fullmatch(r"[0-9a-f]{64}", source.sha256)):
        raise ValueError("Recibo Google de staging no válido.")
    bucket_metadata_endpoint(source.bucket)
    parts = source.name.split("/")
    if (not 7 <= len(parts) <= 32 or len(source.name) > 1024
            or parts[:3] != ["creative", "staging", "google"]):
        raise ValueError("Ruta Google de staging no válida.")
    _uuid(parts[3]); _uuid(parts[4])
    extension = _EXTENSIONS[source.mime_type]
    if len(parts) == 7:
        valid = (source.mime_type == MANIFEST_MIME
                 and parts[5] == "manifest"
                 and parts[6] == f"{source.sha256}.{extension}")
    elif len(parts) == 9 and parts[5] == "outputs":
        valid = (source.mime_type != MANIFEST_MIME
                 and parts[5] == "outputs"
                 and re.fullmatch(r"[0-9]{4}", parts[6]) is not None
                 and re.fullmatch(r"[0-9]{4}", parts[7]) is not None
                 and parts[8] == f"{source.sha256}.{extension}")
    elif len(parts) >= 8 and parts[5] == "provider":
        _uuid(parts[6])
        relative = parts[7:]
        valid = (source.mime_type == "video/mp4"
                 and bool(relative)
                 and all(item not in ("", ".", "..") and "%" not in item
                         for item in relative)
                 and relative[-1].endswith(".mp4"))
    else:
        valid = False
    if not valid:
        raise ValueError("Ruta Google de staging no válida.")


def google_staging_cleanup_request(
        source: StorageReceipt) -> GoogleStagingCleanupRequest:
    _validate_source(source)
    base = (f"https://storage.googleapis.com/storage/v1/b/{source.bucket}/o/"
            f"{quote(source.name, safe='')}")
    query = (f"generation={source.generation}"
             f"&ifGenerationMatch={source.generation}")
    return GoogleStagingCleanupRequest(
        "DELETE", base + "?" + query,
        base + f"?generation={source.generation}", source)


def validate_google_staging_cleanup_request(
        request: GoogleStagingCleanupRequest) -> None:
    if not isinstance(request, GoogleStagingCleanupRequest):
        raise ValueError("Petición Google de limpieza no válida.")
    if request != google_staging_cleanup_request(request.source):
        raise ValueError("Petición Google de limpieza alterada.")


def _receipt(source: StorageReceipt, status: str,
             absent: bool) -> GoogleStagingCleanupReceipt:
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_staging_cleanup_receipt",
        "bucket": source.bucket,
        "name": source.name,
        "generation": source.generation,
        "sha256": source.sha256,
        "status": status,
        "activeGenerationAbsent": absent,
        "permanentDeletionVerified": False,
        "publicationAuthorized": False,
    }
    return GoogleStagingCleanupReceipt(snapshot, canonical_sha256(snapshot))


def _metadata_matches(source: StorageReceipt, payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    try:
        generation = int(payload.get("generation", ""))
        byte_size = int(payload.get("size", ""))
    except (TypeError, ValueError):
        return False
    if not (payload.get("bucket") == source.bucket
            and payload.get("name") == source.name
            and generation == source.generation
            and payload.get("contentType") == source.mime_type
            and byte_size == source.byte_size):
        return False
    # H14: los MP4 de Veo de la rama provider/ NO llevan nuestro sha256 en custom
    # metadata; la generación fija (ya comprobada arriba) identifica el objeto exacto,
    # así que se verifica por generación/tamaño y no por el sha256 personalizado. Las
    # ramas outputs/ y manifest/ (que sí sellan sha256) lo siguen exigiendo.
    if source.name.split("/")[5:6] == ["provider"]:
        return True
    metadata = payload.get("metadata")
    return isinstance(metadata, dict) and metadata.get("sha256") == source.sha256


def cleanup_google_staging_once(
        request: GoogleStagingCleanupRequest, token: str,
        session: requests.Session) -> GoogleStagingCleanupReceipt:
    """Un DELETE máximo; la incertidumbre se resuelve con un GET exacto."""
    validate_google_staging_cleanup_request(request)
    if not isinstance(token, str) or not token:
        raise ValueError("Autorización Cloud Storage ausente.")
    headers = {"Authorization": "Bearer " + token}
    response = None
    try:
        response = session.request(
            "DELETE", request.endpoint, headers=headers, timeout=(10, 30),
            allow_redirects=False)
        if response.status_code == 204:
            return _receipt(request.source, "delete_accepted", True)
        if response.status_code == 404:
            return _receipt(request.source, "already_absent", True)
    except requests.RequestException:
        pass
    finally:
        if response is not None:
            response.close()
    follow_up = None
    network_error = None
    try:
        follow_up = session.request(
            "GET", request.reconcile_endpoint,
            headers=headers, timeout=(10, 30), allow_redirects=False)
        if follow_up.status_code == 404:
            return _receipt(request.source, "reconciled_absent", True)
        if follow_up.status_code != 200:
            raise GoogleStagingCleanupUnknown(
                "No se pudo reconciliar la limpieza Google.")
        try:
            payload = follow_up.json()
        except (ValueError, requests.RequestException) as error:
            raise GoogleStagingCleanupUnknown(
                "Metadata Google de staging ilegible.") from error
        if not _metadata_matches(request.source, payload):
            raise GoogleStagingCleanupUnknown(
                "La generación Google de staging no coincide.")
        return _receipt(request.source, "still_present", False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    finally:
        if follow_up is not None:
            follow_up.close()
    # H4: la RequestException del GET encadena el Bearer; se relanza fuera del
    # except (sin cause ni context) conservando solo el nombre de la clase.
    failure = GoogleStagingCleanupUnknown(
        "Reconciliación Google de staging interrumpida.")
    failure.cause_class = network_error
    raise failure from None
