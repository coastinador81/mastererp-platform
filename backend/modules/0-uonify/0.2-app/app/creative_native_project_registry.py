"""Create-only durable FilmCraft and PhotoCraft native projects."""

from base64 import b64encode
from dataclasses import asdict, dataclass
from hashlib import md5, sha256
from io import BytesIO
import json
import re
from secrets import token_hex
from uuid import UUID
from zipfile import BadZipFile, ZipFile

from psycopg.types.json import Jsonb

from .creative_asset_lineage_registry import validate_persisted_craft_sources
from .creative_composite_quote import HASH, canonical_sha256
from .creative_storage_contracts import (
    ResumableStorageRequest, StorageObject, StorageReceipt, StorageRequest)


NATIVE_MIME = {'filmcraft': ('application/json', 'fcproj'),
               'photocraft': ('application/zip', 'pcraft')}
_MAX_NATIVE_BYTES = 250_000_000
_MAX_MULTIPART_BYTES = 20_000_000
_RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z')


@dataclass(frozen=True)
class NativeProjectSnapshot:
    schema_version: int
    project_id: str
    owner_user_id: str
    owner_project_id: str | None
    revision: int
    engine: str
    operation: str
    mime_type: str
    byte_size: int
    sha256: str
    storage_receipt: StorageReceipt
    lineage: dict
    input_claim_set_sha256: str
    source_job_id: str
    source_step_id: str
    execution_graph_sha256: str
    candidate_id: str
    snapshot_sha256: str
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


def _snapshot_body(snapshot: NativeProjectSnapshot) -> dict:
    return {'schemaVersion': snapshot.schema_version,
            'projectId': snapshot.project_id,
            'ownerUserId': snapshot.owner_user_id,
            'ownerProjectId': snapshot.owner_project_id,
            'revision': snapshot.revision, 'engine': snapshot.engine,
            'operation': snapshot.operation, 'mimeType': snapshot.mime_type,
            'byteSize': snapshot.byte_size, 'sha256': snapshot.sha256,
            'storageReceipt': _receipt(snapshot.storage_receipt),
            'lineage': snapshot.lineage,
            'inputClaimSetSha256': snapshot.input_claim_set_sha256,
            'sourceJobId': snapshot.source_job_id,
            'sourceStepId': snapshot.source_step_id,
            'executionGraphSha256': snapshot.execution_graph_sha256,
            'candidateId': snapshot.candidate_id}


def native_project_upload(bucket: str, owner_user_id: str, project_id: str,
                          engine: str, data: bytes
                          ) -> StorageRequest | ResumableStorageRequest:
    """Build the exact create-only GCS request for one native project."""
    expected_type = NATIVE_MIME.get(engine)
    owner = _uuid(owner_user_id, 'ownerUserId')
    pid = _uuid(project_id, 'nativeProjectId')
    if (not expected_type or not isinstance(bucket, str)
            or not _BUCKET.fullmatch(bucket) or '..' in bucket
            or bucket.startswith(('goog', 'g00g')) or not isinstance(data, bytes)
            or not 0 < len(data) <= _MAX_NATIVE_BYTES):
        raise ValueError('Proyecto nativo no válido para almacenamiento privado.')
    mime_type, extension = expected_type
    if engine == 'filmcraft':
        try:
            if not isinstance(json.loads(data), dict):
                raise ValueError
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            raise ValueError('FilmCraft nativo no es JSON válido.') from error
    else:
        try:
            with ZipFile(BytesIO(data)) as archive:
                entries = archive.infolist()
                if (not entries or len(entries) > 1024
                        or sum(item.file_size for item in entries) > 1_000_000_000
                        or any(item.flag_bits & 1 or item.filename.startswith('/')
                               or '..' in item.filename.split('/')
                               for item in entries)
                        or archive.testzip() is not None):
                    raise ValueError
        except (BadZipFile, OSError, ValueError) as error:
            raise ValueError('PhotoCraft nativo no es un ZIP íntegro.') from error
    digest = sha256(data).hexdigest()
    md5_base64 = b64encode(md5(data).digest()).decode('ascii')
    name = (f'creative/users/{owner}/native-projects/{pid}/'
            f'{digest}.{extension}')
    expected = StorageObject(
        bucket, name, mime_type, len(data), digest, md5_base64)
    metadata = {'name': name, 'contentType': mime_type, 'md5Hash': md5_base64,
                'cacheControl': 'private, no-store',
                'metadata': {'sha256': digest}}
    base = f'https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o'
    if len(data) > _MAX_MULTIPART_BYTES:
        metadata_body = json.dumps(metadata, separators=(',', ':')).encode()
        return ResumableStorageRequest(
            'POST', base + '?uploadType=resumable&ifGenerationMatch=0',
            {'Content-Type': 'application/json; charset=UTF-8',
             'Content-Length': str(len(metadata_body)),
             'X-Upload-Content-Type': mime_type,
             'X-Upload-Content-Length': str(len(data))},
            metadata_body, data, _RESUMABLE_CHUNK_BYTES, expected)
    boundary = 'uonify-native-' + token_hex(16)
    body = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
            .encode() + json.dumps(metadata, separators=(',', ':')).encode() +
            f'\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n'.encode() +
            data + f'\r\n--{boundary}--\r\n'.encode())
    return StorageRequest('POST', base +
        '?uploadType=multipart&ifGenerationMatch=0',
        {'Content-Type': f'multipart/related; boundary={boundary}',
         'Content-Length': str(len(body))}, body, expected)


def bind_native_project_snapshot(
        candidate_receipt: dict, input_claims: list[dict],
        upload_request: StorageRequest | ResumableStorageRequest,
        storage_receipt: StorageReceipt, *, project_id: str,
        source_step_id: str) -> NativeProjectSnapshot:
    """Bind one uploaded create-only native project to candidate authority."""
    engine = candidate_receipt.get('engine')
    native = candidate_receipt.get('nativeProject')
    name = engine.get('name') if isinstance(engine, dict) else None
    expected = NATIVE_MIME.get(name)
    pid = _uuid(project_id, 'nativeProjectId')
    owner = _uuid(candidate_receipt.get('ownerUserId'), 'ownerUserId')
    owner_project = _uuid(candidate_receipt.get('uonifyProjectId'),
                          'uonifyProjectId', optional=True)
    candidate_id = _uuid(candidate_receipt.get('candidateId'), 'candidateId')
    job_id = _uuid(candidate_receipt.get('jobId'), 'jobId')
    step_id = _uuid(source_step_id, 'sourceStepId')
    request_types = (StorageRequest, ResumableStorageRequest)
    upload_expected = (upload_request.expected
                       if isinstance(upload_request, request_types) else None)
    upload_type = ('resumable' if isinstance(upload_request, ResumableStorageRequest)
                   else 'multipart')
    expected_endpoint = (None if upload_expected is None else
        f'https://storage.googleapis.com/upload/storage/v1/b/'
        f'{upload_expected.bucket}/o?uploadType={upload_type}&ifGenerationMatch=0')
    if (not expected or not isinstance(native, dict)
            or native.get('mimeType') != expected[0]
            or not isinstance(upload_request, request_types)
            or upload_request.method != 'POST'
            or upload_request.endpoint != expected_endpoint
            or upload_request.body is None
            or not isinstance(upload_expected, StorageObject)
            or not isinstance(storage_receipt, StorageReceipt)
            or (upload_expected.bucket, upload_expected.name,
                upload_expected.mime_type, upload_expected.byte_size,
                upload_expected.sha256) !=
               (storage_receipt.bucket, storage_receipt.name,
                storage_receipt.mime_type, storage_receipt.byte_size,
                storage_receipt.sha256)
            or (storage_receipt.mime_type, storage_receipt.byte_size,
                storage_receipt.sha256) !=
               (native.get('mimeType'), native.get('byteSize'), native.get('sha256'))
            or storage_receipt.generation < 1
            or storage_receipt.name !=
               (f'creative/users/{owner}/native-projects/{pid}/'
                f'{native["sha256"]}.{expected[1]}')
            or not HASH.fullmatch(str(candidate_receipt.get(
                'executionGraphSha256', '')))
            or not HASH.fullmatch(str(candidate_receipt.get('claimSetSha256', '')))
            or not isinstance(input_claims, list) or not input_claims):
        raise ValueError('El proyecto nativo no coincide con el candidato Film/Photo.')
    sources = []
    for claim in input_claims:
        if (not isinstance(claim, dict)
                or not isinstance(claim.get('assetRevision'), int)
                or not HASH.fullmatch(str(claim.get('snapshotSha256', '')))):
            raise ValueError('El proyecto nativo no conserva fuentes exactas.')
        sources.append({'assetId': _uuid(claim.get('assetId'), 'assetId'),
                        'revision': claim['assetRevision'],
                        'snapshotSha256': claim['snapshotSha256']})
    lineage = {'origin': 'craft', 'sources': sources,
               'recipeSha256': candidate_receipt['recipeSha256'],
               'jobBindingSha256': candidate_receipt['jobBindingSha256'],
               'engine': name, 'operation': engine['operation'],
               'resultSha256': native['sha256']}
    provisional = NativeProjectSnapshot(
        1, pid, owner, owner_project, 1, name, engine['operation'], expected[0],
        native['byteSize'], native['sha256'], storage_receipt, lineage,
        candidate_receipt['claimSetSha256'], job_id, step_id,
        candidate_receipt['executionGraphSha256'], candidate_id, '')
    return NativeProjectSnapshot(
        **{**provisional.__dict__,
           'snapshot_sha256': canonical_sha256(_snapshot_body(provisional))})


def native_project_provider_item(snapshot: NativeProjectSnapshot) -> dict:
    return {'projectId': snapshot.project_id, 'revision': snapshot.revision,
            'receipt': _receipt(snapshot)}


def _receipt(snapshot: NativeProjectSnapshot | StorageReceipt) -> dict:
    value = (snapshot.storage_receipt
             if isinstance(snapshot, NativeProjectSnapshot) else snapshot)
    raw = asdict(value)
    return {'bucket': raw['bucket'], 'name': raw['name'],
            'generation': raw['generation'], 'mimeType': raw['mime_type'],
            'byteSize': raw['byte_size'], 'sha256': raw['sha256']}


def persist_quarantined_native_project(c, owner: dict,
                                       snapshot: NativeProjectSnapshot) -> None:
    if (not isinstance(snapshot, NativeProjectSnapshot)
            or snapshot.schema_version != 1 or snapshot.revision != 1
            or snapshot.engine not in NATIVE_MIME
            or snapshot.publication_authorized
            or canonical_sha256(_snapshot_body(snapshot)) != snapshot.snapshot_sha256
            or str(owner['id']) != snapshot.owner_user_id):
        raise ValueError('El snapshot del proyecto nativo no es persistible.')
    candidate = c.execute('''SELECT r.uonify_project_id,r.job_id,
        r.execution_graph_sha256,
        t.craft_resolved_job_snapshot#>>'{target,editProject,mode}' target_mode
        FROM creative_candidate_receipts r
        JOIN creative_execution_attempts t
          ON t.user_id=r.user_id AND t.id=r.attempt_id
        WHERE r.user_id=%s AND r.id=%s FOR SHARE OF r,t''',
        (owner['id'], snapshot.candidate_id)).fetchone()
    if (not candidate or candidate['uonify_project_id'] !=
            (UUID(snapshot.owner_project_id) if snapshot.owner_project_id else None)
            or str(candidate['job_id']) != snapshot.source_job_id
            or candidate['execution_graph_sha256'] != snapshot.execution_graph_sha256
            or candidate['target_mode'] != 'create'):
        raise ValueError('El proyecto nativo no corresponde al candidato.')
    validate_persisted_craft_sources(
        c, owner['id'], snapshot.owner_project_id, snapshot.lineage)
    prior = c.execute('''SELECT p.authorization_state,r.snapshot_sha256
        FROM creative_native_projects p JOIN creative_native_project_revisions r
          ON r.user_id=p.user_id AND r.project_id=p.id
         AND r.revision=p.current_revision
        WHERE p.user_id=%s AND p.id=%s FOR UPDATE OF p''',
        (owner['id'], snapshot.project_id)).fetchone()
    if prior:
        if (prior['authorization_state'] == 'quarantined'
                and prior['snapshot_sha256'] == snapshot.snapshot_sha256):
            return
        raise ValueError('El proyecto nativo ya liga otro snapshot.')
    c.execute('''INSERT INTO creative_native_projects
        (user_id,id,uonify_project_id,current_revision,authorization_state,
         state_reason) VALUES(%s,%s,%s,1,'quarantined',
         'pending_creative_review')''',
        (owner['id'], snapshot.project_id, snapshot.owner_project_id))
    receipt = snapshot.storage_receipt
    c.execute('''INSERT INTO creative_native_project_revisions
        (user_id,project_id,revision,engine,operation,mime_type,byte_size,sha256,
         storage_bucket,storage_name,storage_generation,lineage,
         input_claim_set_sha256,source_job_id,source_step_id,
         execution_graph_sha256,candidate_id,snapshot_sha256)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], snapshot.project_id, snapshot.revision, snapshot.engine,
         snapshot.operation, snapshot.mime_type, snapshot.byte_size,
         snapshot.sha256, receipt.bucket, receipt.name, receipt.generation,
         Jsonb(snapshot.lineage), snapshot.input_claim_set_sha256,
         snapshot.source_job_id, snapshot.source_step_id,
         snapshot.execution_graph_sha256, snapshot.candidate_id,
         snapshot.snapshot_sha256))
    for ordinal, item in enumerate(snapshot.lineage['sources']):
        c.execute('''INSERT INTO creative_native_project_lineage_sources
            (user_id,project_id,project_revision,ordinal,source_asset_id,
             source_revision,source_snapshot_sha256)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (owner['id'], snapshot.project_id, snapshot.revision, ordinal,
             item['assetId'], item['revision'], item['snapshotSha256']))


def link_candidate_native_project(c, owner_id: object,
                                  snapshot: NativeProjectSnapshot) -> dict:
    item = {'projectId': snapshot.project_id, 'revision': snapshot.revision,
            'snapshotSha256': snapshot.snapshot_sha256,
            'storageReceipt': _receipt(snapshot)}
    item['itemReceiptSha256'] = canonical_sha256(item)
    c.execute('''INSERT INTO creative_candidate_native_projects
        (user_id,candidate_id,project_id,revision,snapshot_sha256,
         item_receipt_sha256) VALUES(%s,%s,%s,%s,%s,%s)''',
        (owner_id, snapshot.candidate_id, snapshot.project_id,
         snapshot.revision, snapshot.snapshot_sha256,
         item['itemReceiptSha256']))
    return item
