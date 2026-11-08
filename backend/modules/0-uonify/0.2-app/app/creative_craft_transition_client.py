"""Typed boundary for installed Craft transition routines.

The client never constructs SQL, opens a connection, commits, or rolls back.
An installation adapter receives the caller's existing transaction and the
exact SECURITY DEFINER binding selected from a closed operation allowlist.
"""

from dataclasses import dataclass
import json
import re
from typing import Literal, Protocol
from uuid import UUID

TransitionOperation = Literal[
    "materialization_begin", "materialization_bind_plan",
    "materialization_claim_population", "materialization_bind_population",
    "materialization_release_population", "materialization_renew_population",
    "issue_materialization_populate_challenge", "materialization_finalize",
    "materialization_claim_finalize", "materialization_release_finalize",
    "materialization_claim_cleanup", "materialization_commit_cleanup",
    "materialization_release_cleanup",
    "issue_materialization_forget_challenge",
    "materialization_complete_cleanup", "runtime_enqueue",
    "recover_expired_prestart",
    "preparer_claim_compensation", "preparer_release_compensation",
    "ack_claim", "ack_release", "escrow_enqueue", "escrow_shortlist",
    "escrow_claim", "escrow_schedule_cleanup", "escrow_defer_cleanup",
    "escrow_release", "issue_reserve_challenge",
    "issue_prestart_forget_challenge", "issue_terminal_forget_challenge",
    "issue_adopt_copy_challenge", "complete_reservation",
    "complete_compensation", "complete_ack", "complete_adoption",
    "complete_cleanup",
]
ArgumentKind = Literal["uuid", "integer", "jsonb"]

ALLOWED_OPERATIONS: tuple[TransitionOperation, ...] = (
    "materialization_begin", "materialization_bind_plan",
    "materialization_claim_population", "materialization_bind_population",
    "materialization_release_population", "materialization_renew_population",
    "issue_materialization_populate_challenge", "materialization_finalize",
    "materialization_claim_finalize", "materialization_release_finalize",
    "materialization_claim_cleanup", "materialization_commit_cleanup",
    "materialization_release_cleanup",
    "issue_materialization_forget_challenge",
    "materialization_complete_cleanup", "runtime_enqueue",
    "recover_expired_prestart",
    "preparer_claim_compensation", "preparer_release_compensation",
    "ack_claim", "ack_release", "escrow_enqueue", "escrow_shortlist",
    "escrow_claim", "escrow_schedule_cleanup", "escrow_defer_cleanup",
    "escrow_release", "issue_reserve_challenge",
    "issue_prestart_forget_challenge", "issue_terminal_forget_challenge",
    "issue_adopt_copy_challenge", "complete_reservation",
    "complete_compensation", "complete_ack", "complete_adoption",
    "complete_cleanup",
)
OPERATION_ARGUMENT_KINDS: dict[TransitionOperation, tuple[ArgumentKind, ...]] = {
    "materialization_begin": ("uuid", "uuid"),
    "materialization_bind_plan": ("uuid", "uuid", "uuid", "jsonb"),
    "materialization_claim_population": ("uuid", "uuid", "uuid"),
    "materialization_bind_population": (
        "uuid", "uuid", "uuid", "uuid", "jsonb"),
    "materialization_release_population": ("uuid", "uuid", "uuid", "uuid"),
    "materialization_renew_population": (
        "uuid", "uuid", "uuid", "uuid", "uuid"),
    "issue_materialization_populate_challenge": (
        "uuid", "uuid", "uuid", "uuid", "uuid"),
    "materialization_claim_finalize": (
        "uuid", "uuid", "uuid", "uuid", "uuid"),
    "materialization_release_finalize": (
        "uuid", "uuid", "uuid", "uuid", "uuid", "uuid"),
    "materialization_finalize": (
        "uuid", "uuid", "uuid", "uuid", "uuid", "uuid"),
    "materialization_claim_cleanup": ("uuid", "uuid"),
    "materialization_commit_cleanup": ("uuid", "uuid", "uuid"),
    "materialization_release_cleanup": ("uuid", "uuid", "uuid"),
    "issue_materialization_forget_challenge": ("uuid", "uuid", "uuid"),
    "materialization_complete_cleanup": ("uuid", "uuid", "uuid", "uuid"),
    "runtime_enqueue": ("uuid", "uuid"),
    "recover_expired_prestart": ("uuid", "uuid", "integer"),
    "preparer_claim_compensation": ("uuid", "uuid"),
    "preparer_release_compensation": ("uuid", "uuid", "uuid"),
    "ack_claim": ("uuid", "uuid"),
    "ack_release": ("uuid", "uuid", "uuid"),
    "escrow_enqueue": ("uuid", "uuid", "uuid"),
    "escrow_shortlist": ("uuid",),
    "escrow_claim": ("uuid", "uuid"),
    "escrow_schedule_cleanup": ("uuid", "uuid", "integer"),
    "escrow_defer_cleanup": ("uuid", "uuid", "integer"),
    "escrow_release": ("uuid", "uuid", "integer", "uuid"),
    "issue_reserve_challenge": ("uuid", "uuid"),
    "issue_prestart_forget_challenge": ("uuid", "uuid", "uuid"),
    "issue_terminal_forget_challenge": ("uuid", "uuid", "uuid"),
    "issue_adopt_copy_challenge": ("uuid", "uuid", "integer", "uuid"),
    "complete_reservation": ("uuid", "uuid", "uuid"),
    "complete_compensation": ("uuid", "uuid", "uuid", "uuid"),
    "complete_ack": ("uuid", "uuid", "uuid", "uuid"),
    "complete_adoption": ("uuid", "uuid", "integer", "uuid", "uuid"),
    "complete_cleanup": ("uuid", "uuid", "integer", "uuid"),
}
IDENTIFIER = re.compile(r"[a-z_][a-z0-9_]{0,62}\Z")


class CraftTransitionClientError(RuntimeError):
    """The installation binding or requested transition is not authorized."""


@dataclass(frozen=True)
class InstalledTransitionRoutine:
    operation: TransitionOperation
    routine_name: str
    argument_names: tuple[str, ...]
    argument_kinds: tuple[ArgumentKind, ...]
    security_definer: bool

    def validate(self) -> None:
        if self.operation not in ALLOWED_OPERATIONS:
            raise CraftTransitionClientError("Operación fuera de allowlist.")
        if not isinstance(self.routine_name, str) or not IDENTIFIER.fullmatch(
                self.routine_name):
            raise CraftTransitionClientError("Nombre instalado no canónico.")
        if (not isinstance(self.argument_names, tuple)
                or not isinstance(self.argument_kinds, tuple)
                or len(self.argument_names) != len(self.argument_kinds)
                or len(set(self.argument_names)) != len(self.argument_names)):
            raise CraftTransitionClientError("Firma instalada incoherente.")
        if any(not isinstance(name, str) or not IDENTIFIER.fullmatch(name)
               for name in self.argument_names):
            raise CraftTransitionClientError("Argumento instalado no canónico.")
        if self.argument_kinds != OPERATION_ARGUMENT_KINDS[self.operation]:
            raise CraftTransitionClientError(
                "Firma instalada no coincide con la operación permitida.")
        if self.security_definer is not True:
            raise CraftTransitionClientError(
                "La rutina instalada no acredita SECURITY DEFINER.")


@dataclass(frozen=True)
class CraftTransitionInstallationBinding:
    """Server-derived installation metadata, never request-authored."""

    installation_id: str
    database_name: str
    schema_name: str
    desired_active: bool
    routines: tuple[InstalledTransitionRoutine, ...]
    storage_domain_id: str | None = None

    def validate(self) -> None:
        _canonical_uuid(self.installation_id, "installationId")
        if self.storage_domain_id is None:
            if self.desired_active:
                raise CraftTransitionClientError(
                    "La instalación activa exige storageDomainId server-owned.")
        else:
            _canonical_uuid(self.storage_domain_id, "storageDomainId")
        for label, value in (("databaseName", self.database_name),
                             ("schemaName", self.schema_name)):
            if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
                raise CraftTransitionClientError(f"{label} no es canónico.")
        if type(self.desired_active) is not bool:
            raise CraftTransitionClientError("desiredActive no es booleano.")
        if not isinstance(self.routines, tuple):
            raise CraftTransitionClientError("routines no es una tupla.")
        operations = []
        for routine in self.routines:
            if not isinstance(routine, InstalledTransitionRoutine):
                raise CraftTransitionClientError("Rutina instalada no tipada.")
            routine.validate()
            operations.append(routine.operation)
        if len(operations) != len(set(operations)):
            raise CraftTransitionClientError("Operación instalada duplicada.")

    def routine_for(
            self, operation: TransitionOperation) -> InstalledTransitionRoutine:
        self.validate()
        if operation not in ALLOWED_OPERATIONS:
            raise CraftTransitionClientError("Operación fuera de allowlist.")
        matches = tuple(r for r in self.routines if r.operation == operation)
        if len(matches) != 1:
            raise CraftTransitionClientError(
                "La operación no tiene un binding instalado único.")
        return matches[0]


@dataclass(frozen=True)
class CraftTransitionInvocation:
    operation: TransitionOperation
    arguments: tuple[tuple[str, object], ...]

    def values_for(self, routine: InstalledTransitionRoutine) -> tuple[object, ...]:
        if self.operation != routine.operation:
            raise CraftTransitionClientError("Operación y rutina no coinciden.")
        if (not isinstance(self.arguments, tuple)
                or any(not isinstance(item, tuple) or len(item) != 2
                       or not isinstance(item[0], str)
                       for item in self.arguments)):
            raise CraftTransitionClientError("Argumentos no tipados.")
        names = tuple(name for name, _ in self.arguments)
        if names != routine.argument_names:
            raise CraftTransitionClientError(
                "Argumentos incompletos, extra o fuera de orden.")
        values = tuple(value for _, value in self.arguments)
        for name, kind, value in zip(
                routine.argument_names, routine.argument_kinds, values):
            if kind == "uuid":
                _canonical_uuid(value, name)
            elif kind == "integer":
                if type(value) is not int or value < 1:
                    raise CraftTransitionClientError(
                        f"{name} debe ser un entero positivo.")
            elif not isinstance(value, dict) or _canonical_json(value) is None:
                raise CraftTransitionClientError(
                    f"{name} debe ser un objeto JSON canónico.")
        return values


class CraftTransitionSecurityDefinerExecutor(Protocol):
    def invoke_security_definer(
            self, *, connection: object,
            installation: CraftTransitionInstallationBinding,
            routine: InstalledTransitionRoutine,
            arguments: tuple[object, ...]) -> object: ...


class CraftTransitionClient:
    def __init__(self, installation: CraftTransitionInstallationBinding,
                 executor: CraftTransitionSecurityDefinerExecutor):
        installation.validate()
        if executor is None or not callable(
                getattr(executor, "invoke_security_definer", None)):
            raise CraftTransitionClientError("Executor instalado no válido.")
        self._installation = installation
        self._executor = executor

    @property
    def ready_for_all_operations(self) -> bool:
        """True only for one active installation with the complete 116 API."""
        return (self._installation.desired_active is True
                and {routine.operation for routine in self._installation.routines}
                == set(ALLOWED_OPERATIONS))

    @property
    def installation_id(self) -> str:
        """Server-derived identity shared with the physical verifier."""
        return self._installation.installation_id

    @property
    def storage_domain_id(self) -> str | None:
        """Server-owned physical domain; mandatory before activation."""
        return self._installation.storage_domain_id

    def invoke(self, connection: object,
               invocation: CraftTransitionInvocation) -> object:
        if connection is None:
            raise CraftTransitionClientError(
                "La transición exige una conexión transaccional existente.")
        if not isinstance(invocation, CraftTransitionInvocation):
            raise CraftTransitionClientError("Invocación no tipada.")
        if self._installation.desired_active is not True:
            raise CraftTransitionClientError(
                "La instalación Craft permanece inactiva.")
        routine = self._installation.routine_for(invocation.operation)
        values = invocation.values_for(routine)
        return self._executor.invoke_security_definer(
            connection=connection, installation=self._installation,
            routine=routine, arguments=values)


def transition(operation: TransitionOperation, **arguments: object
               ) -> CraftTransitionInvocation:
    """Build an invocation preserving the caller's explicit argument order."""
    if operation not in ALLOWED_OPERATIONS:
        raise CraftTransitionClientError("Operación fuera de allowlist.")
    return CraftTransitionInvocation(operation, tuple(arguments.items()))


def enqueue_craft_runtime_reconciliation(
        connection: object, client: CraftTransitionClient,
        user_id: str, attempt_id: str) -> bool:
    """Append the Craft runtime row through the installed 114 transition."""
    if not isinstance(client, CraftTransitionClient):
        raise CraftTransitionClientError("Cliente de transición no tipado.")
    value = client.invoke(connection, transition(
        "runtime_enqueue", user_id=user_id, attempt_id=attempt_id))
    if type(value) is not bool:
        raise CraftTransitionClientError(
            "runtime_enqueue no devolvió un booleano cerrado.")
    return value


def recover_craft_expired_prestart(
        connection: object, client: CraftTransitionClient,
        user_id: str, attempt_id: str, max_claims: int) -> dict:
    """Atomically reject stale reserve evidence and recover its attempt."""
    if not isinstance(client, CraftTransitionClient):
        raise CraftTransitionClientError("Cliente de transición no tipado.")
    value = client.invoke(connection, transition(
        "recover_expired_prestart", user_id=user_id, attempt_id=attempt_id,
        max_claims=max_claims))
    if (not isinstance(value, dict)
            or set(value) != {"outcome", "terminalStatus"}
            or value.get("outcome") not in (
                "queued", "failed", "cleanup_required")
            or value.get("terminalStatus") not in (
                "cancelled", "failed", "pending")
            or ((value.get("outcome"), value.get("terminalStatus")) not in {
                ("queued", "cancelled"), ("failed", "failed"),
                ("cleanup_required", "pending"),
            })):
        raise CraftTransitionClientError(
            "recover_expired_prestart no devolvió un resultado cerrado.")
    return value


def _canonical_uuid(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise CraftTransitionClientError(f"{label} no es UUID canónico.")
    try:
        canonical = str(UUID(value))
    except (TypeError, ValueError, AttributeError):
        raise CraftTransitionClientError(f"{label} no es UUID canónico.") from None
    if value != canonical:
        raise CraftTransitionClientError(f"{label} no es UUID canónico.")
    return value


def _canonical_json(value: dict) -> str | None:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        return None
