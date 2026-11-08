"""El subtotal de todos los planos sigue separado del máximo aprobable."""

from dataclasses import replace
from decimal import Decimal

import pytest

from app.creative_batch_pricing import batch_pricing_readiness
from app.creative_video_batch import VideoShot, prepare_video_batch


PROJECT = 'uonify-757ec8c3ab3245ffa45d'


def test_three_veo_shots_sum_each_known_generation_component():
    batch = prepare_video_batch(
        PROJECT, 'veo-3.1-generate-001', 9,
        tuple(VideoShot(f'Escena {i}') for i in range(3)))
    price = batch_pricing_readiness(batch)
    assert price.known_generation_component_usd == Decimal('4.80')
    assert len(price.components) == 3 and price.generated_seconds == 12
    assert price.complete_maximum_usd is None and not price.approval_ready
    assert 'almacenamiento y operaciones' in price.missing_for_maximum


def test_three_durable_omni_shots_sum_video_tokens_but_not_input_or_storage():
    shots = tuple(VideoShot(f'Escena {i}') for i in range(3))
    prefixes = tuple(f'gs://private-bucket/attempt-{i}/' for i in range(3))
    batch = prepare_video_batch(
        PROJECT, 'gemini-omni-1.1-flash-preview', 9, shots,
        omni_output_prefixes=prefixes)
    price = batch_pricing_readiness(batch)
    assert price.known_generation_component_usd == Decimal('0.3041325')
    assert 'tokens de entrada' in price.missing_for_maximum[0]
    assert price.complete_maximum_usd is None and not price.approval_ready


def test_changed_request_hashes_cannot_reuse_a_batch_price():
    batch = prepare_video_batch(
        PROJECT, 'veo-3.1-generate-001', 4, (VideoShot('Escena 1'),))
    with pytest.raises(ValueError, match='cambiaron'):
        batch_pricing_readiness(replace(batch, request_hashes=('0' * 64,)))
