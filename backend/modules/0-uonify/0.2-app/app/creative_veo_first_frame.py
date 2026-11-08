"""Estudio §H: Veo 3.1 Fast image→video con PRIMER FOTOGRAMA desde un objeto GCS propio.

El modo reference_image_to_video está VERIFICADO SOLO en Veo 3.1 Fast (no en Generate; catálogo
creative_google_capabilities). Cada clip es un intento §6 independiente (su reserve_once);
la continuidad de «vídeo largo» la gestiona el montaje de ArtCraft encadenando clips (el último
fotograma de N = primer fotograma de N+1). SIN tope de 37 s (eso es del extend NATIVO, [no
verificado]); el límite de la cadena es continuidad/coste/sandbox de montaje. SOLO primer fotograma
(lastFrame queda [no verificado], se añadiría tras prueba real). El fotograma es un OBJETO GCS
(uri+generation+sha256) para que el gate de propiedad de §H lo ate a la identidad exacta. No hace HTTP.
"""
from dataclasses import dataclass
import re
from urllib.parse import urlsplit

from .creative_google_capabilities import (models_with_verified_mode,
                                           veo_model_ids)
from .creative_video_contracts import (VERIFIED_VIDEO_ASPECTS,
                                        VERIFIED_VIDEO_DURATIONS,
                                        VERIFIED_VIDEO_RESOLUTION, VideoRequest,
                                        _check_common, _gcs_prefix,
                                        veo_endpoint_host)

_FRAME_MODE = 'reference_image_to_video'
# OJO: reference_image_to_video también está en los verified_modes de Omni (catálogo), no solo Veo.
# La cadena es SOLO Veo 3.1 Fast → intersecar con veo_model_ids() (Vertex vídeo); así el builder
# rechaza Omni DIRECTAMENTE, sin depender del host-gate aguas abajo. Resultado = solo Veo 3.1 Fast
# (el id literal vive en el catálogo, no aquí: guard H8 de literales).
_FRAME_MODELS = models_with_verified_mode(_FRAME_MODE) & veo_model_ids()
_FRAME_MIMES = frozenset({'image/png', 'image/jpeg'})     # frame spec: PNG/JPEG, nunca WebP
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]\Z')


@dataclass(frozen=True)
class VeoFrameGcsReference:
    """Primer fotograma como objeto GCS: identidad = (uri, generation, sha256) para el gate §H."""
    uri: str
    mime_type: str
    byte_size: int
    sha256: str
    generation: int


def _frame_snapshot(frame: VeoFrameGcsReference) -> dict:
    if (not isinstance(frame, VeoFrameGcsReference)
            or frame.mime_type not in _FRAME_MIMES
            or not isinstance(frame.byte_size, int) or isinstance(frame.byte_size, bool)
            or not 1 <= frame.byte_size <= 30_000_000
            or not _HASH.fullmatch(frame.sha256)
            or not isinstance(frame.generation, int) or isinstance(frame.generation, bool)
            or frame.generation <= 0
            or not isinstance(frame.uri, str) or len(frame.uri) > 2048 or '%' in frame.uri):
        raise ValueError('Fotograma GCS de Veo no válido.')
    parsed = urlsplit(frame.uri)
    segments = parsed.path.strip('/').split('/')
    if (parsed.scheme != 'gs' or not _BUCKET.fullmatch(parsed.netloc or '')
            or parsed.query or parsed.fragment or parsed.path.endswith('/')
            or not segments or any(not item or item in ('.', '..') for item in segments)):
        raise ValueError('Fotograma GCS de Veo no válido.')
    return {'kind': 'image', 'role': 'first_frame', 'uri': frame.uri,
            'mimeType': frame.mime_type, 'bytes': frame.byte_size,
            'sha256': frame.sha256, 'generation': frame.generation}


def veo_first_frame_request(project: str, model: str, prompt: str,
                            frame: VeoFrameGcsReference, output_uri: str | None = None, *,
                            aspect_ratio: str = '16:9',
                            duration_seconds: int | None = None,
                            location: str = 'us-central1') -> VideoRequest:
    """Veo 3.1 Fast image→video: un clip 720p anclado en un PRIMER FOTOGRAMA GCS.

    Solo modelos con reference_image_to_video VERIFICADO (Fast). Proporción 16:9/9:16, duración
    4/6/8 s (def 8). Cada clip = un intento §6 independiente (su reserve_once + salida durable).
    """
    _check_common(project, prompt)
    if model not in _FRAME_MODELS:
        raise ValueError('image→video (primer fotograma) solo verificado en Veo 3.1 Fast.')
    if aspect_ratio not in VERIFIED_VIDEO_ASPECTS:
        raise ValueError('Proporción de vídeo no verificada (solo 16:9 o 9:16).')
    if duration_seconds is not None and duration_seconds not in VERIFIED_VIDEO_DURATIONS:
        raise ValueError('Duración de vídeo no verificada (solo 4, 6 u 8 s).')
    manifest_entry = _frame_snapshot(frame)
    # §H / cotización: con output_uri=None (sin reserva §6 todavía) se omite storageUri, igual que
    # veo_request. El despacho inyecta el storageUri en la reserva §6 (como prepare_video_batch).
    if output_uri is not None:
        _gcs_prefix(output_uri)
    instance = {'prompt': prompt.strip(),
                'image': {'gcsUri': frame.uri, 'mimeType': frame.mime_type}}
    parameters = {
        'sampleCount': 1,
        'durationSeconds': duration_seconds if duration_seconds is not None else 8,
        'resolution': VERIFIED_VIDEO_RESOLUTION, 'aspectRatio': aspect_ratio,
        'generateAudio': True, 'personGeneration': 'disallow'}
    if output_uri is not None:
        parameters['storageUri'] = output_uri
    endpoint = (f'https://{veo_endpoint_host(location)}/v1/projects/{project}'
                f'/locations/{location}/publishers/google/models/{model}:predictLongRunning')
    return VideoRequest(endpoint, model, 'reference_to_video',
                        {'instances': [instance], 'parameters': parameters},
                        (manifest_entry,))
