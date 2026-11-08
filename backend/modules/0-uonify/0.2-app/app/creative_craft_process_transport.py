"""Fail-closed boundary for a future server-owned Craft sandbox launcher.

Direct subprocess execution cannot enforce the sandbox declared by the Craft
request. This inactive transport validates the closed request shape but never
starts the configured command. A future implementation must replace it with an
audited container or namespace launcher before runtime activation.
"""

from dataclasses import dataclass
import os
from pathlib import Path

from .creative_craft_runtime import CraftRuntimeRequest


_ENGINE_BINARIES = {
    ('filmcraft', '0.9.0'):
        'fbcc344b985c4330c63f2e967e2e3c7be160c13b68c3dfd0861932e9949559aa',
    ('effectcraft', '0.11.1'):
        'b7a1757e4bc3a098ae9a47264378974d16c64418a4303079d2df1d9826b07abb',
    ('photocraft', '0.10.0'):
        '8c7b9652338c672110e2cc15cbd710f3ecac75132d78eabb1c09790773373922',
}
_SANDBOX_KEYS = frozenset({
    'networkAccess', 'googleCredentials', 'readOnlyRoot', 'inputRoot',
    'outputRoot', 'tmpfsRoot', 'cpuCores', 'memoryBytes', 'wallSeconds',
    'outputBytes', 'maxProcesses', 'maxLogBytes'})


class CraftProcessTransportError(RuntimeError):
    pass


def _validate_isolated_request(request: CraftRuntimeRequest) -> None:
    if not isinstance(request, CraftRuntimeRequest):
        raise ValueError('La petición local Craft no es válida.')
    body = request.body
    engine = body.get('engine')
    sandbox = body.get('sandbox')
    if (not isinstance(body.get('dispatchId'), str)
            or not isinstance(engine, dict)
            or set(engine) != {'name', 'version', 'binarySha256', 'platform'}
            or engine.get('platform') != 'linux-arm64'
            or _ENGINE_BINARIES.get(
                (engine.get('name'), engine.get('version')))
                != engine.get('binarySha256')
            or not isinstance(sandbox, dict)
            or set(sandbox) != _SANDBOX_KEYS
            or sandbox.get('networkAccess') is not False
            or sandbox.get('googleCredentials') is not False
            or sandbox.get('readOnlyRoot') is not True
            or sandbox.get('inputRoot') != '/work/inputs'
            or sandbox.get('outputRoot') != '/work/out'
            or sandbox.get('tmpfsRoot') != '/work/tmp'
            or not isinstance(sandbox.get('cpuCores'), int)
            or not 1 <= sandbox['cpuCores'] <= 64
            or not isinstance(sandbox.get('memoryBytes'), int)
            or not 64 * 1024 * 1024 <= sandbox['memoryBytes'] <= 256 * 1024**3
            or not isinstance(sandbox.get('wallSeconds'), int)
            or not 1 <= sandbox['wallSeconds'] <= 900
            or not isinstance(sandbox.get('outputBytes'), int)
            or not 1 <= sandbox['outputBytes'] <= 250 * 1024 * 1024
            or sandbox.get('maxProcesses') != 64
            or sandbox.get('maxLogBytes') != 1_048_576):
        raise ValueError('La petición local Craft no acredita aislamiento.')


@dataclass(frozen=True)
class LocalCraftProcessTransport:
    """Reject direct execution until an audited sandbox launcher exists.

    The command and working directory keep the future construction boundary
    explicit. They are validated but never passed to a subprocess.
    """

    command: tuple[str, ...]
    working_directory: str
    shutdown_grace_seconds: float = 1.0
    deadline_cap_seconds: float | None = None
    max_request_bytes: int = 4 * 1024 * 1024
    max_response_bytes: int = 8 * 1024 * 1024

    def __post_init__(self) -> None:
        executable = Path(self.command[0]) if self.command else None
        working = Path(self.working_directory)
        if (not self.command or executable is None
                or not executable.is_absolute() or not executable.is_file()
                or not os.access(executable, os.X_OK)
                or not working.is_absolute() or not working.is_dir()
                or not 0.05 <= self.shutdown_grace_seconds <= 30
                or (self.deadline_cap_seconds is not None
                    and not 0.05 <= self.deadline_cap_seconds <= 900)
                or not 1024 <= self.max_request_bytes <= 16 * 1024 * 1024
                or not 1024 <= self.max_response_bytes <= 64 * 1024 * 1024):
            raise ValueError('El transporte local Craft no es válido.')

    def dispatch(self, request: CraftRuntimeRequest) -> dict:
        _validate_isolated_request(request)
        raise CraftProcessTransportError(
            'El launcher aislado Craft no está configurado; ejecución denegada.')

    def cancel(self, request: CraftRuntimeRequest) -> dict:
        _validate_isolated_request(request)
        return {
            'schemaVersion': 1,
            'dispatchId': request.body['dispatchId'],
            'requestSha256': request.request_sha256,
            'status': 'already_terminal',
        }

    def forget(self, request: CraftRuntimeRequest) -> None:
        _validate_isolated_request(request)
