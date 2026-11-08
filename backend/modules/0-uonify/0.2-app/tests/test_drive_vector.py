"""Conversión real y adversarial AI/EPS, sin Drive, modelo ni base de datos."""
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

import pytest

from app.drive_extract import ExtractionError, supported
from app.drive_segments import extract_parts
from app.drive_vector import postscript_pdf, read_vector
from app.drive_vector_ai import legacy_ai_svg


def pilot():
    path = Path('/fixtures/ce-oficial.zip')
    if not path.exists():
        pytest.skip('Montar fuentes Basic Mini Bricks en /fixtures, solo lectura.')
    return path


def test_real_legacy_ai_keeps_all_layers_and_hidden_geometry():
    content = ZipFile(pilot()).read('CE.ai')
    svg, units, metadata = legacy_ai_svg(content)
    assert metadata['pathCount'] == 9 and metadata['visiblePathCount'] == 2
    assert len(metadata['layers']) == 4
    assert [layer['visible'] for layer in metadata['layers']] == [False, False, True, True]
    assert svg.count(b'<path ') == 2
    assert len(json.loads(units[0][1])['objects']) == 9
    assert not metadata['postscriptExecuted']
    result = extract_parts(content, 'application/postscript', 'CE.ai')
    conversion = result['readerMetadata']
    assert result['sha256'] == conversion['sourceSha256'] == sha256(content).hexdigest()
    assert conversion['derivedMimeType'] == 'image/png'
    assert result['coverage']['complete'] and result['coverage']['vectorReaderProfile'] == 'ai-eps-v1'
    assert any(part.get('inline') for part in result['fragments'])
    assert any('objects' in segment['text'] for part in result['fragments'] for segment in part['segments'])
    assert all(segment['conversion']['sourceSha256'] == result['sha256'] for part in result['fragments'] for segment in part['segments'])


def test_real_eps_derivative_is_own_deterministic_pdf_with_complete_coverage():
    content = ZipFile(pilot()).read('CE.eps')
    first, metadata = postscript_pdf(content)
    second, _ = postscript_pdf(content)
    assert first == second and first.startswith(b'%PDF-')
    assert metadata['sandbox']['landlockAbi'] >= 3 and metadata['sandbox']['seccomp']
    assert not metadata['networkAccess'] and not metadata['externalProcessExecution']
    result = extract_parts(content, 'application/postscript', 'CE.eps')
    assert result['coverage']['complete'] and result['coverage']['pages'] == 1
    assert result['readerMetadata']['sourceSha256'] == sha256(content).hexdigest()
    assert result['readerMetadata']['derivedSha256'] == sha256(first).hexdigest()
    assert result['readerMetadata']['certificationVerified'] is False
    assert any(part.get('inline') for part in result['fragments'])


@pytest.mark.parametrize('payload', [b'%!PS\nthis_is_not_postscript', b'\xc5\xd0\xd3\xc6broken',
    b'%!PS\n(/etc/passwd) (r) file closefile showpage',
    b'%!PS\n(/tmp/should-not-exist-uonify) (w) file closefile showpage',
    b'%!PS\n(%pipe%id) (r) file closefile showpage'])
def test_eps_rejects_corruption_and_file_or_process_access(payload):
    with pytest.raises(ExtractionError, match='aislamiento|completo'):
        postscript_pdf(payload)


def test_eps_timeout_is_explicit_and_bounded():
    with pytest.raises(ExtractionError, match='agotó'):
        postscript_pdf(b'%!PS\n{} loop\n', timeout=0.2)


def test_ai_unknown_operator_is_incident_not_a_silently_simplified_drawing():
    original = ZipFile(pilot()).read('CE.ai')
    for command in (b'quit', b'1 0 0 1 0 0 concat', b'(%pipe%id) (r) file', b'1e999 0 m'):
        payload = original.replace(b'%%EndSetup', b'%%EndSetup\n' + command)
        with pytest.raises(ExtractionError):
            legacy_ai_svg(payload)


def test_modern_ai_reads_its_own_pdf_compatible_representation():
    from pypdf import PdfWriter
    stream = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(100, 100)
    writer.write(stream)
    observed = []
    def derivative(content, mime, name):
        observed.append((content, mime))
        return {'coverage': {'complete': True}, 'warnings': [], 'fragments': []}
    result = read_vector(stream.getvalue(), 'application/illustrator', 'modern.ai', derivative)
    assert observed == [(stream.getvalue(), 'application/pdf')]
    assert result['readerMetadata']['method'] == 'ai_embedded_pdf'


def test_missing_sandbox_fails_closed(monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'darwin')
    with pytest.raises(ExtractionError, match='aislado no está disponible'):
        postscript_pdf(b'%!PS\nshowpage')


def test_linux_sandbox_independently_blocks_network_files_and_fork(tmp_path):
    source, work, secret = tmp_path / 'input.ps', tmp_path / 'work', tmp_path / 'private-secret'
    source.write_bytes(b'%!PS')
    secret.write_text('not-readable')
    work.mkdir()
    code = '''import os,sys,json,socket
from pathlib import Path
from app.drive_vector_sandbox import filesystem_sandbox,syscall_sandbox
root=Path(sys.argv[1]); source=root/'input.ps'; work=root/'work'; secret=root/'private-secret'
syscall_sandbox(); abi=filesystem_sandbox(source,work)
checks={}
for name,action in [('read_other',lambda:secret.read_bytes()),('write_source',lambda:source.write_text('bad')),
                    ('write_other',lambda:secret.write_text('bad')),('network',lambda:socket.socket()),
                    ('fork',lambda:os.fork()),('signal_other',lambda:os.kill(os.getppid(),0))]:
 try: action(); checks[name]=False
 except OSError: checks[name]=True
checks['read_source']=source.read_bytes()==b'%!PS'
(work/'allowed').write_text('ok'); checks['write_work']=(work/'allowed').read_text()=='ok'
print(json.dumps(checks))'''
    result = subprocess.run([sys.executable, '-c', code, str(tmp_path)], text=True,
                            capture_output=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert all(json.loads(result.stdout).values()), result.stdout
    assert source.read_bytes() == b'%!PS' and secret.read_text() == 'not-readable'


def test_ai_eps_are_supported_without_changing_other_formats():
    assert supported({'name': 'vector.ai', 'mimeType': 'application/octet-stream'})
    assert supported({'name': 'vector.eps', 'mimeType': 'application/octet-stream'})


def test_archive_upgrade_profile_is_selective():
    from app.product_materials_upgrade import upgrade_eligible
    source = {'name': 'ce-oficial.zip', 'mimeType': 'application/zip', 'readerVersion': 'drive-segments-v2',
              'readComplete': True, 'readingCoverage': {}}
    assert upgrade_eligible(source)
    source['readingCoverage']['archiveVectorProfile'] = 'ai-eps-v1'
    assert not upgrade_eligible(source)
    source['readComplete'] = False
    assert upgrade_eligible(source)
    source['changed'] = True
    assert not upgrade_eligible(source)
