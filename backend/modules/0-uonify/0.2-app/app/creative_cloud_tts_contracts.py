"""Contrato Cloud TTS Chirp 3 HD, separado de Gemini TTS y de Live."""

from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import sha256
import re

from .creative_google_capabilities import ModelId


MODEL = ModelId.CHIRP_3_HD.value
ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_VOICE = re.compile(r"[A-Za-z][A-Za-z0-9-]{1,40}\Z")


@dataclass(frozen=True)
class CloudTtsRequest:
    endpoint: str
    model: str
    body: dict
    script: str
    voice: str
    quota_project: str


@dataclass(frozen=True)
class CloudTtsOutput:
    mime_type: str
    data: bytes
    sha256: str
    sample_rate_hz: int
    channels: int
    duration_seconds: float


def cloud_tts_request(project: str, script: str, *,
                      voice: str = "Kore") -> CloudTtsRequest:
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError("Proyecto Google no válido.")
    if (not isinstance(script, str) or not script.strip()
            or len(script.strip().encode("utf-8")) > 5000):
        raise ValueError("Texto Cloud TTS no válido o superior a 5.000 bytes.")
    if not isinstance(voice, str) or not _VOICE.fullmatch(voice):
        raise ValueError("Voz Cloud TTS no válida.")
    script = script.strip()
    name = f"es-ES-Chirp3-HD-{voice}"
    return CloudTtsRequest(ENDPOINT, MODEL, {
        "input": {"text": script},
        "voice": {"languageCode": "es-ES", "name": name},
        "audioConfig": {"audioEncoding": "MP3"},
    }, script, name, project)


def cloud_tts_completed(response: dict) -> CloudTtsOutput:
    if not isinstance(response, dict) or set(response) != {"audioContent"}:
        raise ValueError("Respuesta Cloud TTS no válida.")
    encoded = response.get("audioContent")
    if not isinstance(encoded, str):
        raise ValueError("Faltan bytes Cloud TTS.")
    try:
        data = b64decode(encoded, validate=True)
    except (Base64Error, ValueError) as error:
        raise ValueError("Audio Cloud TTS codificado incorrectamente.") from error
    if not _has_mp3_frame(data):
        raise ValueError("La salida Cloud TTS no parece un MP3.")
    sample_rate, channels, duration = _mp3_metadata(data)
    return CloudTtsOutput(
        "audio/mpeg", data, sha256(data).hexdigest(),
        sample_rate, channels, duration)


def _has_mp3_frame(data: bytes) -> bool:
    offset = 0
    if data.startswith(b"ID3"):
        if len(data) < 14 or any(byte & 0x80 for byte in data[6:10]):
            return False
        size = sum(byte << shift for byte, shift in zip(
            data[6:10], (21, 14, 7, 0)))
        offset = 10 + size + (10 if data[5] & 0x10 else 0)
    if len(data) < offset + 4:
        return False
    head = data[offset:offset + 4]
    return (head[0] == 0xff and head[1] & 0xe0 == 0xe0
            and head[1] & 0x18 != 0x08 and head[1] & 0x06 != 0
            and head[2] >> 4 not in (0, 15) and head[2] & 0x0c != 0x0c)


def _mp3_metadata(data: bytes) -> tuple[int, int, float]:
    offset = 0
    if data.startswith(b"ID3"):
        size = sum(byte << shift for byte, shift in zip(
            data[6:10], (21, 14, 7, 0)))
        offset = 10 + size + (10 if data[5] & 0x10 else 0)
    rates_v1 = (0, 32, 40, 48, 56, 64, 80, 96, 112,
                128, 160, 192, 224, 256, 320)
    rates_v2 = (0, 8, 16, 24, 32, 40, 48, 56, 64,
                80, 96, 112, 128, 144, 160)
    base_samples = (44100, 48000, 32000)
    frames = 0
    sample_rate = channels = samples_per_frame = None
    while offset + 4 <= len(data):
        value = int.from_bytes(data[offset:offset + 4], "big")
        if value >> 21 != 0x7ff:
            break
        version, layer = (value >> 19) & 3, (value >> 17) & 3
        bitrate_index, sample_index = (value >> 12) & 15, (value >> 10) & 3
        if (version == 1 or layer != 1 or bitrate_index in (0, 15)
                or sample_index == 3):
            break
        current_rate = base_samples[sample_index] // ({3: 1, 2: 2, 0: 4}[version])
        bitrate = (rates_v1 if version == 3 else rates_v2)[bitrate_index]
        frame_samples = 1152 if version == 3 else 576
        frame_bytes = ((144 if version == 3 else 72) * bitrate * 1000
                       // current_rate + ((value >> 9) & 1))
        if frame_bytes < 4 or offset + frame_bytes > len(data):
            break
        current_channels = 1 if ((value >> 6) & 3) == 3 else 2
        if frames and (current_rate != sample_rate
                       or current_channels != channels
                       or frame_samples != samples_per_frame):
            raise ValueError("Los frames Cloud TTS cambian de formato.")
        sample_rate, channels = current_rate, current_channels
        samples_per_frame = frame_samples
        frames += 1
        offset += frame_bytes
    if not frames or not sample_rate or not channels or not samples_per_frame:
        raise ValueError("El MP3 Cloud TTS no contiene frames medibles.")
    return sample_rate, channels, frames * samples_per_frame / sample_rate
