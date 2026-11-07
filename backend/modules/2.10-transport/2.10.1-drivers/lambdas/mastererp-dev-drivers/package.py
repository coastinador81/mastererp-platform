"""Build deterministic Drivers Lambda ZIP."""
import argparse
import pathlib
import zipfile


def package(destination):
    folder = pathlib.Path(__file__).parent
    module = folder.parents[1]
    shared = next(parent for parent in folder.parents if parent.name == 'backend') / "shared/tenant-security/tenant_security"
    sources = {"handler.py": folder / "handler.py"}
    for source in sorted((module / "drivers_api").glob("*.py")):
        sources[f"drivers_api/{source.name}"] = source
    for name in ("__init__.py", "auth.py", "db.py", "http.py", "rds-us-west-1-bundle.pem"):
        sources[f"tenant_security/{name}"] = shared / name
    with zipfile.ZipFile(destination, "w") as archive:
        for name, source in sorted(sources.items()):
            entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, source.read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=pathlib.Path)
    args = parser.parse_args()
    package(args.destination)
