"""Grafo durable canónico para una cotización compuesta ya aprobada.

Solo describe pasos y dependencias. No persiste, reclama leases, llama
proveedores, adopta assets ni autoriza publicar.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import json
from uuid import NAMESPACE_URL, UUID, uuid5

from .creative_composite_quote import (CompositeQuoteReadiness, HASH,
                                       canonical_sha256)


@dataclass(frozen=True)
class ExecutionApprovalBinding:
    approval_id: str
    quote_sha256: str
    binding_sha256: str
    costs_snapshot_sha256: str
    max_total_usd: str
    approved_at: datetime


@dataclass(frozen=True)
class ExecutionStepSpec:
    step_id: str
    ordinal: int
    kind: str
    unit_id: str
    request_operation_id: str | None
    authority_sha256: str
    depends_on: tuple[str, ...]
    provider_call: bool
    replay_after_start: bool = False


@dataclass(frozen=True)
class CreativeExecutionGraph:
    schema_version: int
    approval_id: str
    quote_sha256: str
    binding_sha256: str
    costs_snapshot_sha256: str
    steps: tuple[ExecutionStepSpec, ...]
    execution_graph_sha256: str
    ready_for_persistence: bool = True
    execution_authorized: bool = False
    publication_authorized: bool = False


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(value))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    if parsed != value:
        raise ValueError(f'{label} no es UUID canónico.')
    return parsed


def _approval(value: ExecutionApprovalBinding, quote: dict,
              readiness: CompositeQuoteReadiness) -> str:
    if not isinstance(value, ExecutionApprovalBinding):
        raise ValueError('Falta la aprobación durable exacta.')
    approval_id = _uuid(value.approval_id, 'approvalId')
    try:
        quote_expires_at = datetime.fromisoformat(quote.get('expiresAt', ''))
    except (TypeError, ValueError):
        raise ValueError('La aprobación no liga la cotización exacta.') from None
    if (not HASH.fullmatch(value.quote_sha256)
            or not HASH.fullmatch(value.binding_sha256)
            or not HASH.fullmatch(value.costs_snapshot_sha256)
            or value.quote_sha256 != readiness.quote_sha256
            or value.binding_sha256 != readiness.binding_sha256
            or value.costs_snapshot_sha256 != readiness.costs_snapshot_sha256
            or value.max_total_usd != readiness.max_total_usd
            or not value.approved_at.tzinfo
            or not quote_expires_at.tzinfo
            or value.approved_at >= quote_expires_at
            or quote.get('expiresAt') != readiness.expires_at):
        raise ValueError('La aprobación no liga la cotización exacta.')
    try:
        amount = Decimal(value.max_total_usd)
    except Exception:
        raise ValueError('El máximo aprobado no es válido.') from None
    if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
        raise ValueError('El máximo aprobado no es válido.')
    return approval_id


def _step_id(approval_id: str, kind: str, identity: str) -> str:
    return str(uuid5(NAMESPACE_URL, f'uonify:{approval_id}:{kind}:{identity}'))


def _build_execution_graph(readiness: CompositeQuoteReadiness,
                           approval: ExecutionApprovalBinding, *,
                           candidate_lifecycle: bool
                           ) -> CreativeExecutionGraph:
    """Crea un grafo cerrado; el admission gate productivo permanece fuera."""
    if (not isinstance(readiness, CompositeQuoteReadiness) or not readiness.complete
            or readiness.approval_ready or readiness.execution_authorized
            or not readiness.quote_snapshot_json or not readiness.quote_sha256):
        raise ValueError('La cotización compuesta no está cerrada.')
    try:
        quote = json.loads(readiness.quote_snapshot_json)
    except (TypeError, json.JSONDecodeError):
        raise ValueError('El snapshot de cotización no es JSON canónico.') from None
    if (canonical_sha256(quote) != readiness.quote_sha256
            or quote.get('bindingSha256') != readiness.binding_sha256
            or quote.get('costsSnapshotSha256') != readiness.costs_snapshot_sha256):
        raise ValueError('El snapshot de cotización cambió.')
    approval_id = _approval(approval, quote, readiness)
    execution = quote.get('execution')
    operations = execution.get('requestOperations') if isinstance(execution, dict) else None
    if not isinstance(operations, list) or not operations:
        raise ValueError('La cotización no contiene operaciones ejecutables.')
    steps: list[ExecutionStepSpec] = []
    storage_steps = []

    def append(kind: str, unit_id: str, identity: str,
               operation_id: str | None, depends_on: tuple[str, ...],
               provider_call: bool, authority: dict) -> str:
        step_id = _step_id(approval_id, kind, identity)
        steps.append(ExecutionStepSpec(
            step_id, len(steps) + 1, kind, unit_id, operation_id,
            canonical_sha256(authority), depends_on, provider_call))
        return step_id

    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError('Operación de ejecución no válida.')
        operation_id = _uuid(operation.get('operationId'), 'operationId')
        unit_id, request_sha = operation.get('unitId'), operation.get('requestSha256')
        if (not isinstance(unit_id, str) or not unit_id
                or not isinstance(request_sha, str) or not HASH.fullmatch(request_sha)):
            raise ValueError('Operación de ejecución no válida.')
        generation_id = append(
            'google_generation', unit_id, operation_id, operation_id, (), True,
            {'quoteSha256': readiness.quote_sha256,
             'operationId': operation_id, 'requestSha256': request_sha})
        storage_id = append(
            # storage_adopt es INTERNO (poll+GCS-adopt, no POST) → provider_call=False:
            # lo exigen complete_internal_step (coordinator:874) y assert_lease (step vs claim,
            # diario deriva False). Fix de seguridad del montaje, coherente con el árbol vivo y
            # con el builder clips-only. Inerte; sin migración.
            'storage_adopt', unit_id, operation_id, operation_id,
            (generation_id,), False,
            {'bindingSha256': readiness.binding_sha256,
             'operationId': operation_id, 'requestSha256': request_sha,
             'generationStepId': generation_id})
        storage_steps.append(storage_id)
    craft_id = append(
        'craft', 'master', readiness.binding_sha256, None, tuple(storage_steps),
        True, {'bindingSha256': readiness.binding_sha256,
                'editRecipeSha256': execution.get('editRecipeSha256'),
                'inputManifestSha256': execution.get('inputManifestSha256'),
                'costsSnapshotSha256': readiness.costs_snapshot_sha256})
    review_dependency = craft_id
    if candidate_lifecycle:
        append(
            'candidate_adopt', 'master', readiness.binding_sha256, None,
            (craft_id,), True,
            {'bindingSha256': readiness.binding_sha256,
             'craftStepId': craft_id,
             'editRecipeSha256': execution.get('editRecipeSha256'),
             'inputManifestSha256': execution.get('inputManifestSha256')})
    else:
        append('review', 'master', readiness.quote_sha256, None,
               (review_dependency,), False,
               {'quoteSha256': readiness.quote_sha256, 'craftStepId': craft_id})
    schema_version = 2 if candidate_lifecycle else 1
    body = {
        'schemaVersion': schema_version, 'approvalId': approval_id,
        'quoteSha256': readiness.quote_sha256,
        'bindingSha256': readiness.binding_sha256,
        'costsSnapshotSha256': readiness.costs_snapshot_sha256,
        'steps': [
            {'stepId': item.step_id, 'ordinal': item.ordinal, 'kind': item.kind,
             'unitId': item.unit_id,
             'requestOperationId': item.request_operation_id,
             'authoritySha256': item.authority_sha256,
             'dependsOn': item.depends_on, 'providerCall': item.provider_call,
             'replayAfterStart': item.replay_after_start}
            for item in steps],
    }
    return CreativeExecutionGraph(
        schema_version, approval_id, readiness.quote_sha256, readiness.binding_sha256,
        readiness.costs_snapshot_sha256, tuple(steps), canonical_sha256(body))


def build_execution_graph(readiness: CompositeQuoteReadiness,
                          approval: ExecutionApprovalBinding
                          ) -> CreativeExecutionGraph:
    """Conserva el grafo v1 ya persistido y sus hashes históricos."""
    return _build_execution_graph(
        readiness, approval, candidate_lifecycle=False)


def build_candidate_execution_graph(
        readiness: CompositeQuoteReadiness,
        approval: ExecutionApprovalBinding) -> CreativeExecutionGraph:
    """Grafo v2 con adopción privada posterior al resultado Craft."""
    return _build_execution_graph(
        readiness, approval, candidate_lifecycle=True)


def build_clips_only_execution_graph(
        readiness: CompositeQuoteReadiness,
        approval: ExecutionApprovalBinding) -> CreativeExecutionGraph:
    """Grafo CLIPS-ONLY: por cada operación, `google_generation` (proveedor) →
    `storage_adopt` (INTERNO). SIN montaje (`craft`) ni `review`/`candidate_adopt`: el clip
    adoptado (089) es el entregable directo.

    `storage_adopt` se emite con provider_call=**False** de forma OBLIGATORIA (veredicto
    Consultor §A, 26-10): `complete_internal_step` lanza si el paso es de proveedor
    (coordinator:874) y `assert_lease` exige `step_provider_call == claim.provider_call`
    (:673, y el diario deriva False para storage_adopt). Además, siendo interno, los
    checkpoints de proveedor no pueden correr sobre él por contrato → `provider_returned_at`
    es SIEMPRE None → la recuperación re-encola y nunca promueve un éxito hueco. Es correcto:
    el gasto facturable fue el paso `google_generation`; la adopción es poll+GCS-adopt (no un
    POST). Reusa los helpers y el MISMO body/hash por paso que `_build_execution_graph`, para
    que `hold_execution_graph`/`_graph_snapshot` lo validen igual. Grafo distinto del de
    montaje (este no tiene craft/review). Desde el fix de seguridad 27-10 ambos builders emiten
    storage_adopt con provider_call=False; el builder de montaje no se toca dentro de esta función."""
    if (not isinstance(readiness, CompositeQuoteReadiness) or not readiness.complete
            or readiness.approval_ready or readiness.execution_authorized
            or not readiness.quote_snapshot_json or not readiness.quote_sha256):
        raise ValueError('La cotización compuesta no está cerrada.')
    try:
        quote = json.loads(readiness.quote_snapshot_json)
    except (TypeError, json.JSONDecodeError):
        raise ValueError('El snapshot de cotización no es JSON canónico.') from None
    if (canonical_sha256(quote) != readiness.quote_sha256
            or quote.get('bindingSha256') != readiness.binding_sha256
            or quote.get('costsSnapshotSha256') != readiness.costs_snapshot_sha256):
        raise ValueError('El snapshot de cotización cambió.')
    approval_id = _approval(approval, quote, readiness)
    execution = quote.get('execution')
    operations = execution.get('requestOperations') if isinstance(execution, dict) else None
    if not isinstance(operations, list) or not operations:
        raise ValueError('La cotización no contiene operaciones ejecutables.')
    steps: list[ExecutionStepSpec] = []

    def append(kind: str, unit_id: str, identity: str, operation_id: str | None,
               depends_on: tuple[str, ...], provider_call: bool, authority: dict) -> str:
        step_id = _step_id(approval_id, kind, identity)
        steps.append(ExecutionStepSpec(
            step_id, len(steps) + 1, kind, unit_id, operation_id,
            canonical_sha256(authority), depends_on, provider_call))
        return step_id

    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError('Operación de ejecución no válida.')
        operation_id = _uuid(operation.get('operationId'), 'operationId')
        unit_id, request_sha = operation.get('unitId'), operation.get('requestSha256')
        if (not isinstance(unit_id, str) or not unit_id
                or not isinstance(request_sha, str) or not HASH.fullmatch(request_sha)):
            raise ValueError('Operación de ejecución no válida.')
        generation_id = append(
            'google_generation', unit_id, operation_id, operation_id, (), True,
            {'quoteSha256': readiness.quote_sha256,
             'operationId': operation_id, 'requestSha256': request_sha})
        append(
            'storage_adopt', unit_id, operation_id, operation_id,
            (generation_id,), False,
            {'bindingSha256': readiness.binding_sha256,
             'operationId': operation_id, 'requestSha256': request_sha,
             'generationStepId': generation_id})
    body = {
        'schemaVersion': 1, 'approvalId': approval_id,
        'quoteSha256': readiness.quote_sha256,
        'bindingSha256': readiness.binding_sha256,
        'costsSnapshotSha256': readiness.costs_snapshot_sha256,
        'steps': [
            {'stepId': item.step_id, 'ordinal': item.ordinal, 'kind': item.kind,
             'unitId': item.unit_id,
             'requestOperationId': item.request_operation_id,
             'authoritySha256': item.authority_sha256,
             'dependsOn': item.depends_on, 'providerCall': item.provider_call,
             'replayAfterStart': item.replay_after_start}
            for item in steps],
    }
    return CreativeExecutionGraph(
        1, approval_id, readiness.quote_sha256, readiness.binding_sha256,
        readiness.costs_snapshot_sha256, tuple(steps), canonical_sha256(body))
