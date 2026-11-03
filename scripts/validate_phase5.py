"""Validate the reusable Platform gates established in migration phase 5."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULES = (
    "2.1-catalog/2.1.1-products",
    "2.1-catalog/2.1.2-categories",
    "2.1-catalog/2.1.3-attributes",
    "2.1-catalog/2.1.4-brands",
    "2.1-catalog/2.1.5-suppliers",
    "2.1-catalog/2.1.6-inventory",
    "2.3-operations/2.3.1-orders",
    "2.3-operations/2.3.2-preparation",
    "2.3-operations/2.3.3-routes",
    "2.3-operations/2.3.4-nodes",
    "2.4-digital-sales/2.4.2-ecommerce",
    "2.10-transport/2.10.1-drivers",
)
SOURCE_SUFFIXES = {".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".html"}


def require(condition, message):
    if not condition:
        raise SystemExit("ERROR: " + message)


def source_files(folder):
    for path in folder.rglob("*"):
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            if "node_modules" not in path.parts and "dist" not in path.parts:
                yield path


def main():
    checked = 0
    for relative in MODULES:
        backend = ROOT / "backend/modules" / relative
        frontend = ROOT / "frontend/modules" / relative
        require((backend / "README.md").is_file(), f"backend README missing: {relative}")
        require((frontend / "README.md").is_file(), f"frontend README missing: {relative}")
        api_files = list(backend.glob("*_api/handler.py"))
        require(len(api_files) == 1, f"one API handler required: {relative}")
        require(any((backend / "tests").glob("test_*.py")), f"backend test missing: {relative}")
        require(any((backend / "lambdas").glob("*/package.py")), f"Lambda packager missing: {relative}")
        main_js = frontend / "src/main.js"
        require(main_js.is_file(), f"manual frontend missing: {relative}")
        text = main_js.read_text(encoding="utf-8")
        require("mastererpAuth" in text, f"runtime auth contract missing: {relative}")
        require("VITE_ACCESS_TOKEN" not in text, f"build-time access token forbidden: {relative}")
        checked += 1
    storefront = ROOT / "frontend/storefront-web"
    require((storefront / "src/main.js").is_file(), "storefront implementation missing")
    require("VITE_ACCESS_TOKEN" not in (storefront / "src/main.js").read_text(), "public storefront token forbidden")
    for root in (ROOT / "backend/modules", ROOT / "frontend/modules", storefront):
        for path in source_files(root):
            lines = len(path.read_text(encoding="utf-8").splitlines())
            require(lines <= 500, f"source exceeds 500 lines: {path.relative_to(ROOT)} ({lines})")
    print(f"OK: Phase 5 Platform gates passed for {checked} vertical modules and storefront.")


if __name__ == "__main__":
    main()
