"""Conversión de envoltorio reproducible para la voz en off ya auditada."""

from base64 import b64encode
from dataclasses import replace
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import wave

import pytest

from app.creative_audio_prepare import voiceover_wav
from app.creative_storage_contracts import storage_upload
from app.creative_voiceover_contracts import voiceover_completed


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def test_real_google_pcm_becomes_wav_with_identical_samples():
    response = json.loads((AUDIT / 'gemini-2.5-flash-tts.json').read_text())['response']
    inline = response['candidates'][0]['content']['parts'][0]['inlineData']
    descriptor = inline['data']
    pcm = (AUDIT / descriptor['file']).read_bytes()
    assert sha256(pcm).hexdigest() == descriptor['sha256']
    inline['data'] = b64encode(pcm).decode('ascii')
    output = voiceover_completed(response)
    ready = voiceover_wav(output)
    assert ready.mime_type == 'audio/wav'
    assert ready.samples_per_channel == 76103
    with wave.open(BytesIO(ready.data), 'rb') as wav:
        assert wav.getframerate() == 24000
        assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
        assert wav.getnframes() == 76103
        assert wav.readframes(wav.getnframes()) == pcm
    stored = storage_upload('uonify-private-media',
                            '75c5e84b-ef63-4c49-aa1b-03134069e83a',
                            'cbcc5bb6-bd64-4ae3-bedd-485fe2f9beb8',
                            ready.mime_type, ready.data)
    assert stored.expected.sha256 == ready.sha256


def test_changed_pcm_or_duration_cannot_be_wrapped_as_original():
    response = {'modelVersion': 'gemini-2.5-flash-tts', 'candidates': [{
        'finishReason': 'STOP', 'content': {'parts': [{'inlineData': {
            'mimeType': 'audio/L16;codec=pcm;rate=24000',
            'data': b64encode(b'\x00\x01').decode('ascii')}}]}}]}
    output = voiceover_completed(response)
    with pytest.raises(ValueError, match='verificable'):
        voiceover_wav(replace(output, data=b'\x00\x02'))
    with pytest.raises(ValueError, match='Duración'):
        voiceover_wav(replace(output, duration_seconds=5))
