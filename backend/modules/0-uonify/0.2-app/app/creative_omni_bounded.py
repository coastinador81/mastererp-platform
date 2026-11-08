"""Variantes Omni con techo monetario, sin alterar los cuerpos auditados previos."""

from .creative_google_capabilities import ModelId
from .creative_video_contracts import (
    VideoMedia, VideoRequest, omni_background_request, omni_request)


OMNI_MAX_OUTPUT_TOKENS = 57_920
_OMNI = ModelId.OMNI_11.value


def _bounded(request: VideoRequest) -> VideoRequest:
    if request.model != _OMNI:
        raise ValueError("La petición no pertenece a Omni.")
    config = request.body.get("generation_config")
    if not isinstance(config, dict):
        raise ValueError("Configuración Omni no válida.")
    body = {**request.body, "generation_config": {
        **config,
        "thinking_level": "minimal",
        "thinking_summaries": "none",
        "max_output_tokens": OMNI_MAX_OUTPUT_TOKENS,
    }}
    return VideoRequest(request.endpoint, request.model, request.mode,
                        body, request.input_manifest)


def bounded_omni_request(project: str, prompt: str,
                         references: tuple[VideoMedia, ...], *,
                         edit: bool = False) -> VideoRequest:
    """Construye la variante inline con un máximo demostrable."""
    return _bounded(omni_request(
        project, prompt, references, edit=edit))


def bounded_omni_background_request(
        project: str, prompt: str, output_uri: str, *,
        duration_seconds: int = 3, resolution: str = "360p",
        aspect_ratio: str = "16:9") -> VideoRequest:
    """Construye la variante durable con un máximo demostrable."""
    return _bounded(omni_background_request(
        project, prompt, output_uri, duration_seconds=duration_seconds,
        resolution=resolution, aspect_ratio=aspect_ratio))
