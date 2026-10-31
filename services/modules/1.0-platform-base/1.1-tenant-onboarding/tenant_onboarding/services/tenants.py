import re
from typing import Any
from uuid import UUID

from tenant_security.http import HttpError


_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")


def create_tenant(conn, auth, payload: dict[str, Any]) -> dict[str, Any]:
    if not auth.can_create_tenant():
        raise HttpError(403, "Not authorized to create tenants", code="tenant.create.forbidden")

    code = str(payload.get("code", "")).strip()
    slug = str(payload.get("slug", "")).strip().lower()
    name = str(payload.get("name", "")).strip()
    tenant_type = str(payload.get("tenant_type", "individual")).strip()
    idempotency_key = payload.get("idempotency_key")

    if not code or not slug or not name:
        raise HttpError(400, "code, slug and name are required")
    if tenant_type not in ("individual", "business", "group"):
        raise HttpError(400, "Invalid tenant_type")
    if not _SLUG_RE.match(slug):
        raise HttpError(400, "Invalid slug format")

    row = conn.execute(
        """
        SELECT plataforma.create_tenant_with_owner(%s, %s, %s, %s, %s, %s) AS tenant_id
        """,
        (code, slug, name, tenant_type, auth.user_id, idempotency_key),
    ).fetchone()
    tenant_id = row["tenant_id"]
    tenant = conn.execute(
        "SELECT id, code, slug, name, tenant_type, status, settings FROM plataforma.tenants WHERE id = %s",
        (tenant_id,),
    ).fetchone()
    return {"tenant": tenant}


def get_tenant_config(conn, auth, tenant_id: UUID) -> dict[str, Any]:
    tenant = conn.execute(
        "SELECT id, code, slug, name, tenant_type, status, settings, metadata FROM plataforma.tenants WHERE id = %s",
        (tenant_id,),
    ).fetchone()
    if not tenant:
        raise HttpError(404, "Tenant not found")
    return {"config": tenant}


def patch_tenant_config(conn, auth, tenant_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    settings = payload.get("settings")
    metadata = payload.get("metadata")
    if settings is None and metadata is None:
        raise HttpError(400, "Nothing to update")
    tenant = conn.execute(
        """
        UPDATE plataforma.tenants
        SET settings = COALESCE(%s, settings),
            metadata = COALESCE(%s, metadata)
        WHERE id = %s
        RETURNING id, code, slug, name, tenant_type, status, settings, metadata
        """,
        (settings, metadata, tenant_id),
    ).fetchone()
    if not tenant:
        raise HttpError(404, "Tenant not found")
    return {"config": tenant}
