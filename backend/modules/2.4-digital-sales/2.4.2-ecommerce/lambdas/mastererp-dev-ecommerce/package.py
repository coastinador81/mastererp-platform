import argparse
import pathlib
import zipfile


def package(destination):
    folder = pathlib.Path(__file__).parent
    module = folder.parents[1]
    shared = folder.parents[4] / "shared/tenant-security/tenant_security"
    files = {"handler.py": folder / "handler.py"}
    for source in sorted((module / "ecommerce_api").glob("*.py")):
        files[f"ecommerce_api/{source.name}"] = source
    for name in ("__init__.py", "auth.py", "db.py", "http.py", "rds-us-west-1-bundle.pem"):
        files[f"tenant_security/{name}"] = shared / name
    with zipfile.ZipFile(destination, "w") as archive:
        for name, source in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source.read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=pathlib.Path)
    package(parser.parse_args().destination)
