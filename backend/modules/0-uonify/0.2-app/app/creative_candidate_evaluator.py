"""Server-owned technical evaluation for quarantined creative candidates.

The evaluator consumes only persisted asset rows. It performs no provider call,
download, publication or worker admission and accepts no caller-authored result.
"""

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from uuid import UUID, uuid5

from psycopg.types.json import Jsonb

from .creative_candidate_contract import validate_evaluation_receipt
from .creative_composite_quote import HASH, canonical_sha256


POLICY_ID = 'uonify.creative.candidate.structural-plus-byte-inspection'
POLICY_VERSION = '1.0.0'
EVALUATOR = 'uonify-server-candidate-evaluator'
EVALUATION_NAMESPACE = UUID('79ebae06-4344-5dd5-a213-c2e07092bf54')
POLICY = {
    'schemaVersion': 1,
    'policyId': POLICY_ID,
    'version': POLICY_VERSION,
    'inputAuthority': 'persisted_quarantine_asset_revision',
    'structuralRules': [
        'identity_matches_quarantine', 'bytes_and_storage_are_positive',
        'mime_matches_kind', 'visual_geometry_is_positive',
        'timed_media_has_positive_timing',
        'image_sequence_has_closed_manifest',
        'audio_has_complete_technical_metadata',
    ],
    'technicalInspection': 'required_exact_private_bytes',
    'automaticPass': 'all_structural_and_technical_results_have_no_issues',
    'humanReview': 'required_after_automatic_pass',
    'publicationAuthorized': False,
}
POLICY_SHA256 = canonical_sha256(POLICY)
MEASUREMENT_MEDIA_FIELDS = (
    'widthPixels', 'heightPixels', 'durationSeconds', 'frameRate', 'frameCount',
    'sampleRateHz', 'channels', 'samplesPerChannel', 'encoding', 'hasAlpha',
    'manifestSha256', 'bundlePlanSha256', 'format')
EVALUATOR_SOURCE_NAMES = (
    'creative_candidate_evaluator.py', 'creative_candidate_contract.py',
    'creative_composite_quote.py')


def register_evaluation_policy(c) -> dict:
    """Register and re-read the exact immutable policy before evaluating."""
    implementation_sha256 = evaluator_implementation_sha256()
    implementation = {
        'module': 'app.creative_candidate_evaluator',
        'artifactSha256': implementation_sha256,
        'sourceManifest': evaluator_source_manifest(),
        'algorithm': 'derive_candidate_evaluation_v1',
    }
    c.execute('''INSERT INTO creative_evaluation_policies
        (policy_id,policy_version,policy_sha256,evaluator,
         implementation_sha256,policy,implementation)
        VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
        (POLICY_ID, POLICY_VERSION, POLICY_SHA256, EVALUATOR,
         implementation_sha256, Jsonb(POLICY), Jsonb(implementation)))
    row = c.execute('''SELECT * FROM creative_evaluation_policies
        WHERE policy_id=%s AND policy_version=%s''',
        (POLICY_ID, POLICY_VERSION)).fetchone()
    if (not row or row['policy_sha256'] != POLICY_SHA256
            or row['evaluator'] != EVALUATOR
            or row['implementation_sha256'] != implementation_sha256
            or row['policy'] != POLICY or row['implementation'] != implementation):
        raise ValueError('La política de evaluación registrada no coincide.')
    return row


def _positive_number(value: object) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and value > 0)


def _mime_matches(kind: object, mime_type: object) -> bool:
    if not isinstance(mime_type, str):
        return False
    expected = {'image': 'image/', 'video': 'video/', 'audio': 'audio/',
                'image_sequence': 'application/zip'}.get(kind)
    return bool(expected and (mime_type == expected if kind == 'image_sequence'
                              else mime_type.startswith(expected)))


def derive_evaluation_result(item: dict, technical: dict | None = None) -> dict:
    """Combine structural authority with one exact byte-inspection result."""
    media = item.get('media') if isinstance(item.get('media'), dict) else {}
    kind = item.get('kind')
    issues: list[str] = []
    if kind not in ('image', 'video', 'audio', 'image_sequence'):
        issues.append('unsupported_kind')
    if not _mime_matches(kind, item.get('mime_type')):
        issues.append('mime_kind_mismatch')
    if not isinstance(item.get('byte_size'), int) or item['byte_size'] <= 0:
        issues.append('invalid_byte_size')
    if (not isinstance(item.get('storage_generation'), int)
            or item['storage_generation'] <= 0):
        issues.append('invalid_storage_generation')
    if not isinstance(item.get('sha256'), str) or not HASH.fullmatch(item['sha256']):
        issues.append('invalid_asset_sha256')
    if (kind in ('image', 'video', 'image_sequence')
            and (not _positive_number(media.get('widthPixels'))
                 or not _positive_number(media.get('heightPixels')))):
        issues.append('invalid_visual_geometry')
    if (kind in ('video', 'image_sequence')
            and (not _positive_number(media.get('durationSeconds'))
                 or not isinstance(media.get('frameRate'), dict)
                 or not _positive_number(media['frameRate'].get('numerator'))
                 or not _positive_number(media['frameRate'].get('denominator')))):
        issues.append('invalid_timed_media')
    if kind == 'image_sequence' and (
            not isinstance(media.get('frameCount'), int)
            or media['frameCount'] < 1
            or not HASH.fullmatch(str(media.get('manifestSha256', '')))
            or not HASH.fullmatch(str(media.get('bundlePlanSha256', '')))
            or media.get('format') != 'uonify.effect-frame-bundle.v1'):
        issues.append('invalid_image_sequence_manifest')
    if kind == 'audio' and (
            not _positive_number(media.get('durationSeconds'))
            or not _positive_number(media.get('sampleRateHz'))
            or not _positive_number(media.get('channels'))
            or not isinstance(media.get('encoding'), str)
            or not media['encoding']):
        issues.append('incomplete_audio_metadata')
    structural = {
        'kind': kind, 'mimeType': item.get('mime_type'),
        'byteSize': item.get('byte_size'), 'sha256': item.get('sha256'),
        'storageGeneration': item.get('storage_generation'),
        **{field: deepcopy(media.get(field)) for field in MEASUREMENT_MEDIA_FIELDS},
    }
    identity = (str(item.get('asset_id')), item.get('revision'),
                item.get('snapshot_sha256'))
    technical_matches = (isinstance(technical, dict)
        and (technical.get('assetId'), technical.get('revision'),
             technical.get('snapshotSha256')) == identity
        and isinstance(technical.get('automaticPassed'), bool)
        and isinstance(technical.get('issues'), list)
        and isinstance(technical.get('measurements'), dict))
    if not technical_matches:
        issues.append('technical_inspection_missing')
        technical_measurements = None
    else:
        issues.extend(technical['issues'])
        technical_measurements = deepcopy(technical['measurements'])
    return {
        'assetId': str(item.get('asset_id')),
        'revision': item.get('revision'),
        'snapshotSha256': item.get('snapshot_sha256'),
        'automaticPassed': not issues,
        'issues': issues,
        'measurements': {'structural': structural,
                         'technical': technical_measurements},
    }


def evaluation_id(candidate_id: str, quarantine_set_sha256: str) -> str:
    identity = f'{candidate_id}:{quarantine_set_sha256}:{POLICY_SHA256}'
    return str(uuid5(EVALUATION_NAMESPACE, identity))


def evaluator_source_manifest() -> dict:
    root = Path(__file__).parent
    return {'schemaVersion': 1, 'sources': [
        {'path': f'backend/app/{name}',
         'sha256': sha256((root / name).read_bytes()).hexdigest()}
        for name in EVALUATOR_SOURCE_NAMES]}


def evaluator_implementation_sha256() -> str:
    """Hash evaluator plus canonical validation/hash dependencies."""
    return canonical_sha256(evaluator_source_manifest())


def build_evaluation_receipt(candidate_id: str, quarantine_set_sha256: str,
                             items: list[dict], technical_receipt: dict,
                             received_at: datetime) -> dict:
    """Build a deterministic-identity receipt with a server timestamp."""
    if not isinstance(received_at, datetime) or received_at.tzinfo is None:
        raise ValueError('receivedAt debe proceder del reloj de base de datos.')
    technical_results = (technical_receipt.get('results')
                         if isinstance(technical_receipt, dict) else None)
    if (not isinstance(technical_results, list)
            or len(technical_results) != len(items)
            or not isinstance(technical_receipt.get('inspectionSha256'), str)):
        raise ValueError('Falta la inspección técnica exacta del candidato.')
    results = [derive_evaluation_result(item, technical_results[index])
               for index, item in enumerate(items)]
    automatic = bool(results) and all(item['automaticPassed'] for item in results)
    value = {
        'schemaVersion': 2,
        'evaluationId': evaluation_id(candidate_id, quarantine_set_sha256),
        'candidateId': candidate_id,
        'quarantineSetSha256': quarantine_set_sha256,
        'evaluator': EVALUATOR,
        'policyId': POLICY_ID,
        'policyVersion': POLICY_VERSION,
        'policySha256': POLICY_SHA256,
        'implementationSha256': evaluator_implementation_sha256(),
        'inspectionId': technical_receipt['inspectionId'],
        'inspectionSha256': technical_receipt['inspectionSha256'],
        'inspectionImplementationSha256': technical_receipt[
            'implementationSha256'],
        'results': results,
        'automaticPassed': automatic,
        'readyForHumanReview': automatic,
        'receivedAt': (received_at.astimezone(timezone.utc).isoformat()
                       .replace('+00:00', 'Z')),
        'evaluationSha256': '',
        'acceptedForUse': False,
        'publicationAuthorized': False,
    }
    value['evaluationSha256'] = canonical_sha256({
        key: item for key, item in value.items() if key != 'evaluationSha256'})
    return validate_evaluation_receipt(value)
