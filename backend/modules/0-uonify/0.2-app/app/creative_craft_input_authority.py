"""Inactive descriptor authority for Craft input materialization.

The public Craft work item never contains a filesystem path.  A private,
server-owned resolver may build :class:`CraftInputManifest` values from the
durable job and storage registry.  This module then opens every component
relative to one pinned root, keeps the leaf descriptor open while it is read,
hashed and copied, and mints a one-use attestation only after the exact bytes
and descriptor identity have been verified.

Nothing here is wired to startup, routes, workers, providers or GCS.  The
production bridge remains fail-closed until PostgreSQL can persist and consume
the same manifest and attestation set.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
import fcntl
from hashlib import sha256
import json
import math
import os
from pathlib import Path, PurePosixPath
import stat
from threading import Lock
import time
from typing import Callable, Protocol
from uuid import UUID, uuid4

from .creative_craft_launcher_authority import CraftInputBinding
from .creative_craft_launcher_contract import CraftLauncherContractError
from .creative_craft_materializer import CraftBoundMaterializationPlan


_SHA256 = frozenset("0123456789abcdef")
_NOFOLLOW = getattr(os, "O_NOFOLLOW", None)
_DIRECTORY = getattr(os, "O_DIRECTORY", None)
_CLOEXEC = getattr(os, "O_CLOEXEC", None)
_NONBLOCK = getattr(os, "O_NONBLOCK", None)
_CAPABILITY = object()


class CraftInputAuthorityError(CraftLauncherContractError):
    """The private input manifest or its physical observation is unsafe."""


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode()
    except (TypeError, ValueError):
        raise CraftInputAuthorityError(
            "El manifest privado de inputs no es JSON canónico.") from None


def _digest(value: object) -> str:
    return sha256(_canonical_bytes(value)).hexdigest()


def _manifest_runtime_digest(value: "CraftInputManifest") -> str:
    return _digest({
        "manifest": value.canonical(),
        "sourceRootPath": os.fspath(value.source_root.path),
    })


def _sha(value: object, label: str) -> str:
    if (not isinstance(value, str) or len(value) != 64
            or any(char not in _SHA256 for char in value)):
        raise CraftInputAuthorityError(f"{label} no es SHA-256 canónico.")
    return value


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftInputAuthorityError(f"{label} no es UUID canónico.") from None
    if value != parsed:
        raise CraftInputAuthorityError(f"{label} no es UUID canónico.")
    return parsed


def _exact_int(value: object, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise CraftInputAuthorityError(f"{label} sale del límite server-owned.")
    return value


def _relative(value: object, label: str, *, max_parts: int = 32) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise CraftInputAuthorityError(f"{label} no es una ruta relativa segura.")
    path = PurePosixPath(value)
    if (path.is_absolute() or len(path.parts) > max_parts
            or str(path) != value
            or any(part in ("", ".", "..")
                   or len(os.fsencode(part)) > 255 for part in path.parts)):
        raise CraftInputAuthorityError(f"{label} no es una ruta relativa segura.")
    return value


@dataclass(frozen=True)
class CraftInputPolicy:
    policy_id: str
    max_inputs: int = 64
    max_file_bytes: int = 2 * 1024**3
    max_total_bytes: int = 2 * 1024**3
    chunk_bytes: int = 1024 * 1024
    max_manifest_bytes: int = 256 * 1024
    max_path_parts: int = 32
    max_path_bytes: int = 4096

    def __post_init__(self) -> None:
        if (not isinstance(self.policy_id, str)
                or not 1 <= len(self.policy_id) <= 128
                or any(char not in
                       "abcdefghijklmnopqrstuvwxyz0123456789._-"
                       for char in self.policy_id)):
            raise CraftInputAuthorityError("policyId no es canónico.")
        _exact_int(self.max_inputs, 1, 64, "maxInputs")
        _exact_int(self.max_file_bytes, 1, 2 * 1024**3, "maxFileBytes")
        _exact_int(self.max_total_bytes, 1, 2 * 1024**3, "maxTotalBytes")
        _exact_int(self.chunk_bytes, 4096, 1024 * 1024, "chunkBytes")
        _exact_int(self.max_manifest_bytes, 1024, 256 * 1024,
                   "maxManifestBytes")
        _exact_int(self.max_path_parts, 1, 32, "maxPathParts")
        _exact_int(self.max_path_bytes, 1, 4096, "maxPathBytes")
        if self.max_file_bytes > self.max_total_bytes:
            raise CraftInputAuthorityError(
                "La policy permite un fichero mayor que el total.")

    def canonical(self) -> dict:
        return {
            "schemaVersion": 1,
            "policyId": self.policy_id,
            "maxInputs": self.max_inputs,
            "maxFileBytes": self.max_file_bytes,
            "maxTotalBytes": self.max_total_bytes,
            "chunkBytes": self.chunk_bytes,
            "maxManifestBytes": self.max_manifest_bytes,
            "maxPathParts": self.max_path_parts,
            "maxPathBytes": self.max_path_bytes,
            "descriptorRelative": True,
            "noFollow": True,
            "nonBlockingLeaf": True,
            "sameDescriptorReadAndHash": True,
            "singleLink": True,
            "sameOwnerAndDevice": True,
            "deadlineRequired": True,
            "durableCancellationRequired": True,
        }

    @property
    def policy_sha256(self) -> str:
        return _digest(self.canonical())


@dataclass(frozen=True)
class CraftSourceRoot:
    path: Path
    device: int
    inode: int
    owner_uid: int
    mode: int

    def __post_init__(self) -> None:
        if (not isinstance(self.path, Path) or not self.path.is_absolute()
                or type(self.device) is not int or self.device < 0
                or type(self.inode) is not int or self.inode < 1
                or type(self.owner_uid) is not int or self.owner_uid < 0
                or type(self.mode) is not int or self.mode < 0
                or self.mode & 0o022):
            raise CraftInputAuthorityError(
                "La raíz privada de inputs no tiene identidad segura.")

    @classmethod
    def pin(cls, path: Path, *, owner_uid: int) -> "CraftSourceRoot":
        _require_open_flags()
        if (not isinstance(path, Path) or not path.is_absolute()
                or type(owner_uid) is not int or owner_uid < 0):
            raise CraftInputAuthorityError(
                "La raíz privada de inputs no es server-owned.")
        descriptor = os.open(
            path, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC)
        try:
            observed = os.fstat(descriptor)
            mode = stat.S_IMODE(observed.st_mode)
            if (not stat.S_ISDIR(observed.st_mode)
                    or observed.st_uid != owner_uid or mode & 0o022):
                raise CraftInputAuthorityError(
                    "La raíz privada de inputs no es un directorio seguro.")
            return cls(path, observed.st_dev, observed.st_ino,
                       observed.st_uid, mode)
        finally:
            os.close(descriptor)

    def canonical(self) -> dict:
        return {
            "device": self.device, "inode": self.inode,
            "ownerUid": self.owner_uid, "mode": self.mode,
        }


@dataclass(frozen=True)
class CraftSourceEntry:
    binding: CraftInputBinding
    source_relative_path: str
    asset_revision: int
    storage_bucket: str
    storage_name: str
    storage_generation: int
    snapshot_sha256: str

    def __post_init__(self) -> None:
        if not isinstance(self.binding, CraftInputBinding):
            raise CraftInputAuthorityError("El binding de input no está tipado.")
        _relative(self.source_relative_path, "sourceRelativePath")
        _exact_int(self.asset_revision, 1, 2**31 - 1, "assetRevision")
        _exact_int(self.storage_generation, 1, 2**63 - 1,
                   "storageGeneration")
        if (not isinstance(self.storage_bucket, str)
                or not 1 <= len(self.storage_bucket) <= 222
                or not isinstance(self.storage_name, str)
                or not 1 <= len(self.storage_name) <= 1024):
            raise CraftInputAuthorityError(
                "El locator durable del input no es canónico.")
        _sha(self.snapshot_sha256, "snapshotSha256")

    def canonical(self) -> dict:
        return {
            **self.binding.canonical(),
            "sourceRelativePath": self.source_relative_path,
            "assetRevision": self.asset_revision,
            "storageReceipt": {
                "bucket": self.storage_bucket,
                "name": self.storage_name,
                "generation": self.storage_generation,
            },
            "snapshotSha256": self.snapshot_sha256,
        }


@dataclass(frozen=True)
class CraftInputManifest:
    mint_id: str
    installation_id: str
    storage_domain_id: str
    owner_user_id: str
    attempt_id: str
    intent_id: str
    population_generation_id: str
    namespace_id: str
    dispatch_id: str
    request_sha256: str
    plan_sha256: str
    population_fence_sha256: str
    input_manifest_sha256: str
    profile_sha256: str
    image_digest: str
    binary_sha256: str
    source_code_sha256: str
    source_root: CraftSourceRoot
    policy: CraftInputPolicy
    entries: tuple[CraftSourceEntry, ...]

    def __post_init__(self) -> None:
        for value, label in (
                (self.mint_id, "mintId"),
                (self.installation_id, "installationId"),
                (self.storage_domain_id, "storageDomainId"),
                (self.owner_user_id, "ownerUserId"),
                (self.attempt_id, "attemptId"),
                (self.intent_id, "intentId"),
                (self.population_generation_id, "populationGenerationId"),
                (self.namespace_id, "namespaceId"),
                (self.dispatch_id, "dispatchId")):
            _uuid(value, label)
        for value, label in (
                (self.request_sha256, "requestSha256"),
                (self.plan_sha256, "planSha256"),
                (self.population_fence_sha256, "populationFenceSha256"),
                (self.input_manifest_sha256, "inputManifestSha256"),
                (self.profile_sha256, "profileSha256"),
                (self.binary_sha256, "binarySha256"),
                (self.source_code_sha256, "sourceCodeSha256")):
            _sha(value, label)
        if (not isinstance(self.image_digest, str)
                or len(self.image_digest) != 71
                or not self.image_digest.startswith("sha256:")):
            raise CraftInputAuthorityError("imageDigest no es canónico.")
        _sha(self.image_digest[7:], "imageDigest")
        if (not isinstance(self.source_root, CraftSourceRoot)
                or not isinstance(self.policy, CraftInputPolicy)
                or not isinstance(self.entries, tuple)
                or not 1 <= len(self.entries) <= self.policy.max_inputs
                or any(not isinstance(item, CraftSourceEntry)
                       for item in self.entries)):
            raise CraftInputAuthorityError(
                "El manifest privado de inputs no está tipado.")
        targets = [item.binding.relative_path for item in self.entries]
        sources = [item.source_relative_path for item in self.entries]
        assets = [item.binding.asset_id for item in self.entries]
        if (len(set(targets)) != len(targets)
                or len(set(sources)) != len(sources)
                or len(set(assets)) != len(assets)
                or any(item.binding.owner_user_id != self.owner_user_id
                       for item in self.entries)
                or any(len(PurePosixPath(item.source_relative_path).parts)
                       > self.policy.max_path_parts for item in self.entries)
                or any(len(os.fsencode(item.source_relative_path))
                       > self.policy.max_path_bytes for item in self.entries)
                or any(item.binding.expected_bytes > self.policy.max_file_bytes
                       for item in self.entries)
                or sum(item.binding.expected_bytes for item in self.entries)
                       > self.policy.max_total_bytes):
            raise CraftInputAuthorityError(
                "El manifest privado duplica o excede sus inputs.")
        if len(_canonical_bytes(self.canonical())) > self.policy.max_manifest_bytes:
            raise CraftInputAuthorityError(
                "El manifest privado excede el límite server-owned.")

    def canonical(self) -> dict:
        return {
            "schemaVersion": 1,
            "mintId": self.mint_id,
            "installationId": self.installation_id,
            "storageDomainId": self.storage_domain_id,
            "ownerUserId": self.owner_user_id,
            "attemptId": self.attempt_id,
            "intentId": self.intent_id,
            "populationGenerationId": self.population_generation_id,
            "namespaceId": self.namespace_id,
            "dispatchId": self.dispatch_id,
            "requestSha256": self.request_sha256,
            "planSha256": self.plan_sha256,
            "populationFenceSha256": self.population_fence_sha256,
            "inputManifestSha256": self.input_manifest_sha256,
            "profileSha256": self.profile_sha256,
            "imageDigest": self.image_digest,
            "binarySha256": self.binary_sha256,
            "sourceCodeSha256": self.source_code_sha256,
            "sourceRoot": self.source_root.canonical(),
            "policy": self.policy.canonical(),
            "policySha256": self.policy.policy_sha256,
            "entries": [item.canonical() for item in self.entries],
        }

    @property
    def manifest_sha256(self) -> str:
        return _digest(self.canonical())


class CraftInputManifestResolver(Protocol):
    """Resolve only from durable server state; callers supply no paths."""

    def resolve(self, job: object, bound: CraftBoundMaterializationPlan,
                profile: object) -> CraftInputManifest: ...


class CraftDescriptorSink(ABC):
    """Inactive composition seam for a future typed materializer session.

    This interface proves streaming source reads only.  It is not evidence of
    durable destination persistence until Gate 118 provides the concrete
    LocalCraftMaterializer session and PostgreSQL consumes its receipt.
    """

    @abstractmethod
    def begin_input(self, binding: CraftInputBinding, *,
                    guard: "CraftIOGuard") -> None: ...

    @abstractmethod
    def write_chunk(self, relative_path: str, chunk: bytes, *,
                    guard: "CraftIOGuard") -> None: ...

    @abstractmethod
    def finish_input(self, relative_path: str, byte_size: int, sha256: str,
                     *, guard: "CraftIOGuard") -> None: ...

    @abstractmethod
    def commit(self, *, guard: "CraftIOGuard") -> dict: ...

    @abstractmethod
    def abort(self) -> None: ...


@dataclass(frozen=True)
class CraftIOGuard:
    deadline_monotonic: float
    revalidate: Callable[[], bool]
    cancelled: Callable[[], bool]
    monotonic: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        if (type(self.deadline_monotonic) not in (int, float)
                or not math.isfinite(self.deadline_monotonic)
                or not callable(self.revalidate)
                or not callable(self.cancelled)
                or not callable(self.monotonic)):
            raise CraftInputAuthorityError("El guard de I/O no es cerrado.")

    def checkpoint(self) -> None:
        if self.monotonic() >= self.deadline_monotonic:
            raise CraftInputAuthorityError("La lectura de input agotó su plazo.")
        cancelled = self.cancelled()
        if type(cancelled) is not bool or cancelled:
            raise CraftInputAuthorityError("La lectura de input fue cancelada.")
        if self.monotonic() >= self.deadline_monotonic:
            raise CraftInputAuthorityError("La lectura de input agotó su plazo.")
        if self.revalidate() is not True:
            raise CraftInputAuthorityError(
                "La lectura de input perdió su autoridad durable.")
        if self.monotonic() >= self.deadline_monotonic:
            raise CraftInputAuthorityError("La lectura de input agotó su plazo.")


@dataclass(frozen=True)
class CraftInputObservation:
    relative_path: str
    device: int
    inode: int
    owner_uid: int
    mode: int
    link_count: int
    byte_size: int
    sha256: str
    mtime_ns: int
    ctime_ns: int

    def canonical(self) -> dict:
        return {
            "relativePath": self.relative_path,
            "device": self.device, "inode": self.inode,
            "ownerUid": self.owner_uid, "mode": self.mode,
            "linkCount": self.link_count, "byteSize": self.byte_size,
            "sha256": self.sha256, "mtimeNs": self.mtime_ns,
            "ctimeNs": self.ctime_ns,
        }


@dataclass(frozen=True, slots=True, init=False)
class CraftVerifiedInputSet:
    """Module-issued capability; its constructor is intentionally private."""

    def __init__(self, manifest_canonical_body: bytes,
                 manifest_runtime_sha256: str,
                 observations: tuple[CraftInputObservation, ...],
                 total_bytes: int, sink_receipt: dict, *,
                 _capability: str, _sentinel: object = None):
        if _sentinel is not _CAPABILITY:
            raise CraftInputAuthorityError(
                "El set verificado sólo puede emitirlo el reader privado.")
        if (not isinstance(manifest_canonical_body, bytes)
                or not isinstance(manifest_runtime_sha256, str)):
            raise CraftInputAuthorityError(
                "El snapshot verificado no es canónico.")
        object.__setattr__(self, "manifest_canonical_body",
                           manifest_canonical_body)
        object.__setattr__(self, "manifest_runtime_sha256",
                           _sha(manifest_runtime_sha256,
                                "manifestRuntimeSha256"))
        object.__setattr__(self, "observations", observations)
        object.__setattr__(self, "total_bytes", total_bytes)
        object.__setattr__(self, "_sink_receipt_bytes",
                           _canonical_bytes(sink_receipt))
        object.__setattr__(self, "_capability", _capability)

    manifest_canonical_body: bytes
    manifest_runtime_sha256: str
    observations: tuple[CraftInputObservation, ...]
    total_bytes: int
    _sink_receipt_bytes: bytes
    _capability: str

    @property
    def sink_receipt(self) -> dict:
        return json.loads(self._sink_receipt_bytes)

    @property
    def manifest_sha256(self) -> str:
        return sha256(self.manifest_canonical_body).hexdigest()

    def canonical(self) -> dict:
        return {
            "schemaVersion": 1,
            "manifestSha256": self.manifest_sha256,
            "manifestRuntimeSha256": self.manifest_runtime_sha256,
            "observations": [item.canonical() for item in self.observations],
            "totalBytes": self.total_bytes,
            "sinkReceiptSha256": sha256(self._sink_receipt_bytes).hexdigest(),
        }


@dataclass(frozen=True, slots=True, init=False)
class ResolvedCraftInputManifest:
    """Opaque one-use result of the server-owned resolver."""

    def __init__(self, manifest: CraftInputManifest, capability: str, *,
                 _sentinel: object = None):
        if _sentinel is not _CAPABILITY:
            raise CraftInputAuthorityError(
                "El manifest resuelto sólo puede emitirlo el reader privado.")
        object.__setattr__(self, "manifest", manifest)
        object.__setattr__(self, "_capability", capability)

    manifest: CraftInputManifest
    _capability: str


class CraftInputMintPort(Protocol):
    """Future durable/isolated Gate 118 authority; no implementation here."""

    def mint(self, *, verified: CraftVerifiedInputSet,
             bound: CraftBoundMaterializationPlan,
             populate_receipt: dict,
             guard: CraftIOGuard) -> dict: ...


class SecureCraftInputReader:
    """Descriptor-relative reader for one pinned local storage domain."""

    inactive_product_shaped = True

    ready_for_product_mint = False

    def __init__(self, resolver: CraftInputManifestResolver, *,
                 installed_source_code_sha256: str,
                 max_pending_capabilities: int = 128):
        _require_open_flags()
        if resolver is None or not callable(getattr(resolver, "resolve", None)):
            raise CraftInputAuthorityError(
                "El reader exige un resolver server-owned.")
        self._resolver = resolver
        self._source_code_sha256 = _sha(
            installed_source_code_sha256, "installedSourceCodeSha256")
        self._max_pending = _exact_int(
            max_pending_capabilities, 1, 1024, "maxPendingCapabilities")
        self._states: dict[str, tuple[str, int, str]] = {}
        self._issued_manifests: set[tuple[str, str]] = set()
        self._lock = Lock()

    def resolve(self, job: object, bound: CraftBoundMaterializationPlan,
                profile: object) -> ResolvedCraftInputManifest:
        if not isinstance(bound, CraftBoundMaterializationPlan):
            raise CraftInputAuthorityError("El plan físico no está ligado.")
        manifest = self._resolver.resolve(job, bound, profile)
        if not isinstance(manifest, CraftInputManifest):
            raise CraftInputAuthorityError(
                "El resolver no devolvió un manifest privado tipado.")
        self._assert_bound(manifest, bound)
        if tuple(item.binding for item in manifest.entries) != bound.plan.inputs:
            raise CraftInputAuthorityError(
                "El manifest privado no coincide con el plan ligado.")
        self._assert_server_claims(manifest, job, profile)
        capability = uuid4().hex
        digest = _manifest_runtime_digest(manifest)
        manifest_key = (manifest.mint_id, digest)
        with self._lock:
            if (len(self._states) >= self._max_pending
                    or len(self._issued_manifests) >= self._max_pending
                    or manifest_key in self._issued_manifests):
                raise CraftInputAuthorityError(
                    "El manifest ya fue resuelto o agotó la cota privada.")
            self._states[capability] = ("resolved", id(manifest), digest)
            self._issued_manifests.add(manifest_key)
        return ResolvedCraftInputManifest(
            manifest, capability, _sentinel=_CAPABILITY)

    def copy_verified(
        self, resolved: ResolvedCraftInputManifest,
        bound: CraftBoundMaterializationPlan,
        sink: CraftDescriptorSink, *, guard: CraftIOGuard,
    ) -> CraftVerifiedInputSet:
        required_sink = ("begin_input", "write_chunk", "finish_input",
                         "commit", "abort")
        if (not isinstance(resolved, ResolvedCraftInputManifest)
                or not isinstance(bound, CraftBoundMaterializationPlan)
                or not isinstance(sink, CraftDescriptorSink)
                or any(not callable(getattr(sink, name, None))
                       for name in required_sink)
                or not isinstance(guard, CraftIOGuard)):
            raise CraftInputAuthorityError(
                "La copia descriptor-relative no tiene dependencias cerradas.")
        manifest = resolved.manifest
        self._assert_bound(manifest, bound)
        if tuple(item.binding for item in manifest.entries) != bound.plan.inputs:
            raise CraftInputAuthorityError(
                "El manifest resuelto no coincide con el plan ligado.")
        manifest_body = _canonical_bytes(manifest.canonical())
        manifest_document = json.loads(manifest_body)
        runtime_digest = _manifest_runtime_digest(manifest)
        root_path = Path(os.fspath(manifest.source_root.path))
        capability = str(resolved._capability)
        manifest_identity = id(manifest)
        with self._lock:
            expected_state = ("resolved", manifest_identity, runtime_digest)
            if self._states.get(capability) != expected_state:
                raise CraftInputAuthorityError(
                    "El manifest resuelto ya fue consumido.")
            self._states[capability] = (
                "copying", manifest_identity, runtime_digest)
        try:
            guard.checkpoint()
            try:
                root_fd = os.open(
                    root_path,
                    os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC)
            except OSError as error:
                raise CraftInputAuthorityError(
                    "La raíz privada no pudo abrirse de forma segura.") from error
            observations: list[CraftInputObservation] = []
            try:
                root = os.fstat(root_fd)
                self._assert_directory(
                    root, manifest_document["sourceRoot"], root=True)
                total = 0
                for entry in manifest_document["entries"]:
                    guard.checkpoint()
                    observation = self._copy_one(
                        root_fd, manifest_document, entry, sink, guard)
                    observations.append(observation)
                    total += observation.byte_size
                    if total > manifest_document["policy"]["maxTotalBytes"]:
                        raise CraftInputAuthorityError(
                            "La lectura excedió el total server-owned.")
                guard.checkpoint()
                closed_root = os.fstat(root_fd)
                self._assert_directory(
                    closed_root, manifest_document["sourceRoot"], root=True)
            finally:
                os.close(root_fd)
            guard.checkpoint()
            sink_receipt = sink.commit(guard=guard)
            guard.checkpoint()
            if not isinstance(sink_receipt, dict):
                raise CraftInputAuthorityError(
                    "El sink no devolvió un receipt canónico.")
            verified = CraftVerifiedInputSet(
                manifest_body, runtime_digest, tuple(observations), total,
                sink_receipt,
                _capability=capability, _sentinel=_CAPABILITY)
            verified_identity = id(verified)
            verified_digest = _digest(verified.canonical())
            with self._lock:
                if self._states.get(capability) != (
                        "copying", manifest_identity, runtime_digest):
                    raise CraftInputAuthorityError(
                        "La capability de copia cambió durante el I/O.")
                self._states[capability] = (
                    "verified", verified_identity, verified_digest)
        except BaseException:
            try:
                sink.abort()
            finally:
                with self._lock:
                    self._states.pop(capability, None)
            raise
        return verified

    def preview_attestation(
        self, verified: CraftVerifiedInputSet,
        bound: CraftBoundMaterializationPlan, *, populate_receipt: dict,
        guard: CraftIOGuard,
    ) -> bytes:
        """Exercise binding only; PostgreSQL mint remains a hard blocker."""
        if (not isinstance(verified, CraftVerifiedInputSet)
                or not isinstance(bound, CraftBoundMaterializationPlan)
                or not isinstance(populate_receipt, dict)
                or not isinstance(guard, CraftIOGuard)):
            raise CraftInputAuthorityError(
                "El mint no recibió un set verificado pendiente.")
        verified_body = _canonical_bytes(verified.canonical())
        verified_document = json.loads(verified_body)
        manifest_body = bytes(verified.manifest_canonical_body)
        manifest_document = json.loads(manifest_body)
        sink_receipt_body = bytes(verified._sink_receipt_bytes)
        supplied_receipt_body = _canonical_bytes(populate_receipt)
        verified_digest = sha256(verified_body).hexdigest()
        capability = str(verified._capability)
        verified_identity = id(verified)
        self._assert_bound_document(manifest_document, bound)
        with self._lock:
            if self._states.get(capability) != (
                    "verified", verified_identity, verified_digest):
                raise CraftInputAuthorityError(
                    "El mint no recibió un set verificado pendiente.")
            self._states[capability] = (
                "minting", verified_identity, verified_digest)
        try:
            guard.checkpoint()
            receipt_sha256 = sha256(supplied_receipt_body).hexdigest()
            if supplied_receipt_body != sink_receipt_body:
                raise CraftInputAuthorityError(
                    "El mint no liga el receipt del sink exacto.")
            body = {
                "schemaVersion": 1,
                "mintId": manifest_document["mintId"],
                "manifestSha256": sha256(manifest_body).hexdigest(),
                "policySha256": manifest_document["policySha256"],
                "planSha256": manifest_document["planSha256"],
                "populationFenceSha256":
                    manifest_document["populationFenceSha256"],
                "populationGenerationId":
                    manifest_document["populationGenerationId"],
                "verifiedInputSetSha256": verified_digest,
                "populateReceiptSha256": receipt_sha256,
                "totalBytes": verified_document["totalBytes"],
            }
            guard.checkpoint()
            body["attestationSha256"] = _digest(body)
            result = _canonical_bytes(body)
            guard.checkpoint()
        except BaseException:
            with self._lock:
                self._states.pop(capability, None)
            raise
        with self._lock:
            if self._states.pop(capability, None) != (
                    "minting", verified_identity, verified_digest):
                raise CraftInputAuthorityError(
                    "La capability de mint cambió durante la emisión.")
        return result

    def abandon(self, value: object) -> None:
        capability = getattr(value, "_capability", None)
        if not isinstance(capability, str):
            raise CraftInputAuthorityError(
                "La capability a abandonar no es privada.")
        with self._lock:
            state = self._states.get(capability)
            if state is None:
                raise CraftInputAuthorityError(
                    "La capability ya no está pendiente.")
            if state[0] not in ("resolved", "verified"):
                raise CraftInputAuthorityError(
                    "La capability está en una transición de I/O.")
            self._states.pop(capability)

    def _assert_server_claims(self, manifest: CraftInputManifest,
                              job: object, profile: object) -> None:
        canonical = getattr(profile, "canonical", None)
        if not callable(canonical):
            raise CraftInputAuthorityError(
                "El perfil runtime no es server-owned.")
        profile_document = canonical()
        if (not isinstance(profile_document, dict)
                or manifest.profile_sha256 != _digest(profile_document)
                or manifest.image_digest
                    != profile_document.get("imageDigest")
                or manifest.binary_sha256
                    != profile_document.get("binarySha256")
                or manifest.source_code_sha256 != self._source_code_sha256
                or getattr(job, "input_manifest_sha256", None)
                    != manifest.input_manifest_sha256):
            raise CraftInputAuthorityError(
                "El manifest privado no liga job, código y runtime instalados.")
        inputs = getattr(job, "inputs", None)
        if not isinstance(inputs, tuple) or len(inputs) != len(manifest.entries):
            raise CraftInputAuthorityError(
                "El job no conserva los inputs server-owned completos.")
        by_asset = {getattr(item, "asset_id", None): item for item in inputs}
        if len(by_asset) != len(inputs) or None in by_asset:
            raise CraftInputAuthorityError(
                "El job duplica o pierde identidad de asset.")
        for entry in manifest.entries:
            asset = by_asset.get(entry.binding.asset_id)
            receipt = getattr(asset, "storage_receipt", None)
            if (asset is None
                    or getattr(asset, "owner_user_id", None)
                        != entry.binding.owner_user_id
                    or getattr(asset, "asset_revision", None)
                        != entry.asset_revision
                    or getattr(asset, "byte_size", None)
                        != entry.binding.expected_bytes
                    or getattr(asset, "sha256", None)
                        != entry.binding.expected_sha256
                    or getattr(asset, "mount_name", None)
                        != entry.binding.relative_path
                    or getattr(asset, "snapshot_sha256", None)
                        != entry.snapshot_sha256
                    or getattr(receipt, "bucket", None)
                        != entry.storage_bucket
                    or getattr(receipt, "name", None)
                        != entry.storage_name
                    or getattr(receipt, "generation", None)
                        != entry.storage_generation
                    or getattr(receipt, "sha256", None)
                        != entry.binding.expected_sha256
                    or getattr(receipt, "byte_size", None)
                        != entry.binding.expected_bytes):
                raise CraftInputAuthorityError(
                    "Un source record no liga el snapshot durable del job.")

    @staticmethod
    def _assert_bound(manifest: CraftInputManifest,
                      bound: CraftBoundMaterializationPlan) -> None:
        intent = bound.plan.intent
        if (manifest.installation_id != intent.installation_id
                or manifest.storage_domain_id != bound.storage_domain_id
                or manifest.owner_user_id != intent.owner_user_id
                or manifest.attempt_id != intent.attempt_id
                or manifest.intent_id != bound.intent_id
                or manifest.population_generation_id
                    != bound.population_generation_id
                or manifest.namespace_id != bound.namespace_id
                or manifest.dispatch_id != intent.dispatch_id
                or manifest.request_sha256 != intent.request_sha256
                or manifest.plan_sha256 != bound.plan_sha256
                or manifest.population_fence_sha256
                    != bound.population_fence_sha256):
            raise CraftInputAuthorityError(
                "El manifest privado no coincide con el generation fence.")

    @staticmethod
    def _assert_bound_document(document: dict,
                               bound: CraftBoundMaterializationPlan) -> None:
        intent = bound.plan.intent
        expected = {
            "installationId": intent.installation_id,
            "storageDomainId": bound.storage_domain_id,
            "ownerUserId": intent.owner_user_id,
            "attemptId": intent.attempt_id,
            "intentId": bound.intent_id,
            "populationGenerationId": bound.population_generation_id,
            "namespaceId": bound.namespace_id,
            "dispatchId": intent.dispatch_id,
            "requestSha256": intent.request_sha256,
            "planSha256": bound.plan_sha256,
            "populationFenceSha256": bound.population_fence_sha256,
        }
        if (not isinstance(document, dict)
                or any(document.get(key) != value
                       for key, value in expected.items())):
            raise CraftInputAuthorityError(
                "El snapshot privado no coincide con el generation fence.")

    def _copy_one(self, root_fd: int, manifest: dict,
                  entry: dict, sink: CraftDescriptorSink,
                  guard: CraftIOGuard) -> CraftInputObservation:
        source_root = manifest["sourceRoot"]
        policy = manifest["policy"]
        source_relative_path = entry["sourceRelativePath"]
        relative_path = entry["relativePath"]
        expected_sha256 = entry["expectedSha256"]
        expected_bytes = entry["expectedBytes"]
        binding = CraftInputBinding(
            entry["assetId"], entry["ownerUserId"], relative_path,
            expected_sha256, expected_bytes)
        chunk_bytes = policy["chunkBytes"]
        max_file_bytes = policy["maxFileBytes"]
        parts = PurePosixPath(source_relative_path).parts
        parent_fd = os.dup(root_fd)
        try:
            for part in parts[:-1]:
                guard.checkpoint()
                try:
                    child = os.open(
                        part, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                        dir_fd=parent_fd)
                except OSError as error:
                    raise CraftInputAuthorityError(
                        "Un ancestro de input no pudo abrirse con O_NOFOLLOW."
                    ) from error
                try:
                    observed = os.fstat(child)
                    self._assert_directory(observed, source_root)
                except BaseException:
                    os.close(child)
                    raise
                os.close(parent_fd)
                parent_fd = child
            guard.checkpoint()
            try:
                descriptor = os.open(
                    parts[-1], os.O_RDONLY | _NOFOLLOW | _CLOEXEC | _NONBLOCK,
                    dir_fd=parent_fd)
            except OSError as error:
                raise CraftInputAuthorityError(
                    "El input terminal no pudo abrirse con O_NOFOLLOW."
                ) from error
            try:
                before = os.fstat(descriptor)
                self._assert_file(
                    before, source_root, expected_bytes, max_file_bytes)
                flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
                if not flags & _NONBLOCK:
                    raise CraftInputAuthorityError(
                        "El descriptor de input no conserva O_NONBLOCK.")
                guard.checkpoint()
                sink.begin_input(binding, guard=guard)
                hasher = sha256()
                copied_bytes = 0
                while True:
                    guard.checkpoint()
                    try:
                        chunk = os.read(descriptor, chunk_bytes)
                    except OSError as error:
                        raise CraftInputAuthorityError(
                            "La lectura del descriptor de input falló.") from error
                    guard.checkpoint()
                    if not chunk:
                        break
                    copied_bytes += len(chunk)
                    if copied_bytes > expected_bytes:
                        raise CraftInputAuthorityError(
                            "El descriptor excedió el tamaño esperado.")
                    hasher.update(chunk)
                    sink.write_chunk(
                        relative_path, chunk, guard=guard)
                    guard.checkpoint()
                copied_sha256 = hasher.hexdigest()
                guard.checkpoint()
                after = os.fstat(descriptor)
                try:
                    named_after = os.stat(
                        parts[-1], dir_fd=parent_fd, follow_symlinks=False)
                except OSError as error:
                    raise CraftInputAuthorityError(
                        "El nombre del input desapareció durante la lectura."
                    ) from error
                if (_identity(before) != _identity(after)
                        or (named_after.st_dev, named_after.st_ino)
                           != (before.st_dev, before.st_ino)
                        or os.lseek(descriptor, 0, os.SEEK_CUR) != before.st_size
                        or copied_bytes != expected_bytes
                        or copied_sha256 != expected_sha256):
                    raise CraftInputAuthorityError(
                        "El descriptor cambió o la copia no liga el snapshot.")
                sink.finish_input(
                    relative_path, copied_bytes,
                    copied_sha256, guard=guard)
                guard.checkpoint()
                return CraftInputObservation(
                    relative_path, before.st_dev, before.st_ino,
                    before.st_uid, stat.S_IMODE(before.st_mode),
                    before.st_nlink, copied_bytes, copied_sha256,
                    before.st_mtime_ns, before.st_ctime_ns)
            finally:
                os.close(descriptor)
        finally:
            os.close(parent_fd)

    @staticmethod
    def _assert_directory(observed: os.stat_result, expected: dict,
                          *, root: bool = False) -> None:
        if (not stat.S_ISDIR(observed.st_mode)
                or observed.st_dev != expected["device"]
                or observed.st_uid != expected["ownerUid"]
                or stat.S_IMODE(observed.st_mode) & 0o022
                or (root and (observed.st_ino != expected["inode"]
                              or stat.S_IMODE(observed.st_mode)
                              != expected["mode"]))):
            raise CraftInputAuthorityError(
                "Un directorio de input salió del dominio fijado.")

    @staticmethod
    def _assert_file(observed: os.stat_result,
                     source_root: dict, expected_bytes: int,
                     max_file_bytes: int) -> None:
        if (not stat.S_ISREG(observed.st_mode)
                or observed.st_dev != source_root["device"]
                or observed.st_uid != source_root["ownerUid"]
                or stat.S_IMODE(observed.st_mode) & 0o022
                or observed.st_nlink != 1
                or observed.st_size != expected_bytes
                or observed.st_size > max_file_bytes):
            raise CraftInputAuthorityError(
                "El descriptor terminal no es un input regular seguro.")


def _identity(
    value: os.stat_result,
) -> tuple[int, int, int, int, int, int, int, int]:
    return (value.st_dev, value.st_ino, value.st_uid,
            stat.S_IMODE(value.st_mode), value.st_nlink,
            value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _require_open_flags() -> None:
    if None in (_NOFOLLOW, _DIRECTORY, _CLOEXEC, _NONBLOCK):
        raise CraftInputAuthorityError(
            "La plataforma no ofrece las banderas seguras de descriptor.")
