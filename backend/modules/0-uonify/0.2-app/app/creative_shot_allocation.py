"""Número mínimo de clips probados para la duración solicitada; no diseña escenas."""

from dataclasses import dataclass
from math import ceil

from .creative_google_capabilities import ModelId


_CLIP_SECONDS = {
    (ModelId.OMNI_11, 'text_to_video'): 3,
    (ModelId.OMNI_11, 'reference_to_video'): 3,
    (ModelId.VEO_31, 'text_to_video'): 4,
    (ModelId.VEO_31_FAST, 'text_to_video'): 4,
    (ModelId.VEO_31_FAST, 'reference_to_video'): 8,
}


@dataclass(frozen=True)
class ShotAllocation:
    model: str
    mode: str
    requested_seconds: int
    clip_seconds: int
    shot_count: int
    generated_seconds: int
    trim_seconds: int


def shot_allocation(model: str, mode: str,
                    requested_seconds: int) -> ShotAllocation:
    """Un clip no equivale a un vídeo completo; el sobrante se recorta al montar."""
    clip_seconds = _CLIP_SECONDS.get((model, mode))
    if clip_seconds is None:
        raise ValueError('Duración del modo de vídeo no comprobada.')
    if (not isinstance(requested_seconds, int) or isinstance(requested_seconds, bool)
            or not 3 <= requested_seconds <= 120):
        raise ValueError('Duración solicitada fuera del plan creativo.')
    count = ceil(requested_seconds / clip_seconds)
    generated = count * clip_seconds
    return ShotAllocation(model, mode, requested_seconds, clip_seconds,
                          count, generated, generated - requested_seconds)
