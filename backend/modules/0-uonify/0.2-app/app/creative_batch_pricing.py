"""Agrega el componente conocido de generación de un lote, nunca un máximo."""

from dataclasses import dataclass
from decimal import Decimal

from .creative_pricing_readiness import PricingReadiness, pricing_readiness
from .creative_request_fingerprint import fingerprint
from .creative_video_batch import VideoBatch


@dataclass(frozen=True)
class BatchPriceComponent:
    request_sha256: str
    model: str
    known_generation_usd: Decimal
    basis: str


@dataclass(frozen=True)
class BatchPricingReadiness:
    batch_sha256: str
    currency: str
    generated_seconds: int
    components: tuple[BatchPriceComponent, ...]
    known_generation_component_usd: Decimal
    complete_maximum_usd: Decimal | None
    missing_for_maximum: tuple[str, ...]
    approval_ready: bool = False


def batch_pricing_readiness(batch: VideoBatch) -> BatchPricingReadiness:
    if not isinstance(batch, VideoBatch) or not batch.requests:
        raise ValueError('Lote de vídeo no válido.')
    hashes = tuple(fingerprint(request).sha256 for request in batch.requests)
    if hashes != batch.request_hashes:
        raise ValueError('Las peticiones del lote cambiaron después de cerrarse.')
    readiness: tuple[PricingReadiness, ...] = tuple(
        pricing_readiness(request) for request in batch.requests)
    if any(item.known_generation_usd is None for item in readiness):
        raise ValueError('El lote contiene un componente de generación sin tarifa.')
    components = tuple(BatchPriceComponent(
        request_hash, item.model, item.known_generation_usd, item.basis)
        for request_hash, item in zip(hashes, readiness))
    missing = tuple(dict.fromkeys(
        value for item in readiness for value in item.missing_for_maximum))
    return BatchPricingReadiness(
        batch.batch_sha256, 'USD', batch.generated_seconds, components,
        sum((item.known_generation_usd for item in readiness), Decimal('0')),
        None, missing, False)
