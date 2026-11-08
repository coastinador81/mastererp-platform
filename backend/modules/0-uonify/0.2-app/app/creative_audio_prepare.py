"""Preparación determinista de PCM TTS Google para un editor multimedia."""

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import wave

from .creative_voiceover_contracts import VoiceoverOutput


@dataclass(frozen=True)
class PreparedAudio:
    mime_type: str
    data: bytes
    sha256: str
    sample_rate_hz: int
    channels: int
    sample_width_bytes: int
    samples_per_channel: int
    duration_seconds: float


def voiceover_wav(output: VoiceoverOutput) -> PreparedAudio:
    """Envuelve PCM L16 24 kHz mono en WAV; no resintetiza ni altera muestras."""
    if (not isinstance(output, VoiceoverOutput)
            or output.mime_type != 'audio/L16;codec=pcm;rate=24000'
            or output.sample_rate_hz != 24000 or output.channels != 1
            or output.sample_width_bytes != 2 or not output.data
            or len(output.data) % 2 or sha256(output.data).hexdigest() != output.sha256):
        raise ValueError('PCM TTS de origen no verificable.')
    frames = len(output.data) // 2
    if abs(output.duration_seconds - frames / 24000) > 1 / 24000:
        raise ValueError('Duración PCM incoherente.')
    buffer = BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(output.data)
    data = buffer.getvalue()
    return PreparedAudio('audio/wav', data, sha256(data).hexdigest(),
                         24000, 1, 2, frames, frames / 24000)
