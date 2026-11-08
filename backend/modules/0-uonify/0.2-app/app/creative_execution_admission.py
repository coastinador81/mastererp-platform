"""Transactional admission for the shared creative execution backlog.

The receipt binds durable approval state and current input assets. Admission
only exposes dependency roots to the queue; dispatch, execution and publication
remain false and no provider is called here.
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from psycopg.types.json import Jsonb

from .creative_asset_registry import resolve_creative_assets_for_craft
from .creative_composite_quote import canonical_sha256
from .creative_execution_ledger import validate_active_execution_scope
from .creative_execution_rehydration import (
    rehydrate_admitted_execution, rehydrate_held_execution)


@dataclass(frozen=True)
class CreativeExecutionAdmissionPreview:
    job_id: str
    approval_id: str
    quote_id: str
    execution_graph_sha256: str
    admission_sha256: str
    expires_at: str
    step_count: int
    prerequisites_current: bool = True
    dispatch_authorized: bool = False
    execution_authorized: bool = False
    publication_authorized: bool = False


@dataclass(frozen=True)
class CreativeExecutionAdmissionReceipt:
    admission_id: str
    job_id: str
    admission_sha256: str
    input_claim_set_sha256: str
    input_claim_count: int
    queued_root_count: int
    status: str = 'queued'
    dispatch_authorized: bool = False
    execution_authorized: bool = False
    publication_authorized: bool = False


def _locked_context(c, user: dict, job_id: str) -> tuple[dict, dict]:
    owner = c.execute('''SELECT * FROM users WHERE id=%s
        FOR NO KEY UPDATE''', (user.get('id'),)).fetchone()
    if (not owner or owner['google_subject'] != user.get('google_subject')
            or owner.get('deletion_requested_at')):
        raise ValueError('La identidad propietaria ya no está vigente.')
    row = c.execute('''SELECT j.*,a.quote_id,a.approved_at,q.uonify_project_id,
        q.input_manifest,q.quote_snapshot,q.expires_at,q.quote_sha256,
        q.binding_sha256,q.costs_snapshot_sha256
        FROM creative_execution_jobs j
        JOIN creative_execution_approvals a
          ON a.user_id=j.user_id AND a.id=j.approval_id
        JOIN creative_execution_quotes q
          ON q.user_id=a.user_id AND q.id=a.quote_id
        WHERE j.user_id=%s AND j.id=%s FOR UPDATE OF j''',
        (owner['id'], job_id)).fetchone()
    if not row:
        raise ValueError('No se encuentra el trabajo creativo.')
    return owner, row


def _input_references(manifest: object) -> tuple[tuple[UUID, int], ...]:
    """Only explicit durable input references participate at admission time."""
    if not isinstance(manifest, list):
        raise ValueError('El manifiesto de entrada persistido no es verificable.')
    references = []
    for item in manifest:
        if not isinstance(item, dict):
            raise ValueError('El manifiesto de entrada persistido no es verificable.')
        if 'assetId' not in item and 'revision' not in item:
            continue
        if (set(('assetId', 'revision')) - set(item)
                or not isinstance(item['revision'], int)
                or isinstance(item['revision'], bool)):
            raise ValueError('Un input durable no liga asset y revisión.')
        try:
            references.append((UUID(str(item['assetId'])), item['revision']))
        except (TypeError, ValueError, AttributeError):
            raise ValueError('Un input durable no liga asset y revisión.') from None
    return tuple(references)


def _claim_set(c, user: dict, project, references, *,
               lock_reads: bool = True) -> tuple[list[dict], str]:
    project_key = UUID(str(project)) if project else None
    if references:
        ordered = sorted(references, key=lambda item: (str(item[0]), item[1]))
        asset_ids = [str(item[0]) for item in ordered]
        revisions = [item[1] for item in ordered]
        suffix = ' FOR SHARE' if lock_reads else ''
        c.execute('''SELECT id FROM creative_assets
            WHERE user_id=%s AND id=ANY(%s::uuid[])
            ORDER BY id''' + suffix, (user['id'], asset_ids)).fetchall()
        c.execute('''SELECT asset_id,revision FROM creative_asset_revisions
            WHERE user_id=%s
              AND (asset_id,revision) IN (
                SELECT * FROM unnest(%s::uuid[],%s::integer[]))
            ORDER BY asset_id,revision''' + suffix,
            (user['id'], asset_ids, revisions)).fetchall()
        bundle = resolve_creative_assets_for_craft(
            c, user, references, project_key,
            allow_pending_materialization=True, lock_reads=lock_reads)
        return [{
            'assetId': item.asset_id,
            'assetRevision': item.revision,
            'snapshotSha256': item.snapshot_sha256,
            'mountName': item.mount_name,
            'storageReceipt': item.craft_payload['storageReceipt'],
        } for item in bundle.claims], bundle.claim_set_sha256
    body = {'schemaVersion': 1,
            'uonifyProjectId': str(project) if project else None,
            'assets': []}
    return [], canonical_sha256(body)


def _base_admission_body(restored, row: dict) -> dict:
    return {
        'schemaVersion': 1, 'jobId': restored.job_id,
        'approvalId': restored.approval_id, 'quoteId': restored.quote_id,
        'quoteSha256': row['quote_sha256'],
        'bindingSha256': row['binding_sha256'],
        'costsSnapshotSha256': row['costs_snapshot_sha256'],
        'executionGraphSha256': restored.execution_graph_sha256,
        'expiresAt': row['expires_at'].isoformat(),
        'steps': [{'stepId': step.step_id, 'ordinal': step.ordinal,
                   'kind': step.kind, 'authoritySha256': step.authority_sha256,
                   'dependsOn': list(step.depends_on),
                   'providerCall': step.provider_call}
                  for step in restored.steps],
    }


def _admission_body(owner: dict, row: dict, restored,
                    claims: list[dict], claim_sha: str) -> dict:
    return {
        'schemaVersion': 2, 'ownerUserId': str(owner['id']),
        'uonifyProjectId': (str(row['uonify_project_id'])
                            if row['uonify_project_id'] else None),
        'jobId': restored.job_id, 'approvalId': restored.approval_id,
        'quoteId': restored.quote_id,
        'baseAdmissionSha256': canonical_sha256(
            _base_admission_body(restored, row)),
        'quoteSha256': row['quote_sha256'],
        'bindingSha256': row['binding_sha256'],
        'costsSnapshotSha256': row['costs_snapshot_sha256'],
        'executionGraphSha256': restored.execution_graph_sha256,
        'inputClaimSetSha256': claim_sha, 'inputClaims': claims,
    }


def preview_held_admission(c, user: dict, job_id: UUID, *,
                           now: datetime | None = None
                           ) -> CreativeExecutionAdmissionPreview:
    checked_at = now or c.execute(
        'SELECT clock_timestamp() value').fetchone()['value']
    if not checked_at.tzinfo:
        raise ValueError('La fecha de preadmisión no incluye zona horaria.')
    restored = rehydrate_held_execution(c, user, job_id)
    row = c.execute('''SELECT j.status,j.dispatch_authorized,j.claim_count,
        j.lease_token,j.finished_at,a.approved_at,q.expires_at,
        q.quote_sha256,q.binding_sha256,q.costs_snapshot_sha256
        FROM creative_execution_jobs j
        JOIN creative_execution_approvals a
          ON a.user_id=j.user_id AND a.id=j.approval_id
        JOIN creative_execution_quotes q
          ON q.user_id=a.user_id AND q.id=a.quote_id
        WHERE j.user_id=%s AND j.id=%s FOR SHARE OF j,a,q''',
        (user['id'], restored.job_id)).fetchone()
    if (not row or row['status'] != 'held' or row['dispatch_authorized']
            or row['claim_count'] != 0 or row['lease_token'] is not None
            or row['finished_at'] is not None):
        raise ValueError('El trabajo ya no está exactamente retenido.')
    if (row['approved_at'] >= row['expires_at']
            or checked_at >= row['expires_at']):
        raise ValueError('La cotización aprobada ha caducado antes de admitir.')
    body = _base_admission_body(restored, row)
    return CreativeExecutionAdmissionPreview(
        restored.job_id, restored.approval_id, restored.quote_id,
        restored.execution_graph_sha256, canonical_sha256(body),
        row['expires_at'].isoformat(), len(restored.steps))


def _receipt(row: dict, queued_roots: int) -> CreativeExecutionAdmissionReceipt:
    return CreativeExecutionAdmissionReceipt(
        str(row['id']), str(row['job_id']), row['admission_sha256'],
        row['input_claim_set_sha256'], len(row['input_claims']), queued_roots)


def _expiry_allows(current: datetime, expires_at: datetime,
                   require_unexpired: bool) -> bool:
    return not require_unexpired or current < expires_at


def admit_held_execution(c, user: dict,
                         job_id: UUID) -> CreativeExecutionAdmissionReceipt:
    """Atomically bind inputs and expose only dependency roots as queued."""
    checked_at = c.execute(
        'SELECT clock_timestamp() value').fetchone()['value']
    job_key = str(UUID(str(job_id)))
    owner, row = _locked_context(c, user, job_key)
    prior = c.execute('''SELECT * FROM creative_execution_admissions
        WHERE user_id=%s AND job_id=%s FOR SHARE''',
        (owner['id'], job_key)).fetchone()
    references = _input_references(row['input_manifest'])
    claims, claim_sha = _claim_set(
        c, owner, row['uonify_project_id'], references)
    if prior:
        verified = revalidate_admission_claims(c, owner, job_id)
        steps = c.execute('''SELECT depends_on,status
            FROM creative_execution_steps WHERE user_id=%s AND job_id=%s
            ORDER BY ordinal FOR SHARE''', (owner['id'], job_key)).fetchall()
        attempts = c.execute('''SELECT count(*) n
            FROM creative_execution_attempts WHERE user_id=%s AND job_id=%s''',
            (owner['id'], job_key)).fetchone()['n']
        exact = (row['status'] == 'queued' and row['claim_count'] == 0
                 and row['lease_token'] is None and row['finished_at'] is None
                 and attempts == 0 and all(
                     item['status'] == ('queued' if not item['depends_on'] else 'held')
                     for item in steps))
        if not exact:
            raise ValueError('La admisión ya avanzó y no puede repetirse.')
        roots = sum(not item['depends_on'] for item in steps)
        return _receipt(verified, roots)
    if row['status'] != 'held' or row['dispatch_authorized']:
        raise ValueError('El trabajo ya no está exactamente retenido.')
    preview = preview_held_admission(c, owner, job_id, now=checked_at)
    execution = row['quote_snapshot'].get('execution')
    if not isinstance(execution, dict):
        raise ValueError('La cotización persistida no es verificable.')
    validate_active_execution_scope(c, owner, execution)
    restored = rehydrate_held_execution(c, owner, job_id)
    admission_body = _admission_body(owner, row, restored, claims, claim_sha)
    if admission_body['baseAdmissionSha256'] != preview.admission_sha256:
        raise ValueError('La preadmisión cambió dentro de la transacción.')
    admission_sha = canonical_sha256(admission_body)
    admission_id = uuid5(NAMESPACE_URL, f'uonify:creative-admission:{job_key}')
    admitted = c.execute('''INSERT INTO creative_execution_admissions
        (user_id,job_id,id,admission_sha256,input_claim_set_sha256,
         input_claims,execution_graph_sha256,quote_sha256,binding_sha256,
         costs_snapshot_sha256,expires_at,admitted_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
        (owner['id'], job_key, admission_id, admission_sha, claim_sha,
         Jsonb(claims), row['execution_graph_sha256'], row['quote_sha256'],
         row['binding_sha256'], row['costs_snapshot_sha256'],
         row['expires_at'], checked_at)).fetchone()
    roots = c.execute('''UPDATE creative_execution_steps
        SET status='queued',updated_at=%s
        WHERE user_id=%s AND job_id=%s AND status='held'
          AND depends_on='[]'::jsonb RETURNING step_id''',
        (checked_at, owner['id'], job_key)).fetchall()
    if not roots:
        raise ValueError('El grafo no contiene un paso raíz ejecutable.')
    moved = c.execute('''UPDATE creative_execution_jobs
        SET status='queued',available_at=%s,updated_at=%s
        WHERE user_id=%s AND id=%s AND status='held'
          AND claim_count=0 AND lease_token IS NULL
          AND dispatch_authorized=false RETURNING id''',
        (checked_at, checked_at, owner['id'], job_key)).fetchone()
    if not moved:
        raise ValueError('El trabajo cambió durante la admisión.')
    return _receipt(admitted, len(roots))


def revalidate_admission_claims(c, user: dict, job_id: UUID, *,
                                require_unexpired: bool = True,
                                lock_reads: bool = True) -> dict:
    """Reload exact claims; expiry gates new effects, not later review."""
    if not isinstance(require_unexpired, bool):
        raise ValueError('La política de vigencia de la admisión no es válida.')
    job_key = str(UUID(str(job_id)))
    admission = c.execute('''SELECT d.id,d.user_id,d.job_id,
        d.admission_sha256,d.input_claim_set_sha256,d.input_claims,
        d.execution_graph_sha256 AS admitted_execution_graph_sha256,
        d.quote_sha256 AS admitted_quote_sha256,
        d.binding_sha256 AS admitted_binding_sha256,
        d.costs_snapshot_sha256 AS admitted_costs_snapshot_sha256,
        d.expires_at AS admitted_expires_at,d.admitted_at,
        q.uonify_project_id,q.input_manifest,q.quote_snapshot,
        q.quote_sha256,q.binding_sha256,q.costs_snapshot_sha256,q.expires_at
        
        FROM creative_execution_admissions d
        JOIN creative_execution_jobs j
          ON j.user_id=d.user_id AND j.id=d.job_id
        JOIN creative_execution_approvals a
          ON a.user_id=j.user_id AND a.id=j.approval_id
        JOIN creative_execution_quotes q
          ON q.user_id=a.user_id AND q.id=a.quote_id
        WHERE d.user_id=%s AND d.job_id=%s''' + (
            ' FOR SHARE OF d,q' if lock_reads else ''),
        (user['id'], job_key)).fetchone()
    if not admission:
        raise ValueError('El trabajo no tiene una admisión durable.')
    restored = rehydrate_admitted_execution(
        c, user, job_id, lock_reads=lock_reads)
    execution = admission['quote_snapshot'].get('execution')
    if not isinstance(execution, dict):
        raise ValueError('La cotización persistida no es verificable.')
    validate_active_execution_scope(c, user, execution, lock_reads=lock_reads)
    claims, claim_sha = _claim_set(
        c, user, admission['uonify_project_id'],
        _input_references(admission['input_manifest']), lock_reads=lock_reads)
    expected = _admission_body(user, admission, restored, claims, claim_sha)
    expected_id = uuid5(
        NAMESPACE_URL, f'uonify:creative-admission:{restored.job_id}')
    current = c.execute(
        'SELECT clock_timestamp() value').fetchone()['value']
    if (not _expiry_allows(current, admission['expires_at'], require_unexpired)
            or str(admission['id']) != str(expected_id)
            or admission['admitted_execution_graph_sha256']
            != restored.execution_graph_sha256
            or admission['admitted_quote_sha256'] != admission['quote_sha256']
            or admission['admitted_binding_sha256']
            != expected['bindingSha256']
            or admission['admitted_costs_snapshot_sha256']
            != expected['costsSnapshotSha256']
            or admission['admitted_expires_at'] != admission['expires_at']
            or claim_sha != admission['input_claim_set_sha256']
            or claims != admission['input_claims']
            or canonical_sha256(expected) != admission['admission_sha256']):
        raise ValueError('Los inputs admitidos ya no están vigentes.')
    return admission
