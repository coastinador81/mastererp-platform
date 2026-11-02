"""Cognito access-token adapter for legacy Onboarding, without group/email linking."""
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID
import jwt
from tenant_security.http import HttpError

@dataclass(frozen=True)
class AuthContext:
    user_id: UUID
    email: str | None
    groups: frozenset[str]
    claims: dict[str, Any]

    def has_group(self, group: str) -> bool:
        return False  # Cognito groups never authorize tenants.

    def can_create_tenant(self) -> bool:
        return os.environ.get("ALLOW_TENANT_SELF_REGISTRATION", "false").lower() == "true"

def validate_request(event):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    value = headers.get("authorization", "")
    if not value.lower().startswith("bearer "):
        raise HttpError(401, "Missing bearer token")
    issuer, client = os.environ.get("COGNITO_ISSUER"), os.environ.get("COGNITO_APP_CLIENT_ID")
    if not issuer or not client:
        raise HttpError(503, "Identity configuration unavailable")
    try:
        token = value.split(" ", 1)[1].strip()
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise jwt.InvalidTokenError()
        # Public issuer keys are pinned into the deployment artefact. No NAT needed.
        # A new unknown kid fails closed until the package is refreshed.
        keys = json.loads(Path(__file__).with_name("cognito-jwks.json").read_text())["keys"]
        jwk = next(k for k in keys if k.get("kid") == header.get("kid") and k.get("use") == "sig")
        claims = jwt.decode(token, jwt.PyJWK.from_dict(jwk).key, algorithms=["RS256"],
                            issuer=issuer, options={"verify_aud": False,
                            "require": ["exp", "iat", "iss", "sub", "token_use", "client_id"]})
        if claims.get("token_use") != "access" or claims.get("client_id") != client or not claims.get("sub"):
            raise jwt.InvalidTokenError()
        return claims
    except (jwt.PyJWTError, StopIteration, ValueError, TypeError, KeyError):
        raise HttpError(401, "Invalid access token") from None

def resolve_auth(event, conn, *, verified_claims=None):
    claims = verified_claims if verified_claims is not None else validate_request(event)
    row = conn.execute("SELECT plataforma.resolve_external_identity(%s,%s) AS id",
                       (claims["iss"], claims["sub"])).fetchone()
    if not row or row["id"] is None:
        raise HttpError(403, "Identity not linked or inactive")
    return AuthContext(user_id=row["id"], email=None, groups=frozenset(), claims=claims)

def resolve_tenant_for_request(auth, conn, tenant_id):
    row = conn.execute("SELECT plataforma.user_has_tenant_access(%s) AS allowed", (tenant_id,)).fetchone()
    if not row or row["allowed"] is not True:
        raise HttpError(403, "Tenant access denied")
    return tenant_id
