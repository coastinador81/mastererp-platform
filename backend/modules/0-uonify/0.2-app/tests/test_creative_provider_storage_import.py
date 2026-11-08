"""Importación read-only de un output GCS simulado, sin red ni escrituras."""

from base64 import b64encode
from hashlib import md5
from pathlib import Path

import pytest
import requests

from app.creative_provider_storage_import import (
    ProviderStorageImportError, ProviderStorageImportUnknown,
    import_generated_video_once)
from app.creative_video_contracts import VideoUriOutput


LOCATION = 'EUROPE-WEST1'
BUCKET = 'uonify-private-media'
NAME = 'creative/generated/attempt-123/output.mp4'
VIDEO = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results' /
         'gemini-omni-1.1-flash-preview-1.mp4').read_bytes()
OUTPUT = VideoUriOutput('video/mp4', f'gs://{BUCKET}/{NAME}')


class Response:
    def __init__(self, status, body=None, content=b''):
        self.status_code, self.body, self.content = status, body, content
        self.closed = False

    def json(self):
        return self.body

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]

    def close(self):
        self.closed = True


class Session:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def request(self, method, url, **options):
        self.calls.append((method, url, options))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def bucket_body():
    return {'name': BUCKET, 'location': LOCATION,
            'iamConfiguration': {
                'uniformBucketLevelAccess': {'enabled': True},
                'publicAccessPrevention': 'enforced'},
            'versioning': {'enabled': True}}


def metadata_body(**changes):
    return {'bucket': BUCKET, 'name': NAME, 'contentType': 'video/mp4',
            'size': str(len(VIDEO)), 'generation': '321',
            'md5Hash': b64encode(md5(VIDEO).digest()).decode(), **changes}


def test_provider_video_fixes_generation_and_validates_real_mp4_bytes():
    responses = (Response(200, bucket_body()), Response(200, metadata_body()),
                 Response(200, content=VIDEO))
    result = import_generated_video_once(
        OUTPUT, 'offline-token', Session(*responses),
        expected_location=LOCATION)
    assert result.generation == 321 and result.byte_size == len(VIDEO)
    assert (result.width_pixels, result.height_pixels, result.frame_rate) == (640, 360, 24)
    assert 3 < result.duration_seconds < 3.1 and len(result.sha256) == 64
    assert all(response.closed for response in responses)


def test_provider_video_never_writes_or_downloads_without_verified_metadata():
    session = Session(Response(200, bucket_body()),
                      Response(200, metadata_body(name='other/output.mp4')))
    with pytest.raises(ProviderStorageImportError):
        import_generated_video_once(
            OUTPUT, 'offline-token', session, expected_location=LOCATION)
    assert [call[0] for call in session.calls] == ['GET', 'GET']


@pytest.mark.parametrize('failure', [requests.Timeout(), Response(404)])
def test_provider_video_uncertain_metadata_never_repeats_generation(failure):
    session = Session(Response(200, bucket_body()), failure)
    with pytest.raises(ProviderStorageImportUnknown):
        import_generated_video_once(
            OUTPUT, 'offline-token', session, expected_location=LOCATION)
    assert [call[0] for call in session.calls] == ['GET', 'GET']


def test_provider_video_rejects_changed_bytes_at_fixed_generation():
    response = Response(200, content=VIDEO[:-1] + b'x')
    session = Session(Response(200, bucket_body()), Response(200, metadata_body()),
                      response)
    with pytest.raises(ProviderStorageImportError, match='checksum'):
        import_generated_video_once(
            OUTPUT, 'offline-token', session, expected_location=LOCATION)
    assert session.calls[-1][1].endswith('?alt=media&generation=321')
    assert response.closed
