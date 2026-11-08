"""Modos Omni 1.1 durables con fotogramas o edición de vídeo en GCS."""

from .creative_google_capabilities import ModelId
from .creative_omni_references import (
    OmniGcsReference, _gcs, _reference_snapshot)
from .creative_video_contracts import VideoRequest


_MODEL = ModelId.OMNI_11.value
_RESOLUTIONS = frozenset({"360p", "720p", "1080p", "4k"})


def _common(project: str, prompt: str, output_uri: str,
            resolution: str) -> None:
    if (not isinstance(project, str) or len(project) not in range(6, 64)
            or not project[0].islower()
            or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-"
                   for character in project)
            or not project[-1].isalnum()):
        raise ValueError("Proyecto Google no válido.")
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError("Instrucción de vídeo no válida.")
    if resolution not in _RESOLUTIONS:
        raise ValueError("Resolución Omni no admitida.")
    _gcs(output_uri, prefix=True)


def _body(prompt: str, references: tuple[OmniGcsReference, ...],
          output: dict, task: str) -> dict:
    return {
        "model": _MODEL,
        "input": [
            {"background": True, "type": "text", "text": prompt.strip()},
            *({"type": item.kind, "uri": item.uri,
               "mime_type": item.mime_type} for item in references),
        ],
        "response_format": [output],
        "generation_config": {
            "video_config": {"task": task},
            "thinking_level": "minimal",
            "thinking_summaries": "none",
            "max_output_tokens": 57_920,
        },
    }


def _request(project: str, mode: str, body: dict,
             manifest: tuple[dict, ...]) -> VideoRequest:
    endpoint = (f"https://aiplatform.googleapis.com/v1beta1/projects/{project}"
                "/locations/global/interactions")
    return VideoRequest(endpoint, _MODEL, mode, body, manifest)


def omni_frames_background_request(
        project: str, prompt: str,
        frames: tuple[OmniGcsReference, ...], output_uri: str, *,
        duration_seconds: int = 3, resolution: str = "720p",
        aspect_ratio: str = "16:9") -> VideoRequest:
    """Genera desde un primer fotograma y un último fotograma opcional."""
    _common(project, prompt, output_uri, resolution)
    if not isinstance(frames, tuple) or len(frames) not in (1, 2):
        raise ValueError("Omni requiere uno o dos fotogramas ordenados.")
    snapshots = tuple(_reference_snapshot(item) for item in frames)
    if any(item["kind"] != "image" for item in snapshots):
        raise ValueError("Los fotogramas Omni deben ser imágenes.")
    if len({item["uri"] for item in snapshots}) != len(snapshots):
        raise ValueError("Los fotogramas Omni deben ser objetos GCS distintos.")
    if (not isinstance(duration_seconds, int)
            or isinstance(duration_seconds, bool)
            or duration_seconds not in range(3, 11)):
        raise ValueError("Omni admite duraciones enteras entre 3 y 10 segundos.")
    if aspect_ratio not in ("16:9", "9:16"):
        raise ValueError("Relación de aspecto Omni no admitida.")
    roles = ("first_frame", "last_frame")
    manifest = tuple({**item, "role": roles[index]}
                     for index, item in enumerate(snapshots))
    output = {
        "type": "video", "delivery": "uri", "gcs_uri": output_uri,
        "aspect_ratio": aspect_ratio, "resolution": resolution,
        "duration": f"{duration_seconds}s",
    }
    return _request(project, "image_to_video_background",
                    _body(prompt, frames, output, "image_to_video"), manifest)


def omni_edit_background_request(
        project: str, prompt: str, video: OmniGcsReference,
        output_uri: str, *, resolution: str = "720p") -> VideoRequest:
    """Edita exactamente un clip GCS y conserva su identidad verificable."""
    _common(project, prompt, output_uri, resolution)
    snapshot = _reference_snapshot(video)
    if snapshot["kind"] != "video":
        raise ValueError("La edición Omni requiere exactamente un vídeo.")
    manifest = ({**snapshot, "role": "edit_source"},)
    output = {
        "type": "video", "delivery": "uri", "resolution": resolution,
        "gcs_uri": output_uri,
    }
    return _request(project, "edit_background",
                    _body(prompt, (video,), output, "edit"), manifest)
