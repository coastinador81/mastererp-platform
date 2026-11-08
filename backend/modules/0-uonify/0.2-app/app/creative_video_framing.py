"""Plan de encuadre explícito para entregar clips Google a un editor.

No modifica archivos ni invoca Craft. Evita que el editor interprete escala 100 %
como "ajustar al lienzo" cuando Omni y Veo entregan resoluciones diferentes.
"""

from dataclasses import dataclass

from .creative_video_contracts import VideoOutput


@dataclass(frozen=True)
class VideoFraming:
    mode: str
    source_width: int
    source_height: int
    target_width: int
    target_height: int
    uniform_scale_percent: float
    rendered_width: int
    rendered_height: int
    crop_width: int
    crop_height: int
    letterbox_width: int
    letterbox_height: int


def frame_for_canvas(output: VideoOutput, target_width: int, target_height: int,
                     mode: str) -> VideoFraming:
    """Calcula `contain` o `cover`; el caller debe elegir el modo por plano."""
    if not isinstance(output, VideoOutput):
        raise ValueError('Salida de vídeo no válida.')
    if (not isinstance(target_width, int) or isinstance(target_width, bool)
            or not isinstance(target_height, int) or isinstance(target_height, bool)
            or not 1 <= target_width <= 16384 or not 1 <= target_height <= 16384):
        raise ValueError('Lienzo de vídeo no válido.')
    if mode not in ('contain', 'cover'):
        raise ValueError('Cada plano debe elegir encuadre contain o cover.')
    if not 1 <= output.width_pixels <= 16384 or not 1 <= output.height_pixels <= 16384:
        raise ValueError('El clip no contiene geometría verificable.')
    width_ratio = target_width / output.width_pixels
    height_ratio = target_height / output.height_pixels
    ratio = min(width_ratio, height_ratio) if mode == 'contain' else max(
        width_ratio, height_ratio)
    rendered_width = round(output.width_pixels * ratio)
    rendered_height = round(output.height_pixels * ratio)
    return VideoFraming(
        mode, output.width_pixels, output.height_pixels,
        target_width, target_height, round(ratio * 100, 6),
        rendered_width, rendered_height,
        max(0, rendered_width - target_width),
        max(0, rendered_height - target_height),
        max(0, target_width - rendered_width),
        max(0, target_height - rendered_height),
    )
