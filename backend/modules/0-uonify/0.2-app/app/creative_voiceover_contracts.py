"""Contrato offline para voz en off de un recurso creativo, no para Live/chat."""

from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import sha256
import re

from .creative_google_capabilities import ModelId


MODEL = ModelId.FLASH_TTS.value
MIME = 'audio/L16;codec=pcm;rate=24000'
_PROJECT = re.compile(r'[a-z][a-z0-9-]{4,61}[a-z0-9]\Z')


@dataclass(frozen=True)
class VoiceoverRequest:
    endpoint: str
    model: str
    body: dict
    script: str
    voice: str


@dataclass(frozen=True)
class VoiceoverOutput:
    mime_type: str
    data: bytes
    sha256: str
    sample_rate_hz: int
    channels: int
    sample_width_bytes: int
    duration_seconds: float


def voiceover_request(project: str, script: str) -> VoiceoverRequest:
    """Reproduce el modo español/Kore comprobado en el proyecto el 18-10-2026."""
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    if not isinstance(script, str) or not 1 <= len(script.strip()) <= 1000:
        raise ValueError('Texto de voz en off no válido.')
    script = script.strip()
    endpoint = (f'https://europe-southwest1-aiplatform.googleapis.com/v1beta1/'
                f'projects/{project}/locations/europe-southwest1/publishers/google/'
                f'models/{MODEL}:generateContent')
    return VoiceoverRequest(endpoint, MODEL, {
        'contents': [{'role': 'user', 'parts': [{'text': f'Di en español: {script}'}]}],
        'generationConfig': {'speechConfig': {'languageCode': 'es-ES',
            'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': 'Kore'}}}},
    }, script, 'Kore')


def voiceover_completed(response: dict) -> VoiceoverOutput:
    """Normaliza PCM mono 24 kHz; no presume que el texto hablado sea exacto."""
    if not isinstance(response, dict) or response.get('modelVersion') != MODEL:
        raise ValueError('Respuesta de un modelo TTS distinto o no comprobado.')
    candidates = response.get('candidates')
    if not isinstance(candidates, list) or len(candidates) != 1:
        raise ValueError('Respuesta TTS sin una candidata única.')
    candidate = candidates[0]
    if not isinstance(candidate, dict) or candidate.get('finishReason') != 'STOP':
        raise ValueError('La síntesis no terminó correctamente.')
    content = candidate.get('content')
    parts = content.get('parts') if isinstance(content, dict) else None
    if not isinstance(parts, list) or len(parts) != 1 or not isinstance(parts[0], dict):
        raise ValueError('La respuesta TTS no contiene audio único.')
    inline = parts[0].get('inlineData')
    if not isinstance(inline, dict) or inline.get('mimeType') != MIME:
        raise ValueError('Formato de audio TTS no comprobado.')
    encoded = inline.get('data')
    if not isinstance(encoded, str):
        raise ValueError('Faltan bytes de audio TTS.')
    try:
        data = b64decode(encoded, validate=True)
    except (Base64Error, ValueError) as error:
        raise ValueError('Audio TTS codificado incorrectamente.') from error
    if not data or len(data) % 2:
        raise ValueError('Audio PCM vacío o con muestra incompleta.')
    return VoiceoverOutput(MIME, data, sha256(data).hexdigest(), 24000, 1, 2,
                           len(data) / (24000 * 2))
