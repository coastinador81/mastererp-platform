"""Canonical hashes and closed shapes for quarantined creative candidates."""

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import PurePosixPath
import re
from uuid import UUID

from .creative_composite_quote import canonical_sha256


HASH = re.compile(r'[0-9a-f]{64}\Z')
ROLE = re.compile(r'[a-z][a-z0-9_]{0,63}\Z')
MIME = {'image/png', 'image/jpeg', 'image/webp', 'video/mp4',
        'audio/mpeg', 'audio/wav', 'audio/L16;codec=pcm;rate=24000',
        'application/zip'}
CANDIDATE_FIELDS = {
    'schemaVersion', 'candidateId', 'ownerUserId', 'uonifyProjectId', 'jobId',
    'stepId', 'attemptId', 'attemptNo', 'leaseToken', 'fenceEpoch', 'admissionId',
    'admissionSha256', 'claimSetSha256', 'executionGraphSha256',
    'jobBindingSha256', 'inputManifestSha256', 'recipeSha256',
    'adapterPlanSha256', 'capabilityMatrixSha256', 'engine', 'nativeProject',
    'outputs', 'outputManifestSha256', 'candidateContentSha256',
    'craftCandidateResultSha256', 'candidateReceiptSha256', 'receivedAt', 'quarantineState',
    'acceptedForUse', 'publicationAuthorized'}
CANDIDATE_DRAFT_FIELDS = CANDIDATE_FIELDS - {
    'candidateReceiptSha256', 'receivedAt'}
OUTPUT_FIELDS = {'outputId', 'assetId', 'revision', 'ordinal', 'role',
                 'relativePath', 'mimeType', 'byteSize', 'sha256', 'media',
                 'lineage', 'storageDraft'}


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


def _hash(value: object, label: str) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError(f'{label} no es SHA-256.')
    return value


def _path(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError('La ruta interna del candidato no es válida.')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or path.parts[:1] != ('out',):
        raise ValueError('La ruta interna del candidato no es válida.')
    return value


def _time(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError('receivedAt no es RFC3339.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('receivedAt no es RFC3339.') from None
    if parsed.tzinfo is None:
        raise ValueError('receivedAt no es RFC3339.')
    return value


def candidate_content_sha256(receipt: dict) -> str:
    body = deepcopy(receipt)
    for key in ('attemptId', 'attemptNo', 'leaseToken', 'fenceEpoch', 'admissionId',
                'admissionSha256', 'claimSetSha256', 'candidateContentSha256',
                'candidateReceiptSha256', 'receivedAt'):
        body.pop(key, None)
    return canonical_sha256(body)


def candidate_receipt_sha256(receipt: dict) -> str:
    body = deepcopy(receipt)
    body.pop('candidateReceiptSha256', None)
    return canonical_sha256(body)


def _validate_candidate(receipt: object, *, stored: bool) -> dict:
    fields = CANDIDATE_FIELDS if stored else CANDIDATE_DRAFT_FIELDS
    label = 'CreativeCandidateReceiptV1' if stored else 'CreativeCandidateDraftV1'
    if not isinstance(receipt, dict) or set(receipt) != fields:
        raise ValueError(f'{label} no coincide.')
    if (receipt.get('schemaVersion') != 1
            or receipt.get('quarantineState') != 'pending_storage'
            or receipt.get('acceptedForUse') is not False
            or receipt.get('publicationAuthorized') is not False):
        raise ValueError('El candidato no nace cerrado y en cuarentena.')
    for key in ('candidateId', 'ownerUserId', 'jobId', 'stepId', 'attemptId',
                'leaseToken', 'admissionId'):
        _uuid(receipt.get(key), key)
    _uuid(receipt.get('uonifyProjectId'), 'uonifyProjectId', optional=True)
    for key in ('attemptNo', 'fenceEpoch'):
        if (not isinstance(receipt.get(key), int)
                or isinstance(receipt[key], bool) or receipt[key] < 1):
            raise ValueError(f'{key} no es válido.')
    for key in ('admissionSha256', 'claimSetSha256', 'executionGraphSha256',
                'jobBindingSha256', 'inputManifestSha256', 'recipeSha256',
                'adapterPlanSha256', 'capabilityMatrixSha256',
                'outputManifestSha256', 'craftCandidateResultSha256',
                'candidateContentSha256',
                *(['candidateReceiptSha256'] if stored else [])):
        _hash(receipt.get(key), key)
    if stored:
        _time(receipt.get('receivedAt'))
    engine = receipt.get('engine')
    if (not isinstance(engine, dict)
            or set(engine) != {'name', 'version', 'operation', 'engineJobId'}
            or not all(isinstance(engine.get(key), str) and engine[key]
                       for key in ('name', 'version', 'operation'))
            or (engine.get('engineJobId') is not None
                and not isinstance(engine['engineJobId'], (str, int)))):
        raise ValueError('El engine del candidato no es válido.')
    native = receipt.get('nativeProject')
    if (not isinstance(native, dict) or not isinstance(native.get('byteSize'), int)
            or native['byteSize'] <= 0 or not isinstance(native.get('mimeType'), str)
            or not isinstance(native.get('relativePath'), str)
            or not HASH.fullmatch(str(native.get('sha256', '')))):
        raise ValueError('El proyecto nativo del candidato no es válido.')
    outputs = receipt.get('outputs')
    if not isinstance(outputs, list) or not 1 <= len(outputs) <= 64:
        raise ValueError('El manifest de salidas del candidato no es válido.')
    identities = set()
    for ordinal, item in enumerate(outputs):
        if not isinstance(item, dict) or set(item) != OUTPUT_FIELDS:
            raise ValueError('Una salida del candidato no coincide.')
        output_id = _uuid(item.get('outputId'), 'outputId')
        asset_id = _uuid(item.get('assetId'), 'assetId')
        if ((output_id, asset_id) in identities or item.get('ordinal') != ordinal
                or item.get('revision') != 1 or not ROLE.fullmatch(str(item.get('role', '')))
                or item.get('mimeType') not in MIME
                or not isinstance(item.get('byteSize'), int) or item['byteSize'] <= 0
                or not HASH.fullmatch(str(item.get('sha256', '')))
                or not isinstance(item.get('media'), dict)
                or not isinstance(item.get('lineage'), dict)):
            raise ValueError('Una salida del candidato no es verificable.')
        identities.add((output_id, asset_id))
        _path(item.get('relativePath'))
        draft = item.get('storageDraft')
        if (not isinstance(draft, dict)
                or set(draft) != {'state', 'relativePath', 'mimeType'}
                or draft.get('state') != 'candidate_local'
                or draft.get('relativePath') != item['relativePath']
                or draft.get('mimeType') != item['mimeType']):
            raise ValueError('El storageDraft del candidato no coincide.')
    if len({item['outputId'] for item in outputs}) != len(outputs):
        raise ValueError('Los outputId del candidato se repiten.')
    if len({item['assetId'] for item in outputs}) != len(outputs):
        raise ValueError('Los assetId del candidato se repiten.')
    if canonical_sha256(outputs) != receipt['outputManifestSha256']:
        raise ValueError('El outputManifestSha256 del candidato no coincide.')
    if candidate_content_sha256(receipt) != receipt['candidateContentSha256']:
        raise ValueError('El candidateContentSha256 no coincide.')
    if (stored and candidate_receipt_sha256(receipt)
            != receipt['candidateReceiptSha256']):
        raise ValueError('El candidateReceiptSha256 no coincide.')
    return receipt


def validate_candidate_draft(receipt: object) -> dict:
    """Validate caller material without accepting server-owned fields."""
    return _validate_candidate(receipt, stored=False)


def validate_candidate_receipt(receipt: object) -> dict:
    """Validate a receipt after Uonify stamped it with database time."""
    return _validate_candidate(receipt, stored=True)


def stamp_candidate_receipt(draft: dict, received_at: datetime) -> dict:
    value = deepcopy(validate_candidate_draft(draft))
    if not isinstance(received_at, datetime) or received_at.tzinfo is None:
        raise ValueError('receivedAt debe proceder del reloj de base de datos.')
    value['receivedAt'] = (received_at.astimezone(timezone.utc).isoformat()
                           .replace('+00:00', 'Z'))
    value['candidateReceiptSha256'] = candidate_receipt_sha256(value)
    return validate_candidate_receipt(value)


def _receipt_hash(value: object, fields: set[str], hash_key: str,
                  label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError(f'{label} no coincide.')
    _hash(value.get(hash_key), hash_key)
    body = deepcopy(value)
    body.pop(hash_key)
    if canonical_sha256(body) != value[hash_key]:
        raise ValueError(f'{hash_key} no coincide.')
    return value


def validate_evaluation_receipt(value: object) -> dict:
    """Validate the closed server-produced evaluation receipt."""
    fields = {'schemaVersion', 'evaluationId', 'candidateId',
              'quarantineSetSha256', 'evaluator', 'policyId', 'policyVersion',
              'policySha256', 'implementationSha256', 'inspectionId',
              'inspectionSha256',
              'inspectionImplementationSha256', 'results',
              'automaticPassed', 'readyForHumanReview', 'receivedAt',
              'evaluationSha256', 'acceptedForUse', 'publicationAuthorized'}
    receipt = _receipt_hash(value, fields, 'evaluationSha256',
                            'CreativeEvaluationReceiptV1')
    _uuid(receipt.get('evaluationId'), 'evaluationId')
    _uuid(receipt.get('candidateId'), 'candidateId')
    _uuid(receipt.get('inspectionId'), 'inspectionId')
    _hash(receipt.get('quarantineSetSha256'), 'quarantineSetSha256')
    _hash(receipt.get('policySha256'), 'policySha256')
    _hash(receipt.get('implementationSha256'), 'implementationSha256')
    _hash(receipt.get('inspectionSha256'), 'inspectionSha256')
    _hash(receipt.get('inspectionImplementationSha256'),
          'inspectionImplementationSha256')
    _time(receipt.get('receivedAt'))
    if (receipt.get('schemaVersion') != 2
            or not isinstance(receipt.get('evaluator'), str)
            or not receipt['evaluator']
            or not isinstance(receipt.get('policyId'), str)
            or not receipt['policyId']
            or not isinstance(receipt.get('policyVersion'), str)
            or not receipt['policyVersion']
            or not isinstance(receipt.get('results'), list)
            or not isinstance(receipt.get('automaticPassed'), bool)
            or not isinstance(receipt.get('readyForHumanReview'), bool)
            or receipt.get('acceptedForUse') is not False
            or receipt.get('publicationAuthorized') is not False):
        raise ValueError('La evaluación no está cerrada correctamente.')
    return receipt


def validate_inspection_receipt(value: object) -> dict:
    """Validate the closed server-produced exact-byte inspection receipt."""
    fields = {'schemaVersion', 'inspectionId', 'candidateId',
              'quarantineSetSha256', 'inspector', 'implementationSha256',
              'results', 'technicalPassed', 'receivedAt', 'inspectionSha256',
              'acceptedForUse', 'publicationAuthorized'}
    receipt = _receipt_hash(value, fields, 'inspectionSha256',
                            'CreativeInspectionReceiptV1')
    _uuid(receipt.get('inspectionId'), 'inspectionId')
    _uuid(receipt.get('candidateId'), 'candidateId')
    _hash(receipt.get('quarantineSetSha256'), 'quarantineSetSha256')
    _hash(receipt.get('implementationSha256'), 'implementationSha256')
    _time(receipt.get('receivedAt'))
    results = receipt.get('results')
    if (receipt.get('schemaVersion') != 1
            or not isinstance(receipt.get('inspector'), str)
            or not receipt['inspector'] or not isinstance(results, list)
            or not results or not isinstance(receipt.get('technicalPassed'), bool)
            or receipt.get('acceptedForUse') is not False
            or receipt.get('publicationAuthorized') is not False):
        raise ValueError('La inspección no está cerrada correctamente.')
    for result in results:
        if (not isinstance(result, dict) or set(result) != {
                'assetId', 'revision', 'snapshotSha256', 'automaticPassed',
                'issues', 'measurements'}
                or not isinstance(result.get('revision'), int)
                or isinstance(result['revision'], bool) or result['revision'] < 1
                or not isinstance(result.get('automaticPassed'), bool)
                or not isinstance(result.get('issues'), list)
                or not all(isinstance(issue, str) and issue
                           for issue in result['issues'])
                or not isinstance(result.get('measurements'), dict)
                or set(result['measurements']) != {
                    'observedByteSize', 'observedSha256', 'mimeType', 'kind',
                    'storageGeneration', 'decoded'}):
            raise ValueError('Un resultado de inspección no coincide.')
        _uuid(result.get('assetId'), 'assetId')
        _hash(result.get('snapshotSha256'), 'snapshotSha256')
        _hash(result['measurements'].get('observedSha256'), 'observedSha256')
    return receipt


def validate_review_receipt(value: object) -> dict:
    fields = {'schemaVersion', 'reviewId', 'candidateId', 'evaluationId',
              'reviewer', 'artifactRefs', 'coverage', 'verdicts', 'decision',
              'blockers', 'reviewSha256', 'publicationAuthorized'}
    receipt = _receipt_hash(value, fields, 'reviewSha256',
                            'CreativeHumanReviewReceiptV1')
    for key in ('reviewId', 'candidateId', 'evaluationId'):
        _uuid(receipt.get(key), key)
    if (receipt.get('schemaVersion') != 1
            or receipt.get('decision') not in (
                'approved_for_use', 'revision_requested', 'rejected')
            or not isinstance(receipt.get('reviewer'), str) or not receipt['reviewer']
            or not isinstance(receipt.get('artifactRefs'), list)
            or not isinstance(receipt.get('coverage'), dict)
            or not isinstance(receipt.get('verdicts'), list)
            or not isinstance(receipt.get('blockers'), list)
            or receipt.get('publicationAuthorized') is not False):
        raise ValueError('La revisión humana no está cerrada correctamente.')
    return receipt
