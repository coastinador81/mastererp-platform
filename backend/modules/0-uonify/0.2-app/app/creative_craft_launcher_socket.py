"""Private Unix-socket protocol for the disconnected Craft launcher.

This module has no FastAPI route, TCP listener or application startup hook.
Linux peer credentials and filesystem permissions are mandatory for serving.
"""

from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import socket
import stat
import struct
from threading import BoundedSemaphore, Event

from .creative_craft_launcher import CraftLauncherService
from .creative_craft_launcher_contract import (
    CraftLauncherContractError, parse_craft_launcher_request,
)


_MAX_FRAME = 128 * 1024
_OPERATIONS = frozenset({
    "reserve", "dispatch", "cancel", "status", "acknowledge",
    "compensate_prestart",
})


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _no_duplicates(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise CraftLauncherContractError("El protocolo privado repite una clave.")
        value[key] = item
    return value


def receive_frame(connection: socket.socket) -> bytes:
    payload, _ancillary, flags, _address = connection.recvmsg(_MAX_FRAME + 5)
    if flags & getattr(socket, "MSG_TRUNC", 0):
        raise CraftLauncherContractError("El frame privado excede su límite.")
    if len(payload) < 4:
        raise CraftLauncherContractError("El frame privado quedó truncado.")
    size = struct.unpack("!I", payload[:4])[0]
    if not 1 <= size <= _MAX_FRAME:
        raise CraftLauncherContractError("El frame privado excede su límite.")
    if len(payload) < size + 4:
        raise CraftLauncherContractError("El frame privado quedó truncado.")
    if len(payload) > size + 4:
        raise CraftLauncherContractError("El frame privado contiene bytes extra.")
    return payload[4:]


def send_frame(connection: socket.socket, value: dict) -> None:
    payload = _canonical_bytes(value)
    if len(payload) > _MAX_FRAME:
        raise CraftLauncherContractError("La respuesta privada excede su límite.")
    connection.sendall(struct.pack("!I", len(payload)) + payload)


def peer_uid(connection: socket.socket) -> int:
    if not hasattr(socket, "SO_PEERCRED"):
        raise CraftLauncherContractError("SO_PEERCRED no está disponible.")
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
    _pid, uid, _gid = struct.unpack("3i", raw)
    if uid < 0:
        raise CraftLauncherContractError("El peer del launcher no es válido.")
    return uid


def parse_operation(payload: bytes) -> tuple[str, object]:
    try:
        value = json.loads(payload.decode(), object_pairs_hook=_no_duplicates)
    except (UnicodeError, json.JSONDecodeError):
        raise CraftLauncherContractError("El protocolo privado no es JSON UTF-8.") from None
    if _canonical_bytes(value) != payload:
        raise CraftLauncherContractError("La operación privada no es canónica.")
    if (not isinstance(value, dict)
            or set(value) != {"schemaVersion", "operation", "request"}
            or value["schemaVersion"] != 1
            or value["operation"] not in _OPERATIONS
            or not isinstance(value["request"], dict)):
        raise CraftLauncherContractError("La operación privada no tiene forma cerrada.")
    request = parse_craft_launcher_request(_canonical_bytes(value["request"]))
    return value["operation"], request


@dataclass
class CraftLauncherSocketServer:
    path: Path
    service: CraftLauncherService
    allowed_peer_uid: int
    allowed_peer_gid: int

    def __post_init__(self) -> None:
        self.path = Path(self.path)
        if (not self.path.is_absolute() or type(self.allowed_peer_uid) is not int
                or self.allowed_peer_uid <= 0
                or self.allowed_peer_uid == os.getuid()
                or type(self.allowed_peer_gid) is not int
                or self.allowed_peer_gid <= 0):
            raise CraftLauncherContractError("La configuración UDS no es válida.")

    def _prepare_path(self) -> None:
        parent = self.path.parent
        if parent.exists() or parent.is_symlink():
            info = parent.lstat()
            if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                    or info.st_uid != os.getuid()
                    or info.st_gid != self.allowed_peer_gid
                    or stat.S_IMODE(info.st_mode) != 0o710):
                raise CraftLauncherContractError("La raíz UDS no es segura.")
        else:
            ancestor = parent.parent.resolve(strict=True)
            if ancestor != parent.parent:
                raise CraftLauncherContractError("La raíz UDS atraviesa un enlace.")
            parent.mkdir(mode=0o710, parents=True)
            try:
                os.chown(parent, -1, self.allowed_peer_gid)
            except OSError:
                raise CraftLauncherContractError(
                    "El grupo privado UDS no pudo fijarse.") from None
            os.chmod(parent, 0o710)
        if parent.resolve(strict=True) != parent:
            raise CraftLauncherContractError("La raíz UDS atraviesa un enlace.")
        info = parent.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise CraftLauncherContractError("La raíz UDS no es segura.")
        if self.path.exists() or self.path.is_symlink():
            existing = self.path.lstat()
            if (stat.S_ISLNK(existing.st_mode)
                    or not stat.S_ISSOCK(existing.st_mode)
                    or existing.st_uid != os.getuid()):
                raise CraftLauncherContractError("El path UDS existente no es seguro.")
            self.path.unlink()

    def _handle(self, connection: socket.socket) -> None:
        with connection:
            connection.settimeout(5)
            try:
                if peer_uid(connection) != self.allowed_peer_uid:
                    raise CraftLauncherContractError(
                        "El peer no pertenece al worker permitido.")
                operation, request = parse_operation(receive_frame(connection))
                result = getattr(self.service, operation)(request)
                response = {"ok": True, "result": result}
            except Exception:
                response = {
                    "ok": False,
                    "error": {
                        "code": "launcher_rejected",
                        "message": "La operación privada fue rechazada.",
                    },
                }
            try:
                send_frame(connection, response)
            except (BrokenPipeError, ConnectionError, OSError):
                return

    def serve(self, stop: Event) -> None:
        """Serve one canonical operation per connection until ``stop`` is set."""
        if not isinstance(stop, Event):
            raise CraftLauncherContractError("El control del launcher no es válido.")
        self._prepare_path()
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        capacity = BoundedSemaphore(32)

        def bounded_handle(connection: socket.socket) -> None:
            try:
                self._handle(connection)
            finally:
                capacity.release()

        try:
            listener.bind(str(self.path))
            try:
                os.chown(self.path, -1, self.allowed_peer_gid)
            except OSError:
                raise CraftLauncherContractError(
                    "El grupo privado del socket no pudo fijarse.") from None
            os.chmod(self.path, 0o660)
            listener.listen(16)
            listener.settimeout(0.25)
            with ThreadPoolExecutor(
                    max_workers=16, thread_name_prefix="craft-launcher") as pool:
                while not stop.is_set():
                    if not capacity.acquire(timeout=0.25):
                        continue
                    try:
                        connection, _address = listener.accept()
                    except socket.timeout:
                        capacity.release()
                        continue
                    except BaseException:
                        capacity.release()
                        raise
                    pool.submit(bounded_handle, connection)
        finally:
            listener.close()
            if self.path.exists() and stat.S_ISSOCK(self.path.lstat().st_mode):
                self.path.unlink()
