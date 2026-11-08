"""La reanudación solo consulta operaciones guardadas; no reenvía generation."""

from base64 import b64encode

import pytest
import requests

from app.creative_veo_recovery import VeoRecoveryUnknown, poll_veo_once


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
MODEL = 'veo-3.1-generate-001'
NAME = (f'projects/{PROJECT}/locations/us-central1/publishers/google/'
        f'models/{MODEL}/operations/test-123')


def mp4():
    def box(kind, payload):
        return (len(payload) + 8).to_bytes(4, 'big') + kind + payload
    ftyp = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00isommp42'
    mvhd = box(b'mvhd', b'\x00' * 12 + (1000).to_bytes(4, 'big') +
               (4000).to_bytes(4, 'big'))
    tkhd = box(b'tkhd', b'\x00\x00\x00\x07' + b'\x00' * 8 +
               (1).to_bytes(4, 'big') + b'\x00' * 4 +
               (96000).to_bytes(4, 'big') + b'\x00' * 16 + b'\x00' * 36 +
               (1280 << 16).to_bytes(4, 'big') + (720 << 16).to_bytes(4, 'big'))
    mdhd = box(b'mdhd', b'\x00' * 12 + (24000).to_bytes(4, 'big') +
               (96000).to_bytes(4, 'big') + b'\x00' * 4)
    hdlr = box(b'hdlr', b'\x00' * 8 + b'vide')
    stts = box(b'stts', b'\x00' * 4 + (1).to_bytes(4, 'big') +
               (96).to_bytes(4, 'big') + (1000).to_bytes(4, 'big'))
    trak = box(b'trak', tkhd + box(b'mdia', mdhd + hdlr +
                                  box(b'minf', box(b'stbl', stts))))
    return ftyp + box(b'moov', mvhd + trak)


class Response:
    def __init__(self, status, body):
        self.status_code, self.body = status, body

    def json(self):
        return self.body


class Session:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def request(self, method, url, **options):
        self.calls.append((method, url, options))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_pending_poll_uses_only_fetch_operation():
    session = Session(Response(200, {'name': NAME, 'done': False}))
    result = poll_veo_once(PROJECT, MODEL, NAME, 'test-token', session)
    assert not result.done and result.outputs == ()
    assert [call[0] for call in session.calls] == ['POST']
    assert session.calls[0][1].endswith(':fetchPredictOperation')
    assert session.calls[0][2]['json'] == {'operationName': NAME}


def test_completed_poll_normalizes_mp4_without_new_generation():
    response = {'name': NAME, 'done': True, 'response': {'videos': [{
        'mimeType': 'video/mp4',
        'bytesBase64Encoded': b64encode(mp4()).decode('ascii')}]}}
    session = Session(Response(200, response))
    result = poll_veo_once(PROJECT, MODEL, NAME, 'test-token', session)
    assert result.done and len(result.outputs) == 1
    assert result.outputs[0].duration_seconds == 4
    assert len(session.calls) == 1


def test_uncertain_poll_never_submits_generation():
    for response in (Response(500, {}), requests.Timeout(),
                     Response(200, {'name': NAME + '-other', 'done': False}),
                     Response(200, {'name': NAME})):
        session = Session(response)
        with pytest.raises(VeoRecoveryUnknown):
            poll_veo_once(PROJECT, MODEL, NAME, 'test-token', session)
        assert len(session.calls) == 1
        assert 'fetchPredictOperation' in session.calls[0][1]
    with pytest.raises(ValueError, match='no pertenece'):
        poll_veo_once('another-project', MODEL, NAME, 'test-token', Session(None))
