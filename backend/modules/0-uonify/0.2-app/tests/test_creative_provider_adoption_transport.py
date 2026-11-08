"""Transporte rewrite simulado: un POST máximo y reconciliación read-only."""

from uuid import uuid4

import pytest
import requests

from app.creative_provider_adoption_transport import (
    ProviderAdoptionTransportConflict, ProviderAdoptionTransportUnknown,
    adopt_provider_video_once)
from app.creative_provider_asset_adoption import provider_video_adoption_request
from app.creative_provider_storage_import import ImportedVideo
from app.creative_storage_contracts import StorageReceipt


BUCKET = 'uonify-private-media'
LOCATION = 'EUROPE-WEST1'
USER = '75c5e84b-ef63-4c49-aa1b-03134069e83a'


class Response:
    def __init__(self, status, body=None):
        self.status_code, self.body, self.closed = status, body, False
    def json(self): return self.body
    def close(self): self.closed = True


class Session:
    def __init__(self, *responses): self.responses, self.calls = list(responses), []
    def request(self, method, url, **options):
        self.calls.append((method, url, options))
        value = self.responses.pop(0)
        if isinstance(value, Exception): raise value
        return value


def bucket():
    return {'name': BUCKET, 'location': LOCATION,
            'iamConfiguration': {'uniformBucketLevelAccess': {'enabled': True},
                                 'publicAccessPrevention': 'enforced'},
            'versioning': {'enabled': True}}


def request():
    imported = ImportedVideo(BUCKET, 'creative/provider/a/output.mp4', 321,
        'video/mp4', 1000, 'a' * 64, 3.0, 640, 360, 24)
    return provider_video_adoption_request(
        imported, owner_user_id=USER, asset_id=str(uuid4()))


def completed(value):
    expected = value.draft.expected
    return {'done': True, 'totalBytesRewritten': str(expected.byte_size),
            'objectSize': str(expected.byte_size),
            'resource': {'bucket': expected.bucket, 'name': expected.name,
                         'generation': '9', 'size': str(expected.byte_size),
                         'contentType': expected.mime_type,
                         'metadata': {'sha256': expected.sha256}}}


def metadata(value, **changes):
    expected = value.draft.expected
    body = {'bucket': expected.bucket, 'name': expected.name, 'generation': '9',
            'size': str(expected.byte_size), 'contentType': expected.mime_type,
            'metadata': {'sha256': expected.sha256}}
    body.update(changes)
    return body


def test_complete_rewrite_uses_one_post_and_returns_receipt():
    value = request(); session = Session(Response(200, bucket()),
                                         Response(200, completed(value)))
    result = adopt_provider_video_once(
        value, 'offline-token', session, expected_location=LOCATION)
    assert isinstance(result, StorageReceipt) and result.generation == 9
    assert [item[0] for item in session.calls] == ['GET', 'POST']


def test_timeout_reconciles_with_get_and_never_reposts():
    value = request(); session = Session(Response(200, bucket()),
        requests.Timeout(), Response(200, metadata(value)))
    result = adopt_provider_video_once(
        value, 'offline-token', session, expected_location=LOCATION)
    assert isinstance(result, StorageReceipt)
    assert [item[0] for item in session.calls] == ['GET', 'POST', 'GET']


def test_uncertain_or_conflicting_reconciliation_fails_closed():
    value = request()
    with pytest.raises(ProviderAdoptionTransportUnknown):
        adopt_provider_video_once(
            value, 'offline-token',
            Session(Response(200, bucket()), Response(503), Response(404)),
            expected_location=LOCATION)
    with pytest.raises(ProviderAdoptionTransportConflict):
        adopt_provider_video_once(
            value, 'offline-token', Session(
                Response(200, bucket()), Response(412),
                Response(200, metadata(value, name='other.mp4'))),
            expected_location=LOCATION)


def test_partial_rewrite_returns_continuation_without_second_post():
    value = request(); partial = {
        'done': False, 'totalBytesRewritten': '500', 'objectSize': '1000',
        'rewriteToken': 'continue_1'}
    session = Session(Response(200, bucket()), Response(200, partial))
    continued = adopt_provider_video_once(
        value, 'offline-token', session, expected_location=LOCATION)
    assert continued.rewrite_token == 'continue_1'
    assert [item[0] for item in session.calls] == ['GET', 'POST']
