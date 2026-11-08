"""Un vídeo largo exige varias llamadas cuyo total debe entrar en el presupuesto."""

from dataclasses import replace
from decimal import Decimal

import pytest

from app.creative_pricing import veo_plan_rate_estimate
from app.creative_shot_allocation import shot_allocation
from app.creative_video_contracts import VideoMedia, veo_request


PROJECT = 'uonify-757ec8c3ab3245ffa45d'


def test_nine_seconds_requires_multiple_model_outputs():
    omni = shot_allocation('gemini-omni-1.1-flash-preview', 'text_to_video', 9)
    assert (omni.shot_count, omni.generated_seconds, omni.trim_seconds) == (3, 9, 0)
    veo = shot_allocation('veo-3.1-generate-001', 'text_to_video', 9)
    assert (veo.shot_count, veo.generated_seconds, veo.trim_seconds) == (3, 12, 3)
    fast = shot_allocation('veo-3.1-fast-generate-001', 'text_to_video', 9)
    assert (fast.shot_count, fast.generated_seconds, fast.trim_seconds) == (3, 12, 3)
    reference = shot_allocation('veo-3.1-fast-generate-001',
                                'reference_to_video', 9)
    assert (reference.shot_count, reference.generated_seconds,
            reference.trim_seconds) == (2, 16, 7)


def test_veo_plan_subtotal_counts_each_exact_request():
    requests = tuple(veo_request(PROJECT, 'veo-3.1-generate-001', f'Escena {i}')
                     for i in range(3))
    quote = veo_plan_rate_estimate(requests, 9)
    assert quote.shot_count == 3 and quote.generated_seconds == 12
    assert quote.amount_usd == Decimal('4.80')
    assert not quote.approval_ready
    assert len(set(quote.request_hashes)) == 3
    modified = (requests[0], replace(requests[1], body={
        **requests[1].body, 'instances': [{'prompt': 'Otra escena'}]}), requests[2])
    assert veo_plan_rate_estimate(modified, 9).plan_requests_sha256 != quote.plan_requests_sha256
    with pytest.raises(ValueError, match='lista de clips'):
        veo_plan_rate_estimate(requests[:2], 9)


def test_fast_reference_two_clips_are_not_priced_as_one():
    image = VideoMedia('image', 'image/png', b'\x89PNG\r\n\x1a\nsynthetic')
    requests = tuple(veo_request(PROJECT, 'veo-3.1-fast-generate-001',
                                 f'Escena {i}', image) for i in range(2))
    quote = veo_plan_rate_estimate(requests, 9)
    assert quote.amount_usd == Decimal('1.60')
    assert quote.shot_count == 2 and quote.generated_seconds == 16


def test_unknown_duration_or_mode_is_not_silently_assumed():
    with pytest.raises(ValueError, match='no comprobada'):
        shot_allocation('gemini-omni-1.1-flash-preview', 'edit', 9)
    with pytest.raises(ValueError, match='fuera'):
        shot_allocation('veo-3.1-generate-001', 'text_to_video', 121)
    with pytest.raises(ValueError, match='fuera'):
        shot_allocation('veo-3.1-generate-001', 'text_to_video', True)
