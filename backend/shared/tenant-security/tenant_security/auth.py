import json
import os
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import jwt
from jwt import PyJWKClient

from tenant_security.http import HttpError


@dataclass(frozen=True)
class AuthContext:
    user_id: UUID
    email: str | None
    groups: frozenset[str]
    claims: dict[str, Any]

    def has_group(self, group: str) -> bool:
        return group in self.groups

    def can_create_tenant(self) -> bool:
        if self.has_group("platform.admin") or self.has_group("tenant.register"):
            return True
        return os.environ.get("ALLOW_TENANT_SELF_REGISTRATION", "false").lower() == "true"


_jwks_client: PyJWKClient | None = None


def _jwt_issuer() -> str:
    pool_id = os.environ["COGNITO_USER_POOL_ID"]
    region = os.environ.get("AWS_REGION", "us-west-2")
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def _validate_jwt(token: str) -> dict[str, Any]:
    global _jwks_client
    issuer = _jwt_issuer()
    if _jwks_client is None:
        _jwks_client = PyJWKClient(f"{issuer}/.well-known/jwks.json")
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    audience = os.environ.get("COGNITO_APP_CLIENT_ID")
    options = {"verify_aud": bool(audience)}
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=audience,
        issuer=issuer,
        options=options,
    )


def resolve_auth(event: dict[str, Any], conn) -> AuthContext:
    mode = os.environ.get("AUTH_MODE", "cognito").lower()
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}

    if mode == "local":
        user_header = headers.get("x-mastererp-user-id")
        if not user_header:
            raise HttpError(401, "Missing X-MasterERP-User-Id header")
        user_id = UUID(user_header)
        row = conn.execute(
            "SELECT id, email FROM plataforma.users WHERE id = %s",
            (user_id,),
        ).fetchone()
        if not row:
            raise HttpError(401, "Unknown user")
        groups = frozenset(g.strip() for g in headers.get("x-mastererp-groups", "").split(",") if g.strip())
        return AuthContext(user_id=row["id"], email=row["email"], groups=groups, claims={})

    auth_header = headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HttpError(401, "Missing bearer token")
    token = auth_header.split(" ", 1)[1].strip()
    try:
        claims = _validate_jwt(token)
    except jwt.PyJWTError as exc:
        raise HttpError(401, "Invalid token") from exc

    sub = claims.get("sub")
    email = claims.get("email")
    if not sub:
        raise HttpError(401, "Token missing subject")

    row = conn.execute(
        """
        SELECT id, email
        FROM plataforma.users
        WHERE external_identity_id = %s OR email = %s
        LIMIT 1
        """,
        (sub, email),
    ).fetchone()
    if not row:
        raise HttpError(403, "User is not provisioned in MasterERP")

    groups = frozenset(claims.get("cognito:groups") or [])
    return AuthContext(user_id=row["id"], email=row["email"], groups=groups, claims=claims)


def resolve_tenant_for_request(auth: AuthContext, conn, tenant_id: UUID) -> UUID:
    row = conn.execute(
        """
        SELECT tenant_id
        FROM plataforma.user_tenants
        WHERE tenant_id = %s AND user_id = %s AND status = 'active'
        """,
        (tenant_id, auth.user_id),
    ).fetchone()
    if not row and not auth.has_group("platform.admin"):
        raise HttpError(403, "Tenant access denied")
    return tenant_id
