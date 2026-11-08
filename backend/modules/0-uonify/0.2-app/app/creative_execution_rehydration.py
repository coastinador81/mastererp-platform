"""Read and verify a held multimedia execution from PostgreSQL.

The returned payload is suitable for a future coordinator, but the contract
keeps execution disabled and performs no mutation or external call.
"""

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from .creative_composite_quote import HASH, canonical_sha256
from .creative_execution_ledger import validate_active_execution_scope


@dataclass(frozen=True)
class RehydratedExecutionStep:
    step_id: str
    ordinal: int
    kind: str
    unit_id: str
    request_operation_id: str | None
    authority_sha256: str
    depends_on: tuple[str, ...]
    provider_call: bool
    payload: dict


@dataclass(frozen=True)
class RehydratedHeldExecution:
    job_id: str
    approval_id: str
    quote_id: str
    thread_id: str
    execution_graph_sha256: str
    steps: tuple[RehydratedExecutionStep, ...]
    ready_for_worker_integration: bool = True
    execution_authorized: bool = False
    publication_authorized: bool = False


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} persistido no es UUID.') from None
    if parsed != str(value):
        raise ValueError(f'{label} persistido no es canónico.')
    return parsed


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError(f'{label} persistido no es verificable.')
    return value


def _verify_snapshot(value: object, expected_type: type,
                     expected_sha: str, label: str):
    if type(value) is not expected_type or canonical_sha256(value) != expected_sha:
        raise ValueError(f'{label} persistido no coincide con su huella.')
    return value


def _rehydrate_execution(c, user: dict, job_id: UUID, *,
                         admitted: bool,
                         lock_reads: bool = True) -> RehydratedHeldExecution:
    """Reload every immutable authority without opening dispatch."""
    job_key = _uuid(job_id, 'jobId')
    suffix = ' FOR SHARE' if lock_reads else ''
    owner = c.execute('SELECT * FROM users WHERE id=%s' + suffix,
                      (user.get('id'),)).fetchone()
    if (not owner or owner['google_subject'] != user.get('google_subject')
            or owner.get('deletion_requested_at')):
        raise ValueError('La identidad propietaria ya no está vigente.')
    job = c.execute('''SELECT * FROM creative_execution_jobs
        WHERE user_id=%s AND id=%s''' + suffix,
        (owner['id'], job_key)).fetchone()
    allowed = ({'queued', 'running', 'succeeded', 'failed', 'unknown',
                'cancelled'} if admitted else {'held'})
    if (not job or job['status'] not in allowed or job['dispatch_authorized']
            or (not admitted and (job['lease_token'] is not None
                                  or job['finished_at'] is not None))):
        raise ValueError('El trabajo no está retenido de forma segura.')
    approval = c.execute('''SELECT * FROM creative_execution_approvals
        WHERE user_id=%s AND id=%s''' + suffix,
        (owner['id'], job['approval_id'])).fetchone()
    quote = c.execute('''SELECT * FROM creative_execution_quotes
        WHERE user_id=%s AND id=%s''' + suffix,
        (owner['id'], approval['quote_id'] if approval else None)).fetchone()
    if not approval or not quote:
        raise ValueError('Faltan recibos durables de la ejecución.')
    if (approval['quote_sha256'] != quote['quote_sha256']
            or approval['binding_sha256'] != quote['binding_sha256']
            or approval['costs_snapshot_sha256'] != quote['costs_snapshot_sha256']
            or approval['max_total_usd'] != quote['max_total_usd']):
        raise ValueError('La aprobación persistida no coincide con la cotización.')
    quote_snapshot = _verify_snapshot(
        quote['quote_snapshot'], dict, _sha(quote['quote_sha256'], 'quoteSha256'),
        'quoteSnapshot')
    execution = quote_snapshot.get('execution')
    if not isinstance(execution, dict):
        raise ValueError('El binding persistido no es ejecutable.')
    if (quote_snapshot.get('bindingSha256') != quote['binding_sha256']
            or quote_snapshot.get('costsSnapshotSha256')
            != quote['costs_snapshot_sha256']
            or Decimal(str(quote_snapshot.get('maxTotalUsd')))
            != quote['max_total_usd']):
        raise ValueError('La cotización persistida no coincide con sus columnas.')
    bound_columns = {
        'sourcePlanSha256': quote['source_plan_sha256'],
        'executionSnapshotSha256': quote['execution_snapshot_sha256'],
        'editRecipeSha256': quote['edit_recipe_sha256'],
        'inputManifestSha256': quote['input_manifest_sha256'],
        'requestGroupSha256': quote['request_group_sha256'],
        'limitsSha256': quote['limits_sha256'],
    }
    if any(execution.get(key) != value for key, value in bound_columns.items()):
        raise ValueError('El binding persistido no coincide con sus snapshots.')
    validate_active_execution_scope(c, owner, execution, lock_reads=lock_reads)
    source_plan = _verify_snapshot(
        quote['source_plan_snapshot'], dict, quote['source_plan_sha256'],
        'sourcePlanSnapshot')
    execution_snapshot = _verify_snapshot(
        quote['execution_snapshot'], dict, quote['execution_snapshot_sha256'],
        'executionSnapshot')
    edit_recipe = _verify_snapshot(
        quote['edit_recipe'], dict, quote['edit_recipe_sha256'], 'editRecipe')
    input_manifest = _verify_snapshot(
        quote['input_manifest'], list, quote['input_manifest_sha256'],
        'inputManifest')
    limits = _verify_snapshot(
        quote['limits_snapshot'], dict, quote['limits_sha256'], 'limitsSnapshot')
    graph = _verify_snapshot(
        job['graph_snapshot'], dict,
        _sha(job['execution_graph_sha256'], 'executionGraphSha256'),
        'graphSnapshot')
    if (graph.get('schemaVersion') not in (1, 2)
            or graph.get('approvalId') != str(approval['id'])
            or graph.get('quoteSha256') != quote['quote_sha256']
            or graph.get('bindingSha256') != quote['binding_sha256']
            or graph.get('costsSnapshotSha256') != quote['costs_snapshot_sha256']):
        raise ValueError('El grafo persistido no coincide con sus recibos.')
    operations = execution.get('requestOperations')
    if not isinstance(operations, list) or not operations:
        raise ValueError('No hay operaciones ejecutables persistidas.')
    operation_by_id = {item.get('operationId'): item for item in operations
                       if isinstance(item, dict)}
    if len(operation_by_id) != len(operations):
        raise ValueError('Las operaciones ejecutables no tienen identidad única.')
    rows = c.execute('''SELECT * FROM creative_execution_steps
        WHERE user_id=%s AND job_id=%s ORDER BY ordinal''' + suffix,
        (owner['id'], job['id'])).fetchall()
    graph_steps = graph.get('steps')
    if not isinstance(graph_steps, list) or len(rows) != len(graph_steps):
        raise ValueError('Los pasos persistidos no coinciden con el grafo.')
    result = []
    for expected, (row, specification) in enumerate(zip(rows, graph_steps), 1):
        if not isinstance(specification, dict):
            raise ValueError('Un paso persistido no coincide con el grafo.')
        exact = {
            'stepId': str(row['step_id']), 'ordinal': row['ordinal'],
            'kind': row['kind'], 'unitId': row['unit_id'],
            'requestOperationId': (str(row['request_operation_id'])
                                   if row['request_operation_id'] else None),
            'authoritySha256': row['authority_sha256'],
            'dependsOn': row['depends_on'], 'providerCall': row['provider_call'],
            'replayAfterStart': row['replay_after_start'],
        }
        if (row['ordinal'] != expected or (not admitted and row['status'] != 'held')
                or exact != specification or row['replay_after_start']):
            raise ValueError('Un paso persistido no coincide con el grafo.')
        operation_id = exact['requestOperationId']
        operation = operation_by_id.get(operation_id) if operation_id else None
        if row['kind'] in ('google_generation', 'storage_adopt') and not operation:
            raise ValueError('Un paso no liga su operación ejecutable.')
        if row['kind'] == 'google_generation':
            payload = {'operation': operation,
                       'requestSnapshot': operation['requestSnapshot']}
        elif row['kind'] == 'storage_adopt':
            payload = {'operationId': operation_id,
                       'requestSha256': operation['requestSha256'],
                       'sourceStepId': exact['dependsOn'][0]}
        elif row['kind'] == 'craft':
            payload = {'sourcePlan': source_plan,
                       'executionSnapshot': execution_snapshot,
                       'editRecipe': edit_recipe,
                       'inputManifest': input_manifest,
                       'limits': limits,
                       'bindingSha256': quote['binding_sha256']}
        elif row['kind'] == 'candidate_adopt':
            if (graph.get('schemaVersion') != 2 or len(exact['dependsOn']) != 1
                    or not any(str(item['step_id']) == exact['dependsOn'][0]
                               and item['kind'] == 'craft' for item in rows)):
                raise ValueError('La adopción candidata no depende del paso Craft.')
            payload = {'candidateCraftStepId': exact['dependsOn'][0],
                       'bindingSha256': quote['binding_sha256'],
                       'editRecipeSha256': quote['edit_recipe_sha256'],
                       'inputManifestSha256': quote['input_manifest_sha256']}
        elif row['kind'] == 'review':
            payload = {'quoteSha256': quote['quote_sha256'],
                       'executionGraphSha256': job['execution_graph_sha256']}
        else:
            raise ValueError('El tipo de paso persistido no está admitido.')
        result.append(RehydratedExecutionStep(
            str(row['step_id']), row['ordinal'], row['kind'], row['unit_id'],
            operation_id, row['authority_sha256'], tuple(row['depends_on']),
            row['provider_call'], payload))
    return RehydratedHeldExecution(
        str(job['id']), str(approval['id']), str(quote['id']), job['thread_id'],
        job['execution_graph_sha256'], tuple(result))


def rehydrate_held_execution(c, user: dict,
                             job_id: UUID) -> RehydratedHeldExecution:
    """Reload an exactly held graph and every immutable authority."""
    return _rehydrate_execution(c, user, job_id, admitted=False)


def rehydrate_admitted_execution(c, user: dict, job_id: UUID, *,
                                 lock_reads: bool = True
                                 ) -> RehydratedHeldExecution:
    """Reload an admitted graph while allowing its lifecycle state to advance."""
    return _rehydrate_execution(
        c, user, job_id, admitted=True, lock_reads=lock_reads)
