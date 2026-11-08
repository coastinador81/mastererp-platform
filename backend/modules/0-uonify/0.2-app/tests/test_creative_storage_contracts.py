"""GCS se prepara/reconcilia offline; jamás crea un objeto de prueba."""

import json
from pathlib import Path

import pytest

from app.creative_storage_contracts import (storage_metadata_request,
                                            storage_receipt, storage_upload)


USER = '75c5e84b-ef63-4c49-aa1b-03134069e83a'
ASSET = 'cbcc5bb6-bd64-4ae3-bedd-485fe2f9beb8'
PNG = b'\x89PNG\r\n\x1a\nprivate bytes'
AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def test_private_upload_is_create_only_and_binds_media_checksum():
    request = storage_upload('uonify-private-media', USER, ASSET, 'image/png', PNG)
    assert request.method == 'POST'
    assert request.endpoint.endswith('?uploadType=multipart&ifGenerationMatch=0')
    assert request.headers['Content-Type'].startswith('multipart/related; boundary=')
    assert int(request.headers['Content-Length']) == len(request.body)
    assert request.body.count(PNG) == 1
    prefix = request.body.split(b'\r\n\r\n', 1)[1]
    metadata = json.loads(prefix.split(b'\r\n--', 1)[0])
    assert metadata['metadata']['sha256'] == request.expected.sha256
    assert metadata['name'] == request.expected.name
    assert metadata['contentType'] == 'image/png'
    assert metadata['cacheControl'] == 'private, no-store'
    assert 'acl' not in metadata and 'predefinedAcl' not in request.endpoint
    assert '/assets/' + ASSET + '/' in request.expected.name


def test_uncertain_upload_is_reconciled_read_only_with_generation():
    expected = storage_upload('uonify-private-media', USER, ASSET,
                              'image/png', PNG).expected
    check = storage_metadata_request(expected)
    assert check.method == 'GET' and check.body is None
    assert '%2F' in check.endpoint and check.endpoint.endswith(expected.name.replace('/', '%2F'))
    response = {'bucket': expected.bucket, 'name': expected.name,
                'contentType': expected.mime_type, 'size': str(expected.byte_size),
                'generation': '1777777777777', 'md5Hash': expected.md5_base64,
                'metadata': {'sha256': expected.sha256}}
    receipt = storage_receipt(response, expected)
    assert receipt.generation == 1777777777777
    assert receipt.sha256 == expected.sha256
    with pytest.raises(ValueError, match='no coincide'):
        storage_receipt({**response, 'metadata': {'sha256': '0' * 64}}, expected)
    with pytest.raises(ValueError, match='no coincide'):
        storage_receipt({**response, 'size': '99'}, expected)


def test_storage_rejects_external_paths_and_bad_media():
    with pytest.raises(ValueError, match='Bucket'):
        storage_upload('../foreign', USER, ASSET, 'image/png', PNG)
    with pytest.raises(ValueError, match='Usuario'):
        storage_upload('uonify-private-media', '../foreign', ASSET,
                       'image/png', PNG)
    with pytest.raises(ValueError, match='Firma PNG'):
        storage_upload('uonify-private-media', USER, ASSET,
                       'image/png', b'not a png')
    with pytest.raises(ValueError, match='Medio'):
        storage_upload('uonify-private-media', USER, ASSET,
                       'text/html', b'<script>')
    with pytest.raises(ValueError, match='Muestra'):
        storage_upload('uonify-private-media', USER, ASSET,
                       'audio/L16;codec=pcm;rate=24000', b'1')


@pytest.mark.parametrize('file,mime', [
    ('lyria-3-clip-preview-1.mp3', 'audio/mpeg'),
    ('gemini-2.5-flash-tts-1.pcm', 'audio/L16;codec=pcm;rate=24000'),
    ('veo-3.1-generate-001-poll-1792279454-1.mp4', 'video/mp4'),
])
def test_real_pilot_media_can_be_prepared_for_private_storage(file, mime):
    raw = (AUDIT / file).read_bytes()
    request = storage_upload('uonify-private-media', USER, ASSET, mime, raw)
    assert request.body.count(raw) == 1
    assert request.expected.byte_size == len(raw)
