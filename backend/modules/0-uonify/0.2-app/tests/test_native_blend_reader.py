import hashlib
import json
import threading
import time

import pytest

from app.drive_extract import ExtractionError
from app.native_blend_reader import inspect_blend


def responder(root, response):
    for _ in range(100):
        jobs = list(root.glob('*/request.json'))
        if jobs:
            request = json.loads(jobs[0].read_text())
            data = {'sha256': request['sha256'], **response}
            temp = jobs[0].parent / 'response.tmp'
            temp.write_text(json.dumps(data))
            temp.replace(jobs[0].parent / 'response.json')
            return
        time.sleep(.01)


def test_native_reader_uses_original_digest_and_cleans_spool(tmp_path):
    result = {'units': [['Blender · Resumen nativo', 'dato nominal']], 'coverage': {'native': True}}
    thread = threading.Thread(target=responder, args=(tmp_path, {'result': result}))
    thread.start()
    assert inspect_blend(b'BLENDER-v500', spool=tmp_path, timeout=2) == result
    thread.join()
    assert list(tmp_path.iterdir()) == []


def test_native_reader_rejects_wrong_source_response(tmp_path):
    thread = threading.Thread(target=responder, args=(tmp_path, {'sha256': '0' * 64, 'result': {}}))
    thread.start()
    with pytest.raises(ExtractionError, match='versión'):
        inspect_blend(b'BLENDER-v500', spool=tmp_path, timeout=2)
    thread.join()
    assert list(tmp_path.iterdir()) == []


def test_native_reader_unavailable_or_timeout_remains_explicit(tmp_path):
    with pytest.raises(ExtractionError, match='no está disponible'):
        inspect_blend(b'BLENDER-v500', spool=tmp_path / 'missing')
    with pytest.raises(ExtractionError, match='tiempo'):
        inspect_blend(b'BLENDER-v500', spool=tmp_path, timeout=.01)
    assert list(tmp_path.iterdir()) == []


def test_native_reader_invalid_content_never_sent(tmp_path):
    for invalid in [b'', b'not a native file']:
        with pytest.raises(ExtractionError):
            inspect_blend(invalid, spool=tmp_path)
    assert list(tmp_path.iterdir()) == []
