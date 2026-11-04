import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from package_phase7 import MANIFEST, package_module


class Phase7PackageTest(unittest.TestCase):
    def test_every_module_packages_owned_and_shared_code(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); dependencies = root / "dependencies"; dependencies.mkdir()
            for relative in ("psycopg/__init__.py", "psycopg_binary/__init__.py",
                             "jwt/__init__.py"):
                path = dependencies / relative; path.parent.mkdir(exist_ok=True); path.write_text("")
            for name, config in json.loads(MANIFEST.read_text()).items():
                archive = root / f"{name}.zip"
                package_module(name, config, dependencies, archive, b'{"keys":[{"kid":"test"}]}')
                with zipfile.ZipFile(archive) as value:
                    files = set(value.namelist())
                self.assertIn("handler.py", files)
                self.assertIn(config[1] + "/handler.py", files)
                self.assertIn("tenant_security/auth.py", files)
                self.assertIn("tenant_security/cognito-jwks.json", files)
                self.assertIn("psycopg/__init__.py", files)
                self.assertIn("jwt/__init__.py", files)


if __name__ == "__main__":
    unittest.main()
