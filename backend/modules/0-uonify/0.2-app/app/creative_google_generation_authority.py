"""Autoridad cerrada para el handoff durable de una generación Google."""

from dataclasses import asdict, dataclass
import re
from uuid import UUID


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")


@dataclass(frozen=True)
class GoogleGenerationAuthority:
    owner_user_id: str
    uonify_project_id: str | None
    google_project: str
    google_location: str
    model: str
    job_id: str
    source_step_id: str
    operation_id: str
    request_sha256: str
    approval_id: str
    quote_sha256: str
    binding_sha256: str
    costs_snapshot_sha256: str
    admission_sha256: str
    claim_set_sha256: str
    execution_graph_sha256: str


@dataclass(frozen=True)
class GoogleGenerationFence:
    attempt_id: str
    attempt_no: int
    claim_lease_token: str
    fence_epoch: int


def _uuid(value: object, label: str, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f"{label} no es UUID.") from None
    if parsed != value:
        raise ValueError(f"{label} no es UUID canónico.")
    return parsed


def google_generation_authority_snapshot(
        authority: GoogleGenerationAuthority) -> dict:
    if not isinstance(authority, GoogleGenerationAuthority):
        raise ValueError("Autoridad Google ausente.")
    for field in ("owner_user_id", "job_id",
                  "source_step_id", "operation_id", "approval_id"):
        _uuid(getattr(authority, field), field)
    _uuid(authority.uonify_project_id, "uonify_project_id", optional=True)
    if not _PROJECT.fullmatch(authority.google_project):
        raise ValueError("Proyecto Google no válido.")
    if (authority.google_location not in {
            "global", "us-central1", "europe-southwest1"}
            or not isinstance(authority.model, str) or not authority.model
            or len(authority.model) > 160):
        raise ValueError("Modelo o región Google no válidos.")
    for field in ("request_sha256", "quote_sha256", "binding_sha256",
                  "costs_snapshot_sha256", "admission_sha256",
                  "claim_set_sha256", "execution_graph_sha256"):
        if not _HASH.fullmatch(getattr(authority, field)):
            raise ValueError(f"{field} Google no válido.")
    values = asdict(authority)
    return {
        "ownerUserId": values["owner_user_id"],
        "uonifyProjectId": values["uonify_project_id"],
        "googleProject": values["google_project"],
        "googleLocation": values["google_location"],
        "model": values["model"],
        "jobId": values["job_id"],
        "sourceStepId": values["source_step_id"],
        "operationId": values["operation_id"],
        "requestSha256": values["request_sha256"],
        "approvalId": values["approval_id"],
        "quoteSha256": values["quote_sha256"],
        "bindingSha256": values["binding_sha256"],
        "costsSnapshotSha256": values["costs_snapshot_sha256"],
        "admissionSha256": values["admission_sha256"],
        "claimSetSha256": values["claim_set_sha256"],
        "executionGraphSha256": values["execution_graph_sha256"],
    }


def google_generation_fence_snapshot(fence: GoogleGenerationFence) -> dict:
    if (not isinstance(fence, GoogleGenerationFence)
            or not isinstance(fence.attempt_no, int)
            or isinstance(fence.attempt_no, bool) or fence.attempt_no < 1
            or not isinstance(fence.fence_epoch, int)
            or isinstance(fence.fence_epoch, bool) or fence.fence_epoch < 1):
        raise ValueError("Fence Google no válido.")
    return {
        "attemptId": _uuid(fence.attempt_id, "attemptId"),
        "attemptNo": fence.attempt_no,
        "claimLeaseToken": _uuid(
            fence.claim_lease_token, "claimLeaseToken"),
        "fenceEpoch": fence.fence_epoch,
    }
