"""La tarifa parcial nunca se confunde con aprobación o techo total."""

from dataclasses import replace
from decimal import Decimal

import pytest

from app.creative_pricing import veo_rate_estimate
from app.creative_video_contracts import VideoMedia, omni_request, veo_request


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
IMAGE = VideoMedia('image', 'image/png', b'\x89PNG\r\n\x1a\nsynthetic')


def test_veo_audited_modes_have_published_generation_subtotal_only():
    standard = veo_rate_estimate(
        veo_request(PROJECT, 'veo-3.1-generate-001', 'Ciudad futurista'))
    fast_subject = veo_rate_estimate(
        veo_request(PROJECT, 'veo-3.1-fast-generate-001', 'Cubo azul', IMAGE))
    assert standard.amount_usd == Decimal('1.60')
    assert fast_subject.amount_usd == Decimal('0.80')
    assert len(standard.request_sha256) == 64
    assert standard.request_sha256 != fast_subject.request_sha256
    assert standard.approval_ready is False
    assert 'solo generación' in standard.scope
    assert standard.pricing_url.startswith('https://cloud.google.com/')


def test_changed_parameters_and_omni_cannot_be_quoted_as_veo():
    request = veo_request(PROJECT, 'veo-3.1-fast-generate-001', 'Ciudad futurista')
    changed = replace(request, body={**request.body, 'parameters': {
        **request.body['parameters'], 'sampleCount': 2}})
    with pytest.raises(ValueError, match='distintos'):
        veo_rate_estimate(changed)
    with pytest.raises(ValueError, match='solo corresponde'):
        veo_rate_estimate(omni_request(PROJECT, 'Ciudad futurista', ()))
