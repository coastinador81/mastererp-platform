"""Application credentials only; one transaction and a fresh connection per request."""
import json
import os
from pathlib import Path
from contextlib import contextmanager
import boto3
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import JsonbDumper
from tenant_security.http import HttpError

def load_database_secret():
    arn = os.environ.get("DATABASE_SECRET_ARN")
    if not arn:
        raise HttpError(503, "Database configuration unavailable")
    raw = boto3.client("secretsmanager").get_secret_value(SecretId=arn)
    value = json.loads(raw["SecretString"])
    if value.get("username") != "mastererp_app":
        raise HttpError(503, "Application credentials required")
    return value

@contextmanager
def db_connection(*, user_id=None, tenant_id=None, correlation_id=None, operation="onboarding"):
    creds = load_database_secret()
    conn = psycopg.connect(host=os.environ["DATABASE_HOST"], port=int(creds.get("port",5432)),
        dbname="mastererp", user="mastererp_app", password=creds["password"],
        sslmode="verify-full", sslrootcert=str(Path(__file__).with_name("rds-us-west-1-bundle.pem")),
        row_factory=dict_row, connect_timeout=5)
    conn.adapters.register_dumper(dict, JsonbDumper)
    conn.adapters.register_dumper(list, JsonbDumper)
    try:
        if conn.execute("SELECT current_user AS role").fetchone()["role"] != "mastererp_app":
            raise HttpError(503, "Application role required")
        for key, value in {"current_user_id":user_id,"current_tenant_id":tenant_id,
                           "current_operation":operation,"correlation_id":correlation_id,
                           "current_company_id":None,"current_branch_id":None}.items():
            conn.execute("SELECT set_config(%s,%s,true)",("app."+key,str(value) if value else ""))
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
