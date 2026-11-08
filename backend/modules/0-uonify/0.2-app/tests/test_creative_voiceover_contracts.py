"""Validación local de la voz creativa; sin enviar audio ni llamar al proveedor."""

from base64 import b64encode
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest

from app.creative_voiceover_contracts import voiceover_completed, voiceover_request


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def test_request_matches_audited_spanish_voice_and_region():
    request = voiceover_request(PROJECT, ' Esta es una prueba técnica de Uonify. ')
    assert request.endpoint.endswith('/gemini-2.5-flash-tts:generateContent')
    assert '/locations/europe-southwest1/' in request.endpoint
    assert request.body['contents'][0]['parts'][0]['text'] == (
        'Di en español: Esta es una prueba técnica de Uonify.')
    speech = request.body['generationConfig']['speechConfig']
    assert speech['languageCode'] == 'es-ES'
    assert speech['voiceConfig']['prebuiltVoiceConfig']['voiceName'] == 'Kore'


def test_request_rejects_bad_project_or_empty_script():
    with pytest.raises(ValueError, match='Proyecto'):
        voiceover_request('other/project', 'Texto')
    with pytest.raises(ValueError, match='Texto'):
        voiceover_request(PROJECT, '   ')
    with pytest.raises(ValueError, match='Texto'):
        voiceover_request(PROJECT, 'x' * 1001)


def test_real_pilot_pcm_is_normalized_offline():
    audit = json.loads((AUDIT / 'gemini-2.5-flash-tts.json').read_text())
    assert audit['httpStatus'] == 200
    response = audit['response']
    inline = response['candidates'][0]['content']['parts'][0]['inlineData']
    media = inline['data']
    raw = (AUDIT / media['file']).read_bytes()
    assert len(raw) == media['bytes']
    assert sha256(raw).hexdigest() == media['sha256']
    response = deepcopy(response)
    response['candidates'][0]['content']['parts'][0]['inlineData']['data'] = (
        b64encode(raw).decode('ascii'))
    output = voiceover_completed(response)
    assert output.data == raw and output.sha256 == media['sha256']
    assert output.sample_rate_hz == 24000 and output.channels == 1
    assert output.duration_seconds == pytest.approx(152206 / 48000)


def test_wrong_model_incomplete_or_malformed_audio_is_rejected():
    response = {'modelVersion': 'gemini-2.5-flash-tts', 'candidates': [{
        'finishReason': 'STOP', 'content': {'parts': [{'inlineData': {
            'mimeType': 'audio/L16;codec=pcm;rate=24000',
            'data': b64encode(b'\x00\x01').decode('ascii')}}]}}]}
    assert voiceover_completed(response).duration_seconds == pytest.approx(1 / 24000)
    for bad in [
        {**response, 'modelVersion': 'gemini-3.8-flash-tts'},
        {**response, 'candidates': []},
        {**response, 'candidates': [{**response['candidates'][0], 'finishReason': 'MAX_TOKENS'}]},
    ]:
        with pytest.raises(ValueError):
            voiceover_completed(bad)
    for mime, data in [('audio/wav', b64encode(b'\x00\x01').decode('ascii')),
                       ('audio/L16;codec=pcm;rate=24000', '???'),
                       ('audio/L16;codec=pcm;rate=24000', b64encode(b'\x01').decode('ascii'))]:
        bad = deepcopy(response)
        inline = bad['candidates'][0]['content']['parts'][0]['inlineData']
        inline['mimeType'], inline['data'] = mime, data
        with pytest.raises(ValueError):
            voiceover_completed(bad)
