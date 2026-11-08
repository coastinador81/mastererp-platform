"""PostgreSQL authority for the inactive, server-owned Craft launcher.

Preparation is deliberately separate from reserve, provider-start and dispatch.
No database transaction remains open while a Unix socket or sandbox is used.
"""

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
from typing import Callable, Protocol
from uuid import UUID

from .creative_craft_attempt_authority import persisted_craft_context
from .creative_craft_authority import load_craft_attempt_authority
from .creative_craft_launcher_authority import (
    CraftInputBinding, CraftLauncherAuthority, CraftLauncherProfile,
    CraftOutputCleanupAuthorization, CraftSandboxLimits,
    build_synthetic_authority,
)
from .creative_craft_launcher_contract import (
    CraftLauncherContractError, CraftLauncherRequest,
    build_craft_launcher_request,
)
from .creative_execution_admission import revalidate_admission_claims
from .creative_execution_coordinator import CreativeAttemptClaim
from .creative_craft_transition_client import (
    CraftTransitionClient, CraftTransitionClientError, transition,
)


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError):
        raise CraftLauncherContractError(
            "La autoridad PostgreSQL del launcher no es canónica.") from None


def _canonical_sha256(value: object) -> str:
    return sha256(_canonical_bytes(value)).hexdigest()


def _roots_overlap(left: str | Path, right: str | Path) -> bool:
    """Compare staging ownership lexically without filesystem I/O."""
    left_path = Path(os.path.abspath(os.fspath(left)))
    right_path = Path(os.path.abspath(os.fspath(right)))
    return (left_path == right_path or left_path in right_path.parents
            or right_path in left_path.parents)


@dataclass(frozen=True)
class CraftLauncherMaterialization:
    """Only the filesystem artifacts produced by the staging component."""

    input_root: Path
    output_root: Path
    inputs: tuple[CraftInputBinding, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "input_root", Path(self.input_root))
        object.__setattr__(self, "output_root", Path(self.output_root))
        if (not isinstance(self.inputs, tuple)
                or any(not isinstance(item, CraftInputBinding)
                       for item in self.inputs)):
            raise CraftLauncherContractError(
                "La materialización del launcher no es cerrada.")


class CraftLauncherProfileResolver(Protocol):
    def resolve(self, engine: str, version: str,
                operation: str) -> CraftLauncherProfile:
        ...


class CraftLauncherMaterializer(Protocol):
    def prepare(
        self, request: CraftLauncherRequest, *, job: object, adapter: object,
        profile: CraftLauncherProfile, control_document: dict,
        expected_outputs: tuple[str, ...],
    ) -> CraftLauncherMaterialization:
        """Atomically publish one private <dispatch>/<uuid>/inputs|outputs pair."""
        ...


class CraftLauncherPhysicalReceipts(Protocol):
    """I/O verifier boundary; implementations attest before returning an ID."""

    def verify_reserve(self, *, claim: CreativeAttemptClaim,
                       request: CraftLauncherRequest,
                       materialization: CraftLauncherMaterialization,
                       launcher_receipt: dict) -> str: ...

    def verify_prestart_forget(
            self, *, claim: CreativeAttemptClaim,
            compensation: "CraftLauncherPrestartCompensation",
            launcher_receipt: dict,
            perform_forget: Callable[[], None]) -> str: ...

    def issue_terminal_forget(
            self, *, claim: CreativeAttemptClaim,
            runtime_lease_token: str,
            request: CraftLauncherRequest) -> None: ...

    def verify_terminal_forget(
            self, *, claim: CreativeAttemptClaim, terminal_status: str,
            runtime_lease_token: str, request: CraftLauncherRequest,
            launcher_receipt: dict) -> str: ...

    def discard(self, materialization: CraftLauncherMaterialization) -> None:
        """Idempotently remove both launcher-owned staging roots."""
        ...


@dataclass(frozen=True)
class CraftLauncherRecoveryBinding:
    authority: CraftLauncherAuthority
    attempt_status: str
    provider_started: bool
    provider_returned: bool
    runtime_terminal_status: str | None
    runtime_outbox_status: str | None
    candidate_storage_state: str | None
    candidate_adoption_durable: bool = False


@dataclass(frozen=True)
class CraftLauncherPrestartCompensation:
    """One fenced cleanup lease for an unconfirmed prepared reservation."""

    request: CraftLauncherRequest
    lease_token: str | None
    materialization: CraftLauncherMaterialization
    completed_receipt: dict | None = None


def _profile_sha256(profile: CraftLauncherProfile) -> str:
    return _canonical_sha256(profile.canonical())


def _claim_uuid(claim: CreativeAttemptClaim, field: str) -> str:
    value = getattr(claim, field, None)
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftLauncherContractError("El claim Craft no es canónico.") from None
    if value != parsed:
        raise CraftLauncherContractError("El claim Craft no es canónico.")
    return parsed


def _canonical_uuid_value(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftLauncherContractError(f"{label} no es UUID canónico.") from None
    if str(value) != parsed:
        raise CraftLauncherContractError(f"{label} no es UUID canónico.")
    return parsed


def _validate_claim(claim: CreativeAttemptClaim) -> None:
    if (not isinstance(claim, CreativeAttemptClaim)
            or claim.kind != "craft" or not claim.provider_call
            or claim.execution_authorized or claim.publication_authorized):
        raise CraftLauncherContractError(
            "El claim no autoriza preparar el launcher Craft.")
    for field in ("user_id", "job_id", "step_id", "attempt_id", "lease_token"):
        _claim_uuid(claim, field)


def _control_document(job, adapter) -> dict:
    return {
        "schemaVersion": 1,
        "jobId": job.job_id,
        "jobBindingSha256": adapter.job_binding_sha256,
        "adapterPlanSha256": adapter.plan_sha256,
        "commands": [
            {"id": command.id, "params": command.params}
            for command in adapter.commands
        ],
        "nativeProjectRelativePath": adapter.native_project_relative_path,
        "outputRelativePath": adapter.output_relative_path,
    }


def _safe_output(value: object) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise CraftLauncherContractError("Una salida Craft no es segura.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise CraftLauncherContractError("Una salida Craft no es segura.")
    return value


def _expected_outputs(job, adapter) -> tuple[str, ...]:
    project = _safe_output(adapter.native_project_relative_path)
    output = _safe_output(adapter.output_relative_path)
    if "%" not in output:
        values = (project, output)
    else:
        recipe = job.plan.snapshot.get("recipe")
        declared = recipe.get("output") if isinstance(recipe, dict) else None
        count = declared.get("frameCount") if isinstance(declared, dict) else None
        pattern = declared.get("relativePattern") if isinstance(declared, dict) else None
        if (pattern != output or output.count("%05d") != 1
                or type(count) is not int or not 1 <= count <= 4095):
            raise CraftLauncherContractError(
                "La secuencia de salida no puede cerrarse para el launcher.")
        values = (project,) + tuple(
            output.replace("%05d", f"{index:05d}") for index in range(count))
    if len(values) != len(set(values)) or len(values) > 4096:
        raise CraftLauncherContractError(
            "Las salidas esperadas del launcher no son únicas.")
    return values


def _limits(job) -> CraftSandboxLimits:
    source = job.limits
    if source.network_access or source.google_credentials:
        raise CraftLauncherContractError(
            "El launcher aislado no admite red ni credenciales Google.")
    return CraftSandboxLimits(
        source.cpu_cores, source.memory_bytes, source.wall_seconds,
        source.output_bytes,
    )


def _validate_materialized_inputs(job, materialized: CraftLauncherMaterialization
                                  ) -> None:
    by_asset: dict[str, list[CraftInputBinding]] = {}
    for binding in materialized.inputs:
        by_asset.setdefault(binding.asset_id, []).append(binding)
    if set(by_asset) != {item.asset_id for item in job.inputs}:
        raise CraftLauncherContractError(
            "Los inputs materializados no coinciden con el job Craft.")
    for item in job.inputs:
        bindings = by_asset[item.asset_id]
        if any(binding.owner_user_id != item.owner_user_id for binding in bindings):
            raise CraftLauncherContractError(
                "Un input materializado cruza la cuenta propietaria.")
        if item.kind != "image_sequence":
            if (len(bindings) != 1 or bindings[0].relative_path != item.mount_name
                    or bindings[0].expected_sha256 != item.sha256
                    or bindings[0].expected_bytes != item.byte_size):
                raise CraftLauncherContractError(
                    "Un input materializado no coincide con su snapshot.")
            continue
        receipt = item.materialization
        mount = receipt.get("mountName") if isinstance(receipt, dict) else None
        first = (receipt.get("firstFrameRelativePath")
                 if isinstance(receipt, dict) else None)
        first_sha = (receipt.get("firstFrameSha256")
                     if isinstance(receipt, dict) else None)
        expected_first = f"{mount}/{first}" if mount and first else None
        if (not expected_first or not any(
                binding.relative_path == expected_first
                and binding.expected_sha256 == first_sha
                for binding in bindings)
                or any(not binding.relative_path.startswith(f"{mount}/")
                       for binding in bindings)):
            raise CraftLauncherContractError(
                "La secuencia materializada no coincide con su recibo.")


def _validate_materialization_namespace(
        request: CraftLauncherRequest,
        materialized: CraftLauncherMaterialization) -> None:
    """Require an atomic namespace where partial root overlap is impossible."""
    input_root = materialized.input_root
    output_root = materialized.output_root
    if (not input_root.is_absolute() or not output_root.is_absolute()
            or input_root != Path(os.path.abspath(os.fspath(input_root)))
            or output_root != Path(os.path.abspath(os.fspath(output_root)))
            or input_root.name != "inputs" or output_root.name != "outputs"
            or input_root.parent != output_root.parent
            or input_root.parent.parent.name != request.body["dispatchId"]):
        raise CraftLauncherContractError(
            "El staging Craft no pertenece a un namespace atómico del dispatch.")
    try:
        staging_id = str(UUID(input_root.parent.name))
    except (TypeError, ValueError, AttributeError):
        raise CraftLauncherContractError(
            "El staging Craft no tiene una identidad privada válida.") from None
    if staging_id != input_root.parent.name:
        raise CraftLauncherContractError(
            "El staging Craft no tiene una identidad privada canónica.")
    try:
        if (input_root.resolve(strict=True) != input_root
                or output_root.resolve(strict=True) != output_root
                or input_root.parent.resolve(strict=True) != input_root.parent):
            raise CraftLauncherContractError(
                "El namespace Craft atraviesa un enlace de staging.")
    except OSError:
        raise CraftLauncherContractError(
            "El namespace Craft no existe de forma íntegra.") from None


class PostgresCraftAuthorityResolver:
    """Prepare and resolve exact launcher authority without executing Craft."""

    def __init__(self, database, profile_resolver: CraftLauncherProfileResolver,
                 materializer: CraftLauncherMaterializer,
                 transitions: CraftTransitionClient | None = None,
                 physical_receipts: CraftLauncherPhysicalReceipts | None = None):
        self.database = database
        self.profile_resolver = profile_resolver
        self.materializer = materializer
        self.transitions = transitions
        self.physical_receipts = physical_receipts

    def _transition(self, connection, operation, **arguments):
        if not isinstance(self.transitions, CraftTransitionClient):
            raise CraftLauncherContractError(
                "La autoridad SQL Craft 114 no está inyectada.")
        try:
            return self.transitions.invoke(
                connection, transition(operation, **arguments))
        except CraftTransitionClientError as error:
            raise CraftLauncherContractError(str(error)) from error

    def _physical(self) -> CraftLauncherPhysicalReceipts:
        value = self.physical_receipts
        if value is None:
            raise CraftLauncherContractError(
                "El verificador físico Craft 114 no está inyectado.")
        return value

    def _resolve_profile(self, job) -> CraftLauncherProfile:
        resolver = getattr(self.profile_resolver, "resolve", None)
        if not callable(resolver):
            raise CraftLauncherContractError(
                "El resolver de perfiles Craft no es válido.")
        profile = resolver(job.engine.name, job.engine.version, job.operation)
        if (not isinstance(profile, CraftLauncherProfile)
                or profile.engine != job.engine.name
                or profile.version != job.engine.version
                or profile.operation != job.operation):
            raise CraftLauncherContractError(
                "El perfil no coincide con la autoridad Craft persistida.")
        return profile

    @staticmethod
    def _lock_live(c, claim: CreativeAttemptClaim, *, started: bool | None) -> dict:
        c.execute("SET LOCAL lock_timeout = '500ms'")
        c.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
            (f"uonify:account:{claim.user_id}",),
        )
        owner = c.execute(
            "SELECT * FROM users WHERE id=%s FOR NO KEY UPDATE",
            (claim.user_id,),
        ).fetchone()
        if not owner or owner.get("deletion_requested_at") is not None:
            raise CraftLauncherContractError("La cuenta Craft ya no está activa.")
        c.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
            (f"uonify:craft-attempt:{claim.attempt_id}",),
        )
        revalidate_admission_claims(c, owner, UUID(claim.job_id))
        job_row = c.execute(
            """SELECT * FROM creative_execution_jobs
               WHERE user_id=%s AND id=%s FOR UPDATE""",
            (claim.user_id, claim.job_id),
        ).fetchone()
        step = c.execute(
            """SELECT * FROM creative_execution_steps
               WHERE user_id=%s AND job_id=%s AND step_id=%s FOR UPDATE""",
            (claim.user_id, claim.job_id, claim.step_id),
        ).fetchone()
        attempt = c.execute(
            """SELECT * FROM creative_execution_attempts
               WHERE user_id=%s AND id=%s FOR UPDATE""",
            (claim.user_id, claim.attempt_id),
        ).fetchone()
        now = c.execute("SELECT clock_timestamp() value").fetchone()["value"]
        expected_started = None if started is None else started
        if (not job_row or not step or not attempt
                or job_row["status"] != "running" or step["status"] != "running"
                or attempt["status"] != "running"
                or step["kind"] != "craft" or not step["provider_call"]
                or str(job_row["lease_token"]) != claim.lease_token
                or str(step["lease_token"]) != claim.lease_token
                or str(attempt["lease_token"]) != claim.lease_token
                or str(attempt["claim_lease_token"]) != claim.lease_token
                or min(job_row["lease_until"], step["lease_until"],
                       attempt["lease_until"]) <= now
                or str(attempt["job_id"]) != claim.job_id
                or str(attempt["step_id"]) != claim.step_id
                or attempt["attempt_no"] != claim.attempt_no
                or attempt["fence_epoch"] != claim.fence_epoch
                or attempt["admission_sha256"] != claim.admission_sha256
                or attempt["claim_set_sha256"] != claim.claim_set_sha256
                or attempt.get("craft_authority_bound_at") is None
                or attempt["provider_returned_at"] is not None
                or (expected_started is not None
                    and (attempt["provider_started_at"] is not None)
                    is not expected_started)
                or (expected_started is not None
                    and (step["provider_started_at"] is not None)
                    is not expected_started)):
            raise CraftLauncherContractError(
                "El lease Craft no autoriza esta fase del launcher.")
        row = load_craft_attempt_authority(c, claim.user_id, claim.attempt_id)
        if not row:
            raise CraftLauncherContractError(
                "Falta la autoridad Craft persistida.")
        return {**row, "_owner": owner}

    def _context(self, c, claim: CreativeAttemptClaim, *, started: bool | None):
        row = self._lock_live(c, claim, started=started)
        job, adapter = persisted_craft_context(row)
        profile = self._resolve_profile(job)
        request = build_craft_launcher_request(claim, row)
        return row, job, adapter, profile, request

    @staticmethod
    def _stored(c, request: CraftLauncherRequest, *, lock: bool = False):
        suffix = " FOR UPDATE" if lock else ""
        return c.execute(
            """SELECT * FROM creative_craft_launcher_reservations
               WHERE user_id=%s AND attempt_id=%s""" + suffix,
            (request.body["attempt"]["ownerUserId"],
             request.body["attempt"]["attemptId"]),
        ).fetchone()

    def _materialize(self, request, job, adapter, profile):
        expected = _expected_outputs(job, adapter)
        control = _control_document(job, adapter)
        prepare = getattr(self.materializer, "prepare", None)
        if not callable(prepare):
            raise CraftLauncherContractError(
                "El materializador Craft no es válido.")
        value = prepare(
            request, job=job, adapter=adapter, profile=profile,
            control_document=control, expected_outputs=expected,
        )
        if not isinstance(value, CraftLauncherMaterialization):
            raise CraftLauncherContractError(
                "El materializador Craft devolvió una forma no permitida.")
        try:
            _validate_materialization_namespace(request, value)
            _validate_materialized_inputs(job, value)
            authority = build_synthetic_authority(
                request, profile_id=profile.profile_id,
                control_document=control, input_root=value.input_root,
                output_root=value.output_root, inputs=value.inputs,
                expected_outputs=expected, limits=_limits(job),
            )
        except BaseException:
            discard = getattr(self.materializer, "discard", None)
            if not callable(discard):
                raise CraftLauncherContractError(
                    "El materializador no puede retirar staging rechazado.") from None
            # A returned materialization is still exclusively owned by this
            # prepare call until its authority is inserted below.  The
            # materializer contract makes discard atomic and idempotent.
            discard(value)
            raise
        return value, authority

    @staticmethod
    def _materialization_document(
            request: CraftLauncherRequest, profile: CraftLauncherProfile,
            authority: CraftLauncherAuthority) -> dict:
        """Closed bootstrap DTO; SQL re-derives every authority digest."""
        value = {
            "dispatchId": request.body["dispatchId"],
            "profile": profile.canonical(),
            "controlDocument": json.loads(authority.control_document),
            "inputRoot": str(authority.input_root),
            "outputRoot": str(authority.output_root),
            "inputs": [item.canonical() for item in authority.inputs],
            "expectedOutputs": list(authority.expected_outputs),
            "limits": authority.limits.canonical(),
        }
        if set(value) != {
                "dispatchId", "profile", "controlDocument", "inputRoot",
                "outputRoot", "inputs", "expectedOutputs", "limits"}:
            raise CraftLauncherContractError(
                "La materialización 114 no es cerrada.")
        return value

    @staticmethod
    def _materialization_from_row(stored: dict) -> CraftLauncherMaterialization:
        if not stored:
            raise CraftLauncherContractError(
                "Falta el staging preparado del launcher.")
        try:
            bindings = tuple(CraftInputBinding(
                item["assetId"], item["ownerUserId"], item["relativePath"],
                item["expectedSha256"], item["expectedBytes"],
            ) for item in stored["inputs"])
            return CraftLauncherMaterialization(
                Path(stored["input_root"]), Path(stored["output_root"]), bindings)
        except (KeyError, TypeError, ValueError):
            raise CraftLauncherContractError(
                "El staging preparado no conserva una forma cerrada.") from None

    def prepare_start(self, claim: CreativeAttemptClaim) -> CraftLauncherRequest:
        """Fail closed until the inactive 116 materialization lane is wired."""
        _validate_claim(claim)
        # Migration 116 revoked the legacy post-I/O append boundary.  This
        # resolver deliberately has no 116 orchestration wiring yet, so it
        # must reject before opening PostgreSQL, resolving context, touching
        # staging, invoking a transition, or reaching a provider.
        raise CraftLauncherContractError(
            "La preparación Craft 114 está sustituida por el carril "
            "materialization 116 todavía inactivo.")

    def load_materialization_context(self, claim: CreativeAttemptClaim):
        """Rebuild the private 116/117 plan inputs without enabling start.

        The caller receives only already-existing domain objects.  This read
        boundary deliberately does not call ``prepare_start``, persist a
        reservation, touch staging, or authorize provider execution.
        """
        _validate_claim(claim)
        with self.database.connect() as connection:
            _row, job, adapter, profile, request = self._context(
                connection, claim, started=False)
        return job, adapter, profile, request

    def record_reservation(self, claim: CreativeAttemptClaim,
                           request: CraftLauncherRequest,
                           launcher_receipt: dict) -> None:
        """Verify physical reserve, then consume its server receipt by ID."""
        _validate_claim(claim)
        with self.database.connect() as c:
            _row, job, adapter, profile, expected_request = self._context(
                c, claim, started=False)
            if request != expected_request:
                raise CraftLauncherContractError(
                    "La reserva no corresponde al claim Craft.")
            stored = self._stored(c, request)
            authority = self._authority_from_row(
                request, stored, job=job, adapter=adapter, profile=profile)
            expected = {
                "schemaVersion": 1,
                "dispatchId": request.body["dispatchId"],
                "requestSha256": request.request_sha256,
                "status": "reserved",
                "authoritySha256": authority.authority_sha256,
                "profileSha256": _profile_sha256(profile),
            }
            if launcher_receipt != expected:
                raise CraftLauncherContractError(
                    "El recibo de reserva del launcher no coincide.")
            receipt_sha = _canonical_sha256(expected)
            if stored["reserved_at"] is not None:
                if (stored["reservation_receipt"] != expected
                        or stored["reservation_receipt_sha256"] != receipt_sha
                        or stored.get("compensation_status") != "confirmed"):
                    raise CraftLauncherContractError(
                        "La reserva durable del launcher tiene otro recibo.")
                return
            materialization = self._materialization_from_row(stored)
        receipt_id = self._physical().verify_reserve(
            claim=claim, request=request, materialization=materialization,
            launcher_receipt=launcher_receipt)
        with self.database.connect() as c:
            completed = self._transition(
                c, "complete_reservation", user_id=claim.user_id,
                attempt_id=claim.attempt_id, receipt_id=receipt_id)
        if completed != expected:
            raise CraftLauncherContractError(
                "La finalización 114 de reserva no coincide.")

    @staticmethod
    def _lock_prestart_compensation(c, claim: CreativeAttemptClaim):
        """Lock account -> job -> step -> attempt -> reservation, without I/O."""
        c.execute("SET LOCAL lock_timeout = '500ms'")
        c.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
            (f"uonify:account:{claim.user_id}",),
        )
        owner = c.execute(
            "SELECT deletion_requested_at FROM users WHERE id=%s FOR NO KEY UPDATE",
            (claim.user_id,),
        ).fetchone()
        if not owner or owner.get("deletion_requested_at") is not None:
            raise CraftLauncherContractError(
                "La cuenta Craft ya no está activa para compensar.")
        c.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
            (f"uonify:craft-attempt:{claim.attempt_id}",),
        )
        job = c.execute(
            """SELECT id FROM creative_execution_jobs
               WHERE user_id=%s AND id=%s FOR UPDATE""",
            (claim.user_id, claim.job_id),
        ).fetchone()
        step = c.execute(
            """SELECT kind,provider_call,provider_started_at,provider_returned_at
               FROM creative_execution_steps
               WHERE user_id=%s AND job_id=%s AND step_id=%s FOR UPDATE""",
            (claim.user_id, claim.job_id, claim.step_id),
        ).fetchone()
        attempt = c.execute(
            """SELECT * FROM creative_execution_attempts
               WHERE user_id=%s AND id=%s FOR UPDATE""",
            (claim.user_id, claim.attempt_id),
        ).fetchone()
        stored = c.execute(
            """SELECT * FROM creative_craft_launcher_reservations
               WHERE user_id=%s AND attempt_id=%s FOR UPDATE""",
            (claim.user_id, claim.attempt_id),
        ).fetchone()
        if (not job or not step or not attempt or not stored
                or step["kind"] != "craft" or not step["provider_call"]
                or step["provider_started_at"] is not None
                or step["provider_returned_at"] is not None
                or attempt["provider_started_at"] is not None
                or attempt["provider_returned_at"] is not None
                or str(attempt["job_id"]) != claim.job_id
                or str(attempt["step_id"]) != claim.step_id
                or attempt["attempt_no"] != claim.attempt_no
                or str(attempt["claim_lease_token"]) != claim.lease_token
                or attempt["fence_epoch"] != claim.fence_epoch
                or attempt["admission_sha256"] != claim.admission_sha256
                or attempt["claim_set_sha256"] != claim.claim_set_sha256):
            raise CraftLauncherContractError(
                "La preparación Craft ya no admite compensación pre-start.")
        row = load_craft_attempt_authority(c, claim.user_id, claim.attempt_id)
        if not row:
            raise CraftLauncherContractError(
                "Falta la autoridad Craft para compensar el staging.")
        request = build_craft_launcher_request(claim, row)
        PostgresCraftAuthorityResolver._assert_wire_fence(request, row, stored)
        return row, stored, request

    def claim_prestart_compensation(
            self, claim: CreativeAttemptClaim) -> CraftLauncherPrestartCompensation:
        """Lease cleanup through the account-first transition API 114."""
        _validate_claim(claim)
        with self.database.connect() as c:
            row = load_craft_attempt_authority(
                c, claim.user_id, claim.attempt_id)
            stored = c.execute(
                """SELECT * FROM creative_craft_launcher_reservations
                    WHERE user_id=%s AND attempt_id=%s""",
                (claim.user_id, claim.attempt_id)).fetchone()
            if not row or not stored:
                raise CraftLauncherContractError(
                    "Falta la autoridad Craft para compensar el staging.")
            request = build_craft_launcher_request(claim, row)
            self._assert_wire_fence(request, row, stored)
            materialization = self._materialization_from_row(stored)
            if stored["compensation_status"] == "compensated":
                receipt = stored.get("compensation_receipt")
                if (not isinstance(receipt, dict)
                        or _canonical_sha256(receipt)
                        != stored.get("compensation_receipt_sha256")):
                    raise CraftLauncherContractError(
                        "El tombstone de compensación fue alterado.")
                return CraftLauncherPrestartCompensation(
                    request, None, materialization, receipt)
            if stored["compensation_status"] == "confirmed":
                # A confirmed reservation can be forgotten only after its
                # execution leases expire; SQL 114 owns and revalidates that
                # recovery fence when claiming the cleanup lease.
                pass
            elif stored["reserved_at"] is not None:
                raise CraftLauncherContractError(
                    "Una reserva confirmada no admite compensación pre-start.")
        with self.database.connect() as c:
            claimed = self._transition(
                c, "preparer_claim_compensation", user_id=claim.user_id,
                attempt_id=claim.attempt_id)
        expected_keys = {"leaseToken", "attemptCount", "dispatchId",
                         "requestSha256", "inputRoot", "outputRoot"}
        if (not isinstance(claimed, dict) or set(claimed) != expected_keys
                or str(claimed["dispatchId"]) != request.body["dispatchId"]
                or claimed["requestSha256"] != request.request_sha256
                or claimed["inputRoot"] != str(materialization.input_root)
                or claimed["outputRoot"] != str(materialization.output_root)):
            raise CraftLauncherContractError(
                "La compensación Craft pertenece a otro lease vigente.")
        return CraftLauncherPrestartCompensation(
            request, _canonical_uuid_value(
                claimed["leaseToken"], "compensationLeaseToken"),
            materialization)

    def authorize_prestart_compensation(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        """Authorize launcher-local cleanup only under a live cleanup lease."""
        (row, stored, _runtime, owner, authority, _adapter, _candidate_state,
         _candidate_adoption_durable) = self._load_for_request(request)
        self._assert_wire_fence(request, row, stored)
        if not owner:
            raise CraftLauncherContractError(
                "La cuenta no admite compensación Craft.")
        attempt = request.body["attempt"]
        with self.database.connect() as c:
            live = c.execute(
                """SELECT 1
                   FROM creative_craft_launcher_reservations r
                   JOIN creative_execution_attempts a
                     ON a.user_id=r.user_id AND a.id=r.attempt_id
                   JOIN creative_execution_steps s
                     ON s.user_id=a.user_id AND s.job_id=a.job_id
                    AND s.step_id=a.step_id
                   WHERE r.user_id=%s AND r.attempt_id=%s
                     AND r.dispatch_id=%s AND r.request_sha256=%s
                     AND r.compensation_status='running'
                     AND r.compensation_lease_until>clock_timestamp()
                     AND a.provider_started_at IS NULL
                     AND a.provider_returned_at IS NULL
                     AND s.provider_started_at IS NULL
                     AND s.provider_returned_at IS NULL""",
                (attempt["ownerUserId"], attempt["attemptId"],
                 request.body["dispatchId"], request.request_sha256),
            ).fetchone()
        if not live:
            raise CraftLauncherContractError(
                "El launcher no recibió un lease de compensación vigente.")
        return authority

    def complete_prestart_compensation(
        self, claim: CreativeAttemptClaim,
        compensation: CraftLauncherPrestartCompensation,
        launcher_receipt: dict,
    ) -> bool:
        """Discard staging outside SQL, then persist the exact tombstone."""
        _validate_claim(claim)
        if (not isinstance(compensation, CraftLauncherPrestartCompensation)
                or compensation.request.body["attempt"]["attemptId"]
                != claim.attempt_id):
            raise CraftLauncherContractError(
                "La compensación no corresponde al claim Craft.")
        if compensation.completed_receipt is not None:
            return True
        expected_base = {
            "schemaVersion": 1,
            "dispatchId": compensation.request.body["dispatchId"],
            "requestSha256": compensation.request.request_sha256,
            "cleanup": "verified",
        }
        if (not isinstance(launcher_receipt, dict)
                or set(launcher_receipt) != set(expected_base) | {"status"}
                or any(launcher_receipt.get(key) != value
                       for key, value in expected_base.items())
                or launcher_receipt.get("status") != "forgotten"):
            raise CraftLauncherContractError(
                "El recibo de compensación local no es exacto.")
        discard = getattr(self.materializer, "discard", None)
        if not callable(discard):
            raise CraftLauncherContractError(
                "El materializador no permite limpiar staging abandonado.")
        receipt_id = self._physical().verify_prestart_forget(
            claim=claim, compensation=compensation,
            launcher_receipt=launcher_receipt,
            perform_forget=lambda: discard(compensation.materialization))
        with self.database.connect() as c:
            value = self._transition(
                c, "complete_compensation", user_id=claim.user_id,
                attempt_id=claim.attempt_id,
                lease_token=compensation.lease_token,
                receipt_id=receipt_id)
        if not isinstance(value, str) or len(value) != 64:
            raise CraftLauncherContractError(
                "La compensación 114 no devolvió un receipt exacto.")
        return True

    def release_prestart_compensation(
        self, claim: CreativeAttemptClaim,
        compensation: CraftLauncherPrestartCompensation,
        error: BaseException,
    ) -> bool:
        """Expire this lease without making compensation intent reversible."""
        _validate_claim(claim)
        if (not isinstance(compensation, CraftLauncherPrestartCompensation)
                or compensation.lease_token is None
                or not isinstance(error, BaseException)):
            return False
        with self.database.connect() as c:
            value = self._transition(
                c, "preparer_release_compensation", user_id=claim.user_id,
                attempt_id=claim.attempt_id,
                lease_token=compensation.lease_token)
        return value is True

    def load_reserved_request(self, claim: CreativeAttemptClaim, recovery: bool = False
                              ) -> CraftLauncherRequest:
        """Return only the request durably reserved for this exact claim."""
        _validate_claim(claim)
        if not isinstance(recovery, bool):
            raise CraftLauncherContractError(
                "El modo de recuperación Craft no es válido.")
        if recovery:
            with self.database.connect() as c:
                row = load_craft_attempt_authority(
                    c, claim.user_id, claim.attempt_id)
                if not row:
                    raise CraftLauncherContractError(
                        "Falta la autoridad Craft de recuperación.")
                request = build_craft_launcher_request(claim, row)
                stored = self._stored(c, request)
                job, adapter = persisted_craft_context(row)
                profile = self._resolve_profile(job)
        else:
            with self.database.connect() as c:
                _row, job, adapter, profile, request = self._context(
                    c, claim, started=None)
                stored = self._stored(c, request, lock=True)
        self._authority_from_row(
            request, stored, job=job, adapter=adapter, profile=profile)
        receipt = stored.get("reservation_receipt") if stored else None
        if (not isinstance(receipt, dict) or stored.get("reserved_at") is None
                or stored.get("compensation_status") != "confirmed"
                or _canonical_sha256(receipt)
                != stored.get("reservation_receipt_sha256")):
            raise CraftLauncherContractError(
                "El claim Craft no tiene una reserva durable exacta.")
        return request

    @staticmethod
    def _runtime_ack_row(c, claim: CreativeAttemptClaim, terminal_status: str,
                         runtime_outbox_lease_token: str) -> dict:
        if terminal_status not in ("succeeded", "failed", "cancelled"):
            raise CraftLauncherContractError(
                "El terminal Craft no admite ACK automático.")
        try:
            lease = str(UUID(runtime_outbox_lease_token))
        except (TypeError, ValueError, AttributeError):
            raise CraftLauncherContractError(
                "El lease del outbox terminal no es válido.") from None
        row = c.execute(
            """SELECT * FROM creative_runtime_reconciliation_outbox
               WHERE user_id=%s AND attempt_id=%s AND job_id=%s AND step_id=%s
                 AND attempt_no=%s AND claim_lease_token=%s AND fence_epoch=%s
                 AND admission_sha256=%s AND claim_set_sha256=%s
                 AND kind='craft' AND provider_call=true
                 AND terminal_status=%s AND status='running'
                 AND lease_token=%s AND lease_until>clock_timestamp()
               FOR UPDATE""",
            (claim.user_id, claim.attempt_id, claim.job_id, claim.step_id,
             claim.attempt_no, claim.lease_token, claim.fence_epoch,
             claim.admission_sha256, claim.claim_set_sha256, terminal_status,
             lease),
        ).fetchone()
        if not row:
            raise CraftLauncherContractError(
                "El ACK no posee el lease exacto del outbox terminal.")
        return row

    @staticmethod
    def _successful_adoption_row(c, user_id: str, attempt_id: str) -> dict | None:
        row = c.execute(
            """SELECT r.id AS candidate_id,q.quarantine_set_sha256,
                      q.adoption_attempt_id,q.adoption_fence_epoch,
                      q.adoption_result_sha256,q.item_count,
                      r.receipt->'engine'->>'name' AS engine,
                      (SELECT count(*) FROM creative_candidate_quarantine_assets x
                        WHERE x.user_id=q.user_id
                          AND x.candidate_id=q.candidate_id) AS asset_count,
                      (SELECT count(*) FROM creative_candidate_native_projects n
                        WHERE n.user_id=q.user_id
                          AND n.candidate_id=q.candidate_id) AS native_count
               FROM creative_candidate_receipts r
               JOIN creative_candidate_quarantines q
                 ON q.user_id=r.user_id AND q.candidate_id=r.id
               JOIN creative_candidate_states s
                 ON s.user_id=r.user_id AND s.candidate_id=r.id
               JOIN creative_execution_attempts adoption
                 ON adoption.user_id=q.user_id
                AND adoption.id=q.adoption_attempt_id
               WHERE r.user_id=%s AND r.attempt_id=%s
                 AND s.quarantine_set_sha256=q.quarantine_set_sha256
                 AND adoption.status='succeeded'
                 AND adoption.fence_epoch=q.adoption_fence_epoch
                 AND adoption.result_sha256=q.adoption_result_sha256""",
            (user_id, attempt_id),
        ).fetchone()
        if (not row or row["engine"] not in (
                    "filmcraft", "photocraft", "effectcraft")
                or row["asset_count"] != row["item_count"]
                or row["asset_count"] < 1
                or ((row["engine"] in ("filmcraft", "photocraft"))
                    != (row["native_count"] == 1))
                or (row["engine"] == "effectcraft" and row["native_count"] != 0)):
            return None
        return row

    @staticmethod
    def _successful_adoption(c, claim: CreativeAttemptClaim) -> dict:
        row = PostgresCraftAuthorityResolver._successful_adoption_row(
            c, claim.user_id, claim.attempt_id)
        if not row:
            raise CraftLauncherContractError(
                "La salida Craft aún no fue adoptada de forma durable.")
        return row

    def authorize_terminal_ack(
        self, claim: CreativeAttemptClaim, terminal_status: str,
        runtime_outbox_lease_token: str,
    ) -> CraftLauncherRequest:
        """Claim the coupled runtime/ACK transition through API 114."""
        _validate_claim(claim)
        if terminal_status not in ("succeeded", "failed", "cancelled"):
            raise CraftLauncherContractError(
                "El terminal Craft no admite ACK automático.")
        request = self.load_reserved_request(claim, recovery=True)
        expected_lease = _canonical_uuid_value(
            runtime_outbox_lease_token, "runtimeLeaseToken")
        with self.database.connect() as c:
            value = self._transition(
                c, "ack_claim", user_id=claim.user_id,
                attempt_id=claim.attempt_id)
        keys = {"runtimeLeaseToken", "terminalStatus", "dispatchId",
                "requestSha256", "attemptCount"}
        if (not isinstance(value, dict) or set(value) != keys
                or _canonical_uuid_value(
                    value["runtimeLeaseToken"], "runtimeLeaseToken")
                != expected_lease
                or value["terminalStatus"] != terminal_status
                or str(value["dispatchId"]) != request.body["dispatchId"]
                or value["requestSha256"] != request.request_sha256
                or type(value["attemptCount"]) is not int
                or value["attemptCount"] < 1):
            raise CraftLauncherContractError(
                "El claim ACK 114 no coincide con su terminal exacto.")
        self._physical().issue_terminal_forget(
            claim=claim, runtime_lease_token=expected_lease,
            request=request)
        return request

    def record_terminal_ack(
        self, claim: CreativeAttemptClaim, terminal_status: str,
        runtime_outbox_lease_token: str, launcher_receipt: dict,
    ) -> bool:
        """Verify forget, then atomically complete runtime and ACK via 114."""
        _validate_claim(claim)
        request = self.load_reserved_request(claim, recovery=True)
        expected = {
            "schemaVersion": 1,
            "dispatchId": request.body["dispatchId"],
            "requestSha256": request.request_sha256,
            "status": "forgotten",
        }
        if launcher_receipt != expected:
            raise CraftLauncherContractError(
                "El recibo de forget del launcher no es exacto.")
        lease = _canonical_uuid_value(
            runtime_outbox_lease_token, "runtimeLeaseToken")
        receipt_id = self._physical().verify_terminal_forget(
            claim=claim, terminal_status=terminal_status,
            runtime_lease_token=lease, request=request,
            launcher_receipt=launcher_receipt)
        with self.database.connect() as c:
            applied = self._transition(
                c, "complete_ack", user_id=claim.user_id,
                attempt_id=claim.attempt_id, runtime_lease_token=lease,
                receipt_id=receipt_id)
        if applied is not True:
            raise CraftLauncherContractError(
                "El ACK terminal perdió su lease exacto antes del CAS.")
        return True

    def release_terminal_ack(
        self, claim: CreativeAttemptClaim, terminal_status: str,
        runtime_outbox_lease_token: str, error: BaseException,
    ) -> bool:
        """Release the inner ACK lease when the matching outer attempt retries."""
        _validate_claim(claim)
        if (terminal_status not in ("succeeded", "failed", "cancelled")
                or not isinstance(error, BaseException)):
            raise CraftLauncherContractError(
                "El fallo de ACK no corresponde a un terminal permitido.")
        lease = _canonical_uuid_value(
            runtime_outbox_lease_token, "runtimeLeaseToken")
        with self.database.connect() as c:
            value = self._transition(
                c, "ack_release", user_id=claim.user_id,
                attempt_id=claim.attempt_id, runtime_lease_token=lease)
        return value is True

    def _load_for_request(self, request: CraftLauncherRequest):
        if not isinstance(request, CraftLauncherRequest):
            raise CraftLauncherContractError("La petición Craft no es válida.")
        body = request.body
        with self.database.connect() as c:
            row = load_craft_attempt_authority(
                c, body["attempt"]["ownerUserId"],
                body["attempt"]["attemptId"])
            stored = self._stored(c, request)
            runtime = c.execute(
                """SELECT terminal_status,status
                   FROM creative_runtime_reconciliation_outbox
                   WHERE user_id=%s AND attempt_id=%s""",
                (body["attempt"]["ownerUserId"],
                 body["attempt"]["attemptId"]),
            ).fetchone()
            candidate = c.execute(
                """SELECT s.state
                   FROM creative_candidate_receipts r
                   JOIN creative_candidate_states s
                     ON s.user_id=r.user_id AND s.candidate_id=r.id
                   WHERE r.user_id=%s AND r.attempt_id=%s""",
                (body["attempt"]["ownerUserId"],
                 body["attempt"]["attemptId"]),
            ).fetchone()
            adoption = self._successful_adoption_row(
                c, body["attempt"]["ownerUserId"],
                body["attempt"]["attemptId"])
            owner = c.execute(
                "SELECT deletion_requested_at FROM users WHERE id=%s",
                (body["attempt"]["ownerUserId"],),
            ).fetchone()
        if not row or not stored:
            raise CraftLauncherContractError(
                "El launcher no conoce esta autoridad PostgreSQL.")
        job, adapter = persisted_craft_context(row)
        profile = self._resolve_profile(job)
        authority = self._authority_from_row(
            request, stored, job=job, adapter=adapter, profile=profile)
        candidate_state = None if not candidate else candidate["state"]
        if candidate_state == "received":
            candidate_state = "pending_storage"
        adoption_durable = adoption is not None
        return (row, stored, runtime, owner, authority, adapter,
                candidate_state, adoption_durable)

    @staticmethod
    def _assert_wire_fence(request: CraftLauncherRequest, row: dict,
                           stored: dict) -> None:
        attempt = request.body["attempt"]
        authority = request.body["authority"]
        expected_authority = {
            "jobBindingSha256": row["craft_job_binding_sha256"],
            "preflightSha256": row["craft_preflight_sha256"],
            "adapterPlanSha256": row["craft_adapter_plan_sha256"],
            "capabilityMatrixSha256": row["craft_capability_matrix_sha256"],
            "contractSchemaSha256": row["craft_contract_schema_sha256"],
            "adapterCompilerVersion": row["craft_adapter_compiler_version"],
            "adapterSourceSha256": row["craft_adapter_source_sha256"],
            "recipeSha256": row["craft_recipe_sha256"],
            "inputManifestSha256": row["craft_resolved_input_manifest_sha256"],
        }
        if (attempt["ownerUserId"] != str(row["user_id"])
                or attempt["jobId"] != str(row["job_id"])
                or attempt["stepId"] != str(row["step_id"])
                or attempt["attemptId"] != str(row["id"])
                or attempt["attemptNo"] != row["attempt_no"]
                or attempt["claimLeaseToken"] != str(row["claim_lease_token"])
                or attempt["fenceEpoch"] != row["fence_epoch"]
                or attempt["admissionSha256"] != row["admission_sha256"]
                or attempt["claimSetSha256"] != row["claim_set_sha256"]
                or authority != expected_authority
                or request.body["dispatchId"] != str(stored["dispatch_id"])
                or request.request_sha256 != stored["request_sha256"]
                or authority != stored["request_authority"]):
            raise CraftLauncherContractError(
                "La petición no coincide con el fence PostgreSQL.")

    def _authority_from_row(self, request: CraftLauncherRequest, stored: dict,
                            *, job, adapter,
                            profile) -> CraftLauncherAuthority:
        if not stored:
            raise CraftLauncherContractError(
                "Falta la autoridad preparada del launcher.")
        if (stored["profile_id"] != profile.profile_id
                or stored["profile_sha256"] != _profile_sha256(profile)):
            raise CraftLauncherContractError(
                "El perfil preparado del launcher cambió.")
        inputs = tuple(CraftInputBinding(
            item["assetId"], item["ownerUserId"], item["relativePath"],
            item["expectedSha256"], item["expectedBytes"],
        ) for item in stored["inputs"])
        limits = stored["limits"]
        value = build_synthetic_authority(
            request, profile_id=stored["profile_id"],
            control_document=stored["control_document"],
            input_root=Path(stored["input_root"]),
            output_root=Path(stored["output_root"]), inputs=inputs,
            expected_outputs=tuple(stored["expected_outputs"]),
            limits=CraftSandboxLimits(
                limits["cpuCores"], limits["memoryBytes"],
                limits["wallSeconds"], limits["outputBytes"],
                limits["maxProcesses"], limits["maxLogBytes"],
                limits["maxResponseBytes"], limits["shutdownGraceSeconds"],
            ),
        )
        if (value.authority_sha256 != stored["authority_sha256"]
                or stored["control_document"] != _control_document(job, adapter)
                or value.expected_outputs != _expected_outputs(job, adapter)):
            raise CraftLauncherContractError(
                "La autoridad preparada del launcher fue alterada.")
        return value

    @staticmethod
    def _live_start_gate(row: dict, owner: dict | None, *, started: bool) -> None:
        if (not owner or owner.get("deletion_requested_at") is not None
                or row["status"] != "running" or row["step_status"] != "running"
                or row["job_status"] != "running" or row["kind"] != "craft"
                or row.get("craft_authority_bound_at") is None
                or row["provider_returned_at"] is not None
                or (row["provider_started_at"] is not None) is not started
                or row.get("lease_token") is None
                or row.get("step_lease") is None or row.get("job_lease") is None):
            raise CraftLauncherContractError(
                "El intento Craft no admite esta fase del launcher.")

    def _phase_resolve(self, request: CraftLauncherRequest, *, started: bool
                       ) -> CraftLauncherAuthority:
        (row, stored, _runtime, owner, authority, _adapter, _candidate_state,
         _candidate_adoption_durable) = self._load_for_request(request)
        self._assert_wire_fence(request, row, stored)
        self._live_start_gate(row, owner, started=started)
        expected_preparation = "confirmed" if started else "pending"
        if stored.get("compensation_status") != expected_preparation:
            raise CraftLauncherContractError(
                "La preparación Craft no autoriza esta fase del launcher.")
        started_sql = ("a.provider_started_at IS NOT NULL"
                       if started else "a.provider_started_at IS NULL")
        with self.database.connect() as c:
            live = c.execute(
                """SELECT 1 FROM creative_execution_attempts a
                   JOIN creative_execution_steps s ON s.user_id=a.user_id
                     AND s.job_id=a.job_id AND s.step_id=a.step_id
                   JOIN creative_execution_jobs j ON j.user_id=a.user_id
                     AND j.id=a.job_id
                   WHERE a.user_id=%s AND a.id=%s AND a.status='running'
                     AND s.status='running' AND j.status='running'
                     AND s.kind='craft' AND s.provider_call=true
                     AND a.lease_token=%s AND s.lease_token=a.lease_token
                     AND j.lease_token=a.lease_token
                     AND a.fence_epoch=%s AND a.admission_sha256=%s
                     AND a.claim_set_sha256=%s
                     AND a.lease_until>clock_timestamp()
                     AND s.lease_until>clock_timestamp()
                     AND j.lease_until>clock_timestamp()
                     AND a.provider_returned_at IS NULL
                     AND s.provider_returned_at IS NULL
                     AND """ + started_sql + """
                     AND (s.provider_started_at IS NOT NULL)=%s""",
                (request.body["attempt"]["ownerUserId"],
                 request.body["attempt"]["attemptId"],
                 request.body["attempt"]["claimLeaseToken"],
                 request.body["attempt"]["fenceEpoch"],
                 request.body["attempt"]["admissionSha256"],
                 request.body["attempt"]["claimSetSha256"], started),
            ).fetchone()
        if not live:
            raise CraftLauncherContractError("El lease Craft ya no está vigente.")
        if started:
            receipt = stored.get("reservation_receipt")
            if (stored.get("reserved_at") is None or not isinstance(receipt, dict)
                    or _canonical_sha256(receipt)
                    != stored.get("reservation_receipt_sha256")):
                raise CraftLauncherContractError(
                    "El dispatch no tiene una reserva durable exacta.")
        return authority

    def resolve_for_reserve(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        return self._phase_resolve(request, started=False)

    def resolve_start(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        return self._phase_resolve(request, started=True)

    def resolve(self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        """Compatibility entry point; production dispatch uses resolve_start."""
        return self.resolve_start(request)

    def load_recovery_binding(
            self, request: CraftLauncherRequest) -> CraftLauncherRecoveryBinding:
        """Load immutable cleanup authority without requiring a live lease."""
        (row, stored, runtime, _owner, authority, _adapter, candidate_state,
         candidate_adoption_durable) = self._load_for_request(request)
        self._assert_wire_fence(request, row, stored)
        if (stored.get("reserved_at") is None
                or stored.get("compensation_status") != "confirmed"):
            raise CraftLauncherContractError(
                "La recuperación no tiene reserva durable.")
        return CraftLauncherRecoveryBinding(
            authority, row["status"], row["provider_started_at"] is not None,
            row["provider_returned_at"] is not None,
            runtime["terminal_status"] if runtime else None,
            runtime["status"] if runtime else None,
            candidate_state,
            candidate_adoption_durable,
        )

    def authorize_launcher_ack(
            self, request: CraftLauncherRequest) -> CraftLauncherRecoveryBinding:
        """Independently prove the exact live inner/outer ACK lease to launcher."""
        binding = self.load_recovery_binding(request)
        attempt = request.body["attempt"]
        with self.database.connect() as c:
            row = c.execute(
                """SELECT 1
                   FROM creative_craft_launcher_ack_outbox a
                   JOIN creative_runtime_reconciliation_outbox r
                     ON r.user_id=a.user_id
                    AND r.attempt_id=a.source_attempt_id
                    AND r.job_id=a.job_id
                    AND r.step_id=a.source_step_id
                    AND r.attempt_no=a.attempt_no
                    AND r.claim_lease_token=a.claim_lease_token
                    AND r.fence_epoch=a.fence_epoch
                    AND r.admission_sha256=a.admission_sha256
                    AND r.claim_set_sha256=a.claim_set_sha256
                    AND r.terminal_status=a.terminal_status
                   JOIN creative_execution_attempts t
                     ON t.user_id=a.user_id AND t.id=a.source_attempt_id
                   WHERE a.user_id=%s AND a.source_attempt_id=%s
                     AND a.dispatch_id=%s AND a.request_sha256=%s
                     AND a.status='running' AND r.status='running'
                     AND a.lease_token=r.lease_token
                     AND a.lease_until>clock_timestamp()
                     AND r.lease_until>clock_timestamp()
                     AND a.terminal_status IN ('succeeded','failed','cancelled')
                     AND t.status=a.terminal_status""",
                (attempt["ownerUserId"], attempt["attemptId"],
                 request.body["dispatchId"], request.request_sha256),
            ).fetchone()
        if not row:
            raise CraftLauncherContractError(
                "El launcher no recibió autoridad durable para forget.")
        return binding

    @staticmethod
    def _binding_authorizes_output_cleanup(
            binding: CraftLauncherRecoveryBinding) -> bool:
        if (not isinstance(binding, CraftLauncherRecoveryBinding)
                or binding.candidate_storage_state in (
                    "pending_storage", "received")):
            return False
        if binding.attempt_status in ("failed", "cancelled"):
            return True
        return (binding.attempt_status == "succeeded"
                and binding.candidate_adoption_durable is True)

    def authorize_output_cleanup(
        self, request: CraftLauncherRequest, *, phase: str,
    ) -> CraftOutputCleanupAuthorization:
        """Re-read the immutable durable fact immediately before unlink."""
        if phase == "prestart":
            authority = self.authorize_prestart_compensation(request)
            allowed = True
        elif phase == "ack":
            binding = self.authorize_launcher_ack(request)
            authority = binding.authority
            allowed = self._binding_authorizes_output_cleanup(binding)
        elif phase == "recovery":
            binding = self.load_recovery_binding(request)
            authority = binding.authority
            allowed = self._binding_authorizes_output_cleanup(binding)
        else:
            raise CraftLauncherContractError(
                "La fase de limpieza Craft no es válida.")
        return CraftOutputCleanupAuthorization(phase, authority, allowed)
