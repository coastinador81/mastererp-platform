"""Edición/generación de imagen con hasta catorce referencias GCS verificadas."""

from dataclasses import dataclass
import re
from urllib.parse import urlsplit

from .creative_image_contracts import IMAGE_MODELS, ImageRequest


_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]\Z")
_MIMES = frozenset({
    "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
})


@dataclass(frozen=True)
class ImageGcsReference:
    uri: str
    mime_type: str
    byte_size: int
    sha256: str
    generation: int


def _snapshot(reference: ImageGcsReference, ordinal: int) -> dict:
    if (not isinstance(reference, ImageGcsReference)
            or reference.mime_type not in _MIMES
            or not isinstance(reference.byte_size, int)
            or isinstance(reference.byte_size, bool)
            or not 1 <= reference.byte_size <= 30_000_000
            or not _HASH.fullmatch(reference.sha256)
            or not isinstance(reference.generation, int)
            or isinstance(reference.generation, bool)
            or reference.generation <= 0
            or not isinstance(reference.uri, str)
            or len(reference.uri) > 2048 or "%" in reference.uri):
        raise ValueError("Referencia GCS de imagen no válida.")
    parsed = urlsplit(reference.uri)
    segments = parsed.path.strip("/").split("/")
    if (parsed.scheme != "gs" or not _BUCKET.fullmatch(parsed.netloc or "")
            or parsed.query or parsed.fragment or parsed.path.endswith("/")
            or not segments or any(not item or item in (".", "..")
                                   for item in segments)):
        raise ValueError("Referencia GCS de imagen no válida.")
    return {
        "kind": "image", "role": "image_reference", "ordinal": ordinal,
        "uri": reference.uri, "mimeType": reference.mime_type,
        "bytes": reference.byte_size, "sha256": reference.sha256,
        "generation": reference.generation,
    }


def image_reference_request(
        project: str, model: str, prompt: str,
        references: tuple[ImageGcsReference, ...], *,
        aspect_ratio: str = "1:1") -> ImageRequest:
    """Construye generateContent con 1–14 fileData, sin hacer HTTP."""
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError("Proyecto Google no válido.")
    if model not in IMAGE_MODELS:
        raise ValueError("Modelo de imagen no comprobado.")
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError("Instrucción de imagen no válida.")
    if not isinstance(references, tuple) or not 1 <= len(references) <= 14:
        raise ValueError("Google admite entre 1 y 14 referencias de imagen.")
    manifest = tuple(_snapshot(item, index)
                     for index, item in enumerate(references, 1))
    uris = tuple(item["uri"] for item in manifest)
    if len(set(uris)) != len(uris):
        raise ValueError("Cada referencia de imagen debe ser un objeto distinto.")
    allowed_ratios = {
        "1:1", "3:2", "2:3", "3:4", "1:4", "4:1", "4:3", "4:5",
        "5:4", "1:8", "8:1", "9:16", "16:9", "21:9", "9:21",
    }
    if aspect_ratio not in allowed_ratios:
        raise ValueError("Relación de aspecto de imagen no admitida.")
    parts = [{"fileData": {
        "fileUri": item.uri, "mimeType": item.mime_type,
    }} for item in references]
    parts.append({"text": prompt.strip()})
    endpoint = (f"https://aiplatform.googleapis.com/v1/projects/{project}"
                f"/locations/global/publishers/google/models/"
                f"{model}:generateContent")
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "maxOutputTokens": 4096,
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": "1K"},
        },
    }
    return ImageRequest(endpoint, model, body, manifest)
