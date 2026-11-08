"""Techos operativos conservadores para una ejecución creativa exacta.

Recibe una tarifa verificada por servidor; no consulta precios ni factura. Cada
importe positivo se redondea hacia arriba al céntimo para no aprobar por debajo
del peor caso calculado.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_CEILING
from uuid import NAMESPACE_URL, uuid5

from .creative_composite_quote import (CostCeiling, HASH,
                                       execution_binding_sha256,
                                       ExecutionBinding, canonical_sha256)


GIB = Decimal(1024 ** 3)
THOUSAND = Decimal(1000)
MONTH_DAYS = Decimal(30)
CENT = Decimal('0.01')
STORAGE_PRICING_URL = 'https://cloud.google.com/storage/pricing'
TRANSCODER_PRICING_URL = 'https://cloud.google.com/transcoder/pricing'


@dataclass(frozen=True)
class InfrastructureUsageCeiling:
    stored_bytes: int
    retention_days: int
    class_a_operations: int
    class_b_operations: int
    transfer_bytes: int
    transcoder_hd_output_seconds: int
    craft_compute_max_usd: Decimal


@dataclass(frozen=True)
class InfrastructureRateSnapshot:
    location: str
    storage_gib_month_usd: Decimal
    class_a_per_1000_usd: Decimal
    class_b_per_1000_usd: Decimal
    transfer_gib_usd: Decimal
    transcoder_hd_minute_usd: Decimal
    storage_evidence_sha256: str
    transcoder_evidence_sha256: str
    craft_evidence_sha256: str
    checked_at: datetime
    expires_at: datetime


def _decimal(value: object, label: str) -> Decimal:
    if (not isinstance(value, Decimal) or not value.is_finite() or value < 0
            or value.as_tuple().exponent < -9):
        raise ValueError(f'{label} no es una tarifa verificable.')
    return value


def _cent(value: Decimal) -> Decimal:
    if value == 0:
        return Decimal('0.00')
    return value.quantize(CENT, rounding=ROUND_CEILING)


def _validate(binding: ExecutionBinding, usage: InfrastructureUsageCeiling,
              rates: InfrastructureRateSnapshot, now: datetime) -> str:
    binding_sha = execution_binding_sha256(binding)
    if (not isinstance(usage, InfrastructureUsageCeiling)
            or any(not isinstance(value, int) or isinstance(value, bool) or value < 0
                   for value in (usage.stored_bytes, usage.class_a_operations,
                                 usage.class_b_operations, usage.transfer_bytes,
                                 usage.transcoder_hd_output_seconds))
            or not 1 <= usage.retention_days <= 365
            or usage.stored_bytes > 20 * 1024 ** 3
            or usage.transfer_bytes > 20 * 1024 ** 3
            or usage.transcoder_hd_output_seconds > 3600):
        raise ValueError('El peor caso de infraestructura no es válido.')
    _decimal(usage.craft_compute_max_usd, 'El render Craft')
    if (not isinstance(rates, InfrastructureRateSnapshot)
            or not rates.location or len(rates.location) > 80
            or any(not HASH.fullmatch(value) for value in (
                rates.storage_evidence_sha256, rates.transcoder_evidence_sha256,
                rates.craft_evidence_sha256))
            or not rates.checked_at.tzinfo or not rates.expires_at.tzinfo
            or not now.tzinfo or rates.checked_at > now
            or now - rates.checked_at > timedelta(days=1)
            or rates.expires_at <= now
            or rates.expires_at > now + timedelta(days=1)):
        raise ValueError('La tarifa de infraestructura no está vigente.')
    for label, value in (
            ('Storage', rates.storage_gib_month_usd),
            ('Operación Class A', rates.class_a_per_1000_usd),
            ('Operación Class B', rates.class_b_per_1000_usd),
            ('Transferencia', rates.transfer_gib_usd),
            ('Transcoder', rates.transcoder_hd_minute_usd)):
        _decimal(value, label)
    return binding_sha


def infrastructure_cost_ceilings(
        binding: ExecutionBinding, usage: InfrastructureUsageCeiling,
        rates: InfrastructureRateSnapshot, *, now: datetime
        ) -> tuple[CostCeiling, ...]:
    """Calcula líneas exactas; no añade generación ni autoriza ejecución."""
    binding_sha = _validate(binding, usage, rates, now)
    storage_raw = (
        Decimal(usage.stored_bytes) / GIB
        * Decimal(usage.retention_days) / MONTH_DAYS
        * rates.storage_gib_month_usd
        + Decimal(usage.class_a_operations) / THOUSAND
        * rates.class_a_per_1000_usd
        + Decimal(usage.class_b_operations) / THOUSAND
        * rates.class_b_per_1000_usd)
    transfer_raw = Decimal(usage.transfer_bytes) / GIB * rates.transfer_gib_usd
    transcoder_raw = (Decimal(usage.transcoder_hd_output_seconds) / Decimal(60)
                      * rates.transcoder_hd_minute_usd)
    usage_payload = asdict(usage)
    usage_payload['craft_compute_max_usd'] = str(usage.craft_compute_max_usd)

    def line(component: str, service: str, payer: str, amount: Decimal,
             rate_evidence: str) -> CostCeiling:
        evidence = canonical_sha256({
            'schemaVersion': 1, 'bindingSha256': binding_sha,
            'service': service, 'location': rates.location,
            'usage': usage_payload, 'rateEvidenceSha256': rate_evidence,
            'checkedAt': rates.checked_at.isoformat(),
            'pricingUrl': (TRANSCODER_PRICING_URL if service == 'google_transcoder'
                           else STORAGE_PRICING_URL if service != 'craft_render'
                           else None),
        })
        cost_id = str(uuid5(NAMESPACE_URL, f'uonify:{binding_sha}:{service}'))
        return CostCeiling(cost_id, component, service, payer, _cent(amount),
                           binding_sha, evidence, rates.checked_at, rates.expires_at)

    return (
        line('storage', 'google_cloud_storage', 'customer_google_project',
             storage_raw, rates.storage_evidence_sha256),
        line('processing', 'google_transcoder', 'customer_google_project',
             transcoder_raw, rates.transcoder_evidence_sha256),
        line('processing', 'craft_render', 'uonify_platform',
             usage.craft_compute_max_usd, rates.craft_evidence_sha256),
        line('transfer', 'google_cloud_transfer', 'customer_google_project',
             transfer_raw, rates.storage_evidence_sha256),
    )
