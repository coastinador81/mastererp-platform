"""Rebuild the exact Craft job and adapter from durable server authority."""

from .craft_adapter import build_craft_adapter_plan
from .craft_contracts import (CraftAdapterPlan, ResolvedCraftJob,
                              canonical_sha256, input_manifest_payload,
                              resolved_craft_job)
from .craft_preflight import preflight_craft_job
from .creative_asset_registry import resolve_creative_asset_for_craft
from .creative_image_sequence_authority import image_sequence_mounts_from_attempt


_LIMITS = {
    'cpu_cores': 'cpuCores',
    'memory_bytes': 'memoryBytes',
    'wall_seconds': 'wallSeconds',
    'output_bytes': 'outputBytes',
    'network_access': 'networkAccess',
    'google_credentials': 'googleCredentials',
}


def load_craft_attempt_authority(c, user_id: object,
                                 attempt_id: object) -> dict | None:
    """Load every immutable row needed to reconstruct one Craft attempt.

    Orden global de bloqueos users→jobs→steps→attempts→resto. Un JOIN con FOR SHARE NO
    garantiza el orden de adquisición (lo fija el plan), así que bloqueamos en SENTENCIAS
    SEPARADAS en ese orden (job→step→intento) antes de leer la autoridad y bloquear el
    resto (admisión, cotización). Evita la inversión intento↔job frente a la función
    gate120 creative_craft_input_consume_and_provider_start (que bloquea job→step→intento).
    Ver contracts/craft-claim-deadlock-diagnosis-20261021.md §9 (Consultor, cond.2).
    """
    seed = c.execute(
        '''SELECT job_id,step_id FROM creative_execution_attempts
           WHERE user_id=%s AND id=%s''', (user_id, attempt_id)).fetchone()
    if not seed:
        return None
    c.execute('''SELECT 1 FROM creative_execution_jobs
        WHERE user_id=%s AND id=%s FOR SHARE''', (user_id, seed['job_id']))
    c.execute('''SELECT 1 FROM creative_execution_steps
        WHERE user_id=%s AND job_id=%s AND step_id=%s FOR SHARE''',
        (user_id, seed['job_id'], seed['step_id']))
    c.execute('''SELECT 1 FROM creative_execution_attempts
        WHERE user_id=%s AND id=%s FOR SHARE''', (user_id, attempt_id))
    return c.execute('''SELECT t.*,d.admission_sha256,
        d.input_claim_set_sha256,d.input_claims AS admission_input_claims,
        j.execution_graph_sha256,j.graph_snapshot,j.status AS job_status,
        j.lease_token AS job_lease,j.request_id AS job_request_id,
        s.kind,s.status AS step_status,s.lease_token AS step_lease,
        q.uonify_project_id,q.input_manifest_sha256,q.source_plan_snapshot,
        q.source_plan_sha256,q.execution_snapshot,q.execution_snapshot_sha256,
        q.request_group_sha256,q.input_manifest,
        q.edit_recipe,q.edit_recipe_sha256,q.limits_snapshot,
        q.limits_sha256,
        q.plan_id,q.plan_revision,q.thread_id,
        q.google_project_id,q.quote_sha256,q.binding_sha256,
        q.costs_snapshot_sha256,q.max_total_usd,q.expires_at,q.quote_snapshot,
        a.id AS approval_id,p.origin_request_id AS plan_origin_request_id,
        p.skill_version AS plan_skill_version,p.product_id AS plan_product_id,
        p.product_revision AS plan_product_revision,p.status AS plan_status
        FROM creative_execution_attempts t
        JOIN creative_execution_admissions d
          ON d.user_id=t.user_id AND d.id=t.admission_id
        JOIN creative_execution_jobs j ON j.user_id=t.user_id AND j.id=t.job_id
        JOIN creative_execution_steps s ON s.user_id=t.user_id
          AND s.job_id=t.job_id AND s.step_id=t.step_id
        JOIN creative_execution_approvals a
          ON a.user_id=j.user_id AND a.id=j.approval_id
        JOIN creative_execution_quotes q
          ON q.user_id=a.user_id AND q.id=a.quote_id
        JOIN uony_creative_plans p
          ON p.user_id=q.user_id AND p.id=q.plan_id
        WHERE t.user_id=%s AND t.id=%s FOR SHARE OF t,d,j,s,q''',
        (user_id, attempt_id)).fetchone()


def _inputs(c, owner: dict, row: dict) -> list[dict]:
    claims = row.get('claim_snapshot')
    admitted = row.get('admission_input_claims')
    if not isinstance(claims, list):
        raise ValueError('Los claims de entrada Craft no son verificables.')
    if not isinstance(admitted, list):
        raise ValueError('Los claims de admisión no son verificables.')
    recipe_assets = row.get('edit_recipe', {}).get('assets')
    if not isinstance(recipe_assets, list):
        raise ValueError('La receta Craft no declara assets canónicos.')
    expected_refs = [(item.get('assetId'), item.get('revision'))
                     for item in recipe_assets if isinstance(item, dict)]
    observed_refs = [(item.get('assetId'), item.get('assetRevision'))
                     for item in claims if isinstance(item, dict)]
    if (len(expected_refs) != len(recipe_assets)
            or observed_refs != expected_refs
            or len({item[0] for item in observed_refs}) != len(observed_refs)):
        raise ValueError('Los claims Craft no coinciden con los assets de la receta.')
    admitted_by_asset = {item.get('assetId'): item for item in admitted
                         if isinstance(item, dict)}
    if len(admitted_by_asset) != len(admitted):
        raise ValueError('Los claims de admisión no son únicos.')
    project = row.get('uonify_project_id')
    result = []
    mounts = image_sequence_mounts_from_attempt(row)
    used_mounts = set()
    for claim in claims:
        if not isinstance(claim, dict):
            raise ValueError('Un claim de entrada Craft no es verificable.')
        resolved = resolve_creative_asset_for_craft(
            c, owner, claim.get('assetId'), claim.get('assetRevision'), project,
            image_sequence_mount=mounts.get(str(claim.get('assetId'))))
        expected_claim = {
            'assetId': resolved.asset_id,
            'assetRevision': resolved.revision,
            'snapshotSha256': resolved.snapshot_sha256,
            'mountName': resolved.mount_name,
            'storageReceipt': resolved.craft_payload['storageReceipt'],
        }
        if claim != expected_claim:
            raise ValueError('Un claim Craft cambió desde la admisión.')
        prior = admitted_by_asset.get(resolved.asset_id)
        if prior is not None and prior != expected_claim:
            raise ValueError('Un claim Craft diverge de la admisión original.')
        if 'materialization' in resolved.craft_payload:
            used_mounts.add(resolved.asset_id)
        result.append(resolved.craft_payload)
    if used_mounts != set(mounts):
        raise ValueError('Los mounts Craft no coinciden con las secuencias reclamadas.')
    claim_body = {
        'schemaVersion': 1,
        'uonifyProjectId': (str(row['uonify_project_id'])
                            if row['uonify_project_id'] else None),
        'assets': claims,
    }
    if canonical_sha256(claim_body) != row.get('claim_set_sha256'):
        raise ValueError('El conjunto de claims Craft no coincide con el intento.')
    return result


def _snapshot(row: dict, inputs: list[dict]) -> dict:
    execution = row.get('quote_snapshot', {}).get('execution')
    recipe = row.get('edit_recipe')
    if not isinstance(execution, dict) or not isinstance(recipe, dict):
        raise ValueError('La autoridad de ejecución Craft no es verificable.')
    return {
        'recipe': recipe,
        'recipeSha256': row['edit_recipe_sha256'],
        'readyForAdapter': True,
        'assets': [item['assetId'] for item in inputs],
        'sourcePlanSha256': row['source_plan_sha256'],
        'executionSnapshotSha256': row['execution_snapshot_sha256'],
        'requestGroupSha256': row['request_group_sha256'],
        'requestOperations': execution.get('requestOperations'),
        'quoteInputManifestSha256': row['input_manifest_sha256'],
    }


def _target(row: dict) -> dict:
    source, recipe = row.get('source_plan_snapshot'), row.get('edit_recipe')
    if not isinstance(source, dict) or not isinstance(recipe, dict):
        raise ValueError('El target Craft no es verificable.')
    edit = recipe.get('target')
    if not isinstance(edit, dict):
        raise ValueError('La receta Craft no declara target canónico.')
    product_id = str(row['plan_product_id']) if row['plan_product_id'] else None
    if (source.get('productId') != product_id
            or source.get('productRevision') != row['plan_product_revision']
            or edit.get('mode') != 'create'):
        raise ValueError('El target Craft no tiene autoridad vigente.')
    return {
        'productId': source.get('productId'),
        'expectedProductRevision': source.get('productRevision'),
        'editProject': {
            'mode': edit.get('mode'),
            'id': edit.get('targetId'),
            'expectedRevision': edit.get('expectedRevision'),
        },
    }


def _limits(row: dict) -> dict:
    source = row.get('limits_snapshot')
    if not isinstance(source, dict) or set(source) != set(_LIMITS):
        raise ValueError('Los límites Craft persistidos no son canónicos.')
    return {_LIMITS[key]: source[key] for key in _LIMITS}


def authoritative_craft_context(
        c, owner: dict, row: dict) -> tuple[ResolvedCraftJob, CraftAdapterPlan]:
    """Derive the only Craft context accepted for one persisted attempt."""
    inputs = _inputs(c, owner, row)
    execution = row['quote_snapshot']['execution']
    costs = row['quote_snapshot'].get('costs')
    source = row.get('source_plan_snapshot')
    snapshot = _snapshot(row, inputs)
    craft_costs = [item for item in costs or [] if isinstance(item, dict)
                   and item.get('service') == 'craft_render']
    if (not isinstance(costs, list) or len(craft_costs) != 1
            or craft_costs[0].get('component') != 'processing'
            or craft_costs[0].get('payer') != 'uonify_platform'
            or craft_costs[0].get('operationId') is not None
            or not isinstance(source, dict) or row.get('plan_status') != 'draft'
            or canonical_sha256(source) != row.get('source_plan_sha256')
            or canonical_sha256(row.get('execution_snapshot'))
            != row.get('execution_snapshot_sha256')
            or canonical_sha256(row.get('edit_recipe'))
            != row.get('edit_recipe_sha256')
            or canonical_sha256(row.get('input_manifest'))
            != row.get('input_manifest_sha256')
            or canonical_sha256(row.get('limits_snapshot'))
            != row.get('limits_sha256')
            or execution.get('sourcePlanSha256') != row['source_plan_sha256']
            or execution.get('executionSnapshotSha256')
            != row['execution_snapshot_sha256']
            or execution.get('editRecipeSha256') != row['edit_recipe_sha256']
            or execution.get('inputManifestSha256')
            != row['input_manifest_sha256']
            or execution.get('limitsSha256') != row['limits_sha256']
            or source.get('skillVersion') != row.get('plan_skill_version')
            or source.get('skillVersion')
            != row['edit_recipe'].get('sources', {}).get('skillVersion')):
        raise ValueError('La autoridad persistida de Craft no coincide.')
    value = {
        'schemaVersion': 1,
        'jobId': str(row['job_id']),
        'intentId': str(row['job_request_id']),
        'originRequestId': str(row['plan_origin_request_id']),
        'identity': {
            'userId': str(owner['id']),
            'googleSubject': owner['google_subject'],
            'threadId': row['thread_id'],
            'uonifyProjectId': (str(row['uonify_project_id'])
                                if row['uonify_project_id'] else None),
            'googleCloudProjectId': row['google_project_id'],
        },
        'plan': {
            'creativePlanId': str(row['plan_id']),
            'expectedPlanRevision': row['plan_revision'],
            'snapshot': snapshot,
            'snapshotSha256': canonical_sha256(snapshot),
            'skillVersion': source['skillVersion'],
        },
        'target': _target(row),
        'engine': execution.get('engine'),
        'operation': execution.get('adapterOperation'),
        'inputs': inputs,
        'inputManifestSha256': '',
        'authorization': {
            'mode': 'approved',
            'receiptId': str(row['approval_id']),
            'maxExternalSpendUsd': 0,
            'payer': 'platform',
            'quoteBindingSha256': row['binding_sha256'],
            'quoteSha256': row['quote_sha256'],
            'costsSnapshotSha256': row['costs_snapshot_sha256'],
            'quoteMaxTotalUsd': str(row['max_total_usd']),
            'quoteExpiresAt': row['expires_at'].isoformat(),
        },
        'limits': _limits(row),
    }
    provisional = resolved_craft_job(value)
    value['inputManifestSha256'] = canonical_sha256(
        input_manifest_payload(provisional))
    job = resolved_craft_job(value)
    preflight = preflight_craft_job(job)
    if not preflight.ready:
        raise ValueError('El job Craft autoritativo no supera preflight.')
    return job, build_craft_adapter_plan(job, preflight)
