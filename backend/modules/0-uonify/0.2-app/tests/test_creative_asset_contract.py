"""Un recibo GCS solo se vuelve snapshot si coincide con draft y ownership."""

from dataclasses import replace
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

import pytest

from app.creative_asset_contract import bind_creative_asset, craft_asset_payload
from app.creative_generated_storage import generated_storage_plan
from app.creative_google_transport import GoogleDispatchResult
from app.creative_storage_contracts import StorageReceipt
from app.creative_video_contracts import (VideoOutput, mp4_duration_seconds,
                                          mp4_video_geometry)
from app.creative_voiceover_contracts import VoiceoverOutput


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')
BUCKET = 'uonify-private-media'
USER = '75c5e84b-ef63-4c49-aa1b-03134069e83a'
PROJECT = '11111111-1111-4111-8111-111111111111'
STEP = '22222222-2222-4222-8222-222222222222'
GRAPH = 'a' * 64


def result(output):
    attempt = str(uuid4())
    return GoogleDispatchResult(attempt, 'b' * 64, 'completed', None,
                                (output,), {'attemptId': attempt})


def receipt(draft):
    expected = draft.upload.expected
    return StorageReceipt(expected.bucket, expected.name, 7, expected.mime_type,
                          expected.byte_size, expected.sha256)


def test_real_video_receipt_becomes_craft_ready_owned_snapshot():
    data = (AUDIT / 'veo-3.1-fast-generate-001-poll-1792279452-1.mp4').read_bytes()
    width, height, fps = mp4_video_geometry(data)
    output = VideoOutput('video/mp4', data, sha256(data).hexdigest(),
                         mp4_duration_seconds(data), width, height, fps)
    draft = generated_storage_plan(result(output), BUCKET, USER,
                                   (str(uuid4()),))[0]
    asset = bind_creative_asset(
        draft, receipt(draft), owner_user_id=USER, owner_project_id=PROJECT,
        revision=1, source_step_id=STEP, execution_graph_sha256=GRAPH)
    assert asset.ready_for_persistence and asset.ready_for_craft
    assert asset.media['frameRate'] == {'numerator': 24, 'denominator': 1}
    assert asset.storage_receipt.generation == 7 and len(asset.snapshot_sha256) == 64
    assert not asset.publication_authorized
    payload = craft_asset_payload(
        asset, mount_name='shot-01.mp4',
        persisted_snapshot_sha256=asset.snapshot_sha256,
        authorization_state='allowed')
    assert payload['assetRevision'] == 1
    assert payload['storageReceipt']['generation'] == 7
    assert payload['media']['frameRate'] == {'numerator': 24, 'denominator': 1}


def test_real_tts_wav_is_ready_but_pcm_and_wav_remain_distinct_assets():
    data = (AUDIT / 'gemini-2.5-flash-tts-1.pcm').read_bytes()
    output = VoiceoverOutput('audio/L16;codec=pcm;rate=24000', data,
                             sha256(data).hexdigest(), 24000, 1, 2,
                             len(data) / 48000)
    drafts = generated_storage_plan(result(output), BUCKET, USER,
                                    (str(uuid4()), str(uuid4())))
    assets = tuple(bind_creative_asset(
        item, receipt(item), owner_user_id=USER, owner_project_id=None,
        revision=1, source_step_id=STEP, execution_graph_sha256=GRAPH)
        for item in drafts)
    assert all(item.ready_for_craft for item in assets)
    assert assets[0].asset_id != assets[1].asset_id
    assert assets[1].lineage['sourceAssetId'] == assets[0].asset_id


def test_receipt_owner_or_graph_mismatch_is_rejected():
    data = (AUDIT / 'veo-3.1-fast-generate-001-poll-1792279452-1.mp4').read_bytes()
    width, height, fps = mp4_video_geometry(data)
    draft = generated_storage_plan(result(VideoOutput(
        'video/mp4', data, sha256(data).hexdigest(), mp4_duration_seconds(data),
        width, height, fps)), BUCKET, USER, (str(uuid4()),))[0]
    with pytest.raises(ValueError, match='recibo'):
        bind_creative_asset(
            draft, receipt(draft), owner_user_id=str(uuid4()), owner_project_id=None,
            revision=1, source_step_id=STEP, execution_graph_sha256=GRAPH)
    with pytest.raises(ValueError, match='Revisión'):
        bind_creative_asset(
            draft, receipt(draft), owner_user_id=USER, owner_project_id=None,
            revision=1, source_step_id=STEP, execution_graph_sha256='bad')
    with pytest.raises(ValueError, match='recibo'):
        bind_creative_asset(
            draft, replace(receipt(draft), generation=0), owner_user_id=USER,
            owner_project_id=None, revision=1, source_step_id=STEP,
            execution_graph_sha256=GRAPH)


def test_craft_projection_requires_persisted_snapshot_and_safe_mount():
    data = (AUDIT / 'veo-3.1-fast-generate-001-poll-1792279452-1.mp4').read_bytes()
    width, height, fps = mp4_video_geometry(data)
    draft = generated_storage_plan(result(VideoOutput(
        'video/mp4', data, sha256(data).hexdigest(), mp4_duration_seconds(data),
        width, height, fps)), BUCKET, USER, (str(uuid4()),))[0]
    asset = bind_creative_asset(
        draft, receipt(draft), owner_user_id=USER, owner_project_id=PROJECT,
        revision=1, source_step_id=STEP, execution_graph_sha256=GRAPH)
    for sha, state, mount in (
            ('f' * 64, 'allowed', 'input.mp4'),
            (asset.snapshot_sha256, 'revoked', 'input.mp4'),
            (asset.snapshot_sha256, 'allowed', '../input.mp4')):
        with pytest.raises(ValueError, match='persistido'):
            craft_asset_payload(asset, mount_name=mount,
                                persisted_snapshot_sha256=sha,
                                authorization_state=state)
