"""Lectores de documentos en proceso desechable con límites de tiempo y memoria.

No equivale a una sandbox de red. Los lectores no descargan referencias externas;
Blender puede usar el puente local autorizado configurado por el servidor.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from .drive_extract import ExtractionError, MAX_BYTES

DEFAULT_TIMEOUT = 120
MEMORY_BYTES = 1536 * 1024 * 1024
MAX_OUTPUT_BYTES = 192 * 1024 * 1024
# Configuración del servidor, nunca claves de Google/Amazon ni entorno completo.
ENVIRONMENT_KEYS = ('PATH', 'UONIFY_NATIVE_SPOOL')


def process_environment():
    environment = {key: os.environ[key] for key in ENVIRONMENT_KEYS if key in os.environ}
    environment.update({'PYTHONPATH': str(Path(__file__).resolve().parent.parent),
                        'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1',
                        'LANG': 'C.UTF-8', 'OMP_THREAD_LIMIT': '1', 'OPENBLAS_NUM_THREADS': '1'})
    return environment


def extract_isolated(content, mime, name, *, timeout=DEFAULT_TIMEOUT):
    """Solo devuelve un manifiesto completo válido; timeout/caída es fallo recuperable explícito."""
    if len(content) > MAX_BYTES:
        raise ExtractionError('El archivo supera 64 MiB; aporta una copia para análisis.')
    if not 0 < timeout <= 600:
        raise ValueError('El tiempo de lectura debe estar entre 0 y 600 segundos.')
    with tempfile.TemporaryDirectory(prefix='uonify-reader-') as folder:
        root = Path(folder)
        (root / 'input.bin').write_bytes(content)
        (root / 'input.json').write_text(json.dumps({'mime': mime, 'name': name}), encoding='utf-8')
        command = [sys.executable, '-m', 'app.drive_extract_process', '--worker', folder]
        with (root / 'stderr.log').open('wb') as error_log:
            process = subprocess.Popen(command, cwd=folder, env=process_environment(),
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=error_log, start_new_session=True)
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired as error:
                # Incluye el OCR hijo; el timeout no deja procesos OCR ejecutándose.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                raise ExtractionError(f'La lectura agotó {timeout:g} segundos. La fuente queda pendiente; '
                                      'puedes reintentar o aportar una copia dividida.') from error
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                raise
        output = root / 'output.json'
        if process.returncode or not output.is_file() or output.stat().st_size > MAX_OUTPUT_BYTES:
            raise ExtractionError('El lector se detuvo o superó sus límites seguros. La fuente queda pendiente; '
                                  'aporta una copia optimizada para reintentar.')
        try:
            payload = json.loads(output.read_text(encoding='utf-8'))
        except (ValueError, UnicodeError) as error:
            raise ExtractionError('El lector devolvió un resultado incompleto; la fuente queda pendiente.') from error
        if payload.get('error'):
            raise ExtractionError(payload['error'])
        if not isinstance(payload.get('result'), dict):
            raise ExtractionError('El lector no produjo un manifiesto válido; la fuente queda pendiente.')
        return payload['result']


def set_limits():
    import resource
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (115, 115))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def worker(folder):
    set_limits()
    root = Path(folder)
    metadata = json.loads((root / 'input.json').read_text(encoding='utf-8'))
    try:
        from .drive_segments import extract_parts
        result = extract_parts((root / 'input.bin').read_bytes(), metadata['mime'], metadata['name'])
        payload = {'result': result}
    except ExtractionError as error:
        payload = {'error': str(error)}
    except Exception:
        payload = {'error': 'No se pudo interpretar la fuente completa. Revisa su formato o aporta una copia válida.'}
    with (root / 'output.json').open('w', encoding='utf-8') as output:
        json.dump(payload, output, ensure_ascii=False)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--worker':
        raise SystemExit(2)
    worker(sys.argv[2])
