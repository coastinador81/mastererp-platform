import argparse
import pathlib
import zipfile

DEPENDENCY_PREFIXES = ("psycopg", "jwt", "cryptography", "cffi", "pycparser", "_cffi_backend", "typing_extensions")


def package(destination, dependencies=None):
    folder = pathlib.Path(__file__).parent
    module = folder.parents[1]
    shared = next(parent for parent in folder.parents if parent.name == 'backend') / "shared/tenant-security/tenant_security"
    files = {"handler.py": folder / "handler.py"}
    for source in sorted((module / "ecommerce_api").glob("*.py")):
        files[f"ecommerce_api/{source.name}"] = source
    for name in ("__init__.py", "auth.py", "db.py", "http.py", "rds-us-west-1-bundle.pem"):
        files[f"tenant_security/{name}"] = shared / name
    if dependencies:
        for source in dependencies.rglob("*"):
            relative = source.relative_to(dependencies)
            if (source.is_file() and relative.parts[0].startswith(DEPENDENCY_PREFIXES)
                    and "__pycache__" not in relative.parts and source.suffix != ".pyc"):
                files[relative.as_posix()] = source
    if not any(name.startswith("jwt/") for name in files):
        raise SystemExit("Missing Lambda dependencies: pass --dependencies with psycopg[binary] and PyJWT[crypto] for arm64")
    with zipfile.ZipFile(destination, "w") as archive:
        for name, source in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=pathlib.Path)
    parser.add_argument("--dependencies", type=pathlib.Path)
    args = parser.parse_args()
    package(args.destination, args.dependencies)
