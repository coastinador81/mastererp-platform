"""Disconnected lifecycle for one server-owned Craft sandbox launcher.

The service is intentionally absent from application startup and routes.  It
uses a durable local journal so reserve, cancellation, restart cleanup and
terminal acknowledgement do not depend on API process memory.
"""

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
import stat
from typing import Protocol

from .creative_craft_launcher_authority import (
    CraftAuthorityResolver, CraftLauncherAuthority, CraftLauncherProfile,
    CraftOutputCleanupAuthorization, CraftProfileRegistry,
    verify_authority_files,
)
from .creative_craft_launcher_contract import (
    CraftLauncherContractError, CraftLauncherRequest,
    parse_craft_launcher_request,
)


_TERMINAL = frozenset({"succeeded", "failed", "cancelled", "forgotten"})


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode()


@dataclass(frozen=True)
class CraftSandboxExecution:
    exit_code: int
    stdout: bytes
    stderr: bytes
    termination: str
    cleanup_verified: bool
    wall_millis: int = 0


@dataclass(frozen=True)
class CraftSandboxCancellation:
    status: str
    cleanup_verified: bool


class CraftSandboxEngine(Protocol):
    def run(self, profile: CraftLauncherProfile,
            authority: CraftLauncherAuthority) -> CraftSandboxExecution:
        ...

    def cancel(self, dispatch_id: str,
               grace_seconds: int) -> CraftSandboxCancellation:
        ...


class CraftLauncherJournal:
    """Small local durability boundary owned only by the launcher process."""

    def __init__(self, path: Path):
        self.path = Path(path)
        if not self.path.is_absolute():
            raise CraftLauncherContractError("El journal del launcher no es absoluto.")
        parent = self.path.parent
        if parent.exists() or parent.is_symlink():
            info = parent.lstat()
            if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                    or info.st_uid != os.getuid()
                    or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)):
                raise CraftLauncherContractError("La raíz del journal no es segura.")
        else:
            ancestor = parent.parent
            if ancestor.resolve(strict=True) != ancestor:
                raise CraftLauncherContractError("La raíz del journal atraviesa un enlace.")
            parent.mkdir(mode=0o700, parents=True)
        if parent.resolve(strict=True) != parent:
            raise CraftLauncherContractError("La raíz del journal atraviesa un enlace.")
        if self.path.exists() or self.path.is_symlink():
            info = self.path.lstat()
            if (stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode)
                    or info.st_uid != os.getuid()):
                raise CraftLauncherContractError("El journal existente no es seguro.")
        with self._connect() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS craft_dispatches(
                dispatch_id TEXT PRIMARY KEY,
                request_sha256 TEXT NOT NULL UNIQUE,
                request_body BLOB NOT NULL,
                authority_sha256 TEXT NOT NULL,
                profile_sha256 TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN
                    ('reserved','running','succeeded','failed','cancelled',
                     'cleanup_pending','forgotten')),
                receipt BLOB,
                cleanup_verified INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")
        os.chmod(self.path, 0o600)
        info = self.path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)):
            raise CraftLauncherContractError("El journal creado no es seguro.")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def reserve(self, request: CraftLauncherRequest, authority_sha256: str,
                profile_sha256: str) -> dict:
        dispatch = request.body["dispatchId"]
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM craft_dispatches WHERE dispatch_id=?",
                (dispatch,),
            ).fetchone()
            if row is None:
                connection.execute("""INSERT INTO craft_dispatches(
                    dispatch_id,request_sha256,request_body,authority_sha256,
                    profile_sha256,state) VALUES(?,?,?,?,?,'reserved')""",
                    (dispatch, request.request_sha256, request.canonical_body,
                     authority_sha256, profile_sha256))
                connection.commit()
                return self.get(dispatch)
            if (row["request_sha256"] != request.request_sha256
                    or bytes(row["request_body"]) != request.canonical_body
                    or row["authority_sha256"] != authority_sha256
                    or row["profile_sha256"] != profile_sha256):
                connection.rollback()
                raise CraftLauncherContractError(
                    "El dispatchId ya está ligado a otra autoridad.")
            connection.commit()
            return dict(row)

    def tombstone_prestart(self, request: CraftLauncherRequest,
                           authority_sha256: str,
                           profile_sha256: str) -> dict:
        """Atomically fence an absent or existing local pre-start reserve."""
        dispatch = request.body["dispatchId"]
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM craft_dispatches WHERE dispatch_id=?",
                (dispatch,),
            ).fetchone()
            if row is None:
                connection.execute("""INSERT INTO craft_dispatches(
                    dispatch_id,request_sha256,request_body,authority_sha256,
                    profile_sha256,state,cleanup_verified)
                    VALUES(?,?,?,?,?,'forgotten',1)""",
                    (dispatch, request.request_sha256, request.canonical_body,
                     authority_sha256, profile_sha256))
                connection.commit()
                return self.get(dispatch)
            if (row["request_sha256"] != request.request_sha256
                    or bytes(row["request_body"]) != request.canonical_body
                    or row["authority_sha256"] != authority_sha256
                    or row["profile_sha256"] != profile_sha256):
                connection.rollback()
                raise CraftLauncherContractError(
                    "El dispatchId local pertenece a otra autoridad.")
            if row["state"] == "reserved":
                receipt = _canonical_bytes({
                    "schemaVersion": 1, "dispatchId": dispatch,
                    "requestSha256": request.request_sha256,
                    "status": "cancelled", "cleanup": "pending",
                })
                connection.execute("""UPDATE craft_dispatches
                    SET state='cleanup_pending',receipt=?,cleanup_verified=0,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE dispatch_id=? AND state='reserved'""",
                    (receipt, dispatch))
                connection.commit()
                return self.get(dispatch)
            connection.commit()
            return dict(row)

    def get(self, dispatch_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM craft_dispatches WHERE dispatch_id=?",
                (dispatch_id,),
            ).fetchone()
        return dict(row) if row else None

    def compare_and_set(self, dispatch_id: str, expected: str, state: str, *,
                        receipt: dict | None = None,
                        cleanup_verified: bool = False) -> bool:
        encoded = _canonical_bytes(receipt) if receipt is not None else None
        with self._connect() as connection:
            cursor = connection.execute("""UPDATE craft_dispatches SET state=?,
                receipt=?,cleanup_verified=?,updated_at=CURRENT_TIMESTAMP
                WHERE dispatch_id=? AND state=?""",
                (state, encoded, int(cleanup_verified), dispatch_id, expected))
        return cursor.rowcount == 1

    def recoverable(self) -> tuple[dict, ...]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM craft_dispatches"
                " WHERE state IN ('running','cleanup_pending')"
            ).fetchall()
        return tuple(dict(row) for row in rows)

    def acknowledge(self, request: CraftLauncherRequest) -> bool:
        dispatch = request.body["dispatchId"]
        with self._connect() as connection:
            cursor = connection.execute("""UPDATE craft_dispatches
                SET state='forgotten',receipt=NULL,updated_at=CURRENT_TIMESTAMP
                WHERE dispatch_id=? AND request_sha256=?
                  AND state IN ('succeeded','failed','cancelled')
                  AND cleanup_verified=1""",
                (dispatch, request.request_sha256))
            if cursor.rowcount == 1:
                return True
            row = connection.execute(
                "SELECT state,request_sha256 FROM craft_dispatches"
                " WHERE dispatch_id=?", (dispatch,)).fetchone()
        return bool(row and row["state"] == "forgotten"
                    and row["request_sha256"] == request.request_sha256)


def _profile_sha256(profile: CraftLauncherProfile) -> str:
    return sha256(_canonical_bytes(profile.canonical())).hexdigest()


def _validate_outputs(authority: CraftLauncherAuthority) -> tuple[list[dict], int]:
    expected = set(authority.expected_outputs)
    expected_directories = {
        parent.as_posix() for value in expected
        for parent in Path(value).parents if parent.as_posix() != "."
    }
    observed: set[str] = set()
    outputs: list[dict] = []
    total = 0
    for path in authority.output_root.rglob("*"):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not (
                stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise CraftLauncherContractError("El sandbox produjo una salida insegura.")
        if stat.S_ISDIR(info.st_mode):
            relative = path.relative_to(authority.output_root).as_posix()
            if relative not in expected_directories:
                raise CraftLauncherContractError(
                    "El sandbox produjo un directorio inesperado.")
            continue
        if info.st_nlink != 1:
            raise CraftLauncherContractError("El sandbox produjo un hardlink.")
        relative = path.relative_to(authority.output_root).as_posix()
        if relative not in expected or relative in observed:
            raise CraftLauncherContractError("El sandbox produjo una salida inesperada.")
        observed.add(relative)
        total += info.st_size
        if total > authority.limits.output_bytes:
            raise CraftLauncherContractError("El sandbox excedió el límite de salida.")
        digest = sha256()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            opened = os.fstat(descriptor)
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise CraftLauncherContractError("Una salida cambió durante su apertura.")
            while chunk := os.read(descriptor, 1024 * 1024):
                digest.update(chunk)
            closed = os.fstat(descriptor)
            if ((closed.st_dev, closed.st_ino) != (info.st_dev, info.st_ino)
                    or (closed.st_size, closed.st_mtime_ns)
                    != (info.st_size, info.st_mtime_ns)):
                raise CraftLauncherContractError("Una salida cambió durante su lectura.")
        finally:
            os.close(descriptor)
        outputs.append({
            "relativePath": relative, "bytes": info.st_size,
            "sha256": digest.hexdigest(),
        })
    if observed != expected:
        raise CraftLauncherContractError("Falta una salida esperada del sandbox.")
    outputs.sort(key=lambda item: item["relativePath"])
    return outputs, total


def _clear_outputs(authority: CraftLauncherAuthority) -> bool:
    """Remove every quarantined output; any unsafe entry fails closed."""
    try:
        os.chmod(authority.output_root, 0o700)
        for path in sorted(authority.output_root.rglob("*"),
                           key=lambda item: len(item.parts), reverse=True):
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                path.unlink()
            elif stat.S_ISREG(info.st_mode):
                path.unlink()
            elif stat.S_ISDIR(info.st_mode):
                path.rmdir()
            else:
                return False
        return not any(authority.output_root.iterdir())
    except OSError:
        return False


def _freeze_outputs(authority: CraftLauncherAuthority) -> None:
    for path in authority.output_root.rglob("*"):
        info = path.lstat()
        if stat.S_ISREG(info.st_mode):
            os.chmod(path, 0o400)
        elif stat.S_ISDIR(info.st_mode):
            os.chmod(path, 0o500)
    os.chmod(authority.output_root, 0o500)


def _sandbox_response(payload: bytes) -> dict:
    try:
        text = payload.decode()
        pairs = []

        def no_duplicates(items):
            value = {}
            for key, item in items:
                if key in value:
                    raise CraftLauncherContractError(
                        "La respuesta del sandbox repite una clave.")
                value[key] = item
            pairs.append(value)
            return value

        value = json.loads(text, object_pairs_hook=no_duplicates)
    except (UnicodeError, json.JSONDecodeError):
        raise CraftLauncherContractError("La respuesta del sandbox no es JSON.") from None
    if (_canonical_bytes(value) != payload
            or value != {"schemaVersion": 1, "status": "succeeded"}):
        raise CraftLauncherContractError("La respuesta del sandbox no es exacta.")
    return value


class CraftLauncherService:
    def __init__(self, resolver: CraftAuthorityResolver,
                 profiles: CraftProfileRegistry, engine: CraftSandboxEngine,
                 journal: CraftLauncherJournal, *, owner_uid: int):
        self.resolver = resolver
        self.profiles = profiles
        self.engine = engine
        self.journal = journal
        self.owner_uid = owner_uid

    def _resolve_for_reserve(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        resolver = getattr(self.resolver, "resolve_for_reserve", None)
        if callable(resolver):
            return resolver(request)
        return self.resolver.resolve(request)

    def _resolve_for_start(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        resolver = getattr(self.resolver, "resolve_start", None)
        if callable(resolver):
            return resolver(request)
        return self.resolver.resolve(request)

    def _recovery_binding(self, request: CraftLauncherRequest):
        resolver = getattr(self.resolver, "load_recovery_binding", None)
        if callable(resolver):
            binding = resolver(request)
            authority = getattr(binding, "authority", binding)
            if not isinstance(authority, CraftLauncherAuthority):
                raise CraftLauncherContractError(
                    "La autoridad de recuperación no es válida.")
            return binding, authority
        authority = self.resolver.resolve(request)
        return authority, authority

    def _resolve_for_recovery(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        return self._recovery_binding(request)[1]

    def _clear_outputs_if_authorized(
        self, request: CraftLauncherRequest,
        authority: CraftLauncherAuthority, *, phase: str = "recovery",
    ) -> bool:
        """Apply the sole destructive-output gate for every launcher phase."""
        resolver = getattr(self.resolver, "authorize_output_cleanup", None)
        if not callable(resolver):
            return False
        try:
            authorization = resolver(request, phase=phase)
        except Exception:
            return False
        if (not isinstance(authorization, CraftOutputCleanupAuthorization)
                or authorization.phase != phase
                or authorization.authority != authority
                or authorization.authority.dispatch_id
                    != request.body["dispatchId"]
                or authorization.authority.request_sha256
                    != request.request_sha256
                or authorization.purge_authorized is not True):
            return False
        return _clear_outputs(authority)

    def _resolve_for_ack(self, request: CraftLauncherRequest):
        resolver = getattr(self.resolver, "authorize_launcher_ack", None)
        if callable(resolver):
            binding = resolver(request)
            authority = getattr(binding, "authority", binding)
            if not isinstance(authority, CraftLauncherAuthority):
                raise CraftLauncherContractError(
                    "La autoridad del ACK no es válida.")
            return binding, authority
        return self._recovery_binding(request)

    def _resolve_for_prestart_compensation(
            self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        resolver = getattr(self.resolver, "authorize_prestart_compensation", None)
        if not callable(resolver):
            raise CraftLauncherContractError(
                "El launcher no tiene autoridad de compensación pre-start.")
        authority = resolver(request)
        if not isinstance(authority, CraftLauncherAuthority):
            raise CraftLauncherContractError(
                "La autoridad de compensación pre-start no es válida.")
        return authority

    def _journal_row(self, request: CraftLauncherRequest) -> dict:
        row = self.journal.get(request.body["dispatchId"])
        if (row is None or row["request_sha256"] != request.request_sha256
                or bytes(row["request_body"]) != request.canonical_body):
            raise CraftLauncherContractError(
                "El dispatch no conserva la reserva exacta.")
        return row

    @staticmethod
    def _assert_reserved_authority(
            row: dict, authority: CraftLauncherAuthority,
            profile: CraftLauncherProfile) -> None:
        if (row["authority_sha256"] != authority.authority_sha256
                or row["profile_sha256"] != _profile_sha256(profile)):
            raise CraftLauncherContractError(
                "La reserva local no coincide con la autoridad vigente.")

    def reserve(self, request: CraftLauncherRequest) -> dict:
        authority = self._resolve_for_reserve(request)
        profile = self.profiles.get(authority.profile_id)
        if profile.container_uid != self.owner_uid:
            raise CraftLauncherContractError(
                "El UID del perfil no coincide con el staging del launcher.")
        existing = self.journal.get(request.body["dispatchId"])
        if existing is None:
            verify_authority_files(authority, self.owner_uid)
        row = self.journal.reserve(
            request, authority.authority_sha256, _profile_sha256(profile))
        if row["state"] != "reserved":
            raise CraftLauncherContractError(
                "La preparación local ya fue compensada.")
        return {
            "schemaVersion": 1, "dispatchId": request.body["dispatchId"],
            "requestSha256": request.request_sha256, "status": row["state"],
            "authoritySha256": authority.authority_sha256,
            "profileSha256": _profile_sha256(profile),
        }

    def compensate_prestart(self, request: CraftLauncherRequest) -> dict:
        """Forget a local reserve that PostgreSQL never confirmed.

        This endpoint is useful before a journal row exists as well.  It never
        starts or cancels an engine because PostgreSQL proves provider-start is
        still absent under a live compensation lease.
        """
        authority = self._resolve_for_prestart_compensation(request)
        dispatch = request.body["dispatchId"]
        profile = self.profiles.get(authority.profile_id)
        row = self.journal.tombstone_prestart(
            request, authority.authority_sha256, _profile_sha256(profile))
        base = {
            "schemaVersion": 1, "dispatchId": dispatch,
            "requestSha256": request.request_sha256, "cleanup": "verified",
        }
        if (row["request_sha256"] != request.request_sha256
                or bytes(row["request_body"]) != request.canonical_body):
            raise CraftLauncherContractError(
                "El journal local no coincide con la compensación durable.")
        self._assert_reserved_authority(row, authority, profile)
        if row["state"] == "forgotten":
            return {**base, "status": "forgotten"}
        if row["state"] in ("reserved", "cleanup_pending"):
            if not self._clear_outputs_if_authorized(
                    request, authority, phase="prestart"):
                raise CraftLauncherContractError(
                    "El output preparado no pudo limpiarse.")
            receipt = {
                "schemaVersion": 1, "dispatchId": dispatch,
                "requestSha256": request.request_sha256,
                "status": "cancelled", "cleanup": "verified",
            }
            if not self.journal.compare_and_set(
                    dispatch, row["state"], "cancelled", receipt=receipt,
                    cleanup_verified=True):
                row = self._journal_row(request)
                if row["state"] not in ("cancelled", "forgotten"):
                    raise CraftLauncherContractError(
                        "La compensación perdió el fence del journal.")
        elif row["state"] != "cancelled" or not row["cleanup_verified"]:
            raise CraftLauncherContractError(
                "El journal local salió de la fase pre-start.")
        if not self.journal.acknowledge(request):
            raise CraftLauncherContractError(
                "La reserva local no pudo convertirse en tombstone.")
        return {**base, "status": "forgotten"}

    def dispatch(self, request: CraftLauncherRequest) -> dict:
        dispatch = request.body["dispatchId"]
        current = self._journal_row(request)
        if current["state"] == "forgotten":
            raise CraftLauncherContractError("El dispatch terminal ya fue olvidado.")
        if current["state"] in _TERMINAL:
            return json.loads(bytes(current["receipt"]))
        # Resolve every server-owned capability before changing the durable
        # state to running. A resolver outage can therefore never strand a
        # prepared engine reservation in the journal.
        authority = self._resolve_for_start(request)
        profile = self.profiles.get(authority.profile_id)
        if profile.container_uid != self.owner_uid:
            raise CraftLauncherContractError(
                "El UID del perfil no coincide con el staging del launcher.")
        self._assert_reserved_authority(current, authority, profile)
        prepare = getattr(self.engine, "prepare", None)
        release = getattr(self.engine, "release", None)
        if callable(prepare):
            prepare(dispatch)
        if current["state"] != "reserved" or not self.journal.compare_and_set(
                dispatch, "reserved", "running"):
            if callable(release):
                release(dispatch)
            latest = self.journal.get(dispatch)
            if latest and latest["state"] in _TERMINAL - {"forgotten"}:
                return json.loads(bytes(latest["receipt"]))
            raise CraftLauncherContractError("El dispatch no puede comenzar dos veces.")
        run_started = False
        try:
            # The roots are launcher-owned (0700) and are checked again at the
            # last boundary before the runtime receives them.
            verify_authority_files(authority, self.owner_uid)
            run_started = True
            execution = self.engine.run(profile, authority)
            if not isinstance(execution, CraftSandboxExecution):
                raise CraftLauncherContractError("El motor no devolvió recibo interno.")
            if (len(execution.stdout) > authority.limits.max_response_bytes
                    or len(execution.stderr) > authority.limits.max_log_bytes):
                raise CraftLauncherContractError("El sandbox excedió su salida de proceso.")
            if (execution.termination != "completed" or execution.exit_code != 0
                    or not execution.cleanup_verified):
                raise CraftLauncherContractError("El sandbox no terminó de forma limpia.")
            outputs, output_bytes = _validate_outputs(authority)
            _sandbox_response(execution.stdout)
            _freeze_outputs(authority)
            receipt = {
                "schemaVersion": 1, "dispatchId": dispatch,
                "requestSha256": request.request_sha256,
                "status": "succeeded", "outputs": outputs,
                "outputManifestSha256": sha256(_canonical_bytes(outputs)).hexdigest(),
                "usage": {
                    "outputBytes": output_bytes,
                    "logBytes": len(execution.stderr),
                    "responseBytes": len(execution.stdout),
                    "wallMillis": execution.wall_millis,
                },
                "cleanup": "verified",
            }
            if not self.journal.compare_and_set(
                    dispatch, "running", "succeeded", receipt=receipt,
                    cleanup_verified=True):
                row = self.journal.get(dispatch)
                if row and row["state"] == "cancelled":
                    if not self._clear_outputs_if_authorized(
                            request, authority):
                        raise CraftLauncherContractError(
                            "La salida cancelada no pudo limpiarse.")
                    return json.loads(bytes(row["receipt"]))
                if row and row["state"] == "cleanup_pending":
                    if not self._clear_outputs_if_authorized(
                            request, authority):
                        if row["receipt"] is not None:
                            return json.loads(bytes(row["receipt"]))
                        return {
                            "schemaVersion": 1, "dispatchId": dispatch,
                            "requestSha256": request.request_sha256,
                            "status": "cancelled", "cleanup": "pending",
                        }
                    cancelled = {
                        "schemaVersion": 1, "dispatchId": dispatch,
                        "requestSha256": request.request_sha256,
                        "status": "cancelled", "cleanup": "verified",
                    }
                    if self.journal.compare_and_set(
                            dispatch, "cleanup_pending", "cancelled",
                            receipt=cancelled, cleanup_verified=True):
                        return cancelled
                raise CraftLauncherContractError("El fence del launcher cambió.")
            return receipt
        except BaseException as error:
            if not run_started and callable(release):
                release(dispatch)
            row_before_cleanup = self.journal.get(dispatch)
            cancel_requested = bool(
                row_before_cleanup
                and row_before_cleanup["state"] in ("cleanup_pending", "cancelled")
            )
            try:
                cancellation = self.engine.cancel(
                    dispatch, authority.limits.shutdown_grace_seconds)
            except BaseException:
                cancellation = CraftSandboxCancellation("cleanup_pending", False)
            outputs_clean = (cancellation.cleanup_verified
                             and self._clear_outputs_if_authorized(
                                 request, authority))
            receipt = {
                "schemaVersion": 1, "dispatchId": dispatch,
                "requestSha256": request.request_sha256,
                "status": ("cancelled" if cancel_requested else "failed"),
                "cleanup": ("verified" if outputs_clean
                            else "pending"),
            }
            if not cancel_requested:
                receipt["errorCode"] = "sandbox_failed"
            state = "failed" if outputs_clean else "cleanup_pending"
            if cancel_requested:
                changed = False
                if outputs_clean:
                    changed = self.journal.compare_and_set(
                        dispatch, "cleanup_pending", "cancelled",
                        receipt=receipt, cleanup_verified=True)
                if changed:
                    return receipt
                latest = self.journal.get(dispatch)
                if latest and latest["state"] == "cancelled":
                    return json.loads(bytes(latest["receipt"]))
            else:
                changed = self.journal.compare_and_set(
                    dispatch, "running", state, receipt=receipt,
                    cleanup_verified=outputs_clean)
            raise error

    def cancel(self, request: CraftLauncherRequest) -> dict:
        dispatch = request.body["dispatchId"]
        current = self._journal_row(request)
        if current["state"] == "forgotten":
            return {
                "schemaVersion": 1, "dispatchId": dispatch,
                "requestSha256": request.request_sha256,
                "status": "already_terminal", "cleanup": "verified",
            }
        if current["state"] in _TERMINAL:
            return {
                "schemaVersion": 1, "dispatchId": dispatch,
                "requestSha256": request.request_sha256,
                "status": "already_terminal",
                "cleanup": ("verified" if current["cleanup_verified"] else "pending"),
            }
        pending_receipt = {
            "schemaVersion": 1, "dispatchId": dispatch,
            "requestSha256": request.request_sha256,
            "status": "cancelled", "cleanup": "pending",
        }
        if current["state"] == "reserved":
            if self.journal.compare_and_set(
                    dispatch, "reserved", "cleanup_pending",
                    receipt=pending_receipt, cleanup_verified=False):
                binding, authority = self._recovery_binding(request)
                profile = self.profiles.get(authority.profile_id)
                self._assert_reserved_authority(current, authority, profile)
                outputs_clean = self._clear_outputs_if_authorized(
                    request, authority)
                if not outputs_clean:
                    return pending_receipt
                receipt = {**pending_receipt, "cleanup": "verified"}
                if self.journal.compare_and_set(
                        dispatch, "cleanup_pending", "cancelled",
                        receipt=receipt, cleanup_verified=True):
                    return receipt
                latest = self.journal.get(dispatch)
                if (latest and latest["request_sha256"] == request.request_sha256
                        and latest["state"] == "cancelled"
                        and latest["cleanup_verified"]):
                    return json.loads(bytes(latest["receipt"]))
                raise CraftLauncherContractError(
                    "La cancelación perdió el fence local.")
            # Dispatch won reserved -> running. Continue from the durable
            # state we just lost against; never decide from the stale snapshot.
            current = self.journal.get(dispatch)
        if current["state"] == "running":
            if not self.journal.compare_and_set(
                    dispatch, "running", "cleanup_pending",
                    receipt=pending_receipt, cleanup_verified=False):
                current = self.journal.get(dispatch)
                if current["state"] in _TERMINAL:
                    return {
                        "schemaVersion": 1, "dispatchId": dispatch,
                        "requestSha256": request.request_sha256,
                        "status": "already_terminal",
                        "cleanup": ("verified" if current["cleanup_verified"]
                                    else "pending"),
                    }
                if current["state"] != "cleanup_pending":
                    raise CraftLauncherContractError(
                        "La cancelación perdió el fence local.")
        elif current["state"] != "cleanup_pending":
            current = self.journal.get(dispatch)
            if current["state"] in _TERMINAL:
                return {
                    "schemaVersion": 1, "dispatchId": dispatch,
                    "requestSha256": request.request_sha256,
                    "status": "already_terminal",
                    "cleanup": ("verified" if current["cleanup_verified"]
                                else "pending"),
                }
            raise CraftLauncherContractError("La cancelación perdió el fence local.")
        binding, authority = self._recovery_binding(request)
        profile = self.profiles.get(authority.profile_id)
        self._assert_reserved_authority(current, authority, profile)
        try:
            cancellation = self.engine.cancel(
                dispatch, authority.limits.shutdown_grace_seconds)
        except BaseException:
            cancellation = CraftSandboxCancellation("cleanup_pending", False)
        outputs_clean = (cancellation.cleanup_verified
                         and self._clear_outputs_if_authorized(
                             request, authority))
        receipt = {
            "schemaVersion": 1, "dispatchId": dispatch,
            "requestSha256": request.request_sha256,
            "status": "cancelled",
            "cleanup": ("verified" if outputs_clean else "pending"),
        }
        changed = False
        if outputs_clean:
            changed = self.journal.compare_and_set(
                dispatch, "cleanup_pending", "cancelled", receipt=receipt,
                cleanup_verified=True)
        else:
            current = self.journal.get(dispatch)
            changed = bool(current and current["state"] == "cleanup_pending")
        if not changed:
            current = self.journal.get(dispatch)
            if (current and current["state"] == "cancelled"
                    and current["request_sha256"] == request.request_sha256
                    and current["receipt"] is not None):
                return json.loads(bytes(current["receipt"]))
            if current["state"] in _TERMINAL:
                return {**receipt, "status": "already_terminal"}
            raise CraftLauncherContractError("La cancelación perdió el fence local.")
        return receipt

    def status(self, request: CraftLauncherRequest) -> dict:
        row = self.journal.get(request.body["dispatchId"])
        if row is None or row["request_sha256"] != request.request_sha256:
            raise CraftLauncherContractError("El dispatch no existe para este request.")
        result = {
            "schemaVersion": 1, "dispatchId": request.body["dispatchId"],
            "requestSha256": request.request_sha256, "status": row["state"],
            "cleanup": ("verified" if row["cleanup_verified"] else "pending"),
        }
        # The PostgreSQL-backed resolver is the production-shaped recovery
        # boundary.  It needs the exact terminal receipt after a lost UDS
        # response; the static probe keeps its historical compact response.
        if (callable(getattr(self.resolver, "load_recovery_binding", None))
                and row["state"] in _TERMINAL - {"forgotten"}
                and row["receipt"] is not None):
            result["terminalReceipt"] = json.loads(bytes(row["receipt"]))
        return result

    def acknowledge(self, request: CraftLauncherRequest) -> dict:
        row = self._journal_row(request)
        if row["state"] == "forgotten":
            return {
                "schemaVersion": 1, "dispatchId": request.body["dispatchId"],
                "requestSha256": request.request_sha256, "status": "forgotten",
            }
        binding, authority = self._resolve_for_ack(request)
        profile = self.profiles.get(authority.profile_id)
        self._assert_reserved_authority(row, authority, profile)
        if not self._clear_outputs_if_authorized(
                request, authority, phase="ack"):
            raise CraftLauncherContractError(
                "Los outputs terminales aún no admiten forget.")
        if not self.journal.acknowledge(request):
            raise CraftLauncherContractError("El terminal aún no admite forget.")
        return {
            "schemaVersion": 1, "dispatchId": request.body["dispatchId"],
            "requestSha256": request.request_sha256, "status": "forgotten",
        }

    def recover_running(self) -> dict:
        recovered = failed = 0
        for row in self.journal.recoverable():
            try:
                wire = _canonical_bytes({
                    "body": json.loads(bytes(row["request_body"])),
                    "requestSha256": row["request_sha256"],
                })
                request = parse_craft_launcher_request(wire)
                binding, authority = self._recovery_binding(request)
                cancellation = self.engine.cancel(
                    row["dispatch_id"], authority.limits.shutdown_grace_seconds)
                clean = (cancellation.cleanup_verified
                         and self._clear_outputs_if_authorized(
                             request, authority))
                receipt = {
                    "schemaVersion": 1, "dispatchId": row["dispatch_id"],
                    "requestSha256": row["request_sha256"], "status": "cancelled",
                    "cleanup": ("verified" if clean else "pending"),
                }
                state = "cancelled" if clean else "cleanup_pending"
                if self.journal.compare_and_set(
                        row["dispatch_id"], row["state"], state, receipt=receipt,
                        cleanup_verified=clean):
                    recovered += int(clean)
                    failed += int(not clean)
            except BaseException:
                failed += 1
        return {"recovered": recovered, "cleanupPending": failed}
