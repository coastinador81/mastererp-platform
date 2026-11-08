"""Persist verified worker-local sequence mounts before Craft authority binds."""

from pathlib import Path
from uuid import UUID

from psycopg.types.json import Jsonb

from .creative_asset_registry import resolve_creative_asset_for_craft
from .creative_composite_quote import canonical_sha256
from .creative_image_sequence_mount import (
    ImageSequenceMountReceipt, image_sequence_mount_payload,
    image_sequence_mount_receipt)


def _claim_value(claim: object, name: str) -> str:
    value = getattr(claim, name, None)
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError('El claim del intento Craft no es válido.') from None


def bind_craft_image_sequence_mounts(
        c, claim: object,
        receipts: tuple[ImageSequenceMountReceipt, ...], *,
        input_root: Path) -> dict:
    """CAS-bind exact materializations while the attempt lease is still live."""
    if (not isinstance(receipts, tuple) or len(receipts) > 64
            or any(not isinstance(item, ImageSequenceMountReceipt)
                   for item in receipts)):
        raise ValueError('Los mounts de secuencia no forman un conjunto cerrado.')
    user_id = _claim_value(claim, 'user_id')
    attempt_id = _claim_value(claim, 'attempt_id')
    lease_token = _claim_value(claim, 'lease_token')
    root = Path(input_root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('La raíz server-owned de Craft no es válida.')
    expected_root = str(root.resolve(strict=True))
    if any(item.input_root != expected_root for item in receipts):
        raise ValueError('El mount no pertenece a la raíz server-owned de Craft.')
    row = c.execute('''SELECT a.*,s.kind,s.status AS step_status,
        s.lease_token AS step_lease,j.status AS job_status,
        j.lease_token AS job_lease,q.uonify_project_id
        FROM creative_execution_attempts a
        JOIN creative_execution_steps s ON s.user_id=a.user_id
          AND s.job_id=a.job_id AND s.step_id=a.step_id
        JOIN creative_execution_jobs j ON j.user_id=a.user_id AND j.id=a.job_id
        JOIN creative_execution_approvals p
          ON p.user_id=j.user_id AND p.id=j.approval_id
        JOIN creative_execution_quotes q
          ON q.user_id=p.user_id AND q.id=p.quote_id
        WHERE a.user_id=%s AND a.id=%s FOR UPDATE OF a,s,j''',
        (user_id, attempt_id)).fetchone()
    owner = c.execute('''SELECT * FROM users WHERE id=%s FOR NO KEY UPDATE''',
                      (user_id,)).fetchone()
    if (not row or not owner or owner.get('deletion_requested_at')
            or row['kind'] != 'craft' or row['status'] != 'running'
            or row['step_status'] != 'running' or row['job_status'] != 'running'
            or str(row['lease_token']) != lease_token
            or str(row['step_lease']) != lease_token
            or str(row['job_lease']) != lease_token
            or row['lease_until'] <= c.execute(
                'SELECT clock_timestamp() value').fetchone()['value']
            or row['provider_started_at'] is not None
            or row.get('craft_authority_bound_at') is not None):
        raise ValueError('El intento ya no admite mounts de secuencia.')
    payloads = [image_sequence_mount_payload(item) for item in receipts]
    payloads.sort(key=lambda item: item['assetId'])
    payload_sha = canonical_sha256(payloads)
    if row.get('craft_input_materializations') is not None:
        if (row['craft_input_materializations'] != payloads
                or row['craft_input_materializations_sha256'] != payload_sha):
            raise ValueError('Los mounts Craft ya fueron ligados con otros bytes.')
        return row
    by_asset = {item.asset_id: item for item in receipts}
    if len(by_asset) != len(receipts):
        raise ValueError('Los mounts de secuencia deben corresponder a assets únicos.')
    claims = row.get('claim_snapshot')
    if not isinstance(claims, list):
        raise ValueError('El intento no conserva claims de entrada.')
    used = set()
    for prior in claims:
        if not isinstance(prior, dict):
            raise ValueError('El intento no conserva claims de entrada.')
        asset_id = str(prior.get('assetId'))
        mount = by_asset.get(asset_id)
        if mount is not None and (
                mount.worker_id != row['lease_owner']
                or mount.lease_token != str(row['lease_token'])):
            raise ValueError('El mount no pertenece al worker y lease activos.')
        resolved = resolve_creative_asset_for_craft(
            c, owner, prior.get('assetId'), prior.get('assetRevision'),
            row['uonify_project_id'], image_sequence_mount=mount)
        expected = {
            'assetId': resolved.asset_id,
            'assetRevision': resolved.revision,
            'snapshotSha256': resolved.snapshot_sha256,
            'mountName': resolved.mount_name,
            'storageReceipt': resolved.craft_payload['storageReceipt'],
        }
        if expected != prior:
            raise ValueError('Un claim cambió antes de montar la secuencia.')
        if 'materialization' in resolved.craft_payload:
            used.add(asset_id)
    if used != set(by_asset):
        raise ValueError('Existe un mount que no corresponde a una secuencia reclamada.')
    updated = c.execute('''UPDATE creative_execution_attempts SET
        craft_input_materializations=%s,
        craft_input_materializations_sha256=%s,
        updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s AND status='running'
          AND provider_started_at IS NULL
          AND craft_authority_bound_at IS NULL
          AND craft_input_materializations IS NULL RETURNING *''',
        (Jsonb(payloads), payload_sha, user_id, attempt_id)).fetchone()
    if not updated:
        raise ValueError('El intento cambió al ligar mounts de secuencia.')
    return updated


def image_sequence_mounts_from_attempt(row: dict) -> dict[str, ImageSequenceMountReceipt]:
    payloads = row.get('craft_input_materializations')
    if payloads is None:
        return {}
    if (not isinstance(payloads, list)
            or canonical_sha256(payloads)
            != row.get('craft_input_materializations_sha256')):
        raise ValueError('Los mounts persistidos del intento no son verificables.')
    receipts = tuple(image_sequence_mount_receipt(item) for item in payloads)
    if any(item.worker_id != row.get('lease_owner')
           or item.lease_token != str(row.get('lease_token'))
           for item in receipts):
        raise ValueError('Los mounts persistidos no pertenecen al lease activo.')
    result = {item.asset_id: item for item in receipts}
    if len(result) != len(receipts):
        raise ValueError('Los mounts persistidos del intento no son únicos.')
    return result
