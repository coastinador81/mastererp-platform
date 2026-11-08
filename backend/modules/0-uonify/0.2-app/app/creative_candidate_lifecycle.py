"""Durable candidate, quarantine, evaluation, review and release receipts.

This module has no route or worker and cannot publish. Every transition is
server-owned, account-scoped and bound to immutable attempt/asset receipts.
"""

from dataclasses import asdict, dataclass
from uuid import UUID

from psycopg.types.json import Jsonb

from .craft_candidate import accept_candidate_result
from .craft_contracts import CraftAdapterPlan, CraftAttempt, ResolvedCraftJob
from .creative_asset_contract import CreativeAssetSnapshot, _media
from .creative_asset_registry import persist_quarantined_creative_asset
from .creative_candidate_contract import (stamp_candidate_receipt,
                                           validate_candidate_draft)
from .creative_candidate_projection import (project_candidate_binding,
    project_candidate_outputs, project_effect_frame_bundle_output)
from .creative_composite_quote import canonical_sha256
from .creative_craft_authority import load_craft_attempt_authority
from .creative_craft_attempt_authority import persisted_craft_context
from .creative_execution_coordinator import CreativeAttemptClaim
from .creative_effect_frame_bundle import EffectFrameBundleReceipt
from .creative_native_project_registry import (
    NativeProjectSnapshot, link_candidate_native_project,
    native_project_provider_item, persist_quarantined_native_project)


@dataclass(frozen=True)
class CandidateLifecycleReceipt:
    candidate_id: str
    state: str
    version: int
    receipt_sha256: str
    created: bool
    publication_authorized: bool = False


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    if parsed != str(value):
        raise ValueError(f'{label} no es UUID canónico.')
    return parsed


def _owner(c, user: dict, *, lock: bool = True) -> dict:
    suffix = ' FOR NO KEY UPDATE' if lock else ''
    row = c.execute('SELECT * FROM users WHERE id=%s' + suffix,
                    (user.get('id'),)).fetchone()
    if (not row or row['google_subject'] != user.get('google_subject')
            or row.get('deletion_requested_at')):
        raise ValueError('La identidad propietaria ya no está vigente.')
    return row


def _candidate(c, owner: dict, candidate_id: object, *, lock: bool = False
               ) -> tuple[dict, dict]:
    key = _uuid(candidate_id, 'candidateId')
    suffix = ' FOR UPDATE OF s' if lock else ''
    row = c.execute('''SELECT r.*,s.state,s.version,s.quarantine_set_sha256,
        s.accepted_for_use,s.publication_authorized AS state_publication
        FROM creative_candidate_receipts r JOIN creative_candidate_states s
          ON s.user_id=r.user_id AND s.candidate_id=r.id
        WHERE r.user_id=%s AND r.id=%s''' + suffix,
        (owner['id'], key)).fetchone()
    if not row:
        raise ValueError('No se encuentra el candidato creativo.')
    return row, row['receipt']


def _prior_candidate_receipt(c, owner_id: object,
                             value: dict) -> CandidateLifecycleReceipt | None:
    prior = c.execute('''SELECT r.id,r.candidate_content_sha256,
        r.candidate_receipt_sha256,r.receipt,s.state,s.version
        FROM creative_candidate_receipts r JOIN creative_candidate_states s
          ON s.user_id=r.user_id AND s.candidate_id=r.id
        WHERE r.user_id=%s AND r.attempt_id=%s''',
        (owner_id, value['attemptId'])).fetchone()
    if not prior:
        return None
    stored_draft = {key: item for key, item in prior['receipt'].items()
                    if key not in ('receivedAt', 'candidateReceiptSha256')}
    if (str(prior['id']) != value['candidateId']
            or prior['candidate_content_sha256']
            != value['candidateContentSha256'] or stored_draft != value):
        raise ValueError('El intento Craft ya liga otro candidato.')
    return CandidateLifecycleReceipt(
        value['candidateId'], prior['state'], prior['version'],
        prior['candidate_receipt_sha256'], False)


def persist_candidate_receipt(c, user: dict, receipt: dict, *,
                              claim: CreativeAttemptClaim,
                              craft_job: ResolvedCraftJob,
                              adapter_plan: CraftAdapterPlan,
                              candidate_result: dict,
                              effect_bundle_receipt: EffectFrameBundleReceipt | None = None
                              ) -> CandidateLifecycleReceipt:
    value = validate_candidate_draft(receipt)
    if (not isinstance(claim, CreativeAttemptClaim)
            or not isinstance(craft_job, ResolvedCraftJob)
            or not isinstance(adapter_plan, CraftAdapterPlan)
            or not isinstance(candidate_result, dict)):
        raise ValueError('Falta la validación canónica del candidato Craft.')
    acceptance = accept_candidate_result(
        craft_job, CraftAttempt(claim.job_id, claim.attempt_id, claim.lease_token),
        adapter_plan, candidate_result)
    identities = tuple({key: item[key] for key in (
        'outputId', 'assetId', 'revision')} for item in value['outputs'])
    if effect_bundle_receipt is None:
        projected_outputs = project_candidate_outputs(
            craft_job, adapter_plan, candidate_result, identities)
    elif len(identities) == 1:
        projected_outputs = [project_effect_frame_bundle_output(
            craft_job, adapter_plan, candidate_result,
            effect_bundle_receipt, identities[0])]
    else:
        raise ValueError('El bundle EffectCraft debe producir un solo asset.')
    binding = project_candidate_binding(craft_job, adapter_plan, candidate_result)
    raw_native, native = candidate_result.get('nativeProject'), value['nativeProject']
    native_matches = (isinstance(raw_native, dict)
        and raw_native.get('relativePath') == native['relativePath']
        and raw_native.get('mimeType') == native['mimeType']
        and raw_native.get('bytes') == native['byteSize']
        and raw_native.get('sha256') == native['sha256'])
    if (not acceptance.accepted or acceptance.publication_authorized
            or acceptance.candidate_result_sha256 != value['craftCandidateResultSha256']
            or claim.user_id != value['ownerUserId']
            or claim.job_id != value['jobId'] or claim.step_id != value['stepId']
            or claim.attempt_id != value['attemptId']
            or claim.attempt_no != value['attemptNo']
            or claim.lease_token != value['leaseToken']
            or claim.fence_epoch != value['fenceEpoch'] or claim.kind != 'craft'
            or claim.admission_sha256 != value['admissionSha256']
            or claim.claim_set_sha256 != value['claimSetSha256']
            or claim.execution_authorized or claim.publication_authorized
            or any(value[key] != expected for key, expected in binding.items())
            or adapter_plan.job_id != claim.job_id
            or adapter_plan.plan_sha256 != value['adapterPlanSha256']
            or craft_job.job_id != claim.job_id
            or craft_job.input_manifest_sha256 != value['inputManifestSha256']
            or not native_matches or value['outputs'] != projected_outputs
            or value['outputManifestSha256']
            != canonical_sha256(projected_outputs)):
        raise ValueError('El candidato no coincide con accept_candidate_result.')
    owner = _owner(c, user)
    if value['ownerUserId'] != str(owner['id']):
        raise ValueError('El candidato pertenece a otra cuenta.')
    if prior := _prior_candidate_receipt(c, owner['id'], value):
        return prior
    locked = c.execute('''SELECT id FROM creative_execution_attempts
        WHERE user_id=%s AND id=%s FOR UPDATE''',
        (owner['id'], value['attemptId'])).fetchone()
    if not locked:
        raise ValueError('El candidato no corresponde al lease Craft activo.')
    if prior := _prior_candidate_receipt(c, owner['id'], value):
        return prior
    attempt = load_craft_attempt_authority(
        c, owner['id'], value['attemptId'])
    project = str(attempt['uonify_project_id']) if attempt and attempt['uonify_project_id'] else None
    execution = (attempt['quote_snapshot'].get('execution')
                 if attempt and isinstance(attempt['quote_snapshot'], dict) else None)
    now = c.execute('SELECT clock_timestamp() value').fetchone()['value']
    if (not attempt or attempt['status'] != 'running'
            or attempt['lease_until'] is None or attempt['lease_until'] <= now
            or str(attempt['lease_token']) != claim.lease_token
            or str(attempt['claim_lease_token']) != claim.lease_token
            or attempt['step_status'] != 'running' or attempt['job_status'] != 'running'
            or str(attempt['step_lease']) != claim.lease_token
            or str(attempt['job_lease']) != claim.lease_token
            or attempt['provider_started_at'] is None
            or attempt['provider_returned_at'] is None
            or attempt['provider_receipt'] != candidate_result
            or attempt['result_receipt'] != candidate_result
            or attempt['result_sha256'] != canonical_sha256(candidate_result)
            or attempt['kind'] != 'craft'
            or str(attempt['job_id']) != value['jobId']
            or str(attempt['step_id']) != value['stepId']
            or attempt['attempt_no'] != value['attemptNo']
            or attempt['fence_epoch'] != value['fenceEpoch']
            or str(attempt['admission_id']) != value['admissionId']
            or attempt['admission_sha256'] != value['admissionSha256']
            or attempt['claim_set_sha256'] != value['claimSetSha256']
            or attempt['execution_graph_sha256'] != value['executionGraphSha256']
            or attempt['edit_recipe_sha256'] != value['recipeSha256']
            or craft_job.identity.user_id != str(owner['id'])
            or craft_job.identity.google_subject != owner['google_subject']
            or craft_job.identity.uonify_project_id != project
            or craft_job.identity.thread_id != attempt['thread_id']
            or craft_job.identity.google_cloud_project_id
            != attempt['google_project_id']
            or craft_job.plan.creative_plan_id != str(attempt['plan_id'])
            or craft_job.plan.expected_plan_revision != attempt['plan_revision']
            or not isinstance(execution, dict)
            or execution.get('engine') != {
                'name': craft_job.engine.name, 'version': craft_job.engine.version}
            or execution.get('adapterOperation') != craft_job.operation
            or craft_job.authorization.mode != 'approved'
            or craft_job.authorization.receipt_id != str(attempt['approval_id'])
            or craft_job.authorization.quote_sha256 != attempt['quote_sha256']
            or craft_job.authorization.quote_binding_sha256
            != attempt['binding_sha256']
            or craft_job.authorization.costs_snapshot_sha256
            != attempt['costs_snapshot_sha256']
            or craft_job.authorization.quote_max_total_usd
            != attempt['max_total_usd']
            or craft_job.authorization.quote_expires_at
            != attempt['expires_at'].isoformat()
            or project != value['uonifyProjectId']):
        raise ValueError('El candidato no corresponde al lease Craft activo.')
    authoritative_job, authoritative_adapter = persisted_craft_context(attempt)
    if craft_job != authoritative_job or adapter_plan != authoritative_adapter:
        raise ValueError('El contexto Craft no procede de autoridad persistida.')
    stored = stamp_candidate_receipt(value, now)
    c.execute('''INSERT INTO creative_candidate_receipts
        (user_id,id,uonify_project_id,job_id,step_id,attempt_id,attempt_no,
         lease_token,fence_epoch,admission_id,admission_sha256,claim_set_sha256,
         execution_graph_sha256,job_binding_sha256,input_manifest_sha256,
         recipe_sha256,adapter_plan_sha256,capability_matrix_sha256,
         output_manifest_sha256,craft_candidate_result_sha256,
         candidate_content_sha256,candidate_receipt_sha256,receipt,received_at,
         receipt_authority)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
               %s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], value['candidateId'], value['uonifyProjectId'],
         value['jobId'], value['stepId'], value['attemptId'], value['attemptNo'],
         value['leaseToken'], value['fenceEpoch'], value['admissionId'],
         value['admissionSha256'],
         value['claimSetSha256'], value['executionGraphSha256'],
         value['jobBindingSha256'], value['inputManifestSha256'],
         value['recipeSha256'], value['adapterPlanSha256'],
         value['capabilityMatrixSha256'], value['outputManifestSha256'],
         value['craftCandidateResultSha256'], value['candidateContentSha256'],
         stored['candidateReceiptSha256'], Jsonb(stored), stored['receivedAt'],
         'server_clock'))
    c.execute('''INSERT INTO creative_candidate_states(user_id,candidate_id,state)
        VALUES(%s,%s,'received')''', (owner['id'], value['candidateId']))
    return CandidateLifecycleReceipt(
        value['candidateId'], 'received', 1,
        stored['candidateReceiptSha256'], True)


def _storage_receipt(snapshot: CreativeAssetSnapshot) -> dict:
    receipt = asdict(snapshot.storage_receipt)
    return {'bucket': receipt['bucket'], 'name': receipt['name'],
            'generation': receipt['generation'], 'mimeType': receipt['mime_type'],
            'byteSize': receipt['byte_size'], 'sha256': receipt['sha256']}


def _craft_lineage(output: dict, receipt: dict,
                   input_claims: list[dict]) -> dict:
    raw = output.get('lineage')
    sources = raw.get('sources') if isinstance(raw, dict) else None
    if not isinstance(sources, list):
        raise ValueError('La salida no conserva el linaje Craft canónico.')
    expected = [{'assetId': item.get('assetId'), 'revision': item.get('assetRevision')}
                for item in input_claims if isinstance(item, dict)]
    if (len(expected) != len(input_claims) or sources != expected
            or (receipt['engine']['name'] in ('filmcraft', 'photocraft')
                and not sources)):
        raise ValueError('Las fuentes Craft no coinciden exactamente con la admisión.')
    expanded = [{'assetId': source['assetId'],
                 'revision': source['revision'],
                 'snapshotSha256': claim['snapshotSha256']}
                for source, claim in zip(sources, input_claims)]
    if any(not isinstance(item['snapshotSha256'], str) for item in expanded):
        raise ValueError('Una fuente Craft no conserva el snapshot admitido.')
    return {'origin': 'craft', 'sources': expanded,
            'recipeSha256': receipt['recipeSha256'],
            'jobBindingSha256': receipt['jobBindingSha256'],
            'engine': receipt['engine']['name'],
            'operation': receipt['engine']['operation'],
            'resultSha256': output['sha256']}


def quarantine_candidate_outputs(
        c, user: dict, candidate_id: UUID, quarantine_id: UUID,
        snapshots: tuple[CreativeAssetSnapshot, ...], *,
        adoption_claim: CreativeAttemptClaim,
        native_project_snapshot: NativeProjectSnapshot | None = None
        ) -> CandidateLifecycleReceipt:
    owner = _owner(c, user)
    candidate, receipt = _candidate(c, owner, candidate_id, lock=True)
    if not isinstance(snapshots, tuple) or len(snapshots) != len(receipt['outputs']):
        raise ValueError('Los snapshots no corresponden a todas las salidas.')
    if (not isinstance(adoption_claim, CreativeAttemptClaim)
            or adoption_claim.kind != 'candidate_adopt'
            or not adoption_claim.provider_call
            or adoption_claim.user_id != str(owner['id'])
            or adoption_claim.job_id != str(candidate['job_id'])
            or adoption_claim.admission_sha256 != candidate['admission_sha256']
            or adoption_claim.claim_set_sha256 != candidate['claim_set_sha256']
            or adoption_claim.execution_authorized
            or adoption_claim.publication_authorized):
        raise ValueError('Falta el intento cercado de adopción post-Craft.')
    adoption = c.execute('''SELECT t.*,s.kind,s.depends_on,s.status AS step_status,
        s.lease_token AS step_lease,s.provider_receipt,
        j.status AS job_status,j.lease_token AS job_lease,
        j.execution_graph_sha256,d.input_claims
        FROM creative_execution_attempts t
        JOIN creative_execution_steps s ON s.user_id=t.user_id
          AND s.job_id=t.job_id AND s.step_id=t.step_id
        JOIN creative_execution_jobs j ON j.user_id=t.user_id AND j.id=t.job_id
        JOIN creative_execution_admissions d
          ON d.user_id=t.user_id AND d.id=t.admission_id
        WHERE t.user_id=%s AND t.id=%s FOR SHARE OF t,s,j,d''',
        (owner['id'], adoption_claim.attempt_id)).fetchone()
    source = c.execute('''SELECT status FROM creative_execution_attempts
        WHERE user_id=%s AND id=%s FOR SHARE''',
        (owner['id'], candidate['attempt_id'])).fetchone()
    if (not adoption or not source or source['status'] != 'succeeded'
            or adoption['kind'] != 'candidate_adopt'
            or str(adoption['job_id']) != adoption_claim.job_id
            or str(adoption['claim_lease_token']) != adoption_claim.lease_token
            or adoption['attempt_no'] != adoption_claim.attempt_no
            or adoption['fence_epoch'] != adoption_claim.fence_epoch
            or str(adoption['step_id']) != adoption_claim.step_id
            or str(adoption['admission_id']) != str(candidate['admission_id'])
            or adoption['admission_sha256'] != adoption_claim.admission_sha256
            or adoption['claim_set_sha256'] != adoption_claim.claim_set_sha256
            or adoption['depends_on'] != [str(candidate['step_id'])]
            or adoption['execution_graph_sha256'] != candidate['execution_graph_sha256']):
        raise ValueError('La adopción no sucede al candidato Craft exacto.')
    qid = _uuid(quarantine_id, 'quarantineId')
    native_required = receipt['engine']['name'] in ('filmcraft', 'photocraft')
    if native_required != isinstance(native_project_snapshot,
                                     NativeProjectSnapshot):
        raise ValueError('Film/Photo requieren proyecto nativo durable exacto.')
    items = []
    for output, snapshot in zip(receipt['outputs'], snapshots):
        lineage = _craft_lineage(output, receipt, adoption['input_claims'])
        media_kind = ('image_sequence' if output['mimeType'] == 'application/zip'
                      else output['mimeType'].split('/', 1)[0])
        expected_kind, expected_media, _ = _media(
            {'kind': media_kind, **output['media']})
        if (not isinstance(snapshot, CreativeAssetSnapshot)
                or snapshot.asset_id != output['assetId']
                or snapshot.revision != output['revision']
                or snapshot.owner_user_id != str(owner['id'])
                or snapshot.owner_project_id != receipt['uonifyProjectId']
                or snapshot.role != output['role']
                or snapshot.kind != expected_kind
                or snapshot.mime_type != output['mimeType']
                or snapshot.byte_size != output['byteSize']
                or snapshot.sha256 != output['sha256']
                or snapshot.media != expected_media
                or snapshot.lineage != lineage
                or snapshot.source_step_id != adoption_claim.step_id):
            raise ValueError('Un snapshot de cuarentena no coincide con su salida.')
        item = {'outputId': output['outputId'], 'assetId': snapshot.asset_id,
                'revision': snapshot.revision,
                'snapshotSha256': snapshot.snapshot_sha256,
                'storageReceipt': _storage_receipt(snapshot)}
        item['itemReceiptSha256'] = canonical_sha256(item)
        items.append(item)
    native_item = None
    if native_required:
        native_item = {
            'projectId': native_project_snapshot.project_id,
            'revision': native_project_snapshot.revision,
            'snapshotSha256': native_project_snapshot.snapshot_sha256,
            'storageReceipt': _storage_receipt(native_project_snapshot)}
        native_item['itemReceiptSha256'] = canonical_sha256(native_item)
    set_sha = canonical_sha256(
        {'items': items, 'nativeProject': native_item}
        if native_required else items)
    expected_provider = {
        'schemaVersion': 2 if native_required else 1,
        'candidateId': str(candidate['id']),
        'storageReceipts': [
            {'assetId': item['assetId'], 'revision': item['revision'],
             'receipt': item['storageReceipt']} for item in items]}
    if native_required:
        if (native_project_snapshot.candidate_id != str(candidate['id'])
                or native_project_snapshot.source_job_id != str(candidate['job_id'])
                or native_project_snapshot.source_step_id != adoption_claim.step_id
                or native_project_snapshot.owner_user_id != str(owner['id'])
                or native_project_snapshot.owner_project_id
                != receipt['uonifyProjectId']
                or native_project_snapshot.engine != receipt['engine']['name']
                or native_project_snapshot.operation != receipt['engine']['operation']
                or native_project_snapshot.execution_graph_sha256
                != candidate['execution_graph_sha256']
                or native_project_snapshot.input_claim_set_sha256
                != candidate['claim_set_sha256']):
            raise ValueError('El proyecto nativo no corresponde a la adopción.')
        expected_provider['nativeProjectReceipt'] = (
            native_project_provider_item(native_project_snapshot))
    if (adoption['provider_receipt'] != expected_provider
            or adoption.get('result_receipt') != expected_provider
            or adoption.get('result_sha256') != canonical_sha256(expected_provider)):
        raise ValueError('La adopción post-Craft no liga los recibos GCS exactos.')
    prior = c.execute('''SELECT * FROM creative_candidate_quarantines
        WHERE user_id=%s AND candidate_id=%s''',
        (owner['id'], candidate['id'])).fetchone()
    if prior:
        stored = c.execute('''SELECT ordinal,output_id,asset_id,revision,
            snapshot_sha256,storage_receipt,item_receipt_sha256
            FROM creative_candidate_quarantine_assets
            WHERE user_id=%s AND candidate_id=%s ORDER BY ordinal''',
            (owner['id'], candidate['id'])).fetchall()
        expected_rows = [dict(ordinal=index, output_id=UUID(item['outputId']),
            asset_id=UUID(item['assetId']), revision=item['revision'],
            snapshot_sha256=item['snapshotSha256'],
            storage_receipt=item['storageReceipt'],
            item_receipt_sha256=item['itemReceiptSha256'])
            for index, item in enumerate(items)]
        native_link = c.execute('''SELECT project_id,revision,snapshot_sha256
            FROM creative_candidate_native_projects
            WHERE user_id=%s AND candidate_id=%s''',
            (owner['id'], candidate['id'])).fetchone()
        expected_native = (None if not native_required else {
            'project_id': UUID(native_project_snapshot.project_id),
            'revision': native_project_snapshot.revision,
            'snapshot_sha256': native_project_snapshot.snapshot_sha256})
        if (str(prior['id']) != qid or prior['quarantine_set_sha256'] != set_sha
                or str(prior['adoption_attempt_id']) != adoption_claim.attempt_id
                or str(prior['adoption_lease_token']) != adoption_claim.lease_token
                or prior['adoption_fence_epoch'] != adoption_claim.fence_epoch
                or prior['adoption_result_sha256'] != adoption['result_sha256']
                or stored != expected_rows
                or (dict(native_link) if native_link else None) != expected_native):
            raise ValueError('El candidato ya liga otra cuarentena.')
        return CandidateLifecycleReceipt(
            str(candidate['id']), candidate['state'], candidate['version'],
            set_sha, False)
    now = c.execute('SELECT clock_timestamp() value').fetchone()['value']
    if (adoption['status'] != 'running' or adoption['step_status'] != 'running'
            or adoption['job_status'] != 'running'
            or adoption['lease_until'] is None or adoption['lease_until'] <= now
            or str(adoption['lease_token']) != adoption_claim.lease_token
            or str(adoption['step_lease']) != adoption_claim.lease_token
            or str(adoption['job_lease']) != adoption_claim.lease_token
            or adoption['provider_started_at'] is None
            or adoption['provider_returned_at'] is None):
        raise ValueError('El lease de adopción ya no está vigente.')
    if candidate['state'] != 'received':
        raise ValueError('El candidato ya no admite una cuarentena nueva.')
    for snapshot in snapshots:
        persist_quarantined_creative_asset(
            c, owner, UUID(str(candidate['job_id'])), snapshot)
    quarantine = {'schemaVersion': 2 if native_required else 1,
                  'quarantineId': qid,
                  'candidateId': str(candidate['id']), 'items': items,
                  'quarantineSetSha256': set_sha,
                  'publicationAuthorized': False}
    if native_required:
        quarantine['nativeProject'] = native_item
    c.execute('''INSERT INTO creative_candidate_quarantines
        (user_id,candidate_id,id,job_id,adoption_step_id,adoption_attempt_id,
         adoption_attempt_no,adoption_lease_token,adoption_fence_epoch,
         admission_id,admission_sha256,claim_set_sha256,adoption_result_sha256,
         quarantine_set_sha256,item_count,receipt)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], candidate['id'], qid, candidate['job_id'],
         adoption['step_id'], adoption['id'], adoption['attempt_no'],
         adoption['claim_lease_token'], adoption['fence_epoch'],
         adoption['admission_id'], adoption['admission_sha256'],
         adoption['claim_set_sha256'], adoption['result_sha256'], set_sha,
         len(items), Jsonb(quarantine)))
    if native_required:
        persist_quarantined_native_project(c, owner, native_project_snapshot)
        link_candidate_native_project(c, owner['id'], native_project_snapshot)
    for ordinal, item in enumerate(items):
        c.execute('''INSERT INTO creative_candidate_quarantine_assets
            (user_id,candidate_id,ordinal,output_id,asset_id,revision,
             snapshot_sha256,storage_receipt,item_receipt_sha256)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (owner['id'], candidate['id'], ordinal, item['outputId'],
             item['assetId'], item['revision'], item['snapshotSha256'],
             Jsonb(item['storageReceipt']), item['itemReceiptSha256']))
    updated = c.execute('''UPDATE creative_candidate_states
        SET state='quarantined',version=version+1,quarantine_set_sha256=%s,
            updated_at=now() WHERE user_id=%s AND candidate_id=%s
          AND state='received' AND version=%s RETURNING version''',
        (set_sha, owner['id'], candidate['id'], candidate['version'])).fetchone()
    if not updated:
        raise ValueError('El estado del candidato cambió durante la cuarentena.')
    return CandidateLifecycleReceipt(
        str(candidate['id']), 'quarantined', updated['version'], set_sha, True)


def _quarantine_items(c, owner_id, candidate_id) -> list[dict]:
    return c.execute('''SELECT q.asset_id,q.revision,q.snapshot_sha256,r.kind,
        r.mime_type,r.byte_size,r.sha256,r.storage_generation,r.media,
        r.craft_blockers
        FROM creative_candidate_quarantine_assets q
        JOIN creative_asset_revisions r ON r.user_id=q.user_id
          AND r.asset_id=q.asset_id AND r.revision=q.revision
        WHERE q.user_id=%s AND q.candidate_id=%s ORDER BY q.ordinal''',
        (owner_id, candidate_id)).fetchall()

# Public compatibility surface; implementation is split to keep modules small.
from .creative_candidate_review_lifecycle import (  # noqa: E402,F401
    evaluate_candidate, persist_candidate_evaluation, persist_candidate_review,
    release_candidate_assets)
