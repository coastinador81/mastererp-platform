"""Build deterministic Python 3.12 arm64 artifacts for Phase 7 modules."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend/modules"
SHARED = ROOT / "backend/shared/tenant-security/tenant_security"
MANIFEST = ROOT / "scripts/phase7_modules.json"
SHARED_FILES = ("__init__.py", "auth.py", "db.py", "http.py", "rds-us-west-1-bundle.pem")


def _entry(archive, name, source):
    info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    archive.writestr(info, source.read_bytes())


def _entry_bytes(archive, name, value):
    info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    archive.writestr(info, value)


def _dependency_files(dependencies):
    for source in sorted(dependencies.rglob("*")):
        relative = source.relative_to(dependencies)
        if not source.is_file() or "__pycache__" in relative.parts or source.suffix == ".pyc":
            continue
        if any(part.endswith((".dist-info", ".egg-info")) for part in relative.parts):
            continue
        yield relative.as_posix(), source


def package_module(name, config, dependencies, destination, jwks):
    module_path, api_package = config
    module = BACKEND / module_path
    lambda_dir = module / "lambdas" / f"mastererp-dev-{name}"
    files = {"handler.py": lambda_dir / "handler.py"}
    files.update({f"{api_package}/{source.name}": source
                  for source in sorted((module / api_package).glob("*.py"))})
    files.update({f"tenant_security/{file}": SHARED / file for file in SHARED_FILES})
    for path in files.values():
        if not path.is_file():
            raise FileNotFoundError(path)
    with zipfile.ZipFile(destination, "w") as archive:
        for entry, source in sorted(files.items()):
            _entry(archive, entry, source)
        for entry, source in _dependency_files(dependencies):
            if entry not in files:
                _entry(archive, entry, source)
        _entry_bytes(archive, "tenant_security/cognito-jwks.json", jwks)
    with zipfile.ZipFile(destination) as archive:
        names = set(archive.namelist())
    required = {"psycopg/__init__.py", "jwt/__init__.py", "tenant_security/cognito-jwks.json"}
    if not required <= names or not any(name.startswith("psycopg_binary/") for name in names):
        raise ValueError("Runtime security or database dependencies are missing")
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def validate_dependencies(dependencies):
    psycopg = list(dependencies.glob("psycopg_binary/*aarch64*.so"))
    crypto = list(dependencies.glob("cryptography/**/*.abi3.so"))
    if not psycopg or not crypto:
        raise ValueError("Python 3.12 arm64 psycopg and cryptography dependencies required")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependencies", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jwks", type=Path, required=True)
    args = parser.parse_args(); validate_dependencies(args.dependencies)
    jwks = json.loads(args.jwks.read_text(encoding="utf-8"))
    if not isinstance(jwks.get("keys"), list) or not jwks["keys"]:
        raise ValueError("Non-empty Cognito JWKS required")
    jwks_bytes = json.dumps(jwks, sort_keys=True, separators=(",", ":")).encode()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {}
    for name, config in json.loads(MANIFEST.read_text(encoding="utf-8")).items():
        destination = args.output / f"mastererp-dev-{name}.zip"
        report[name] = {"file": destination.name,
                        "sha256": package_module(name, config, args.dependencies, destination, jwks_bytes)}
    (args.output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
