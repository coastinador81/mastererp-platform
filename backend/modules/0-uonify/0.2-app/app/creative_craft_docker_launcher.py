"""Docker CLI engine owned by the disconnected Craft launcher process.

The API never imports or constructs this class.  Every Docker argument comes
from launcher-owned profile/authority objects; the private request cannot add
argv, environment variables, mounts, paths or image names.
"""

from dataclasses import dataclass, field
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
from threading import Event, Lock, Thread
import time

from .creative_craft_launcher import (
    CraftSandboxCancellation, CraftSandboxExecution,
)
from .creative_craft_launcher_authority import (
    CraftLauncherAuthority, CraftLauncherProfile,
)
from .creative_craft_launcher_contract import CraftLauncherContractError


@dataclass
class _Active:
    container_name: str
    cancelled: Event = field(default_factory=Event)
    observed: Event = field(default_factory=Event)
    process: subprocess.Popen | None = None


class DockerCliCraftSandbox:
    """One-container-per-attempt Linux sandbox with deterministic cleanup."""

    def __init__(self, docker_binary: Path, *,
                 docker_host: str = "unix:///var/run/docker.sock"):
        binary = Path(docker_binary).resolve(strict=True)
        if (not binary.is_absolute() or not binary.is_file()
                or not os.access(binary, os.X_OK)):
            raise CraftLauncherContractError("El binario Docker no es seguro.")
        self._docker = str(binary)
        if (not isinstance(docker_host, str)
                or not docker_host.startswith("unix:///")
                or "\n" in docker_host or "\r" in docker_host):
            raise CraftLauncherContractError("El socket Docker no es server-owned.")
        self._environment = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": "/var/empty",
            "DOCKER_HOST": docker_host,
        }
        self._active: dict[str, _Active] = {}
        self._verified_profiles: set[str] = set()
        self._lock = Lock()

    @staticmethod
    def _container_name(dispatch_id: str) -> str:
        return "uonify-craft-" + dispatch_id.replace("-", "")

    def prepare(self, dispatch_id: str) -> None:
        with self._lock:
            if dispatch_id in self._active:
                raise CraftLauncherContractError("El sandbox ya está reservado.")
            self._active[dispatch_id] = _Active(self._container_name(dispatch_id))

    def release(self, dispatch_id: str) -> None:
        with self._lock:
            active = self._active.get(dispatch_id)
            if active is not None and active.process is None:
                self._active.pop(dispatch_id, None)

    def command_for(self, profile: CraftLauncherProfile,
                    authority: CraftLauncherAuthority) -> tuple[str, ...]:
        for root in (authority.input_root, authority.output_root):
            if any(character in str(root) for character in (",", "\n", "\r")):
                raise CraftLauncherContractError("Una raíz del launcher no es montable.")
        limits = authority.limits
        name = self._container_name(authority.dispatch_id)
        environment = (
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME=/work/tmp", "TMPDIR=/work/tmp", "LANG=C.UTF-8",
            "OMP_NUM_THREADS=1", "OPENBLAS_NUM_THREADS=1",
            "MKL_NUM_THREADS=1", "PYTHONDONTWRITEBYTECODE=1",
        )
        command = [
            self._docker, "run", "--rm", "-i", "--pull=never", "--name", name,
            "--label", "com.uonify.craft.synthetic=true",
            "--label", f"com.uonify.craft.dispatch={authority.dispatch_id}",
            "--network=none", "--read-only", "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--security-opt=seccomp=builtin", "--cgroupns=private",
            "--ipc=private", "--init", "--platform", "linux/arm64",
            "--user", f"{profile.container_uid}:{profile.container_gid}",
            "--workdir", "/work", "--log-driver=none",
            "--cpus", str(limits.cpu_cores),
            "--memory", str(limits.memory_bytes),
            "--memory-swap", str(limits.memory_bytes),
            "--pids-limit", str(limits.max_processes),
            "--stop-timeout", str(limits.shutdown_grace_seconds),
            "--ulimit", "nofile=256:256", "--ulimit", "core=0:0",
            "--ulimit", f"fsize={limits.output_bytes}:{limits.output_bytes}",
            "--mount",
            f"type=bind,src={authority.input_root},dst=/work/inputs,readonly",
            "--tmpfs",
            f"/work/out:rw,nosuid,nodev,noexec,size={limits.output_bytes}",
            "--tmpfs", "/work/tmp:rw,nosuid,nodev,noexec,size=67108864",
            "--entrypoint", "/usr/bin/env", profile.image_digest, "-i",
            *environment, profile.binary_path, *profile.static_arguments,
        ]
        return tuple(command)

    @staticmethod
    def _drain(stream, limit: int, target: bytearray, overflow: Event,
               on_overflow) -> None:
        try:
            while chunk := stream.read(65_536):
                remaining = max(0, limit + 1 - len(target))
                if remaining:
                    target.extend(chunk[:remaining])
                if len(target) > limit and not overflow.is_set():
                    overflow.set()
                    on_overflow()
        finally:
            stream.close()

    def _run_cli(self, arguments: tuple[str, ...], timeout: float = 10) -> subprocess.CompletedProcess:
        return subprocess.run(
            arguments, stdin=subprocess.DEVNULL, capture_output=True,
            timeout=timeout, check=False, env=self._environment,
        )

    def _container_absent(self, name: str) -> bool:
        try:
            result = self._run_cli((
                self._docker, "ps", "--all", "--filter", f"name=^/{name}$",
                "--format", "{{.ID}}",
            ), timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            return False
        return result.returncode == 0 and not result.stdout.strip()

    def _verify_profile(self, profile: CraftLauncherProfile) -> None:
        key = sha256(json.dumps(
            profile.canonical(), sort_keys=True, separators=(",", ":")
        ).encode()).hexdigest()
        with self._lock:
            if key in self._verified_profiles:
                return
        try:
            info = self._run_cli((self._docker, "info", "--format", "{{json .}}"))
            details = json.loads(info.stdout)
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
            raise CraftLauncherContractError("El daemon OCI no es acreditable.") from None
        security = {
            str(item).lower() for item in (details.get("SecurityOptions") or [])
        }
        architecture = str(details.get("Architecture", "")).lower()
        if (info.returncode != 0 or details.get("OSType") != "linux"
                or str(details.get("CgroupVersion")) != "2"
                or architecture not in ("arm64", "aarch64")
                or "name=seccomp,profile=builtin" not in security):
            raise CraftLauncherContractError("El daemon OCI no cumple el perfil.")
        image = self._run_cli((
            self._docker, "image", "inspect", "--format",
            "{{.Os}}/{{.Architecture}} {{.Id}}", profile.image_digest,
        ))
        identity = image.stdout.decode(errors="replace").strip().split()
        if (image.returncode != 0 or len(identity) != 2
                or identity[0] not in ("linux/arm64", "linux/aarch64")
                or identity[1] != profile.image_digest):
            raise CraftLauncherContractError("La imagen OCI no coincide con su digest.")
        binary = self._run_cli((
            self._docker, "run", "--rm", "--pull=never", "--network=none",
            "--read-only", "--cap-drop=ALL",
            "--security-opt=no-new-privileges", "--platform", "linux/arm64",
            "--user", f"{profile.container_uid}:{profile.container_gid}",
            "--entrypoint", "/usr/bin/sha256sum", profile.image_digest,
            profile.binary_path,
        ), timeout=30)
        observed = binary.stdout.decode(errors="replace").strip().split()
        if (binary.returncode != 0 or not observed
                or observed[0] != profile.binary_sha256):
            raise CraftLauncherContractError("El binario no coincide con el perfil.")
        with self._lock:
            self._verified_profiles.add(key)

    def _terminate_container(self, name: str, grace_seconds: int) -> None:
        try:
            self._run_cli((self._docker, "stop", "--time", str(grace_seconds), name),
                          timeout=grace_seconds + 5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        try:
            self._run_cli((self._docker, "kill", name), timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        try:
            self._run_cli((self._docker, "rm", "--force", name), timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass

    def cancel(self, dispatch_id: str,
               grace_seconds: int) -> CraftSandboxCancellation:
        name = self._container_name(dispatch_id)
        with self._lock:
            active = self._active.get(dispatch_id)
            if active is not None:
                active.cancelled.set()
        self._terminate_container(name, grace_seconds)
        verified = self._container_absent(name)
        if active is not None:
            process = active.process
            # Absence before docker-run has finished creating the named
            # container is not proof of cleanup. The run path will observe the
            # cancellation and retry TERM/KILL after creation.
            if process is None or (process.poll() is None
                                   and not active.observed.is_set()):
                verified = False
        return CraftSandboxCancellation(
            "stopped" if verified else "cleanup_pending", verified)

    def run(self, profile: CraftLauncherProfile,
            authority: CraftLauncherAuthority) -> CraftSandboxExecution:
        command = self.command_for(profile, authority)
        if authority.expected_outputs:
            self.release(authority.dispatch_id)
            raise CraftLauncherContractError(
                "El broker de escrow no está habilitado para outputs Craft.")
        with self._lock:
            active = self._active.get(authority.dispatch_id)
            if active is None:
                active = _Active(self._container_name(authority.dispatch_id))
                self._active[authority.dispatch_id] = active
        try:
            self._verify_profile(profile)
        except BaseException:
            self.release(authority.dispatch_id)
            raise
        stdout, stderr = bytearray(), bytearray()
        response_overflow, log_overflow = Event(), Event()
        started = time.monotonic()
        process = None
        termination = "completed"
        try:
            with self._lock:
                # This lock is the launch linearization point. A cancel that
                # wins it sets the event and no docker client is created; a
                # launch that wins publishes its Popen before cancel proceeds.
                if active.cancelled.is_set():
                    self._active.pop(authority.dispatch_id, None)
                    return CraftSandboxExecution(
                        -1, b"", b"", "cancelled", True)
                process = subprocess.Popen(
                    command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, close_fds=True,
                    env=self._environment,
                )
                active.process = process
            stop = lambda: self.cancel(
                authority.dispatch_id, authority.limits.shutdown_grace_seconds)
            output_reader = Thread(
                target=self._drain,
                args=(process.stdout, authority.limits.max_response_bytes,
                      stdout, response_overflow, stop), daemon=True)
            log_reader = Thread(
                target=self._drain,
                args=(process.stderr, authority.limits.max_log_bytes,
                      stderr, log_overflow, stop), daemon=True)
            output_reader.start()
            log_reader.start()
            input_done = Event()

            def write_control() -> None:
                try:
                    process.stdin.write(authority.control_document)
                    process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
                finally:
                    input_done.set()

            input_writer = Thread(target=write_control, daemon=True)
            input_writer.start()
            deadline = time.monotonic() + authority.limits.wall_seconds
            next_cancel_cleanup = 0.0
            while process.poll() is None:
                now = time.monotonic()
                if now >= deadline and termination == "completed":
                    termination = "timed_out"
                    active.cancelled.set()
                elif active.cancelled.is_set() and termination == "completed":
                    termination = "cancelled"
                if active.cancelled.is_set() and now >= next_cancel_cleanup:
                    self._terminate_container(
                        active.container_name,
                        authority.limits.shutdown_grace_seconds)
                    next_cancel_cleanup = now + 0.25
                time.sleep(0.05)
            process.wait(timeout=10)
            input_writer.join(timeout=1)
            output_reader.join(timeout=10)
            log_reader.join(timeout=10)
            if response_overflow.is_set() or log_overflow.is_set():
                termination = "limit_exceeded"
            elif active.cancelled.is_set() and termination == "completed":
                termination = "cancelled"
            exit_code = process.returncode if process.returncode is not None else -1
        finally:
            try:
                cleanup = self.cancel(
                    authority.dispatch_id, authority.limits.shutdown_grace_seconds)
            except BaseException:
                cleanup = CraftSandboxCancellation("cleanup_pending", False)
            with self._lock:
                self._active.pop(authority.dispatch_id, None)
        elapsed = max(0, int((time.monotonic() - started) * 1000))
        return CraftSandboxExecution(
            exit_code, bytes(stdout), bytes(stderr), termination,
            cleanup.cleanup_verified, wall_millis=elapsed,
        )
