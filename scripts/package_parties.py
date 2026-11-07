"""Reproducible Clients/Suppliers packages using existing pure-Python dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dependencies', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--capabilities', nargs='+', choices=['clientes','proveedores','compras','ventas'], default=['clientes','proveedores'])
    args = parser.parse_args()
    owners = json.loads((ROOT/'scripts/administration_lambdas.json').read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = []
    for cap in args.capabilities:
        source = ROOT/'backend/modules'/owners[cap]/'lambdas'/('mastererp-dev-adm-'+cap)/'handler.py'
        files = {'handler.py': source}
        if cap != 'ventas':
            files['parties.py'] = ROOT/'backend/modules/2.2-finance/2.2.1-administration/shared/parties.py'
        if cap == 'compras':
            files['purchases.py'] = ROOT/'backend/modules/2.2-finance/2.2.1-administration/shared/purchases.py'
        shared = ROOT/'backend/shared/tenant-security/tenant_security'
        files.update({'tenant_security/'+p.name: p for p in shared.glob('*') if p.suffix in ('.py', '.pem')})
        allowed = {'pg8000', 'scramp', 'asn1crypto', 'dateutil', 'six.py'}
        for p in args.dependencies.rglob('*'):
            rel = p.relative_to(args.dependencies)
            if p.is_file() and (rel.parts[0] in allowed or rel.parts[0].endswith('.dist-info')) and '__pycache__' not in rel.parts:
                files[rel.as_posix()] = p
        assert any(n.startswith('pg8000/') for n in files)
        artifact = args.output/('mastererp-dev-adm-'+cap+'.zip')
        with zipfile.ZipFile(artifact, 'w') as z:
            for name, file in sorted(files.items()):
                assert not name.endswith(('.so', '.pyd')) and '.env' not in name
                data = file.read_bytes()
                if name.endswith('.py'):
                    data = data.replace(b'\r\n', b'\n')
                    compile(data, name, 'exec')
                info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                z.writestr(info, data)
        manifest.append({'capability': cap, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()})
    (args.output/'parties-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
