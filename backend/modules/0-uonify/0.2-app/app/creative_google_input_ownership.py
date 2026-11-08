"""Liga inputs Google a recibos GCS privados antes de cualquier POST."""

from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import sha256
import re
from uuid import UUID

from .creative_composite_quote import canonical_sha256
from .creative_image_contracts import ImageRequest
from .creative_music_contracts import MusicRequest
from .creative_request_fingerprint import fingerprint
from .creative_storage_contracts import StorageReceipt
from .creative_video_contracts import VideoRequest


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z")
_EXTENSION = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "video/mp4": "mp4",
}


@dataclass(frozen=True)
class GoogleOwnedInputBinding:
    owner_id: str
    request_sha256: str
    receipts: tuple[StorageReceipt, ...]
    snapshot: dict
    sha256: str


def _owner(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError("Propietario de inputs Google no válido.") from error


def _inline(kind: str, mime_type: object, encoded: object) -> dict:
    if not isinstance(mime_type, str) or not isinstance(encoded, str):
        raise ValueError("Input inline Google no válido.")
    try:
        data = b64decode(encoded, validate=True)
    except (Base64Error, ValueError) as error:
        raise ValueError("Input inline Google no válido.") from error
    if not data:
        raise ValueError("Input inline Google no válido.")
    return {
        "kind": kind, "mimeType": mime_type, "bytes": len(data),
        "sha256": sha256(data).hexdigest(), "uri": None,
    }


def _gcs(kind: str, mime_type: object, uri: object) -> dict:
    if (not isinstance(mime_type, str) or not isinstance(uri, str)
            or not uri.startswith("gs://")):
        raise ValueError("Input GCS Google no válido.")
    return {"kind": kind, "mimeType": mime_type, "uri": uri}


def _receipt_path(receipt: StorageReceipt, prefix: str) -> bool:
    if (not isinstance(receipt.bucket, str)
            or not isinstance(receipt.name, str)
            or not isinstance(receipt.mime_type, str)
            or not isinstance(receipt.sha256, str)):
        return False
    extension = _EXTENSION.get(receipt.mime_type)
    if (extension is None or not _BUCKET.fullmatch(receipt.bucket)
            or ".." in receipt.bucket or receipt.bucket.startswith(("goog", "g00g"))
            or not receipt.name.startswith(prefix)):
        return False
    tail = receipt.name[len(prefix):].split("/")
    if len(tail) != 2:
        return False
    try:
        asset_id = str(UUID(tail[0]))
    except (ValueError, TypeError, AttributeError):
        return False
    return asset_id == tail[0] and tail[1] == f"{receipt.sha256}.{extension}"


def _image_inputs(request: ImageRequest) -> tuple[dict, ...]:
    contents = request.body.get("contents")
    if not isinstance(contents, list) or len(contents) != 1:
        raise ValueError("Petición Google de imagen no válida.")
    parts = contents[0].get("parts") if isinstance(contents[0], dict) else None
    if not isinstance(parts, list):
        raise ValueError("Petición Google de imagen no válida.")
    result = []
    for part in parts:
        if not isinstance(part, dict):
            raise ValueError("Petición Google de imagen no válida.")
        if "inlineData" in part:
            inline = part["inlineData"]
            if not isinstance(inline, dict) or set(inline) != {"mimeType", "data"}:
                raise ValueError("Input inline Google no válido.")
            result.append(_inline(
                "image", inline.get("mimeType"), inline.get("data")))
        elif "fileData" in part:
            source = part["fileData"]
            if not isinstance(source, dict) or set(source) != {"fileUri", "mimeType"}:
                raise ValueError("Input GCS Google no válido.")
            result.append(_gcs(
                "image", source.get("mimeType"), source.get("fileUri")))
        elif set(part) != {"text"} or not isinstance(part.get("text"), str):
            raise ValueError("Parte Google no admitida.")
    return tuple(result)


def _video_inputs(request: VideoRequest) -> tuple[dict, ...]:
    if request.model.startswith("veo-"):
        instances = request.body.get("instances")
        if not isinstance(instances, list) or len(instances) != 1:
            raise ValueError("Petición Veo no válida.")
        instance = instances[0]
        # §H PRIMER FOTOGRAMA (veo_first_frame_request): `image={gcsUri,mimeType}`, forma OFICIAL de
        # image→video (vertex-veo.md). Mutuamente excluyente con la forma INLINE `referenceImages` (sujeto).
        # Fail-closed: set EXACTO {gcsUri,mimeType} y SOLO PNG/JPEG (Veo first-frame no admite WebP, aunque
        # `_EXTENSION` sí). Fluye por `_gcs` → MISMA validación GCS (uri/generation/sha/bytes/mime) que Omni.
        if isinstance(instance, dict) and "image" in instance:
            if "referenceImages" in instance:
                raise ValueError("Referencias Veo no válidas.")
            image = instance.get("image")
            if (not isinstance(image, dict) or set(image) != {"gcsUri", "mimeType"}
                    or image.get("mimeType") not in ("image/png", "image/jpeg")):
                raise ValueError("Primer fotograma Veo no válido.")
            return (_gcs("image", image.get("mimeType"), image.get("gcsUri")),)
        references = instance.get("referenceImages", []) if isinstance(instance, dict) else None
        if not isinstance(references, list):
            raise ValueError("Referencias Veo no válidas.")
        result = []
        for reference in references:
            image = reference.get("image") if isinstance(reference, dict) else None
            if (not isinstance(image, dict)
                    or reference.get("referenceType") != "asset"
                    or set(image) != {"bytesBase64Encoded", "mimeType"}):
                raise ValueError("Referencias Veo no válidas.")
            result.append(_inline(
                "image", image.get("mimeType"),
                image.get("bytesBase64Encoded")))
        return tuple(result)
    inputs = request.body.get("input")
    if not isinstance(inputs, list):
        raise ValueError("Inputs Omni no válidos.")
    result = []
    for item in inputs:
        if not isinstance(item, dict):
            raise ValueError("Inputs Omni no válidos.")
        kind = item.get("type")
        if kind == "text":
            if not isinstance(item.get("text"), str):
                raise ValueError("Input de texto Omni no válido.")
            continue
        if kind not in ("image", "video"):
            raise ValueError("Input Omni no admitido.")
        if "data" in item:
            if set(item) != {"type", "data", "mime_type"}:
                raise ValueError("Input inline Omni no válido.")
            result.append(_inline(kind, item.get("mime_type"), item.get("data")))
        elif "uri" in item:
            if set(item) != {"type", "uri", "mime_type"}:
                raise ValueError("Input GCS Omni no válido.")
            result.append(_gcs(kind, item.get("mime_type"), item.get("uri")))
        else:
            raise ValueError("Input Omni sin medio verificable.")
    return tuple(result)


def _music_inputs(request: MusicRequest) -> tuple[dict, ...]:
    inputs = request.body.get('input')
    if (set(request.body) != {'model', 'store', 'input'}
            or request.body.get('model') != request.model
            or request.body.get('store') is not False
            or not isinstance(inputs, list) or len(inputs) != 2
            or not isinstance(inputs[0], dict)
            or inputs[0].get('type') != 'text'
            or not isinstance(inputs[0].get('text'), str)
            or set(inputs[0]) != {'type', 'text'}):
        raise ValueError('Petición Lyria con referencia no válida.')
    image = inputs[1]
    if (not isinstance(image, dict)
            or set(image) != {'type', 'mime_type', 'uri'}
            or image.get('type') != 'image'):
        raise ValueError('Referencia visual Lyria no válida.')
    return (_gcs('image', image.get('mime_type'), image.get('uri')),)


def _body_inputs(
        request: ImageRequest | VideoRequest | MusicRequest) -> tuple[dict, ...]:
    if isinstance(request, ImageRequest):
        result = _image_inputs(request)
    elif isinstance(request, VideoRequest):
        result = _video_inputs(request)
    elif isinstance(request, MusicRequest):
        result = _music_inputs(request)
    else:
        raise ValueError("Petición Google con inputs no admitida.")
    if _media_occurrences(request.body) != len(result):
        raise ValueError("La petición Google contiene medios no declarados.")
    return result


def _media_occurrences(value: object) -> int:
    """Cuenta medios de entrada incluso si aparecen fuera de su lugar válido."""
    if isinstance(value, list):
        return sum(_media_occurrences(item) for item in value)
    if not isinstance(value, dict):
        return 0
    here = 0
    if "inlineData" in value or "fileData" in value:
        here += 1
    if "bytesBase64Encoded" in value:
        here += 1
    # §H primer fotograma Veo: `image.gcsUri`. Clave DISTINTA del `storageUri` de SALIDA (:95 de
    # veo_first_frame), así que NO sobre-cuenta el output. Espejo de `bytesBase64Encoded`: parse y conteo
    # en lockstep (`_video_inputs` emite exactamente un `_gcs` para ese gcsUri) → invariante :189/:220 intacta.
    if "gcsUri" in value:
        here += 1
    if (value.get("type") in ("image", "video")
            and ("data" in value or "uri" in value)):
        here += 1
    return here + sum(_media_occurrences(item) for item in value.values())


def bind_google_owned_inputs(
        request: ImageRequest | VideoRequest | MusicRequest, owner_id: str,
        receipts: tuple[StorageReceipt, ...]) -> GoogleOwnedInputBinding:
    """Demuestra orden, bytes y generación de todos los inputs del request."""
    owner_id = _owner(owner_id)
    if not isinstance(receipts, tuple) or not receipts:
        raise ValueError("Recibos de inputs Google ausentes.")
    manifest = request.input_manifest
    body_inputs = _body_inputs(request)
    if (not isinstance(manifest, tuple) or len(manifest) != len(receipts)
            or len(body_inputs) != len(receipts)
            or any(not isinstance(item, dict) for item in manifest)):
        raise ValueError("Inputs Google y recibos no coinciden.")
    prefix = f"creative/users/{owner_id}/assets/"
    snapshots = []
    identities = set()
    for ordinal, (source, body, receipt) in enumerate(
            zip(manifest, body_inputs, receipts), 1):
        allowed = {
            "kind", "mimeType", "bytes", "sha256", "durationSeconds",
            "uri", "generation", "role", "ordinal",
        }
        source_ordinal = source.get("ordinal", ordinal)
        if (not isinstance(receipt, StorageReceipt)
                or not set(source) <= allowed
                or source.get("kind") not in ("image", "video")
                or not isinstance(source.get("mimeType"), str)
                or not isinstance(source.get("bytes"), int)
                or isinstance(source.get("bytes"), bool)
                or source.get("bytes") <= 0
                or not isinstance(source.get("sha256"), str)
                or not _HASH.fullmatch(source.get("sha256"))
                or not isinstance(source_ordinal, int)
                or isinstance(source_ordinal, bool)
                or source_ordinal != ordinal
                or ("uri" in source) != ("generation" in source)
                or ("uri" in source and (
                    not isinstance(source.get("uri"), str)
                    or not isinstance(source.get("generation"), int)
                    or isinstance(source.get("generation"), bool)
                    or source.get("generation") <= 0))
                or not _receipt_path(receipt, prefix)
                or not isinstance(receipt.generation, int)
                or isinstance(receipt.generation, bool)
                or receipt.generation <= 0
                or not isinstance(receipt.byte_size, int)
                or isinstance(receipt.byte_size, bool)
                or receipt.byte_size <= 0
                or receipt.mime_type != source.get("mimeType")
                or receipt.byte_size != source.get("bytes")
                or receipt.sha256 != source.get("sha256")
                or not _HASH.fullmatch(receipt.sha256)
                or body.get("kind") != source.get("kind")
                or body.get("mimeType") != source.get("mimeType")):
            raise ValueError("Input Google no pertenece al recibo esperado.")
        expected_uri = source.get("uri")
        if expected_uri is not None and (
                body.get("uri") != expected_uri
                or expected_uri != f"gs://{receipt.bucket}/{receipt.name}"
                or source.get("generation") != receipt.generation):
            raise ValueError("Generación GCS del input Google no coincide.")
        if expected_uri is None and (
                body.get("uri") is not None
                or body.get("bytes") != source.get("bytes")
                or body.get("sha256") != source.get("sha256")):
            raise ValueError("Bytes inline del input Google no coinciden.")
        identity = (receipt.bucket, receipt.name, receipt.generation)
        if identity in identities:
            raise ValueError("Recibo GCS de input Google duplicado.")
        identities.add(identity)
        snapshots.append({
            "inputOrdinal": ordinal, "bucket": receipt.bucket,
            "name": receipt.name, "generation": receipt.generation,
            "mimeType": receipt.mime_type, "byteSize": receipt.byte_size,
            "sha256": receipt.sha256,
        })
    request_sha = fingerprint(request).sha256
    snapshot = {
        "schemaVersion": 1, "kind": "google_owned_input_binding",
        "ownerId": owner_id, "requestSha256": request_sha,
        "inputs": snapshots,
    }
    return GoogleOwnedInputBinding(
        owner_id, request_sha, receipts, snapshot, canonical_sha256(snapshot))


def require_google_owned_inputs(
        request: ImageRequest | VideoRequest | MusicRequest,
        binding: GoogleOwnedInputBinding) -> None:
    if not isinstance(binding, GoogleOwnedInputBinding):
        raise ValueError("Binding de inputs Google ausente.")
    rebuilt = bind_google_owned_inputs(
        request, binding.owner_id, binding.receipts)
    if (rebuilt.request_sha256 != binding.request_sha256
            or rebuilt.receipts != binding.receipts
            or rebuilt.snapshot != binding.snapshot
            or rebuilt.sha256 != binding.sha256):
        raise ValueError("Binding de inputs Google alterado.")
