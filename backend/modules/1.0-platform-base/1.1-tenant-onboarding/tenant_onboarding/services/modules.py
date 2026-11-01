from typing import Any
from uuid import UUID

from tenant_security.http import HttpError


def list_catalog(conn, auth) -> dict[str, Any]:
    modules = conn.execute(
        """
        SELECT id, code, name, description, category, module_type, requires_company,
               requires_country, requires_subscription, status, configuration_schema
        FROM plataforma.modules
        WHERE status = 'active'
        ORDER BY category, code
        """
    ).fetchall()
    return {"modules": modules}


def list_tenant_modules(conn, auth, tenant_id: UUID) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT tm.id, tm.tenant_id, tm.module_id, tm.status, tm.configuration, tm.limits,
               tm.activated_at, m.code, m.name, m.category
        FROM plataforma.tenant_modules tm
        JOIN plataforma.modules m ON m.id = tm.module_id
        WHERE tm.tenant_id = %s
        ORDER BY m.code
        """,
        (tenant_id,),
    ).fetchall()
    return {"tenant_modules": rows}


def upsert_tenant_module(conn, auth, tenant_id: UUID, module_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    status = payload.get("status") or "selected"
    if status not in ("selected", "provisioning", "active", "suspended", "cancelled"):
        raise HttpError(400, "Invalid module status")
    configuration = payload.get("configuration") or {}
    idempotency_key = payload.get("idempotency_key")
    if idempotency_key:
        cached = conn.execute(
            """
            SELECT response_body FROM plataforma.idempotency_keys
            WHERE idempotency_key = %s AND actor_user_id = %s AND operation = 'tenant.module.upsert'
              AND expires_at > now()
            """,
            (idempotency_key, auth.user_id),
        ).fetchone()
        if cached:
            return cached["response_body"]

    row = conn.execute(
        """
        INSERT INTO plataforma.tenant_modules (tenant_id, module_id, status, configuration)
        VALUES (%s, %s, %s, %s::jsonb)
        ON CONFLICT (tenant_id, module_id) DO UPDATE
        SET status = EXCLUDED.status,
            configuration = EXCLUDED.configuration,
            updated_at = now()
        RETURNING id, tenant_id, module_id, status, configuration, activated_at
        """,
        (tenant_id, module_id, status, configuration),
    ).fetchone()
    result = {"tenant_module": row}
    if idempotency_key:
        conn.execute(
            """
            INSERT INTO plataforma.idempotency_keys (idempotency_key, actor_user_id, operation, resource_id, response_body)
            VALUES (%s, %s, 'tenant.module.upsert', %s, %s::jsonb)
            ON CONFLICT (idempotency_key) DO NOTHING
            """,
            (idempotency_key, auth.user_id, row["id"], result),
        )
    return result
