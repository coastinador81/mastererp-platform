"""Una tarifa publicada parcial nunca se convierte en aprobación de gasto."""

from decimal import Decimal

from app.creative_image_contracts import image_request
from app.creative_music_contracts import music_request
from app.creative_pricing_readiness import pricing_readiness
from app.creative_video_contracts import (omni_background_request, omni_request,
                                          veo_request)
from app.creative_voiceover_contracts import voiceover_request


PROJECT = 'uonify-757ec8c3ab3245ffa45d'


def test_known_image_outputs_still_lack_a_complete_maximum():
    expected = {'gemini-nano-banana-2.1': Decimal('0.034'),
                'gemini-3.1-flash-image': Decimal('0.067'),
                'gemini-3-pro-image': Decimal('0.134')}
    for model, amount in expected.items():
        price = pricing_readiness(image_request(PROJECT, model, 'Cubo azul'))
        assert price.known_generation_usd == amount
        assert not price.approval_ready and 'tokens de entrada' in price.missing_for_maximum[0]


def test_veo_omni_music_and_tts_report_only_their_known_component():
    veo = pricing_readiness(
        veo_request(PROJECT, 'veo-3.1-fast-generate-001', 'Ciudad futurista'))
    assert veo.known_generation_usd == Decimal('0.40')
    assert 'almacenamiento y operaciones' in veo.missing_for_maximum
    omni = pricing_readiness(omni_request(PROJECT, 'Ciudad futurista', ()))
    assert omni.known_generation_usd == Decimal('0.1013775')
    assert 'tokens de entrada' in omni.missing_for_maximum[0]
    durable = pricing_readiness(omni_background_request(
        PROJECT, 'Ciudad futurista', 'gs://private-bucket/creative/attempt/',
        duration_seconds=10, resolution='720p'))
    assert durable.known_generation_usd == Decimal('1.013600')
    assert '720p por 10 s' in durable.basis
    assert not durable.approval_ready
    music = pricing_readiness(music_request(PROJECT, 'Música instrumental'))
    assert music.known_generation_usd == Decimal('0.04')
    assert 'modelo preview' in music.missing_for_maximum[0]
    voice = pricing_readiness(voiceover_request(PROJECT, 'Hola'))
    assert voice.known_generation_usd == Decimal('0.167936')
    assert '8.192 tokens' in voice.basis and '16.384' in voice.basis
    assert 'almacenamiento y operaciones' in voice.missing_for_maximum
    assert all(not item.approval_ready for item in (veo, omni, music, voice))
