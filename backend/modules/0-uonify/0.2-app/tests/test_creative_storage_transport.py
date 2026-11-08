"""Simula HTTP de Cloud Storage sin red ni credenciales reales."""

from dataclasses import replace
import requests
import pytest

from app.creative_storage_contracts import storage_upload
from app.creative_storage_transport import (StorageTransportConflict,
                                            StorageTransportError,
                                            StorageTransportUnknown,
                                            download_verified, upload_once)


USER = '75c5e84b-ef63-4c49-aa1b-03134069e83a'
ASSET = 'cbcc5bb6-bd64-4ae3-bedd-485fe2f9beb8'
LOCATION = 'EUROPE-WEST1'
REQUEST = storage_upload('uonify-private-media', USER, ASSET,
                         'image/png', b'\x89PNG\r\n\x1a\nimage')


class Response:
    def __init__(self, status, body=None, content=b''):
        self.status_code = status
        self.body = body
        self.content = content
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
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **options):
        self.calls.append((method, url, options))
        next_response = self.responses.pop(0)
        if isinstance(next_response, Exception):
            raise next_response
        return next_response


def receipt_body(**changes):
    expected = REQUEST.expected
    return {'bucket': expected.bucket, 'name': expected.name,
            'contentType': expected.mime_type, 'size': str(expected.byte_size),
            'generation': '123', 'md5Hash': expected.md5_base64,
            'metadata': {'sha256': expected.sha256}, **changes}


def bucket_body(**changes):
    return {'name': REQUEST.expected.bucket, 'location': LOCATION,
            'iamConfiguration': {
                'uniformBucketLevelAccess': {'enabled': True},
                'publicAccessPrevention': 'enforced'},
            'versioning': {'enabled': True}, **changes}


def upload(session):
    return upload_once(REQUEST, 'short-test-token', session,
                       expected_location=LOCATION)


def test_success_has_one_post_and_verified_receipt():
    session = Session(Response(200, bucket_body()), Response(200, receipt_body()))
    result = upload(session)
    assert result.generation == 123
    assert [call[0] for call in session.calls] == ['GET', 'POST']
    assert session.calls[1][2]['data'] == REQUEST.body


@pytest.mark.parametrize('first', [requests.Timeout(), Response(412), Response(503)])
def test_uncertain_or_duplicate_upload_reads_metadata_without_second_post(first):
    session = Session(Response(200, bucket_body()), first,
                      Response(200, receipt_body()))
    result = upload(session)
    assert result.sha256 == REQUEST.expected.sha256
    assert [call[0] for call in session.calls] == ['GET', 'POST', 'GET']
    assert 'data' not in session.calls[2][2]


def test_conflicting_object_is_never_treated_as_success():
    session = Session(Response(200, bucket_body()), Response(412),
                      Response(200, receipt_body(size='1')))
    with pytest.raises(StorageTransportConflict):
        upload(session)
    assert [call[0] for call in session.calls] == ['GET', 'POST', 'GET']


def test_timeout_followed_by_404_remains_unknown():
    session = Session(Response(200, bucket_body()), requests.Timeout(), Response(404))
    with pytest.raises(StorageTransportUnknown):
        upload(session)
    assert [call[0] for call in session.calls] == ['GET', 'POST', 'GET']


def test_permissions_fail_without_retry_or_read():
    session = Session(Response(200, bucket_body()), Response(403))
    with pytest.raises(StorageTransportError):
        upload(session)
    assert [call[0] for call in session.calls] == ['GET', 'POST']


@pytest.mark.parametrize('first', [Response(404), Response(403), requests.Timeout(),
                                        Response(200, bucket_body(versioning={'enabled': False})),
                                        Response(200, bucket_body(location='US'))])
def test_upload_never_sends_bytes_without_private_bucket(first):
    session = Session(first)
    with pytest.raises(StorageTransportError):
        upload(session)
    assert [call[0] for call in session.calls] == ['GET']
    assert 'data' not in session.calls[0][2]


def test_modified_upload_envelope_never_receives_the_google_token():
    for altered in (
            replace(REQUEST, endpoint='https://example.org/steal'),
            replace(REQUEST, endpoint=REQUEST.endpoint.replace('ifGenerationMatch=0',
                                                               'ifGenerationMatch=1')),
            replace(REQUEST, headers={**REQUEST.headers, 'Content-Length': '1'})):
        session = Session()
        with pytest.raises(ValueError, match='Sobre'):
            upload_once(altered, 'short-test-token', session,
                        expected_location=LOCATION)
        assert session.calls == []


def test_download_fixed_generation_verifies_exact_bytes_and_closes_response():
    receipt = upload(Session(Response(200, bucket_body()), Response(200, receipt_body())))
    response = Response(200, content=b'\x89PNG\r\n\x1a\nimage')
    session = Session(response)
    assert download_verified(receipt, 'short-test-token', session) == response.content
    assert session.calls[0][1].endswith('?alt=media&generation=123')
    assert session.calls[0][2]['stream'] is True
    assert response.closed


def test_download_rejects_changed_or_oversized_bytes():
    receipt = upload(Session(Response(200, bucket_body()), Response(200, receipt_body())))
    for content in (b'\x89PNG\r\n\x1a\nother', b'changed and too long'):
        response = Response(200, content=content)
        with pytest.raises(StorageTransportConflict):
            download_verified(receipt, 'short-test-token', Session(response))
        assert response.closed
