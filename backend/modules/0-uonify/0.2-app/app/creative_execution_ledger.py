"""Durable receipts for one composite creative execution.

This private service only persists a closed quote, its exact approval and a
held execution graph. It exposes no route and cannot queue or dispatch work.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from uuid import NAMESPACE_URL, UUID, uuid5

from psycopg.types.json import Jsonb

from .creative_composite_quote import (CompositeQuoteReadiness, HASH,
                                       canonical_json, canonical_sha256)
from .creative_execution_graph import (CreativeExecutionGraph,
                                       ExecutionApprovalBinding)


@dataclass(frozen=True)
class ExecutionPersistenceSnapshots:
    source_plan_snapshot_json: str
    execution_snapshot_json: str
    edit_recipe_json: str
    input_manifest_json: str
    limits_snapshot_json: str


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    if parsed != str(value):
        raise ValueError(f'{label} no es UUID canónico.')
    return parsed


def _instant(value: object, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValueError(f'{label} no es una fecha válida.') from None
    if not parsed.tzinfo:
        raise ValueError(f'{label} no incluye zona horaria.')
    return parsed


def _amount(value: object) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError('El máximo aprobado no es válido.') from None
    if (not parsed.is_finite() or parsed <= 0
            or parsed.as_tuple().exponent < -2):
        raise ValueError('El máximo aprobado no es válido.')
    return parsed


def _closed_quote(readiness: CompositeQuoteReadiness) -> dict:
    if (not isinstance(readiness, CompositeQuoteReadiness)
            or not readiness.complete or readiness.approval_ready
            or readiness.execution_authorized
            or not readiness.quote_snapshot_json
            or not readiness.quote_sha256
            or not readiness.binding_sha256
            or not readiness.costs_snapshot_sha256
            or not readiness.max_total_usd or not readiness.expires_at):
        raise ValueError('La cotización compuesta no está cerrada.')
    try:
        quote = json.loads(readiness.quote_snapshot_json)
    except (TypeError, json.JSONDecodeError):
        raise ValueError('La cotización compuesta no está cerrada.') from None
    if (canonical_json(quote) != readiness.quote_snapshot_json
            or canonical_sha256(quote) != readiness.quote_sha256
            or quote.get('bindingSha256') != readiness.binding_sha256
            or quote.get('costsSnapshotSha256') != readiness.costs_snapshot_sha256
            or quote.get('maxTotalUsd') != readiness.max_total_usd
            or quote.get('expiresAt') != readiness.expires_at
            or quote.get('currency') != 'USD'):
        raise ValueError('La cotización compuesta cambió.')
    execution = quote.get('execution')
    required = {'planId', 'planRevision', 'sourcePlanSha256',
                'executionSnapshotSha256', 'editRecipeSha256',
                'inputManifestSha256', 'requestGroupSha256',
                'requestOperations', 'engine', 'adapterOperation',
                'limitsSha256'}
    if not isinstance(execution, dict) or set(execution) != required:
        raise ValueError('El binding de ejecución no está completo.')
    if any(not HASH.fullmatch(execution.get(name, '')) for name in (
            'sourcePlanSha256', 'executionSnapshotSha256', 'editRecipeSha256',
            'inputManifestSha256', 'requestGroupSha256', 'limitsSha256')):
        raise ValueError('El binding de ejecución no está completo.')
    _uuid(execution.get('planId'), 'planId')
    _amount(quote.get('maxTotalUsd'))
    _instant(quote.get('expiresAt'), 'expiresAt')
    return quote


def _persistence_snapshots(value: ExecutionPersistenceSnapshots,
                           execution: dict) -> dict:
    if not isinstance(value, ExecutionPersistenceSnapshots):
        raise ValueError('Faltan los snapshots ejecutables persistentes.')
    fields = {
        'sourcePlan': (value.source_plan_snapshot_json, dict,
                       execution['sourcePlanSha256']),
        'execution': (value.execution_snapshot_json, dict,
                      execution['executionSnapshotSha256']),
        'editRecipe': (value.edit_recipe_json, dict,
                       execution['editRecipeSha256']),
        'inputManifest': (value.input_manifest_json, list,
                          execution['inputManifestSha256']),
        'limits': (value.limits_snapshot_json, dict,
                   execution['limitsSha256']),
    }
    parsed = {}
    for name, (source, expected_type, expected_sha) in fields.items():
        try:
            snapshot = json.loads(source)
        except (TypeError, json.JSONDecodeError):
            raise ValueError('Un snapshot ejecutable no es JSON canónico.') from None
        if (type(snapshot) is not expected_type or canonical_json(snapshot) != source
                or canonical_sha256(snapshot) != expected_sha):
            raise ValueError('Un snapshot ejecutable no coincide con su hash.')
        parsed[name] = snapshot
    return parsed


def validate_active_execution_scope(c, user: dict, execution: dict, *,
                                    lock_reads: bool = True) -> tuple[dict, dict]:
    suffix = ' FOR SHARE' if lock_reads else ''
    owner = c.execute('SELECT * FROM users WHERE id=%s' + suffix,
                      (user.get('id'),)).fetchone()
    if (not owner or owner['google_subject'] != user.get('google_subject')
            or owner.get('deletion_requested_at')):
        raise ValueError('La identidad propietaria ya no está vigente.')
    plan = c.execute('''SELECT p.*,t.project_id AS uonify_project_id,
        t.deleted_at AS thread_deleted_at FROM uony_creative_plans p
        JOIN uony_threads t ON t.user_id=p.user_id AND t.id=p.thread_id
        WHERE p.user_id=%s AND p.id=%s''' + (
            ' FOR SHARE OF p,t' if lock_reads else ''),
        (owner['id'], execution['planId'])).fetchone()
    if (not plan or plan['google_subject'] != owner['google_subject']
            or plan['status'] != 'draft' or plan['thread_deleted_at']
            or plan['revision'] != execution['planRevision']):
        raise ValueError('El plan creativo ya no coincide con la cotización.')
    newest = c.execute('''SELECT id FROM uony_creative_plans
        WHERE user_id=%s AND thread_id=%s
        ORDER BY created_at DESC,id DESC LIMIT 1''',
        (owner['id'], plan['thread_id'])).fetchone()
    if not newest or newest['id'] != plan['id']:
        raise ValueError('El plan creativo fue reemplazado.')
    cloud = c.execute('''SELECT * FROM google_cloud_connections
        WHERE user_id=%s''' + suffix, (owner['id'],)).fetchone()
    checks = cloud.get('project_check') if cloud else None
    if (not cloud or cloud['google_subject'] != owner['google_subject']
            or cloud['project_id'] != plan['project_id']
            or cloud['status'] != 'connected' or not isinstance(checks, dict)
            or checks.get('ready') is not True
            or checks.get('billing') != 'enabled'):
        raise ValueError('El proyecto pagador ya no está vigente.')
    return owner, plan


def _quote_view(row: dict) -> dict:
    return {
        'quoteId': str(row['id']), 'planId': str(row['plan_id']),
        'threadId': row['thread_id'], 'bindingSha256': row['binding_sha256'],
        'costsSnapshotSha256': row['costs_snapshot_sha256'],
        'quoteSha256': row['quote_sha256'],
        'maxTotalUsd': str(row['max_total_usd']), 'currency': row['currency'],
        'expiresAt': row['expires_at'].isoformat(),
        'approvalReady': False, 'executionAuthorized': False,
    }


def persist_composite_quote(c, user: dict, issue_request_id: UUID,
                            readiness: CompositeQuoteReadiness,
                            snapshots: ExecutionPersistenceSnapshots) -> dict:
    """Persist an idempotent immutable receipt without opening approval."""
    request_id = _uuid(issue_request_id, 'issueRequestId')
    quote = _closed_quote(readiness)
    execution = quote['execution']
    owner, plan = validate_active_execution_scope(c, user, execution)
    persisted = _persistence_snapshots(snapshots, execution)
    expected_source = {
        'recipe': plan['recipe'], 'plan': plan['plan'],
        'skillVersion': plan['skill_version'],
        'productId': str(plan['product_id']) if plan['product_id'] else None,
        'productRevision': plan['product_revision'],
    }
    if persisted['sourcePlan'] != expected_source:
        raise ValueError('El snapshot del plan no coincide con la revisión vigente.')
    expires_at = _instant(quote['expiresAt'], 'expiresAt')
    now = datetime.now(timezone.utc)
    if expires_at <= now:
        raise ValueError('La cotización ya ha caducado.')
    prior = c.execute('''SELECT * FROM creative_execution_quotes
        WHERE user_id=%s AND issue_request_id=%s''',
        (owner['id'], request_id)).fetchone()
    if prior:
        if prior['quote_sha256'] != readiness.quote_sha256:
            raise ValueError('La petición de cotización ya liga otro contenido.')
        return _quote_view(prior)
    quote_id = uuid5(NAMESPACE_URL,
                     f'uonify:creative-quote:{owner["id"]}:{request_id}')
    row = c.execute('''INSERT INTO creative_execution_quotes
        (id,user_id,issue_request_id,plan_id,thread_id,uonify_project_id,
         google_subject,google_project_id,plan_revision,source_plan_sha256,
         execution_snapshot_sha256,edit_recipe_sha256,input_manifest_sha256,
         request_group_sha256,limits_sha256,binding_sha256,
         costs_snapshot_sha256,quote_sha256,source_plan_snapshot,
         execution_snapshot,edit_recipe,input_manifest,limits_snapshot,
         quote_snapshot,max_total_usd,currency,expires_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
               %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
               %s,%s,%s,%s,%s,'USD',%s)
        ON CONFLICT (user_id,issue_request_id) DO NOTHING RETURNING *''',
        (quote_id, owner['id'], request_id, plan['id'], plan['thread_id'],
         plan['uonify_project_id'], owner['google_subject'], plan['project_id'],
         execution['planRevision'], execution['sourcePlanSha256'],
         execution['executionSnapshotSha256'], execution['editRecipeSha256'],
         execution['inputManifestSha256'], execution['requestGroupSha256'],
         execution['limitsSha256'], readiness.binding_sha256,
         readiness.costs_snapshot_sha256, readiness.quote_sha256,
         Jsonb(persisted['sourcePlan']), Jsonb(persisted['execution']),
         Jsonb(persisted['editRecipe']), Jsonb(persisted['inputManifest']),
         Jsonb(persisted['limits']), Jsonb(quote),
         _amount(readiness.max_total_usd), expires_at)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM creative_execution_quotes
            WHERE user_id=%s AND issue_request_id=%s''',
            (owner['id'], request_id)).fetchone()
        if not row or row['quote_sha256'] != readiness.quote_sha256:
            raise ValueError('La petición de cotización ya liga otro contenido.')
    return _quote_view(row)


def approve_composite_quote(c, user: dict, quote_id: UUID, request_id: UUID, *,
                            quote_sha256: str, binding_sha256: str,
                            costs_snapshot_sha256: str, max_total_usd: str,
                            acknowledged: bool,
                            now: datetime | None = None
                            ) -> ExecutionApprovalBinding:
    """Store the exact customer approval; still no execution admission."""
    quote_key, request_key = _uuid(quote_id, 'quoteId'), _uuid(request_id, 'requestId')
    approved_at = now or datetime.now(timezone.utc)
    if not approved_at.tzinfo or acknowledged is not True:
        raise ValueError('Falta la aprobación exacta del cliente.')
    owner = c.execute('SELECT * FROM users WHERE id=%s FOR SHARE',
                      (user.get('id'),)).fetchone()
    if (not owner or owner['google_subject'] != user.get('google_subject')
            or owner.get('deletion_requested_at')):
        raise ValueError('La identidad propietaria ya no está vigente.')
    quote = c.execute('''SELECT * FROM creative_execution_quotes
        WHERE user_id=%s AND id=%s FOR SHARE''',
        (owner['id'], quote_key)).fetchone()
    if not quote:
        raise ValueError('No se encuentra la cotización compuesta.')
    persisted_snapshot = quote['quote_snapshot']
    if (not isinstance(persisted_snapshot, dict)
            or not isinstance(persisted_snapshot.get('execution'), dict)):
        raise ValueError('La cotización persistida no es verificable.')
    validate_active_execution_scope(c, owner, persisted_snapshot['execution'])
    expected = (quote['quote_sha256'], quote['binding_sha256'],
                quote['costs_snapshot_sha256'], quote['max_total_usd'])
    supplied = (quote_sha256, binding_sha256, costs_snapshot_sha256,
                _amount(max_total_usd))
    if expected != supplied or approved_at >= quote['expires_at']:
        raise ValueError('La aprobación no coincide con la cotización vigente.')
    prior = c.execute('''SELECT * FROM creative_execution_approvals
        WHERE user_id=%s AND request_id=%s''',
        (owner['id'], request_key)).fetchone()
    if prior:
        if prior['quote_id'] != quote['id']:
            raise ValueError('La petición de aprobación ya liga otra cotización.')
        return ExecutionApprovalBinding(
            str(prior['id']), prior['quote_sha256'], prior['binding_sha256'],
            prior['costs_snapshot_sha256'], str(prior['max_total_usd']),
            prior['approved_at'])
    used = c.execute('''SELECT request_id FROM creative_execution_approvals
        WHERE user_id=%s AND quote_id=%s''',
        (owner['id'], quote['id'])).fetchone()
    if used:
        raise ValueError('La cotización ya tiene una aprobación durable.')
    approval_id = uuid5(
        NAMESPACE_URL, f'uonify:creative-approval:{owner["id"]}:{request_key}')
    row = c.execute('''INSERT INTO creative_execution_approvals
        (id,user_id,quote_id,request_id,actor_id,quote_sha256,binding_sha256,
         costs_snapshot_sha256,max_total_usd,approved_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id,request_id) DO NOTHING RETURNING *''',
        (approval_id, owner['id'], quote['id'], request_key, owner['id'],
         quote_sha256, binding_sha256, costs_snapshot_sha256,
         _amount(max_total_usd), approved_at)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM creative_execution_approvals
            WHERE user_id=%s AND request_id=%s''',
            (owner['id'], request_key)).fetchone()
        if not row or row['quote_id'] != quote['id']:
            raise ValueError('La petición de aprobación ya liga otra cotización.')
    return ExecutionApprovalBinding(
        str(row['id']), row['quote_sha256'], row['binding_sha256'],
        row['costs_snapshot_sha256'], str(row['max_total_usd']),
        row['approved_at'])


def _graph_snapshot(graph: CreativeExecutionGraph) -> dict:
    steps = []
    known: set[str] = set()
    for expected, step in enumerate(graph.steps, 1):
        step_id = _uuid(step.step_id, 'stepId')
        operation_id = (_uuid(step.request_operation_id, 'requestOperationId')
                        if step.request_operation_id else None)
        if (step.ordinal != expected or not HASH.fullmatch(step.authority_sha256)
                or any(dependency not in known for dependency in step.depends_on)
                or step.replay_after_start):
            raise ValueError('El grafo contiene pasos no ejecutables de forma segura.')
        known.add(step_id)
        steps.append({'stepId': step_id, 'ordinal': step.ordinal,
                      'kind': step.kind, 'unitId': step.unit_id,
                      'requestOperationId': operation_id,
                      'authoritySha256': step.authority_sha256,
                      'dependsOn': list(step.depends_on),
                      'providerCall': step.provider_call,
                      'replayAfterStart': step.replay_after_start})
    return {'schemaVersion': graph.schema_version,
            'approvalId': graph.approval_id,
            'quoteSha256': graph.quote_sha256,
            'bindingSha256': graph.binding_sha256,
            'costsSnapshotSha256': graph.costs_snapshot_sha256,
            'steps': steps}


def hold_execution_graph(c, user: dict, request_id: UUID,
                         readiness: CompositeQuoteReadiness,
                         graph: CreativeExecutionGraph, *,
                         now: datetime | None = None) -> dict:
    """Persist a held job. No code path can turn it into queued work yet."""
    request_key = _uuid(request_id, 'requestId')
    if (not isinstance(graph, CreativeExecutionGraph)
            or not graph.ready_for_persistence or graph.execution_authorized
            or graph.publication_authorized):
        raise ValueError('El grafo no está listo para persistirse de forma segura.')
    quote_snapshot = _closed_quote(readiness)
    snapshot = _graph_snapshot(graph)
    if (canonical_sha256(snapshot) != graph.execution_graph_sha256
            or graph.quote_sha256 != readiness.quote_sha256
            or graph.binding_sha256 != readiness.binding_sha256
            or graph.costs_snapshot_sha256 != readiness.costs_snapshot_sha256):
        raise ValueError('El grafo no coincide con la cotización aprobada.')
    owner = c.execute('SELECT * FROM users WHERE id=%s FOR SHARE',
                      (user.get('id'),)).fetchone()
    if not owner or owner['google_subject'] != user.get('google_subject'):
        raise ValueError('La identidad propietaria ya no está vigente.')
    approval = c.execute('''SELECT a.*,q.thread_id,q.quote_snapshot,q.expires_at
        FROM creative_execution_approvals a JOIN creative_execution_quotes q
          ON q.user_id=a.user_id AND q.id=a.quote_id
        WHERE a.user_id=%s AND a.id=%s FOR SHARE OF a,q''',
        (owner['id'], _uuid(graph.approval_id, 'approvalId'))).fetchone()
    if (not approval or approval['quote_sha256'] != graph.quote_sha256
            or approval['binding_sha256'] != graph.binding_sha256
            or approval['costs_snapshot_sha256'] != graph.costs_snapshot_sha256
            or canonical_sha256(approval['quote_snapshot']) != readiness.quote_sha256
            or approval['quote_snapshot'] != quote_snapshot):
        raise ValueError('El grafo no coincide con la aprobación persistida.')
    validate_active_execution_scope(c, owner, approval['quote_snapshot']['execution'])
    held_at = now or datetime.now(timezone.utc)
    if not held_at.tzinfo or held_at >= approval['expires_at']:
        raise ValueError('La cotización aprobada ya ha caducado.')
    prior = c.execute('''SELECT * FROM creative_execution_jobs
        WHERE user_id=%s AND request_id=%s''',
        (owner['id'], request_key)).fetchone()
    if prior:
        if prior['execution_graph_sha256'] != graph.execution_graph_sha256:
            raise ValueError('La petición de ejecución ya liga otro grafo.')
        return {'jobId': str(prior['id']), 'status': prior['status'],
                'executionGraphSha256': prior['execution_graph_sha256'],
                'dispatchAuthorized': prior['dispatch_authorized']}
    used = c.execute('''SELECT request_id FROM creative_execution_jobs
        WHERE user_id=%s AND approval_id=%s''',
        (owner['id'], approval['id'])).fetchone()
    if used:
        raise ValueError('La aprobación ya tiene un trabajo durable.')
    job_id = uuid5(NAMESPACE_URL,
                   f'uonify:creative-job:{owner["id"]}:{request_key}')
    row = c.execute('''INSERT INTO creative_execution_jobs
        (id,user_id,approval_id,request_id,thread_id,execution_graph_sha256,
         graph_snapshot,status,dispatch_authorized)
        VALUES(%s,%s,%s,%s,%s,%s,%s,'held',false)
        ON CONFLICT (user_id,request_id) DO NOTHING RETURNING *''',
        (job_id, owner['id'], approval['id'], request_key,
         approval['thread_id'], graph.execution_graph_sha256,
         Jsonb(snapshot))).fetchone()
    if not row:
        raise ValueError('La petición de ejecución ya fue utilizada.')
    for step, body in zip(graph.steps, snapshot['steps']):
        c.execute('''INSERT INTO creative_execution_steps
            (user_id,job_id,step_id,ordinal,kind,unit_id,
             request_operation_id,authority_sha256,depends_on,provider_call,
             replay_after_start,status)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false,'held')''',
            (owner['id'], job_id, step.step_id, step.ordinal, step.kind,
             step.unit_id, step.request_operation_id, step.authority_sha256,
             Jsonb(body['dependsOn']), step.provider_call))
    return {'jobId': str(row['id']), 'status': row['status'],
            'executionGraphSha256': row['execution_graph_sha256'],
            'dispatchAuthorized': row['dispatch_authorized']}
