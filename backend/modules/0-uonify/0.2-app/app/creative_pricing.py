"""Tarifas Google observadas; no son una autorización ni un tope de gasto total."""

from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
import json

from .creative_google_capabilities import ModelId
from .creative_request_fingerprint import fingerprint
from .creative_shot_allocation import shot_allocation
from .creative_video_contracts import VideoRequest


PRICING_URL = 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing'
OBSERVED_AT = '2026-10-18'
_VEO_AUDIO_720P_USD_PER_SECOND = {
    ModelId.VEO_31: Decimal('0.40'),
    ModelId.VEO_31_FAST: Decimal('0.10'),
}


@dataclass(frozen=True)
class MediaRateEstimate:
    model: str
    request_sha256: str
    amount_usd: Decimal
    rate_usd_per_second: Decimal
    seconds: int
    pricing_url: str
    observed_at: str
    scope: str = 'solo generación Veo 720p con audio, una salida'
    approval_ready: bool = False


@dataclass(frozen=True)
class VeoPlanRateEstimate:
    model: str
    requested_seconds: int
    generated_seconds: int
    shot_count: int
    request_hashes: tuple[str, ...]
    plan_requests_sha256: str
    amount_usd: Decimal
    pricing_url: str = PRICING_URL
    observed_at: str = OBSERVED_AT
    scope: str = 'solo generación Veo 720p con audio; montaje y servicios adicionales excluidos'
    approval_ready: bool = False


def veo_rate_estimate(request: VideoRequest) -> MediaRateEstimate:
    """Calcula el subtotal publicado del modo fijo; no cubre otros servicios ni impuestos.

    La página Cloud dice USD/count; la página Google Developer explicita USD/segundo.
    Antes de convertirlo en tope aprobable se debe validar SKU, pagador y costes
    auxiliares de la cuenta concreta.
    """
    if not isinstance(request, VideoRequest) or request.model not in _VEO_AUDIO_720P_USD_PER_SECOND:
        raise ValueError('La tarifa solo corresponde a Veo 3.1/Fast.')
    if request.mode == 'reference_to_video' and request.model != ModelId.VEO_31_FAST:
        raise ValueError('Solo se auditó referencia con Veo 3.1 Fast.')
    body = request.body
    params = body.get('parameters', {})
    expected_seconds = 8 if request.mode == 'reference_to_video' else 4
    expected = {'sampleCount': 1, 'durationSeconds': expected_seconds,
                'resolution': '720p', 'aspectRatio': '16:9',
                'generateAudio': True, 'personGeneration': 'disallow'}
    # A3: storageUri (destino GCS privado de la salida) es variable por petición y
    # no forma parte de los parámetros creativos auditados; se excluye de la
    # comparación de tarifa para que una petición durable se cotice igual que la
    # inline. Si viene, debe ser un prefijo gs:// válido.
    priced_params = params
    if isinstance(params, dict) and 'storageUri' in params:
        storage_uri = params['storageUri']
        if not isinstance(storage_uri, str) or not storage_uri.startswith('gs://'):
            raise ValueError('storageUri Veo no es un destino gs:// válido.')
        priced_params = {k: v for k, v in params.items() if k != 'storageUri'}
    instances = body.get('instances', [])
    # F5 (clips-only): la imagen de referencia puede declararse INLINE (`referenceImages`,
    # forma sujeto) o como PRIMER FOTOGRAMA GCS (`image.gcsUri`, veo_first_frame_request).
    # Ambas son referencia AUDITADA con la MISMA tarifa (Veo 3.1 Fast reference_to_video,
    # _VEO_AUDIO_720P_USD_PER_SECOND); solo cambia CÓMO se pasa la imagen, no el precio.
    has_reference = (isinstance(instances, list) and len(instances) == 1
                     and isinstance(instances[0], dict)
                     and (bool(instances[0].get('referenceImages'))
                          or (isinstance(instances[0].get('image'), dict)
                              and bool(instances[0]['image'].get('gcsUri')))))
    if (priced_params != expected or not isinstance(instances, list) or len(instances) != 1
            or not isinstance(instances[0], dict) or not instances[0].get('prompt')
            or request.mode not in ('text_to_video', 'reference_to_video')
            or has_reference != (request.mode == 'reference_to_video')
            or len(request.input_manifest) != (1 if has_reference else 0)
            or not request.endpoint.endswith(
                f'/models/{request.model}:predictLongRunning')):
        raise ValueError('Parámetros Veo distintos de los auditados.')
    rate = _VEO_AUDIO_720P_USD_PER_SECOND[request.model]
    return MediaRateEstimate(request.model, fingerprint(request).sha256,
                             rate * expected_seconds,
                             rate, expected_seconds, PRICING_URL, OBSERVED_AT)


def veo_plan_rate_estimate(requests: tuple[VideoRequest, ...],
                           requested_seconds: int) -> VeoPlanRateEstimate:
    """Suma clips exactos; un cambio de shot invalida la huella del subtotal."""
    if not isinstance(requests, tuple) or not requests:
        raise ValueError('Falta la lista cerrada de clips Veo.')
    first = requests[0]
    if not isinstance(first, VideoRequest):
        raise ValueError('La lista contiene una petición no válida.')
    allocation = shot_allocation(first.model, first.mode, requested_seconds)
    if len(requests) != allocation.shot_count or any(
            request.model != first.model or request.mode != first.mode
            or request.endpoint != first.endpoint for request in requests):
        raise ValueError('La lista de clips no coincide con el modo y duración.')
    estimates = tuple(veo_rate_estimate(request) for request in requests)
    hashes = tuple(estimate.request_sha256 for estimate in estimates)
    canonical = json.dumps({'model': first.model, 'mode': first.mode,
                            'requestedSeconds': requested_seconds,
                            'requests': hashes}, sort_keys=True, separators=(',', ':'))
    return VeoPlanRateEstimate(first.model, requested_seconds,
                               allocation.generated_seconds, allocation.shot_count,
                               hashes, sha256(canonical.encode()).hexdigest(),
                               sum((estimate.amount_usd for estimate in estimates), Decimal('0')))
