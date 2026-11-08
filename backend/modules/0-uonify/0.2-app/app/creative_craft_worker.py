"""Inactive private Craft worker over the existing fenced execution contract.

The caller supplies a claim already selected by the shared coordinator and an
execution port for the isolated Craft runtime. This module creates no route,
thread, scheduler or UI state and never authorizes review or publication.
"""

from dataclasses import dataclass
from typing import Protocol
from uuid import NAMESPACE_URL, UUID, uuid5

from .craft_adapter import accept_candidate_result
from .craft_contracts import (CraftAdapterPlan, CraftAttempt, ResolvedCraftJob,
                              canonical_sha256)
from .creative_candidate_contract import candidate_content_sha256
from .creative_candidate_lifecycle import persist_candidate_receipt
from .creative_candidate_projection import (project_candidate_binding,
    project_candidate_outputs, project_effect_frame_bundle_output)
from .creative_craft_authority import load_craft_attempt_authority
from .creative_craft_attempt_authority import (bind_craft_attempt_authority,
    persisted_craft_context)
from .creative_craft_transition_client import CraftTransitionClient
from .creative_effect_frame_bundle import EffectFrameBundleReceipt
from .creative_execution_coordinator import (CreativeAttemptClaim,
    checkpoint_provider_returned, checkpoint_provider_started,
    complete_creative_step, enqueue_runtime_reconciliation)


CANDIDATE_NAMESPACE = UUID('fbc8ad06-00cc-5d1d-8fd8-7a9b32fc8520')


@dataclass(frozen=True)
class CraftExecutionResult:
    candidate_result: dict
    effect_bundle_receipt: EffectFrameBundleReceipt | None = None


@dataclass(frozen=True)
class CraftWorkerReceipt:
    job_id: str
    step_id: str
    attempt_id: str
    candidate_id: str
    candidate_state: str
    job_state: str
    candidate_receipt_sha256: str
    publication_authorized: bool = False


class CraftExecutionPort(Protocol):
    """One isolated, bounded Craft execution; persistence stays server-side."""

    def execute(self, job: ResolvedCraftJob, adapter: CraftAdapterPlan,
                attempt: CraftAttempt) -> CraftExecutionResult:
        ...

    def cancel(self, attempt: CraftAttempt) -> bool:
        ...

    def reconcile_terminal(self, attempt: CraftAttempt, status: str) -> None:
        ...

    def craft_transition_boundary(self) -> tuple[CraftTransitionClient, object]:
        """Return the installed SQL client and physical receipt verifier."""
        ...


_PHYSICAL_RECEIPT_METHODS = (
    'verify_reserve', 'verify_prestart_forget', 'issue_terminal_forget',
    'verify_terminal_forget', 'verify_adopt_copy',
)


def _require_transition_boundary(executor: object) -> CraftTransitionClient:
    boundary = getattr(executor, 'craft_transition_boundary', None)
    if not callable(boundary):
        raise ValueError('El worker Craft requiere el puente 114 completo.')
    try:
        value = boundary()
    except Exception as error:
        raise ValueError(
            'El worker Craft no pudo acreditar el puente 114.') from error
    if (not isinstance(value, tuple) or len(value) != 2
            or not isinstance(value[0], CraftTransitionClient)
            or value[0].ready_for_all_operations is not True
            or any(not callable(getattr(value[1], method, None))
                   for method in _PHYSICAL_RECEIPT_METHODS)):
        raise ValueError(
            'El worker Craft requiere la autoridad 114 activa y completa.')
    if getattr(value[1], 'installation_id', None) != value[0].installation_id:
        raise ValueError(
            'El client y verifier Craft no comparten installation_id.')
    # The gate remains deliberately closed until one typed worker cycle owns
    # runtime_enqueue -> ACK claim -> physical forget -> completion/release.
    # Passing the two lower-level capabilities cannot authorize provider I/O.
    raise ValueError(
        'El ciclo worker 114 completo aún no está integrado.')


def _identity(attempt_id: str, ordinal: int) -> dict:
    return {
        'outputId': str(uuid5(
            CANDIDATE_NAMESPACE, f'{attempt_id}:output:{ordinal}')),
        'assetId': str(uuid5(
            CANDIDATE_NAMESPACE, f'{attempt_id}:asset:{ordinal}')),
        'revision': 1,
    }


def _candidate_draft(claim: CreativeAttemptClaim, authority: dict,
                     job: ResolvedCraftJob, adapter: CraftAdapterPlan,
                     execution: CraftExecutionResult) -> dict:
    raw = execution.candidate_result
    if not isinstance(raw, dict):
        raise ValueError('El runtime Craft no devolvió un candidato cerrado.')
    attempt = CraftAttempt(claim.job_id, claim.attempt_id, claim.lease_token)
    acceptance = accept_candidate_result(job, attempt, adapter, raw)
    if (not acceptance.accepted or acceptance.publication_authorized
            or not acceptance.candidate_result_sha256):
        raise ValueError('El runtime Craft devolvió un candidato no verificable.')
    raw_outputs = raw.get('outputs')
    if not isinstance(raw_outputs, list) or not raw_outputs:
        raise ValueError('El runtime Craft no devolvió salidas verificables.')
    bundle = execution.effect_bundle_receipt
    if bundle is None:
        identities = tuple(_identity(claim.attempt_id, ordinal)
                           for ordinal in range(len(raw_outputs)))
        outputs = project_candidate_outputs(job, adapter, raw, identities)
    else:
        outputs = [project_effect_frame_bundle_output(
            job, adapter, raw, bundle, _identity(claim.attempt_id, 0))]
    native = raw.get('nativeProject')
    if not isinstance(native, dict):
        raise ValueError('El runtime Craft no devolvió proyecto nativo.')
    candidate_id = str(uuid5(
        CANDIDATE_NAMESPACE, f'{claim.attempt_id}:candidate'))
    value = {
        'schemaVersion': 1, 'candidateId': candidate_id,
        'ownerUserId': claim.user_id,
        'uonifyProjectId': job.identity.uonify_project_id,
        'jobId': claim.job_id, 'stepId': claim.step_id,
        'attemptId': claim.attempt_id, 'attemptNo': claim.attempt_no,
        'leaseToken': claim.lease_token, 'fenceEpoch': claim.fence_epoch,
        'admissionId': str(authority['admission_id']),
        'admissionSha256': claim.admission_sha256,
        'claimSetSha256': claim.claim_set_sha256,
        'executionGraphSha256': authority['execution_graph_sha256'],
        **project_candidate_binding(job, adapter, raw),
        'nativeProject': {
            'relativePath': native.get('relativePath'),
            'mimeType': native.get('mimeType'),
            'byteSize': native.get('bytes'),
            'sha256': native.get('sha256'),
        },
        'outputs': outputs,
        'outputManifestSha256': canonical_sha256(outputs),
        'candidateContentSha256': '',
        'craftCandidateResultSha256': acceptance.candidate_result_sha256,
        'quarantineState': 'pending_storage', 'acceptedForUse': False,
        'publicationAuthorized': False,
    }
    value['candidateContentSha256'] = candidate_content_sha256(value)
    return value


def run_craft_claim(database, settings, claim: CreativeAttemptClaim,
                    executor: CraftExecutionPort) -> CraftWorkerReceipt:
    """Run one claimed Craft effect and persist its private candidate receipt.

    Errors before provider_started remain recoverable by the shared lease
    recovery. Errors after that checkpoint remain unknown and are never
    replayed blindly.
    """
    if (not isinstance(claim, CreativeAttemptClaim) or claim.kind != 'craft'
            or not claim.provider_call or claim.execution_authorized
            or claim.publication_authorized
            or not callable(getattr(executor, 'execute', None))
            or not callable(getattr(executor, 'cancel', None))):
        raise ValueError('El worker requiere un claim Craft privado vigente.')
    transitions = _require_transition_boundary(executor)
    with database.connect() as connection:
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
            (f'uonify:craft-attempt:{claim.attempt_id}',))
        bind_craft_attempt_authority(
            connection, claim.user_id, claim.attempt_id)
        authority = load_craft_attempt_authority(
            connection, claim.user_id, claim.attempt_id)
        job, adapter = persisted_craft_context(authority)
    checkpoint_provider_started(database, settings, claim)
    execution = executor.execute(
        job, adapter,
        CraftAttempt(claim.job_id, claim.attempt_id, claim.lease_token))
    if not isinstance(execution, CraftExecutionResult):
        raise ValueError('El puerto Craft devolvió una respuesta no canónica.')
    candidate = _candidate_draft(
        claim, authority, job, adapter, execution)
    with database.connect() as connection:
        owner = connection.execute(
            'SELECT * FROM users WHERE id=%s',
            (claim.user_id,)).fetchone()
        if not owner:
            raise ValueError('La identidad propietaria ya no está vigente.')
        checkpoint_provider_returned(
            connection, claim, execution.candidate_result,
            {'attemptedCalls': 1, 'uncertainCalls': 0})
        persisted = persist_candidate_receipt(
            connection, owner, candidate, claim=claim, craft_job=job,
            adapter_plan=adapter,
            candidate_result=execution.candidate_result,
            effect_bundle_receipt=execution.effect_bundle_receipt)
        job_state = complete_creative_step(connection, claim)
        enqueue_runtime_reconciliation(
            connection, claim, 'succeeded',
            craft_transition_client=transitions)
    return CraftWorkerReceipt(
        claim.job_id, claim.step_id, claim.attempt_id,
        persisted.candidate_id, persisted.state, job_state,
        persisted.receipt_sha256, False)


@dataclass(frozen=True)
class CraftClaimHandler:
    """Adapter used by the shared runner; it never claims work itself."""

    database: object
    settings: object
    executor: CraftExecutionPort

    @staticmethod
    def _attempt(claim: CreativeAttemptClaim) -> CraftAttempt:
        return CraftAttempt(claim.job_id, claim.attempt_id, claim.lease_token)

    def prepare(self, claim: CreativeAttemptClaim) -> None:
        _require_transition_boundary(self.executor)
        prepare = getattr(self.executor, 'prepare', None)
        if callable(prepare):
            prepare(self._attempt(claim))

    def run(self, claim: CreativeAttemptClaim) -> CraftWorkerReceipt:
        _require_transition_boundary(self.executor)
        raise ValueError('El ciclo worker 114 completo aún no está integrado.')

    def cancel(self, claim: CreativeAttemptClaim) -> bool:
        _require_transition_boundary(self.executor)
        return self.executor.cancel(self._attempt(claim))

    def reconcile(self, claim: CreativeAttemptClaim, status: str) -> None:
        _require_transition_boundary(self.executor)
        reconcile = getattr(self.executor, 'reconcile_terminal', None)
        if not callable(reconcile):
            raise ValueError(
                'El puerto Craft no admite reconciliación terminal durable.')
        reconcile(self._attempt(claim), status)
