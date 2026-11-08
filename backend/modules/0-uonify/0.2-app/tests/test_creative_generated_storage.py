"""Plan de almacenamiento Google sin red ni escritura productiva."""

from hashlib import sha256
from pathlib import Path
from uuid import uuid4

import pytest

from app.creative_generated_storage import generated_storage_plan
from app.creative_google_transport import GoogleDispatchResult
from app.creative_video_contracts import VideoOutput, mp4_duration_seconds, mp4_video_geometry
from app.creative_voiceover_contracts import VoiceoverOutput


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')
BUCKET = 'uonify-private-media'
USER = '75c5e84b-ef63-4c49-aa1b-03134069e83a'


def result(outputs, state='completed'):
    attempt = str(uuid4())
    return GoogleDispatchResult(attempt, 'a' * 64, state, None,
                                tuple(outputs), {'attemptId': attempt})


def test_real_veo_output_becomes_create_only_private_asset_draft():
    data = (AUDIT / 'veo-3.1-fast-generate-001-poll-1792279452-1.mp4').read_bytes()
    width, height, fps = mp4_video_geometry(data)
    output = VideoOutput('video/mp4', data, sha256(data).hexdigest(),
                         mp4_duration_seconds(data), width, height, fps)
    asset_id = str(uuid4())
    draft = generated_storage_plan(result((output,)), BUCKET, USER,
                                   (asset_id,))[0]
    assert draft.asset_id == asset_id and draft.role == 'generated_video'
    assert draft.metadata['widthPixels'] == 1280 and draft.metadata['frameRate'] == 24
    assert draft.lineage['origin'] == 'google'
    assert draft.upload.endpoint.endswith('uploadType=multipart&ifGenerationMatch=0')
    assert draft.upload.expected.sha256 == output.sha256


def test_real_tts_preserves_pcm_and_creates_lineaged_wav_draft():
    data = (AUDIT / 'gemini-2.5-flash-tts-1.pcm').read_bytes()
    output = VoiceoverOutput('audio/L16;codec=pcm;rate=24000', data,
                             sha256(data).hexdigest(), 24000, 1, 2,
                             len(data) / 48000)
    ids = (str(uuid4()), str(uuid4()))
    source, wav = generated_storage_plan(result((output,)), BUCKET, USER, ids)
    assert source.role == 'generated_voice_pcm' and wav.role == 'derived_voice_wav'
    assert source.asset_id != wav.asset_id and source.sha256 != wav.sha256
    assert wav.lineage == {'origin': 'derived', 'sourceAssetId': source.asset_id,
                           'sourceSha256': source.sha256,
                           'transformId': 'pcm_l16_to_wav', 'transformVersion': 1,
                           'resultSha256': wav.sha256}
    assert wav.metadata['samplesPerChannel'] == 76103


def test_pending_result_duplicate_ids_and_wrong_count_are_rejected():
    with pytest.raises(ValueError, match='aún no'):
        generated_storage_plan(result((), 'accepted'), BUCKET, USER, ())
    data = (AUDIT / 'gemini-2.5-flash-tts-1.pcm').read_bytes()
    output = VoiceoverOutput('audio/L16;codec=pcm;rate=24000', data,
                             sha256(data).hexdigest(), 24000, 1, 2,
                             len(data) / 48000)
    one = str(uuid4())
    with pytest.raises(ValueError, match='Cantidad'):
        generated_storage_plan(result((output,)), BUCKET, USER, (one,))
    with pytest.raises(ValueError, match='repetirse'):
        generated_storage_plan(result((output,)), BUCKET, USER, (one, one))
