"""Deterministic Lambda ZIP: handler + shared service + optional packaged driver."""
import argparse
import pathlib
import zipfile


def package(destination, dependencies=None):
    folder = pathlib.Path(__file__).parent
    shared = folder.parents[3] / "shared/tenant-security/tenant_security"
    sources = {"handler.py": folder / "handler.py"}
    for name in ("__init__.py", "identity_access.py", "foundation_access.py", "rds-us-west-1-bundle.pem"):
        sources["tenant_security/" + name] = shared / name
    if dependencies:
        allowed = {"pg8000", "scramp", "asn1crypto", "dateutil", "six.py"}
        for path in dependencies.rglob("*"):
            relative = path.relative_to(dependencies)
            if (path.is_file() and (relative.parts[0] in allowed or relative.parts[0].endswith(".dist-info"))
                    and "__pycache__" not in relative.parts and path.suffix != ".pyc"):
                sources[relative.as_posix()] = path
    with zipfile.ZipFile(destination, "w") as archive:
        for name, source in sorted(sources.items()):
            entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, source.read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=pathlib.Path)
    parser.add_argument("--dependencies", type=pathlib.Path)
    args = parser.parse_args()
    package(args.destination, args.dependencies)
