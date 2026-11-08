"""Rewrite genérico staging Google→asset canónico; contrato puro sin HTTP."""

from dataclasses import dataclass, replace
import re
from urllib.parse import quote
from uuid import UUID

from .creative_google_staging_v2 import GoogleStagingArtifact
from .creative_provider_asset_adoption import AdoptionObject, ProviderAdoptionDraft
from .creative_storage_contracts import StorageReceipt


_EXTENSIONS = {
    "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg",
    "image/webp": "webp", "audio/mpeg": "mp3",
    "audio/L16;codec=pcm;rate=24000": "pcm", "audio/wav": "wav",
}


def canonical_asset_extension(mime_type: str) -> str:
    """Extensión canónica mime→ext del asset durable; única fuente compartida.

    Cualquier flujo que construya el nombre durable
    ``creative/users/{owner}/assets/{asset_id}/{sha256}.{ext}`` debe derivar la
    extensión de aquí para que el nombre case byte a byte con el que registra el
    envelope. Un mime sin extensión canónica es un error (nunca un nombre vacío).
    """
    extension = _EXTENSIONS.get(mime_type)
    if extension is None:
        raise ValueError("Tipo de medio sin extensión canónica.")
    return extension


@dataclass(frozen=True)
class GoogleStagingAdoptionRequest:
    method: str
    endpoint: str
    body: dict
    source: StorageReceipt
    draft: ProviderAdoptionDraft
    rewrite_token: str | None = None


def _endpoint(source: StorageReceipt, expected: AdoptionObject,
              token: str | None = None) -> str:
    value = (
        f"https://storage.googleapis.com/storage/v1/b/{source.bucket}/o/"
        f"{quote(source.name, safe='')}/rewriteTo/b/{expected.bucket}/o/"
        f"{quote(expected.name, safe='')}?sourceGeneration={source.generation}"
        f"&ifSourceGenerationMatch={source.generation}"
        "&ifGenerationMatch=0")
    return value + (f"&rewriteToken={quote(token, safe='')}" if token else "")


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f"{label} Google no válido.") from None
    if parsed != value:
        raise ValueError(f"{label} Google no canónico.")
    return parsed


def _create_request(source: StorageReceipt, *, asset_id: str, role: str,
                    mime_type: str, digest: str, metadata: dict,
                    lineage: dict) -> GoogleStagingAdoptionRequest:
    parts = source.name.split("/") if isinstance(source, StorageReceipt) else []
    extension = _EXTENSIONS.get(mime_type)
    if (not isinstance(source, StorageReceipt) or source.generation <= 0
            or extension is None or source.mime_type != mime_type
            or source.byte_size <= 0 or source.sha256 != digest
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or len(parts) != 9
            or parts[:3] != ["creative", "staging", "google"]
            or parts[5] != "outputs"
            or not re.fullmatch(r"[0-9]{4}", parts[6])
            or not re.fullmatch(r"[0-9]{4}", parts[7])
            or parts[8] != f"{digest}.{extension}"
            or not isinstance(role, str) or not role
            or not isinstance(metadata, dict) or not isinstance(lineage, dict)
            or not lineage):
        raise ValueError("Recibo Google de staging no válido.")
    owner_user_id = _uuid(parts[3], "Propietario")
    _uuid(parts[4], "Intento")
    asset_id = _uuid(asset_id, "Asset")
    name = (f"creative/users/{owner_user_id}/assets/{asset_id}/"
            f"{digest}.{extension}")
    expected = AdoptionObject(
        source.bucket, name, mime_type, source.byte_size, digest)
    adopted = ProviderAdoptionDraft(
        asset_id, role, mime_type, digest, metadata,
        {**lineage, "stagingBucket": source.bucket,
         "stagingName": source.name,
         "stagingGeneration": source.generation}, expected)
    body = {"name": name, "contentType": mime_type,
            "cacheControl": "private, no-store",
            "metadata": {"sha256": digest}}
    return GoogleStagingAdoptionRequest(
        "POST", _endpoint(source, expected), body, source, adopted)


def google_staging_adoption_request(
        artifact: GoogleStagingArtifact,
        source: StorageReceipt) -> GoogleStagingAdoptionRequest:
    if not isinstance(artifact, GoogleStagingArtifact):
        raise ValueError("Artefacto Google de staging no válido.")
    draft, expected_source = artifact.draft, artifact.draft.upload.expected
    if (not isinstance(source, StorageReceipt) or source.generation <= 0
            or source.mime_type not in _EXTENSIONS
            or (source.bucket, source.name, source.mime_type,
                source.byte_size, source.sha256)
            != (expected_source.bucket, expected_source.name,
                expected_source.mime_type, expected_source.byte_size,
                expected_source.sha256)
            or any(value in ("", ".", "..") for value in source.name.split("/"))):
        raise ValueError("Recibo Google de staging no válido.")
    return _create_request(
        source, asset_id=draft.asset_id, role=draft.role,
        mime_type=draft.mime_type, digest=draft.sha256,
        metadata=draft.metadata, lineage=draft.lineage)


def google_manifest_output_adoption_request(
        item: dict) -> GoogleStagingAdoptionRequest:
    """Reconstruye un rewrite únicamente desde un output de manifiesto leído."""
    required = {"outputOrdinal", "artifactOrdinal", "assetId", "role",
                "mimeType", "byteSize", "sha256", "stagingStorageReceipt",
                "metadata", "lineage"}
    if not isinstance(item, dict) or set(item) != required:
        raise ValueError("Output Google de manifiesto no válido.")
    value = item["stagingStorageReceipt"]
    receipt_keys = {
        "bucket", "name", "generation", "mime_type", "byte_size", "sha256"}
    if (not isinstance(value, dict) or set(value) != receipt_keys
            or not isinstance(item["outputOrdinal"], int)
            or isinstance(item["outputOrdinal"], bool)
            or item["outputOrdinal"] < 0
            or not isinstance(item["artifactOrdinal"], int)
            or isinstance(item["artifactOrdinal"], bool)
            or item["artifactOrdinal"] < 0
            or not isinstance(item["byteSize"], int)
            or isinstance(item["byteSize"], bool)
            or item["byteSize"] <= 0
            or value.get("byte_size") != item["byteSize"]
            or value.get("mime_type") != item["mimeType"]
            or value.get("sha256") != item["sha256"]):
        raise ValueError("Recibo Google de manifiesto no válido.")
    try:
        source = StorageReceipt(
            value["bucket"], value["name"], value["generation"],
            value["mime_type"], value["byte_size"], value["sha256"])
    except (KeyError, TypeError):
        raise ValueError("Recibo Google de manifiesto no válido.") from None
    parts = source.name.split("/")
    if (len(parts) != 9
            or parts[6] != f"{item['outputOrdinal']:04d}"
            or parts[7] != f"{item['artifactOrdinal']:04d}"):
        raise ValueError("Posición Google de manifiesto no válida.")
    return _create_request(
        source, asset_id=item["assetId"], role=item["role"],
        mime_type=item["mimeType"], digest=item["sha256"],
        metadata=item["metadata"], lineage=item["lineage"])


def google_staging_adoption_response(
        request: GoogleStagingAdoptionRequest,
        response: dict) -> GoogleStagingAdoptionRequest | StorageReceipt:
    if (not isinstance(request, GoogleStagingAdoptionRequest)
            or request.method != "POST" or not isinstance(response, dict)):
        raise ValueError("Respuesta de adopción Google no válida.")
    try:
        rewritten = int(response.get("totalBytesRewritten", ""))
        size = int(response.get("objectSize", ""))
    except (TypeError, ValueError):
        raise ValueError("Progreso de adopción Google no válido.") from None
    expected = request.draft.expected
    if size != expected.byte_size or not 0 <= rewritten <= size:
        raise ValueError("El rewrite Google no corresponde al staging.")
    if response.get("done") is not True:
        token = response.get("rewriteToken")
        if (not isinstance(token, str) or not 1 <= len(token) <= 2048
                or any(char.isspace() for char in token) or rewritten >= size):
            raise ValueError("Token de continuación Google no válido.")
        return replace(
            request, endpoint=_endpoint(request.source, expected, token),
            rewrite_token=token)
    resource = response.get("resource")
    if not isinstance(resource, dict) or rewritten != size:
        raise ValueError("El rewrite Google no contiene un recurso final.")
    try:
        generation = int(resource.get("generation", ""))
        byte_size = int(resource.get("size", ""))
    except (TypeError, ValueError):
        raise ValueError("Recibo de adopción Google no válido.") from None
    metadata = resource.get("metadata")
    if (resource.get("bucket") != expected.bucket
            or resource.get("name") != expected.name
            or resource.get("contentType") != expected.mime_type
            or generation <= 0 or byte_size != expected.byte_size
            or not isinstance(metadata, dict)
            or metadata.get("sha256") != expected.sha256):
        raise ValueError("El asset adoptado no coincide con el destino Google.")
    return StorageReceipt(
        expected.bucket, expected.name, generation, expected.mime_type,
        byte_size, expected.sha256)


def validate_google_staging_adoption_request(
        request: GoogleStagingAdoptionRequest) -> None:
    """Reconstruye precondiciones, destino y metadata antes de usar token."""
    if not isinstance(request, GoogleStagingAdoptionRequest):
        raise ValueError("Petición Google de adopción no válida.")
    source, draft, expected = request.source, request.draft, request.draft.expected
    source_parts, target_parts = source.name.split("/"), expected.name.split("/")
    source_owner = source_parts[3] if len(source_parts) > 3 else ""
    extension = _EXTENSIONS.get(source.mime_type)
    canonical_name = (f"creative/users/{source_owner}/assets/"
                      f"{draft.asset_id}/{source.sha256}."
                      f"{extension or ''}")
    expected_body = {
        "name": expected.name, "contentType": expected.mime_type,
        "cacheControl": "private, no-store",
        "metadata": {"sha256": expected.sha256},
    }
    if (len(source_parts) < 9
            or extension is None
            or source_parts[:3] != ["creative", "staging", "google"]
            or source_parts[5] != "outputs"
            or len(target_parts) != 6
            or target_parts[:2] != ["creative", "users"]
            or target_parts[2] != source_parts[3]
            or target_parts[3] != "assets"
            or target_parts[4] != draft.asset_id
            or expected.name != canonical_name
            or (source.bucket, source.mime_type, source.byte_size, source.sha256)
            != (expected.bucket, expected.mime_type,
                expected.byte_size, expected.sha256)
            or draft.mime_type != expected.mime_type
            or draft.sha256 != expected.sha256
            or draft.lineage.get("stagingBucket") != source.bucket
            or draft.lineage.get("stagingName") != source.name
            or draft.lineage.get("stagingGeneration") != source.generation
            or request.method != "POST" or request.body != expected_body
            or request.endpoint != _endpoint(
                source, expected, request.rewrite_token)):
        raise ValueError("Petición Google de adopción alterada.")
