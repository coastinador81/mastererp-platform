"""Techo operativo para staging, adopción y polling Google autorizados."""

from dataclasses import asdict, dataclass
from decimal import Decimal

from .creative_composite_quote import canonical_sha256
from .creative_infrastructure_costs import InfrastructureUsageCeiling


@dataclass(frozen=True)
class GoogleDurableWorkflowCeiling:
    output_count: int
    artifact_count: int
    output_bytes: int
    manifest_bytes: int
    retention_days: int
    poll_requests: int
    reconciliation_reads: int
    cleanup_operations: int


@dataclass(frozen=True)
class GoogleDurableUsageEnvelope:
    snapshot: dict
    sha256: str
    infrastructure: InfrastructureUsageCeiling


def google_durable_usage_ceiling(
        ceiling: GoogleDurableWorkflowCeiling) -> GoogleDurableUsageEnvelope:
    if (not isinstance(ceiling, GoogleDurableWorkflowCeiling)
            or any(not isinstance(value, int) or isinstance(value, bool)
                   for value in asdict(ceiling).values())
            or not 1 <= ceiling.output_count <= 64
            or not ceiling.output_count <= ceiling.artifact_count <= 128
            or not 1 <= ceiling.output_bytes <= 10 * 1024 ** 3
            or not 1 <= ceiling.manifest_bytes <= 4 * 1024 ** 2
            or not 1 <= ceiling.retention_days <= 30
            or not 0 <= ceiling.poll_requests <= 10_000
            or not 0 <= ceiling.reconciliation_reads <= 512
            or not 0 <= ceiling.cleanup_operations <= 512):
        raise ValueError("Techo durable Google no válido.")
    # Peor caso: todos los bytes conviven en staging y destino canónico.
    stored_bytes = ceiling.output_bytes * 2 + ceiling.manifest_bytes
    if stored_bytes > 20 * 1024 ** 3:
        raise ValueError("Techo durable Google no válido.")
    # Create staging + manifest + rewrite final + limpieza. Cada mutación queda
    # explícita aunque el precio vigente agrupe varias en la misma clase.
    class_a = (ceiling.artifact_count * 2 + 1
               + ceiling.cleanup_operations)
    # Readiness/metadata de cada staging y destino, más reconciliaciones.
    class_b = ceiling.artifact_count * 2 + ceiling.reconciliation_reads
    infrastructure = InfrastructureUsageCeiling(
        stored_bytes=stored_bytes,
        retention_days=ceiling.retention_days,
        class_a_operations=class_a,
        class_b_operations=class_b,
        transfer_bytes=ceiling.output_bytes,
        transcoder_hd_output_seconds=0,
        craft_compute_max_usd=Decimal("0.00"))
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_durable_usage_ceiling",
        "outputCount": ceiling.output_count,
        "artifactCount": ceiling.artifact_count,
        "outputBytes": ceiling.output_bytes,
        "manifestBytes": ceiling.manifest_bytes,
        "retentionDays": ceiling.retention_days,
        "pollRequests": ceiling.poll_requests,
        "reconciliationReads": ceiling.reconciliation_reads,
        "cleanupOperations": ceiling.cleanup_operations,
        "infrastructure": {
            "storedBytes": infrastructure.stored_bytes,
            "retentionDays": infrastructure.retention_days,
            "classAOperations": infrastructure.class_a_operations,
            "classBOperations": infrastructure.class_b_operations,
            "transferBytes": infrastructure.transfer_bytes,
            "transcoderHdOutputSeconds": 0,
            "craftComputeMaxUsd": "0.00",
        },
    }
    return GoogleDurableUsageEnvelope(
        snapshot, canonical_sha256(snapshot), infrastructure)
