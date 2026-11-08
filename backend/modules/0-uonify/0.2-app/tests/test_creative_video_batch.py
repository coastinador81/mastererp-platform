"""El lote captura todas las llamadas previstas, no solo un clip aislado."""

from decimal import Decimal

import pytest

from app.creative_video_batch import VideoShot, prepare_video_batch
from app.creative_video_contracts import VideoMedia


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
IMAGE = VideoMedia('image', 'image/png', b'\x89PNG\r\n\x1a\nsynthetic')


def test_nine_second_fast_batch_mixes_one_8s_and_one_4s_shot():
    shots = (VideoShot('Cubo en una mesa', (IMAGE,)),
             VideoShot('Ciudad nocturna'))
    batch = prepare_video_batch(PROJECT, 'veo-3.1-fast-generate-001', 9, shots)
    assert batch.generated_seconds == 12 and batch.trim_seconds == 3
    assert batch.veo_media_subtotal_usd == Decimal('1.20')
    assert not batch.approval_ready
    assert len(batch.requests) == len(batch.request_hashes) == 2
    changed = prepare_video_batch(PROJECT, 'veo-3.1-fast-generate-001', 9,
                                  (VideoShot('Cubo rojo en una mesa', (IMAGE,)), shots[1]))
    assert changed.batch_sha256 != batch.batch_sha256


def test_omni_batch_records_three_3s_calls_without_claiming_price_cap():
    shots = tuple(VideoShot(f'Escena {i}') for i in range(3))
    batch = prepare_video_batch(PROJECT, 'gemini-omni-1.1-flash-preview', 9, shots)
    assert batch.generated_seconds == 9 and batch.trim_seconds == 0
    assert batch.veo_media_subtotal_usd is None
    assert len(batch.request_hashes) == 3


def test_durable_omni_batch_binds_each_shot_to_a_unique_gcs_prefix():
    shots = tuple(VideoShot(f'Escena {i}') for i in range(3))
    prefixes = tuple(
        f'gs://uonify-private-media/creative/attempt-{i}/' for i in range(3))
    batch = prepare_video_batch(
        PROJECT, 'gemini-omni-1.1-flash-preview', 9, shots,
        omni_output_prefixes=prefixes)
    assert batch.generated_seconds == 9 and batch.trim_seconds == 0
    assert all(request.mode == 'text_to_video_background'
               for request in batch.requests)
    assert tuple(request.body['response_format'][0]['gcs_uri']
                 for request in batch.requests) == prefixes
    assert len(set(batch.request_hashes)) == 3


def test_durable_omni_batch_rejects_reused_prefix_or_unowned_reference():
    shots = (VideoShot('Escena 1'), VideoShot('Escena 2'))
    with pytest.raises(ValueError, match='Prefijos Omni'):
        prepare_video_batch(
            PROJECT, 'gemini-omni-1.1-flash-preview', 6, shots,
            omni_output_prefixes=('gs://private-bucket/same/',) * 2)
    with pytest.raises(ValueError, match='ownership'):
        prepare_video_batch(
            PROJECT, 'gemini-omni-1.1-flash-preview', 3,
            (VideoShot('Escena', (IMAGE,)),),
            omni_output_prefixes=('gs://private-bucket/attempt/',))


def test_underfilled_or_unsupported_batch_is_rejected():
    with pytest.raises(ValueError, match='no cubren'):
        prepare_video_batch(PROJECT, 'veo-3.1-generate-001', 9,
                            (VideoShot('Solo un plano'),))
    with pytest.raises(ValueError, match='Modelo'):
        prepare_video_batch(PROJECT, 'unknown', 9, (VideoShot('Un plano'),))
    with pytest.raises(ValueError, match='Duración'):
        prepare_video_batch(PROJECT, 'veo-3.1-generate-001', True,
                            (VideoShot('Un plano'),))
    with pytest.raises(ValueError, match='Solo se probó'):
        prepare_video_batch(PROJECT, 'veo-3.1-generate-001', 4,
                            (VideoShot('Un plano', (IMAGE,)),))
