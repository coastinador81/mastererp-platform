from typing import Any
from uuid import UUID

from tenant_security.http import HttpError


def provision_tenant(conn, auth, tenant_id: UUID, *, idempotency_key: str | None = None) -> dict[str, Any]:
    if idempotency_key:
        cached = conn.execute(
            """
            SELECT response_body FROM plataforma.idempotency_keys
            WHERE idempotency_key = %s AND actor_user_id = %s AND operation = 'tenant.provision'
              AND expires_at > now()
            """,
            (idempotency_key, auth.user_id),
        ).fetchone()
        if cached:
            return cached["response_body"]

    tenant = conn.execute(
        "SELECT id, name, status, settings FROM plataforma.tenants WHERE id = %s",
        (tenant_id,),
    ).fetchone()
    if not tenant:
        raise HttpError(404, "Tenant not found")
    if tenant["status"] == "active":
        return {"tenant_id": tenant_id, "status": "active", "idempotent": True}

    modules = conn.execute(
        """
        SELECT tm.id, tm.module_id, tm.status, m.code, m.requires_company
        FROM plataforma.tenant_modules tm
        JOIN plataforma.modules m ON m.id = tm.module_id
        WHERE tm.tenant_id = %s AND tm.status IN ('selected', 'provisioning')
        """,
        (tenant_id,),
    ).fetchall()

    for mod in modules:
        conn.execute(
            "UPDATE plataforma.tenant_modules SET status = 'provisioning' WHERE id = %s AND status = 'selected'",
            (mod["id"],),
        )
        if mod["requires_company"]:
            exists = conn.execute(
                "SELECT 1 FROM organizacion.companies WHERE tenant_id = %s LIMIT 1",
                (tenant_id,),
            ).fetchone()
            if not exists:
                settings = tenant["settings"] or {}
                company = settings.get("company") or {}
                legal_name = company.get("legal_name") or tenant.get("name") or "Company"
                country = company.get("country_code") or "US"
                currency = company.get("base_currency_code") or "USD"
                timezone = company.get("timezone") or "UTC"
                conn.execute(
                    """
                    INSERT INTO organizacion.companies (tenant_id, legal_name, country_code, base_currency_code, timezone)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (tenant_id, legal_name, country, currency, timezone),
                )
        conn.execute(
            """
            UPDATE plataforma.tenant_modules
            SET status = 'active', activated_at = COALESCE(activated_at, now())
            WHERE id = %s
            """,
            (mod["id"],),
        )

    updated = conn.execute(
        """
        UPDATE plataforma.tenants
        SET status = 'active'
        WHERE id = %s AND status IN ('draft', 'active')
        RETURNING id, status
        """,
        (tenant_id,),
    ).fetchone()

    conn.execute(
        """
        INSERT INTO auditoria.events (tenant_id, actor_user_id, module_code, entity_type, entity_id, action, metadata)
        VALUES (%s, %s, '1.1-tenant-onboarding', 'tenant', %s, 'tenant.provisioned', '{}'::jsonb)
        """,
        (tenant_id, auth.user_id, tenant_id),
    )

    result = {"tenant_id": tenant_id, "status": updated["status"], "modules_activated": len(modules)}
    if idempotency_key:
        conn.execute(
            """
            INSERT INTO plataforma.idempotency_keys (idempotency_key, actor_user_id, operation, resource_id, response_body)
            VALUES (%s, %s, 'tenant.provision', %s, %s::jsonb)
            ON CONFLICT (idempotency_key) DO NOTHING
            """,
            (idempotency_key, auth.user_id, tenant_id, result),
        )
    return result
