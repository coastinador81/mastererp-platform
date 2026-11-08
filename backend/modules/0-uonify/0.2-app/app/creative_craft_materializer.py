"""Inactive local Craft materialization journal for the 116 boundary.

The database owns intents, storage domains, population generations, namespaces,
population fences and cleanup leases.  This module owns only local bytes.  A
caller must claim and bind the complete population plan durably before
``prepare`` can create the journal and must revalidate its database token once
before creating any local artifact and again after the filesystem lock is
acquired.  Nothing here is wired into a worker or application startup.

Activation remains blocked until input reads and their hashes share one
trusted descriptor/stream boundary and the physical verifier policy digest is
derived from the enforced policy rather than a constant.
"""

from __future__ import annotations

from dataclasses import dataclass
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import time
from typing import Callable, Mapping
from uuid import UUID

from .creative_craft_launcher_authority import CraftInputBinding
from .creative_craft_launcher_contract import CraftLauncherContractError


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_CLOEXEC = getattr(os, "O_CLOEXEC", 0)


class CraftMaterializationError(CraftLauncherContractError):
    """A local plan, journal or materialized tree is unsafe or divergent."""


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode()
    except (TypeError, ValueError):
        raise CraftMaterializationError(
            "El plan local Craft no es JSON canónico.") from None


def _digest(value: object) -> str:
    return sha256(_canonical_bytes(value)).hexdigest()


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftMaterializationError(f"{label} no es UUID canónico.") from None
    if parsed != value:
        raise CraftMaterializationError(f"{label} no es UUID canónico.")
    return parsed


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise CraftMaterializationError(f"{label} no es SHA-256 canónico.")
    return value


def _relative(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise CraftMaterializationError(f"{label} no es una ruta relativa segura.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise CraftMaterializationError(f"{label} no es una ruta relativa segura.")
    return value


@dataclass(frozen=True)
class CraftMaterializationIntent:
    installation_id: str
    storage_domain_id: str
    owner_user_id: str
    attempt_id: str
    intent_id: str
    population_generation_id: str
    namespace_id: str
    dispatch_id: str
    request_sha256: str
    population_fence_sha256: str

    def __post_init__(self) -> None:
        for field in ("installation_id", "storage_domain_id", "owner_user_id",
                      "attempt_id", "intent_id", "population_generation_id",
                      "namespace_id", "dispatch_id"):
            _uuid(getattr(self, field), field)
        _sha(self.request_sha256, "requestSha256")
        _sha(self.population_fence_sha256, "populationFenceSha256")


@dataclass(frozen=True)
class CraftMaterializationPlan:
    intent: CraftMaterializationIntent
    data_namespace_root: Path
    input_root: Path
    output_root: Path
    journal_root: Path
    lock_path: Path
    plan_path: Path
    populated_path: Path
    finalized_path: Path
    tombstone_path: Path
    forgotten_path: Path
    inputs: tuple[CraftInputBinding, ...]
    expected_outputs: tuple[str, ...]
    profile: dict
    control_document: dict
    limits: dict
    plan_sha256: str

    def sql_document(self) -> dict:
        """The exact closed document accepted by materialization_bind_population."""
        return {
            "dispatchId": self.intent.dispatch_id,
            "namespaceId": self.intent.namespace_id,
            "profile": self.profile,
            "controlDocument": self.control_document,
            "inputRoot": str(self.input_root),
            "outputRoot": str(self.output_root),
            "inputs": [item.canonical() for item in self.inputs],
            "expectedOutputs": list(self.expected_outputs),
            "limits": self.limits,
        }

    def canonical(self, *, include_sha256: bool = True) -> dict:
        value = {
            "schemaVersion": 1,
            "installationId": self.intent.installation_id,
            "storageDomainId": self.intent.storage_domain_id,
            "ownerUserId": self.intent.owner_user_id,
            "attemptId": self.intent.attempt_id,
            "intentId": self.intent.intent_id,
            "populationGenerationId": self.intent.population_generation_id,
            "namespaceId": self.intent.namespace_id,
            "dispatchId": self.intent.dispatch_id,
            "requestSha256": self.intent.request_sha256,
            "populationFenceSha256": self.intent.population_fence_sha256,
            "dataNamespaceRoot": str(self.data_namespace_root),
            "inputRoot": str(self.input_root),
            "outputRoot": str(self.output_root),
            "journalRoot": str(self.journal_root),
            "lockPath": str(self.lock_path),
            "planPath": str(self.plan_path),
            "populatedPath": str(self.populated_path),
            "finalizedPath": str(self.finalized_path),
            "tombstonePath": str(self.tombstone_path),
            "forgottenPath": str(self.forgotten_path),
            "pendingPaths": [
                str(path.with_name(f".{path.name}.pending"))
                for path in (self.plan_path, self.populated_path,
                             self.finalized_path, self.tombstone_path,
                             self.forgotten_path)
            ],
            "inputs": [item.canonical() for item in self.inputs],
            "expectedOutputs": list(self.expected_outputs),
            "profile": self.profile,
            "controlDocument": self.control_document,
            "limits": self.limits,
        }
        if include_sha256:
            value["planSha256"] = self.plan_sha256
        return value


@dataclass(frozen=True)
class CraftBoundMaterializationPlan:
    """Typed proof that SQL durably accepted the exact path set."""

    plan: CraftMaterializationPlan
    intent_id: str
    storage_domain_id: str
    population_generation_id: str
    namespace_id: str
    population_lease_token: str
    plan_sha256: str
    population_fence_sha256: str

    def __post_init__(self) -> None:
        for value, label in (
                (self.intent_id, "intentId"),
                (self.storage_domain_id, "storageDomainId"),
                (self.population_generation_id, "populationGenerationId"),
                (self.namespace_id, "namespaceId"),
                (self.population_lease_token, "populationLeaseToken")):
            _uuid(value, label)
        _sha(self.plan_sha256, "planSha256")
        _sha(self.population_fence_sha256, "populationFenceSha256")
        if (self.intent_id != self.plan.intent.intent_id
                or self.storage_domain_id
                != self.plan.intent.storage_domain_id
                or self.population_generation_id
                != self.plan.intent.population_generation_id
                or self.namespace_id != self.plan.intent.namespace_id
                or self.plan_sha256 != self.plan.plan_sha256
                or self.population_fence_sha256
                != self.plan.intent.population_fence_sha256):
            raise CraftMaterializationError(
                "El bind SQL no corresponde al plan local Craft.")


@dataclass(frozen=True)
class CraftMaterializationResult:
    input_root: Path
    output_root: Path
    inputs: tuple[CraftInputBinding, ...]
    intent_id: str
    storage_domain_id: str
    population_generation_id: str
    namespace_id: str
    plan_sha256: str
    populate_receipt: dict


@dataclass(frozen=True)
class CraftCleanupLease:
    bound: CraftBoundMaterializationPlan
    storage_domain_id: str
    population_generation_id: str
    lease_token: str

    def __post_init__(self) -> None:
        _uuid(self.storage_domain_id, "storageDomainId")
        _uuid(self.population_generation_id, "populationGenerationId")
        _uuid(self.lease_token, "leaseToken")
        if (self.storage_domain_id != self.bound.storage_domain_id
                or self.population_generation_id
                != self.bound.population_generation_id):
            raise CraftMaterializationError(
                "El cleanup SQL no corresponde a la generación local Craft.")


@dataclass(frozen=True)
class CraftForgetResult:
    intent_id: str
    storage_domain_id: str
    population_generation_id: str
    namespace_id: str
    plan_sha256: str
    tombstone_sha256: str
    forget_receipt: dict


class LocalCraftMaterializer:
    """Create-only, descriptor-relative local materializer.

    Authorization callbacks must query the 116 authority using a fresh, short
    transaction. ``prepare`` calls its callback before it creates any local
    artifact, then calls it again under the permanent namespace lock just
    before writing the plan. Populate and finalize revalidate under that lock;
    forget commits cleanup under the same lock before destructive I/O.
    """

    def __init__(self, *, installation_id: str, storage_domain_id: str,
                 data_root: Path, journal_root: Path):
        self.installation_id = _uuid(installation_id, "installationId")
        self.storage_domain_id = _uuid(
            storage_domain_id, "storageDomainId")
        self._data_root = self._trusted_root(data_root, "dataRoot")
        self._journal_base = self._trusted_root(journal_root, "journalRoot")
        self._data_identity = self._identity(self._data_root)
        self._journal_identity = self._identity(self._journal_base)

    @staticmethod
    def _trusted_root(value: Path, label: str) -> Path:
        path = Path(os.path.abspath(os.fspath(value)))
        try:
            resolved = path.resolve(strict=True)
            info = path.stat(follow_symlinks=False)
        except OSError:
            raise CraftMaterializationError(f"{label} no existe.") from None
        if (resolved != path or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) & 0o022):
            raise CraftMaterializationError(f"{label} no es un directorio privado.")
        return path

    @staticmethod
    def _identity(path: Path) -> tuple[int, int]:
        info = path.stat(follow_symlinks=False)
        return info.st_dev, info.st_ino

    def plan(self, intent: CraftMaterializationIntent, *,
             inputs: tuple[CraftInputBinding, ...],
             expected_outputs: tuple[str, ...], profile: dict,
             control_document: dict, limits: dict) -> CraftMaterializationPlan:
        """Purely derive every local path; this method performs no I/O."""
        if intent.installation_id != self.installation_id:
            raise CraftMaterializationError("El intent pertenece a otra instalación.")
        if intent.storage_domain_id != self.storage_domain_id:
            raise CraftMaterializationError(
                "El intent pertenece a otro storage domain.")
        if (not isinstance(inputs, tuple)
                or any(not isinstance(item, CraftInputBinding) for item in inputs)
                or len({item.relative_path for item in inputs}) != len(inputs)):
            raise CraftMaterializationError("Los inputs del plan no son cerrados.")
        outputs = tuple(_relative(item, "expectedOutput")
                        for item in expected_outputs)
        if len(outputs) != len(set(outputs)):
            raise CraftMaterializationError("Las salidas del plan no son únicas.")
        for value, label in ((profile, "profile"),
                             (control_document, "controlDocument"),
                             (limits, "limits")):
            if not isinstance(value, dict):
                raise CraftMaterializationError(f"{label} no es un objeto cerrado.")
            _canonical_bytes(value)
        relative = (Path(intent.installation_id) / intent.storage_domain_id /
                    intent.dispatch_id / intent.population_generation_id /
                    intent.namespace_id)
        data = self._data_root / relative
        journal = self._journal_base / relative
        draft = CraftMaterializationPlan(
            intent=intent, data_namespace_root=data,
            input_root=data / "inputs", output_root=data / "outputs",
            journal_root=journal, lock_path=journal / "lock",
            plan_path=journal / "plan.json",
            populated_path=journal / "populated.json",
            finalized_path=journal / "finalized.json",
            tombstone_path=journal / "tombstone.json",
            forgotten_path=journal / "forgotten.json", inputs=inputs,
            expected_outputs=outputs, profile=dict(profile),
            control_document=dict(control_document), limits=dict(limits),
            plan_sha256="0" * 64)
        # PostgreSQL derives the durable plan hash from this exact closed DTO.
        digest = _digest(draft.sql_document())
        return CraftMaterializationPlan(**{
            **draft.__dict__, "plan_sha256": digest})

    def prepare(self, bound: CraftBoundMaterializationPlan, *,
                revalidate: Callable[[CraftBoundMaterializationPlan], bool],
                deadline_monotonic: float | None = None,
                monotonic: Callable[[], float] = time.monotonic) -> None:
        """Persist the create-only ledger after SQL has bound the full plan."""
        self._require_bound(bound)
        # The first authorization happens before create=True can add the
        # installation/dispatch/namespace directories or the permanent lock.
        guard = lambda: self._io_guard(
            revalidate, bound, deadline_monotonic, monotonic)
        guard()
        journal_fd = self._open_journal(bound.plan, create=True)
        try:
            lock_fd = self._open_lock(journal_fd)
            try:
                with _exclusive(lock_fd, guard):
                    guard()
                    self._write_once(journal_fd, "plan.json",
                                     bound.plan.canonical(), guard=guard)
                    self._checkpoint("after_plan")
            finally:
                os.close(lock_fd)
        finally:
            os.close(journal_fd)

    def populate(self, bound: CraftBoundMaterializationPlan, *,
                 payloads: Mapping[str, bytes],
                 revalidate: Callable[[CraftBoundMaterializationPlan], bool],
                 deadline_monotonic: float | None = None,
                 monotonic: Callable[[], float] = time.monotonic) -> dict:
        """Populate or reconstruct the complete tree under the shared lock."""
        self._require_bound(bound)
        plan = bound.plan
        expected = {item.relative_path: item for item in plan.inputs}
        if set(payloads) != set(expected) or any(
                not isinstance(value, bytes) for value in payloads.values()):
            raise CraftMaterializationError("Los payloads no coinciden con el plan.")
        guard = lambda: self._io_guard(
            revalidate, bound, deadline_monotonic, monotonic)
        journal_fd = self._open_journal(plan, create=False)
        try:
            lock_fd = self._open_lock(journal_fd)
            try:
                with _exclusive(lock_fd, guard):
                    self._assert_plan(journal_fd, plan)
                    self._reject_tombstone(journal_fd)
                    existing = self._read_optional(journal_fd, "populated.json")
                    if existing is not None:
                        self._verify_tree(plan, existing, guard=guard)
                        return existing
                    guard()
                    self._reset_data_namespace(plan, guard=guard)
                    namespace_fd = self._open_data_namespace(plan, create=True)
                    try:
                        inputs_fd = self._mkdir_open(namespace_fd, "inputs")
                        self._checkpoint("after_inputs_root")
                        outputs_fd = self._mkdir_open(namespace_fd, "outputs")
                        self._checkpoint("after_outputs_root")
                        try:
                            for relative, binding in expected.items():
                                self._write_input(inputs_fd, relative,
                                                  payloads[relative], binding,
                                                  guard=guard)
                                self._checkpoint(f"after_input:{relative}")
                            os.fsync(inputs_fd)
                            os.fsync(outputs_fd)
                            os.fsync(namespace_fd)
                            receipt = self._population_receipt(
                                plan, namespace_fd, inputs_fd, outputs_fd)
                        finally:
                            os.close(outputs_fd)
                            os.close(inputs_fd)
                    finally:
                        os.close(namespace_fd)
                    self._write_once(
                        journal_fd, "populated.json", receipt, guard=guard)
                    self._checkpoint("after_populated")
                    return receipt
            finally:
                os.close(lock_fd)
        finally:
            os.close(journal_fd)

    def finalize(self, bound: CraftBoundMaterializationPlan, *,
                 revalidate: Callable[[CraftBoundMaterializationPlan], bool],
                 deadline_monotonic: float | None = None,
                 monotonic: Callable[[], float] = time.monotonic,
                 ) -> CraftMaterializationResult:
        self._require_bound(bound)
        plan = bound.plan
        guard = lambda: self._io_guard(
            revalidate, bound, deadline_monotonic, monotonic)
        journal_fd = self._open_journal(plan, create=False)
        try:
            lock_fd = self._open_lock(journal_fd)
            try:
                with _exclusive(lock_fd, guard):
                    self._assert_plan(journal_fd, plan)
                    self._reject_tombstone(journal_fd)
                    receipt = self._read_required(journal_fd, "populated.json")
                    guard()
                    self._verify_tree(plan, receipt, guard=guard)
                    final = {"schemaVersion": 1,
                             "storageDomainId":
                                 plan.intent.storage_domain_id,
                             "intentId": plan.intent.intent_id,
                             "populationGenerationId":
                                 plan.intent.population_generation_id,
                             "namespaceId": plan.intent.namespace_id,
                             "planSha256": plan.plan_sha256,
                             "populateReceiptSha256": _digest(receipt)}
                    self._write_once(
                        journal_fd, "finalized.json", final, guard=guard)
                    self._checkpoint("after_finalized")
                    return CraftMaterializationResult(
                        plan.input_root, plan.output_root, plan.inputs,
                        plan.intent.intent_id, plan.intent.storage_domain_id,
                        plan.intent.population_generation_id,
                        plan.intent.namespace_id, plan.plan_sha256, receipt)
            finally:
                os.close(lock_fd)
        finally:
            os.close(journal_fd)

    def forget(self, cleanup: CraftCleanupLease, *,
               commit_cleanup: Callable[[CraftCleanupLease], bool]
               ) -> CraftForgetResult:
        bound = cleanup.bound
        self._require_bound(bound)
        plan = bound.plan
        # A process may die after SQL binds the plan and before ``prepare``
        # creates the local ledger. Cleanup authorization is sufficient to
        # create the deterministic journal/lock and seal it with a tombstone.
        journal_fd = self._open_journal(plan, create=True)
        try:
            lock_fd = self._open_lock(journal_fd)
            try:
                with _exclusive(lock_fd):
                    self._commit_cleanup(commit_cleanup, cleanup)
                    persisted_plan = self._read_optional(journal_fd, "plan.json")
                    if persisted_plan is None:
                        self._write_once(journal_fd, "plan.json", plan.canonical())
                    elif persisted_plan != plan.canonical():
                        raise CraftMaterializationError(
                            "El plan persistido diverge.")
                    tombstone = {"schemaVersion": 1,
                                 "installationId": plan.intent.installation_id,
                                 "storageDomainId":
                                     plan.intent.storage_domain_id,
                                 "intentId": plan.intent.intent_id,
                                 "populationGenerationId":
                                     plan.intent.population_generation_id,
                                 "namespaceId": plan.intent.namespace_id,
                                 "planSha256": plan.plan_sha256}
                    self._write_once(journal_fd, "tombstone.json", tombstone)
                    self._checkpoint("after_tombstone")
                    self._reset_data_namespace(plan)
                    self._checkpoint("after_delete")
                    receipt = {**tombstone,
                               "tombstoneSha256": _digest(tombstone),
                               "dataNamespaceAbsent": True}
                    self._write_once(journal_fd, "forgotten.json", receipt)
                    self._checkpoint("after_forgotten")
                    return CraftForgetResult(
                        plan.intent.intent_id, plan.intent.storage_domain_id,
                        plan.intent.population_generation_id,
                        plan.intent.namespace_id, plan.plan_sha256,
                        _digest(tombstone), receipt)
            finally:
                os.close(lock_fd)
        finally:
            os.close(journal_fd)

    discard = forget

    def _checkpoint(self, _name: str) -> None:
        """Test seam for process-crash simulation; production is a no-op."""

    def _require_bound(self, bound: CraftBoundMaterializationPlan) -> None:
        if (not isinstance(bound, CraftBoundMaterializationPlan)
                or bound.plan.intent.installation_id != self.installation_id
                or bound.storage_domain_id != self.storage_domain_id):
            raise CraftMaterializationError("Falta el bind SQL 116 del plan.")

    @staticmethod
    def _revalidate(callback: Callable, value: object) -> None:
        if not callable(callback):
            raise CraftMaterializationError("Falta revalidar la autoridad SQL 116.")
        result = callback(value)
        if result is not True:
            raise CraftMaterializationError("La autoridad SQL 116 ya no está vigente.")

    @classmethod
    def _io_guard(cls, callback: Callable, value: object,
                  deadline_monotonic: float | None,
                  monotonic: Callable[[], float]) -> None:
        if (deadline_monotonic is not None
                and (type(deadline_monotonic) not in (int, float)
                     or not callable(monotonic)
                     or monotonic() >= deadline_monotonic)):
            raise CraftMaterializationError(
                "El deadline local Craft venció durante el I/O.")
        cls._revalidate(callback, value)

    @staticmethod
    def _commit_cleanup(callback: Callable, cleanup: CraftCleanupLease) -> None:
        if not callable(callback):
            raise CraftMaterializationError(
                "Falta confirmar materialization_commit_cleanup.")
        if callback(cleanup) is not True:
            raise CraftMaterializationError(
                "materialization_commit_cleanup no confirmó el cleanup.")

    def _open_base(self, path: Path, identity: tuple[int, int]) -> int:
        fd = os.open(path, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC)
        info = os.fstat(fd)
        if ((info.st_dev, info.st_ino) != identity
                or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) & 0o022):
            os.close(fd)
            raise CraftMaterializationError("El root local Craft cambió.")
        return fd

    @staticmethod
    def _open_existing_dir(parent_fd: int, name: str) -> int:
        fd = os.open(name, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                     dir_fd=parent_fd)
        info = os.fstat(fd)
        entry = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) & 0o022
                or (info.st_dev, info.st_ino) !=
                    (entry.st_dev, entry.st_ino)):
            os.close(fd)
            raise CraftMaterializationError("Un directorio local Craft no es privado.")
        return fd

    @staticmethod
    def _mkdir_open(parent_fd: int, name: str) -> int:
        try:
            os.mkdir(name, 0o700, dir_fd=parent_fd)
            os.fsync(parent_fd)
        except FileExistsError:
            pass
        return LocalCraftMaterializer._open_existing_dir(parent_fd, name)

    def _open_chain(self, base_fd: int, parts: tuple[str, ...],
                    *, create: bool) -> int:
        current = os.dup(base_fd)
        try:
            for part in parts:
                next_fd = (self._mkdir_open(current, part) if create else
                           self._open_existing_dir(current, part))
                os.close(current)
                current = next_fd
            return current
        except BaseException:
            os.close(current)
            raise

    def _open_journal(self, plan: CraftMaterializationPlan, *, create: bool) -> int:
        base = self._open_base(self._journal_base, self._journal_identity)
        try:
            return self._open_chain(base, (plan.intent.installation_id,
                                          plan.intent.storage_domain_id,
                                          plan.intent.dispatch_id,
                                          plan.intent.population_generation_id,
                                          plan.intent.namespace_id),
                                    create=create)
        finally:
            os.close(base)

    def _open_data_namespace(self, plan: CraftMaterializationPlan,
                             *, create: bool) -> int:
        base = self._open_base(self._data_root, self._data_identity)
        try:
            return self._open_chain(base, (plan.intent.installation_id,
                                          plan.intent.storage_domain_id,
                                          plan.intent.dispatch_id,
                                          plan.intent.population_generation_id,
                                          plan.intent.namespace_id),
                                    create=create)
        finally:
            os.close(base)

    @staticmethod
    def _open_lock(journal_fd: int) -> int:
        flags = os.O_RDWR | os.O_CREAT | _NOFOLLOW | _CLOEXEC
        fd = os.open("lock", flags, 0o600, dir_fd=journal_fd)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            os.close(fd)
            raise CraftMaterializationError("El lock local Craft no es seguro.")
        return fd

    @staticmethod
    def _write_once(directory_fd: int, name: str, value: object, *,
                    guard: Callable[[], None] | None = None) -> None:
        body = _canonical_bytes(value)
        current = LocalCraftMaterializer._read_optional(directory_fd, name)
        if current is not None:
            if current != value:
                raise CraftMaterializationError(
                    f"El ledger create-only {name} diverge.")
            return
        pending = f".{name}.pending"
        try:
            pending_info = os.stat(
                pending, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            if (not stat.S_ISREG(pending_info.st_mode)
                    or pending_info.st_uid != os.geteuid()
                    or stat.S_IMODE(pending_info.st_mode) != 0o600
                    or pending_info.st_nlink != 1):
                raise CraftMaterializationError(
                    "El pending del ledger local no es seguro.")
            os.unlink(pending, dir_fd=directory_fd)
            os.fsync(directory_fd)
        fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     _NOFOLLOW | _CLOEXEC, 0o600, dir_fd=directory_fd)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1):
                raise CraftMaterializationError("El ledger local no es seguro.")
            view = memoryview(body)
            while view:
                if guard is not None:
                    guard()
                written = os.write(fd, view[:1024 * 1024])
                if written <= 0:
                    raise CraftMaterializationError("No se pudo persistir el ledger.")
                view = view[written:]
            if guard is not None:
                guard()
            os.fsync(fd)
            try:
                os.link(pending, name, src_dir_fd=directory_fd,
                        dst_dir_fd=directory_fd, follow_symlinks=False)
            except FileExistsError:
                if LocalCraftMaterializer._read_required(
                        directory_fd, name) != value:
                    raise CraftMaterializationError(
                        f"El ledger create-only {name} diverge.") from None
            if guard is not None:
                guard()
            os.fsync(directory_fd)
        finally:
            os.close(fd)
            try:
                os.unlink(pending, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
            os.fsync(directory_fd)

    @staticmethod
    def _read_optional(directory_fd: int, name: str) -> dict | None:
        try:
            fd = os.open(name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC,
                         dir_fd=directory_fd)
        except FileNotFoundError:
            return None
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1):
                raise CraftMaterializationError("El ledger local no es seguro.")
            body = bytearray()
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > 8 * 1024 * 1024:
                    raise CraftMaterializationError("El ledger local excede el límite.")
        finally:
            os.close(fd)
        try:
            value = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise CraftMaterializationError("El ledger local no es JSON válido.") from None
        if not isinstance(value, dict) or _canonical_bytes(value) != bytes(body):
            raise CraftMaterializationError("El ledger local no es canónico.")
        return value

    @staticmethod
    def _read_required(directory_fd: int, name: str) -> dict:
        value = LocalCraftMaterializer._read_optional(directory_fd, name)
        if value is None:
            raise CraftMaterializationError(f"Falta {name} en el ledger local.")
        return value

    def _assert_plan(self, journal_fd: int,
                     plan: CraftMaterializationPlan) -> None:
        if self._read_required(journal_fd, "plan.json") != plan.canonical():
            raise CraftMaterializationError("El plan persistido diverge.")

    def _reject_tombstone(self, journal_fd: int) -> None:
        if self._read_optional(journal_fd, "tombstone.json") is not None:
            raise CraftMaterializationError("El namespace Craft tiene tombstone.")

    def _reset_data_namespace(self, plan: CraftMaterializationPlan, *,
                              guard: Callable[[], None] | None = None) -> None:
        base = self._open_base(self._data_root, self._data_identity)
        try:
            installation = self._mkdir_open(base, plan.intent.installation_id)
            try:
                storage = self._mkdir_open(
                    installation, plan.intent.storage_domain_id)
                try:
                    dispatch = self._mkdir_open(storage, plan.intent.dispatch_id)
                    try:
                        generation = self._mkdir_open(
                            dispatch, plan.intent.population_generation_id)
                        try:
                            self._remove_entry(
                                generation, plan.intent.namespace_id,
                                guard=guard)
                            os.fsync(generation)
                        finally:
                            os.close(generation)
                    finally:
                        os.close(dispatch)
                finally:
                    os.close(storage)
            finally:
                os.close(installation)
        finally:
            os.close(base)

    @classmethod
    def _remove_entry(cls, parent_fd: int, name: str, *,
                      guard: Callable[[], None] | None = None) -> None:
        if guard is not None:
            guard()
        try:
            info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if not stat.S_ISDIR(info.st_mode):
            if guard is not None:
                guard()
            os.unlink(name, dir_fd=parent_fd)
            return
        child = os.open(name, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                        dir_fd=parent_fd)
        try:
            for entry in os.scandir(child):
                cls._remove_entry(child, entry.name, guard=guard)
            os.fsync(child)
        finally:
            os.close(child)
        os.rmdir(name, dir_fd=parent_fd)

    def _write_input(self, input_fd: int, relative: str, body: bytes,
                     binding: CraftInputBinding, *,
                     guard: Callable[[], None] | None = None) -> None:
        hasher = sha256()
        for offset in range(0, len(body), 1024 * 1024):
            if guard is not None:
                guard()
            hasher.update(body[offset:offset + 1024 * 1024])
        if (len(body) != binding.expected_bytes
                or hasher.hexdigest() != binding.expected_sha256):
            raise CraftMaterializationError("Un payload no liga su snapshot.")
        parts = PurePosixPath(_relative(relative, "input.relativePath")).parts
        parent = os.dup(input_fd)
        try:
            for part in parts[:-1]:
                next_fd = self._mkdir_open(parent, part)
                os.close(parent)
                parent = next_fd
            fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                         _NOFOLLOW | _CLOEXEC, 0o600, dir_fd=parent)
            try:
                view = memoryview(body)
                while view:
                    if guard is not None:
                        guard()
                    written = os.write(fd, view[:1024 * 1024])
                    if written <= 0:
                        raise CraftMaterializationError("Input local incompleto.")
                    view = view[written:]
                if guard is not None:
                    guard()
                os.fsync(fd)
                info = os.fstat(fd)
                if (not stat.S_ISREG(info.st_mode)
                        or info.st_uid != os.geteuid()
                        or stat.S_IMODE(info.st_mode) != 0o600
                        or info.st_nlink != 1):
                    raise CraftMaterializationError("Input local no seguro.")
            finally:
                os.close(fd)
            if guard is not None:
                guard()
            os.fsync(parent)
        finally:
            os.close(parent)

    @staticmethod
    def _population_receipt(plan: CraftMaterializationPlan, namespace_fd: int,
                            inputs_fd: int, outputs_fd: int) -> dict:
        identity = lambda fd: [os.fstat(fd).st_dev, os.fstat(fd).st_ino]
        body = {"schemaVersion": 1, "intentId": plan.intent.intent_id,
                "storageDomainId": plan.intent.storage_domain_id,
                "populationGenerationId":
                    plan.intent.population_generation_id,
                "namespaceId": plan.intent.namespace_id,
                "planSha256": plan.plan_sha256,
                "dataNamespaceIdentity": identity(namespace_fd),
                "inputRootIdentity": identity(inputs_fd),
                "outputRootIdentity": identity(outputs_fd),
                "inputTreeSha256": _digest(
                    [item.canonical() for item in plan.inputs]),
                "expectedOutputTreeSha256": _digest(
                    list(plan.expected_outputs))}
        return {**body, "populateReceiptSha256": _digest(body)}

    def _verify_tree(self, plan: CraftMaterializationPlan, receipt: dict, *,
                     guard: Callable[[], None] | None = None) -> None:
        if guard is not None:
            guard()
        namespace_fd = self._open_data_namespace(plan, create=False)
        try:
            inputs_fd = self._open_existing_dir(namespace_fd, "inputs")
            outputs_fd = self._open_existing_dir(namespace_fd, "outputs")
            try:
                expected = self._population_receipt(
                    plan, namespace_fd, inputs_fd, outputs_fd)
                if receipt != expected:
                    raise CraftMaterializationError("El receipt populate diverge.")
                observed: set[str] = set()
                expected_directories = {
                    str(PurePosixPath(item.relative_path).parent)
                    for item in plan.inputs
                    if str(PurePosixPath(item.relative_path).parent) != "."
                }
                expected_directories = {
                    str(PurePosixPath(*PurePosixPath(relative).parts[:depth]))
                    for relative in expected_directories
                    for depth in range(1, len(PurePosixPath(relative).parts) + 1)
                }
                self._verify_input_dir(inputs_fd, "", observed,
                                       {item.relative_path: item
                                        for item in plan.inputs},
                                       expected_directories, guard=guard)
                if observed != {item.relative_path for item in plan.inputs}:
                    raise CraftMaterializationError("El árbol de inputs diverge.")
                if any(True for _ in os.scandir(outputs_fd)):
                    raise CraftMaterializationError("El output root no está vacío.")
            finally:
                os.close(outputs_fd)
                os.close(inputs_fd)
        finally:
            os.close(namespace_fd)

    @classmethod
    def _verify_input_dir(cls, directory_fd: int, prefix: str,
                          observed: set[str],
                          expected: Mapping[str, CraftInputBinding],
                          expected_directories: set[str], *,
                          guard: Callable[[], None] | None = None) -> None:
        for entry in os.scandir(directory_fd):
            if guard is not None:
                guard()
            relative = f"{prefix}/{entry.name}" if prefix else entry.name
            info = entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                if relative not in expected_directories:
                    raise CraftMaterializationError(
                        "El árbol de inputs contiene un directorio adicional.")
                child = os.open(entry.name, os.O_RDONLY | _DIRECTORY |
                                _NOFOLLOW | _CLOEXEC, dir_fd=directory_fd)
                try:
                    opened = os.fstat(child)
                    if ((opened.st_dev, opened.st_ino) !=
                            (info.st_dev, info.st_ino)
                            or opened.st_uid != os.geteuid()
                            or stat.S_IMODE(opened.st_mode) & 0o022):
                        raise CraftMaterializationError(
                            "Un directorio input cambió durante la lectura.")
                    cls._verify_input_dir(
                        child, relative, observed, expected,
                        expected_directories, guard=guard)
                finally:
                    os.close(child)
                continue
            binding = expected.get(relative)
            if (binding is None or not stat.S_ISREG(info.st_mode)
                    or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1 or info.st_size != binding.expected_bytes):
                raise CraftMaterializationError("Un input local no es seguro.")
            fd = os.open(entry.name, os.O_RDONLY | _NOFOLLOW | _CLOEXEC,
                         dir_fd=directory_fd)
            try:
                opened = os.fstat(fd)
                if ((opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino)
                        or opened.st_uid != os.geteuid()
                        or stat.S_IMODE(opened.st_mode) != 0o600
                        or opened.st_nlink != 1):
                    raise CraftMaterializationError(
                        "Un input cambió durante la lectura.")
                hasher = sha256()
                while True:
                    if guard is not None:
                        guard()
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        break
                    hasher.update(chunk)
            finally:
                os.close(fd)
            if hasher.hexdigest() != binding.expected_sha256:
                raise CraftMaterializationError("Un input local fue alterado.")
            observed.add(relative)


class _exclusive:
    def __init__(self, fd: int,
                 guard: Callable[[], None] | None = None):
        self.fd = fd
        self.guard = guard

    def __enter__(self):
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if self.guard is not None:
                    self.guard()
                time.sleep(0.01)
        return self

    def __exit__(self, *_exc):
        fcntl.flock(self.fd, fcntl.LOCK_UN)

