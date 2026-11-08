"""Contrato offline del jingle instrumental Lyria observado en el proyecto."""

from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import sha256
import re

from .creative_google_capabilities import ModelId


MODEL = ModelId.LYRIA_3.value
_PROJECT = re.compile(r'[a-z][a-z0-9-]{4,61}[a-z0-9]\Z')


@dataclass(frozen=True)
class MusicRequest:
    endpoint: str
    model: str
    body: dict
    input_manifest: tuple[dict, ...] = ()


@dataclass(frozen=True)
class MusicOutput:
    mime_type: str
    data: bytes
    sha256: str
    sample_rate_hz: int
    channels: int
    bitrate_kbps: int
    duration_seconds: float


def music_request(project: str, prompt: str) -> MusicRequest:
    """Solo texto→clip probado; Lyria exige store=false y no ofrece recuperación."""
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError('Instrucción musical no válida.')
    endpoint = (f'https://aiplatform.googleapis.com/v1beta1/projects/{project}'
                '/locations/global/interactions')
    return MusicRequest(endpoint, MODEL, {
        'model': MODEL, 'store': False,
        'input': [{'type': 'text', 'text': prompt.strip()}],
    })


def music_completed(response: dict) -> MusicOutput:
    """Extrae el MP3; nunca utiliza texto/caption como audio."""
    if (not isinstance(response, dict) or response.get('model') != MODEL
            or response.get('status') != 'completed'):
        raise ValueError('La interacción musical no terminó con el modelo probado.')
    # 14(a): tolerar las dos formas — `outputs` (documentada en Vertex) y la forma
    # nueva del SDK `steps=[{type:model_output, content:[...]}]`.
    outputs = response.get('outputs')
    if not isinstance(outputs, list):
        outputs = [part
                   for step in (response.get('steps') or [])
                   if isinstance(step, dict) and step.get('type') == 'model_output'
                   for part in (step.get('content') or [])]
    if not outputs:
        raise ValueError('Faltan resultados musicales.')
    audio = [item for item in outputs if isinstance(item, dict)
             and item.get('type') == 'audio']
    # 14(a): la doc usa audio/mpeg y la ficha del modelo audio/mp3; aceptar ambos.
    if len(audio) != 1 or audio[0].get('mime_type') not in ('audio/mpeg', 'audio/mp3'):
        raise ValueError('La respuesta no contiene un MP3 único.')
    encoded = audio[0].get('data')
    if not isinstance(encoded, str) or len(encoded) > 2_000_000:
        raise ValueError('Faltan bytes de música.')
    try:
        data = b64decode(encoded, validate=True)
    except (Base64Error, ValueError) as error:
        raise ValueError('Música codificada incorrectamente.') from error
    if not _has_mp3_frame(data) or len(data) > 1_000_000:
        raise ValueError('El resultado no parece un MP3.')
    sample_rate, channels, bitrate, duration = _mp3_metadata(data)
    if (sample_rate != 44_100 or channels != 2 or bitrate != 192
            or not 0 < duration <= 30.1):
        raise ValueError('El MP3 no cumple el formato de Lyria 3 Clip.')
    return MusicOutput(
        'audio/mpeg', data, sha256(data).hexdigest(),
        sample_rate, channels, bitrate, duration)


def _has_mp3_frame(data: bytes) -> bool:
    offset = 0
    if data.startswith(b'ID3'):
        if len(data) < 14 or any(byte & 0x80 for byte in data[6:10]):
            return False
        tag_size = sum(byte << shift for byte, shift in zip(data[6:10],
                                                             (21, 14, 7, 0)))
        offset = 10 + tag_size + (10 if data[5] & 0x10 else 0)
    if len(data) < offset + 4:
        return False
    head = data[offset:offset + 4]
    return (head[0] == 0xff and head[1] & 0xe0 == 0xe0
            and head[1] & 0x18 != 0x08 and head[1] & 0x06 != 0
            and head[2] >> 4 not in (0, 15) and head[2] & 0x0c != 0x0c)


def _mp3_metadata(data: bytes) -> tuple[int, int, int, float]:
    """Mide todos los frames MPEG; no confía en extensión ni cabecera única."""
    offset = 0
    if data.startswith(b'ID3'):
        tag_size = sum(byte << shift for byte, shift in zip(
            data[6:10], (21, 14, 7, 0)))
        offset = 10 + tag_size + (10 if data[5] & 0x10 else 0)
    rates_v1 = (0, 32, 40, 48, 56, 64, 80, 96, 112,
                128, 160, 192, 224, 256, 320)
    rates_v2 = (0, 8, 16, 24, 32, 40, 48, 56, 64,
                80, 96, 112, 128, 144, 160)
    base_samples = (44_100, 48_000, 32_000)
    frames = 0
    sample_rate = channels = bitrate = samples_per_frame = None
    while offset + 4 <= len(data):
        value = int.from_bytes(data[offset:offset + 4], 'big')
        if value >> 21 != 0x7ff:
            break
        version, layer = (value >> 19) & 3, (value >> 17) & 3
        bitrate_index, sample_index = (value >> 12) & 15, (value >> 10) & 3
        if (version == 1 or layer != 1 or bitrate_index in (0, 15)
                or sample_index == 3):
            break
        current_rate = base_samples[sample_index] // {
            3: 1, 2: 2, 0: 4}[version]
        current_bitrate = (
            rates_v1 if version == 3 else rates_v2)[bitrate_index]
        current_channels = 1 if ((value >> 6) & 3) == 3 else 2
        frame_samples = 1152 if version == 3 else 576
        frame_bytes = (
            (144 if version == 3 else 72) * current_bitrate * 1000
            // current_rate + ((value >> 9) & 1))
        if frame_bytes < 4 or offset + frame_bytes > len(data):
            break
        if frames and (current_rate, current_channels, current_bitrate,
                       frame_samples) != (sample_rate, channels, bitrate,
                                          samples_per_frame):
            raise ValueError('Los frames Lyria cambian de formato.')
        sample_rate, channels = current_rate, current_channels
        bitrate, samples_per_frame = current_bitrate, frame_samples
        frames += 1
        offset += frame_bytes
    if (not frames or not sample_rate or not channels or not bitrate
            or not samples_per_frame or offset != len(data)):
        raise ValueError('El MP3 Lyria no contiene frames completos medibles.')
    return (sample_rate, channels, bitrate,
            frames * samples_per_frame / sample_rate)
