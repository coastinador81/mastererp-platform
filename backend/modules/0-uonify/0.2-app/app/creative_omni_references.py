"""Contrato durable de Gemini Omni 1.1 con referencias privadas en GCS.

Este módulo solo construye y valida la petición. La copia create-only de cada
entrada, la autoridad de generación, el presupuesto y el POST pertenecen al
orquestador durable.
"""

from dataclasses import dataclass
import re
from urllib.parse import urlsplit

from .creative_google_capabilities import ModelId
from .creative_video_contracts import VideoRequest


_MODEL = ModelId.OMNI_11.value
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]\Z")
_IMAGE_MIMES = frozenset({
    "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
})
_VIDEO_MIMES = frozenset({
    "video/3gpp", "video/mp4", "video/mpeg", "video/quicktime",
    "video/webm", "video/x-flv", "video/x-ms-wmv",
})
_RESOLUTIONS = frozenset({"360p", "720p", "1080p", "4k"})


@dataclass(frozen=True)
class OmniGcsReference:
    """Objeto GCS ya inspeccionado y fijado por generación/hash."""

    kind: str
    uri: str
    mime_type: str
    byte_size: int
    sha256: str
    generation: int
    duration_seconds: float | None = None


def _gcs(value: str, *, prefix: bool) -> None:
    if not isinstance(value, str) or len(value) > 2048 or "%" in value:
        raise ValueError("URI GCS no válida.")
    parsed = urlsplit(value)
    segments = parsed.path.strip("/").split("/")
    if (parsed.scheme != "gs" or not _BUCKET.fullmatch(parsed.netloc or "")
            or parsed.query or parsed.fragment or not segments
            or any(not item or item in (".", "..") for item in segments)
            or parsed.path.endswith("/") != prefix):
        raise ValueError("URI GCS no válida.")


def _reference_snapshot(reference: OmniGcsReference) -> dict:
    if not isinstance(reference, OmniGcsReference):
        raise ValueError("Referencia Omni no válida.")
    if reference.kind == "image":
        valid_media = (reference.mime_type in _IMAGE_MIMES
                       and reference.duration_seconds is None
                       and reference.byte_size <= 30_000_000)
    elif reference.kind == "video":
        valid_media = (reference.mime_type in _VIDEO_MIMES
                       and isinstance(reference.duration_seconds, (int, float))
                       and not isinstance(reference.duration_seconds, bool)
                       and 0 < reference.duration_seconds <= 10)
    else:
        valid_media = False
    if (not valid_media or not isinstance(reference.byte_size, int)
            or isinstance(reference.byte_size, bool) or reference.byte_size <= 0
            or not _HASH.fullmatch(reference.sha256)
            or not isinstance(reference.generation, int)
            or isinstance(reference.generation, bool) or reference.generation <= 0):
        raise ValueError("Metadatos de referencia Omni no válidos.")
    _gcs(reference.uri, prefix=False)
    return {
        "kind": reference.kind,
        "mimeType": reference.mime_type,
        "bytes": reference.byte_size,
        "sha256": reference.sha256,
        "generation": reference.generation,
        "uri": reference.uri,
        "durationSeconds": reference.duration_seconds,
    }


def omni_reference_background_request(
        project: str, prompt: str, references: tuple[OmniGcsReference, ...],
        output_uri: str, *, duration_seconds: int = 3,
        resolution: str = "720p", aspect_ratio: str = "16:9") -> VideoRequest:
    """Prepara la variante oficial asíncrona reference-to-video de Omni 1.1."""
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError("Proyecto Google no válido.")
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError("Instrucción de vídeo no válida.")
    if not isinstance(references, tuple) or not references:
        raise ValueError("Omni requiere referencias cerradas.")
    manifest = tuple(_reference_snapshot(item) for item in references)
    kinds = tuple(item["kind"] for item in manifest)
    if kinds.count("image") > 10 or kinds.count("video") > 3:
        raise ValueError("Omni admite hasta 10 imágenes y 3 vídeos por prompt.")
    uris = tuple(item["uri"] for item in manifest)
    if len(set(uris)) != len(uris):
        raise ValueError("Cada referencia Omni debe ser un objeto GCS distinto.")
    if (not isinstance(duration_seconds, int)
            or isinstance(duration_seconds, bool)
            or duration_seconds not in range(3, 11)):
        raise ValueError("Omni admite duraciones enteras entre 3 y 10 segundos.")
    if resolution not in _RESOLUTIONS:
        raise ValueError("Resolución Omni no admitida.")
    if aspect_ratio not in ("16:9", "9:16"):
        raise ValueError("Relación de aspecto Omni no admitida.")
    _gcs(output_uri, prefix=True)
    inputs = [{"background": True, "type": "text", "text": prompt.strip()}]
    inputs.extend({
        "type": item.kind, "uri": item.uri, "mime_type": item.mime_type,
    } for item in references)
    body = {
        "model": _MODEL,
        "input": inputs,
        "response_format": [{
            "type": "video", "delivery": "uri", "gcs_uri": output_uri,
            "aspect_ratio": aspect_ratio, "resolution": resolution,
            "duration": f"{duration_seconds}s",
        }],
        "generation_config": {
            "video_config": {"task": "reference_to_video"},
            "thinking_level": "minimal",
            "thinking_summaries": "none",
            "max_output_tokens": 57_920,
        },
    }
    endpoint = (f"https://aiplatform.googleapis.com/v1beta1/projects/{project}"
                "/locations/global/interactions")
    return VideoRequest(endpoint, _MODEL, "reference_to_video_background",
                        body, manifest)
