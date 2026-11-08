"""Estudio §G: panel → contratos de petición (veredicto 20261022 §G).

Único punto donde se IMPONEN los límites Google VERIFICADOS del panel: proporción, resolución,
duración y motor. La planificación (§A) DELEGA aquí y NO reencodea límites. No llama a ningún
proveedor: devuelve el contrato exacto ya validado (VideoRequest/ImageRequest) o ValueError si el
panel elige fuera de lo verificado. «Lo verificado manda»: resolución = la CABLEADA (vídeo 720p,
imagen 1K); 1080p/4K/2K NO se ofrecen hasta cablear y re-probar. Los modos contract_only (Omni refs
1-13, Veo durable-subject 1-3) y Omni durable NO se ofrecen aquí. El primer/último fotograma es §H.
"""
from .creative_image_contracts import (VERIFIED_IMAGE_ASPECTS, VERIFIED_IMAGE_SIZE,
                                        ImageMedia, ImageRequest, image_request)
from .creative_video_contracts import (VERIFIED_VIDEO_ASPECTS, VERIFIED_VIDEO_DURATIONS,
                                        VERIFIED_VIDEO_ENGINES, VERIFIED_VIDEO_RESOLUTION,
                                        VideoRequest, veo_request)


def video_panel_request(project: str, model: str, prompt: str, *,
                        aspect_ratio: str, duration_seconds: int,
                        resolution: str = VERIFIED_VIDEO_RESOLUTION,
                        output_uri: str | None = None,
                        location: str = 'us-central1') -> VideoRequest:
    """Texto→vídeo del panel con límites Google verificados. Motor = Veo 3.1 Generate o Fast;
    proporción 16:9/9:16; duración 4/6/8 s; resolución 720p (la cableada). Omni durable y los modos
    contract_only (durable-subject 1-3) NO se ofrecen aquí; el primer/último fotograma es §H."""
    if model not in VERIFIED_VIDEO_ENGINES:
        raise ValueError('Motor de vídeo no ofrecido en el panel (solo Veo 3.1 Generate o Fast).')
    if resolution != VERIFIED_VIDEO_RESOLUTION:
        raise ValueError('Resolución de vídeo no ofrecida en el panel (solo 720p).')
    if aspect_ratio not in VERIFIED_VIDEO_ASPECTS:
        raise ValueError('Proporción de vídeo no ofrecida en el panel (solo 16:9 o 9:16).')
    if duration_seconds not in VERIFIED_VIDEO_DURATIONS:
        raise ValueError('Duración de vídeo no ofrecida en el panel (solo 4, 6 u 8 s).')
    return veo_request(project, model, prompt, output_uri=output_uri, location=location,
                       aspect_ratio=aspect_ratio, duration_seconds=duration_seconds)


def image_panel_request(project: str, model: str, prompt: str, *,
                        aspect_ratio: str, resolution: str = VERIFIED_IMAGE_SIZE,
                        reference: ImageMedia | None = None) -> ImageRequest:
    """Texto→imagen del panel con límites verificados: 14 proporciones, resolución 1K (la cableada).
    2K/4K y el modo de 1-14 referencias GCS (contract_only) NO se ofrecen aquí."""
    if resolution != VERIFIED_IMAGE_SIZE:
        raise ValueError('Resolución de imagen no ofrecida en el panel (solo 1K).')
    if aspect_ratio not in VERIFIED_IMAGE_ASPECTS:
        raise ValueError('Proporción de imagen no ofrecida en el panel.')
    return image_request(project, model, prompt, reference, aspect_ratio=aspect_ratio)
