"""AI/EPS con derivados propios verificables y sin usar representaciones vecinas."""
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from .drive_extract import ExtractionError

VECTOR_PROFILE = 'ai-eps-v1'
MAX_VECTOR_BYTES = 16 * 1024 * 1024


def postscript_pdf(content, timeout=25):
    if not sys.platform.startswith('linux') or not Path('/usr/bin/gs').is_file():
        raise ExtractionError('El lector EPS aislado no está disponible. Conservamos el original; aporta PDF autónomo.')
    if not 0 < timeout <= 25:
        raise ValueError('Timeout vectorial fuera de rango.')
    with tempfile.TemporaryDirectory(prefix='uonify-vector-') as folder:
        root = Path(folder)
        (root / 'input.ps').write_bytes(content)
        work = root / 'work'
        work.mkdir(mode=0o700)
        with (root / 'stderr.log').open('wb') as log:
            process = subprocess.Popen([sys.executable, '-I', '-S', str(Path(__file__).with_name('drive_vector_sandbox.py')), str(root)],
                cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'})
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired as error:
                process.kill()  # El sandbox prohíbe crear procesos; no deja un árbol huérfano.
                process.wait()
                raise ExtractionError(f'La conversión EPS agotó {timeout:g} segundos; la fuente queda pendiente.') from error
            except BaseException:
                process.kill()
                process.wait()
                raise
        output = work / 'output.pdf'
        if process.returncode or not output.is_file() or output.stat().st_size > MAX_VECTOR_BYTES:
            raise ExtractionError('No se pudo convertir el EPS con aislamiento completo. Revisa su integridad o exporta PDF autónomo.')
        from pypdf import PdfReader, PdfWriter
        try:
            reader = PdfReader(io.BytesIO(output.read_bytes()), strict=True)
            if not 0 < len(reader.pages) <= 16:
                raise ValueError('pages')
            # Quitar fechas/IDs variables del conversor para que el mismo original
            # conserve sus fragmentos y no facture otra vez tras reanudarse.
            writer = PdfWriter()
            for page in reader.pages:
                page.pop('/Annots', None)
                writer.add_page(page)
            writer.add_metadata({'/Producer': 'Uonify static vector reader ' + VECTOR_PROFILE})
            buffer = io.BytesIO()
            writer.write(buffer)
            derived = buffer.getvalue()
            if len(derived) > MAX_VECTOR_BYTES:
                raise ValueError('size')
            sandbox = json.loads((work / 'sandbox.json').read_text())
            return derived, {'method': 'ghostscript_pdfwrite_landlock_seccomp',
                'converter': str((reader.metadata or {}).get('/Producer', 'Ghostscript')),
                'pages': len(reader.pages), 'sandbox': sandbox, 'networkAccess': False,
                'externalFileAccess': False, 'externalProcessExecution': False,
                'postscriptExecuted': 'drawing_program_inside_sandbox',
                'scope': 'apariencia estática; no edición nativa ni acciones interactivas'}
        except Exception as error:
            raise ExtractionError('El EPS no produjo un PDF estático completo dentro de los límites (16 páginas/16 MiB).') from error


def read_vector(content, mime, name, extract_derivative):
    if len(content) > MAX_VECTOR_BYTES:
        raise ExtractionError('El AI/EPS supera 16 MiB; aporta PDF optimizado para análisis.')
    units = []
    if content.startswith(b'%PDF-'):
        derived, derived_mime = content, 'application/pdf'
        metadata = {'method': 'ai_embedded_pdf', 'scope': 'representación PDF incluida en el AI; no árbol editable',
                    'postscriptExecuted': False, 'networkAccess': False, 'externalFileAccess': False}
    elif name.casefold().endswith('.ai') and content.startswith(b'%!PS-Adobe'):
        from .drive_vector_ai import legacy_ai_svg
        from .drive_additional import svg_image
        svg, units, metadata = legacy_ai_svg(content)
        derived, _, _ = svg_image(svg)
        derived_mime = 'image/png'
        metadata.update(networkAccess=False, externalFileAccess=False,
                        scope='trazados AI5 soportados; vista visible y geometría de capas ocultas conservadas')
    elif content.startswith((b'%!PS', b'\xc5\xd0\xd3\xc6')):
        derived, metadata = postscript_pdf(content)
        derived_mime = 'application/pdf'
    else:
        raise ExtractionError('El AI/EPS no tiene una representación PDF o PostScript reconocible; exporta PDF compatible.')
    conversion = {**metadata, 'readerProfile': VECTOR_PROFILE, 'sourceSha256': sha256(content).hexdigest(),
                  'derivedSha256': sha256(derived).hexdigest(), 'derivedMimeType': derived_mime,
                  'derivedBytes': len(derived), 'certificationVerified': False}
    # Nombres internos fijos; nunca rutas, scripts ni opciones de la fuente.
    child = extract_derivative(derived, derived_mime, 'vector-derived.pdf' if derived_mime == 'application/pdf' else 'vector-derived.png')
    for part in child['fragments']:
        part['conversion'] = conversion
        for segment in part.get('segments', []):
            segment['conversion'] = conversion
        if part.get('region'):
            part['region'] = {**part['region'], 'asset': 'Derivado ' + derived_mime}
        for segment in part.get('segments', []):
            if segment.get('region'):
                segment['region'] = {**segment['region'], 'asset': 'Derivado ' + derived_mime}
    if units:
        from .drive_segments import FragmentBuilder
        builder = FragmentBuilder(sha256(content).hexdigest())
        for locator, text in units:
            builder.add(locator, text, {'method': 'ai5_native_paths', 'conversion': conversion, 'observational': True})
        builder.flush()
        child['fragments'].extend(builder.fragments)
    child['readerMetadata'] = conversion
    child['coverage'].update(vectorReaderProfile=VECTOR_PROFILE, vectorConversion=conversion)
    child['warnings'].append('AI/EPS: lectura del archivo original mediante su propio derivado. La forma de un símbolo no acredita una certificación.')
    return child
