"""Inactive, synthetic local I/O boundary for Craft V2 receipts.

Challenge issuance and receipt persistence use short, separate transactions.
Filesystem/storage observation happens between them, with no connection open.
Only a scoped verifier adapter can persist an attestation by challenge ID.

This module is not a production host-security boundary. Activation remains
blocked by the input-hash TOCTOU (validation and hashing do not yet share one
descriptor), and by the verifier policy digest still being a constant rather
than a digest of the enforced policy. The adapter must also add cumulative
file/byte budgets, streaming destination reads and hashes, per-operation
deadlines/cancellation, and descriptor-relative input traversal with
``O_NOFOLLOW`` plus ownership/device checks. Attestation creation must move
behind a private minting boundary; ``VerifiedPhysicalChallenge`` is
intentionally only a typed synthetic-gate value here.
"""

from dataclasses import dataclass
import errno
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import stat
from typing import Callable, Protocol
from uuid import UUID, uuid4

from .creative_composite_quote import canonical_sha256
from .creative_craft_physical_receipt_contract import (
    CraftPhysicalReceiptError, Phase, require_verified_receipt,
    _parse_binding, _parse_evidence,
)
from .creative_craft_transition_client import (
    CraftTransitionClient, CraftTransitionClientError, transition,
)


class CraftPhysicalVerificationError(RuntimeError):
    pass


class StorageProofReader(Protocol):
    """Reads destination bytes from an injected private storage boundary."""

    def read_destination(self, storage_receipt: dict) -> bytes: ...


class CraftPhysicalVerifierExecutor(Protocol):
    """Runs one scoped verify_phase(challenge_id) function."""

    def load_physical_challenge(
            self, *, connection: object, phase: Phase,
            challenge_id: str) -> object: ...

    def verify_physical_challenge(
            self, *, connection: object, phase: Phase,
            challenge_id: str) -> object: ...


@dataclass(frozen=True)
class CraftPhysicalChallenge:
    challenge_id: str
    receipt_id: str
    phase: Phase
    binding: dict
    evidence: dict
    proof: dict

    @classmethod
    def parse(cls, value: object) -> "CraftPhysicalChallenge":
        keys = {"challengeId", "receiptId", "phase", "binding", "evidence",
                "proof"}
        if not isinstance(value, dict) or set(value) != keys:
            raise CraftPhysicalVerificationError(
                "El challenge físico no es un DTO cerrado.")
        challenge_id = _uuid(value["challengeId"], "challengeId")
        receipt_id = _uuid(value["receiptId"], "receiptId")
        phase = value["phase"]
        if phase not in (
                "reserve", "prestart_forget", "terminal_forget", "adopt_copy",
                "materialization_populate", "materialization_forget"):
            raise CraftPhysicalVerificationError("Fase física desconocida.")
        if not isinstance(value["proof"], dict):
            raise CraftPhysicalVerificationError("Proof físico no cerrado.")
        binding = _parse_binding(value["binding"])
        evidence = _parse_evidence(phase, value["evidence"])
        binding.canonical()
        evidence.canonical()
        return cls(challenge_id, receipt_id, phase, value["binding"],
                   value["evidence"], value["proof"])


@dataclass(frozen=True)
class VerifiedPhysicalChallenge:
    challenge: CraftPhysicalChallenge


class CraftPhysicalReceiptStore:
    """Separates issue and verifier persistence with caller-owned connections."""

    def __init__(self, database, transitions: CraftTransitionClient,
                 verifier: CraftPhysicalVerifierExecutor):
        self._database = database
        self._transitions = transitions
        self._verifier = verifier

    @property
    def installation_id(self) -> str:
        return self._transitions.installation_id

    @property
    def storage_domain_id(self) -> str:
        value = self._transitions.storage_domain_id
        if value is None:
            raise CraftPhysicalVerificationError(
                "La instalación no liga storageDomainId.")
        return value

    def issue(self, operation: str, **arguments: object
              ) -> CraftPhysicalChallenge:
        try:
            with self._database.connect() as connection:
                value = self._transitions.invoke(
                    connection, transition(operation, **arguments))
        except CraftTransitionClientError as error:
            raise CraftPhysicalVerificationError(str(error)) from error
        issued = CraftPhysicalChallenge.parse(value)
        # The scoped verifier reloads immutable proof from PostgreSQL. The
        # issuer's return value is never the physical verifier's authority.
        with self._database.connect() as connection:
            loaded_value = self._verifier.load_physical_challenge(
                connection=connection, phase=issued.phase,
                challenge_id=issued.challenge_id)
        loaded = CraftPhysicalChallenge.parse(loaded_value)
        if loaded != issued:
            raise CraftPhysicalVerificationError(
                "El verifier cargó otro challenge físico.")
        return loaded

    def persist(self, attestation: VerifiedPhysicalChallenge) -> str:
        if not isinstance(attestation, VerifiedPhysicalChallenge):
            raise CraftPhysicalVerificationError("Attestation no tipada.")
        challenge = attestation.challenge
        # Local I/O already finished before this transaction opens.
        with self._database.connect() as connection:
            value = self._verifier.verify_physical_challenge(
                connection=connection, phase=challenge.phase,
                challenge_id=challenge.challenge_id)
        binding = _parse_binding(challenge.binding)
        evidence = _parse_evidence(challenge.phase, challenge.evidence)

        class _Attested:
            def verify_physical_receipt(self, *_args, **_kwargs):
                return True

        try:
            receipt = require_verified_receipt(
                _Attested(), value,
                expected_receipt_id=challenge.receipt_id,
                expected_challenge_id=challenge.challenge_id,
                expected_phase=challenge.phase, expected_binding=binding,
                expected_evidence=evidence)
        except CraftPhysicalReceiptError as error:
            raise CraftPhysicalVerificationError(str(error)) from error
        return receipt.receipt_id


class LocalCraftPhysicalVerifier:
    # Explicit activation barrier consumed by the inactive 117 orchestrator.
    # This verifier remains a synthetic gate, as documented by this module.
    inactive_synthetic = True

    """Verifies synthetic local roots and injected destination storage."""

    def __init__(self, store: CraftPhysicalReceiptStore,
                 *, allowed_roots: tuple[Path, ...], journal_root: Path,
                 storage_reader: StorageProofReader | None = None):
        if not allowed_roots:
            raise ValueError("Falta un root sintético permitido.")
        self._store = store
        self._allowed = tuple(Path(item).resolve(strict=True)
                              for item in allowed_roots)
        self._journal = Path(journal_root).resolve(strict=True)
        journal_stat = self._journal.stat()
        if (not stat.S_ISDIR(journal_stat.st_mode)
                or journal_stat.st_uid != os.geteuid()
                or stat.S_IMODE(journal_stat.st_mode) & 0o022):
            raise ValueError("El journal físico no es un directorio.")
        self._journal_identity = (journal_stat.st_dev, journal_stat.st_ino)
        self._storage = storage_reader

    @property
    def installation_id(self) -> str:
        return self._store.installation_id

    @property
    def storage_domain_id(self) -> str:
        return self._store.storage_domain_id

    def verify_reserve(self, *, claim, request, materialization,
                       launcher_receipt: dict) -> str:
        challenge = self._store.issue(
            "issue_reserve_challenge", user_id=claim.user_id,
            attempt_id=claim.attempt_id)
        self._assert_challenge(challenge, "reserve", claim.user_id,
                               claim.attempt_id)
        self._assert_request(challenge, request)
        proof = self._launcher_proof(challenge)
        if (proof["inputRoot"] != str(materialization.input_root)
                or proof["outputRoot"] != str(materialization.output_root)
                or proof["inputs"] != [i.canonical()
                                       for i in materialization.inputs]):
            raise CraftPhysicalVerificationError(
                "El proof reserve no coincide con la materialización.")
        self._verify_reserve_files(challenge, proof)
        return self._store.persist(VerifiedPhysicalChallenge(challenge))

    def verify_prestart_forget(self, *, claim, compensation,
                               launcher_receipt: dict,
                               perform_forget: Callable[[], None]) -> str:
        lease = _uuid(compensation.lease_token, "compensationLeaseToken")
        challenge = self._store.issue(
            "issue_prestart_forget_challenge", user_id=claim.user_id,
            attempt_id=claim.attempt_id, lease_token=lease)
        self._assert_challenge(challenge, "prestart_forget", claim.user_id,
                               claim.attempt_id)
        self._assert_request(challenge, compensation.request)
        if not callable(perform_forget):
            raise CraftPhysicalVerificationError("Forget local no invocable.")
        # The issue/load transactions are closed before destructive I/O.
        perform_forget()
        self._verify_forget(challenge, lease_token=lease)
        return self._store.persist(VerifiedPhysicalChallenge(challenge))

    def issue_terminal_forget(self, *, claim, runtime_lease_token: str,
                              request) -> None:
        lease = _uuid(runtime_lease_token, "runtimeLeaseToken")
        challenge = self._store.issue(
            "issue_terminal_forget_challenge", user_id=claim.user_id,
            attempt_id=claim.attempt_id, runtime_lease_token=lease)
        self._assert_challenge(challenge, "terminal_forget", claim.user_id,
                               claim.attempt_id)
        self._assert_request(challenge, request)

    def verify_terminal_forget(self, *, claim, terminal_status: str,
                               runtime_lease_token: str, request,
                               launcher_receipt: dict) -> str:
        lease = _uuid(runtime_lease_token, "runtimeLeaseToken")
        challenge = self._store.issue(
            "issue_terminal_forget_challenge", user_id=claim.user_id,
            attempt_id=claim.attempt_id, runtime_lease_token=lease)
        self._assert_challenge(challenge, "terminal_forget", claim.user_id,
                               claim.attempt_id)
        self._assert_request(challenge, request)
        if challenge.evidence.get("terminalStatus") != terminal_status:
            raise CraftPhysicalVerificationError(
                "El terminal físico no coincide con el ACK.")
        self._verify_forget(challenge, lease_token=lease,
                            terminal_status=terminal_status)
        return self._store.persist(VerifiedPhysicalChallenge(challenge))

    def verify_adopt_copy(self, *, user_id: str, escrow_id: str,
                          version: int, lease_token: str) -> str:
        challenge = self._store.issue(
            "issue_adopt_copy_challenge", user_id=user_id,
            escrow_id=escrow_id, version=version,
            lease_token=_uuid(lease_token, "leaseToken"))
        self._assert_challenge(challenge, "adopt_copy", user_id, None)
        self._verify_destinations(challenge)
        return self._store.persist(VerifiedPhysicalChallenge(challenge))

    def issue_materialization_populate(
            self, *, user_id: str, attempt_id: str, intent_id: str,
            generation_id: str, lease_token: str
            ) -> CraftPhysicalChallenge:
        generation = _uuid(generation_id, "populationGenerationId")
        lease = _uuid(lease_token, "populationLeaseToken")
        challenge = self._store.issue(
            "issue_materialization_populate_challenge", user_id=user_id,
            attempt_id=attempt_id, intent_id=intent_id,
            generation_id=generation, lease_token=lease)
        self._assert_materialization_challenge(
            challenge, "materialization_populate", user_id, attempt_id,
            intent_id, generation)
        return challenge

    def verify_materialization_populate(
            self, *, challenge: CraftPhysicalChallenge, plan: dict,
            populate_receipt: dict) -> str:
        self._assert_materialization_proof(challenge, plan)
        self._verify_materialization_files(challenge, plan, populate_receipt)
        return self._store.persist(VerifiedPhysicalChallenge(challenge))

    def issue_materialization_forget(
            self, *, user_id: str, intent_id: str, lease_token: str
            ) -> CraftPhysicalChallenge:
        challenge = self._store.issue(
            "issue_materialization_forget_challenge", user_id=user_id,
            intent_id=intent_id,
            lease_token=_uuid(lease_token, "cleanupLeaseToken"))
        self._assert_materialization_challenge(
            challenge, "materialization_forget", user_id, None, intent_id,
            None)
        return challenge

    def verify_materialization_forget(
            self, *, challenge: CraftPhysicalChallenge, plan: dict,
            forget_receipt: dict) -> str:
        self._assert_materialization_proof(challenge, plan)
        self._verify_materialization_forget_files(
            challenge, plan, forget_receipt)
        return self._store.persist(VerifiedPhysicalChallenge(challenge))

    @staticmethod
    def _assert_challenge(challenge, phase, user_id, attempt_id):
        if (challenge.phase != phase
                or challenge.binding.get("ownerUserId") != user_id
                or (attempt_id is not None
                    and challenge.binding.get("attemptId") != attempt_id)):
            raise CraftPhysicalVerificationError(
                "El challenge no liga la operación esperada.")

    def _assert_materialization_challenge(
            self, challenge, phase, user_id, attempt_id, intent_id,
            generation_id):
        LocalCraftPhysicalVerifier._assert_challenge(
            challenge, phase, user_id, attempt_id)
        if (challenge.binding.get("intentId") != intent_id
                or (generation_id is not None
                    and challenge.binding.get("populationGenerationId")
                    != generation_id)
                or challenge.binding.get("installationId")
                != self.installation_id
                or challenge.binding.get("storageDomainId")
                != self.storage_domain_id
                or not isinstance(
                    challenge.binding.get("populationGenerationId"), str)
                or not isinstance(challenge.binding.get("namespaceId"), str)
                or not isinstance(
                    challenge.binding.get("populationFenceSha256"), str)):
            raise CraftPhysicalVerificationError(
                "El challenge no liga el intent materialization.")

    @staticmethod
    def _materialization_plan(value: object) -> dict:
        keys = {"dispatchId", "namespaceId", "profile", "controlDocument",
                "inputRoot", "outputRoot", "inputs", "expectedOutputs",
                "limits"}
        if (not isinstance(value, dict) or set(value) != keys
                or not isinstance(value["profile"], dict)
                or not isinstance(value["controlDocument"], dict)
                or not isinstance(value["inputs"], list)
                or not isinstance(value["expectedOutputs"], list)
                or not isinstance(value["limits"], dict)):
            raise CraftPhysicalVerificationError(
                "El plan materialization no es cerrado.")
        return value

    def _assert_materialization_proof(self, challenge, plan):
        plan = self._materialization_plan(plan)
        proof = challenge.proof
        if (not isinstance(proof, dict)
                or set(proof) != {"plan", "populationFenceSha256"}
                or proof["plan"] != plan
                or proof["populationFenceSha256"]
                != challenge.binding.get("populationFenceSha256")
                or challenge.binding.get("installationId")
                != self.installation_id
                or challenge.binding.get("storageDomainId")
                != self.storage_domain_id
                or plan["dispatchId"] != challenge.binding["dispatchId"]
                or plan["namespaceId"]
                != challenge.binding.get("namespaceId")
                or canonical_sha256(plan)
                != challenge.evidence.get("planSha256")):
            raise CraftPhysicalVerificationError(
                "El proof materialization diverge del intent.")

    @staticmethod
    def _assert_request(challenge, request):
        body = getattr(request, "body", None)
        digest = getattr(request, "request_sha256", None)
        if (not isinstance(body, dict)
                or challenge.binding.get("dispatchId") != body.get("dispatchId")
                or challenge.binding.get("requestSha256") != digest):
            raise CraftPhysicalVerificationError(
                "El challenge no liga la petición Launcher.")

    @staticmethod
    def _launcher_proof(challenge: CraftPhysicalChallenge) -> dict:
        keys = {"inputRoot", "outputRoot", "inputs", "expectedOutputs",
                "limits"}
        if set(challenge.proof) != keys:
            raise CraftPhysicalVerificationError("Proof launcher no cerrado.")
        if (not isinstance(challenge.proof["inputs"], list)
                or not isinstance(challenge.proof["expectedOutputs"], list)):
            raise CraftPhysicalVerificationError("Proof launcher no tipado.")
        return challenge.proof

    def _safe_root(self, value: object, *, must_exist: bool) -> Path:
        if not isinstance(value, str):
            raise CraftPhysicalVerificationError("Root físico no canónico.")
        path = Path(value)
        absolute = Path(os.path.abspath(path))
        if not any(absolute == root or root in absolute.parents
                   for root in self._allowed):
            raise CraftPhysicalVerificationError("Root físico fuera de alcance.")
        probe = absolute if must_exist else absolute.parent
        try:
            resolved = probe.resolve(strict=True)
        except OSError:
            if not must_exist:
                return absolute
            raise CraftPhysicalVerificationError("Root físico ausente.") from None
        if resolved != probe:
            raise CraftPhysicalVerificationError("Root físico atraviesa symlink.")
        return absolute

    def _verify_reserve_files(self, challenge, proof):
        input_root = self._safe_root(proof["inputRoot"], must_exist=True)
        output_root = self._safe_root(proof["outputRoot"], must_exist=True)
        expected_paths = set()
        for item in proof["inputs"]:
            keys = {"assetId", "ownerUserId", "relativePath",
                    "expectedSha256", "expectedBytes"}
            if not isinstance(item, dict) or set(item) != keys:
                raise CraftPhysicalVerificationError("Input físico no cerrado.")
            file = _safe_child(input_root, item["relativePath"])
            expected_paths.add(file)
            try:
                exact = file.resolve(strict=True) == file
            except OSError:
                exact = False
            if (not exact or not file.is_file() or file.is_symlink()
                    or file.stat().st_size != item["expectedBytes"]
                    or _file_sha256(file) != item["expectedSha256"]):
                raise CraftPhysicalVerificationError("Input físico divergente.")
        expected_entries = expected_paths | _expected_input_directories(
            input_root, proof["inputs"])
        observed_entries = set(input_root.rglob("*"))
        if (observed_entries != expected_entries
                or any(item.is_symlink() for item in observed_entries)
                or any(output_root.iterdir())):
            raise CraftPhysicalVerificationError("Árbol físico divergente.")
        for relative in proof["expectedOutputs"]:
            _safe_child(output_root, relative)
        materialization = {
            "inputRoot": proof["inputRoot"], "outputRoot": proof["outputRoot"],
            "inputs": proof["inputs"],
            "expectedOutputs": proof["expectedOutputs"],
            "limits": proof["limits"],
        }
        expected = challenge.evidence
        if (canonical_sha256(materialization)
                != expected["materializationSha256"]
                or canonical_sha256(proof["inputs"])
                != expected["inputTreeSha256"]
                or canonical_sha256(proof["expectedOutputs"])
                != expected["outputTreeSha256"]
                or canonical_sha256({
                    "ownerUserId": challenge.binding["ownerUserId"],
                    "attemptId": challenge.binding["attemptId"],
                    "inputRoot": proof["inputRoot"],
                    "outputRoot": proof["outputRoot"],
                }) != expected["ownershipMarkerSha256"]
                or expected["inputCount"] != len(proof["inputs"])
                or expected["expectedOutputCount"]
                != len(proof["expectedOutputs"])):
            raise CraftPhysicalVerificationError("Evidencia reserve divergente.")

    def _verify_materialization_files(
            self, challenge, plan, populate_receipt):
        plan = self._materialization_plan(plan)
        raw_input_root = Path(os.path.abspath(plan["inputRoot"]))
        raw_output_root = Path(os.path.abspath(plan["outputRoot"]))
        self._assert_population_paths(
            challenge.binding, raw_input_root, raw_output_root)
        input_root = self._safe_root(plan["inputRoot"], must_exist=True)
        output_root = self._safe_root(plan["outputRoot"], must_exist=True)
        expected_paths = set()
        for item in plan["inputs"]:
            keys = {"assetId", "ownerUserId", "relativePath",
                    "expectedSha256", "expectedBytes"}
            if not isinstance(item, dict) or set(item) != keys:
                raise CraftPhysicalVerificationError(
                    "Input materialization no cerrado.")
            file = _safe_child(input_root, item["relativePath"])
            expected_paths.add(file)
            try:
                exact = file.resolve(strict=True) == file
                info = file.stat(follow_symlinks=False)
            except OSError:
                exact = False
                info = None
            if (not exact or info is None or not stat.S_ISREG(info.st_mode)
                    or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_nlink != 1
                    or info.st_size != item["expectedBytes"]
                    or _secure_file_sha256(file, info)
                    != item["expectedSha256"]):
                raise CraftPhysicalVerificationError(
                    "Input materialization divergente.")
        expected_entries = expected_paths | _expected_input_directories(
            input_root, plan["inputs"])
        observed_entries = set(input_root.rglob("*"))
        if (observed_entries != expected_entries
                or any(item.is_symlink() for item in observed_entries)
                or any(output_root.iterdir())):
            raise CraftPhysicalVerificationError(
                "Árbol materialization divergente.")
        for relative in plan["expectedOutputs"]:
            _safe_child(output_root, relative)
        evidence = challenge.evidence
        materialization = {
            "inputRoot": plan["inputRoot"],
            "outputRoot": plan["outputRoot"], "inputs": plan["inputs"],
            "expectedOutputs": plan["expectedOutputs"],
            "limits": plan["limits"],
        }
        ownership = {
            "ownerUserId": challenge.binding["ownerUserId"],
            "attemptId": challenge.binding["attemptId"],
            "intentId": challenge.binding["intentId"],
            "populationGenerationId":
                challenge.binding["populationGenerationId"],
            "namespaceId": challenge.binding["namespaceId"],
            "storageDomainId": challenge.binding["storageDomainId"],
        }
        if (canonical_sha256(materialization)
                != evidence.get("materializationSha256")
                or canonical_sha256(plan["inputs"])
                != evidence.get("inputTreeSha256")
                or canonical_sha256(plan["expectedOutputs"])
                != evidence.get("outputTreeSha256")
                or canonical_sha256(ownership)
                != evidence.get("ownershipMarkerSha256")):
            raise CraftPhysicalVerificationError(
                "Evidencia materialization divergente.")
        journal_fd = self._open_materialization_journal(challenge.binding)
        try:
            local_plan = self._read_materialization_marker(
                journal_fd, "plan.json")
            local_populated = self._read_materialization_marker(
                journal_fd, "populated.json")
        finally:
            os.close(journal_fd)
        if (local_plan != self._expected_local_plan(
                    challenge.binding, plan, evidence["planSha256"])
                or local_populated != populate_receipt):
            raise CraftPhysicalVerificationError(
                "El ledger populate local diverge.")
        self._validate_populate_receipt(
            challenge, plan, local_populated, input_root, output_root)

    @staticmethod
    def _validate_populate_receipt(
            challenge, plan: dict, receipt: dict,
            input_root: Path, output_root: Path) -> None:
        keys = {"schemaVersion", "storageDomainId", "intentId",
                "populationGenerationId", "namespaceId", "planSha256",
                "dataNamespaceIdentity", "inputRootIdentity",
                "outputRootIdentity", "inputTreeSha256",
                "expectedOutputTreeSha256", "populateReceiptSha256"}
        if not isinstance(receipt, dict) or set(receipt) != keys:
            raise CraftPhysicalVerificationError(
                "El receipt populate local no es cerrado.")
        if (type(receipt["schemaVersion"]) is not int
                or receipt["schemaVersion"] != 1
                or receipt["storageDomainId"]
                != challenge.binding["storageDomainId"]
                or receipt["intentId"] != challenge.binding["intentId"]
                or receipt["populationGenerationId"]
                != challenge.binding["populationGenerationId"]
                or receipt["namespaceId"]
                != challenge.binding["namespaceId"]
                or receipt["planSha256"]
                != challenge.evidence["planSha256"]):
            raise CraftPhysicalVerificationError(
                "El receipt populate local no liga el intent.")

        def identity(value, label):
            if (not isinstance(value, list) or len(value) != 2
                    or any(type(item) is not int or item < 0
                           for item in value)
                    or value[1] < 1):
                raise CraftPhysicalVerificationError(
                    f"{label} no es una identidad física cerrada.")
            return value

        namespace_root = input_root.parent
        if output_root.parent != namespace_root:
            raise CraftPhysicalVerificationError(
                "Los roots populate no comparten namespace.")
        try:
            namespace_stat = namespace_root.stat(follow_symlinks=False)
            input_stat = input_root.stat(follow_symlinks=False)
            output_stat = output_root.stat(follow_symlinks=False)
        except OSError:
            raise CraftPhysicalVerificationError(
                "El namespace populate desapareció.") from None
        for info in (namespace_stat, input_stat, output_stat):
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) & 0o022):
                raise CraftPhysicalVerificationError(
                    "El namespace populate no es privado.")
        if (identity(receipt["dataNamespaceIdentity"],
                     "dataNamespaceIdentity")
                != [namespace_stat.st_dev, namespace_stat.st_ino]
                or identity(receipt["inputRootIdentity"],
                            "inputRootIdentity")
                != [input_stat.st_dev, input_stat.st_ino]
                or identity(receipt["outputRootIdentity"],
                            "outputRootIdentity")
                != [output_stat.st_dev, output_stat.st_ino]
                or receipt["inputTreeSha256"]
                != canonical_sha256(plan["inputs"])
                or receipt["expectedOutputTreeSha256"]
                != canonical_sha256(plan["expectedOutputs"])):
            raise CraftPhysicalVerificationError(
                "El receipt populate no liga el árbol físico.")
        body = {key: receipt[key] for key in keys
                if key != "populateReceiptSha256"}
        if (not isinstance(receipt["populateReceiptSha256"], str)
                or canonical_sha256(body)
                != receipt["populateReceiptSha256"]):
            raise CraftPhysicalVerificationError(
                "populateReceiptSha256 no liga el receipt local.")

    def _verify_materialization_forget_files(
            self, challenge, plan, forget_receipt):
        plan = self._materialization_plan(plan)
        raw_input_root = Path(os.path.abspath(plan["inputRoot"]))
        raw_output_root = Path(os.path.abspath(plan["outputRoot"]))
        self._assert_population_paths(
            challenge.binding, raw_input_root, raw_output_root)
        input_root = self._safe_root(plan["inputRoot"], must_exist=False)
        output_root = self._safe_root(plan["outputRoot"], must_exist=False)
        if os.path.lexists(input_root) or os.path.lexists(output_root):
            raise CraftPhysicalVerificationError(
                "Forget materialization incompleto.")
        evidence = challenge.evidence
        tombstone = {
            "schemaVersion": 1,
            "installationId": challenge.binding["installationId"],
            "storageDomainId": challenge.binding["storageDomainId"],
            "intentId": challenge.binding["intentId"],
            "populationGenerationId":
                challenge.binding["populationGenerationId"],
            "namespaceId": challenge.binding["namespaceId"],
            "planSha256": evidence["planSha256"],
        }
        forgotten = {**tombstone,
                     "tombstoneSha256": canonical_sha256(tombstone),
                     "dataNamespaceAbsent": True}
        journal_fd = self._open_materialization_journal(challenge.binding)
        try:
            local_tombstone = self._read_materialization_marker(
                journal_fd, "tombstone.json")
            local_forgotten = self._read_materialization_marker(
                journal_fd, "forgotten.json")
        finally:
            os.close(journal_fd)
        if (local_tombstone != tombstone or local_forgotten != forgotten
                or forget_receipt != forgotten
                or canonical_sha256(tombstone)
                != evidence.get("tombstoneSha256")
                or canonical_sha256(forgotten)
                != evidence.get("journalEntrySha256")
                or canonical_sha256({"inputs": plan["inputs"],
                                     "expectedOutputs":
                                         plan["expectedOutputs"]})
                != evidence.get("beforeTreeSha256")):
            raise CraftPhysicalVerificationError(
                "El tombstone materialization diverge.")

    @staticmethod
    def _assert_population_paths(binding: dict, input_root: Path,
                                 output_root: Path) -> None:
        namespace_root = input_root.parent
        suffix = (
            binding["installationId"], binding["storageDomainId"],
            binding["dispatchId"], binding["populationGenerationId"],
            binding["namespaceId"])
        if (output_root.parent != namespace_root
                or tuple(namespace_root.parts[-len(suffix):]) != suffix
                or input_root.name != "inputs"
                or output_root.name != "outputs"):
            raise CraftPhysicalVerificationError(
                "Los roots materialization no ligan la generación física.")

    def _expected_local_plan(self, binding: dict, plan: dict,
                             plan_sha256: str) -> dict:
        namespace_root = Path(plan["inputRoot"]).parent
        journal_root = self._journal.joinpath(
            binding["installationId"], binding["storageDomainId"],
            binding["dispatchId"], binding["populationGenerationId"],
            binding["namespaceId"])
        paths = {
            "lockPath": journal_root / "lock",
            "planPath": journal_root / "plan.json",
            "populatedPath": journal_root / "populated.json",
            "finalizedPath": journal_root / "finalized.json",
            "tombstonePath": journal_root / "tombstone.json",
            "forgottenPath": journal_root / "forgotten.json",
        }
        return {
            "schemaVersion": 1,
            "installationId": binding["installationId"],
            "storageDomainId": binding["storageDomainId"],
            "ownerUserId": binding["ownerUserId"],
            "attemptId": binding["attemptId"],
            "intentId": binding["intentId"],
            "populationGenerationId": binding["populationGenerationId"],
            "namespaceId": binding["namespaceId"],
            "dispatchId": binding["dispatchId"],
            "requestSha256": binding["requestSha256"],
            "populationFenceSha256": binding["populationFenceSha256"],
            "dataNamespaceRoot": str(namespace_root),
            "inputRoot": plan["inputRoot"],
            "outputRoot": plan["outputRoot"],
            "journalRoot": str(journal_root),
            **{name: str(path) for name, path in paths.items()},
            "pendingPaths": [
                str(paths[name].with_name(f".{paths[name].name}.pending"))
                for name in ("planPath", "populatedPath", "finalizedPath",
                             "tombstonePath", "forgottenPath")],
            "inputs": plan["inputs"],
            "expectedOutputs": plan["expectedOutputs"],
            "profile": plan["profile"],
            "controlDocument": plan["controlDocument"],
            "limits": plan["limits"],
            "planSha256": plan_sha256,
        }

    def _open_materialization_journal(self, binding: dict) -> int:
        parts = tuple(_uuid(binding[name], name) for name in (
            "installationId", "storageDomainId", "dispatchId",
            "populationGenerationId", "namespaceId"))
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
        try:
            current = os.open(self._journal, flags)
        except OSError:
            raise CraftPhysicalVerificationError(
                "Journal materialization inseguro.") from None
        try:
            root = os.fstat(current)
            if ((root.st_dev, root.st_ino) != self._journal_identity
                    or root.st_uid != os.geteuid()
                    or stat.S_IMODE(root.st_mode) & 0o022):
                raise CraftPhysicalVerificationError(
                    "Journal materialization inseguro.")
            for part in parts:
                child = os.open(part, flags, dir_fd=current)
                info = os.fstat(child)
                if (not stat.S_ISDIR(info.st_mode)
                        or info.st_uid != os.geteuid()
                        or stat.S_IMODE(info.st_mode) & 0o022):
                    os.close(child)
                    raise CraftPhysicalVerificationError(
                        "Journal materialization inseguro.")
                os.close(current)
                current = child
            return current
        except BaseException:
            os.close(current)
            raise

    @staticmethod
    def _read_materialization_marker(directory_fd: int, name: str) -> dict:
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                         dir_fd=directory_fd)
        except OSError:
            raise CraftPhysicalVerificationError(
                "Falta un marker materialization seguro.") from None
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode)
                    or before.st_uid != os.geteuid()
                    or stat.S_IMODE(before.st_mode) != 0o600
                    or before.st_nlink != 1):
                raise CraftPhysicalVerificationError(
                    "Marker materialization inseguro.")
            body = bytearray()
            while len(body) <= 8 * 1024 * 1024:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                body.extend(chunk)
            after = os.fstat(fd)
            entry = os.stat(name, dir_fd=directory_fd,
                            follow_symlinks=False)
            if (len(body) > 8 * 1024 * 1024
                    or (before.st_dev, before.st_ino, before.st_size)
                    != (after.st_dev, after.st_ino, after.st_size)
                    or (after.st_dev, after.st_ino)
                    != (entry.st_dev, entry.st_ino)):
                raise CraftPhysicalVerificationError(
                    "Marker materialization inestable.")
        finally:
            os.close(fd)
        try:
            value = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise CraftPhysicalVerificationError(
                "Marker materialization no canónico.") from None
        canonical = json.dumps(value, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":"),
                               allow_nan=False).encode()
        if not isinstance(value, dict) or canonical != bytes(body):
            raise CraftPhysicalVerificationError(
                "Marker materialization no canónico.")
        return value

    def _verify_forget(self, challenge, *, lease_token,
                       terminal_status=None):
        proof = self._launcher_proof(challenge)
        input_root = self._safe_root(proof["inputRoot"], must_exist=False)
        output_root = self._safe_root(proof["outputRoot"], must_exist=False)
        # Path.exists() follows links and returns False for a dangling symlink.
        # Any remaining directory entry, including a dangling symlink, means
        # the physical forget is incomplete.
        if os.path.lexists(input_root) or os.path.lexists(output_root):
            raise CraftPhysicalVerificationError("Forget físico incompleto.")
        evidence = challenge.evidence
        materialization = {
            "inputRoot": proof["inputRoot"], "outputRoot": proof["outputRoot"],
            "inputs": proof["inputs"],
            "expectedOutputs": proof["expectedOutputs"],
            "limits": proof["limits"],
        }
        if (canonical_sha256(materialization)
                != evidence["materializationSha256"]
                or canonical_sha256({"inputs": proof["inputs"],
                                     "expectedOutputs": proof["expectedOutputs"]})
                != evidence["beforeTreeSha256"]):
            raise CraftPhysicalVerificationError("Árbol previo divergente.")
        if terminal_status is None:
            tombstone = {"schemaVersion": 2, "phase": "prestart_forget",
                         "dispatchId": challenge.binding["dispatchId"],
                         "requestSha256": challenge.binding["requestSha256"],
                         "leaseToken": lease_token}
            journal = {"schemaVersion": 1, "action": "forget",
                       "attemptId": challenge.binding["attemptId"],
                       "leaseToken": lease_token}
        else:
            tombstone = {"schemaVersion": 2, "phase": "terminal_forget",
                         "dispatchId": challenge.binding["dispatchId"],
                         "terminalStatus": terminal_status,
                         "runtimeLeaseToken": lease_token}
            journal = {"schemaVersion": 1, "action": "terminal_forget",
                       "attemptId": challenge.binding["attemptId"],
                       "runtimeLeaseToken": lease_token}
        if (canonical_sha256(tombstone) != evidence["tombstoneSha256"]
                or canonical_sha256(journal)
                != evidence["journalEntrySha256"]):
            raise CraftPhysicalVerificationError("Tombstone físico divergente.")
        self._write_journal(challenge.challenge_id, journal)

    def _write_journal(self, challenge_id: str, value: dict) -> None:
        challenge_id = _uuid(challenge_id, "challengeId")
        target_name = f"{challenge_id}.json"
        temporary_name = f".{challenge_id}.{uuid4().hex}.tmp"
        data = json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode()
        directory_flags = (os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
                           | os.O_NOFOLLOW)
        try:
            directory_fd = os.open(self._journal, directory_flags)
        except OSError:
            raise CraftPhysicalVerificationError(
                "Directorio journal físico inseguro.") from None
        temporary_created = False
        try:
            directory_stat = os.fstat(directory_fd)
            if (not stat.S_ISDIR(directory_stat.st_mode)
                    or directory_stat.st_uid != os.geteuid()
                    or stat.S_IMODE(directory_stat.st_mode) & 0o022
                    or (directory_stat.st_dev, directory_stat.st_ino)
                    != self._journal_identity):
                raise CraftPhysicalVerificationError(
                    "Directorio journal físico inseguro.")
            if self._journal_matches(
                    directory_fd, target_name, data, missing_ok=True):
                os.fsync(directory_fd)
                return

            temporary_fd = None
            try:
                temporary_fd = os.open(
                    temporary_name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                    | os.O_CLOEXEC,
                    0o600, dir_fd=directory_fd)
                temporary_created = True
                temporary_stat = os.fstat(temporary_fd)
                self._assert_journal_file(temporary_stat)
                view = memoryview(data)
                while view:
                    written = os.write(temporary_fd, view)
                    if written <= 0:
                        raise OSError(errno.EIO, "short journal write")
                    view = view[written:]
                os.fsync(temporary_fd)
                final_stat = os.fstat(temporary_fd)
                self._assert_journal_file(final_stat)
                if (final_stat.st_dev, final_stat.st_ino) != (
                        temporary_stat.st_dev, temporary_stat.st_ino):
                    raise CraftPhysicalVerificationError(
                        "Journal físico inestable.")
            except CraftPhysicalVerificationError:
                raise
            except OSError:
                raise CraftPhysicalVerificationError(
                    "No se pudo crear el journal físico.") from None
            finally:
                if temporary_fd is not None:
                    os.close(temporary_fd)

            try:
                os.link(temporary_name, target_name,
                        src_dir_fd=directory_fd, dst_dir_fd=directory_fd,
                        follow_symlinks=False)
            except FileExistsError:
                self._unlink_journal_temporary(
                    directory_fd, temporary_name)
                temporary_created = False
                os.fsync(directory_fd)
                self._journal_matches(
                    directory_fd, target_name, data, missing_ok=False)
                return
            except OSError:
                self._unlink_journal_temporary(
                    directory_fd, temporary_name)
                temporary_created = False
                raise CraftPhysicalVerificationError(
                    "No se pudo publicar el journal físico.") from None

            # Persist the no-replace link before removing its private staging
            # name. A second directory fsync makes the cleanup durable too.
            os.fsync(directory_fd)
            self._journal_matches(
                directory_fd, target_name, data, missing_ok=False)
            self._unlink_journal_temporary(directory_fd, temporary_name)
            temporary_created = False
            os.fsync(directory_fd)
        except CraftPhysicalVerificationError:
            raise
        except OSError:
            raise CraftPhysicalVerificationError(
                "No se pudo persistir el journal físico.") from None
        finally:
            if temporary_created:
                try:
                    self._unlink_journal_temporary(
                        directory_fd, temporary_name)
                    os.fsync(directory_fd)
                except OSError:
                    pass
            os.close(directory_fd)

    @staticmethod
    def _assert_journal_file(file_stat) -> None:
        if (not stat.S_ISREG(file_stat.st_mode)
                or file_stat.st_uid != os.geteuid()
                or stat.S_IMODE(file_stat.st_mode) != 0o600):
            raise CraftPhysicalVerificationError(
                "Fichero journal físico inseguro.")

    def _journal_matches(self, directory_fd: int, name: str, data: bytes,
                         *, missing_ok: bool) -> bool:
        try:
            file_fd = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory_fd)
        except FileNotFoundError:
            if missing_ok:
                return False
            raise CraftPhysicalVerificationError(
                "Journal físico desaparecido.") from None
        except OSError:
            raise CraftPhysicalVerificationError(
                "Journal físico inseguro.") from None
        try:
            before = os.fstat(file_fd)
            self._assert_journal_file(before)
            observed = bytearray()
            while len(observed) <= len(data):
                chunk = os.read(file_fd, len(data) + 1 - len(observed))
                if not chunk:
                    break
                observed.extend(chunk)
            after = os.fstat(file_fd)
            entry = os.stat(name, dir_fd=directory_fd,
                            follow_symlinks=False)
            if ((before.st_dev, before.st_ino, before.st_size)
                    != (after.st_dev, after.st_ino, after.st_size)
                    or (after.st_dev, after.st_ino)
                    != (entry.st_dev, entry.st_ino)
                    or bytes(observed) != data):
                raise CraftPhysicalVerificationError(
                    "Journal físico divergente.")
            os.fsync(file_fd)
            return True
        except CraftPhysicalVerificationError:
            raise
        except OSError:
            raise CraftPhysicalVerificationError(
                "Journal físico inseguro.") from None
        finally:
            os.close(file_fd)

    @staticmethod
    def _unlink_journal_temporary(directory_fd: int, name: str) -> None:
        try:
            os.unlink(name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass

    def _verify_destinations(self, challenge):
        if self._storage is None:
            raise CraftPhysicalVerificationError(
                "StorageProofReader no está inyectado.")
        proof = challenge.proof
        if set(proof) != {"escrowManifest", "destinations"}:
            raise CraftPhysicalVerificationError("Proof storage no cerrado.")
        manifest = proof["escrowManifest"]
        destinations = proof["destinations"]
        if not isinstance(manifest, dict) or not isinstance(destinations, list):
            raise CraftPhysicalVerificationError("Proof storage no tipado.")
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, list) or len(artifacts) != len(destinations):
            raise CraftPhysicalVerificationError("Copy set incompleto.")
        observed = []
        for ordinal, (artifact, destination) in enumerate(
                zip(artifacts, destinations)):
            if (not isinstance(destination, dict)
                    or set(destination) != {"ordinal", "storageReceipt"}
                    or destination["ordinal"] != ordinal
                    or artifact.get("ordinal") != ordinal):
                raise CraftPhysicalVerificationError("Destino no ordinal.")
            receipt = destination["storageReceipt"]
            data = self._storage.read_destination(receipt)
            if (not isinstance(data, bytes)
                    or len(data) != artifact.get("byteSize")
                    or sha256(data).hexdigest() != artifact.get("sha256")):
                raise CraftPhysicalVerificationError("Destino físico divergente.")
            observed.append({"ordinal": ordinal, "byteSize": len(data),
                "sha256": sha256(data).hexdigest(),
                "destinationReceiptSha256": canonical_sha256(receipt)})
        if (observed != challenge.evidence["artifacts"]
                or canonical_sha256(observed)
                != challenge.evidence["copySetSha256"]):
            raise CraftPhysicalVerificationError("Copy set divergente.")


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftPhysicalVerificationError(f"{label} no es UUID.") from None
    if str(value) != parsed:
        raise CraftPhysicalVerificationError(f"{label} no es UUID canónico.")
    return parsed


def _safe_child(root: Path, relative: object) -> Path:
    if not isinstance(relative, str) or "\\" in relative:
        raise CraftPhysicalVerificationError("Ruta física no canónica.")
    part = PurePosixPath(relative)
    if part.is_absolute() or any(p in ("", ".", "..") for p in part.parts):
        raise CraftPhysicalVerificationError("Ruta física no segura.")
    result = root.joinpath(*part.parts)
    if result != Path(os.path.abspath(result)):
        raise CraftPhysicalVerificationError("Ruta física no segura.")
    return result


def _expected_input_directories(root: Path, inputs: list[dict]) -> set[Path]:
    expected: set[Path] = set()
    for item in inputs:
        relative = item.get("relativePath") if isinstance(item, dict) else None
        child = _safe_child(root, relative)
        parent = child.parent
        while parent != root:
            if root not in parent.parents:
                raise CraftPhysicalVerificationError("Ruta física no segura.")
            expected.add(parent)
            parent = parent.parent
    return expected


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _secure_file_sha256(path: Path, expected_stat) -> str:
    """Hash one already-lstatted input without following or swapping it."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        raise CraftPhysicalVerificationError("Input materialization inseguro.") from None
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode)
                or before.st_uid != os.geteuid()
                or stat.S_IMODE(before.st_mode) != 0o600
                or before.st_nlink != 1
                or (before.st_dev, before.st_ino, before.st_size)
                != (expected_stat.st_dev, expected_stat.st_ino,
                    expected_stat.st_size)):
            raise CraftPhysicalVerificationError(
                "Input materialization inseguro.")
        digest = sha256()
        while True:
            block = os.read(fd, 1024 * 1024)
            if not block:
                break
            digest.update(block)
        after = os.fstat(fd)
        entry = os.stat(path, follow_symlinks=False)
        if ((before.st_dev, before.st_ino, before.st_size)
                != (after.st_dev, after.st_ino, after.st_size)
                or (after.st_dev, after.st_ino)
                != (entry.st_dev, entry.st_ino)):
            raise CraftPhysicalVerificationError(
                "Input materialization cambió durante la lectura.")
        return digest.hexdigest()
    finally:
        os.close(fd)
