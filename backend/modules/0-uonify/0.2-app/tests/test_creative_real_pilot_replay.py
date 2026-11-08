"""Reproduce resultados reales auditados sustituyendo solo los blobs externalizados.

No envía ninguna petición, ni utiliza tokens: comprueba las respuestas de Google
guardadas el 18-10-2026 frente a sus bytes y huellas originales.
"""

from base64 import b64encode
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest

from app.creative_image_contracts import image_completed, image_request
from app.creative_music_contracts import music_request
from app.creative_video_contracts import (VideoMedia, omni_completed, omni_request,
                                          veo_completed, veo_request)
from app.creative_voiceover_contracts import voiceover_request


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')
PROJECT = 'uonify-757ec8c3ab3245ffa45d'


def _pilot(name):
    pilot = json.loads((AUDIT / name).read_text())
    assert pilot['httpStatus'] == 200
    return deepcopy(pilot['response'])


def _restore(descriptor):
    raw = (AUDIT / descriptor['file']).read_bytes()
    assert len(raw) == descriptor['bytes']
    assert sha256(raw).hexdigest() == descriptor['sha256']
    return raw


@pytest.mark.parametrize('name', [
    'veo-3.1-generate-001-poll-1792279454.json',
    'veo-3.1-fast-generate-001-poll-1792279452.json',
])
def test_veo_real_pilot_response_matches_local_mp4(name):
    response = _pilot(name)
    item = response['response']['videos'][0]
    raw = _restore(item['bytesBase64Encoded'])
    item['bytesBase64Encoded'] = b64encode(raw).decode('ascii')
    output = veo_completed(response, response['name'])
    assert len(output) == 1
    assert output[0].data == raw and output[0].sha256 == sha256(raw).hexdigest()
    assert output[0].duration_seconds > 3
    assert (output[0].width_pixels, output[0].height_pixels,
            output[0].frame_rate) == (1280, 720, 24)


@pytest.mark.parametrize('name', [
    'omni-reference-image.json',
    'omni-reference-image-video.json',
    'omni-reference-edit-v2.json',
])
def test_omni_real_pilot_response_matches_local_mp4(name):
    response = _pilot(name)
    audio_or_video = [(item, item.get('data')) for step in response['steps']
                      for item in step.get('content', []) if item.get('type') == 'video']
    assert len(audio_or_video) == 1
    item, descriptor = audio_or_video[0]
    raw = _restore(descriptor)
    item['data'] = b64encode(raw).decode('ascii')
    output = omni_completed(response)
    assert len(output) == 1
    assert output[0].data == raw and output[0].sha256 == sha256(raw).hexdigest()
    assert output[0].duration_seconds > 0
    assert (output[0].width_pixels, output[0].height_pixels,
            output[0].frame_rate) == (640, 360, 24)


@pytest.mark.parametrize('name,model', [
    ('gemini-nano-banana-2.1.json', 'gemini-nano-banana-2.1'),
    ('gemini-3.1-flash-image.json', 'gemini-3.1-flash-image'),
    ('gemini-3-pro-image.json', 'gemini-3-pro-image'),
])
def test_image_real_pilot_response_matches_local_image(name, model):
    response = _pilot(name)
    parts = [part for part in response['candidates'][0]['content']['parts']
             if isinstance(part.get('inlineData'), dict) and not part.get('thought')]
    assert len(parts) == 1
    descriptor = parts[0]['inlineData']['data']
    raw = _restore(descriptor)
    parts[0]['inlineData']['data'] = b64encode(raw).decode('ascii')
    result = image_completed(response, model)
    assert len(result) == 1
    assert result[0].data == raw and result[0].sha256 == sha256(raw).hexdigest()
    assert (result[0].width_pixels, result[0].height_pixels) == (1024, 1024)


@pytest.mark.parametrize('model', [
    'veo-3.1-generate-001',
    'veo-3.1-fast-generate-001',
    'gemini-omni-1.1-flash-preview',
    'gemini-nano-banana-2.1',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'gemini-2.5-flash-tts',
    'lyria-3-clip-preview',
])
def test_text_only_request_rebuilds_exact_body_and_url_of_real_pilot(model):
    pilot = json.loads((AUDIT / (model + '.json')).read_text())
    original = pilot['request']
    if model.startswith('veo-'):
        request = veo_request(PROJECT, model, original['instances'][0]['prompt'])
    elif model.startswith('gemini-omni-'):
        request = omni_request(PROJECT, original['input'][0]['text'], ())
    elif model.endswith('-tts'):
        spoken = original['contents'][0]['parts'][0]['text']
        assert spoken.startswith('Di en español: ')
        request = voiceover_request(PROJECT, spoken[len('Di en español: '):])
    elif model.startswith('lyria-'):
        request = music_request(PROJECT, original['input'][0]['text'])
    else:
        request = image_request(PROJECT, model,
                                original['contents'][0]['parts'][0]['text'])
    assert request.body == original
    assert request.endpoint == pilot['url']


@pytest.mark.parametrize('name,edit', [
    ('omni-reference-image.json', False),
    ('omni-reference-image-video.json', False),
    ('omni-reference-edit-v2.json', True),
])
def test_reference_request_uses_exact_real_media_hashes(name, edit):
    pilot = json.loads((AUDIT / name).read_text())
    references = []
    for item in pilot['inputs']:
        raw = _restore(item)
        references.append(VideoMedia(item['type'], item['mimeType'], raw))
    request = omni_request(PROJECT, 'Prueba de referencia',
                           tuple(references), edit=edit)
    assert tuple(entry['sha256'] for entry in request.input_manifest) == (
        tuple(item['sha256'] for item in pilot['inputs']))
    assert request.body['generation_config']['video_config']['task'] == pilot['task']


def test_veo_subject_request_accepts_the_actual_image_reference():
    pilot = json.loads((AUDIT / 'veo-fast-subject-image.json').read_text())
    image = pilot['input']
    raw = _restore(image)
    request = veo_request(PROJECT, pilot['model'], 'Cubo azul',
                          VideoMedia('image', image['mimeType'], raw))
    assert request.body['parameters'] == pilot['parameters']
    assert request.input_manifest[0]['sha256'] == image['sha256']
