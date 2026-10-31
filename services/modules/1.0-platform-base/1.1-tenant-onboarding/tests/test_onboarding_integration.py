import os
from uuid import uuid4

import psycopg
import pytest

from tenant_onboarding.services.modules import list_catalog, upsert_tenant_module
from tenant_onboarding.services.provisioning import provision_tenant
from tenant_onboarding.services.sessions import create_session
from tenant_onboarding.services.tenants import create_tenant
from tenant_security.auth import AuthContext


def _auth(user_id, *, groups=frozenset({"tenant.register"})):
    return AuthContext(user_id=user_id, email="test@example.invalid", groups=groups, claims={})


def test_tenant_create_idempotency(requires_db):
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=False)
    user_id = uuid4()
    conn.execute(
        "INSERT INTO plataforma.users (id, email, display_name) VALUES (%s, %s, %s)",
        (user_id, f"{user_id}@example.invalid", "Test User"),
    )
    conn.execute("SELECT set_config('app.current_user_id', %s, true)", (str(user_id),))
    auth = _auth(user_id)
    key = f"idem-{uuid4()}"
    first = create_tenant(conn, auth, {"code": f"c-{uuid4().hex[:8]}", "slug": f"s-{uuid4().hex[:8]}", "name": "T1", "idempotency_key": key})
    second = create_tenant(conn, auth, {"code": "other", "slug": "other-slug", "name": "T2", "idempotency_key": key})
    assert first["tenant"]["id"] == second["tenant"]["id"]
    conn.rollback()


def test_cross_tenant_denied(requires_db):
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=False)
    owner = uuid4()
    intruder = uuid4()
    for uid, email in ((owner, "owner@example.invalid"), (intruder, "intruder@example.invalid")):
        conn.execute(
            "INSERT INTO plataforma.users (id, email, display_name) VALUES (%s, %s, %s)",
            (uid, email, email),
        )
    conn.execute("SELECT set_config('app.current_user_id', %s, true)", (str(owner),))
    tenant = create_tenant(
        conn,
        _auth(owner),
        {"code": f"c-{uuid4().hex[:8]}", "slug": f"s-{uuid4().hex[:8]}", "name": "Owned"},
    )["tenant"]
    conn.execute("SELECT set_config('app.current_user_id', %s, true)", (str(intruder),))
    conn.execute("SELECT set_config('app.current_tenant_id', %s, true)", (str(tenant["id"]),))
    from tenant_security.auth import resolve_tenant_for_request
    from tenant_security.http import HttpError

    with pytest.raises(HttpError) as exc:
        resolve_tenant_for_request(_auth(intruder), conn, tenant["id"])
    assert exc.value.status == 403
    conn.rollback()


def test_onboarding_flow(requires_db):
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=False)
    user_id = uuid4()
    conn.execute(
        "INSERT INTO plataforma.users (id, email, display_name) VALUES (%s, %s, %s)",
        (user_id, f"{user_id}@example.invalid", "Flow User"),
    )
    conn.execute("SELECT set_config('app.current_user_id', %s, true)", (str(user_id),))
    auth = _auth(user_id)
    tenant = create_tenant(
        conn,
        auth,
        {"code": f"c-{uuid4().hex[:8]}", "slug": f"s-{uuid4().hex[:8]}", "name": "Flow Tenant"},
    )["tenant"]
    session = create_session(conn, auth, {"tenant_id": tenant["id"]})["session"]
    assert session["status"] == "started"
    catalog = list_catalog(conn, auth)
    assert len(catalog["modules"]) > 0
    module_id = catalog["modules"][0]["id"]
    conn.execute("SELECT set_config('app.current_tenant_id', %s, true)", (str(tenant["id"]),))
    upsert_tenant_module(conn, auth, tenant["id"], module_id, {"status": "selected"})
    result = provision_tenant(conn, auth, tenant["id"], idempotency_key=f"prov-{uuid4()}")
    assert result["status"] == "active"
    conn.rollback()
