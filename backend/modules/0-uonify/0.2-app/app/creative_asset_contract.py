"""Snapshot canónico de un asset creativo después de una carga GCS verificada.

No inserta en base de datos, no sube bytes y no publica. Convierte el draft y
el recibo exactos en una forma que el futuro registro de assets podrá persistir.
"""

from dataclasses import asdict, dataclass
from fractions import Fraction
from pathlib import PurePosixPath
from uuid import UUID

from .creative_composite_quote import HASH, canonical_sha256
from .creative_generated_storage import GeneratedStorageDraft
from .creative_provider_asset_adoption import ProviderAdoptionDraft
from .creative_storage_contracts import StorageReceipt


@dataclass(frozen=True)
class CreativeAssetSnapshot:
    schema_version: int
    asset_id: str
    owner_user_id: str
    owner_project_id: str | None
    revision: int
    role: str
    kind: str
    mime_type: str
    byte_size: int
    sha256: str
    storage_receipt: StorageReceipt
    media: dict
    lineage: dict
    source_step_id: str
    execution_graph_sha256: str
    snapshot_sha256: str
    craft_blockers: tuple[str, ...]
    ready_for_persistence: bool = True
    publication_authorized: bool = False

    @property
    def ready_for_craft(self) -> bool:
        return not self.craft_blockers


def _uuid(value: object, label: str, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    try:
        parsed = str(UUID(value))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    if parsed != value:
        raise ValueError(f'{label} no es UUID canónico.')
    return parsed


def _media(metadata: dict) -> tuple[str, dict, tuple[str, ...]]:
    if not isinstance(metadata, dict):
        raise ValueError('Faltan metadatos del medio.')
    kind = metadata.get('kind')
    if kind not in ('image', 'video', 'audio', 'image_sequence'):
        raise ValueError('Tipo de asset no admitido.')
    blockers = []
    value = {
        'widthPixels': metadata.get('widthPixels'),
        'heightPixels': metadata.get('heightPixels'),
        'frameRate': None,
        'durationSeconds': metadata.get('durationSeconds'),
        'sampleRateHz': metadata.get('sampleRateHz'),
        'channels': metadata.get('channels'),
        'samplesPerChannel': metadata.get('samplesPerChannel'),
        'encoding': metadata.get('encoding'),
        'hasAlpha': bool(metadata.get('hasAlpha', False)),
    }
    if kind in ('image', 'video', 'image_sequence'):
        if (not isinstance(value['widthPixels'], int)
                or not isinstance(value['heightPixels'], int)
                or value['widthPixels'] <= 0 or value['heightPixels'] <= 0):
            raise ValueError('El medio visual no tiene geometría válida.')
    elif value['widthPixels'] is not None or value['heightPixels'] is not None:
        raise ValueError('Un audio no admite geometría visual.')
    if kind in ('video', 'image_sequence'):
        rate = metadata.get('frameRate')
        if isinstance(rate, dict):
            numerator, denominator = rate.get('numerator'), rate.get('denominator')
            rate = (numerator / denominator if isinstance(numerator, int)
                    and isinstance(denominator, int) and denominator > 0 else None)
        if (not isinstance(rate, (int, float)) or isinstance(rate, bool) or rate <= 0
                or not isinstance(value['durationSeconds'], (int, float))
                or isinstance(value['durationSeconds'], bool)
                or value['durationSeconds'] <= 0):
            raise ValueError('El vídeo no tiene duración o cadencia válidas.')
        fraction = Fraction(str(rate)).limit_denominator(1001)
        value['frameRate'] = {'numerator': fraction.numerator,
                              'denominator': fraction.denominator}
    if kind == 'image_sequence':
        fields = ('frameCount', 'manifestSha256', 'bundlePlanSha256', 'format')
        frame_count, manifest, bundle_plan, bundle_format = (
            metadata.get(field) for field in fields)
        if (not isinstance(frame_count, int) or isinstance(frame_count, bool)
                or frame_count < 1 or not isinstance(manifest, str)
                or not isinstance(bundle_plan, str) or len(manifest) != 64
                or len(bundle_plan) != 64
                or bundle_format != 'uonify.effect-frame-bundle.v1'):
            raise ValueError('La secuencia no conserva manifest y plan válidos.')
        value.update(frameCount=frame_count, manifestSha256=manifest,
                     bundlePlanSha256=bundle_plan, format=bundle_format)
        blockers.append('image_sequence_unpack_not_implemented')
    if kind == 'audio':
        required = (value['durationSeconds'], value['sampleRateHz'],
                    value['channels'], value['encoding'])
        if any(item is None for item in required):
            blockers.append('audio_metadata_incomplete')
        elif (not isinstance(value['durationSeconds'], (int, float))
              or isinstance(value['durationSeconds'], bool)
              or value['durationSeconds'] <= 0
              or not isinstance(value['sampleRateHz'], int)
              or value['sampleRateHz'] <= 0
              or not isinstance(value['channels'], int) or value['channels'] <= 0
              or not isinstance(value['encoding'], str) or not value['encoding']):
            raise ValueError('Los metadatos de audio no son válidos.')
    return kind, value, tuple(blockers)


def bind_creative_asset(
        draft: GeneratedStorageDraft | ProviderAdoptionDraft,
        receipt: StorageReceipt, *,
        owner_user_id: str, owner_project_id: str | None,
        revision: int, source_step_id: str, execution_graph_sha256: str,
        ) -> CreativeAssetSnapshot:
    """Liga propiedad, bytes, GCS, metadata y linaje sin escribir autoridad."""
    if (not isinstance(draft, (GeneratedStorageDraft, ProviderAdoptionDraft))
            or not isinstance(receipt, StorageReceipt)):
        raise ValueError('Draft o recibo de asset no válidos.')
    user_id = _uuid(owner_user_id, 'ownerUserId')
    project_id = _uuid(owner_project_id, 'ownerProjectId', optional=True)
    asset_id = _uuid(draft.asset_id, 'assetId')
    step_id = _uuid(source_step_id, 'sourceStepId')
    if (not isinstance(revision, int) or isinstance(revision, bool) or revision < 1
            or not HASH.fullmatch(execution_graph_sha256)
            or not isinstance(draft.lineage, dict) or not draft.lineage
            or not isinstance(draft.role, str) or not draft.role):
        raise ValueError('Revisión, grafo o linaje del asset no válidos.')
    expected = (draft.upload.expected if isinstance(draft, GeneratedStorageDraft)
                else draft.expected)
    expected_prefix = f'creative/users/{user_id}/assets/{asset_id}/{draft.sha256}.'
    if (receipt.bucket != expected.bucket or receipt.name != expected.name
            or receipt.generation <= 0 or receipt.mime_type != expected.mime_type
            or receipt.byte_size != expected.byte_size
            or receipt.sha256 != expected.sha256
            or draft.mime_type != receipt.mime_type or draft.sha256 != receipt.sha256
            or not receipt.name.startswith(expected_prefix)):
        raise ValueError('El recibo GCS no corresponde al draft y propietario.')
    kind, media, blockers = _media(draft.metadata)
    expected_mime = {'image': 'image/', 'video': 'video/', 'audio': 'audio/',
                     'image_sequence': 'application/zip'}[kind]
    if (kind == 'image_sequence' and receipt.mime_type != expected_mime
            or kind != 'image_sequence'
            and not receipt.mime_type.startswith(expected_mime)):
        raise ValueError('El MIME no corresponde al tipo del asset.')
    body = {
        'schemaVersion': 1, 'assetId': asset_id, 'ownerUserId': user_id,
        'ownerProjectId': project_id, 'revision': revision, 'role': draft.role,
        'kind': kind, 'mimeType': receipt.mime_type, 'byteSize': receipt.byte_size,
        'sha256': receipt.sha256, 'storageReceipt': asdict(receipt),
        'media': media, 'lineage': draft.lineage, 'sourceStepId': step_id,
        'executionGraphSha256': execution_graph_sha256,
    }
    return CreativeAssetSnapshot(
        1, asset_id, user_id, project_id, revision, draft.role, kind,
        receipt.mime_type, receipt.byte_size, receipt.sha256, receipt, media,
        draft.lineage, step_id, execution_graph_sha256, canonical_sha256(body),
        blockers)


def craft_asset_payload(snapshot: CreativeAssetSnapshot, *, mount_name: str,
                        persisted_snapshot_sha256: str,
                        authorization_state: str,
                        image_sequence_mount: object | None = None,
                        allow_pending_materialization: bool = False) -> dict:
    """Proyecta una fila ya persistida/autorizada al DTO exacto de Craft."""
    path = PurePosixPath(mount_name) if isinstance(mount_name, str) else None
    sequence = (isinstance(snapshot, CreativeAssetSnapshot)
                and snapshot.kind == 'image_sequence')
    if (not isinstance(snapshot, CreativeAssetSnapshot)
            or (not snapshot.ready_for_craft and not sequence)
            or persisted_snapshot_sha256 != snapshot.snapshot_sha256
            or authorization_state != 'allowed'
            or path is None or not mount_name or len(mount_name) > 128
            or path.name != mount_name or mount_name in ('.', '..')
            or '\\' in mount_name):
        raise ValueError('El asset no está persistido y autorizado para Craft.')
    materialization = None
    if sequence:
        if image_sequence_mount is not None:
            from .creative_image_sequence_mount import verify_image_sequence_mount_files
            materialization = verify_image_sequence_mount_files(
                snapshot, image_sequence_mount)
        elif not allow_pending_materialization:
            raise ValueError('El asset no está persistido y autorizado para Craft.')
    receipt = snapshot.storage_receipt
    result = {
        'assetId': snapshot.asset_id, 'ownerUserId': snapshot.owner_user_id,
        'ownerProjectId': snapshot.owner_project_id,
        'assetRevision': snapshot.revision, 'kind': snapshot.kind,
        'mimeType': snapshot.mime_type, 'bytes': snapshot.byte_size,
        'sha256': snapshot.sha256,
        'origin': snapshot.lineage.get('origin', 'unknown'),
        'lineage': snapshot.lineage,
        'storageReceipt': {
            'bucket': receipt.bucket, 'name': receipt.name,
            'generation': receipt.generation, 'mimeType': receipt.mime_type,
            'byteSize': receipt.byte_size, 'sha256': receipt.sha256,
        },
        'authorizationState': authorization_state,
        'media': snapshot.media, 'mountName': mount_name,
    }
    if materialization is not None:
        result['materialization'] = materialization
    return result
