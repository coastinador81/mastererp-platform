"""Pure, inactive contract for Craft output escrow and private adoption.

This module performs no filesystem, database, provider or runtime operation.
It only validates the records a future server-owned output broker must persist.
Real ``expected_outputs`` execution remains deliberately disabled elsewhere.
"""

from dataclasses import dataclass, replace
import re
from pathlib import PurePosixPath
from typing import Mapping
from uuid import NAMESPACE_URL, UUID, uuid5

from .creative_composite_quote import canonical_sha256
from .creative_storage_contracts import StorageReceipt


HASH = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
OPERATION = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
ESCROW_STATES = frozenset({
    "sealed", "adopting", "adopted", "cleanup_pending", "deleted",
})
_STATE_VERSION = {
    "sealed": 1, "adopting": 2, "adopted": 3,
    "cleanup_pending": 4, "deleted": 5,
}
STORED_CANDIDATE_STATES = frozenset({
    "quarantined", "review_pending", "blocked", "approved_for_use",
    "revision_requested", "released",
})
EXPECTED_OUTPUTS_RUNTIME_ENABLED = False
_MAX_ARTIFACTS = 4096
_MAX_TOTAL_BYTES = 2 * 1024**3
_FENCE_FIELDS = frozenset({
    "ownerUserId", "jobId", "stepId", "attemptId", "attemptNo",
    "claimLeaseToken", "fenceEpoch", "admissionSha256", "claimSetSha256",
})
_ARTIFACT_FIELDS = frozenset({
    "ordinal", "kind", "relativePath", "role", "mimeType", "byteSize",
    "sha256",
})
_MANIFEST_FIELDS = frozenset({
    "schemaVersion", "escrowId", "fence", "dispatchId", "requestSha256",
    "authoritySha256", "engine", "artifacts", "artifactManifestSha256",
    "candidateResultSha256", "pendingStorage", "publicationAuthorized",
    "manifestSha256",
})
_ENGINE_FIELDS = frozenset({"name", "version", "operation"})
_OUTPUT_TYPES = {
    "filmcraft": {("video_master", "video/mp4")},
    "photocraft": {("image_master", "image/png")},
    "effectcraft": {
        ("rgba_frame", "image/png"),
        ("rgba_frame_bundle", "application/zip"),
    },
}
_NATIVE_TYPES = {
    "filmcraft": "application/json",
    "photocraft": "application/zip",
}


class CraftOutputEscrowError(ValueError):
    """An escrow identity, manifest or transition is not exact."""


def _uuid(value: object, label: str) -> str:
    try:
        result = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftOutputEscrowError(f"{label} no es UUID.") from None
    if value != result:
        raise CraftOutputEscrowError(f"{label} no es UUID canónico.")
    return result


def _hash(value: object, label: str) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise CraftOutputEscrowError(f"{label} no es SHA-256.")
    return value


def _closed(value: object, fields: frozenset[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise CraftOutputEscrowError(f"{label} no tiene forma cerrada.")
    return value


def _relative_output(value: object, engine: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise CraftOutputEscrowError("La ruta de escrow no es relativa.")
    path = PurePosixPath(value)
    if (path.is_absolute() or any(part in ("", ".", "..") for part in path.parts)
            or path.as_posix() != value
            or path.parts[:2] != ("out", engine)):
        raise CraftOutputEscrowError("La ruta de escrow sale del output Craft.")
    return value


@dataclass(frozen=True)
class CraftEscrowFence:
    owner_user_id: str
    job_id: str
    step_id: str
    attempt_id: str
    attempt_no: int
    claim_lease_token: str
    fence_epoch: int
    admission_sha256: str
    claim_set_sha256: str

    def __post_init__(self) -> None:
        for field in ("owner_user_id", "job_id", "step_id", "attempt_id",
                      "claim_lease_token"):
            _uuid(getattr(self, field), field)
        if (type(self.attempt_no) is not int or self.attempt_no < 1
                or type(self.fence_epoch) is not int or self.fence_epoch < 1):
            raise CraftOutputEscrowError("El fence de escrow no es positivo.")
        _hash(self.admission_sha256, "admissionSha256")
        _hash(self.claim_set_sha256, "claimSetSha256")

    def canonical(self) -> dict:
        return {
            "ownerUserId": self.owner_user_id, "jobId": self.job_id,
            "stepId": self.step_id, "attemptId": self.attempt_id,
            "attemptNo": self.attempt_no,
            "claimLeaseToken": self.claim_lease_token,
            "fenceEpoch": self.fence_epoch,
            "admissionSha256": self.admission_sha256,
            "claimSetSha256": self.claim_set_sha256,
        }


@dataclass(frozen=True)
class CraftExpectedEscrowArtifact:
    ordinal: int
    kind: str
    relative_path: str
    role: str
    mime_type: str
    max_bytes: int

    def __post_init__(self) -> None:
        if (type(self.ordinal) is not int or self.ordinal < 0
                or self.kind not in ("output", "native_project")
                or not isinstance(self.role, str) or not self.role
                or not isinstance(self.mime_type, str) or not self.mime_type
                or type(self.max_bytes) is not int
                or not 1 <= self.max_bytes <= _MAX_TOTAL_BYTES):
            raise CraftOutputEscrowError("El output esperado no es válido.")


@dataclass(frozen=True)
class CraftEscrowArtifact:
    ordinal: int
    kind: str
    relative_path: str
    role: str
    mime_type: str
    byte_size: int
    sha256: str

    def __post_init__(self) -> None:
        if (type(self.ordinal) is not int or self.ordinal < 0
                or self.kind not in ("output", "native_project")
                or not isinstance(self.role, str) or not self.role
                or not isinstance(self.mime_type, str) or not self.mime_type
                or type(self.byte_size) is not int
                or not 1 <= self.byte_size <= _MAX_TOTAL_BYTES):
            raise CraftOutputEscrowError("El artefacto de escrow no es válido.")
        _hash(self.sha256, "artifact.sha256")

    def canonical(self) -> dict:
        return {
            "ordinal": self.ordinal, "kind": self.kind,
            "relativePath": self.relative_path, "role": self.role,
            "mimeType": self.mime_type, "byteSize": self.byte_size,
            "sha256": self.sha256,
        }


@dataclass(frozen=True)
class CraftEscrowManifest:
    escrow_id: str
    fence: CraftEscrowFence
    dispatch_id: str
    request_sha256: str
    authority_sha256: str
    engine_name: str
    engine_version: str
    operation: str
    artifacts: tuple[CraftEscrowArtifact, ...]
    artifact_manifest_sha256: str
    candidate_result_sha256: str
    manifest_sha256: str
    schema_version: int = 1
    pending_storage: bool = True
    publication_authorized: bool = False

    def __post_init__(self) -> None:
        _uuid(self.escrow_id, "escrowId")
        _uuid(self.dispatch_id, "dispatchId")
        _hash(self.request_sha256, "requestSha256")
        _hash(self.authority_sha256, "authoritySha256")
        _hash(self.artifact_manifest_sha256, "artifactManifestSha256")
        _hash(self.candidate_result_sha256, "candidateResultSha256")
        _hash(self.manifest_sha256, "manifestSha256")
        if (type(self.schema_version) is not int or self.schema_version != 1
                or not isinstance(self.engine_name, str)
                or self.engine_name not in _OUTPUT_TYPES
                or not isinstance(self.engine_version, str)
                or not VERSION.fullmatch(self.engine_version)
                or not isinstance(self.operation, str)
                or not OPERATION.fullmatch(self.operation)
                or not isinstance(self.artifacts, tuple)
                or not 1 <= len(self.artifacts) <= _MAX_ARTIFACTS
                or self.pending_storage is not True
                or self.publication_authorized is not False):
            raise CraftOutputEscrowError("El manifest de escrow no es cerrado.")

    def body(self) -> dict:
        return {
            "schemaVersion": self.schema_version, "escrowId": self.escrow_id,
            "fence": self.fence.canonical(), "dispatchId": self.dispatch_id,
            "requestSha256": self.request_sha256,
            "authoritySha256": self.authority_sha256,
            "engine": {"name": self.engine_name, "version": self.engine_version,
                       "operation": self.operation},
            "artifacts": [item.canonical() for item in self.artifacts],
            "artifactManifestSha256": self.artifact_manifest_sha256,
            "candidateResultSha256": self.candidate_result_sha256,
            "pendingStorage": self.pending_storage,
            "publicationAuthorized": self.publication_authorized,
        }

    def canonical(self) -> dict:
        return {**self.body(), "manifestSha256": self.manifest_sha256}


@dataclass(frozen=True)
class CraftOutputEscrow:
    manifest: CraftEscrowManifest
    state: str = "sealed"
    version: int = 1
    storage_receipts: tuple[StorageReceipt, ...] = ()
    adoption_manifest_sha256: str | None = None
    cleanup_receipt_sha256: str | None = None

    def __post_init__(self) -> None:
        if (self.state not in ESCROW_STATES or type(self.version) is not int
                or self.version != _STATE_VERSION.get(self.state)
                or not isinstance(self.storage_receipts, tuple)):
            raise CraftOutputEscrowError("El estado de escrow no es válido.")
        adopted = self.state in ("adopted", "cleanup_pending", "deleted")
        if adopted != bool(self.storage_receipts):
            raise CraftOutputEscrowError("El estado no coincide con la adopción.")
        if adopted:
            _hash(self.adoption_manifest_sha256, "adoptionManifestSha256")
        elif self.adoption_manifest_sha256 is not None:
            raise CraftOutputEscrowError("La adopción apareció antes de completarse.")
        if self.state == "deleted":
            _hash(self.cleanup_receipt_sha256, "cleanupReceiptSha256")
        elif self.cleanup_receipt_sha256 is not None:
            raise CraftOutputEscrowError("El cleanup apareció antes del borrado.")

    @property
    def purge_authorized(self) -> bool:
        return self.state == "cleanup_pending"


@dataclass(frozen=True)
class CraftEscrowSealReceipt:
    escrow: CraftOutputEscrow
    created: bool


def _validate_expected(engine: str,
                       expected: tuple[CraftExpectedEscrowArtifact, ...],
                       observed: tuple[CraftEscrowArtifact, ...]) -> None:
    if (not isinstance(engine, str) or engine not in _OUTPUT_TYPES
            or not isinstance(expected, tuple) or not isinstance(observed, tuple)
            or not 1 <= len(expected) == len(observed) <= _MAX_ARTIFACTS):
        raise CraftOutputEscrowError("El conjunto de outputs no es exacto.")
    paths, total, native, outputs = set(), 0, 0, 0
    for ordinal, (wanted, actual) in enumerate(zip(expected, observed)):
        if (not isinstance(wanted, CraftExpectedEscrowArtifact)
                or not isinstance(actual, CraftEscrowArtifact)
                or wanted.ordinal != ordinal or actual.ordinal != ordinal
                or (actual.kind, actual.relative_path, actual.role,
                    actual.mime_type) !=
                   (wanted.kind, wanted.relative_path, wanted.role,
                    wanted.mime_type)
                or actual.byte_size > wanted.max_bytes):
            raise CraftOutputEscrowError("Un output no coincide con su autoridad.")
        path = _relative_output(actual.relative_path, engine)
        if path in paths:
            raise CraftOutputEscrowError("El manifest repite una ruta de output.")
        paths.add(path)
        total += actual.byte_size
        if actual.kind == "native_project":
            native += 1
            if (engine not in _NATIVE_TYPES
                    or actual.role != "native_project"
                    or actual.mime_type != _NATIVE_TYPES[engine]):
                raise CraftOutputEscrowError("El proyecto nativo no coincide.")
        else:
            if native:
                raise CraftOutputEscrowError(
                    "El proyecto nativo debe cerrar el manifest.")
            outputs += 1
            if (actual.role, actual.mime_type) not in _OUTPUT_TYPES[engine]:
                raise CraftOutputEscrowError("El tipo de output no coincide.")
    required_native = 1 if engine in _NATIVE_TYPES else 0
    if (not outputs or native != required_native
            or total > _MAX_TOTAL_BYTES):
        raise CraftOutputEscrowError("El manifest no contiene el conjunto requerido.")


def seal_craft_output_escrow(
        *, escrow_id: str, fence: CraftEscrowFence, dispatch_id: str,
        request_sha256: str, authority_sha256: str, engine_name: str,
        engine_version: str, operation: str,
        expected: tuple[CraftExpectedEscrowArtifact, ...],
        observed: tuple[CraftEscrowArtifact, ...],
        candidate_result_sha256: str,
        prior: CraftOutputEscrow | None = None) -> CraftEscrowSealReceipt:
    """Seal one exact create-only manifest, or return its identical prior row."""
    expected_dispatch = str(uuid5(
        NAMESPACE_URL,
        "uonify:craft-launcher:v2:"
        f"{fence.attempt_id}:{fence.claim_lease_token}:{fence.fence_epoch}",
    ))
    if dispatch_id != expected_dispatch:
        raise CraftOutputEscrowError("dispatchId no coincide con el fence.")
    _validate_expected(engine_name, expected, observed)
    artifact_sha = canonical_sha256([item.canonical() for item in observed])
    provisional = CraftEscrowManifest(
        escrow_id, fence, dispatch_id, _hash(request_sha256, "requestSha256"),
        _hash(authority_sha256, "authoritySha256"), engine_name,
        engine_version, operation, observed, artifact_sha,
        _hash(candidate_result_sha256, "candidateResultSha256"), "0" * 64,
    )
    manifest = replace(
        provisional, manifest_sha256=canonical_sha256(provisional.body()))
    value = CraftOutputEscrow(manifest)
    if prior is None:
        return CraftEscrowSealReceipt(value, True)
    if (not isinstance(prior, CraftOutputEscrow)
            or prior.manifest.canonical() != manifest.canonical()):
        raise CraftOutputEscrowError("El intento ya liga otro escrow.")
    return CraftEscrowSealReceipt(prior, False)


def begin_craft_output_adoption(value: CraftOutputEscrow) -> CraftOutputEscrow:
    if value.state == "adopting":
        return value
    if value.state != "sealed":
        raise CraftOutputEscrowError("El escrow no admite iniciar adopción.")
    return replace(value, state="adopting", version=value.version + 1)


def _receipt_payload(receipt: StorageReceipt) -> dict:
    return {
        "bucket": receipt.bucket, "name": receipt.name,
        "generation": receipt.generation, "mimeType": receipt.mime_type,
        "byteSize": receipt.byte_size, "sha256": receipt.sha256,
    }


def confirm_craft_output_adoption(
        value: CraftOutputEscrow,
        receipts: tuple[StorageReceipt, ...]) -> CraftOutputEscrow:
    """Bind every sealed byte to one exact durable private StorageReceipt."""
    if value.state == "adopted" and receipts == value.storage_receipts:
        return value
    if (value.state != "adopting" or not isinstance(receipts, tuple)
            or len(receipts) != len(value.manifest.artifacts)):
        raise CraftOutputEscrowError("La adopción no cubre el escrow completo.")
    payloads, identities = [], set()
    for artifact, receipt in zip(value.manifest.artifacts, receipts):
        if (not isinstance(receipt, StorageReceipt)
                or not isinstance(receipt.bucket, str) or not receipt.bucket
                or not isinstance(receipt.name, str) or not receipt.name
                or type(receipt.generation) is not int or receipt.generation < 1
                or (receipt.mime_type, receipt.byte_size, receipt.sha256) !=
                   (artifact.mime_type, artifact.byte_size, artifact.sha256)):
            raise CraftOutputEscrowError("Un StorageReceipt no liga el output exacto.")
        identity = (receipt.bucket, receipt.name, receipt.generation)
        if identity in identities:
            raise CraftOutputEscrowError("La adopción repite un objeto privado.")
        identities.add(identity)
        payloads.append({"artifact": artifact.canonical(),
                         "storageReceipt": _receipt_payload(receipt)})
    adoption_sha = canonical_sha256({
        "schemaVersion": 1, "escrowId": value.manifest.escrow_id,
        "manifestSha256": value.manifest.manifest_sha256, "items": payloads,
    })
    return replace(
        value, state="adopted", version=value.version + 1,
        storage_receipts=receipts, adoption_manifest_sha256=adoption_sha)


def request_craft_output_cleanup(
        value: CraftOutputEscrow, *, candidate_storage_state: str,
        terminal_status: str) -> CraftOutputEscrow:
    """Authorize purge only after complete adoption; uncertainty retains bytes."""
    if (candidate_storage_state in ("pending_storage", "received")
            or terminal_status == "unknown"):
        raise CraftOutputEscrowError("Escrow pendiente o incierto no admite purge.")
    if (value.state != "adopted" or terminal_status != "succeeded"
            or candidate_storage_state not in STORED_CANDIDATE_STATES):
        raise CraftOutputEscrowError("Falta autoridad durable para purge.")
    return replace(value, state="cleanup_pending", version=value.version + 1)


def mark_craft_output_deleted(
        value: CraftOutputEscrow, cleanup_receipt_sha256: str
        ) -> CraftOutputEscrow:
    if value.state != "cleanup_pending":
        raise CraftOutputEscrowError("El escrow no tiene cleanup autorizado.")
    return replace(
        value, state="deleted", version=value.version + 1,
        cleanup_receipt_sha256=_hash(
            cleanup_receipt_sha256, "cleanupReceiptSha256"))


def validate_craft_output_escrow_manifest(value: object) -> CraftEscrowManifest:
    """Parse the closed canonical manifest used by persistence boundaries."""
    raw = _closed(value, _MANIFEST_FIELDS, "CraftOutputEscrowManifestV1")
    fence_raw = _closed(raw["fence"], _FENCE_FIELDS, "escrow.fence")
    engine = _closed(raw["engine"], _ENGINE_FIELDS, "escrow.engine")
    artifacts_raw = raw["artifacts"]
    if not isinstance(artifacts_raw, list):
        raise CraftOutputEscrowError("escrow.artifacts no es una lista.")
    fence = CraftEscrowFence(
        fence_raw["ownerUserId"], fence_raw["jobId"], fence_raw["stepId"],
        fence_raw["attemptId"], fence_raw["attemptNo"],
        fence_raw["claimLeaseToken"], fence_raw["fenceEpoch"],
        fence_raw["admissionSha256"], fence_raw["claimSetSha256"])
    artifacts = tuple(CraftEscrowArtifact(
        item["ordinal"], item["kind"], item["relativePath"], item["role"],
        item["mimeType"], item["byteSize"], item["sha256"])
        for item in (_closed(row, _ARTIFACT_FIELDS, "escrow.artifact")
                     for row in artifacts_raw))
    manifest = CraftEscrowManifest(
        raw["escrowId"], fence, raw["dispatchId"], raw["requestSha256"],
        raw["authoritySha256"], engine["name"], engine["version"],
        engine["operation"], artifacts, raw["artifactManifestSha256"],
        raw["candidateResultSha256"], raw["manifestSha256"],
        raw["schemaVersion"], raw["pendingStorage"],
        raw["publicationAuthorized"])
    expected = tuple(CraftExpectedEscrowArtifact(
        item.ordinal, item.kind, item.relative_path, item.role,
        item.mime_type, item.byte_size) for item in artifacts)
    _validate_expected(manifest.engine_name, expected, artifacts)
    expected_dispatch = str(uuid5(
        NAMESPACE_URL,
        "uonify:craft-launcher:v2:"
        f"{fence.attempt_id}:{fence.claim_lease_token}:{fence.fence_epoch}",
    ))
    if (canonical_sha256([item.canonical() for item in artifacts])
            != manifest.artifact_manifest_sha256
            or canonical_sha256(manifest.body()) != manifest.manifest_sha256
            or manifest.dispatch_id != expected_dispatch):
        raise CraftOutputEscrowError("Las huellas del manifest no coinciden.")
    return manifest


def require_real_expected_outputs_disabled(
        _manifest: CraftEscrowManifest) -> None:
    """Permanent fail-closed gate until the real output broker is authorized."""
    raise CraftOutputEscrowError(
        "El broker real de expected_outputs permanece desactivado.")
