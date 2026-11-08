"""Contratos locales para los modos de vídeo probados; este módulo no envía peticiones.

La elección, presupuesto, autorización, propiedad de recursos y registro durable del
intento corresponden al orquestador antes de usar cualquiera de estos cuerpos.
"""

from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import sha256
import re
from urllib.parse import urlsplit

from .creative_google_capabilities import ModelId


_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_OMNI = ModelId.OMNI_11.value
_VEO_FAST = ModelId.VEO_31_FAST.value
_VEO = ModelId.VEO_31.value
_MAX_INLINE_BYTES = 20_000_000

# §G (veredicto 20261022): envelope de VÍDEO VERIFICADO. «Lo verificado manda»: el panel solo puede
# elegir dentro de esto. Proporción solo 16:9/9:16 (Veo); resolución = la CABLEADA hoy (720p), no la
# capacidad del modelo (1080p/4K sin cablear → no se ofrecen); duración Veo 4/6/8 (extend ≤37 s = §H).
# Motores = los verificados del catálogo (Veo 3.1 Generate y Fast). Omni durable >3 s/1080p NO
# verificado → fuera del panel. Modos contract_only (Omni refs 1-13, Veo durable-subject 1-3) tampoco.
VERIFIED_VIDEO_ASPECTS = ('16:9', '9:16')
VERIFIED_VIDEO_DURATIONS = (4, 6, 8)
VERIFIED_VIDEO_RESOLUTION = '720p'
VERIFIED_VIDEO_ENGINES = (_VEO, _VEO_FAST)


@dataclass(frozen=True)
class VideoMedia:
    kind: str
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class VideoRequest:
    endpoint: str
    model: str
    mode: str
    body: dict
    input_manifest: tuple[dict, ...]


@dataclass(frozen=True)
class VideoOutput:
    mime_type: str
    data: bytes
    sha256: str
    duration_seconds: float
    width_pixels: int
    height_pixels: int
    frame_rate: float
    usage: dict | None = None


@dataclass(frozen=True)
class VideoUriOutput:
    mime_type: str
    uri: str
    usage: dict | None = None


@dataclass(frozen=True)
class RecoveryRequest:
    method: str
    endpoint: str
    body: dict | None


def _check_common(project: str, prompt: str) -> None:
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError('Instrucción de vídeo no válida.')


def _gcs_prefix(output_uri: str):
    if not isinstance(output_uri, str):
        raise ValueError('Prefijo GCS de salida no válido.')
    parsed = urlsplit(output_uri)
    segments = parsed.path.strip('/').split('/')
    if (parsed.scheme != 'gs' or not re.fullmatch(
            r'[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]', parsed.netloc or '')
            or parsed.query or parsed.fragment or not parsed.path.endswith('/')
            or not segments or any(not value or value in ('.', '..')
                                   for value in segments)):
        raise ValueError('Prefijo GCS de salida no válido.')
    return parsed


def _boxes(data: bytes, start: int, end: int):
    """Lee cajas ISO BMFF con límites estrictos; no interpreta muestras del vídeo."""
    offset = start
    while offset < end:
        if end - offset < 8:
            raise ValueError('Caja MP4 incompleta.')
        size = int.from_bytes(data[offset:offset + 4], 'big')
        kind = data[offset + 4:offset + 8]
        header = 8
        if size == 1:
            if end - offset < 16:
                raise ValueError('Caja MP4 extendida incompleta.')
            size = int.from_bytes(data[offset + 8:offset + 16], 'big')
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or size > end - offset:
            raise ValueError('Tamaño de caja MP4 no válido.')
        yield kind, offset + header, offset + size
        offset += size


def mp4_duration_seconds(data: bytes) -> float:
    """Mide duración del movie header; rechaza MP4 sin duración determinable."""
    if not isinstance(data, bytes) or len(data) < 24:
        raise ValueError('MP4 incompleto.')
    top = list(_boxes(data, 0, len(data)))
    if not top or top[0][0] != b'ftyp':
        raise ValueError('Falta la cabecera MP4.')
    moovs = [box for box in top if box[0] == b'moov']
    if len(moovs) != 1:
        raise ValueError('MP4 sin índice único de duración.')
    _, start, end = moovs[0]
    headers = [box for box in _boxes(data, start, end) if box[0] == b'mvhd']
    if len(headers) != 1:
        raise ValueError('MP4 sin cabecera de duración.')
    _, start, end = headers[0]
    version = data[start]
    if version == 0:
        timescale_at, duration_at, duration_bytes = start + 12, start + 16, 4
    elif version == 1:
        timescale_at, duration_at, duration_bytes = start + 20, start + 24, 8
    else:
        raise ValueError('Versión de duración MP4 no admitida.')
    if duration_at + duration_bytes > end:
        raise ValueError('Cabecera de duración MP4 incompleta.')
    timescale = int.from_bytes(data[timescale_at:timescale_at + 4], 'big')
    duration = int.from_bytes(data[duration_at:duration_at + duration_bytes], 'big')
    if timescale <= 0 or duration <= 0:
        raise ValueError('Duración MP4 indeterminada.')
    return duration / timescale


def mp4_video_geometry(data: bytes) -> tuple[int, int, float]:
    """Lee tamaño y cadencia de la pista de vídeo desde cajas ISO BMFF."""
    if not isinstance(data, bytes) or len(data) < 24:
        raise ValueError('MP4 incompleto.')
    top = list(_boxes(data, 0, len(data)))
    moovs = [box for box in top if box[0] == b'moov']
    if len(moovs) != 1:
        raise ValueError('MP4 sin índice único de vídeo.')
    _, moov_start, moov_end = moovs[0]
    video_tracks = []
    for kind, track_start, track_end in _boxes(data, moov_start, moov_end):
        if kind != b'trak':
            continue
        track_boxes = list(_boxes(data, track_start, track_end))
        tkhd = [box for box in track_boxes if box[0] == b'tkhd']
        mdia = [box for box in track_boxes if box[0] == b'mdia']
        if len(tkhd) != 1 or len(mdia) != 1:
            continue
        _, mdia_start, mdia_end = mdia[0]
        media_boxes = list(_boxes(data, mdia_start, mdia_end))
        handlers = [box for box in media_boxes if box[0] == b'hdlr']
        if len(handlers) != 1:
            continue
        _, handler_start, handler_end = handlers[0]
        if handler_start + 12 > handler_end or data[handler_start + 8:handler_start + 12] != b'vide':
            continue
        _, tkhd_start, tkhd_end = tkhd[0]
        if tkhd_end - tkhd_start < 8:
            raise ValueError('Cabecera de geometría MP4 incompleta.')
        width_fixed = int.from_bytes(data[tkhd_end - 8:tkhd_end - 4], 'big')
        height_fixed = int.from_bytes(data[tkhd_end - 4:tkhd_end], 'big')
        if width_fixed & 0xffff or height_fixed & 0xffff:
            raise ValueError('Geometría MP4 fraccionaria no admitida.')
        width, height = width_fixed >> 16, height_fixed >> 16
        if not 1 <= width <= 16384 or not 1 <= height <= 16384:
            raise ValueError('Geometría MP4 fuera de límites.')
        mdhd = [box for box in media_boxes if box[0] == b'mdhd']
        minf = [box for box in media_boxes if box[0] == b'minf']
        if len(mdhd) != 1 or len(minf) != 1:
            raise ValueError('Pista de vídeo MP4 incompleta.')
        _, mdhd_start, mdhd_end = mdhd[0]
        version = data[mdhd_start] if mdhd_start < mdhd_end else -1
        timescale_at = mdhd_start + (12 if version == 0 else 20 if version == 1 else -1)
        if timescale_at < mdhd_start or timescale_at + 4 > mdhd_end:
            raise ValueError('Escala temporal MP4 no admitida.')
        timescale = int.from_bytes(data[timescale_at:timescale_at + 4], 'big')
        _, minf_start, minf_end = minf[0]
        stbl = [box for box in _boxes(data, minf_start, minf_end) if box[0] == b'stbl']
        if len(stbl) != 1:
            raise ValueError('Tabla de muestras MP4 ausente.')
        _, stbl_start, stbl_end = stbl[0]
        stts = [box for box in _boxes(data, stbl_start, stbl_end) if box[0] == b'stts']
        if len(stts) != 1:
            raise ValueError('Cadencia MP4 ausente.')
        _, stts_start, stts_end = stts[0]
        if stts_start + 8 > stts_end:
            raise ValueError('Cadencia MP4 incompleta.')
        entry_count = int.from_bytes(data[stts_start + 4:stts_start + 8], 'big')
        if entry_count <= 0 or stts_start + 8 + entry_count * 8 > stts_end:
            raise ValueError('Cadencia MP4 no válida.')
        samples = ticks = 0
        for offset in range(stts_start + 8, stts_start + 8 + entry_count * 8, 8):
            count = int.from_bytes(data[offset:offset + 4], 'big')
            delta = int.from_bytes(data[offset + 4:offset + 8], 'big')
            if count <= 0 or delta <= 0:
                raise ValueError('Muestra temporal MP4 no válida.')
            samples += count
            ticks += count * delta
        if timescale <= 0 or samples <= 0 or ticks <= 0:
            raise ValueError('Cadencia MP4 indeterminada.')
        frame_rate = samples * timescale / ticks
        if not 0.1 <= frame_rate <= 240:
            raise ValueError('Cadencia MP4 fuera de límites.')
        video_tracks.append((width, height, frame_rate))
    if len(video_tracks) != 1:
        raise ValueError('MP4 sin una pista de vídeo única.')
    return video_tracks[0]


def _check_media(media: VideoMedia) -> None:
    if not isinstance(media, VideoMedia) or not isinstance(media.data, bytes):
        raise ValueError('El recurso debe contener bytes inspeccionados en servidor.')
    if not media.data or len(media.data) > _MAX_INLINE_BYTES:
        raise ValueError('Recurso inline vacío o superior a 20 MB.')
    if media.kind == 'image':
        signatures = {
            'image/png': media.data.startswith(b'\x89PNG\r\n\x1a\n'),
            'image/jpeg': media.data.startswith(b'\xff\xd8\xff'),
            'image/webp': media.data.startswith(b'RIFF') and media.data[8:12] == b'WEBP',
        }
        if not signatures.get(media.mime_type, False):
            raise ValueError('Imagen o tipo MIME no admitidos.')
    elif media.kind == 'video':
        if media.mime_type != 'video/mp4' or mp4_duration_seconds(media.data) > 10:
            raise ValueError('El clip debe ser MP4 de hasta 10 segundos.')
    else:
        raise ValueError('Tipo de recurso no admitido.')


def _manifest(media: tuple[VideoMedia, ...]) -> tuple[dict, ...]:
    return tuple({'kind': item.kind, 'mimeType': item.mime_type,
                  'bytes': len(item.data), 'sha256': sha256(item.data).hexdigest(),
                  'durationSeconds': (mp4_duration_seconds(item.data)
                                      if item.kind == 'video' else None)} for item in media)


_VEO_MULTI = frozenset({'us', 'eu'})


def veo_endpoint_host(location: str) -> str:
    """Host del endpoint Veo según la location (vertex-veo.md §3): `global` →
    aiplatform.googleapis.com; multirregión `us`/`eu` → aiplatform.{loc}.rep.
    googleapis.com; regional → {loc}-aiplatform.googleapis.com."""
    if not isinstance(location, str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,30}', location):
        raise ValueError('Location Veo no válida.')
    if location == 'global':
        return 'aiplatform.googleapis.com'
    if location in _VEO_MULTI:
        return f'aiplatform.{location}.rep.googleapis.com'
    return f'{location}-aiplatform.googleapis.com'


def veo_request(project: str, model: str, prompt: str,
                subject_image: VideoMedia | None = None, *,
                output_uri: str | None = None,
                location: str = 'us-central1',
                aspect_ratio: str = '16:9',
                duration_seconds: int | None = None) -> VideoRequest:
    """Veo 3.1 texto; Fast admite además una imagen de sujeto como en la prueba real.

    `location` por defecto us-central1 (residencia declarada del dueño); se
    parametriza para poder probar la UE (eu / europe-west4) sin tocar producción.

    §G: `aspect_ratio` y `duration_seconds` del envelope VERIFICADO (16:9/9:16; 4/6/8 s). Por
    defecto 16:9 y la duración previa (8 con sujeto, 4 sin él) para no alterar a quien ya lo llama.
    La resolución sigue cableada a 720p (lo verificado), no se parametriza.
    """
    _check_common(project, prompt)
    if model not in (_VEO_FAST, _VEO):
        raise ValueError('Modelo Veo no comprobado.')
    if aspect_ratio not in VERIFIED_VIDEO_ASPECTS:
        raise ValueError('Proporción de vídeo no verificada (solo 16:9 o 9:16).')
    if duration_seconds is not None and duration_seconds not in VERIFIED_VIDEO_DURATIONS:
        raise ValueError('Duración de vídeo no verificada (solo 4, 6 u 8 s).')
    media = (subject_image,) if subject_image is not None else ()
    if media:
        _check_media(subject_image)
        if model != _VEO_FAST or subject_image.kind != 'image':
            raise ValueError('Solo se probó imagen de sujeto con Veo 3.1 Fast.')
        # 12d: Veo solo admite PNG o JPEG como imagen de sujeto (WebP no).
        if subject_image.mime_type not in ('image/png', 'image/jpeg'):
            raise ValueError('Veo solo admite PNG o JPEG como imagen de sujeto.')
    if output_uri is not None:
        _gcs_prefix(output_uri)
    instance = {'prompt': prompt.strip()}
    if subject_image is not None:
        instance['referenceImages'] = [{'image': {
            'bytesBase64Encoded': b64encode(subject_image.data).decode('ascii'),
            'mimeType': subject_image.mime_type}, 'referenceType': 'asset'}]
    endpoint = (f'https://{veo_endpoint_host(location)}/v1/projects/{project}'
                f'/locations/{location}/publishers/google/models/{model}:predictLongRunning')
    parameters = {
        'sampleCount': 1,
        'durationSeconds': duration_seconds if duration_seconds is not None else (8 if media else 4),
        'resolution': VERIFIED_VIDEO_RESOLUTION, 'aspectRatio': aspect_ratio,
        'generateAudio': True, 'personGeneration': 'disallow'}
    if output_uri is not None:
        parameters['storageUri'] = output_uri
    return VideoRequest(endpoint, model,
                        'reference_to_video' if media else 'text_to_video',
                        {'instances': [instance], 'parameters': parameters},
                        _manifest(media))


def omni_request(project: str, prompt: str, references: tuple[VideoMedia, ...],
                 *, edit: bool = False) -> VideoRequest:
    """Omni 1.1: texto, imagen, imagen+clip o edición de un clip.

    Solo codifica la variante inline/360p de la auditoría. La ejecución persistente,
    almacenamiento privado y límites monetarios todavía no están conectados.
    """
    _check_common(project, prompt)
    if not isinstance(references, tuple):
        raise ValueError('Las referencias deben estar cerradas antes de preparar la petición.')
    for item in references:
        _check_media(item)
    kinds = tuple(item.kind for item in references)
    if edit:
        if kinds != ('video',):
            raise ValueError('La edición probada requiere exactamente un vídeo.')
    elif kinds not in ((), ('image',), ('image', 'video')):
        raise ValueError('La generación probada requiere imagen, con un clip opcional.')
    output = {'type': 'video', 'resolution': '360p'}
    if kinds:
        output['delivery'] = 'inline'
    if not edit:
        output.update({'duration': '3s', 'aspect_ratio': '16:9'})
    task = 'edit' if edit else 'reference_to_video' if kinds else 'text_to_video'
    body = {'model': _OMNI, 'background': False, 'store': False,
            'input': [{'type': 'text', 'text': prompt.strip()}, *(
                {'type': item.kind, 'data': b64encode(item.data).decode('ascii'),
                 'mime_type': item.mime_type} for item in references)],
            'response_format': [output],
            'generation_config': {'video_config': {'task': task}}}
    endpoint = (f'https://aiplatform.googleapis.com/v1beta1/projects/{project}'
                '/locations/global/interactions')
    return VideoRequest(endpoint, _OMNI, task, body, _manifest(references))


def omni_background_request(project: str, prompt: str, output_uri: str, *,
                            duration_seconds: int = 3,
                            resolution: str = '360p',
                            aspect_ratio: str = '16:9') -> VideoRequest:
    """Prepara texto→vídeo durable con salida GCS; no envía la petición.

    La URI debe ser un prefijo único ya autorizado por el futuro servicio de
    assets. Este constructor solo comprueba su forma; no demuestra ownership ni
    permisos sobre el bucket.
    """
    _check_common(project, prompt)
    if duration_seconds not in range(3, 11):
        raise ValueError('Omni admite duraciones enteras entre 3 y 10 segundos.')
    if resolution not in ('360p', '720p', '1080p', '4k'):
        raise ValueError('Resolución Omni no admitida.')
    if aspect_ratio not in ('16:9', '9:16'):
        raise ValueError('Relación de aspecto Omni no admitida.')
    _gcs_prefix(output_uri)
    body = {
        'model': _OMNI,
        'background': True,
        'store': True,
        'stream': False,
        'input': [{'type': 'text', 'text': prompt.strip()}],
        'response_format': [{
            'type': 'video',
            'delivery': 'uri',
            'gcs_uri': output_uri,
            'aspect_ratio': aspect_ratio,
            'resolution': resolution,
            'duration': f'{duration_seconds}s',
        }],
        'generation_config': {'video_config': {'task': 'text_to_video'}},
    }
    endpoint = (f'https://aiplatform.googleapis.com/v1beta1/projects/{project}'
                '/locations/global/interactions')
    return VideoRequest(endpoint, _OMNI, 'text_to_video_background', body, ())


def omni_interaction_id(response: dict) -> str:
    """Valida el recibo inicial de una interacción Omni en segundo plano."""
    if (not isinstance(response, dict)
            or response.get('status') not in ('queued', 'in_progress')
            or response.get('object') != 'interaction'):
        raise ValueError('Omni no aceptó una interacción recuperable.')
    interaction_id = response.get('id')
    if (not isinstance(interaction_id, str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', interaction_id)):
        raise ValueError('Identificador de interacción no válido.')
    return interaction_id


def operation_name_matches(echoed: object, expected: str) -> bool:
    """Condición 9 (igual que transcoder_job_name): Vertex puede ecoar el operation_name con el
    NÚMERO de proyecto en vez del ID (mismo proyecto, misma operación). Acepta ambos comparando por
    la COLA desde '/locations/' (location + publisher + modelo + op-id EXACTOS); solo se relaja la
    representación del proyecto. Fail-closed: no-str, sin '/locations/', cola vacía, cabecera que no
    sea 'projects/<id|number>', o colas distintas ⇒ False."""
    if not isinstance(echoed, str) or not isinstance(expected, str):
        return False
    marker = '/locations/'
    if marker not in echoed or marker not in expected:
        return False
    e_head, e_tail = echoed.split(marker, 1)
    x_head, x_tail = expected.split(marker, 1)
    return bool(
        e_tail and e_tail == x_tail
        and re.fullmatch(r'projects/[A-Za-z0-9-]+', e_head)
        and re.fullmatch(r'projects/[A-Za-z0-9-]+', x_head))


def operation_name_project_form(echoed: object, expected: object) -> str:
    """Clasifica la representación del proyecto del eco para el discriminador D-PROTECCIÓN-safe:
    'id' (== el proyecto esperado), 'number' (solo dígitos) u 'other'. NUNCA expone el valor."""
    def _project(value: object) -> str:
        if not isinstance(value, str) or '/locations/' not in value:
            return ''
        head = value.split('/locations/', 1)[0]
        return head[len('projects/'):] if head.startswith('projects/') else ''
    proj, expected_proj = _project(echoed), _project(expected)
    if proj and proj == expected_proj:
        return 'id'
    if proj and proj.isdigit():
        return 'number'
    return 'other'


def veo_operation_name(project: str, model: str, response: dict,
                       location: str = 'us-central1') -> str:
    """Acepta solo la operación devuelta para el proyecto/modelo/location del trabajo."""
    _check_common(project, 'operation')
    if model not in (_VEO_FAST, _VEO) or not isinstance(response, dict):
        raise ValueError('Respuesta Veo no válida.')
    veo_endpoint_host(location)  # valida el formato de location
    name = response.get('name')
    prefix = (f'projects/{project}/locations/{location}/publishers/google/'
              f'models/{model}/operations/')
    if (not isinstance(name, str) or not name.startswith(prefix)
            or not re.fullmatch(r'[A-Za-z0-9_-]+', name[len(prefix):])):
        raise ValueError('La operación no pertenece al proyecto y modelo previstos.')
    return name


def veo_recovery_request(project: str, model: str, operation_name: str,
                         location: str = 'us-central1') -> RecoveryRequest:
    """Consulta una operación ya aceptada, sin crear otra generación."""
    veo_operation_name(project, model, {'name': operation_name}, location)
    endpoint = veo_request(project, model, 'recover', location=location).endpoint.replace(
        ':predictLongRunning', ':fetchPredictOperation')
    return RecoveryRequest('POST', endpoint, {'operationName': operation_name})


def omni_recovery_request(project: str, interaction_id: str) -> RecoveryRequest:
    """Solo para interacciones guardadas; las pruebas inline usaron store=false."""
    _check_common(project, 'recover')
    if (not isinstance(interaction_id, str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', interaction_id)):
        raise ValueError('Identificador de interacción no válido.')
    endpoint = (f'https://aiplatform.googleapis.com/v1beta1/projects/{project}'
                f'/locations/global/interactions/{interaction_id}')
    return RecoveryRequest('GET', endpoint, None)


def _decode_video(value: str) -> bytes:
    if not isinstance(value, str):
        raise ValueError('Falta el vídeo de salida.')
    try:
        data = b64decode(value, validate=True)
    except (Base64Error, ValueError) as error:
        raise ValueError('Vídeo de salida codificado incorrectamente.') from error
    if len(data) < 12 or data[4:8] != b'ftyp':
        raise ValueError('La salida no parece un MP4.')
    return data


def veo_completed(response: dict, operation_name: str) -> tuple[VideoOutput, ...]:
    """Extrae MP4 de una operación terminada; nunca deduce éxito de HTTP 200."""
    if (not isinstance(response, dict)
            or not operation_name_matches(response.get('name'), operation_name)
            or response.get('done') is not True or response.get('error')):
        raise ValueError('La operación Veo no ha terminado correctamente.')
    videos = response.get('response', {}).get('videos')
    if not isinstance(videos, list) or len(videos) != 1:
        raise ValueError('Veo no devolvió un vídeo utilizable.')
    result = []
    for item in videos:
        if not isinstance(item, dict) or item.get('mimeType') != 'video/mp4':
            raise ValueError('Formato de salida Veo no admitido.')
        data = _decode_video(item.get('bytesBase64Encoded'))
        width, height, frame_rate = mp4_video_geometry(data)
        result.append(VideoOutput('video/mp4', data, sha256(data).hexdigest(),
                                  mp4_duration_seconds(data), width, height,
                                  frame_rate))
    return tuple(result)


def omni_completed(response: dict) -> tuple[VideoOutput, ...]:
    """Extrae MP4 de una interacción completada del modelo Omni observado."""
    if (not isinstance(response, dict) or response.get('model') != _OMNI
            or response.get('status') != 'completed'):
        raise ValueError('La interacción Omni no ha terminado correctamente.')
    steps = response.get('steps')
    if not isinstance(steps, list):
        raise ValueError('Faltan los pasos de salida Omni.')
    videos = []
    for step in steps:
        if not isinstance(step, dict) or step.get('type') != 'model_output':
            continue
        for item in step.get('content', []):
            if not isinstance(item, dict) or item.get('type') != 'video':
                continue
            if item.get('mime_type') != 'video/mp4':
                raise ValueError('Formato de salida Omni no admitido.')
            data = _decode_video(item.get('data'))
            width, height, frame_rate = mp4_video_geometry(data)
            videos.append(VideoOutput('video/mp4', data, sha256(data).hexdigest(),
                                      mp4_duration_seconds(data), width, height,
                                      frame_rate, response.get('usage')))
    if len(videos) != 1:
        raise ValueError('Omni no devolvió un vídeo utilizable.')
    return tuple(videos)


def omni_completed_uris(response: dict,
                         expected_prefix: str) -> tuple[VideoUriOutput, ...]:
    """Acepta solo URI de vídeo bajo el prefijo GCS autorizado al despachar."""
    prefix = _gcs_prefix(expected_prefix)
    if (not isinstance(response, dict) or response.get('model') != _OMNI
            or response.get('status') != 'completed'):
        raise ValueError('La interacción Omni no ha terminado correctamente.')
    steps = response.get('steps')
    if not isinstance(steps, list):
        raise ValueError('Faltan los pasos de salida Omni.')
    videos = []
    for step in steps:
        if not isinstance(step, dict) or step.get('type') != 'model_output':
            continue
        for item in step.get('content', []):
            if not isinstance(item, dict) or item.get('type') != 'video':
                continue
            if item.get('mime_type') != 'video/mp4':
                raise ValueError('Formato de salida Omni no admitido.')
            uri = item.get('uri')
            parsed = urlsplit(uri) if isinstance(uri, str) else None
            relative = (parsed.path[len(prefix.path):]
                        if parsed and parsed.path.startswith(prefix.path) else '')
            if (not parsed or parsed.scheme != 'gs'
                    or parsed.netloc != prefix.netloc
                    or parsed.query or parsed.fragment or not relative
                    or any(value in ('', '.', '..')
                           for value in relative.split('/'))):
                raise ValueError('La salida Omni no pertenece al prefijo GCS autorizado.')
            videos.append(VideoUriOutput('video/mp4', uri, response.get('usage')))
    if len(videos) != 1:
        raise ValueError('Omni no devolvió una URI de vídeo utilizable.')
    return tuple(videos)
