"""Frontera Linux del intérprete PostScript: Landlock + seccomp, sin permisos extra.

Si el kernel no permite ambos controles, la conversión falla cerrada. No existe
un modo de fallback menos aislado. Solo ejecuta el binario fijo de Ghostscript.
"""
import ctypes
import errno
import json
import os
from pathlib import Path
import resource
import sys


class Ruleset(ctypes.Structure):
    _fields_ = [('handled_access_fs', ctypes.c_uint64)]


class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int)]


def filesystem_sandbox(source, work, executable='/usr/bin/gs'):
    libc = ctypes.CDLL(None, use_errno=True)
    abi = libc.syscall(444, 0, 0, 1)
    if abi < 3:
        raise RuntimeError('Landlock ABI 3 no disponible; no se ejecuta PostScript sin aislamiento.')
    handled = (1 << 15) - 1  # Incluye TRUNCATE; no conceder REFER entre directorios.
    if abi >= 5:
        handled |= 1 << 15  # IOCTL_DEV
    ruleset = Ruleset(handled)
    fd = libc.syscall(444, ctypes.byref(ruleset), ctypes.sizeof(ruleset), 0)
    if fd < 0:
        raise OSError(ctypes.get_errno(), 'landlock_create_ruleset')
    try:
        read = (1 << 2) | (1 << 3)
        paths = [(Path(executable), (1 << 0) | (1 << 2)), (source, 1 << 2),
                 *[(Path(path), (1 << 0) | (1 << 2)) for path in
                   ('/lib/ld-linux-aarch64.so.1', '/lib64/ld-linux-x86-64.so.2')],
                 (work, handled & ~((1 << 0) | (1 << 13) | (1 << 15))),
                 *[(Path(path), read) for path in ('/usr/lib', '/lib', '/usr/share/ghostscript',
                     '/usr/share/fonts', '/usr/share/color', '/usr/share/fontconfig', '/etc/fonts',
                     '/etc/ghostscript', '/var/cache/fontconfig')],
                 *[(Path(path), 1 << 2) for path in ('/etc/ld.so.cache', '/etc/papersize', '/dev/urandom')],
                 (Path('/dev/null'), (1 << 1) | (1 << 2))]
        for path, allowed in paths:
            if not path.exists():
                continue
            with_fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                rule = PathRule(allowed, with_fd)
                if libc.syscall(445, fd, 1, ctypes.byref(rule), 0):
                    raise OSError(ctypes.get_errno(), 'landlock_add_rule')
            finally:
                os.close(with_fd)
        if libc.prctl(38, 1, 0, 0, 0) or libc.syscall(446, fd, 0):
            raise OSError(ctypes.get_errno(), 'landlock_restrict_self')
    finally:
        os.close(fd)
    return abi


def syscall_sandbox():
    library = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    library.seccomp_init.argtypes = [ctypes.c_uint32]
    library.seccomp_init.restype = ctypes.c_void_p
    library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    library.seccomp_syscall_resolve_name.restype = ctypes.c_int
    library.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    library.seccomp_load.argtypes = [ctypes.c_void_p]
    library.seccomp_release.argtypes = [ctypes.c_void_p]
    context = library.seccomp_init(0x7fff0000)
    if not context:
        raise RuntimeError('No se pudo crear el filtro seccomp.')
    try:
        for name in ('socket', 'socketpair', 'connect', 'bind', 'listen', 'accept', 'accept4',
                     'sendto', 'sendmsg', 'sendmmsg', 'recvfrom', 'recvmsg', 'recvmmsg',
                     'clone', 'clone3', 'fork', 'vfork', 'execveat', 'ptrace', 'process_vm_readv',
                     'process_vm_writev', 'mount', 'umount2', 'unshare', 'setns', 'bpf', 'userfaultfd',
                     'io_uring_setup', 'open_by_handle_at', 'keyctl', 'add_key', 'request_key',
                     'kill', 'tkill', 'tgkill', 'pidfd_open', 'pidfd_getfd', 'pidfd_send_signal'):
            syscall = library.seccomp_syscall_resolve_name(name.encode())
            if syscall >= 0 and library.seccomp_rule_add(context, 0x00050000 | errno.EPERM, syscall, 0):
                raise RuntimeError('No se pudo aplicar el filtro seccomp.')
        if library.seccomp_load(context):
            raise RuntimeError('No se pudo activar seccomp; no se ejecuta el vector.')
    finally:
        library.seccomp_release(context)


def main(root):
    if not sys.platform.startswith('linux'):
        raise RuntimeError('La conversión EPS requiere el lector Linux aislado.')
    source, work = root / 'input.ps', root / 'work'
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Cargar y activar seccomp antes de cerrar el acceso de lectura del intérprete Python.
    syscall_sandbox()
    abi = filesystem_sandbox(source, work)
    (work / 'sandbox.json').write_text(json.dumps({'landlockAbi': abi, 'seccomp': True}))
    args = ['/usr/bin/gs', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dEPSCrop',
            '-dPDFSTOPONERROR', '-dNumRenderingThreads=1', '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.7', '-dAutoRotatePages=/None', '-sOutputFile=' + str(work / 'output.pdf'),
            '-f', str(source)]
    os.execve(args[0], args, {'PATH': '/usr/bin:/bin', 'HOME': str(work), 'TMPDIR': str(work),
                            'LANG': 'C.UTF-8', 'OMP_THREAD_LIMIT': '1'})


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]).resolve())
    except Exception:
        # No revelar rutas/datos del servidor ni devolver la salida PostScript al usuario.
        raise SystemExit(24)
