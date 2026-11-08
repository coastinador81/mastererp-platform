"""Durable authority for verified creative assets and immutable revisions.

Only private services call this module. It persists exact StorageReceipt data,
supports revocation and resolves a server-derived Craft mount. It performs no
upload, download, provider call, publication or job admission.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import re
from uuid import UUID

from psycopg.types.json import Jsonb

from .creative_asset_contract import (CreativeAssetSnapshot,
                                      craft_asset_payload)
from .creative_asset_lineage_registry import (
    persist_asset_lineage_sources, validate_persisted_asset_lineage)
from .creative_composite_quote import HASH, canonical_sha256
from .creative_craft_asset_identity import validate_craft_adoption_lineage
from .creative_storage_contracts import StorageReceipt


ROLE = re.compile(r'[a-z][a-z0-9_]{0,63}\Z')
EXTENSION = {
    'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg',
    'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
    'audio/L16;codec=pcm;rate=24000': 'pcm', 'application/zip': 'zip',
}


@dataclass(frozen=True)
class CreativeAssetRegistryReceipt:
    asset_id: str
    revision: int
    snapshot_sha256: str
    authorization_state: str
    created: bool


@dataclass(frozen=True)
class CreativeAssetClaim:
    asset_id: str
    revision: int
    snapshot_sha256: str
    mount_name: str
    craft_payload: dict
    claim_authorized: bool = True
    publication_authorized: bool = False


@dataclass(frozen=True)
class CreativeAssetClaimBundle:
    uonify_project_id: str | None
    claims: tuple[CreativeAssetClaim, ...]
    claim_set_sha256: str
    claim_authorized: bool = True
    publication_authorized: bool = False


def _uuid(value: object, label: str, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    if parsed != str(value):
        raise ValueError(f'{label} no es UUID canónico.')
    return parsed


def _active_owner(c, user: dict, *, lock_reads: bool = True) -> dict:
    suffix = ' FOR SHARE' if lock_reads else ''
    owner = c.execute('SELECT * FROM users WHERE id=%s' + suffix,
                      (user.get('id'),)).fetchone()
    if (not owner or owner['google_subject'] != user.get('google_subject')
            or owner.get('deletion_requested_at')):
        raise ValueError('La identidad propietaria ya no está vigente.')
    return owner


def _active_project(c, user_id, project_id: str | None, *,
                    lock_reads: bool = True) -> None:
    if project_id is None:
        return
    row = c.execute('''SELECT deleted_at FROM uony_projects
        WHERE user_id=%s AND id=%s''' + (' FOR SHARE' if lock_reads else ''),
        (user_id, project_id)).fetchone()
    if not row or row['deleted_at']:
        raise ValueError('El proyecto propietario del asset ya no está vigente.')


def _snapshot_body(snapshot: CreativeAssetSnapshot) -> dict:
    receipt = snapshot.storage_receipt
    return {
        'schemaVersion': snapshot.schema_version,
        'assetId': snapshot.asset_id,
        'ownerUserId': snapshot.owner_user_id,
        'ownerProjectId': snapshot.owner_project_id,
        'revision': snapshot.revision,
        'role': snapshot.role,
        'kind': snapshot.kind,
        'mimeType': snapshot.mime_type,
        'byteSize': snapshot.byte_size,
        'sha256': snapshot.sha256,
        'storageReceipt': asdict(receipt),
        'media': snapshot.media,
        'lineage': snapshot.lineage,
        'sourceStepId': snapshot.source_step_id,
        'executionGraphSha256': snapshot.execution_graph_sha256,
    }


def _validate_lineage(snapshot: CreativeAssetSnapshot) -> None:
    lineage = snapshot.lineage
    origin = lineage.get('origin') if isinstance(lineage, dict) else None
    if not isinstance(origin, str) or not origin:
        raise ValueError('El asset no conserva origen y linaje.')
    if origin == 'derived':
        required = {'origin', 'sourceAssetId', 'sourceSha256', 'transformId',
                    'transformVersion', 'resultSha256'}
        if (set(lineage) != required
                or _uuid(lineage.get('sourceAssetId'), 'sourceAssetId') is None
                or not HASH.fullmatch(str(lineage.get('sourceSha256', '')))
                or not isinstance(lineage.get('transformId'), str)
                or not lineage['transformId']
                or not isinstance(lineage.get('transformVersion'), int)
                or isinstance(lineage.get('transformVersion'), bool)
                or lineage['transformVersion'] < 1
                or lineage.get('resultSha256') != snapshot.sha256):
            raise ValueError('El linaje derivado no liga fuente, transformación y salida.')
    elif origin == 'google':
        required = {'origin', 'attemptId', 'requestSha256', 'outputSha256'}
        if (set(lineage) != required
                or _uuid(lineage.get('attemptId'), 'attemptId') is None
                or not HASH.fullmatch(str(lineage.get('requestSha256', '')))
                or lineage.get('outputSha256') != snapshot.sha256):
            raise ValueError('El linaje Google no liga intento, petición y salida.')
    elif origin == 'google_gcs':
        required = {'origin', 'sourceBucket', 'sourceName', 'sourceGeneration',
                    'sourceSha256'}
        if (set(lineage) != required
                or not isinstance(lineage.get('sourceBucket'), str)
                or not lineage['sourceBucket']
                or not isinstance(lineage.get('sourceName'), str)
                or not lineage['sourceName']
                or not isinstance(lineage.get('sourceGeneration'), int)
                or lineage['sourceGeneration'] <= 0
                or lineage.get('sourceSha256') != snapshot.sha256):
            raise ValueError('El linaje GCS no liga el objeto fuente exacto.')
    elif origin == 'craft':
        required = {'origin', 'sources', 'recipeSha256', 'jobBindingSha256',
                    'engine', 'operation', 'resultSha256'}
        sources = lineage.get('sources')
        if (set(lineage) != required or not isinstance(sources, list)
                or len(sources) > 64
                or (lineage.get('engine') in ('filmcraft', 'photocraft')
                    and not sources)
                or any(not isinstance(item, dict)
                       or set(item) != {'assetId', 'revision', 'snapshotSha256'}
                       or _uuid(item.get('assetId'), 'assetId') is None
                       or not isinstance(item.get('revision'), int)
                       or isinstance(item.get('revision'), bool)
                       or item['revision'] < 1
                       or not HASH.fullmatch(str(item.get('snapshotSha256', '')))
                       for item in sources)
                or len({item['assetId'] for item in sources}) != len(sources)
                or not HASH.fullmatch(str(lineage.get('recipeSha256', '')))
                or not HASH.fullmatch(str(lineage.get('jobBindingSha256', '')))
                or not isinstance(lineage.get('engine'), str)
                or not lineage['engine']
                or not isinstance(lineage.get('operation'), str)
                or not lineage['operation']
                or lineage.get('resultSha256') != snapshot.sha256):
            raise ValueError('El linaje Craft no liga fuentes, receta y salida.')
    elif origin == 'craft_adoption':
        # Adopción de una salida Craft desde escrow. Origen NUEVO y distinto de 'craft'
        # (reservado a FilmCraft/PhotoCraft + trigger 105, que NO alcanza esta tabla).
        # Validación pura e inerte: nadie escribe aún este origen, así que no abre
        # dispatch ni cambia comportamiento vivo. Ver
        # contracts/google-craft-registration-contract.md.
        validate_craft_adoption_lineage(
            lineage, asset_id=snapshot.asset_id,
            owner_user_id=snapshot.owner_user_id, mime_type=snapshot.mime_type,
            byte_size=snapshot.byte_size, sha256=snapshot.sha256)
    else:
        raise ValueError('El origen del asset no está admitido por el registro.')


def _validate_snapshot(snapshot: CreativeAssetSnapshot) -> None:
    receipt = snapshot.storage_receipt
    expected_prefix = (f'creative/users/{snapshot.owner_user_id}/assets/'
                       f'{snapshot.asset_id}/{snapshot.sha256}.')
    expected_mime = {'image': 'image/', 'video': 'video/', 'audio': 'audio/',
                     'image_sequence': 'application/zip'}
    if (snapshot.schema_version != 1 or snapshot.revision < 1
            or snapshot.kind not in expected_mime
            or not isinstance(receipt, StorageReceipt)
            or snapshot.mime_type not in EXTENSION
            or (snapshot.kind == 'image_sequence'
                and snapshot.mime_type != expected_mime[snapshot.kind])
            or (snapshot.kind != 'image_sequence'
                and not snapshot.mime_type.startswith(expected_mime[snapshot.kind]))
            or snapshot.byte_size <= 0 or not HASH.fullmatch(snapshot.sha256)
            or receipt.generation <= 0
            or (receipt.mime_type, receipt.byte_size, receipt.sha256)
            != (snapshot.mime_type, snapshot.byte_size, snapshot.sha256)
            or not receipt.name.startswith(expected_prefix)
            or not isinstance(snapshot.media, dict)
            or not isinstance(snapshot.craft_blockers, tuple)):
        raise ValueError('El snapshot no liga bytes, medio y recibo exactos.')


def _source_step(c, owner_id, source_job_id: str,
                 snapshot: CreativeAssetSnapshot) -> dict:
    row = c.execute('''SELECT s.*,j.status AS job_status,
        j.lease_token AS job_lease_token,
        s.lease_until>clock_timestamp() AS step_lease_live,
        j.lease_until>clock_timestamp() AS job_lease_live,
        j.execution_graph_sha256 AS job_graph_sha256
        FROM creative_execution_steps s JOIN creative_execution_jobs j
          ON j.user_id=s.user_id AND j.id=s.job_id
        WHERE s.user_id=%s AND s.job_id=%s AND s.step_id=%s FOR SHARE OF s,j''',
        (owner_id, source_job_id, snapshot.source_step_id)).fetchone()
    receipt = snapshot.storage_receipt
    expected_receipt = {
        'bucket': receipt.bucket, 'name': receipt.name,
        'generation': receipt.generation, 'mimeType': receipt.mime_type,
        'byteSize': receipt.byte_size, 'sha256': receipt.sha256,
    }
    provider_matches = False
    if row and row['kind'] == 'storage_adopt':
        provider_matches = row['provider_receipt'] == expected_receipt
    elif row and row['kind'] == 'candidate_adopt':
        provider = row['provider_receipt']
        items = provider.get('storageReceipts') if isinstance(provider, dict) else None
        provider_matches = (isinstance(provider, dict)
                            and isinstance(provider.get('candidateId'), str)
                            and isinstance(items, list)
                            and len(items) == len({
                                (item.get('assetId'), item.get('revision'))
                                for item in items if isinstance(item, dict)})
                            and any(isinstance(item, dict)
                                    and set(item) == {'assetId', 'revision', 'receipt'}
                                    and item.get('assetId') == snapshot.asset_id
                                    and item.get('revision') == snapshot.revision
                                    and item.get('receipt') == expected_receipt
                                    for item in items))
    source_ready = bool(row) and (
        (row['kind'] == 'storage_adopt' and row['status'] == 'succeeded'
         and row['job_status'] in ('running', 'succeeded'))
        or (row['kind'] == 'candidate_adopt' and row['status'] == 'running'
            and row['job_status'] == 'running' and row['step_lease_live']
            and row['job_lease_live']
            and row['lease_token'] == row['job_lease_token']))
    if (not source_ready
            or row['job_graph_sha256'] != snapshot.execution_graph_sha256
            or row['provider_returned_at'] is None
            or not provider_matches):
        raise ValueError('El recibo del asset no procede de un paso durable completado.')
    return row


def _persist_creative_asset(c, user: dict, source_job_id: UUID,
                            snapshot: CreativeAssetSnapshot, *,
                            initial_state: str
                            ) -> CreativeAssetRegistryReceipt:
    """Insert one verified revision with explicit initial authority."""
    if initial_state not in ('allowed', 'quarantined'):
        raise ValueError('El estado inicial del asset no es válido.')
    if not isinstance(snapshot, CreativeAssetSnapshot):
        raise ValueError('Falta el snapshot canónico del asset.')
    owner = _active_owner(c, user)
    job_id = _uuid(source_job_id, 'sourceJobId')
    if (snapshot.owner_user_id != str(owner['id'])
            or not ROLE.fullmatch(snapshot.role)
            or snapshot.mime_type not in EXTENSION
            or not HASH.fullmatch(snapshot.snapshot_sha256)
            or canonical_sha256(_snapshot_body(snapshot))
            != snapshot.snapshot_sha256
            or snapshot.publication_authorized
            or not snapshot.ready_for_persistence):
        raise ValueError('El snapshot canónico del asset no es persistible.')
    _validate_snapshot(snapshot)
    _active_project(c, owner['id'], snapshot.owner_project_id)
    _validate_lineage(snapshot)
    validate_persisted_asset_lineage(c, owner['id'], snapshot)
    _source_step(c, owner['id'], job_id, snapshot)
    asset = c.execute('''SELECT * FROM creative_assets
        WHERE user_id=%s AND id=%s FOR UPDATE''',
        (owner['id'], snapshot.asset_id)).fetchone()
    if asset:
        if asset['uonify_project_id'] != (UUID(snapshot.owner_project_id)
                                          if snapshot.owner_project_id else None):
            raise ValueError('El asset ya pertenece a otro proyecto.')
        if snapshot.revision == asset['current_revision']:
            prior = c.execute('''SELECT snapshot_sha256 FROM creative_asset_revisions
                WHERE user_id=%s AND asset_id=%s AND revision=%s''',
                (owner['id'], snapshot.asset_id, snapshot.revision)).fetchone()
            if (prior and prior['snapshot_sha256'] == snapshot.snapshot_sha256
                    and asset['authorization_state'] == initial_state):
                return CreativeAssetRegistryReceipt(
                    snapshot.asset_id, snapshot.revision,
                    snapshot.snapshot_sha256, asset['authorization_state'], False)
            raise ValueError('La revisión del asset ya liga otro snapshot.')
        if (asset['authorization_state'] != 'allowed'
                or snapshot.revision != asset['current_revision'] + 1):
            raise ValueError('La siguiente revisión del asset no está autorizada.')
    elif snapshot.revision != 1:
        raise ValueError('El primer snapshot del asset debe ser revisión 1.')
    if initial_state == 'quarantined' and asset:
        raise ValueError('Una salida en cuarentena debe usar un asset nuevo.')
    if not asset:
        c.execute('''INSERT INTO creative_assets
            (user_id,id,uonify_project_id,current_revision,authorization_state,
             state_reason)
            VALUES(%s,%s,%s,%s,%s,%s)''',
            (owner['id'], snapshot.asset_id, snapshot.owner_project_id,
             snapshot.revision, initial_state,
             'pending_creative_review' if initial_state == 'quarantined' else None))
    receipt = snapshot.storage_receipt
    c.execute('''INSERT INTO creative_asset_revisions
        (user_id,asset_id,revision,role,kind,mime_type,byte_size,sha256,
         storage_bucket,storage_name,storage_generation,media,lineage,
         craft_blockers,source_job_id,source_step_id,execution_graph_sha256,
         snapshot_sha256)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], snapshot.asset_id, snapshot.revision, snapshot.role,
         snapshot.kind, snapshot.mime_type, snapshot.byte_size, snapshot.sha256,
         receipt.bucket, receipt.name, receipt.generation, Jsonb(snapshot.media),
         Jsonb(snapshot.lineage), Jsonb(list(snapshot.craft_blockers)), job_id,
         snapshot.source_step_id, snapshot.execution_graph_sha256,
         snapshot.snapshot_sha256))
    persist_asset_lineage_sources(c, owner['id'], snapshot)
    if asset:
        updated = c.execute('''UPDATE creative_assets SET current_revision=%s,
            updated_at=now() WHERE user_id=%s AND id=%s
            AND current_revision=%s AND authorization_state='allowed'
            RETURNING id''',
            (snapshot.revision, owner['id'], snapshot.asset_id,
             asset['current_revision'])).fetchone()
        if not updated:
            raise ValueError('La revisión actual del asset cambió.')
    return CreativeAssetRegistryReceipt(
        snapshot.asset_id, snapshot.revision, snapshot.snapshot_sha256,
        initial_state, True)


def persist_creative_asset(c, user: dict, source_job_id: UUID,
                           snapshot: CreativeAssetSnapshot
                           ) -> CreativeAssetRegistryReceipt:
    """Persist an immediately allowed asset outside the candidate lifecycle."""
    return _persist_creative_asset(
        c, user, source_job_id, snapshot, initial_state='allowed')


def persist_quarantined_creative_asset(
        c, user: dict, source_job_id: UUID,
        snapshot: CreativeAssetSnapshot) -> CreativeAssetRegistryReceipt:
    """Persist candidate bytes that cannot be claimed before review/release."""
    return _persist_creative_asset(
        c, user, source_job_id, snapshot, initial_state='quarantined')


def _snapshot_from_rows(asset: dict, row: dict) -> CreativeAssetSnapshot:
    receipt = StorageReceipt(
        row['storage_bucket'], row['storage_name'], row['storage_generation'],
        row['mime_type'], row['byte_size'], row['sha256'])
    return CreativeAssetSnapshot(
        1, str(row['asset_id']), str(row['user_id']),
        str(asset['uonify_project_id']) if asset['uonify_project_id'] else None,
        row['revision'], row['role'], row['kind'], row['mime_type'],
        row['byte_size'], row['sha256'], receipt, row['media'], row['lineage'],
        str(row['source_step_id']), row['execution_graph_sha256'],
        row['snapshot_sha256'], tuple(row['craft_blockers']))


def resolve_creative_asset_for_craft(c, user: dict, asset_id: UUID,
                                     revision: int,
                                     uonify_project_id: UUID | None, *,
                                     image_sequence_mount: object | None = None,
                                     allow_pending_materialization: bool = False,
                                     lock_reads: bool = True
                                     ) -> CreativeAssetClaim:
    """Reload current authority and derive the mount name only on the server."""
    owner = _active_owner(c, user, lock_reads=lock_reads)
    asset_key = _uuid(asset_id, 'assetId')
    project_key = _uuid(uonify_project_id, 'uonifyProjectId', optional=True)
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValueError('La revisión solicitada del asset no es válida.')
    asset = c.execute('''SELECT * FROM creative_assets
        WHERE user_id=%s AND id=%s''' + (' FOR SHARE' if lock_reads else ''),
        (owner['id'], asset_key)).fetchone()
    if (not asset or asset['authorization_state'] != 'allowed'
            or asset['current_revision'] != revision
            or (str(asset['uonify_project_id']) if asset['uonify_project_id'] else None)
            != project_key):
        raise ValueError('El asset no está vigente y autorizado.')
    _active_project(c, owner['id'], project_key, lock_reads=lock_reads)
    row = c.execute('''SELECT * FROM creative_asset_revisions
        WHERE user_id=%s AND asset_id=%s AND revision=%s''' + (
            ' FOR SHARE' if lock_reads else ''),
        (owner['id'], asset_key, revision)).fetchone()
    if not row:
        raise ValueError('La revisión exacta del asset no existe.')
    snapshot = _snapshot_from_rows(asset, row)
    if canonical_sha256(_snapshot_body(snapshot)) != row['snapshot_sha256']:
        raise ValueError('El snapshot persistido del asset no coincide.')
    mount_name = f'{asset_key}-r{revision}.{EXTENSION[row["mime_type"]]}'
    payload = craft_asset_payload(
        snapshot, mount_name=mount_name,
        persisted_snapshot_sha256=row['snapshot_sha256'],
        authorization_state=asset['authorization_state'],
        image_sequence_mount=image_sequence_mount,
        allow_pending_materialization=allow_pending_materialization)
    return CreativeAssetClaim(
        asset_key, revision, row['snapshot_sha256'], mount_name, payload)


def resolve_creative_assets_for_craft(
        c, user: dict, references: tuple[tuple[UUID, int], ...],
        uonify_project_id: UUID | None, *,
        allow_pending_materialization: bool = False,
        lock_reads: bool = True) -> CreativeAssetClaimBundle:
    """Resolve an ordered, unique set of current assets in one transaction."""
    if (not isinstance(references, tuple) or not references
            or len(references) > 64
            or any(not isinstance(item, tuple) or len(item) != 2
                   for item in references)):
        raise ValueError('La lista de assets para Craft no es válida.')
    project_key = _uuid(
        uonify_project_id, 'uonifyProjectId', optional=True)
    normalized = tuple(
        (_uuid(item[0], 'assetId'), item[1]) for item in references)
    if (len({asset_id for asset_id, _ in normalized}) != len(normalized)
            or any(not isinstance(revision, int)
                   or isinstance(revision, bool) or revision < 1
                   for _, revision in normalized)):
        raise ValueError('Los assets para Craft deben ser únicos y vigentes.')
    claims = tuple(resolve_creative_asset_for_craft(
        c, user, UUID(asset_id), revision,
        UUID(project_key) if project_key else None,
        allow_pending_materialization=allow_pending_materialization,
        lock_reads=lock_reads)
        for asset_id, revision in normalized)
    body = {
        'schemaVersion': 1, 'uonifyProjectId': project_key,
        'assets': [{
            'assetId': item.asset_id, 'assetRevision': item.revision,
            'snapshotSha256': item.snapshot_sha256,
            'mountName': item.mount_name,
            'storageReceipt': item.craft_payload['storageReceipt'],
        } for item in claims],
    }
    return CreativeAssetClaimBundle(
        project_key, claims, canonical_sha256(body))


def revoke_creative_asset(c, user: dict, asset_id: UUID, *,
                          expected_revision: int, reason: str) -> bool:
    """CAS revocation; subsequent claims fail even with an old snapshot."""
    owner = _active_owner(c, user)
    asset_key = _uuid(asset_id, 'assetId')
    if (not isinstance(expected_revision, int) or expected_revision < 1
            or not isinstance(reason, str) or not reason.strip()
            or len(reason.strip()) > 200):
        raise ValueError('La revocación del asset no es válida.')
    row = c.execute('''UPDATE creative_assets
        SET authorization_state='revoked',revoked_at=%s,state_reason=%s,
            updated_at=now()
        WHERE user_id=%s AND id=%s AND current_revision=%s
          AND authorization_state='allowed' RETURNING id''',
        (datetime.now(timezone.utc), reason.strip(), owner['id'], asset_key,
         expected_revision)).fetchone()
    if row:
        return True
    state = c.execute('''SELECT current_revision,authorization_state
        FROM creative_assets WHERE user_id=%s AND id=%s''',
        (owner['id'], asset_key)).fetchone()
    if (state and state['current_revision'] == expected_revision
            and state['authorization_state'] == 'revoked'):
        return False
    raise ValueError('El asset cambió antes de revocarse.')
