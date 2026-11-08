"""Append-only Craft job, preflight and adapter snapshots bound pre-start."""

from dataclasses import asdict
from hashlib import sha256
from pathlib import Path

from psycopg.types.json import Jsonb

from .craft_adapter import build_craft_adapter_plan
from .craft_capabilities import (CAPABILITY_MATRIX_SHA256,
                                 CRAFT_CONTRACT_SCHEMA_SHA256)
from .craft_contracts import (CraftAdapterPlan, CraftCommand, EngineBinding,
    CraftPreflight, ResolvedCraftJob, canonical_sha256,
    craft_input_expected_sha256, craft_input_path, resolved_craft_job,
    resolved_job_binding_sha256)
from .craft_preflight import preflight_craft_job
from .creative_craft_authority import (authoritative_craft_context,
                                       load_craft_attempt_authority)


ADAPTER_COMPILER_VERSION = 'art02-adapter-compiler-v2'


def _engine(value: EngineBinding) -> dict:
    return {'name': value.name, 'version': value.version}


def _media(value) -> dict:
    return {
        'widthPixels': value.width_pixels,
        'heightPixels': value.height_pixels,
        'frameRate': value.frame_rate,
        'durationSeconds': value.duration_seconds,
        'sampleRateHz': value.sample_rate_hz,
        'channels': value.channels,
        'samplesPerChannel': value.samples_per_channel,
        'encoding': value.encoding,
        'hasAlpha': value.has_alpha,
    }


def resolved_job_snapshot(job: ResolvedCraftJob) -> dict:
    inputs = []
    for item in job.inputs:
        receipt = item.storage_receipt
        media = _media(item.media)
        if item.kind == 'image_sequence':
            media.update(frameCount=item.media.frame_count,
                         manifestSha256=item.media.manifest_sha256,
                         bundlePlanSha256=item.media.bundle_plan_sha256,
                         format=item.media.format)
        value = {
            'assetId': item.asset_id, 'ownerUserId': item.owner_user_id,
            'ownerProjectId': item.owner_project_id,
            'assetRevision': item.asset_revision, 'kind': item.kind,
            'mimeType': item.mime_type, 'bytes': item.byte_size,
            'sha256': item.sha256, 'origin': item.origin,
            'lineage': item.lineage,
            'storageReceipt': {
                'bucket': receipt.bucket, 'name': receipt.name,
                'generation': receipt.generation, 'mimeType': receipt.mime_type,
                'byteSize': receipt.byte_size, 'sha256': receipt.sha256},
            'authorizationState': item.authorization_state,
            'media': media, 'mountName': item.mount_name}
        if item.materialization is not None:
            value['materialization'] = item.materialization
        inputs.append(value)
    auth = job.authorization
    return {
        'schemaVersion': job.schema_version, 'jobId': job.job_id,
        'intentId': job.intent_id, 'originRequestId': job.origin_request_id,
        'identity': {
            'userId': job.identity.user_id,
            'googleSubject': job.identity.google_subject,
            'threadId': job.identity.thread_id,
            'uonifyProjectId': job.identity.uonify_project_id,
            'googleCloudProjectId': job.identity.google_cloud_project_id},
        'plan': {
            'creativePlanId': job.plan.creative_plan_id,
            'expectedPlanRevision': job.plan.expected_plan_revision,
            'snapshot': job.plan.snapshot,
            'snapshotSha256': job.plan.snapshot_sha256,
            'skillVersion': job.plan.skill_version},
        'target': job.target, 'engine': _engine(job.engine),
        'operation': job.operation, 'inputs': inputs,
        'inputManifestSha256': job.input_manifest_sha256,
        'authorization': {
            'mode': auth.mode, 'receiptId': auth.receipt_id,
            'maxExternalSpendUsd': str(auth.max_external_spend_usd),
            'payer': auth.payer,
            'quoteBindingSha256': auth.quote_binding_sha256,
            'quoteSha256': auth.quote_sha256,
            'costsSnapshotSha256': auth.costs_snapshot_sha256,
            'quoteMaxTotalUsd': str(auth.quote_max_total_usd),
            'quoteExpiresAt': auth.quote_expires_at},
        'limits': {
            'cpuCores': job.limits.cpu_cores,
            'memoryBytes': job.limits.memory_bytes,
            'wallSeconds': job.limits.wall_seconds,
            'outputBytes': job.limits.output_bytes,
            'networkAccess': job.limits.network_access,
            'googleCredentials': job.limits.google_credentials},
    }


def preflight_snapshot(value) -> dict:
    return {
        'schemaVersion': value.schema_version, 'ready': value.ready,
        'jobId': value.job_id, 'engine': _engine(value.engine),
        'operation': value.operation,
        'jobBindingSha256': value.job_binding_sha256,
        'capabilityMatrixSha256': value.capability_matrix_sha256,
        'contractSchemaSha256': value.contract_schema_sha256,
        'recipeSha256': value.recipe_sha256,
        'resolvedInputs': list(value.resolved_inputs),
        'externalGenerationCostUsd': value.external_generation_cost_usd,
        'craftComputeCostState': value.craft_compute_cost_state,
        'blockers': [asdict(item) for item in value.blockers],
    }


def adapter_plan_snapshot(value: CraftAdapterPlan) -> dict:
    return {
        'schemaVersion': value.schema_version, 'jobId': value.job_id,
        'inputManifestSha256': value.input_manifest_sha256,
        'engine': _engine(value.engine), 'operation': value.operation,
        'jobBindingSha256': value.job_binding_sha256,
        'inputs': list(value.inputs),
        'commands': [{'id': item.id, 'params': item.params}
                     for item in value.commands],
        'nativeProjectRelativePath': value.native_project_relative_path,
        'outputRelativePath': value.output_relative_path,
        'planSha256': value.plan_sha256,
    }


def _source_sha256() -> str:
    return sha256(Path(build_craft_adapter_plan.__code__.co_filename)
                  .read_bytes()).hexdigest()


def bind_craft_attempt_authority(c, user_id: object,
                                 attempt_id: object) -> dict:
    row = load_craft_attempt_authority(c, user_id, attempt_id)
    if not row or row['kind'] != 'craft' or row['provider_started_at'] is not None:
        raise ValueError('El intento Craft no admite ligar autoridad.')
    if row.get('craft_authority_bound_at') is not None:
        persisted_craft_context(row)
        return row
    owner = c.execute('''SELECT * FROM users WHERE id=%s
        FOR NO KEY UPDATE''', (user_id,)).fetchone()
    if not owner or owner.get('deletion_requested_at'):
        raise ValueError('La identidad Craft ya no está vigente.')
    job, adapter = authoritative_craft_context(c, owner, row)
    preflight = preflight_craft_job(job)
    rebuilt = build_craft_adapter_plan(job, preflight)
    if not preflight.ready or adapter != rebuilt:
        raise ValueError('El compilador Craft no produjo autoridad cerrada.')
    job_value = resolved_job_snapshot(job)
    preflight_value = preflight_snapshot(preflight)
    adapter_value = adapter_plan_snapshot(adapter)
    updated = c.execute('''UPDATE creative_execution_attempts SET
        craft_resolved_job_snapshot=%s,craft_job_binding_sha256=%s,
        craft_preflight_snapshot=%s,craft_preflight_sha256=%s,
        craft_adapter_plan_snapshot=%s,craft_adapter_plan_sha256=%s,
        craft_capability_matrix_sha256=%s,craft_contract_schema_sha256=%s,
        craft_adapter_compiler_version=%s,craft_adapter_source_sha256=%s,
        craft_recipe_sha256=%s,craft_resolved_input_manifest_sha256=%s,
        craft_authority_bound_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s AND status='running'
          AND provider_started_at IS NULL AND craft_authority_bound_at IS NULL
        RETURNING *''',
        (Jsonb(job_value), resolved_job_binding_sha256(job),
         Jsonb(preflight_value), canonical_sha256(preflight_value),
         Jsonb(adapter_value), adapter.plan_sha256,
         CAPABILITY_MATRIX_SHA256, CRAFT_CONTRACT_SCHEMA_SHA256,
         ADAPTER_COMPILER_VERSION, _source_sha256(),
         preflight.recipe_sha256, job.input_manifest_sha256,
         user_id, attempt_id)).fetchone()
    if not updated:
        raise ValueError('El intento Craft cambió al ligar autoridad.')
    return updated


def persisted_craft_context(row: dict) -> tuple[ResolvedCraftJob,
                                                 CraftAdapterPlan]:
    job_value = row.get('craft_resolved_job_snapshot')
    preflight_value = row.get('craft_preflight_snapshot')
    adapter_value = row.get('craft_adapter_plan_snapshot')
    if not all(isinstance(item, dict)
               for item in (job_value, preflight_value, adapter_value)):
        raise ValueError('El intento no conserva autoridad Craft previa.')
    job = resolved_craft_job(job_value)
    expected_engine = _engine(job.engine)
    expected_inputs = tuple({
        'assetId': item.asset_id,
        'assetRevision': item.asset_revision,
        'storageGeneration': item.storage_receipt.generation,
        'sha256': item.sha256,
        'inputPath': craft_input_path(item)} for item in job.inputs)
    expected_adapter_inputs = tuple({
        'assetId': item.asset_id,
        'path': craft_input_path(item),
        'expectedSha256': craft_input_expected_sha256(item),
        'storageGeneration': item.storage_receipt.generation} for item in job.inputs)
    costs = row.get('quote_snapshot', {}).get('costs')
    craft_costs = [item for item in costs or [] if isinstance(item, dict)
                   and item.get('service') == 'craft_render']
    if (resolved_job_binding_sha256(job) != row['craft_job_binding_sha256']
            or canonical_sha256(preflight_value)
            != row['craft_preflight_sha256']
            or preflight_value.get('schemaVersion') != 1
            or preflight_value.get('ready') is not True
            or preflight_value.get('blockers') != []
            or preflight_value.get('jobBindingSha256')
            != row['craft_job_binding_sha256']
            or preflight_value.get('jobId') != job.job_id
            or preflight_value.get('engine') != expected_engine
            or preflight_value.get('operation') != job.operation
            or preflight_value.get('capabilityMatrixSha256')
            != row['craft_capability_matrix_sha256']
            or preflight_value.get('contractSchemaSha256')
            != row['craft_contract_schema_sha256']
            or preflight_value.get('recipeSha256') != row['craft_recipe_sha256']
            or tuple(preflight_value.get('resolvedInputs', ())) != expected_inputs
            or preflight_value.get('externalGenerationCostUsd') != 0.0
            or preflight_value.get('craftComputeCostState')
            != 'unknown_until_infrastructure_quote'
            or job.input_manifest_sha256
            != row['craft_resolved_input_manifest_sha256']
            or row.get('craft_adapter_compiler_version')
            != ADAPTER_COMPILER_VERSION
            or row.get('craft_adapter_source_sha256') != _source_sha256()
            or len(craft_costs) != 1
            or craft_costs[0].get('component') != 'processing'
            or craft_costs[0].get('payer') != 'uonify_platform'
            or craft_costs[0].get('operationId') is not None
            or job.authorization.payer != 'platform'
            or str(job.authorization.max_external_spend_usd) != '0'):
        raise ValueError('La autoridad Craft persistida cambió.')
    required = {'schemaVersion', 'jobId', 'inputManifestSha256', 'engine',
                'operation', 'jobBindingSha256', 'inputs', 'commands',
                'nativeProjectRelativePath', 'outputRelativePath', 'planSha256'}
    if set(adapter_value) != required:
        raise ValueError('El adapter Craft persistido no coincide.')
    body = {key: adapter_value[key] for key in required - {'planSha256'}}
    if (adapter_value['schemaVersion'] != 1
            or adapter_value['jobId'] != job.job_id
            or adapter_value['inputManifestSha256']
            != job.input_manifest_sha256
            or adapter_value['engine'] != expected_engine
            or adapter_value['operation'] != job.operation
            or adapter_value['jobBindingSha256']
            != row['craft_job_binding_sha256']
            or tuple(adapter_value['inputs']) != expected_adapter_inputs
            or canonical_sha256(body) != adapter_value['planSha256']
            or adapter_value['planSha256'] != row['craft_adapter_plan_sha256']):
        raise ValueError('El adapter Craft persistido cambió.')
    engine = adapter_value['engine']
    adapter = CraftAdapterPlan(
        adapter_value['schemaVersion'], adapter_value['jobId'],
        adapter_value['inputManifestSha256'],
        EngineBinding(engine['name'], engine['version']),
        adapter_value['operation'], adapter_value['jobBindingSha256'],
        tuple(adapter_value['inputs']),
        tuple(CraftCommand(item['id'], item['params'])
              for item in adapter_value['commands']),
        adapter_value['nativeProjectRelativePath'],
        adapter_value['outputRelativePath'], adapter_value['planSha256'])
    persisted_preflight = CraftPreflight(
        1, True, job.job_id, job.engine, job.operation,
        row['craft_job_binding_sha256'], row['craft_capability_matrix_sha256'],
        row['craft_contract_schema_sha256'], row['craft_recipe_sha256'],
        expected_inputs, 0.0, 'unknown_until_infrastructure_quote', ())
    if build_craft_adapter_plan(job, persisted_preflight) != adapter:
        raise ValueError('Los comandos Craft no coinciden con el compilador ligado.')
    return job, adapter
