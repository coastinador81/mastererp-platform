"""Inactive durable sink for descriptor-verified Craft inputs.

The sink writes only inside one pre-created, server-owned directory.  Every
component is opened relative to a pinned directory descriptor with NOFOLLOW;
files are published create-only, fsynced, and then re-read from their final
descriptor before the point-in-time physical receipt is accepted.

POSIX cannot conditionally unlink a directory entry by an already verified
inode.  Consequently this class never deletes a published name after an error:
it fails closed and leaves that generation for the Gate 120B reconciler.  That
reconciler must own an exclusive namespace lease, a durable generation journal
and the descriptor hand-off to the uploader.  Until then a receipt is not an
authorization to upload by pathname.  This module has no runtime, route,
provider, GCS, or startup wiring.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import stat
from uuid import UUID

from .creative_craft_input_authority import (
    CraftDescriptorSink,
    CraftIOGuard,
    CraftInputAuthorityError,
)
from .creative_craft_launcher_authority import CraftInputBinding


_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_CLOEXEC = getattr(os, "O_CLOEXEC", 0)


def _file_identity(observed: os.stat_result) -> tuple[int, ...]:
    return (
        observed.st_dev, observed.st_ino, observed.st_uid,
        stat.S_IMODE(observed.st_mode), observed.st_size, observed.st_nlink,
    )


def _canonical(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _safe_parts(value: str) -> tuple[str, ...]:
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or str(path) != value
            or "\\" in value or len(path.parts) > 32
            or any(part in ("", ".", "..")
                   or len(os.fsencode(part)) > 255 for part in path.parts)):
        raise CraftInputAuthorityError("El destino del sink no es seguro.")
    return path.parts


@dataclass(frozen=True)
class _StoredInput:
    relative_path: str
    byte_size: int
    sha256: str
    device: int
    inode: int
    owner_uid: int
    mode: int
    binding: dict

    def canonical(self) -> dict:
        return {
            "relativePath": self.relative_path,
            "byteSize": self.byte_size,
            "sha256": self.sha256,
            "device": self.device,
            "inode": self.inode,
            "ownerUid": self.owner_uid,
            "mode": self.mode,
        }


class DurableCraftDescriptorSink(CraftDescriptorSink):
    """Create-only local sink used to prove the Gate 119 physical boundary."""

    def __init__(self, root: Path, *, owner_uid: int, session_id: str,
                 max_total_bytes: int = 2 * 1024**3) -> None:
        try:
            canonical_session = str(UUID(session_id))
        except (TypeError, ValueError, AttributeError):
            raise CraftInputAuthorityError(
                "La sesión del sink no es canónica.") from None
        if (not isinstance(root, Path) or not root.is_absolute()
                or type(owner_uid) is not int or owner_uid < 0
                or type(max_total_bytes) is not int
                or not 1 <= max_total_bytes <= 2 * 1024**3):
            raise CraftInputAuthorityError(
                "La raíz del sink no es server-owned.")
        descriptor = os.open(
            root, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC)
        observed = os.fstat(descriptor)
        mode = stat.S_IMODE(observed.st_mode)
        if (not stat.S_ISDIR(observed.st_mode)
                or observed.st_uid != owner_uid or mode & 0o022):
            os.close(descriptor)
            raise CraftInputAuthorityError(
                "La raíz del sink no es un directorio privado.")
        self._root_path = root
        self._root_fd: int | None = descriptor
        self._root_identity = (observed.st_dev, observed.st_ino,
                               observed.st_uid, mode)
        self._owner_uid = owner_uid
        self._session_id = canonical_session
        self._max_total_bytes = max_total_bytes
        self._state = "open"
        self._current: dict | None = None
        self._stored: list[_StoredInput] = []
        self._published: dict[str, tuple[int, int]] = {}
        self._total = 0

    def _require_open(self) -> int:
        if self._state != "open" or self._root_fd is None:
            raise CraftInputAuthorityError("El sink ya no está disponible.")
        return self._root_fd

    def _parent(self, relative_path: str, *, create: bool) -> tuple[int, str]:
        parts = _safe_parts(relative_path)
        if create:
            root_fd = self._require_open()
        else:
            root_fd = self._root_fd
            if self._state not in {"open", "cleanup_required"} or root_fd is None:
                raise CraftInputAuthorityError("El sink ya no está disponible.")
        descriptor = os.dup(root_fd)
        try:
            for part in parts[:-1]:
                if create:
                    try:
                        os.mkdir(part, mode=0o700, dir_fd=descriptor)
                    except FileExistsError:
                        pass
                child = os.open(
                    part, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                    dir_fd=descriptor)
                observed = os.fstat(child)
                if (not stat.S_ISDIR(observed.st_mode)
                        or observed.st_uid != self._owner_uid
                        or stat.S_IMODE(observed.st_mode) & 0o022):
                    os.close(child)
                    raise CraftInputAuthorityError(
                        "Un directorio del sink no es privado.")
                os.close(descriptor)
                descriptor = child
            return descriptor, parts[-1]
        except BaseException:
            os.close(descriptor)
            raise

    def begin_input(self, binding: CraftInputBinding, *,
                    guard: CraftIOGuard) -> None:
        guard.checkpoint()
        if not isinstance(binding, CraftInputBinding) or self._current is not None:
            raise CraftInputAuthorityError("El sink recibió un input inválido.")
        parent_fd, leaf = self._parent(binding.relative_path, create=True)
        temporary = f".{leaf}.{self._session_id}.part"
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW | _CLOEXEC,
                0o600, dir_fd=parent_fd)
        except BaseException:
            os.close(parent_fd)
            raise
        self._current = {
            "binding": binding, "parentFd": parent_fd, "leaf": leaf,
            "temporary": temporary, "fd": descriptor, "hash": sha256(),
            "bytes": 0,
        }

    def write_chunk(self, relative_path: str, chunk: bytes, *,
                    guard: CraftIOGuard) -> None:
        guard.checkpoint()
        current = self._current
        if (current is None or relative_path != current["binding"].relative_path
                or not isinstance(chunk, bytes) or not chunk):
            raise CraftInputAuthorityError("El chunk del sink no es válido.")
        projected = self._total + current["bytes"] + len(chunk)
        if projected > self._max_total_bytes:
            raise CraftInputAuthorityError("El sink excedió su cota durable.")
        view = memoryview(chunk)
        while view:
            guard.checkpoint()
            written = os.write(current["fd"], view)
            if written <= 0:
                raise CraftInputAuthorityError("El sink no avanzó la escritura.")
            current["hash"].update(view[:written])
            current["bytes"] += written
            view = view[written:]

    def finish_input(self, relative_path: str, byte_size: int, sha256: str, *,
                     guard: CraftIOGuard) -> None:
        guard.checkpoint()
        current = self._current
        if current is None or relative_path != current["binding"].relative_path:
            raise CraftInputAuthorityError("El cierre del sink no coincide.")
        binding = current["binding"]
        digest = current["hash"].hexdigest()
        if (byte_size != current["bytes"] or sha256 != digest
                or binding.expected_bytes != byte_size
                or binding.expected_sha256 != sha256):
            raise CraftInputAuthorityError("El sink no recibió los bytes exactos.")
        os.fsync(current["fd"])
        written = os.fstat(current["fd"])
        mode = stat.S_IMODE(written.st_mode)
        if (not stat.S_ISREG(written.st_mode) or written.st_nlink != 1
                or written.st_uid != self._owner_uid or mode & 0o022
                or written.st_size != byte_size):
            raise CraftInputAuthorityError("El fichero del sink no es privado.")
        current["writtenIdentity"] = (written.st_dev, written.st_ino)
        current["published"] = False
        # Set before the syscall so an asynchronous exception immediately
        # after a successful link can never make cleanup treat the generation
        # as unpublished and unlink by a stale name assumption.
        current["publicationAttempted"] = True
        try:
            os.link(current["temporary"], current["leaf"],
                    src_dir_fd=current["parentFd"],
                    dst_dir_fd=current["parentFd"], follow_symlinks=False)
            current["published"] = True
            self._published[relative_path] = current["writtenIdentity"]
            os.unlink(current["temporary"], dir_fd=current["parentFd"])
            os.fsync(current["parentFd"])
            final_fd = os.open(
                current["leaf"], os.O_RDONLY | _NOFOLLOW | _CLOEXEC,
                dir_fd=current["parentFd"])
            try:
                final = os.fstat(final_fd)
                named = os.stat(
                    current["leaf"], dir_fd=current["parentFd"],
                    follow_symlinks=False)
                expected_identity = (
                    written.st_dev, written.st_ino, written.st_uid,
                    mode, byte_size, 1,
                )
                if (not stat.S_ISREG(final.st_mode)
                        or not stat.S_ISREG(named.st_mode)
                        or _file_identity(final) != expected_identity
                        or _file_identity(named) != expected_identity):
                    raise CraftInputAuthorityError(
                        "La publicación del sink cambió el fichero.")
            finally:
                os.close(final_fd)
        except BaseException:
            cleanup_errors = self._cleanup_current(current)
            try:
                os.close(current["fd"])
            except BaseException as error:
                cleanup_errors.append(error)
            finally:
                current["fd"] = None
            if cleanup_errors:
                self._state = "cleanup_required"
                if current.get("parentFd") is not None:
                    try:
                        os.close(current["parentFd"])
                    except BaseException:
                        pass
                    current["parentFd"] = None
                if self._root_fd is not None:
                    try:
                        os.close(self._root_fd)
                    except BaseException:
                        pass
                    self._root_fd = None
            else:
                os.close(current["parentFd"])
                current["parentFd"] = None
                self._current = None
            raise
        os.close(current["fd"])
        current["fd"] = None
        os.close(current["parentFd"])
        current["parentFd"] = None
        stored = _StoredInput(relative_path, byte_size, sha256,
                              written.st_dev, written.st_ino, written.st_uid,
                              mode, binding.canonical())
        self._stored.append(stored)
        self._total += byte_size
        self._current = None
        guard.checkpoint()

    def _cleanup_current(self, current: dict) -> list[BaseException]:
        """Clean an unpublished temporary or defer a published generation."""
        failures: list[BaseException] = []
        parent_fd = current.get("parentFd")
        if parent_fd is None:
            return [CraftInputAuthorityError(
                "El journal del sink perdió el descriptor padre.")]
        if current.get("publicationAttempted"):
            # Checking an inode and then unlinking its name is a TOCTOU.  Keep
            # every published name intact until Gate 120B supplies an exclusive
            # namespace lease and a durable generation-level reconciler.
            return [CraftInputAuthorityError(
                "La publicación requiere reconciliación Gate 120B en un "
                "namespace exclusivo.")]
        try:
            os.unlink(current["temporary"], dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        except BaseException as error:
            failures.append(error)
        try:
            os.fsync(parent_fd)
        except BaseException as error:
            failures.append(error)
        return failures

    def commit(self, *, guard: CraftIOGuard) -> dict:
        guard.checkpoint()
        root_fd = self._require_open()
        if self._current is not None:
            raise CraftInputAuthorityError("El sink conserva un input abierto.")
        os.fsync(root_fd)
        # This is intentionally the canonical logical input tree used by the
        # 116 materialization challenge.  Physical identity is revalidated
        # independently below and is never represented by this digest.
        inputs_sha256 = sha256(_canonical(
            [item.binding for item in self._stored])).hexdigest()
        receipt = {"schemaVersion": 1, "inputsSha256": inputs_sha256}
        if self.verify_receipt(receipt, guard=guard, _root_fd=root_fd) is not True:
            raise CraftInputAuthorityError(
                "El receipt físico del sink no pudo verificarse.")
        self._state = "committed"
        os.close(root_fd)
        self._root_fd = None
        return receipt

    def verify_receipt(self, receipt: dict, *, guard: CraftIOGuard,
                       _root_fd: int | None = None) -> bool:
        guard.checkpoint()
        if (not isinstance(receipt, dict)
                or set(receipt) != {"schemaVersion", "inputsSha256"}
                or receipt.get("schemaVersion") != 1
                or not isinstance(receipt.get("inputsSha256"), str)
                or len(receipt["inputsSha256"]) != 64):
            return False
        own_descriptor = _root_fd is None
        root_fd = (_root_fd if _root_fd is not None else os.open(
            self._root_path,
            os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC))
        try:
            root = os.fstat(root_fd)
            if (root.st_dev, root.st_ino, root.st_uid,
                    stat.S_IMODE(root.st_mode)) != self._root_identity:
                return False
            observed: list[dict] = []
            for expected in self._stored:
                guard.checkpoint()
                parent_fd, leaf = self._parent_for_root(
                    root_fd, expected.relative_path)
                try:
                    descriptor = os.open(
                        leaf, os.O_RDONLY | _NOFOLLOW | _CLOEXEC,
                        dir_fd=parent_fd)
                    try:
                        identity_before = os.fstat(descriptor)
                        digest = sha256()
                        size = 0
                        while True:
                            guard.checkpoint()
                            chunk = os.read(descriptor, 1024 * 1024)
                            if not chunk:
                                break
                            digest.update(chunk)
                            size += len(chunk)
                        guard.checkpoint()
                        identity_after = os.fstat(descriptor)
                        named = os.stat(
                            leaf, dir_fd=parent_fd, follow_symlinks=False)
                    finally:
                        os.close(descriptor)
                finally:
                    os.close(parent_fd)
                expected_identity = (
                    expected.device, expected.inode, expected.owner_uid,
                    expected.mode, expected.byte_size, 1,
                )
                if (not stat.S_ISREG(identity_before.st_mode)
                    or not stat.S_ISREG(identity_after.st_mode)
                    or not stat.S_ISREG(named.st_mode)
                    or _file_identity(identity_before) != expected_identity
                    or _file_identity(identity_after) != expected_identity
                    or _file_identity(named) != expected_identity
                    or (size, digest.hexdigest()) !=
                       (expected.byte_size, expected.sha256)):
                    return False
                observed.append(expected.canonical())
            actual = sha256(_canonical(
                [item.binding for item in self._stored])).hexdigest()
            return actual == receipt["inputsSha256"]
        finally:
            if own_descriptor:
                os.close(root_fd)

    def _parent_for_root(self, root_fd: int, relative_path: str) -> tuple[int, str]:
        parts = _safe_parts(relative_path)
        descriptor = os.dup(root_fd)
        try:
            for part in parts[:-1]:
                child = os.open(
                    part, os.O_RDONLY | _DIRECTORY | _NOFOLLOW | _CLOEXEC,
                    dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            return descriptor, parts[-1]
        except BaseException:
            os.close(descriptor)
            raise

    def abort(self) -> None:
        if self._state not in {"open", "cleanup_required"}:
            return
        failures: list[BaseException] = []
        current = self._current
        if current is not None:
            if current.get("fd") is not None:
                os.close(current["fd"])
                current["fd"] = None
            if current.get("parentFd") is not None:
                failures.extend(self._cleanup_current(current))
                if not failures:
                    os.close(current["parentFd"])
                    current["parentFd"] = None
                    self._current = None
            elif self._state == "cleanup_required":
                failures.append(CraftInputAuthorityError(
                    "La generación pendiente perdió su descriptor y requiere "
                    "reconciliación Gate 120B."))
        if self._published:
            failures.append(CraftInputAuthorityError(
                "La publicación requiere reconciliación Gate 120B en un "
                "namespace exclusivo."))
        if failures:
            self._state = "cleanup_required"
            if current is not None and current.get("parentFd") is not None:
                try:
                    os.close(current["parentFd"])
                except BaseException:
                    pass
                current["parentFd"] = None
            if self._root_fd is not None:
                try:
                    os.close(self._root_fd)
                except BaseException:
                    pass
                self._root_fd = None
            raise CraftInputAuthorityError(
                "La limpieza física del sink requiere reconciliación.") from failures[0]
        self._stored.clear()
        self._state = "aborted"
        if self._root_fd is not None:
            os.close(self._root_fd)
            self._root_fd = None
