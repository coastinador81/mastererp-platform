"""Byte-level technical inspection before candidate evaluation.

This inactive internal service accepts exact private-object bytes, verifies them
against persisted quarantine authority and derives the receipt itself. It has no
route, worker, download, publication or provider call.
"""

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
from uuid import UUID, uuid5

from PIL import __version__ as PILLOW_VERSION

from psycopg.types.json import Jsonb

from .creative_candidate_contract import validate_inspection_receipt
from .creative_candidate_lifecycle import (_candidate, _owner,
    _quarantine_items)
from .creative_composite_quote import canonical_sha256
from .creative_image_sequence_mount import inspect_image_sequence_bytes
from .creative_media_inspection import (DecoderUnavailable, MAX_AUDIO_BYTES,
    MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, inspect_media_payload)
from .creative_png_validation import validate_png


INSPECTOR = 'uonify-server-byte-inspector'
INSPECTION_NAMESPACE = UUID('cb06ff73-e20d-5f07-a3b6-2d3609994eaa')
MAX_BUNDLE_BYTES = 250_000_000
MAX_SEQUENCE_TOTAL_PIXELS = 100_000_000
INSPECTION_SOURCE_NAMES = (
    'creative_candidate_inspection.py', 'creative_candidate_contract.py',
    'creative_candidate_lifecycle.py', 'creative_composite_quote.py',
    'creative_png_validation.py', 'creative_image_sequence_mount.py',
    'creative_effect_frame_bundle.py', 'craft_contracts.py',
    'creative_media_inspection.py', 'creative_image_contracts.py',
    'creative_video_contracts.py')


@dataclass(frozen=True)
class CandidateInspectionReceipt:
    inspection_id: str
    candidate_id: str
    inspection_sha256: str
    created: bool


def inspection_source_manifest() -> dict:
    root = Path(__file__).parent
    return {'schemaVersion': 1, 'runtime': {
        'python': sys.version, 'pillow': PILLOW_VERSION}, 'sources': [
        {'path': f'backend/app/{name}',
         'sha256': sha256((root / name).read_bytes()).hexdigest()}
        for name in INSPECTION_SOURCE_NAMES]}


def inspection_implementation_sha256() -> str:
    """Hash inspector plus every transitive decoder source artifact."""
    return canonical_sha256(inspection_source_manifest())


def register_inspection_implementation(c) -> dict:
    manifest = inspection_source_manifest()
    implementation = canonical_sha256(manifest)
    c.execute('''INSERT INTO creative_inspection_implementations
        (inspector,implementation_sha256,source_manifest)
        VALUES(%s,%s,%s) ON CONFLICT DO NOTHING''',
        (INSPECTOR, implementation, Jsonb(manifest)))
    row = c.execute('''SELECT * FROM creative_inspection_implementations
        WHERE inspector=%s AND implementation_sha256=%s''',
        (INSPECTOR, implementation)).fetchone()
    if not row or row['source_manifest'] != manifest:
        raise ValueError('La implementación de inspección registrada no coincide.')
    return row


def _inspect_png(item: dict, payload: bytes) -> dict:
    media = item['media']
    with NamedTemporaryFile(prefix='uonify-inspect-', suffix='.png') as target:
        target.write(payload)
        target.flush()
        validate_png(Path(target.name), media['widthPixels'],
                     media['heightPixels'], bool(media.get('hasAlpha')),
                     1024 * 1024)
    return {
        'decoder': 'uonify.strict-png-v1',
        'widthPixels': media['widthPixels'],
        'heightPixels': media['heightPixels'],
        'hasAlpha': bool(media.get('hasAlpha')),
    }


def _validate_inspection_complexity(item: dict) -> None:
    """Reject declared decode work before opening any image payload."""
    kind = item.get('kind')
    if kind not in ('image', 'image_sequence'):
        return
    media = item.get('media')
    if not isinstance(media, dict):
        raise ValueError('Los metadatos del medio no son válidos.')
    width, height = media.get('widthPixels'), media.get('heightPixels')
    if (not isinstance(width, int) or isinstance(width, bool) or width <= 0
            or not isinstance(height, int) or isinstance(height, bool)
            or height <= 0):
        raise ValueError('La geometría del medio no es válida.')
    frame_pixels = width * height
    if frame_pixels > MAX_IMAGE_PIXELS:
        raise ValueError('La imagen supera el límite de píxeles.')
    if kind == 'image_sequence':
        frame_count = media.get('frameCount')
        if (not isinstance(frame_count, int) or isinstance(frame_count, bool)
                or frame_count <= 0):
            raise ValueError('El número de frames no es válido.')
        if frame_pixels * frame_count > MAX_SEQUENCE_TOTAL_PIXELS:
            raise ValueError('La secuencia supera el límite total de píxeles.')


def inspect_asset_payload(item: dict, payload: bytes) -> dict:
    """Inspect exact bytes and derive a closed technical result."""
    if not isinstance(payload, bytes):
        raise ValueError('La inspección técnica requiere bytes exactos.')
    kind = item.get('kind')
    limit = (MAX_IMAGE_BYTES if kind == 'image' else MAX_AUDIO_BYTES
             if kind == 'audio' else MAX_BUNDLE_BYTES)
    if not 0 < len(payload) <= limit:
        raise ValueError('Los bytes exceden el límite del inspector técnico.')
    digest = sha256(payload).hexdigest()
    if len(payload) != item.get('byte_size') or digest != item.get('sha256'):
        raise ValueError('Los bytes de inspección no coinciden con el asset.')
    mime_type = item.get('mime_type')
    issues: list[str] = []
    decoded = None
    try:
        _validate_inspection_complexity(item)
        if kind == 'image' and mime_type == 'image/png':
            decoded = _inspect_png(item, payload)
        elif kind == 'image_sequence' and mime_type == 'application/zip':
            decoded = inspect_image_sequence_bytes(
                item['media'], payload, expected_sha256=digest)
        else:
            decoded = inspect_media_payload(item, payload)
    except DecoderUnavailable:
        issues.append('technical_decoder_not_implemented')
    except ValueError:
        issues.append('technical_decode_failed')
    measurements = {
        'observedByteSize': len(payload),
        'observedSha256': digest,
        'mimeType': mime_type,
        'kind': kind,
        'storageGeneration': item.get('storage_generation'),
        'decoded': decoded,
    }
    return {
        'assetId': str(item.get('asset_id')),
        'revision': item.get('revision'),
        'snapshotSha256': item.get('snapshot_sha256'),
        'automaticPassed': not issues,
        'issues': issues,
        'measurements': measurements,
    }


def _inspection_id(candidate_id: str, quarantine_set_sha256: str) -> str:
    return str(uuid5(
        INSPECTION_NAMESPACE, f'{candidate_id}:{quarantine_set_sha256}'))


def inspect_candidate_bytes(c, user: dict, candidate_id: object,
                            payloads: dict[str, bytes]
                            ) -> CandidateInspectionReceipt:
    owner = _owner(c, user, lock=False)
    candidate, _ = _candidate(c, owner, candidate_id)
    register_inspection_implementation(c)
    if candidate['state'] != 'quarantined':
        raise ValueError('El candidato no admite inspección técnica.')
    items = _quarantine_items(c, owner['id'], candidate['id'])
    expected = {str(item['asset_id']) for item in items}
    if not isinstance(payloads, dict) or set(payloads) != expected:
        raise ValueError('Los bytes no cubren exactamente la cuarentena.')
    results = [inspect_asset_payload(item, payloads[str(item['asset_id'])])
               for item in items]
    implementation = inspection_implementation_sha256()
    inspection_id = _inspection_id(
        str(candidate['id']), candidate['quarantine_set_sha256'])
    prior = c.execute('''SELECT inspection_sha256,implementation_sha256,receipt
        FROM creative_candidate_inspections WHERE user_id=%s AND id=%s''',
        (owner['id'], inspection_id)).fetchone()
    if prior:
        try:
            prior_receipt = validate_inspection_receipt(prior['receipt'])
        except ValueError:
            raise ValueError('inspectionId ya liga otra inspección.') from None
        if (prior['implementation_sha256'] != implementation
                or prior_receipt['results'] != results
                or prior_receipt['inspectionSha256']
                != prior['inspection_sha256']):
            raise ValueError('inspectionId ya liga otra inspección.')
        return CandidateInspectionReceipt(
            inspection_id, str(candidate['id']), prior['inspection_sha256'], False)
    received_at = c.execute('SELECT clock_timestamp() value').fetchone()['value']
    received = received_at.isoformat().replace('+00:00', 'Z')
    receipt = {
        'schemaVersion': 1, 'inspectionId': inspection_id,
        'candidateId': str(candidate['id']),
        'quarantineSetSha256': candidate['quarantine_set_sha256'],
        'inspector': INSPECTOR, 'implementationSha256': implementation,
        'results': results,
        'technicalPassed': bool(results) and all(
            item['automaticPassed'] for item in results),
        'receivedAt': received, 'inspectionSha256': '',
        'acceptedForUse': False, 'publicationAuthorized': False,
    }
    receipt['inspectionSha256'] = canonical_sha256({
        key: value for key, value in receipt.items()
        if key != 'inspectionSha256'})
    receipt = validate_inspection_receipt(receipt)
    c.execute('''INSERT INTO creative_candidate_inspections
        (user_id,id,candidate_id,quarantine_set_sha256,inspector,
         implementation_sha256,inspection_sha256,technical_passed,
         received_at,receipt)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], inspection_id, candidate['id'],
         candidate['quarantine_set_sha256'], INSPECTOR, implementation,
         receipt['inspectionSha256'], receipt['technicalPassed'],
         received_at, Jsonb(receipt)))
    return CandidateInspectionReceipt(
        inspection_id, str(candidate['id']), receipt['inspectionSha256'], True)
