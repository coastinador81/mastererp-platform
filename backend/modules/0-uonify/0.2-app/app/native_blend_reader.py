"""Cliente del lector Blender local aislado; el proceso API nunca abre el nativo."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import uuid

from .drive_extract import ExtractionError, MAX_BYTES

MAX_RESULT_BYTES = 12 * 1024 * 1024


def inspect_blend(content, *, spool=None, timeout=90):
    if not content or len(content) > MAX_BYTES:
        raise ExtractionError('El archivo Blender está vacío o supera 64 MiB.')
    # Blender también admite sus formatos comprimidos gzip y zstd.
    if not content.startswith((b'BLENDER', b'\x1f\x8b', b'\x28\xb5\x2f\xfd')):
        raise ExtractionError('El archivo no tiene una cabecera Blender reconocida.')
    root = Path(spool or os.environ.get('UONIFY_NATIVE_SPOOL', '/run/uonify-native'))
    if not root.is_dir():
        raise ExtractionError('El lector Blender local no está disponible. Activa el lector y reanuda el análisis.')
    job = root / str(uuid.uuid4())
    digest = hashlib.sha256(content).hexdigest()
    try:
        job.mkdir(mode=0o700)
        (job / 'source.blend').write_bytes(content)
        (job / 'request.tmp').write_text(json.dumps({'version': 1, 'sha256': digest, 'bytes': len(content)}))
        (job / 'request.tmp').replace(job / 'request.json')
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = job / 'response.json'
            if result.exists():
                if result.is_symlink() or result.stat().st_size > MAX_RESULT_BYTES:
                    raise ExtractionError('La respuesta del lector Blender no es válida.')
                data = json.loads(result.read_text())
                if data.get('sha256') != digest:
                    raise ExtractionError('La respuesta Blender no corresponde a esta versión del archivo.')
                if data.get('error'):
                    raise ExtractionError(data['error'])
                payload = data.get('result', {})
                if not isinstance(payload.get('units'), list) or not isinstance(payload.get('coverage'), dict):
                    raise ExtractionError('El lector Blender no devolvió un manifiesto de lectura válido.')
                return payload
            time.sleep(.2)
        raise ExtractionError('El lector Blender no respondió a tiempo. La fuente queda pendiente para reanudar.')
    except ExtractionError:
        raise
    except (OSError, ValueError) as error:
        raise ExtractionError('No se pudo completar la lectura Blender. Revisa el lector local y reanuda.') from error
    finally:
        # El runner conserva descriptores propios y termina si desaparece el trabajo.
        shutil.rmtree(job, ignore_errors=True)
