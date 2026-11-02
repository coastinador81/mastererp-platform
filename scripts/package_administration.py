"""Package and check the eight technical Administration handlers, without dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(output):
    manifest = json.loads((ROOT / 'scripts/administration_lambdas.json').read_text())
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for capability, owner in manifest.items():
        name = 'mastererp-dev-adm-' + capability
        source = ROOT / 'backend/modules' / owner / 'lambdas' / name / 'handler.py'
        data = source.read_bytes().replace(b'\r\n', b'\n')
        namespace = {}
        exec(compile(data, str(source), 'exec'), namespace)
        expected = {'status': 'ok', 'lambda': name}
        for event in ({}, {'body': 'ignored', 'headers': {'authorization': 'test-only'}}):
            response = namespace['lambda_handler'](event, None)
            assert response['statusCode'] == 200
            assert json.loads(response['body']) == expected
            assert response['headers']['Cache-Control'] == 'no-store'
        artifact = output / (name + '.zip')
        with zipfile.ZipFile(artifact, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            info = zipfile.ZipInfo('handler.py', (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
        with zipfile.ZipFile(artifact) as archive:
            assert archive.namelist() == ['handler.py']
        results.append({'name': name, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()})
    (output / 'manifest.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({'tested_handlers': len(results), 'artifacts': results}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    package(parser.parse_args().output.resolve())
