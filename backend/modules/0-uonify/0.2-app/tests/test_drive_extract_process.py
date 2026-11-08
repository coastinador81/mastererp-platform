"""Aislamiento real del lector y ciclo de timeout/limpieza, sin leer credenciales."""
from pathlib import Path
import tempfile
import pytest
from app.drive_extract import ExtractionError
from app.drive_extract_process import extract_isolated, process_environment


def test_actual_child_process_extracts_text_and_cleans_private_inputs(monkeypatch):
    with tempfile.TemporaryDirectory() as temporary:
        monkeypatch.setattr('app.drive_extract_process.tempfile.tempdir', temporary)
        result = extract_isolated(b'Material: madera', 'text/plain', '../ficha.txt')
        assert result['fragments'][0]['segments'][0]['text'] == 'Material: madera'
        assert list(Path(temporary).iterdir()) == []


def test_corrupt_pdf_is_explicit_error_and_inputs_cleaned(monkeypatch):
    with tempfile.TemporaryDirectory() as temporary:
        monkeypatch.setattr('app.drive_extract_process.tempfile.tempdir', temporary)
        with pytest.raises(ExtractionError, match='fuente completa|documento completo'):
            extract_isolated(b'%PDF-corrupt', 'application/pdf', 'corrupt.pdf')
        assert list(Path(temporary).iterdir()) == []


def test_actual_process_timeout_leaves_no_temporary_source(monkeypatch):
    with tempfile.TemporaryDirectory() as temporary:
        monkeypatch.setattr('app.drive_extract_process.tempfile.tempdir', temporary)
        with pytest.raises(ExtractionError, match='agotó.*pendiente'):
            extract_isolated(b'contenido', 'text/plain', 'source.txt', timeout=0.001)
        assert list(Path(temporary).iterdir()) == []


def test_child_environment_excludes_service_secrets(monkeypatch):
    monkeypatch.setenv('GOOGLE_CLIENT_SECRET', 'test-not-a-real-secret')
    monkeypatch.setenv('DATABASE_URL', 'do-not-copy')
    monkeypatch.setenv('UONIFY_NATIVE_SPOOL', '/configured/local/spool')
    env = process_environment()
    assert 'GOOGLE_CLIENT_SECRET' not in env and 'DATABASE_URL' not in env
    assert env['UONIFY_NATIVE_SPOOL'] == '/configured/local/spool'
    assert env['OMP_THREAD_LIMIT'] == '1'
