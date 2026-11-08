"""Server-owned execution authority for the inactive Craft launcher.

Nothing in this module is wired into API startup, settings, workers or routes.
It turns an already authenticated launcher request into an immutable local
execution plan whose image, binary, commands, paths and limits were selected
by the launcher owner.
"""

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
from types import MappingProxyType
from typing import Mapping, Protocol
from uuid import UUID

from .creative_craft_launcher_contract import (
    CraftLauncherContractError, CraftLauncherRequest,
)


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_PROFILE_ID = re.compile(r"[a-z][a-z0-9._-]{1,127}\Z")
_ENGINE = re.compile(r"(?:film|effect|photo)craft\Z")
_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
_OPERATION = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
_IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode()
    except (TypeError, ValueError):
        raise CraftLauncherContractError("La autoridad del launcher no es canónica.") from None


def _hash(value: object, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise CraftLauncherContractError(f"{label} no es SHA-256.")
    return value


def _uuid(value: object, label: str) -> str:
    try:
        result = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise CraftLauncherContractError(f"{label} no es UUID.") from None
    if result != value:
        raise CraftLauncherContractError(f"{label} no es UUID canónico.")
    return result


def _positive(value: object, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise CraftLauncherContractError(f"{label} sale del límite server-owned.")
    return value


@dataclass(frozen=True)
class CraftSandboxLimits:
    cpu_cores: int
    memory_bytes: int
    wall_seconds: int
    output_bytes: int
    max_processes: int = 64
    max_log_bytes: int = 1_048_576
    max_response_bytes: int = 8_388_608
    shutdown_grace_seconds: int = 3

    def __post_init__(self) -> None:
        _positive(self.cpu_cores, 1, 2, "cpuCores")
        _positive(self.memory_bytes, 256 * 1024**2, 2 * 1024**3, "memoryBytes")
        _positive(self.wall_seconds, 1, 900, "wallSeconds")
        _positive(self.output_bytes, 1, 2 * 1024**3, "outputBytes")
        _positive(self.max_processes, 1, 64, "maxProcesses")
        _positive(self.max_log_bytes, 1024, 1_048_576, "maxLogBytes")
        _positive(self.max_response_bytes, 1024, 8_388_608, "maxResponseBytes")
        _positive(self.shutdown_grace_seconds, 1, 5, "shutdownGraceSeconds")

    def canonical(self) -> dict:
        return {
            "cpuCores": self.cpu_cores, "memoryBytes": self.memory_bytes,
            "wallSeconds": self.wall_seconds, "outputBytes": self.output_bytes,
            "maxProcesses": self.max_processes,
            "maxLogBytes": self.max_log_bytes,
            "maxResponseBytes": self.max_response_bytes,
            "shutdownGraceSeconds": self.shutdown_grace_seconds,
        }


@dataclass(frozen=True)
class CraftLauncherProfile:
    profile_id: str
    engine: str
    version: str
    operation: str
    image_digest: str
    binary_path: str
    binary_sha256: str
    static_arguments: tuple[str, ...]
    container_uid: int = 10001
    container_gid: int = 10001
    platform: str = "linux-arm64"

    def __post_init__(self) -> None:
        if (not isinstance(self.profile_id, str)
                or not _PROFILE_ID.fullmatch(self.profile_id)
                or not isinstance(self.engine, str) or not _ENGINE.fullmatch(self.engine)
                or not isinstance(self.version, str) or not _VERSION.fullmatch(self.version)
                or not isinstance(self.operation, str)
                or not _OPERATION.fullmatch(self.operation)
                or self.platform != "linux-arm64"
                or not isinstance(self.image_digest, str)
                or not _IMAGE.fullmatch(self.image_digest)
                or not isinstance(self.binary_path, str)
                or not isinstance(self.static_arguments, tuple)
                or len(self.static_arguments) > 16
                or any(not isinstance(item, str) or not item or len(item) > 256
                       for item in self.static_arguments)
                or type(self.container_uid) is not int
                or type(self.container_gid) is not int
                or not 1 <= self.container_uid < 2**31
                or not 1 <= self.container_gid < 2**31):
            raise CraftLauncherContractError("El perfil del launcher no es seguro.")
        path = PurePosixPath(self.binary_path)
        if not path.is_absolute() or ".." in path.parts:
            raise CraftLauncherContractError("El binario del perfil no es seguro.")
        _hash(self.binary_sha256, "binarySha256")

    def canonical(self) -> dict:
        return {
            "profileId": self.profile_id, "engine": self.engine,
            "version": self.version, "operation": self.operation,
            "platform": self.platform, "imageDigest": self.image_digest,
            "binaryPath": self.binary_path,
            "binarySha256": self.binary_sha256,
            "staticArguments": list(self.static_arguments),
            "containerUid": self.container_uid,
            "containerGid": self.container_gid,
        }


@dataclass(frozen=True)
class CraftInputBinding:
    asset_id: str
    owner_user_id: str
    relative_path: str
    expected_sha256: str
    expected_bytes: int

    def __post_init__(self) -> None:
        if not isinstance(self.relative_path, str):
            raise CraftLauncherContractError("Un input del launcher no es seguro.")
        relative = PurePosixPath(self.relative_path)
        if (not self.relative_path or not relative.parts or relative.is_absolute()
                or any(part in ("", ".", "..") for part in relative.parts)
                or "\\" in self.relative_path
                or type(self.expected_bytes) is not int
                or not 0 <= self.expected_bytes <= 2 * 1024**3):
            raise CraftLauncherContractError("Un input del launcher no es seguro.")
        _uuid(self.asset_id, "assetId")
        _uuid(self.owner_user_id, "ownerUserId")
        _hash(self.expected_sha256, "expectedSha256")

    def canonical(self) -> dict:
        return {
            "assetId": self.asset_id, "ownerUserId": self.owner_user_id,
            "relativePath": self.relative_path,
            "expectedSha256": self.expected_sha256,
            "expectedBytes": self.expected_bytes,
        }


@dataclass(frozen=True)
class CraftLauncherAuthority:
    dispatch_id: str
    request_sha256: str
    owner_user_id: str
    attempt_id: str
    request_authority: bytes
    profile_id: str
    control_document: bytes
    input_root: Path
    output_root: Path
    inputs: tuple[CraftInputBinding, ...]
    expected_outputs: tuple[str, ...]
    limits: CraftSandboxLimits
    authority_sha256: str

    def __post_init__(self) -> None:
        _uuid(self.dispatch_id, "dispatchId")
        _uuid(self.owner_user_id, "ownerUserId")
        _uuid(self.attempt_id, "attemptId")
        _hash(self.request_sha256, "requestSha256")
        _hash(self.authority_sha256 or "0" * 64, "authoritySha256")
        if (not isinstance(self.request_authority, bytes)
                or not isinstance(self.control_document, bytes)
                or not 1 <= len(self.request_authority) <= 16 * 1024
                or not 1 <= len(self.control_document) <= 4 * 1024 * 1024
                or not isinstance(self.profile_id, str)
                or not _PROFILE_ID.fullmatch(self.profile_id)
                or not isinstance(self.inputs, tuple) or len(self.inputs) > 64
                or not isinstance(self.expected_outputs, tuple)
                or len(self.expected_outputs) > 4096
                or sum(item.expected_bytes for item in self.inputs) > 2 * 1024**3):
            raise CraftLauncherContractError("La autoridad del launcher no está acotada.")
        try:
            if _canonical_bytes(json.loads(self.request_authority)) != self.request_authority:
                raise ValueError
            if _canonical_bytes(json.loads(self.control_document)) != self.control_document:
                raise ValueError
        except (UnicodeError, json.JSONDecodeError, ValueError):
            raise CraftLauncherContractError("La autoridad del launcher no es canónica.") from None

    def canonical(self) -> dict:
        return {
            "dispatchId": self.dispatch_id,
            "requestSha256": self.request_sha256,
            "ownerUserId": self.owner_user_id,
            "attemptId": self.attempt_id,
            "requestAuthority": json.loads(self.request_authority),
            "profileId": self.profile_id,
            "controlSha256": sha256(self.control_document).hexdigest(),
            "inputRoot": str(self.input_root), "outputRoot": str(self.output_root),
            "inputs": [item.canonical() for item in self.inputs],
            "expectedOutputs": list(self.expected_outputs),
            "limits": self.limits.canonical(),
        }


@dataclass(frozen=True)
class CraftOutputCleanupAuthorization:
    """Fresh server-owned decision at the destructive filesystem boundary."""

    phase: str
    authority: CraftLauncherAuthority
    purge_authorized: bool

    def __post_init__(self) -> None:
        if (self.phase not in ("prestart", "recovery", "ack")
                or not isinstance(self.authority, CraftLauncherAuthority)
                or type(self.purge_authorized) is not bool):
            raise CraftLauncherContractError(
                "La autorización de limpieza Craft no es cerrada.")


class CraftAuthorityResolver(Protocol):
    def resolve(self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        ...


class CraftProfileRegistry:
    """Immutable launcher-owned profile allowlist."""

    def __init__(self, profiles: tuple[CraftLauncherProfile, ...]):
        values = {item.profile_id: item for item in profiles}
        if not profiles or len(values) != len(profiles):
            raise CraftLauncherContractError("La allowlist del launcher está duplicada.")
        self._profiles = MappingProxyType(values)

    def get(self, profile_id: str) -> CraftLauncherProfile:
        try:
            return self._profiles[profile_id]
        except KeyError:
            raise CraftLauncherContractError(
                "La autoridad refiere un perfil no permitido.") from None


class StaticCraftAuthorityResolver:
    """Synthetic-only resolver used to prove the disconnected boundary."""

    def __init__(self, records: tuple[CraftLauncherAuthority, ...]):
        values = {item.request_sha256: item for item in records}
        if not records or len(values) != len(records):
            raise CraftLauncherContractError("La autoridad sintética está duplicada.")
        self._records = MappingProxyType(values)

    def resolve(self, request: CraftLauncherRequest) -> CraftLauncherAuthority:
        record = self._records.get(request.request_sha256)
        if record is None:
            raise CraftLauncherContractError("El launcher no conoce esta autoridad.")
        body = request.body
        if (record.dispatch_id != body["dispatchId"]
                or record.owner_user_id != body["attempt"]["ownerUserId"]
                or record.attempt_id != body["attempt"]["attemptId"]
                or record.request_authority != _canonical_bytes(body["authority"])
                or record.authority_sha256
                != sha256(_canonical_bytes(record.canonical())).hexdigest()):
            raise CraftLauncherContractError("La autoridad del launcher fue alterada.")
        return record


def build_synthetic_authority(
    request: CraftLauncherRequest, *, profile_id: str, control_document: dict,
    input_root: Path, output_root: Path, inputs: tuple[CraftInputBinding, ...],
    expected_outputs: tuple[str, ...], limits: CraftSandboxLimits,
) -> CraftLauncherAuthority:
    """Create an immutable test record outside the untrusted wire request."""
    body = request.body
    control = _canonical_bytes(control_document)
    record = CraftLauncherAuthority(
        body["dispatchId"], request.request_sha256,
        body["attempt"]["ownerUserId"], body["attempt"]["attemptId"],
        _canonical_bytes(body["authority"]), profile_id, control,
        Path(input_root), Path(output_root), inputs, expected_outputs, limits, "",
    )
    digest = sha256(_canonical_bytes(record.canonical())).hexdigest()
    return CraftLauncherAuthority(
        record.dispatch_id, record.request_sha256, record.owner_user_id,
        record.attempt_id, record.request_authority, record.profile_id,
        record.control_document, record.input_root, record.output_root,
        record.inputs, record.expected_outputs, record.limits, digest,
    )


def verify_authority_files(record: CraftLauncherAuthority, owner_uid: int) -> None:
    """Verify synthetic staging without following links or accepting aliases."""
    if type(owner_uid) is not int or owner_uid < 0:
        raise CraftLauncherContractError("El UID propietario no es válido.")
    owner = record.owner_user_id
    seen_paths: set[str] = set()
    for original in (record.input_root, record.output_root):
        info = original.lstat()
        if (not original.is_absolute() or stat.S_ISLNK(info.st_mode)
                or original.parent.resolve(strict=True) != original.parent):
            raise CraftLauncherContractError("Una raíz de staging atraviesa un enlace.")
    input_root = record.input_root.resolve(strict=True)
    output_root = record.output_root.resolve(strict=True)
    if (input_root == output_root or input_root.parent != output_root.parent
            or input_root in output_root.parents or output_root in input_root.parents):
        raise CraftLauncherContractError("Las raíces de staging no están separadas.")
    parent = input_root.parent
    parent_info = parent.lstat()
    if (stat.S_ISLNK(parent_info.st_mode)
            or not stat.S_ISDIR(parent_info.st_mode)
            or parent_info.st_uid != owner_uid
            or parent_info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)):
        raise CraftLauncherContractError("La raíz de staging común no es segura.")
    for root, empty in ((input_root, False), (output_root, True)):
        info = root.lstat()
        if (not root.is_absolute() or stat.S_ISLNK(info.st_mode)
                or not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
                or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)):
            raise CraftLauncherContractError("La raíz de staging no es segura.")
        if empty and any(root.iterdir()):
            raise CraftLauncherContractError("La salida no comienza vacía.")
    for binding in record.inputs:
        if binding.owner_user_id != owner or binding.relative_path in seen_paths:
            raise CraftLauncherContractError("Los inputs cruzan cuenta o se repiten.")
        seen_paths.add(binding.relative_path)
        path = input_root.joinpath(*PurePosixPath(binding.relative_path).parts)
        current = input_root
        for part in PurePosixPath(binding.relative_path).parts[:-1]:
            current /= part
            info = current.lstat()
            if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                    or info.st_uid != owner_uid
                    or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)):
                raise CraftLauncherContractError("Un input atraviesa un enlace.")
        info = path.lstat()
        if (stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1 or info.st_uid != owner_uid
                or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
                or info.st_size != binding.expected_bytes):
            raise CraftLauncherContractError("Un input no es un fichero regular único.")
        digest = sha256()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            opened = os.fstat(descriptor)
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise CraftLauncherContractError("Un input cambió durante su apertura.")
            while chunk := os.read(descriptor, 1024 * 1024):
                digest.update(chunk)
            closed = os.fstat(descriptor)
            if (closed.st_size, closed.st_mtime_ns) != (info.st_size, info.st_mtime_ns):
                raise CraftLauncherContractError("Un input cambió durante su lectura.")
        finally:
            os.close(descriptor)
        if digest.hexdigest() != binding.expected_sha256:
            raise CraftLauncherContractError("Los bytes del input no coinciden.")
    actual = set()
    for path in input_root.rglob("*"):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not (
                stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise CraftLauncherContractError("El staging contiene una entrada insegura.")
        if (stat.S_ISDIR(info.st_mode)
                and (info.st_uid != owner_uid
                     or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH))):
            raise CraftLauncherContractError("El staging contiene un directorio inseguro.")
        if stat.S_ISREG(info.st_mode):
            actual.add(str(path.relative_to(input_root)))
    if actual != seen_paths:
        raise CraftLauncherContractError("El staging contiene inputs no autorizados.")
    if len(set(record.expected_outputs)) != len(record.expected_outputs):
        raise CraftLauncherContractError("Las salidas esperadas están duplicadas.")
    for value in record.expected_outputs:
        path = PurePosixPath(value)
        if (not value or not path.parts or path.is_absolute()
                or any(part in ("", ".", "..") for part in path.parts)
                or "\\" in value):
            raise CraftLauncherContractError("Una salida esperada no es segura.")
