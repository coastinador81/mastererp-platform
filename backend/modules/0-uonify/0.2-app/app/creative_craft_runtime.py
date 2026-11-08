"""Inactive transport boundary for one isolated Craft runtime dispatch.

The module prepares a closed, credential-free envelope for a companion runtime.
It does not start a process, container, queue, route or external connection.
"""

from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from threading import Lock
from typing import Protocol
from uuid import NAMESPACE_URL, uuid5

from .craft_capabilities import capability_for
from .craft_contracts import (CraftAdapterPlan, CraftAttempt, ResolvedCraftJob,
                              canonical_sha256, craft_input_expected_sha256,
                              craft_input_path, resolved_job_binding_sha256)
from .creative_craft_worker import CraftExecutionResult, CraftExecutionPort


RUNTIME_NAMESPACE = NAMESPACE_URL
_LINUX_ARM64_BINARIES = {
    ('filmcraft', '0.9.0'):
        'fbcc344b985c4330c63f2e967e2e3c7be160c13b68c3dfd0861932e9949559aa',
    ('effectcraft', '0.11.1'):
        'b7a1757e4bc3a098ae9a47264378974d16c64418a4303079d2df1d9826b07abb',
    ('photocraft', '0.10.0'):
        '8c7b9652338c672110e2cc15cbd710f3ecac75132d78eabb1c09790773373922',
}


@dataclass(frozen=True)
class CraftRuntimeRequest:
    body: dict
    request_sha256: str


class CraftRuntimeTransport(Protocol):
    """Dispatches one envelope to an independently isolated runtime."""

    def dispatch(self, request: CraftRuntimeRequest) -> dict:
        ...

    def cancel(self, request: CraftRuntimeRequest) -> dict:
        ...


def _safe_relative(value: str, prefix: str) -> bool:
    if not isinstance(value, str) or not value.startswith(prefix):
        return False
    path = PurePosixPath(value)
    return (not path.is_absolute()
            and all(part not in ('', '.', '..') for part in path.parts))


def _adapter_payload(adapter: CraftAdapterPlan) -> dict:
    return {
        'schemaVersion': adapter.schema_version, 'jobId': adapter.job_id,
        'inputManifestSha256': adapter.input_manifest_sha256,
        'engine': {'name': adapter.engine.name, 'version': adapter.engine.version},
        'operation': adapter.operation,
        'inputs': list(adapter.inputs),
        'jobBindingSha256': adapter.job_binding_sha256,
        'commands': [{'id': item.id, 'params': item.params}
                     for item in adapter.commands],
        'nativeProjectRelativePath': adapter.native_project_relative_path,
        'outputRelativePath': adapter.output_relative_path,
    }


def build_craft_runtime_request(job: ResolvedCraftJob,
                                adapter: CraftAdapterPlan,
                                attempt: CraftAttempt) -> CraftRuntimeRequest:
    """Build a minimal dispatch bound to persisted job/adapter authority."""
    capability = capability_for(job.engine.name, job.engine.version, job.operation)
    binary_sha = _LINUX_ARM64_BINARIES.get((job.engine.name, job.engine.version))
    adapter_payload = _adapter_payload(adapter)
    if (not binary_sha or attempt.job_id != job.job_id
            or adapter.job_id != job.job_id
            or adapter.engine != job.engine or adapter.operation != job.operation
            or adapter.input_manifest_sha256 != job.input_manifest_sha256
            or adapter.job_binding_sha256 != resolved_job_binding_sha256(job)
            or adapter.plan_sha256 != canonical_sha256(adapter_payload)
            or job.limits.network_access or job.limits.google_credentials
            or any(item.id not in capability.commands for item in adapter.commands)
            or not _safe_relative(adapter.native_project_relative_path,
                                  f'out/{job.engine.name}/')
            or not _safe_relative(adapter.output_relative_path,
                                  f'out/{job.engine.name}/')):
        raise ValueError('La autoridad Craft no admite un dispatch aislado.')
    expected_inputs = tuple({
        'assetId': item.asset_id, 'path': craft_input_path(item),
        'expectedSha256': craft_input_expected_sha256(item),
        'storageGeneration': item.storage_receipt.generation}
        for item in job.inputs)
    if (len(adapter.inputs) != len(job.inputs)
            or tuple(adapter.inputs) != expected_inputs
            or any(not row['path'].startswith('/work/inputs/')
                   for row in expected_inputs)):
        raise ValueError('Los mounts Craft no coinciden con la autoridad.')
    dispatch_id = str(uuid5(
        RUNTIME_NAMESPACE, f'uonify:craft:{attempt.attempt_id}'))
    body = {
        'schemaVersion': 1, 'dispatchId': dispatch_id,
        'attempt': {'jobId': attempt.job_id,
                    'attemptId': attempt.attempt_id,
                    'leaseToken': attempt.lease_token},
        'engine': {'name': job.engine.name, 'version': job.engine.version,
                   'binarySha256': binary_sha, 'platform': 'linux-arm64'},
        'operation': job.operation,
        'bindings': {
            'jobBindingSha256': adapter.job_binding_sha256,
            'inputManifestSha256': adapter.input_manifest_sha256,
            'adapterPlanSha256': adapter.plan_sha256},
        'sandbox': {
            'networkAccess': False, 'googleCredentials': False,
            'readOnlyRoot': True, 'inputRoot': '/work/inputs',
            'outputRoot': '/work/out', 'tmpfsRoot': '/work/tmp',
            'cpuCores': job.limits.cpu_cores,
            'memoryBytes': job.limits.memory_bytes,
            'wallSeconds': job.limits.wall_seconds,
            'outputBytes': job.limits.output_bytes,
            'maxProcesses': 64, 'maxLogBytes': 1_048_576},
        'inputs': list(adapter.inputs),
        'commands': adapter_payload['commands'],
        'nativeProjectRelativePath': adapter.native_project_relative_path,
        'outputRelativePath': adapter.output_relative_path,
    }
    return CraftRuntimeRequest(deepcopy(body), canonical_sha256(body))


@dataclass(frozen=True)
class IsolatedCraftExecutionPort(CraftExecutionPort):
    """Validates the companion receipt; the worker validates the candidate."""

    transport: CraftRuntimeTransport
    _active: dict[str, CraftRuntimeRequest] = field(
        default_factory=dict, init=False, repr=False, compare=False)
    _terminal: OrderedDict[tuple[str, str, str], str] = field(
        default_factory=OrderedDict, init=False, repr=False, compare=False)
    _cancelled: OrderedDict[tuple[str, str, str], None] = field(
        default_factory=OrderedDict, init=False, repr=False, compare=False)
    _prepared: set[tuple[str, str, str]] = field(
        default_factory=set, init=False, repr=False, compare=False)
    _lock: Lock = field(default_factory=Lock, init=False, repr=False,
                        compare=False)
    _cancel_locks: dict[tuple[str, str, str], Lock] = field(
        default_factory=dict, init=False, repr=False, compare=False)
    _cancel_lock_refs: dict[tuple[str, str, str], int] = field(
        default_factory=dict, init=False, repr=False, compare=False)

    def _remember_terminal(self, key: tuple[str, str, str], status: str) -> None:
        self._terminal[key] = status
        self._terminal.move_to_end(key)

    def _remember_cancelled(self, key: tuple[str, str, str]) -> None:
        self._cancelled[key] = None
        self._cancelled.move_to_end(key)

    @staticmethod
    def _key(attempt: CraftAttempt) -> tuple[str, str, str]:
        return attempt.job_id, attempt.attempt_id, attempt.lease_token

    def prepare(self, attempt: CraftAttempt) -> None:
        """Register an expected dispatch before the runner starts its thread."""
        if not isinstance(attempt, CraftAttempt):
            raise ValueError('El intento Craft preparado no es válido.')
        key = self._key(attempt)
        with self._lock:
            if key in self._terminal:
                raise ValueError('El intento Craft preparado ya es terminal.')
            self._prepared.add(key)

    def cleanup(self, attempt: CraftAttempt) -> None:
        """Release transient state after the handler can no longer dispatch."""
        key = self._key(attempt)
        with self._lock:
            request = self._active.get(attempt.attempt_id)
            if request is not None:
                bound = request.body['attempt']
                if (bound['jobId'], bound['attemptId'],
                        bound['leaseToken']) == key:
                    return
            self._prepared.discard(key)
            self._cancelled.pop(key, None)
            if (self._cancel_lock_refs.get(key, 0) == 0
                    and self._terminal.get(key) != 'cancel_requested'):
                self._cancel_locks.pop(key, None)
                self._cancel_lock_refs.pop(key, None)

    def _acquire_cancel_lock(self, key: tuple[str, str, str]) -> Lock:
        with self._lock:
            cancel_lock = self._cancel_locks.setdefault(key, Lock())
            self._cancel_lock_refs[key] = self._cancel_lock_refs.get(key, 0) + 1
        cancel_lock.acquire()
        return cancel_lock

    def _release_cancel_lock(self, key: tuple[str, str, str],
                             cancel_lock: Lock) -> None:
        cancel_lock.release()
        with self._lock:
            remaining = self._cancel_lock_refs[key] - 1
            if remaining:
                self._cancel_lock_refs[key] = remaining
            else:
                self._cancel_lock_refs.pop(key, None)
                if self._terminal.get(key) != 'cancel_requested':
                    self._cancel_locks.pop(key, None)

    def execute(self, job: ResolvedCraftJob, adapter: CraftAdapterPlan,
                attempt: CraftAttempt) -> CraftExecutionResult:
        request = build_craft_runtime_request(job, adapter, attempt)
        if (not callable(getattr(self.transport, 'dispatch', None))
                or not callable(getattr(self.transport, 'cancel', None))):
            raise ValueError('El transporte Craft no admite cancelación cercada.')
        key = self._key(attempt)
        with self._lock:
            terminal = self._terminal.get(key)
            if terminal is not None:
                self._prepared.discard(key)
                self._cancelled.pop(key, None)
                if terminal == 'cancel_requested':
                    raise ValueError(
                        'El intento Craft conserva una cancelación incierta.')
                raise ValueError('El intento Craft ya es terminal.')
            self._prepared.add(key)
            if key in self._cancelled:
                self._cancelled.pop(key, None)
                self._prepared.discard(key)
                self._remember_terminal(key, 'stopped')
                raise ValueError('El intento Craft fue cancelado antes del dispatch.')
            if attempt.attempt_id in self._active:
                raise ValueError('El intento Craft ya está activo.')
            self._active[attempt.attempt_id] = request
            self._prepared.discard(key)
        try:
            response = self.transport.dispatch(request)
            fields = {'schemaVersion', 'dispatchId', 'requestSha256',
                      'candidateResult'}
            if (not isinstance(response, dict) or set(response) != fields
                    or response.get('schemaVersion') != 1
                    or response.get('dispatchId') != request.body['dispatchId']
                    or response.get('requestSha256') != request.request_sha256
                    or not isinstance(response.get('candidateResult'), dict)):
                raise ValueError('El runtime Craft no devolvió un recibo ligado.')
        except BaseException as dispatch_error:
            try:
                self._cancel_request(request)
            except BaseException as cancel_error:
                raise RuntimeError(
                    'El dispatch Craft falló sin cancelación confirmada.') from cancel_error
            raise dispatch_error
        with self._lock:
            terminal = self._terminal.get(key)
            self._active.pop(attempt.attempt_id, None)
            if terminal is not None:
                raise ValueError('Craft descartó un resultado posterior a cancelación.')
            self._remember_terminal(key, 'succeeded')
        return CraftExecutionResult(deepcopy(response['candidateResult']))

    def _cancel_request(self, request: CraftRuntimeRequest) -> bool:
        attempt = request.body['attempt']
        key = (attempt['jobId'], attempt['attemptId'], attempt['leaseToken'])
        cancel_lock = self._acquire_cancel_lock(key)
        try:
            with self._lock:
                if self._terminal.get(key) in (
                        'stopped', 'already_terminal', 'succeeded'):
                    return True
                self._remember_terminal(key, 'cancel_requested')
            receipt = self.transport.cancel(request)
            fields = {'schemaVersion', 'dispatchId', 'requestSha256', 'status'}
            if (not isinstance(receipt, dict) or set(receipt) != fields
                    or receipt.get('schemaVersion') != 1
                    or receipt.get('dispatchId') != request.body['dispatchId']
                    or receipt.get('requestSha256') != request.request_sha256
                    or receipt.get('status') not in (
                        'stopped', 'already_terminal')):
                raise ValueError('Craft no confirmó la cancelación del dispatch.')
            with self._lock:
                self._remember_terminal(key, receipt['status'])
                if self._active.get(attempt['attemptId']) is request:
                    self._active.pop(attempt['attemptId'], None)
        finally:
            self._release_cancel_lock(key, cancel_lock)
        return True

    def cancel(self, attempt: CraftAttempt) -> bool:
        key = self._key(attempt)
        with self._lock:
            request = self._active.get(attempt.attempt_id)
            if request is None:
                if key not in self._terminal and key in self._prepared:
                    self._remember_cancelled(key)
                return True
            bound = request.body['attempt']
            if (bound['jobId'], bound['attemptId'], bound['leaseToken']) != key:
                raise ValueError('La cancelación Craft no coincide con su fence.')
        return self._cancel_request(request)

    def reconcile_terminal(self, attempt: CraftAttempt, status: str) -> None:
        """Retire memory only after the database made the fence unclaimable."""
        if status not in ('stopped', 'already_terminal', 'succeeded'):
            raise ValueError('La reconciliación Craft no es terminal.')
        key = self._key(attempt)
        with self._lock:
            request = self._active.get(attempt.attempt_id)
            if request is not None:
                bound = request.body['attempt']
                if (bound['jobId'], bound['attemptId'],
                        bound['leaseToken']) != key:
                    raise ValueError('La reconciliación Craft no coincide.')
        if request is not None:
            self._cancel_request(request)
        with self._lock:
            if self._cancel_lock_refs.get(key, 0):
                raise ValueError('El intento Craft sigue cancelándose.')
            self._prepared.discard(key)
            self._cancelled.pop(key, None)
            self._cancel_locks.pop(key, None)
            self._cancel_lock_refs.pop(key, None)
            self._terminal.pop(key, None)
