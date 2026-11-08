"""Lector privado del manifiesto Google v2; separado del lector de medios."""

from dataclasses import dataclass
from hashlib import sha256
import json
import re
from urllib.parse import quote
from uuid import UUID

import requests

from .creative_bucket_readiness import bucket_metadata_endpoint
from .creative_composite_quote import HASH, canonical_json
from .creative_google_generation_authority import (
    GoogleGenerationAuthority, GoogleGenerationFence,
    google_generation_authority_snapshot, google_generation_fence_snapshot)
from .creative_storage_contracts import StorageReceipt


MANIFEST_MIME = "application/vnd.uonify.google-staging-manifest+json"
_MIME = frozenset({
    "video/mp4", "image/png", "image/jpeg", "image/webp", "audio/mpeg",
    "audio/L16;codec=pcm;rate=24000", "audio/wav"})
_EXTENSION = {
    "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg",
    "image/webp": "webp", "audio/mpeg": "mp3",
    "audio/L16;codec=pcm;rate=24000": "pcm", "audio/wav": "wav"}


class GoogleManifestReadError(Exception):
    """El manifiesto no se pudo leer o no acredita el staging previsto."""


@dataclass(frozen=True)
class GoogleStagingManifest:
    snapshot: dict
    sha256: str
    receipt: StorageReceipt


def _uuid(value: object) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise GoogleManifestReadError("Identidad del manifiesto no válida.") from None
    if parsed != value:
        raise GoogleManifestReadError("Identidad del manifiesto no canónica.")
    return parsed


def google_manifest_download_endpoint(receipt: StorageReceipt) -> str:
    if (not isinstance(receipt, StorageReceipt) or receipt.generation <= 0
            or receipt.mime_type != MANIFEST_MIME
            or not 1 <= receipt.byte_size <= 4 * 1024 ** 2
            or not HASH.fullmatch(receipt.sha256)):
        raise GoogleManifestReadError("Recibo del manifiesto Google no válido.")
    parts = receipt.name.split("/")
    if (len(parts) != 7
            or parts[:3] != ["creative", "staging", "google"]
            or parts[5] != "manifest"
            or parts[6] != receipt.sha256 + ".json"):
        raise GoogleManifestReadError("Ruta del manifiesto Google no válida.")
    _uuid(parts[3]); _uuid(parts[4])
    bucket_metadata_endpoint(receipt.bucket)
    return (f"https://storage.googleapis.com/storage/v1/b/{receipt.bucket}/o/"
            f"{quote(receipt.name, safe='')}?alt=media"
            f"&generation={receipt.generation}")


def _validate_output(item: object, authority: dict, fence: dict,
                     expected_bucket: str, seen_assets: set[str],
                     seen_positions: set[tuple[int, int]]
                     ) -> tuple[int, int]:
    if not isinstance(item, dict):
        raise GoogleManifestReadError("Output del manifiesto no válido.")
    required = {"outputOrdinal", "artifactOrdinal", "assetId", "role",
                "mimeType", "byteSize", "sha256", "stagingStorageReceipt",
                "metadata", "lineage"}
    if set(item) != required:
        raise GoogleManifestReadError("Forma del output Google no válida.")
    output_ordinal, artifact_ordinal = (
        item["outputOrdinal"], item["artifactOrdinal"])
    position = (output_ordinal, artifact_ordinal)
    asset_id = _uuid(item["assetId"])
    receipt = item["stagingStorageReceipt"]
    if (not isinstance(output_ordinal, int) or isinstance(output_ordinal, bool)
            or output_ordinal < 0 or not isinstance(artifact_ordinal, int)
            or isinstance(artifact_ordinal, bool) or artifact_ordinal < 0
            or position in seen_positions or asset_id in seen_assets
            or not isinstance(item["role"], str) or not item["role"]
            or item["mimeType"] not in _MIME
            or not isinstance(item["byteSize"], int)
            or isinstance(item["byteSize"], bool) or item["byteSize"] <= 0
            or not HASH.fullmatch(item["sha256"])
            or not isinstance(item["metadata"], dict)
            or not isinstance(item["lineage"], dict) or not item["lineage"]
            or not isinstance(receipt, dict)
            or set(receipt) != {"bucket", "name", "generation", "mime_type",
                                "byte_size", "sha256"}
            or not isinstance(receipt["generation"], int)
            or isinstance(receipt["generation"], bool)
            or receipt["generation"] <= 0
            or (receipt["mime_type"], receipt["byte_size"], receipt["sha256"])
            != (item["mimeType"], item["byteSize"], item["sha256"])):
        raise GoogleManifestReadError("Contenido del output Google no válido.")
    prefix = (f"creative/staging/google/{authority['ownerUserId']}/"
              f"{fence['attemptId']}/outputs/{output_ordinal:04d}/"
              f"{artifact_ordinal:04d}/{item['sha256']}."
              f"{_EXTENSION[item['mimeType']]}")
    if (receipt["bucket"] != expected_bucket
            or not isinstance(receipt["name"], str)
            or receipt["name"] != prefix):
        raise GoogleManifestReadError("Namespace del output Google no válido.")
    seen_assets.add(asset_id); seen_positions.add(position)
    return position


def parse_google_staging_manifest(
        data: bytes, receipt: StorageReceipt,
        authority: GoogleGenerationAuthority,
        fence: GoogleGenerationFence) -> GoogleStagingManifest:
    google_manifest_download_endpoint(receipt)
    if (not isinstance(data, bytes) or len(data) != receipt.byte_size
            or sha256(data).hexdigest() != receipt.sha256):
        raise GoogleManifestReadError("Bytes del manifiesto Google no coinciden.")
    try:
        snapshot = json.loads(data)
    except (UnicodeDecodeError, ValueError) as error:
        raise GoogleManifestReadError("JSON del manifiesto Google ilegible.") from error
    if canonical_json(snapshot).encode() != data:
        raise GoogleManifestReadError("El manifiesto Google no es canónico.")
    expected_authority = google_generation_authority_snapshot(authority)
    expected_fence = google_generation_fence_snapshot(fence)
    if (not isinstance(snapshot, dict)
            or set(snapshot) != {"schemaVersion", "kind", "authority", "fence",
                                 "dispatchReceipt", "preflightReceiptSha256",
                                 "usage", "outputs", "publicationAuthorized"}
            or snapshot["schemaVersion"] != 2
            or snapshot["kind"] != "google_staging_manifest"
            or snapshot["authority"] != expected_authority
            or snapshot["fence"] != expected_fence
            or snapshot["publicationAuthorized"] is not False
            or not HASH.fullmatch(snapshot["preflightReceiptSha256"])
            or not isinstance(snapshot["dispatchReceipt"], dict)
            or (snapshot["usage"] is not None
                and not isinstance(snapshot["usage"], dict))
            or not isinstance(snapshot["outputs"], list)
            or not 1 <= len(snapshot["outputs"]) <= 128):
        raise GoogleManifestReadError("Autoridad o forma del manifiesto no válida.")
    dispatch = snapshot["dispatchReceipt"]
    if (set(dispatch) != {"attemptId", "requestSha256", "provider", "state",
                          "providerOperation", "outputSha256", "usage"}
            or dispatch.get("attemptId") != fence.attempt_id
            or dispatch.get("requestSha256") != authority.request_sha256
            or dispatch.get("state") != "completed"
            or dispatch.get("providerOperation") is not None
            or dispatch.get("provider") not in {
                "google_vertex_ai", "google_cloud_tts"}
            or dispatch.get("usage") != snapshot["usage"]):
        raise GoogleManifestReadError("Dispatch del manifiesto no válido.")
    assets, positions = set(), set()
    order = [_validate_output(
        item, expected_authority, expected_fence, receipt.bucket,
        assets, positions)
        for item in snapshot["outputs"]]
    if order != sorted(order):
        raise GoogleManifestReadError("Outputs del manifiesto fuera de orden.")
    output_ordinals = sorted({value[0] for value in order})
    if output_ordinals != list(range(len(output_ordinals))):
        raise GoogleManifestReadError("Outputs del manifiesto no son contiguos.")
    for output_ordinal in output_ordinals:
        artifacts = [value[1] for value in order
                     if value[0] == output_ordinal]
        if artifacts != list(range(len(artifacts))):
            raise GoogleManifestReadError(
                "Artefactos del manifiesto no son contiguos.")
    return GoogleStagingManifest(snapshot, receipt.sha256, receipt)


def fetch_google_staging_manifest(
        receipt: StorageReceipt, authority: GoogleGenerationAuthority,
        fence: GoogleGenerationFence, token: str,
        session: requests.Session) -> GoogleStagingManifest:
    endpoint = google_manifest_download_endpoint(receipt)
    if not isinstance(token, str) or not token:
        raise ValueError("Autorización Cloud Storage ausente.")
    try:
        response = session.request(
            "GET", endpoint, headers={"Authorization": "Bearer " + token},
            timeout=(10, 30), allow_redirects=False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    else:
        network_error = None
    if network_error is not None:
        # H4: no encadenar la RequestException (lleva el Bearer en .request);
        # se relanza fuera del except conservando solo el nombre de la clase.
        failure = GoogleManifestReadError(
            "Descarga del manifiesto Google interrumpida.")
        failure.cause_class = network_error
        raise failure from None
    try:
        if response.status_code != 200:
            raise GoogleManifestReadError(
                "No se pudo descargar el manifiesto Google.")
        return parse_google_staging_manifest(
            response.content, receipt, authority, fence)
    finally:
        response.close()
