"""Closed contract for the inactive, server-owned Craft launcher.

The wire request contains only a complete attempt fence and hashes of durable
server authority. It deliberately contains no engine, command, image,
executable, path, mount, environment or resource limit. Those values are
resolved inside the launcher from server-owned state before anything can run.
"""

from dataclasses import dataclass
from hashlib import sha256
import json
import re
from typing import Mapping, Protocol
from uuid import NAMESPACE_URL, UUID, uuid5

_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_COMPILER_VERSION = re.compile(r"[a-z0-9][a-z0-9._-]{0,127}\Z")
_BODY_FIELDS = frozenset({"schemaVersion", "dispatchId", "attempt", "authority"})
_ATTEMPT_FIELDS = frozenset({
    "ownerUserId", "jobId", "stepId", "attemptId", "attemptNo",
    "claimLeaseToken", "fenceEpoch", "admissionSha256", "claimSetSha256",
})
_AUTHORITY_FIELDS = frozenset({
    "jobBindingSha256", "preflightSha256", "adapterPlanSha256",
    "capabilityMatrixSha256", "contractSchemaSha256",
    "adapterCompilerVersion", "adapterSourceSha256", "recipeSha256",
    "inputManifestSha256",
})
_WIRE_FIELDS = frozenset({"body", "requestSha256"})
_FORBIDDEN_REQUEST_FIELDS = frozenset({
    "args", "arguments", "binary", "binaryPath", "command", "commands",
    "cwd", "digest", "engine", "entrypoint", "env", "environment", "image",
    "input", "inputs", "limit", "limits", "mount", "mounts", "operation",
    "output", "outputPath", "path", "paths", "profile", "sandbox",
})
_MAX_WIRE_BYTES = 64 * 1024


class CraftLauncherContractError(ValueError):
    """The private launcher message is not exact or cannot be authenticated."""


class CraftLauncherClaim(Protocol):
    user_id: str
    job_id: str
    step_id: str
    attempt_id: str
    attempt_no: int
    lease_token: str
    fence_epoch: int
    kind: str
    provider_call: bool
    admission_sha256: str
    claim_set_sha256: str
    execution_authorized: bool
    publication_authorized: bool


@dataclass(frozen=True)
class CraftLauncherRequest:
    """Immutable canonical launcher request.

    Canonical bytes prevent a caller from mutating a body after its SHA-256 was
    calculated.
    """

    canonical_body: bytes
    request_sha256: str

    @property
    def body(self) -> dict:
        return json.loads(self.canonical_body)

    def wire_bytes(self) -> bytes:
        return _canonical_bytes({
            "body": self.body, "requestSha256": self.request_sha256,
        })


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError):
        raise CraftLauncherContractError("El envelope Craft no es JSON canónico.") from None


def _pairs_without_duplicates(pairs: list[tuple[str, object]]) -> dict:
    value: dict = {}
    for key, item in pairs:
        if key in value:
            raise CraftLauncherContractError("El envelope Craft repite una clave.")
        value[key] = item
    return value


def _decode_exact(payload: bytes) -> dict:
    if not isinstance(payload, bytes) or not payload or len(payload) > _MAX_WIRE_BYTES:
        raise CraftLauncherContractError("El envelope Craft excede su framing privado.")
    try:
        text = payload.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_pairs_without_duplicates)
    except (UnicodeError, json.JSONDecodeError):
        raise CraftLauncherContractError("El envelope Craft no es JSON UTF-8.") from None
    if not isinstance(value, dict) or _canonical_bytes(value) != payload:
        raise CraftLauncherContractError("El envelope Craft no usa bytes canónicos.")
    return value


def _exact(value: object, fields: frozenset[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise CraftLauncherContractError(f"{label} no tiene forma cerrada.")
    return value


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftLauncherContractError(f"{label} no es UUID.") from None
    if value != parsed:
        raise CraftLauncherContractError(f"{label} no es UUID canónico.")
    return parsed


def _hash(value: object, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise CraftLauncherContractError(f"{label} no es SHA-256.")
    return value


def _reject_executable_fields(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in _FORBIDDEN_REQUEST_FIELDS:
                raise CraftLauncherContractError(
                    "La petición intentó controlar la ejecución del launcher.")
            _reject_executable_fields(item)
    elif isinstance(value, list):
        for item in value:
            _reject_executable_fields(item)


def validate_craft_launcher_body(value: object) -> dict:
    body = _exact(value, _BODY_FIELDS, "craftLauncherEnvelope")
    _reject_executable_fields(body)
    if body["schemaVersion"] != 2:
        raise CraftLauncherContractError("La versión del launcher no es válida.")
    _uuid(body["dispatchId"], "dispatchId")
    attempt = _exact(body["attempt"], _ATTEMPT_FIELDS, "attempt")
    for key in ("ownerUserId", "jobId", "stepId", "attemptId", "claimLeaseToken"):
        _uuid(attempt[key], key)
    for key in ("attemptNo", "fenceEpoch"):
        if type(attempt[key]) is not int or attempt[key] < 1:
            raise CraftLauncherContractError(f"{key} no es un entero positivo.")
    _hash(attempt["admissionSha256"], "admissionSha256")
    _hash(attempt["claimSetSha256"], "claimSetSha256")
    authority = _exact(body["authority"], _AUTHORITY_FIELDS, "authority")
    for key in _AUTHORITY_FIELDS - {"adapterCompilerVersion"}:
        _hash(authority[key], key)
    compiler = authority["adapterCompilerVersion"]
    if not isinstance(compiler, str) or not _COMPILER_VERSION.fullmatch(compiler):
        raise CraftLauncherContractError("adapterCompilerVersion no es canónica.")
    expected_dispatch = str(uuid5(
        NAMESPACE_URL,
        "uonify:craft-launcher:v2:"
        f"{attempt['attemptId']}:{attempt['claimLeaseToken']}:{attempt['fenceEpoch']}",
    ))
    if body["dispatchId"] != expected_dispatch:
        raise CraftLauncherContractError("dispatchId no coincide con el fence.")
    return body


def build_craft_launcher_request(
    claim: CraftLauncherClaim, authority: Mapping[str, object],
) -> CraftLauncherRequest:
    """Build a request from the already locked PostgreSQL attempt row."""
    required_claim = (
        "user_id", "job_id", "step_id", "attempt_id", "attempt_no",
        "lease_token", "fence_epoch", "kind", "provider_call",
        "admission_sha256", "claim_set_sha256", "execution_authorized",
        "publication_authorized",
    )
    if (any(not hasattr(claim, field) for field in required_claim)
            or claim.kind != "craft"
            or not claim.provider_call or claim.execution_authorized
            or claim.publication_authorized):
        raise CraftLauncherContractError("El claim no autoriza un intento Craft privado.")
    row = dict(authority)
    uuid_fields = {
        "user_id": claim.user_id, "job_id": claim.job_id,
        "step_id": claim.step_id, "id": claim.attempt_id,
        "claim_lease_token": claim.lease_token,
    }
    try:
        uuid_match = all(
            str(UUID(str(row.get(key)))) == value
            and (isinstance(row.get(key), UUID)
                 or isinstance(row.get(key), str))
            for key, value in uuid_fields.items())
    except (TypeError, ValueError, AttributeError):
        uuid_match = False
    if (not uuid_match
            or type(row.get("attempt_no")) is not int
            or row.get("attempt_no") != claim.attempt_no
            or type(row.get("fence_epoch")) is not int
            or row.get("fence_epoch") != claim.fence_epoch
            or row.get("admission_sha256") != claim.admission_sha256
            or row.get("claim_set_sha256") != claim.claim_set_sha256):
        raise CraftLauncherContractError("El claim no coincide con su autoridad durable.")
    authority_fields = {
        "jobBindingSha256": row.get("craft_job_binding_sha256"),
        "preflightSha256": row.get("craft_preflight_sha256"),
        "adapterPlanSha256": row.get("craft_adapter_plan_sha256"),
        "capabilityMatrixSha256": row.get("craft_capability_matrix_sha256"),
        "contractSchemaSha256": row.get("craft_contract_schema_sha256"),
        "adapterCompilerVersion": row.get("craft_adapter_compiler_version"),
        "adapterSourceSha256": row.get("craft_adapter_source_sha256"),
        "recipeSha256": row.get("craft_recipe_sha256"),
        "inputManifestSha256": row.get("craft_resolved_input_manifest_sha256"),
    }
    attempt = {
        "ownerUserId": claim.user_id, "jobId": claim.job_id,
        "stepId": claim.step_id, "attemptId": claim.attempt_id,
        "attemptNo": claim.attempt_no, "claimLeaseToken": claim.lease_token,
        "fenceEpoch": claim.fence_epoch,
        "admissionSha256": claim.admission_sha256,
        "claimSetSha256": claim.claim_set_sha256,
    }
    dispatch_id = str(uuid5(
        NAMESPACE_URL,
        "uonify:craft-launcher:v2:"
        f"{claim.attempt_id}:{claim.lease_token}:{claim.fence_epoch}",
    ))
    body = {
        "schemaVersion": 2, "dispatchId": dispatch_id,
        "attempt": attempt, "authority": authority_fields,
    }
    validate_craft_launcher_body(body)
    canonical = _canonical_bytes(body)
    return CraftLauncherRequest(canonical, sha256(canonical).hexdigest())


def parse_craft_launcher_request(payload: bytes) -> CraftLauncherRequest:
    """Parse one canonical wire record and recompute its SHA-256."""
    wire = _exact(_decode_exact(payload), _WIRE_FIELDS, "craftLauncherWire")
    body = validate_craft_launcher_body(wire["body"])
    canonical = _canonical_bytes(body)
    request_sha = _hash(wire["requestSha256"], "requestSha256")
    if sha256(canonical).hexdigest() != request_sha:
        raise CraftLauncherContractError("La huella del envelope Craft no coincide.")
    return CraftLauncherRequest(canonical, request_sha)
