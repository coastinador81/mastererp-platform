"""El rewrite GCS se prepara y valida offline, sin copiar objetos reales."""

from dataclasses import replace
from uuid import uuid4

import pytest

from app.creative_asset_contract import bind_creative_asset, craft_asset_payload
from app.creative_provider_asset_adoption import (
    provider_video_adoption_request, provider_video_adoption_response)
from app.creative_provider_storage_import import ImportedVideo
from app.creative_storage_contracts import StorageReceipt


USER = '75c5e84b-ef63-4c49-aa1b-03134069e83a'
PROJECT = '11111111-1111-4111-8111-111111111111'
STEP = '22222222-2222-4222-8222-222222222222'


def imported():
    return ImportedVideo('uonify-private-media',
                         'creative/provider/attempt/output.mp4', 321,
                         'video/mp4', 1_500_000, 'a' * 64,
                         3.04, 640, 360, 24)


def complete(request, **changes):
    expected = request.draft.expected
    resource = {'bucket': expected.bucket, 'name': expected.name,
                'generation': '654', 'size': str(expected.byte_size),
                'contentType': expected.mime_type,
                'metadata': {'sha256': expected.sha256}}
    resource.update(changes)
    return {'done': True, 'totalBytesRewritten': str(expected.byte_size),
            'objectSize': str(expected.byte_size), 'resource': resource}


def test_provider_video_rewrites_to_create_only_owned_hash_path():
    asset_id = str(uuid4())
    request = provider_video_adoption_request(
        imported(), owner_user_id=USER, asset_id=asset_id)
    assert request.method == 'POST' and 'sourceGeneration=321' in request.endpoint
    assert 'ifGenerationMatch=0' in request.endpoint
    assert request.draft.expected.name == (
        f'creative/users/{USER}/assets/{asset_id}/' + 'a' * 64 + '.mp4')
    receipt = provider_video_adoption_response(request, complete(request))
    assert isinstance(receipt, StorageReceipt) and receipt.generation == 654
    asset = bind_creative_asset(
        request.draft, receipt, owner_user_id=USER, owner_project_id=PROJECT,
        revision=1, source_step_id=STEP, execution_graph_sha256='f' * 64)
    assert asset.ready_for_craft and asset.lineage['sourceGeneration'] == 321
    payload = craft_asset_payload(
        asset, mount_name='omni-shot.mp4',
        persisted_snapshot_sha256=asset.snapshot_sha256,
        authorization_state='allowed')
    assert payload['storageReceipt']['name'] == request.draft.expected.name


def test_multi_call_rewrite_preserves_source_and_uses_opaque_token():
    request = provider_video_adoption_request(
        imported(), owner_user_id=USER, asset_id=str(uuid4()))
    continued = provider_video_adoption_response(request, {
        'done': False, 'totalBytesRewritten': '1000000',
        'objectSize': '1500000', 'rewriteToken': 'opaque-token_1'})
    assert continued.source == request.source and continued.draft == request.draft
    assert continued.endpoint.endswith('rewriteToken=opaque-token_1')
    receipt = provider_video_adoption_response(continued, complete(continued))
    assert receipt.sha256 == imported().sha256


@pytest.mark.parametrize('response', [
    {'done': False, 'totalBytesRewritten': '1', 'objectSize': '1500000'},
    {'done': False, 'totalBytesRewritten': '1500000',
     'objectSize': '1500000', 'rewriteToken': 'late'},
])
def test_incomplete_rewrite_without_safe_progress_is_rejected(response):
    request = provider_video_adoption_request(
        imported(), owner_user_id=USER, asset_id=str(uuid4()))
    with pytest.raises(ValueError):
        provider_video_adoption_response(request, response)


def test_changed_destination_or_generation_is_rejected():
    request = provider_video_adoption_request(
        imported(), owner_user_id=USER, asset_id=str(uuid4()))
    with pytest.raises(ValueError, match='destino'):
        provider_video_adoption_response(
            request, complete(request, name='creative/other.mp4'))
    with pytest.raises(ValueError, match='recurso adoptado'):
        provider_video_adoption_response(
            request, complete(request, generation='0'))
    with pytest.raises(ValueError, match='importado'):
        provider_video_adoption_request(
            replace(imported(), generation=0), owner_user_id=USER,
            asset_id=str(uuid4()))
