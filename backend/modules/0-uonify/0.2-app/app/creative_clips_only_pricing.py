"""Ensamblaje de los CostCeiling de un CLIP simple (clips-only, motor 090) — staged + inerte.

El quote compuesto (composite_quote_readiness) solo cierra un máximo COMPLETO si los cuatro componentes
—generation, storage, processing, transfer— tienen evidencia de coste vigente. Este módulo COMPONE los
constructores YA existentes y aprobados (no reimplanta tarifas ni evidencia):
  * generación: `google_generation_cost_ceiling` (1 línea = la única operación video_generation del clip);
  * infraestructura: `infrastructure_cost_ceilings` (storage + 2×processing [transcoder + craft] + transfer),
    sobre un `InfrastructureUsageCeiling` derivado del envelope de uso durable de UN clip
    (`google_durable_usage_ceiling`).

Los RATE SNAPSHOTS (GoogleGenerationRateSnapshot + InfrastructureRateSnapshot, con su evidencia + frescura)
se INYECTAN (puerto): su DISEÑO es un input verificado en runtime (frescura ≤1 día + evidence_sha256), NO
una constante; quién los provee/verifica (operador/Consultor) es decisión aparte. Aquí solo se ensamblan.

Función PURA: sin red, sin DB. No aprueba, no reserva, no despacha (cada CostCeiling nace con su evidencia;
la aprobación del gasto es un acto posterior y separado del cliente). El clip es SIN montaje → craft=0 y
transcoder=0 (Veo entrega el MP4 directo a GCS); las líneas existen a 0,00 para que el componente
'processing' esté presente (no 'missing') aunque su coste sea nulo.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from .creative_composite_quote import CostCeiling, ExecutionBinding
from .creative_google_durable_usage import (GoogleDurableWorkflowCeiling,
                                            google_durable_usage_ceiling)
from .creative_google_generation_costs import (GoogleGenerationRateSnapshot,
                                              google_generation_cost_ceiling)
from .creative_infrastructure_costs import (InfrastructureRateSnapshot,
                                           InfrastructureUsageCeiling,
                                           infrastructure_cost_ceilings)


class ClipsOnlyPricingError(Exception):
    """El binding del clip o el envelope de uso no permiten cerrar el presupuesto."""


# Envelope de uso CONSERVADOR de un clip 8 s 720p (topes MÁX, no estimaciones). Son el input de
# `google_durable_usage_ceiling`, que valida sus rangos y deriva el InfrastructureUsageCeiling.
# Tunables sin tocar código (el route puede sobrescribirlos); los guardianes/dueño validan el tope.
_CLIP_OUTPUT_BYTES = 64 * 1024 * 1024      # ≤64 MiB para un MP4 de 8 s 720p con audio (holgado).
_CLIP_ARTIFACT_COUNT = 2                    # staging del proveedor + destino canónico adoptado.
_CLIP_MANIFEST_BYTES = 64 * 1024           # recibos/manifiestos del intento.
_CLIP_RETENTION_DAYS = 7                    # retención del objeto durable en GCS §6.
_CLIP_POLL_REQUESTS = 600                   # polling del LRO de Veo (tope holgado para ~2 min).
_CLIP_RECONCILIATION_READS = 8
_CLIP_CLEANUP_OPERATIONS = 4


def clips_only_clip_usage_ceiling(
        *, output_bytes: int = _CLIP_OUTPUT_BYTES,
        retention_days: int = _CLIP_RETENTION_DAYS,
        poll_requests: int = _CLIP_POLL_REQUESTS) -> InfrastructureUsageCeiling:
    """Deriva el InfrastructureUsageCeiling de UN clip desde su envelope de uso durable.

    Reusa `google_durable_usage_ceiling` (valida rangos + calcula stored_bytes/clase A/B worst-case).
    craft_compute y transcoder quedan a 0 (clips-only no monta ni transcodifica)."""
    envelope = google_durable_usage_ceiling(GoogleDurableWorkflowCeiling(
        output_count=1,
        artifact_count=_CLIP_ARTIFACT_COUNT,
        output_bytes=output_bytes,
        manifest_bytes=_CLIP_MANIFEST_BYTES,
        retention_days=retention_days,
        poll_requests=poll_requests,
        reconciliation_reads=_CLIP_RECONCILIATION_READS,
        cleanup_operations=_CLIP_CLEANUP_OPERATIONS))
    return envelope.infrastructure


def clips_only_cost_ceilings(
        binding: ExecutionBinding, request, usage: InfrastructureUsageCeiling, *,
        generation_rates: GoogleGenerationRateSnapshot,
        infrastructure_rates: InfrastructureRateSnapshot,
        now: datetime) -> tuple[CostCeiling, ...]:
    """Ensambla los CostCeiling de los 4 componentes para el binding del clip.

    `binding` DEBE tener EXACTAMENTE una operación (clips-only = 1 video_generation); `request` es la
    `VideoRequest` de esa operación (la que el director compiló). Devuelve
    (generación, storage, processing×2, transfer); `composite_quote_readiness(binding, ceilings)` cierra
    el máximo completo con ellos.
    """
    if (not isinstance(binding, ExecutionBinding)
            or len(binding.request_operations) != 1):
        raise ClipsOnlyPricingError(
            'El binding clips-only debe tener exactamente una operación de generación.')
    operation_id = binding.request_operations[0].operation_id
    generation = google_generation_cost_ceiling(
        binding, operation_id, request, generation_rates, now=now)
    infrastructure = infrastructure_cost_ceilings(
        binding, usage, infrastructure_rates, now=now)
    return (generation, *infrastructure)
