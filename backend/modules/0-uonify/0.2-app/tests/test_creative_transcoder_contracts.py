"""Un clip de 3–4 s nunca se envía directamente a Transcoder."""

from hashlib import sha256

import pytest

from app.creative_storage_contracts import StorageReceipt
from app.creative_transcoder_contracts import (transcode_hd_request,
                                               transcoder_job_name)


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
EXPORT = '3a70f28b-5e12-49b0-a3f7-872f2eb767d6'


def mp4(seconds):
    ftyp = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00isommp42'
    mvhd = (28).to_bytes(4, 'big') + b'mvhd' + b'\x00' * 12 + \
        (1000).to_bytes(4, 'big') + (seconds * 1000).to_bytes(4, 'big')
    return ftyp + (len(mvhd) + 8).to_bytes(4, 'big') + b'moov' + mvhd


def stored(data):
    return StorageReceipt('uonify-private-media',
                          'creative/users/75c5e84b-ef63-4c49-aa1b-03134069e83a/'
                          'assets/cbcc5bb6-bd64-4ae3-bedd-485fe2f9beb8/master.mp4',
                          123, 'video/mp4', len(data), sha256(data).hexdigest())


def test_final_master_six_seconds_has_one_private_hd_output():
    data = mp4(6)
    request = transcode_hd_request(PROJECT, stored(data), data, EXPORT)
    assert request.endpoint.endswith('/locations/europe-west1/jobs')
    assert request.output_prefix.endswith(f'/creative/exports/{EXPORT}/')
    assert request.body['config']['inputs'][0]['uri'].startswith('gs://uonify-private-media/')
    mux = request.body['config']['muxStreams']
    assert mux == [{'key': 'final', 'fileName': 'final-hd.mp4', 'container': 'mp4',
                    'elementaryStreams': ['video0', 'audio0']}]
    assert not request.approval_ready


@pytest.mark.parametrize('seconds', [3, 4])
def test_single_short_google_clip_cannot_be_transcoded(seconds):
    data = mp4(seconds)
    with pytest.raises(ValueError, match='5 segundos'):
        transcode_hd_request(PROJECT, stored(data), data, EXPORT)


def test_transcoder_requires_same_master_and_scoped_job_name():
    data = mp4(6)
    with pytest.raises(ValueError, match='verificable'):
        transcode_hd_request(PROJECT, stored(data), mp4(7), EXPORT)
    name = f'projects/{PROJECT}/locations/europe-west1/jobs/job_123'
    assert transcoder_job_name(PROJECT, {'name': name}) == name
    with pytest.raises(ValueError, match='ajeno'):
        transcoder_job_name('other-project', {'name': name})
