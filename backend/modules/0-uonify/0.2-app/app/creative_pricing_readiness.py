"""Costes publicados conocidos y brechas antes de emitir un máximo aprobable.

Una observación parcial nunca construye CompleteCost ni abre el ledger. Las
tarifas se revisaron en documentación oficial de Google el 18-10-2026.
"""

from dataclasses import dataclass
from decimal import Decimal
import re

from .creative_cloud_tts_contracts import CloudTtsRequest
from .creative_google_capabilities import ModelId
from .creative_image_contracts import ImageRequest
from .creative_music_contracts import MusicRequest
from .creative_pricing import PRICING_URL, veo_rate_estimate
from .creative_video_contracts import VideoRequest
from .creative_voiceover_contracts import VoiceoverRequest


OBSERVED_AT = '2026-10-18'
TTS_PRICING_URL = 'https://cloud.google.com/text-to-speech/pricing'
TTS_LIMITS_URL = 'https://docs.cloud.google.com/text-to-speech/docs/gemini-tts'
_IMAGE_1K_OUTPUT_USD = {
    ModelId.NANO_BANANA_21: Decimal('0.034'),
    ModelId.FLASH_IMAGE: Decimal('0.067'),
    ModelId.PRO_IMAGE: Decimal('0.134'),
}
_OMNI_VIDEO_TOKENS_PER_SECOND = {
    '360p': 1931,
    '720p': 5792,
    '1080p': 8688,
    '4k': 17376,
}
_TTS_MAX_INPUT_TOKENS = 8192
_TTS_MAX_OUTPUT_TOKENS = 16384
_TTS_INPUT_USD_PER_MILLION = Decimal('0.50')
_TTS_OUTPUT_USD_PER_MILLION = Decimal('10.00')
_CHIRP_USD_PER_MILLION_CHARACTERS = Decimal('30.00')


@dataclass(frozen=True)
class PricingReadiness:
    model: str
    known_generation_usd: Decimal | None
    basis: str
    pricing_url: str
    observed_at: str
    missing_for_maximum: tuple[str, ...]
    approval_ready: bool = False


def pricing_readiness(request) -> PricingReadiness:
    common = ('SKU y moneda efectivos de la cuenta',
              'almacenamiento y operaciones', 'procesamiento/render',
              'transferencia aplicable')
    if isinstance(request, CloudTtsRequest):
        characters = len(request.script.encode('utf-8'))
        maximum = (Decimal(characters)
                   * _CHIRP_USD_PER_MILLION_CHARACTERS / Decimal(1_000_000))
        return PricingReadiness(
            request.model, maximum,
            'techo conservador por bytes UTF-8 a $30/M caracteres para Chirp 3 HD',
            TTS_PRICING_URL, OBSERVED_AT, common)
    if isinstance(request, ImageRequest):
        price = _IMAGE_1K_OUTPUT_USD.get(request.model)
        if price is None:
            raise ValueError('Modelo de imagen sin tarifa observada.')
        return PricingReadiness(request.model, price,
            'salida aproximada de una imagen 1K; input y razonamiento excluidos',
            PRICING_URL, OBSERVED_AT,
            ('tokens de entrada y texto/razonamiento de salida', *common))
    if isinstance(request, VideoRequest) and request.model.startswith('veo-'):
        estimate = veo_rate_estimate(request)
        return PricingReadiness(request.model, estimate.amount_usd,
            'subtotal publicado para los segundos/resolución/audio auditados',
            estimate.pricing_url, estimate.observed_at, common)
    if isinstance(request, VideoRequest):
        output = request.body.get('response_format', [{}])[0]
        resolution = output.get('resolution')
        duration = output.get('duration')
        matched = re.fullmatch(r'([3-9]|10)s', duration or '')
        if (request.model != ModelId.OMNI_11
                or resolution not in _OMNI_VIDEO_TOKENS_PER_SECOND
                or matched is None):
            raise ValueError('Modo Omni sin tarifa observada cerrada.')
        seconds = int(matched.group(1))
        video_tokens = _OMNI_VIDEO_TOKENS_PER_SECOND[resolution] * seconds
        known = Decimal(video_tokens) * Decimal('17.50') / Decimal(1_000_000)
        return PricingReadiness(request.model, known,
            f'solo tokens publicados de vídeo {resolution} por {seconds} s; '
            'input y razonamiento excluidos',
            PRICING_URL, OBSERVED_AT,
            ('tokens de entrada y texto/razonamiento de salida', *common))
    if isinstance(request, MusicRequest):
        return PricingReadiness(request.model, Decimal('0.04'),
            'precio publicado de un clip Lyria 3 de 30 s; modelo preview pendiente de SKU',
            PRICING_URL, OBSERVED_AT,
            ('correspondencia SKU del modelo preview', *common))
    if isinstance(request, VoiceoverRequest):
        maximum = (
            Decimal(_TTS_MAX_INPUT_TOKENS) * _TTS_INPUT_USD_PER_MILLION
            + Decimal(_TTS_MAX_OUTPUT_TOKENS) * _TTS_OUTPUT_USD_PER_MILLION
        ) / Decimal(1_000_000)
        return PricingReadiness(request.model, maximum,
            'techo conservador por los límites oficiales de 8.192 tokens de '
            'entrada y 16.384 de audio; $0,50/M input y $10/M output',
            TTS_PRICING_URL, OBSERVED_AT,
            common)
    raise ValueError('Petición sin preparación de precio.')
