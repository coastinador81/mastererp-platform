"""Closed, owner-bound state projection for one persisted creative job.

This read model accepts only an authenticated owner and a job identity. One
PostgreSQL statement derives scope and lifecycle state from existing ledgers.
It grants no execution, review, publication, or cleanup authority.
"""

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from .creative_composite_quote import canonical_sha256


class CreativeJobProjectionNotFound(ValueError):
    """The job is absent or outside the authenticated owner's valid scope."""


@dataclass(frozen=True, slots=True)
class IdentityProjection:
    account_id: str
    uonify_project_id: str | None
    thread_id: str
    plan_id: str
    plan_revision: int
    job_id: str
    assignment_id: str | None

    def canonical(self) -> dict:
        return {"accountId": self.account_id,
                "uonifyProjectId": self.uonify_project_id,
                "threadId": self.thread_id, "planId": self.plan_id,
                "planRevision": self.plan_revision, "jobId": self.job_id,
                "assignmentId": self.assignment_id}


@dataclass(frozen=True, slots=True)
class ScopeProjection:
    state: Literal["valid"]
    thread_state: Literal["active", "deleted"]
    focused_assignment_id: str | None
    focused_assignment_state: str | None

    def canonical(self) -> dict:
        focus = ({"assignmentId": self.focused_assignment_id,
                  "state": self.focused_assignment_state}
                 if self.focused_assignment_id is not None else None)
        return {"state": self.state, "threadState": self.thread_state,
                "currentThreadFocus": focus}


@dataclass(frozen=True, slots=True)
class RawStepProjection:
    step_id: str
    ordinal: int
    kind: str
    state: str
    attempt_id: str | None
    attempt_number: int | None
    attempt_state: str | None

    def canonical(self) -> dict:
        return {"stepId": self.step_id, "ordinal": self.ordinal,
                "kind": self.kind, "state": self.state,
                "attemptId": self.attempt_id,
                "attemptNumber": self.attempt_number,
                "attemptState": self.attempt_state}


@dataclass(frozen=True, slots=True)
class JobProjection:
    state: str
    graph_version: int
    steps: tuple[RawStepProjection, ...]

    def canonical(self) -> dict:
        return {"state": self.state,
                "graphVersion": self.graph_version,
                "steps": [item.canonical() for item in self.steps]}


ExecutionState = Literal[
    "not_started", "queued", "running", "succeeded", "failed", "unknown",
    "cancelled", "integrity_blocked",
]
StorageAdoptionState = Literal[
    "not_applicable", "not_started", "pending", "running", "durable",
    "integrity_blocked",
]
ReviewState = Literal[
    "not_applicable", "not_ready", "waiting_evaluation", "ready", "blocked",
    "approved_private", "revision_requested", "rejected", "released_private",
    "discarded", "integrity_blocked",
]
CleanupState = Literal[
    "not_applicable", "not_started", "pending",
    "source_cleanup_reconciled", "retained", "purged", "unknown",
    "integrity_blocked",
]


@dataclass(frozen=True, slots=True)
class ExecutionProjection:
    state: ExecutionState
    intent_step_id: str | None
    render_attempt_id: str | None
    current_step_id: str | None
    current_attempt_id: str | None
    render_running: bool

    def canonical(self) -> dict:
        return {"state": self.state, "intentStepId": self.intent_step_id,
                "renderAttemptId": self.render_attempt_id,
                "currentStepId": self.current_step_id,
                "currentAttemptId": self.current_attempt_id,
                "renderRunning": self.render_running}


@dataclass(frozen=True, slots=True)
class StorageAdoptionProjection:
    state: StorageAdoptionState
    candidate_id: str | None
    candidate_state_version: int | None
    adoption_attempt_id: str | None
    candidate_state: str | None

    def canonical(self) -> dict:
        candidate = ({"candidateId": self.candidate_id,
                      "stateVersion": self.candidate_state_version}
                     if self.candidate_id is not None else None)
        return {"state": self.state, "candidate": candidate,
                "adoptionAttemptId": self.adoption_attempt_id,
                "candidateState": self.candidate_state}


@dataclass(frozen=True, slots=True)
class ReviewProjection:
    state: ReviewState
    evaluation_id: str | None
    review_id: str | None
    decision: str | None
    release_id: str | None

    def canonical(self) -> dict:
        return {"state": self.state, "evaluationId": self.evaluation_id,
                "reviewId": self.review_id, "decision": self.decision,
                "releaseId": self.release_id}


@dataclass(frozen=True, slots=True)
class PublicationProjection:
    state: Literal["not_implemented"] = "not_implemented"
    authorization: Literal["not_authorized"] = "not_authorized"
    receipt_id: None = None

    def canonical(self) -> dict:
        return {"state": self.state, "authorization": self.authorization,
                "receiptId": self.receipt_id}


@dataclass(frozen=True, slots=True)
class SourceCleanupProjection:
    state: CleanupState
    escrow_id: str | None
    escrow_state: str | None

    def canonical(self) -> dict:
        return {"state": self.state, "escrowId": self.escrow_id,
                "escrowState": self.escrow_state}


@dataclass(frozen=True, slots=True)
class ProjectionReadiness:
    render_complete: bool = False
    storage_adopted: bool = False
    review_ready: bool = False
    privately_released: bool = False
    publication_ready: bool = False
    source_cleanup_reconciled: bool = False

    def canonical(self) -> dict:
        return {"renderComplete": self.render_complete,
                "storageAdopted": self.storage_adopted,
                "reviewReady": self.review_ready,
                "privatelyReleased": self.privately_released,
                "publicationReady": self.publication_ready,
                "sourceCleanupReconciled": self.source_cleanup_reconciled}


@dataclass(frozen=True, slots=True)
class CreativeJobStateProjection:
    identity: IdentityProjection
    scope: ScopeProjection
    job: JobProjection
    execution: ExecutionProjection
    storage_adoption: StorageAdoptionProjection
    review: ReviewProjection
    publication: PublicationProjection
    source_cleanup: SourceCleanupProjection
    readiness: ProjectionReadiness
    next_required_step: str | None

    def canonical(self) -> dict:
        return {"schemaVersion": 1, "identity": self.identity.canonical(),
                "scope": self.scope.canonical(),
                "job": self.job.canonical(),
                "execution": self.execution.canonical(),
                "storageAdoption": self.storage_adoption.canonical(),
                "review": self.review.canonical(),
                "publication": self.publication.canonical(),
                "sourceCleanup": self.source_cleanup.canonical(),
                "readiness": self.readiness.canonical(),
                "allowedActions": [],
                "nextRequiredStep": self.next_required_step}


_QUERY = """
WITH owner AS (
    SELECT id,google_subject FROM users
     WHERE id=%s AND google_subject=%s AND deletion_requested_at IS NULL
), scoped_job AS (
    SELECT j.user_id,j.id,j.thread_id,j.status,j.graph_snapshot,
           q.uonify_project_id,q.plan_id,q.plan_revision,
           CASE WHEN t.deleted_at IS NULL THEN 'active' ELSE 'deleted' END
             thread_state
      FROM creative_execution_jobs j
      JOIN owner o ON o.id=j.user_id
      JOIN creative_execution_approvals a
        ON a.user_id=j.user_id AND a.id=j.approval_id
      JOIN creative_execution_quotes q
        ON q.user_id=a.user_id AND q.id=a.quote_id
       AND q.thread_id=j.thread_id
      JOIN uony_threads t
        ON t.user_id=j.user_id AND t.id=j.thread_id
       AND t.project_id IS NOT DISTINCT FROM q.uonify_project_id
      LEFT JOIN uony_projects p
        ON p.user_id=j.user_id AND p.id=q.uonify_project_id
     WHERE j.id=%s
       AND (q.uonify_project_id IS NULL
            OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
), raw_steps AS (
    SELECT s.user_id,s.job_id,
           jsonb_agg(jsonb_build_object(
               'stepId',s.step_id::text,'ordinal',s.ordinal,'kind',s.kind,
               'state',s.status,'attemptId',attempt.id::text,
               'attemptNumber',attempt.attempt_no,
               'attemptState',attempt.status) ORDER BY s.ordinal) steps
      FROM creative_execution_steps s
      JOIN scoped_job j ON j.user_id=s.user_id AND j.id=s.job_id
      LEFT JOIN LATERAL (
          SELECT x.id,x.attempt_no,x.status
            FROM creative_execution_attempts x
           WHERE x.user_id=s.user_id AND x.job_id=s.job_id
             AND x.step_id=s.step_id
           ORDER BY (x.status='running') DESC,x.attempt_no DESC,x.id DESC
           LIMIT 1
      ) attempt ON true
     GROUP BY s.user_id,s.job_id
), craft_attempt AS (
    SELECT s.user_id,s.job_id,s.step_id,s.status step_state,
           attempt.id,attempt.attempt_no,attempt.status,
           attempt.provider_started_at,attempt.provider_returned_at,
           attempt.claim_lease_token,attempt.fence_epoch,
           attempt.admission_id,attempt.admission_sha256,
           attempt.claim_set_sha256
      FROM creative_execution_steps s
      JOIN scoped_job j ON j.user_id=s.user_id AND j.id=s.job_id
      LEFT JOIN LATERAL (
          SELECT x.* FROM creative_execution_attempts x
           WHERE x.user_id=s.user_id AND x.job_id=s.job_id
             AND x.step_id=s.step_id
           ORDER BY (x.status='running') DESC,x.attempt_no DESC,x.id DESC
           LIMIT 1
      ) attempt ON true
     WHERE s.kind='craft'
     ORDER BY s.ordinal DESC,s.step_id DESC LIMIT 1
), candidate_set AS (
    SELECT j.user_id,j.id job_id,count(r.id) candidate_count
      FROM scoped_job j
      LEFT JOIN creative_candidate_receipts r
        ON r.user_id=j.user_id AND r.job_id=j.id
     GROUP BY j.user_id,j.id
), exact_candidate AS (
    SELECT r.user_id,r.id,r.attempt_id,s.state,s.version,
           s.quarantine_set_sha256 candidate_quarantine_set_sha256
      FROM creative_candidate_receipts r
      JOIN craft_attempt a
        ON a.user_id=r.user_id AND a.job_id=r.job_id
       AND a.step_id=r.step_id AND a.id=r.attempt_id
       AND a.attempt_no=r.attempt_no AND a.claim_lease_token=r.lease_token
       AND a.fence_epoch=r.fence_epoch AND a.admission_id=r.admission_id
       AND a.admission_sha256=r.admission_sha256
       AND a.claim_set_sha256=r.claim_set_sha256
      JOIN creative_candidate_states s
        ON s.user_id=r.user_id AND s.candidate_id=r.id
), exact_candidate_count AS (
    SELECT count(*) exact_count FROM exact_candidate
), current_attempt AS (
    SELECT j.user_id,j.id job_id,count(a.id) active_count,
           min(a.id::text) active_attempt_id,
           min(a.step_id::text) active_step_id
      FROM scoped_job j
      LEFT JOIN creative_execution_attempts a
        ON a.user_id=j.user_id AND a.job_id=j.id AND a.status='running'
     GROUP BY j.user_id,j.id
)
SELECT j.user_id,j.id job_id,j.thread_id,j.status job_state,
       (j.graph_snapshot->>'schemaVersion')::integer graph_version,
       j.uonify_project_id,j.plan_id,j.plan_revision,j.thread_state,
       focus.assignment_id focused_assignment_id,
       assignment.status focused_assignment_state,steps.steps,
       craft.step_id craft_step_id,craft.step_state craft_step_state,
       craft.id craft_attempt_id,craft.status craft_attempt_state,
       craft.provider_started_at craft_provider_started_at,
       craft.provider_returned_at craft_provider_returned_at,
       current.active_count,current.active_attempt_id,current.active_step_id,
       candidates.candidate_count,exact_count.exact_count,
       candidate.id candidate_id,candidate.state candidate_state,
       candidate.version candidate_revision,
       candidate.candidate_quarantine_set_sha256,
       quarantine.quarantine_set_sha256 durable_quarantine_set_sha256,
       quarantine.adoption_attempt_id,evaluation.id evaluation_id,
       evaluation.row_count evaluation_count,
       review.id review_id,review.decision review_decision,
       review.evaluation_id review_evaluation_id,
       review.row_count review_count,
       release.id release_id,cleanup.escrow_id,
       cleanup.state cleanup_state,
       reservation.attempt_id launcher_reservation_attempt_id,
       reservation.dispatch_id launcher_dispatch_id,
       reservation.request_sha256 launcher_request_sha256,
       reservation.authority_sha256 launcher_authority_sha256,
       reservation.profile_sha256 launcher_profile_sha256,
       reservation.reservation_receipt launcher_reservation_receipt,
       reservation.reservation_receipt_sha256 launcher_receipt_sha256,
       reservation.reserved_at launcher_reserved_at,
       reservation.compensation_status,runtime.status runtime_outbox_state,
       ack.status launcher_ack_state
  FROM scoped_job j
  LEFT JOIN raw_steps steps
    ON steps.user_id=j.user_id AND steps.job_id=j.id
  LEFT JOIN craft_attempt craft
    ON craft.user_id=j.user_id AND craft.job_id=j.id
  JOIN candidate_set candidates
    ON candidates.user_id=j.user_id AND candidates.job_id=j.id
  JOIN current_attempt current
    ON current.user_id=j.user_id AND current.job_id=j.id
  CROSS JOIN exact_candidate_count exact_count
  LEFT JOIN exact_candidate candidate ON candidate.user_id=j.user_id
  LEFT JOIN uony_assignment_focus focus
    ON focus.user_id=j.user_id AND focus.thread_id=j.thread_id
  LEFT JOIN owner o ON o.id=j.user_id
  LEFT JOIN uony_assignments assignment
    ON assignment.user_id=focus.user_id AND assignment.id=focus.assignment_id
   AND assignment.google_subject=o.google_subject
  LEFT JOIN creative_candidate_quarantines quarantine
    ON quarantine.user_id=j.user_id AND quarantine.candidate_id=candidate.id
  LEFT JOIN LATERAL (
      SELECT e.id,count(*) OVER () row_count
        FROM creative_candidate_evaluations e
       WHERE e.user_id=j.user_id AND e.candidate_id=candidate.id
       ORDER BY e.created_at DESC,e.id DESC LIMIT 1
  ) evaluation ON true
  LEFT JOIN LATERAL (
      SELECT r.id,r.decision,r.evaluation_id,count(*) OVER () row_count
        FROM creative_candidate_reviews r
        JOIN creative_candidate_evaluations e
          ON e.user_id=r.user_id AND e.id=r.evaluation_id
         AND e.candidate_id=r.candidate_id
       WHERE r.user_id=j.user_id AND r.candidate_id=candidate.id
       ORDER BY r.created_at DESC,r.id DESC LIMIT 1
  ) review ON true
  LEFT JOIN creative_candidate_releases release
    ON release.user_id=j.user_id AND release.candidate_id=candidate.id
   AND release.review_id=review.id
   AND release.evaluation_id=review.evaluation_id
  LEFT JOIN creative_craft_output_adoption_outbox cleanup
    ON cleanup.user_id=j.user_id AND cleanup.candidate_id=candidate.id
   AND cleanup.source_attempt_id=craft.id
  LEFT JOIN creative_craft_launcher_reservations reservation
    ON reservation.user_id=j.user_id AND reservation.attempt_id=craft.id
   AND reservation.job_id=j.id AND reservation.step_id=craft.step_id
   AND reservation.attempt_no=craft.attempt_no
   AND reservation.claim_lease_token=craft.claim_lease_token
   AND reservation.fence_epoch=craft.fence_epoch
   AND reservation.admission_id=craft.admission_id
   AND reservation.admission_sha256=craft.admission_sha256
   AND reservation.claim_set_sha256=craft.claim_set_sha256
  LEFT JOIN creative_runtime_reconciliation_outbox runtime
    ON runtime.user_id=craft.user_id AND runtime.attempt_id=craft.id
   AND runtime.job_id=j.id AND runtime.step_id=craft.step_id
   AND runtime.attempt_no=craft.attempt_no
   AND runtime.claim_lease_token=craft.claim_lease_token
   AND runtime.fence_epoch=craft.fence_epoch
   AND runtime.admission_sha256=craft.admission_sha256
   AND runtime.claim_set_sha256=craft.claim_set_sha256
   AND runtime.kind='craft' AND runtime.provider_call=true
   AND runtime.terminal_status=craft.status
  LEFT JOIN creative_craft_launcher_ack_outbox ack
    ON ack.user_id=reservation.user_id
   AND ack.source_attempt_id=reservation.attempt_id
   AND ack.job_id=reservation.job_id
   AND ack.source_step_id=reservation.step_id
   AND ack.attempt_no=reservation.attempt_no
   AND ack.claim_lease_token=reservation.claim_lease_token
   AND ack.fence_epoch=reservation.fence_epoch
   AND ack.admission_sha256=reservation.admission_sha256
   AND ack.claim_set_sha256=reservation.claim_set_sha256
   AND ack.dispatch_id=reservation.dispatch_id
   AND ack.request_sha256=reservation.request_sha256
   AND ack.authority_sha256=reservation.authority_sha256
"""


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f"{label} no es UUID.") from None
    if parsed != str(value):
        raise ValueError(f"{label} no es UUID canónico.")
    return parsed


def _id(value: object) -> str | None:
    return str(value) if value is not None else None


def _reservation_valid(row: dict) -> bool:
    receipt = row["launcher_reservation_receipt"]
    expected = {
        "schemaVersion": 1,
        "dispatchId": _id(row["launcher_dispatch_id"]),
        "requestSha256": row["launcher_request_sha256"],
        "status": "reserved",
        "authoritySha256": row["launcher_authority_sha256"],
        "profileSha256": row["launcher_profile_sha256"],
    }
    return bool(
        row["launcher_reservation_attempt_id"] is not None
        and row["compensation_status"] == "confirmed"
        and row["launcher_reserved_at"] is not None
        and isinstance(receipt, dict)
        and receipt == expected
        and canonical_sha256(receipt) == row["launcher_receipt_sha256"])


def _raw_steps(value: object) -> tuple[RawStepProjection, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(RawStepProjection(
        item["stepId"], item["ordinal"], item["kind"], item["state"],
        item.get("attemptId"), item.get("attemptNumber"),
        item.get("attemptState")) for item in value)


def _execution(row: dict, integrity_blocked: bool) -> ExecutionProjection:
    raw = row["craft_attempt_state"] or row["craft_step_state"]
    if integrity_blocked:
        state: ExecutionState = "integrity_blocked"
    elif raw in (None, "held"):
        state: ExecutionState = "not_started"
    elif (raw == "running" and row["craft_provider_started_at"] is None):
        state = "queued"
    else:
        state = raw
    render_running = bool(not integrity_blocked
        and
        row["craft_attempt_state"] == "running"
        and row["craft_provider_started_at"] is not None
        and row["craft_provider_returned_at"] is None)
    return ExecutionProjection(
        state, _id(row["craft_step_id"]), _id(row["craft_attempt_id"]),
        (row["active_step_id"] if row["active_count"] == 1 else None),
        (row["active_attempt_id"] if row["active_count"] == 1 else None),
        render_running)


def _storage(row: dict, graph_version: int,
             integrity_blocked: bool) -> StorageAdoptionProjection:
    candidate_state, escrow_state = row["candidate_state"], row["cleanup_state"]
    if graph_version == 1:
        state: StorageAdoptionState = "not_applicable"
    elif integrity_blocked:
        state = "integrity_blocked"
    elif candidate_state == "discarded" and row["adoption_attempt_id"] is None:
        state = "not_applicable"
    elif candidate_state is None:
        state = "not_started"
    elif row["adoption_attempt_id"] is not None:
        state = "durable"
    elif escrow_state == "adopting":
        state = "running"
    else:
        state = "pending"
    return StorageAdoptionProjection(
        state, _id(row["candidate_id"]), row["candidate_revision"],
        _id(row["adoption_attempt_id"]), candidate_state)


def _review(row: dict, graph_version: int,
            integrity_blocked: bool) -> ReviewProjection:
    if graph_version == 1:
        state: ReviewState = "not_applicable"
    elif integrity_blocked:
        state = "integrity_blocked"
    else:
        state = {
            None: "not_ready", "received": "not_ready",
            "quarantined": "waiting_evaluation", "review_pending": "ready",
            "blocked": "blocked", "approved_for_use": "approved_private",
            "revision_requested": "revision_requested", "rejected": "rejected",
            "released": "released_private", "discarded": "discarded",
        }[row["candidate_state"]]
    return ReviewProjection(
        state, _id(row["review_evaluation_id"] or row["evaluation_id"]),
        _id(row["review_id"]),
        row["review_decision"], _id(row["release_id"]))


def _cleanup(row: dict, graph_version: int,
             integrity_blocked: bool) -> SourceCleanupProjection:
    escrow = row["cleanup_state"]
    if graph_version == 1:
        state: CleanupState = "not_applicable"
    elif integrity_blocked:
        state = "integrity_blocked"
    elif row["craft_attempt_state"] == "unknown":
        state = "unknown"
    elif row["craft_attempt_state"] in {"failed", "cancelled"}:
        state = ("purged" if row["launcher_ack_state"] == "done"
                 or row["compensation_status"] == "compensated"
                 else "retained")
    elif escrow == "deleted":
        state = "source_cleanup_reconciled"
    elif escrow is not None:
        state = "pending"
    elif row["launcher_ack_state"] == "done":
        state = "purged"
    elif row["compensation_status"] == "compensated":
        state = "purged"
    elif row["compensation_status"] is not None:
        state = "retained"
    else:
        state = "not_started"
    return SourceCleanupProjection(state, _id(row["escrow_id"]), escrow)


def _next(execution: ExecutionProjection,
          storage: StorageAdoptionProjection, review: ReviewProjection,
          cleanup: SourceCleanupProjection) -> str | None:
    if "integrity_blocked" in {
            execution.state, storage.state, review.state, cleanup.state}:
        return "repair_integrity"
    if execution.state in {"not_started", "queued", "running"}:
        return "wait_for_render"
    if execution.state in {"failed", "unknown", "cancelled"}:
        return "resolve_render_failure"
    if storage.state in {"not_started", "pending", "running"}:
        return "wait_for_storage_adoption"
    if review.state == "waiting_evaluation":
        return "evaluate_candidate"
    if review.state == "ready":
        return "review_candidate"
    if review.state == "approved_private":
        return "release_candidate"
    if cleanup.state in {"pending", "retained"}:
        return "wait_for_source_cleanup"
    if cleanup.state == "unknown":
        return "reconcile_unknown_source_cleanup"
    return None


def project_creative_job_state(
        connection, user: dict, job_id: object) -> CreativeJobStateProjection:
    """Return one statement-consistent projection without accepting state input."""
    key = _uuid(job_id, "jobId")
    owner_id = user.get("id") if isinstance(user, dict) else None
    subject = user.get("google_subject") if isinstance(user, dict) else None
    row = connection.execute(_QUERY, (owner_id, subject, key)).fetchone()
    if not row:
        raise CreativeJobProjectionNotFound(
            "No se encuentra el trabajo creativo para esta cuenta.")
    graph_version = row["graph_version"]
    if graph_version not in (1, 2):
        raise CreativeJobProjectionNotFound(
            "No se encuentra el trabajo creativo para esta cuenta.")
    candidate_count, exact_count = row["candidate_count"], row["exact_count"]
    lifecycle_expected = graph_version == 2
    missing_after_success = (lifecycle_expected
                             and row["craft_attempt_state"] == "succeeded"
                             and exact_count != 1)
    candidate_state = row["candidate_state"]
    evaluation_count = row["evaluation_count"] or 0
    review_count = row["review_count"] or 0
    review_decision = row["review_decision"]
    chain_incomplete = bool(
        (candidate_state in {"received", "quarantined"}
         and (evaluation_count or review_count or row["release_id"] is not None))
        or (candidate_state in {"review_pending", "blocked"}
            and (evaluation_count != 1 or review_count
                 or row["release_id"] is not None))
        or (candidate_state in {
                "approved_for_use", "revision_requested", "rejected"}
            and (evaluation_count != 1 or review_count != 1
                 or review_decision != candidate_state
                 or row["release_id"] is not None))
        or (candidate_state == "released"
            and (evaluation_count != 1 or review_count != 1
                 or review_decision != "approved_for_use"
                 or row["release_id"] is None))
        or (candidate_state == "discarded"
            and (evaluation_count or review_count
                 or row["release_id"] is not None)))
    quarantine_state_inconsistent = bool(
        (candidate_state == "received"
         and row["adoption_attempt_id"] is not None)
        or (candidate_state in {
                "quarantined", "review_pending", "blocked",
                "approved_for_use", "revision_requested", "rejected",
                "released"}
            and row["adoption_attempt_id"] is None)
        or (row["adoption_attempt_id"] is not None
            and row["candidate_quarantine_set_sha256"]
            != row["durable_quarantine_set_sha256"]))
    candidate_integrity_blocked = bool(
        lifecycle_expected and (candidate_count > 1 or exact_count > 1
                                or (candidate_count == 1 and exact_count != 1)
                                or missing_after_success
                                or quarantine_state_inconsistent))
    review_integrity_blocked = bool(
        candidate_integrity_blocked or lifecycle_expected
        and (evaluation_count > 1 or review_count > 1 or chain_incomplete))
    execution_integrity_blocked = bool(
        row["craft_step_state"] not in (None, "held")
        and row["craft_attempt_id"] is None)
    terminal_with_cleanup = row["craft_attempt_state"] in {
        "succeeded", "failed", "cancelled"}
    cleanup_integrity_blocked = bool(
        lifecycle_expected
        and ((row["craft_provider_started_at"] is not None
              or terminal_with_cleanup)
             and not _reservation_valid(row)
             or (terminal_with_cleanup
                 and row["runtime_outbox_state"] is None)))
    execution = _execution(row, execution_integrity_blocked)
    storage = _storage(row, graph_version, candidate_integrity_blocked)
    review = _review(row, graph_version, review_integrity_blocked)
    cleanup = _cleanup(
        row, graph_version,
        candidate_integrity_blocked or cleanup_integrity_blocked)
    readiness = ProjectionReadiness(
        render_complete=execution.state == "succeeded",
        storage_adopted=storage.state == "durable",
        review_ready=review.state == "ready",
        privately_released=review.state == "released_private",
        source_cleanup_reconciled=(cleanup.state in {
            "source_cleanup_reconciled", "purged"}),
    )
    identity = IdentityProjection(
        _id(row["user_id"]), _id(row["uonify_project_id"]),
        row["thread_id"], _id(row["plan_id"]), row["plan_revision"],
        _id(row["job_id"]), None)
    scope = ScopeProjection(
        "valid", row["thread_state"], _id(row["focused_assignment_id"]),
        row["focused_assignment_state"])
    job = JobProjection(
        row["job_state"], graph_version, _raw_steps(row["steps"]))
    return CreativeJobStateProjection(
        identity, scope, job, execution, storage, review, PublicationProjection(),
        cleanup, readiness, _next(execution, storage, review, cleanup))
