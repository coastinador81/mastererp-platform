"""Prueba local del contrato musical con el MP3 real ya auditado."""

from base64 import b64encode
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest

from app.creative_music_contracts import music_completed, music_request


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def test_music_request_uses_stateless_audited_mode():
    request = music_request(PROJECT, ' Música instrumental calmada ')
    assert request.endpoint.endswith('/locations/global/interactions')
    assert request.body == {'model': 'lyria-3-clip-preview', 'store': False,
                            'input': [{'type': 'text', 'text':
                                       'Música instrumental calmada'}]}
    with pytest.raises(ValueError, match='Proyecto'):
        music_request('../foreign', 'Música')
    with pytest.raises(ValueError, match='Instrucción'):
        music_request(PROJECT, '')


def test_real_pilot_music_is_normalized_offline():
    audit = json.loads((AUDIT / 'lyria-3-clip-preview.json').read_text())
    assert audit['httpStatus'] == 200
    response = deepcopy(audit['response'])
    media = next(item['data'] for item in response['outputs']
                 if item['type'] == 'audio')
    raw = (AUDIT / media['file']).read_bytes()
    assert len(raw) == media['bytes'] and sha256(raw).hexdigest() == media['sha256']
    next(item for item in response['outputs'] if item['type'] == 'audio')['data'] = (
        b64encode(raw).decode('ascii'))
    output = music_completed(response)
    assert output.data == raw and output.sha256 == media['sha256']


def test_music_parser_rejects_wrong_status_model_format_or_bytes():
    response = {'model': 'lyria-3-clip-preview', 'status': 'completed',
                'outputs': [{'type': 'text', 'text': 'Caption'},
                            {'type': 'audio', 'mime_type': 'audio/mpeg',
                             'data': b64encode(b'\xff\xfb\xb0\x44audio').decode('ascii')}]}
    assert music_completed(response).data == b'\xff\xfb\xb0\x44audio'
    for bad in [
        {**response, 'model': 'lyria-3-pro-preview'},
        {**response, 'status': 'in_progress'},
        {**response, 'outputs': [{'type': 'text', 'text': 'Caption'}]},
        {**response, 'outputs': [{'type': 'audio', 'mime_type': 'audio/wav',
                                  'data': b64encode(b'RIFF').decode('ascii')}]},
        {**response, 'outputs': [{'type': 'audio', 'mime_type': 'audio/mpeg',
                                  'data': b64encode(b'bad').decode('ascii')}]},
        {**response, 'outputs': [{'type': 'audio', 'mime_type': 'audio/mpeg',
                                  'data': b64encode(b'ID3example').decode('ascii')}]},
    ]:
        with pytest.raises(ValueError):
            music_completed(bad)
