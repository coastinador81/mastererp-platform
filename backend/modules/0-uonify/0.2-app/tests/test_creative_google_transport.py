"""Replay HTTP offline del transporte; nunca usa red, token ni gasto reales."""

from base64 import b64encode
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4

import pytest
import requests

from app.creative_google_transport import (GoogleDispatchError,
                                           GoogleDispatchUnknown,
                                           dispatch_once)
from app.creative_image_contracts import image_request
from app.creative_music_contracts import music_request
from app.creative_request_fingerprint import fingerprint
from app.creative_video_contracts import (omni_background_request, omni_request,
                                          veo_request)
from app.creative_voiceover_contracts import voiceover_request


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')
PROJECT = 'uonify-757ec8c3ab3245ffa45d'


class Response:
    def __init__(self, status, body):
        self.status_code, self.body, self.closed = status, body, False

    def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body

    def close(self):
        self.closed = True


class Session:
    def __init__(self, response):
        self.response, self.calls = response, []

    def request(self, method, url, **options):
        self.calls.append((method, url, options))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def pilot(name):
    return deepcopy(json.loads((AUDIT / name).read_text())['response'])


def restore(value):
    raw = (AUDIT / value['file']).read_bytes()
    assert len(raw) == value['bytes'] and sha256(raw).hexdigest() == value['sha256']
    return b64encode(raw).decode()


def reservation():
    return {'attemptId': str(uuid4()), 'status': 'reserved'}


def send(request, payload):
    response = Response(200, payload)
    session = Session(response)
    result = dispatch_once(reservation(), request, fingerprint(request).sha256,
                           'offline-token', session)
    assert len(session.calls) == 1 and session.calls[0][0] == 'POST'
    assert session.calls[0][2]['json'] == request.body and response.closed
    assert result.receipt['requestSha256'] == fingerprint(request).sha256
    return result


def test_image_and_voice_outputs_are_normalized_without_bytes_in_receipt():
    image_payload = pilot('gemini-3.1-flash-image.json')
    part = [part for part in image_payload['candidates'][0]['content']['parts']
            if isinstance(part.get('inlineData'), dict) and not part.get('thought')][0]
    part['inlineData']['data'] = restore(part['inlineData']['data'])
    image = image_request(PROJECT, 'gemini-3.1-flash-image', 'Ciudad futurista')
    image_result = send(image, image_payload)
    assert image_result.state == 'completed' and len(image_result.outputs) == 1
    assert image_result.receipt['outputSha256'] == [image_result.outputs[0].sha256]
    assert 'data' not in str(image_result.receipt)

    voice_payload = pilot('gemini-2.5-flash-tts.json')
    inline = voice_payload['candidates'][0]['content']['parts'][0]['inlineData']
    inline['data'] = restore(inline['data'])
    voice = voiceover_request(PROJECT, 'Bienvenidos a la ciudad del futuro.')
    voice_result = send(voice, voice_payload)
    assert voice_result.outputs[0].sample_rate_hz == 24000


def test_music_omni_and_veo_follow_their_verified_response_modes():
    music_payload = pilot('lyria-3-clip-preview.json')
    audio = [item for item in music_payload['outputs'] if item.get('type') == 'audio'][0]
    audio['data'] = restore(audio['data'])
    music = music_request(PROJECT, 'Música ambiental futurista instrumental')
    assert send(music, music_payload).outputs[0].mime_type == 'audio/mpeg'

    omni_payload = pilot('gemini-omni-1.1-flash-preview.json')
    video = [item for step in omni_payload['steps'] for item in step.get('content', [])
             if item.get('type') == 'video'][0]
    video['data'] = restore(video['data'])
    omni = omni_request(PROJECT, 'Ciudad futurista bajo la lluvia', ())
    omni_result = send(omni, omni_payload)
    assert (omni_result.outputs[0].width_pixels,
            omni_result.outputs[0].height_pixels) == (640, 360)

    veo_payload = pilot('veo-3.1-fast-generate-001.json')
    veo = veo_request(PROJECT, 'veo-3.1-fast-generate-001', 'Ciudad futurista')
    veo_result = send(veo, veo_payload)
    assert veo_result.state == 'accepted' and veo_result.outputs == ()
    assert veo_result.provider_operation == veo_payload['name']


def test_omni_background_acceptance_returns_interaction_without_polling():
    request = omni_background_request(
        PROJECT, 'Ciudad nocturna',
        'gs://uonify-private-media/creative/attempt-123/')
    response = {'id': 'interaction_123', 'status': 'in_progress',
                'object': 'interaction'}
    result = send(request, response)
    assert result.state == 'accepted'
    assert result.provider_operation == 'interaction_123'
    assert result.outputs == ()


def test_transport_never_retries_or_accepts_changed_request():
    request = image_request(PROJECT, 'gemini-3.1-flash-image', 'Ciudad futurista')
    for response, error in ((requests.Timeout(), GoogleDispatchUnknown),
                            (Response(503, {}), GoogleDispatchUnknown),
                            (Response(429, {}), GoogleDispatchError),
                            (Response(200, ValueError('bad json')), GoogleDispatchUnknown)):
        session = Session(response)
        with pytest.raises(error):
            dispatch_once(reservation(), request, fingerprint(request).sha256,
                          'offline-token', session)
        assert len(session.calls) == 1
    with pytest.raises(ValueError, match='coincide'):
        dispatch_once(reservation(), request, 'f' * 64, 'offline-token', Session(None))


def test_transport_rejects_external_endpoint_and_unowned_reference_before_http():
    request = image_request(PROJECT, 'gemini-3.1-flash-image', 'Ciudad futurista')
    altered = type(request)('https://example.org/steal', request.model,
                            request.body, request.input_manifest)
    session = Session(None)
    with pytest.raises(ValueError, match='Endpoint'):
        dispatch_once(reservation(), altered, fingerprint(altered).sha256,
                      'offline-token', session)
    assert session.calls == []
    hidden = type(request)(request.endpoint, request.model, {
        **request.body, 'hidden': {'inlineData': {'data': 'c2VjcmV0'}}}, ())
    with pytest.raises(ValueError, match='oculta'):
        dispatch_once(reservation(), hidden, fingerprint(hidden).sha256,
                      'offline-token', session)
    assert session.calls == []
