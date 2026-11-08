"""Inactive V2 contract for server-verifiable Craft physical I/O receipts.

The module only defines and validates public receipt values.  It performs no
I/O and grants no transition authority.  A physical verifier must be supplied
by the installation and is required explicitly by ``require_verified_receipt``.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
from typing import Literal, Protocol, runtime_checkable
from uuid import UUID

from .creative_composite_quote import canonical_sha256


SCHEMA_VERSION = 2
PHASES = ('reserve', 'prestart_forget', 'terminal_forget', 'adopt_copy',
          'materialization_populate', 'materialization_forget')
TERMINAL_STATUSES = ('succeeded', 'failed', 'cancelled')
HASH = re.compile(r'[0-9a-f]{64}\Z')
TIMESTAMP = re.compile(
    r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z\Z')

Phase = Literal[
    'reserve', 'prestart_forget', 'terminal_forget', 'adopt_copy',
    'materialization_populate', 'materialization_forget',
]


class CraftPhysicalReceiptError(ValueError):
    """The public receipt is incomplete, non-canonical, or not verified."""


def _closed(value: object, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise CraftPhysicalReceiptError(f'{label} no es un DTO cerrado.')
    return value


def _uuid(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise CraftPhysicalReceiptError(f'{label} no es UUID canónico.')
    try:
        canonical = str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise CraftPhysicalReceiptError(f'{label} no es UUID canónico.') from None
    if canonical != value:
        raise CraftPhysicalReceiptError(f'{label} no es UUID canónico.')
    return value


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise CraftPhysicalReceiptError(f'{label} no es SHA-256 canónico.')
    return value


def _positive_int(value: object, label: str) -> int:
    if type(value) is not int or value < 1:
        raise CraftPhysicalReceiptError(f'{label} debe ser un entero positivo.')
    return value


def _nonnegative_int(value: object, label: str) -> int:
    if type(value) is not int or value < 0:
        raise CraftPhysicalReceiptError(
            f'{label} debe ser un entero no negativo.')
    return value


def _observed_at(value: object) -> str:
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise CraftPhysicalReceiptError('observedAt no es UTC canónico.')
    try:
        parsed = datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        raise CraftPhysicalReceiptError('observedAt no es UTC canónico.') from None
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise CraftPhysicalReceiptError('observedAt no es UTC canónico.')
    return value


@dataclass(frozen=True)
class CraftPhysicalBinding:
    installation_id: str
    verifier_policy_sha256: str
    owner_user_id: str
    job_id: str
    step_id: str
    attempt_id: str
    attempt_no: int
    claim_lease_token_sha256: str
    fence_epoch: int
    admission_sha256: str
    claim_set_sha256: str
    dispatch_id: str
    request_sha256: str
    authority_sha256: str
    storage_domain_id: str | None = None
    intent_id: str | None = None
    population_generation_id: str | None = None
    namespace_id: str | None = None
    population_fence_sha256: str | None = None

    def canonical(self) -> dict:
        value = {
            'installationId': _uuid(self.installation_id, 'installationId'),
            'verifierPolicySha256': _sha(
                self.verifier_policy_sha256, 'verifierPolicySha256'),
            'ownerUserId': _uuid(self.owner_user_id, 'ownerUserId'),
            'jobId': _uuid(self.job_id, 'jobId'),
            'stepId': _uuid(self.step_id, 'stepId'),
            'attemptId': _uuid(self.attempt_id, 'attemptId'),
            'attemptNo': _positive_int(self.attempt_no, 'attemptNo'),
            'claimLeaseTokenSha256': _sha(
                self.claim_lease_token_sha256, 'claimLeaseTokenSha256'),
            'fenceEpoch': _positive_int(self.fence_epoch, 'fenceEpoch'),
            'admissionSha256': _sha(self.admission_sha256, 'admissionSha256'),
            'claimSetSha256': _sha(self.claim_set_sha256, 'claimSetSha256'),
            'dispatchId': _uuid(self.dispatch_id, 'dispatchId'),
            'requestSha256': _sha(self.request_sha256, 'requestSha256'),
            'authoritySha256': _sha(self.authority_sha256, 'authoritySha256'),
        }
        extras = (self.storage_domain_id, self.intent_id,
                  self.population_generation_id, self.namespace_id,
                  self.population_fence_sha256)
        if all(item is None for item in extras):
            return value
        if any(item is None for item in extras):
            raise CraftPhysicalReceiptError(
                'El binding materialization no es cerrado.')
        return {**value,
                'storageDomainId': _uuid(
                    self.storage_domain_id, 'storageDomainId'),
                'intentId': _uuid(self.intent_id, 'intentId'),
                'populationGenerationId': _uuid(
                    self.population_generation_id,
                    'populationGenerationId'),
                'namespaceId': _uuid(self.namespace_id, 'namespaceId'),
                'populationFenceSha256': _sha(
                    self.population_fence_sha256,
                    'populationFenceSha256')}


@dataclass(frozen=True)
class ReserveEvidence:
    materialization_sha256: str
    input_tree_sha256: str
    output_tree_sha256: str
    ownership_marker_sha256: str
    input_count: int
    expected_output_count: int

    phase: Phase = field(default='reserve', init=False)

    def canonical(self) -> dict:
        return {
            'materializationSha256': _sha(
                self.materialization_sha256, 'materializationSha256'),
            'inputTreeSha256': _sha(self.input_tree_sha256, 'inputTreeSha256'),
            'outputTreeSha256': _sha(
                self.output_tree_sha256, 'outputTreeSha256'),
            'ownershipMarkerSha256': _sha(
                self.ownership_marker_sha256, 'ownershipMarkerSha256'),
            'inputCount': _nonnegative_int(self.input_count, 'inputCount'),
            'expectedOutputCount': _positive_int(
                self.expected_output_count, 'expectedOutputCount'),
        }


@dataclass(frozen=True)
class PrestartForgetEvidence:
    materialization_sha256: str
    before_tree_sha256: str
    tombstone_sha256: str
    journal_entry_sha256: str

    phase: Phase = field(default='prestart_forget', init=False)

    def canonical(self) -> dict:
        return {
            'materializationSha256': _sha(
                self.materialization_sha256, 'materializationSha256'),
            'beforeTreeSha256': _sha(
                self.before_tree_sha256, 'beforeTreeSha256'),
            'tombstoneSha256': _sha(self.tombstone_sha256, 'tombstoneSha256'),
            'journalEntrySha256': _sha(
                self.journal_entry_sha256, 'journalEntrySha256'),
        }


@dataclass(frozen=True)
class TerminalForgetEvidence:
    materialization_sha256: str
    before_tree_sha256: str
    terminal_status: Literal['succeeded', 'failed', 'cancelled']
    terminal_receipt_sha256: str
    tombstone_sha256: str
    journal_entry_sha256: str

    phase: Phase = field(default='terminal_forget', init=False)

    def canonical(self) -> dict:
        if self.terminal_status not in TERMINAL_STATUSES:
            raise CraftPhysicalReceiptError('terminalStatus no es cerrado.')
        return {
            'materializationSha256': _sha(
                self.materialization_sha256, 'materializationSha256'),
            'beforeTreeSha256': _sha(
                self.before_tree_sha256, 'beforeTreeSha256'),
            'terminalStatus': self.terminal_status,
            'terminalReceiptSha256': _sha(
                self.terminal_receipt_sha256, 'terminalReceiptSha256'),
            'tombstoneSha256': _sha(self.tombstone_sha256, 'tombstoneSha256'),
            'journalEntrySha256': _sha(
                self.journal_entry_sha256, 'journalEntrySha256'),
        }


@dataclass(frozen=True)
class MaterializationPopulateEvidence:
    plan_sha256: str
    materialization_sha256: str
    input_tree_sha256: str
    output_tree_sha256: str
    ownership_marker_sha256: str

    phase: Phase = field(default='materialization_populate', init=False)

    def canonical(self) -> dict:
        return {
            'planSha256': _sha(self.plan_sha256, 'planSha256'),
            'materializationSha256': _sha(
                self.materialization_sha256, 'materializationSha256'),
            'inputTreeSha256': _sha(
                self.input_tree_sha256, 'inputTreeSha256'),
            'outputTreeSha256': _sha(
                self.output_tree_sha256, 'outputTreeSha256'),
            'ownershipMarkerSha256': _sha(
                self.ownership_marker_sha256, 'ownershipMarkerSha256'),
        }


@dataclass(frozen=True)
class MaterializationForgetEvidence:
    plan_sha256: str
    before_tree_sha256: str
    tombstone_sha256: str
    journal_entry_sha256: str

    phase: Phase = field(default='materialization_forget', init=False)

    def canonical(self) -> dict:
        return {
            'planSha256': _sha(self.plan_sha256, 'planSha256'),
            'beforeTreeSha256': _sha(
                self.before_tree_sha256, 'beforeTreeSha256'),
            'tombstoneSha256': _sha(
                self.tombstone_sha256, 'tombstoneSha256'),
            'journalEntrySha256': _sha(
                self.journal_entry_sha256, 'journalEntrySha256'),
        }


@dataclass(frozen=True)
class AdoptCopyArtifact:
    ordinal: int
    byte_size: int
    sha256: str
    destination_receipt_sha256: str

    def canonical(self) -> dict:
        return {
            'ordinal': _nonnegative_int(self.ordinal, 'artifact.ordinal'),
            'byteSize': _positive_int(self.byte_size, 'artifact.byteSize'),
            'sha256': _sha(self.sha256, 'artifact.sha256'),
            'destinationReceiptSha256': _sha(
                self.destination_receipt_sha256,
                'artifact.destinationReceiptSha256'),
        }


@dataclass(frozen=True)
class AdoptCopyEvidence:
    escrow_id: str
    manifest_sha256: str
    candidate_id: str
    artifact_manifest_sha256: str
    quarantine_set_sha256: str
    adoption_attempt_id: str
    adoption_fence_epoch: int
    adoption_result_sha256: str
    artifacts: tuple[AdoptCopyArtifact, ...]
    copy_set_sha256: str

    phase: Phase = field(default='adopt_copy', init=False)

    def canonical(self) -> dict:
        if not isinstance(self.artifacts, tuple) or not self.artifacts:
            raise CraftPhysicalReceiptError('artifacts debe ser una tupla no vacía.')
        artifacts = []
        for index, artifact in enumerate(self.artifacts):
            if not isinstance(artifact, AdoptCopyArtifact):
                raise CraftPhysicalReceiptError('artifact no es tipado.')
            item = artifact.canonical()
            if item['ordinal'] != index:
                raise CraftPhysicalReceiptError(
                    'artifacts debe conservar orden ordinal contiguo.')
            artifacts.append(item)
        if canonical_sha256(artifacts) != self.copy_set_sha256:
            raise CraftPhysicalReceiptError('copySetSha256 no liga artifacts.')
        return {
            'escrowId': _uuid(self.escrow_id, 'escrowId'),
            'manifestSha256': _sha(self.manifest_sha256, 'manifestSha256'),
            'candidateId': _uuid(self.candidate_id, 'candidateId'),
            'artifactManifestSha256': _sha(
                self.artifact_manifest_sha256, 'artifactManifestSha256'),
            'quarantineSetSha256': _sha(
                self.quarantine_set_sha256, 'quarantineSetSha256'),
            'adoptionAttemptId': _uuid(
                self.adoption_attempt_id, 'adoptionAttemptId'),
            'adoptionFenceEpoch': _positive_int(
                self.adoption_fence_epoch, 'adoptionFenceEpoch'),
            'adoptionResultSha256': _sha(
                self.adoption_result_sha256, 'adoptionResultSha256'),
            'artifacts': artifacts,
            'copySetSha256': _sha(self.copy_set_sha256, 'copySetSha256'),
        }


Evidence = (ReserveEvidence | PrestartForgetEvidence |
            TerminalForgetEvidence | AdoptCopyEvidence |
            MaterializationPopulateEvidence | MaterializationForgetEvidence)


@dataclass(frozen=True)
class CraftPhysicalReceipt:
    receipt_id: str
    challenge_id: str
    phase: Phase
    binding: CraftPhysicalBinding
    evidence: Evidence
    receipt_sha256: str
    observed_at: str

    def body(self) -> dict:
        expected_type = {
            'reserve': ReserveEvidence,
            'prestart_forget': PrestartForgetEvidence,
            'terminal_forget': TerminalForgetEvidence,
            'adopt_copy': AdoptCopyEvidence,
            'materialization_populate': MaterializationPopulateEvidence,
            'materialization_forget': MaterializationForgetEvidence,
        }.get(self.phase)
        if (expected_type is None or type(self.evidence) is not expected_type
                or self.evidence.phase != self.phase):
            raise CraftPhysicalReceiptError('La evidencia no corresponde a la fase.')
        has_intent = self.binding.intent_id is not None
        if has_intent != self.phase.startswith('materialization_'):
            raise CraftPhysicalReceiptError(
                'El binding no corresponde a la fase materialization.')
        return {
            'schemaVersion': SCHEMA_VERSION,
            'receiptId': _uuid(self.receipt_id, 'receiptId'),
            'challengeId': _uuid(self.challenge_id, 'challengeId'),
            'phase': self.phase,
            'binding': self.binding.canonical(),
            'evidence': self.evidence.canonical(),
        }

    def canonical(self) -> dict:
        body = self.body()
        if canonical_sha256(body) != _sha(
                self.receipt_sha256, 'receiptSha256'):
            raise CraftPhysicalReceiptError('receiptSha256 no liga el cuerpo.')
        return {
            'body': body,
            'receiptSha256': self.receipt_sha256,
            'observedAt': _observed_at(self.observed_at),
        }


def _parse_binding(value: object) -> CraftPhysicalBinding:
    base = {
        'installationId', 'verifierPolicySha256', 'ownerUserId', 'jobId',
        'stepId', 'attemptId', 'attemptNo',
        'claimLeaseTokenSha256', 'fenceEpoch', 'admissionSha256',
        'claimSetSha256', 'dispatchId', 'requestSha256', 'authoritySha256',
    }
    materialization = {
        'storageDomainId', 'intentId', 'populationGenerationId',
        'namespaceId', 'populationFenceSha256'}
    if not isinstance(value, dict) or set(value) not in (base, base | materialization):
        raise CraftPhysicalReceiptError('binding no es un DTO cerrado.')
    row = value
    return CraftPhysicalBinding(
        row['installationId'], row['verifierPolicySha256'],
        row['ownerUserId'], row['jobId'], row['stepId'], row['attemptId'],
        row['attemptNo'], row['claimLeaseTokenSha256'], row['fenceEpoch'],
        row['admissionSha256'], row['claimSetSha256'], row['dispatchId'],
        row['requestSha256'], row['authoritySha256'],
        row.get('storageDomainId'), row.get('intentId'),
        row.get('populationGenerationId'), row.get('namespaceId'),
        row.get('populationFenceSha256'))


def _parse_evidence(phase: str, value: object) -> Evidence:
    if phase == 'reserve':
        row = _closed(value, {'materializationSha256', 'inputTreeSha256',
            'outputTreeSha256', 'ownershipMarkerSha256', 'inputCount',
            'expectedOutputCount'}, 'reserve.evidence')
        return ReserveEvidence(
            row['materializationSha256'], row['inputTreeSha256'],
            row['outputTreeSha256'], row['ownershipMarkerSha256'],
            row['inputCount'], row['expectedOutputCount'])
    if phase == 'prestart_forget':
        row = _closed(value, {'materializationSha256', 'beforeTreeSha256',
            'tombstoneSha256', 'journalEntrySha256'},
            'prestart_forget.evidence')
        return PrestartForgetEvidence(
            row['materializationSha256'], row['beforeTreeSha256'],
            row['tombstoneSha256'], row['journalEntrySha256'])
    if phase == 'terminal_forget':
        row = _closed(value, {'materializationSha256', 'beforeTreeSha256',
            'terminalStatus', 'terminalReceiptSha256', 'tombstoneSha256',
            'journalEntrySha256'}, 'terminal_forget.evidence')
        return TerminalForgetEvidence(
            row['materializationSha256'], row['beforeTreeSha256'],
            row['terminalStatus'], row['terminalReceiptSha256'],
            row['tombstoneSha256'], row['journalEntrySha256'])
    if phase == 'adopt_copy':
        row = _closed(value, {'escrowId', 'manifestSha256', 'candidateId',
            'artifactManifestSha256', 'quarantineSetSha256',
            'adoptionAttemptId', 'adoptionFenceEpoch', 'adoptionResultSha256',
            'artifacts', 'copySetSha256'}, 'adopt_copy.evidence')
        if not isinstance(row['artifacts'], list):
            raise CraftPhysicalReceiptError('artifacts debe ser una lista cerrada.')
        artifacts = []
        for raw in row['artifacts']:
            item = _closed(raw, {'ordinal', 'byteSize', 'sha256',
                'destinationReceiptSha256'}, 'artifact')
            artifacts.append(AdoptCopyArtifact(
                item['ordinal'], item['byteSize'], item['sha256'],
                item['destinationReceiptSha256']))
        return AdoptCopyEvidence(
            row['escrowId'], row['manifestSha256'], row['candidateId'],
            row['artifactManifestSha256'], row['quarantineSetSha256'],
            row['adoptionAttemptId'], row['adoptionFenceEpoch'],
            row['adoptionResultSha256'], tuple(artifacts),
            row['copySetSha256'])
    if phase == 'materialization_populate':
        row = _closed(value, {'planSha256', 'materializationSha256',
            'inputTreeSha256', 'outputTreeSha256',
            'ownershipMarkerSha256'}, 'materialization_populate.evidence')
        return MaterializationPopulateEvidence(
            row['planSha256'], row['materializationSha256'],
            row['inputTreeSha256'], row['outputTreeSha256'],
            row['ownershipMarkerSha256'])
    if phase == 'materialization_forget':
        row = _closed(value, {'planSha256', 'beforeTreeSha256',
            'tombstoneSha256', 'journalEntrySha256'},
            'materialization_forget.evidence')
        return MaterializationForgetEvidence(
            row['planSha256'], row['beforeTreeSha256'],
            row['tombstoneSha256'], row['journalEntrySha256'])
    raise CraftPhysicalReceiptError('phase no es cerrada.')


def build_craft_physical_receipt(
        receipt_id: str, challenge_id: str, binding: CraftPhysicalBinding,
        evidence: Evidence, observed_at: str) -> CraftPhysicalReceipt:
    if not isinstance(binding, CraftPhysicalBinding):
        raise CraftPhysicalReceiptError('binding no es tipado.')
    if not isinstance(evidence, (ReserveEvidence, PrestartForgetEvidence,
                                 TerminalForgetEvidence, AdoptCopyEvidence,
                                 MaterializationPopulateEvidence,
                                 MaterializationForgetEvidence)):
        raise CraftPhysicalReceiptError('evidence no es tipada.')
    provisional = CraftPhysicalReceipt(
        receipt_id, challenge_id, evidence.phase, binding, evidence,
        '0' * 64, observed_at)
    receipt = CraftPhysicalReceipt(
        receipt_id, challenge_id, evidence.phase, binding, evidence,
        canonical_sha256(provisional.body()), observed_at)
    receipt.canonical()
    return receipt


def validate_craft_physical_receipt(value: object) -> CraftPhysicalReceipt:
    envelope = _closed(value, {'body', 'receiptSha256', 'observedAt'}, 'receipt')
    body = _closed(envelope['body'], {
        'schemaVersion', 'receiptId', 'challengeId', 'phase', 'binding',
        'evidence'},
        'receipt.body')
    if type(body['schemaVersion']) is not int or body['schemaVersion'] != 2:
        raise CraftPhysicalReceiptError('schemaVersion no es V2.')
    phase = body['phase']
    if not isinstance(phase, str) or phase not in PHASES:
        raise CraftPhysicalReceiptError('phase no es cerrada.')
    receipt = CraftPhysicalReceipt(
        body['receiptId'], body['challengeId'], phase,
        _parse_binding(body['binding']),
        _parse_evidence(phase, body['evidence']), envelope['receiptSha256'],
        envelope['observedAt'])
    if receipt.canonical() != value:
        raise CraftPhysicalReceiptError('receipt no es canónico.')
    return receipt


@runtime_checkable
class CraftPhysicalReceiptVerifier(Protocol):
    """Installation-owned physical verifier; deliberately no I/O implementation."""

    def verify_physical_receipt(
            self, receipt: CraftPhysicalReceipt, *, expected_receipt_id: str,
            expected_challenge_id: str, expected_phase: Phase,
            expected_binding: CraftPhysicalBinding,
            expected_evidence: Evidence) -> bool: ...


def require_verified_receipt(
        verifier: CraftPhysicalReceiptVerifier | None, value: object, *,
        expected_receipt_id: str, expected_challenge_id: str,
        expected_phase: Phase, expected_binding: CraftPhysicalBinding,
        expected_evidence: Evidence) -> CraftPhysicalReceipt:
    receipt = validate_craft_physical_receipt(value)
    if (receipt.receipt_id != _uuid(expected_receipt_id, 'expectedReceiptId')
            or receipt.challenge_id != _uuid(
                expected_challenge_id, 'expectedChallengeId')
            or receipt.phase != expected_phase
            or receipt.binding.canonical() != expected_binding.canonical()
            or receipt.evidence.canonical() != expected_evidence.canonical()):
        raise CraftPhysicalReceiptError('receipt no liga la transición esperada.')
    if verifier is None or verifier.verify_physical_receipt(
            receipt, expected_receipt_id=expected_receipt_id,
            expected_challenge_id=expected_challenge_id,
            expected_phase=expected_phase,
            expected_binding=expected_binding,
            expected_evidence=expected_evidence) is not True:
        raise CraftPhysicalReceiptError('La evidencia física no fue verificada.')
    return receipt
