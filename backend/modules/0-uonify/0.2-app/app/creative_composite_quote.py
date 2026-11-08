"""Techo compuesto para una ejecución creativa exacta, sin aprobar ni reservar.

Separa pagadores y obliga a cubrir generación, almacenamiento, procesamiento y
transferencia. No persiste, no crea intentos y no llama a proveedores.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
import json
import re

from .creative_google_capabilities import ModelId
from uuid import UUID


HASH = re.compile(r'[0-9a-f]{64}\Z')
COMPONENTS = ('generation', 'storage', 'processing', 'transfer')
PAYERS = ('customer_google_project', 'uonify_platform')
OPERATION_KIND = re.compile(r'[a-z][a-z0-9_-]{0,63}\Z')
UNIT_ID = re.compile(r'[a-z][a-z0-9_-]{0,127}\Z')
GOOGLE_PROJECT = re.compile(r'[a-z][a-z0-9-]{4,61}[a-z0-9]\Z')
_CLOUD_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'


def canonical_sha256(value) -> str:
    return sha256(canonical_json(value).encode()).hexdigest()


def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False)


@dataclass(frozen=True)
class RequestOperationBinding:
    operation_id: str
    ordinal: int
    unit_id: str
    kind: str
    request_sha256: str
    model: str
    endpoint: str
    request_snapshot_json: str


@dataclass(frozen=True)
class ExecutionBinding:
    plan_id: str
    plan_revision: int
    source_plan_sha256: str
    execution_snapshot_sha256: str
    edit_recipe_sha256: str
    input_manifest_sha256: str
    request_group_sha256: str
    request_operations: tuple[RequestOperationBinding, ...]
    engine: str
    engine_version: str
    adapter_operation: str
    limits_sha256: str


@dataclass(frozen=True)
class CostCeiling:
    cost_id: str
    component: str
    service: str
    payer: str
    max_usd: Decimal
    binding_sha256: str
    evidence_sha256: str
    checked_at: datetime
    expires_at: datetime
    operation_id: str | None = None


@dataclass(frozen=True)
class CompositeQuoteReadiness:
    binding_sha256: str
    complete: bool
    components_usd: dict[str, str]
    payer_totals_usd: dict[str, str]
    max_total_usd: str | None
    missing_components: tuple[str, ...]
    expires_at: str | None
    costs_snapshot_sha256: str | None
    quote_snapshot_json: str | None
    quote_sha256: str | None
    approval_ready: bool = False
    execution_authorized: bool = False


def _binding(value: ExecutionBinding) -> dict:
    if not isinstance(value, ExecutionBinding):
        raise ValueError('Binding de ejecución no válido.')
    hashes = (value.source_plan_sha256, value.execution_snapshot_sha256,
              value.edit_recipe_sha256, value.input_manifest_sha256,
              value.request_group_sha256, value.limits_sha256)
    try:
        plan_id = str(UUID(value.plan_id))
    except (TypeError, ValueError, AttributeError):
        raise ValueError('El binding no liga todas las fuentes exactas.') from None
    if (plan_id != value.plan_id or value.plan_revision < 1
            or any(not HASH.fullmatch(item) for item in hashes)
            or not all(isinstance(item, str) and item.strip() for item in (
                value.engine, value.engine_version, value.adapter_operation))):
        raise ValueError('El binding no liga todas las fuentes exactas.')
    if not isinstance(value.request_operations, tuple) or not value.request_operations:
        raise ValueError('El binding no contiene operaciones cerradas.')
    operations = []
    seen_ids, seen_ordinals = set(), set()
    for item in value.request_operations:
        if not isinstance(item, RequestOperationBinding):
            raise ValueError('Operación de petición no válida.')
        try:
            operation_id = str(UUID(item.operation_id))
        except (TypeError, ValueError, AttributeError):
            raise ValueError('Operación de petición no válida.') from None
        try:
            snapshot = json.loads(item.request_snapshot_json)
        except (TypeError, json.JSONDecodeError):
            raise ValueError('Operación de petición no válida.') from None
        snapshot_keys = set(snapshot) if isinstance(snapshot, dict) else set()
        base_keys = {'endpoint', 'model', 'body', 'inputManifest'}
        cloud_tts_snapshot = (
            snapshot_keys == base_keys | {'quotaProject'}
            and snapshot.get('model') == ModelId.CHIRP_3_HD
            and snapshot.get('endpoint') == _CLOUD_TTS_ENDPOINT
            and isinstance(snapshot.get('quotaProject'), str)
            and GOOGLE_PROJECT.fullmatch(snapshot['quotaProject']) is not None
            and snapshot.get('inputManifest') == [])
        if (operation_id != item.operation_id or item.ordinal < 1
                or item.ordinal in seen_ordinals or operation_id in seen_ids
                or not UNIT_ID.fullmatch(item.unit_id)
                or not OPERATION_KIND.fullmatch(item.kind)
                or not HASH.fullmatch(item.request_sha256)
                or not isinstance(item.model, str) or not item.model
                or not isinstance(item.endpoint, str)
                or not item.endpoint.startswith('https://')
                or canonical_json(snapshot) != item.request_snapshot_json
                or canonical_sha256(snapshot) != item.request_sha256
                or snapshot.get('model') != item.model
                or snapshot.get('endpoint') != item.endpoint
                or (snapshot_keys != base_keys and not cloud_tts_snapshot)
                or not isinstance(snapshot.get('body'), dict)
                or not isinstance(snapshot.get('inputManifest'), list)):
            raise ValueError('Operación de petición no válida.')
        seen_ids.add(operation_id)
        seen_ordinals.add(item.ordinal)
        operations.append({'operationId': operation_id, 'ordinal': item.ordinal,
                           'unitId': item.unit_id, 'kind': item.kind,
                           'requestSha256': item.request_sha256,
                           'model': item.model, 'endpoint': item.endpoint,
                           'requestSnapshot': snapshot})
    if [item['ordinal'] for item in operations] != list(range(1, len(operations) + 1)):
        raise ValueError('Las operaciones deben estar ordenadas sin huecos.')
    return {
        'planId': plan_id, 'planRevision': value.plan_revision,
        'sourcePlanSha256': value.source_plan_sha256,
        'executionSnapshotSha256': value.execution_snapshot_sha256,
        'editRecipeSha256': value.edit_recipe_sha256,
        'inputManifestSha256': value.input_manifest_sha256,
        'requestGroupSha256': value.request_group_sha256,
        'requestOperations': operations,
        'engine': {'name': value.engine, 'version': value.engine_version},
        'adapterOperation': value.adapter_operation,
        'limitsSha256': value.limits_sha256,
    }


def execution_binding_sha256(value: ExecutionBinding) -> str:
    """Huella pública para ligar evidencias de coste antes de cotizar."""
    return canonical_sha256(_binding(value))


def _ceiling(value: CostCeiling, now: datetime, binding_sha256: str) -> dict:
    try:
        cost_id = str(UUID(value.cost_id))
    except (TypeError, ValueError, AttributeError):
        raise ValueError('Techo de coste no verificable o no vigente.') from None
    operation_id = None
    if value.operation_id is not None:
        try:
            operation_id = str(UUID(value.operation_id))
        except (TypeError, ValueError, AttributeError):
            raise ValueError('Techo de coste no verificable o no vigente.') from None
    if (not isinstance(value, CostCeiling) or cost_id != value.cost_id
            or value.component not in COMPONENTS
            or not OPERATION_KIND.fullmatch(value.service)
            or value.payer not in PAYERS or not isinstance(value.max_usd, Decimal)
            or not value.max_usd.is_finite() or value.max_usd < 0
            or value.max_usd.as_tuple().exponent < -2
            or value.binding_sha256 != binding_sha256
            or not HASH.fullmatch(value.evidence_sha256)
            or not value.checked_at.tzinfo or not value.expires_at.tzinfo
            or value.checked_at > now or now - value.checked_at > timedelta(days=1)
            or value.expires_at <= now or value.expires_at > now + timedelta(days=1)
            or (value.component == 'generation') != (operation_id is not None)
            or (operation_id is not None and operation_id != value.operation_id)):
        raise ValueError('Techo de coste no verificable o no vigente.')
    return {'costId': cost_id, 'component': value.component,
            'service': value.service, 'payer': value.payer,
            'maxUsd': str(value.max_usd),
            'operationId': operation_id,
            'bindingSha256': value.binding_sha256,
            'evidenceSha256': value.evidence_sha256,
            'checkedAt': value.checked_at.isoformat(),
            'expiresAt': value.expires_at.isoformat()}


def composite_quote_readiness(binding: ExecutionBinding,
                              ceilings: tuple[CostCeiling, ...], *,
                              now: datetime | None = None
                              ) -> CompositeQuoteReadiness:
    """Cierra un máximo solo si los cuatro conceptos tienen evidencia vigente."""
    body = _binding(binding)
    checked_now = now or datetime.now(timezone.utc)
    if not checked_now.tzinfo or not isinstance(ceilings, tuple):
        raise ValueError('Fecha o colección de costes no válidas.')
    binding_sha = canonical_sha256(body)
    parsed = tuple(_ceiling(item, checked_now, binding_sha) for item in ceilings)
    cost_ids = [item['costId'] for item in parsed]
    if len(cost_ids) != len(set(cost_ids)):
        raise ValueError('Cada línea de coste aparece una sola vez.')
    by_name = {component: tuple(item for item in parsed
                                if item['component'] == component)
               for component in COMPONENTS}
    if by_name['generation']:
        expected_operations = {item['operationId']
                               for item in body['requestOperations']}
        priced_operations = [item['operationId']
                             for item in by_name['generation']]
        if (set(priced_operations) != expected_operations
                or len(priced_operations) != len(set(priced_operations))
                or any(Decimal(item['maxUsd']) <= 0
                       for item in by_name['generation'])):
            raise ValueError('El coste de generación no cubre cada operación exacta.')
    missing = tuple(component for component in COMPONENTS
                    if not by_name[component])
    component_totals = {component: str(sum(
                            (Decimal(item['maxUsd']) for item in by_name[component]),
                            Decimal(0)))
                        for component in COMPONENTS if by_name[component]}
    payer_totals = {}
    for item in parsed:
        payer_totals[item['payer']] = str(
            Decimal(payer_totals.get(item['payer'], '0'))
            + Decimal(item['maxUsd']))
    if missing:
        return CompositeQuoteReadiness(
            binding_sha, False, component_totals, payer_totals,
            None, missing, None, None, None, None)
    total = sum((Decimal(item['maxUsd']) for item in parsed), Decimal(0))
    generation = sum((Decimal(item['maxUsd'])
                      for item in by_name['generation']), Decimal(0))
    if total <= 0 or generation <= 0:
        raise ValueError('El máximo completo debe incluir generación positiva.')
    expires_at = min(item['expiresAt'] for item in parsed)
    costs_snapshot = sorted(parsed, key=lambda item: (
        COMPONENTS.index(item['component']), item['costId']))
    costs_sha = canonical_sha256(costs_snapshot)
    quote = {'schemaVersion': 1, 'execution': body,
             'bindingSha256': binding_sha,
             'costs': costs_snapshot, 'costsSnapshotSha256': costs_sha,
             'maxTotalUsd': str(total), 'currency': 'USD',
             'expiresAt': expires_at}
    return CompositeQuoteReadiness(
        binding_sha, True, component_totals, payer_totals,
        str(total), (), expires_at, costs_sha, canonical_json(quote),
        canonical_sha256(quote))
