import json
import os
from contextlib import contextmanager
from typing import Any, Iterator
from uuid import UUID

import boto3
import psycopg
from psycopg.rows import dict_row

from tenant_security.http import HttpError

_secret_cache: dict[str, Any] | None = None


def load_database_secret() -> dict[str, Any]:
    global _secret_cache
    if _secret_cache is not None:
        return _secret_cache
    if os.environ.get("DATABASE_SECRET_JSON"):
        _secret_cache = json.loads(os.environ["DATABASE_SECRET_JSON"])
        return _secret_cache
    secret_arn = os.environ.get("DATABASE_SECRET_ARN")
    if not secret_arn:
        raise HttpError(500, "Database secret is not configured")
    try:
        client = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "us-west-2"))
        raw = client.get_secret_value(SecretId=secret_arn)
        _secret_cache = json.loads(raw["SecretString"])
    except Exception as exc:
        raise HttpError(503, "Unable to load database credentials") from exc
    return _secret_cache


def connect_dsn() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    creds = load_database_secret()
    host = os.environ.get("DATABASE_HOST", creds.get("host", "localhost"))
    port = os.environ.get("DATABASE_PORT", creds.get("port", 5432))
    dbname = os.environ.get("DATABASE_NAME", creds.get("dbname", "mastererp"))
    user = os.environ.get("DATABASE_USER", creds.get("username"))
    password = creds.get("password")
    sslmode = os.environ.get("DATABASE_SSLMODE", "require")
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}?sslmode={sslmode}"


@contextmanager
def db_connection(
    *,
    user_id: UUID | None = None,
    tenant_id: UUID | None = None,
) -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(connect_dsn(), row_factory=dict_row, connect_timeout=5)
    try:
        with conn.cursor() as cur:
            if user_id is not None:
                cur.execute("SELECT set_config('app.current_user_id', %s, true)", (str(user_id),))
            if tenant_id is not None:
                cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (str(tenant_id),))
        yield conn
        conn.commit()
    except psycopg.OperationalError as exc:
        conn.rollback()
        raise HttpError(503, "Database connection failed") from exc
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
