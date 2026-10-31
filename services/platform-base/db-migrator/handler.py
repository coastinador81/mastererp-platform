import os
from pathlib import Path

import psycopg

from tenant_security.db import connect_dsn, load_database_secret


def _schema_files() -> list[Path]:
    root = os.environ.get("SCHEMA_ROOT")
    if root:
        base = Path(root)
        return sorted(base.glob("*.sql"))
    return [
        Path("schema/001_extensions_and_schemas.sql"),
        Path("schema/002_platform_core.sql"),
        Path("schema/003_tenant_onboarding.sql"),
        Path("schema/004_tenant_security.sql"),
    ]


def lambda_handler(event, context):
    del event, context
    load_database_secret()
    applied: list[str] = []
    with psycopg.connect(connect_dsn(), connect_timeout=10) as conn:
        for sql_file in _schema_files():
            if not sql_file.is_file():
                continue
            script = sql_file.read_text(encoding="utf-8")
            conn.execute(script)
            applied.append(str(sql_file))
        conn.commit()
    return {"status": "ok", "applied": applied}
