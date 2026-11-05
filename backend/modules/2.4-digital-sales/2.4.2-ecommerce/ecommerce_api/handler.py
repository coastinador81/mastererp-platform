import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

from .repository import EcommerceRepository


def _header(event, name):
    return {k.lower(): v for k, v in (event.get("headers") or {}).items()}.get(name.lower())


def _claims(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(claims, dict) or not claims.get("iss") or not claims.get("sub"):
        raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
    return claims


def _verified_profile(claims):
    verified = claims.get("email_verified")
    if (claims.get("iss") != os.environ.get("COGNITO_ISSUER")
            or claims.get("aud") != os.environ.get("STOREFRONT_COGNITO_CLIENT_ID")
            or claims.get("token_use") != "id" or verified not in (True, "true")
            or not claims.get("email") or len(claims["email"]) > 254):
        raise HttpError(401, "Verified customer profile is required", code="unauthorized") from None
    return claims


def _request(event, repository, public=False):
    request = event.get("requestContext", {}).get("http", {})
    method = request.get("method", "GET").upper()
    params = event.get("pathParameters") or {}
    company_id, store_id = params.get("company_id"), params.get("store_id")
    if public:
        query = event.get("queryStringParameters") or {}
        domain = query.get("domain") or (_header(event, "host") or "").split(":")[0]
        if not domain:
            raise HttpError(400, "Store domain is required", code="invalid_request")
        return 200, repository.public_catalog(domain, int(query.get("limit", 100)))
    UUID(company_id or "")
    if store_id:
        UUID(store_id)
    if method == "GET" and store_id:
        return 200, repository.get(company_id, store_id)
    if method == "GET":
        query = event.get("queryStringParameters") or {}
        return 200, {"items": repository.list(company_id, int(query.get("limit", 50)))}
    payload = parse_body(event)
    customer_id = params.get("customer_id")
    if method == "POST" and store_id and customer_id:
        UUID(customer_id)
        ttl_hours = payload.get("ttl_hours", 24)
        if not isinstance(ttl_hours, int) or not 1 <= ttl_hours <= 168:
            raise HttpError(400, "ttl_hours must be between 1 and 168", code="invalid_request")
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        result = repository.create_invitation(company_id, store_id, customer_id, token_hash,
                                              datetime.now(timezone.utc) + timedelta(hours=ttl_hours))
        return 201, {**result, "token": token}
    if method == "POST" and not store_id:
        if not {"node_id", "domain", "name"} <= payload.keys():
            raise HttpError(400, "node_id, domain and name are required", code="invalid_request")
        return 201, repository.configure(company_id, None, payload)
    if method == "PATCH" and store_id:
        if "version" not in payload or "changes" not in payload:
            raise HttpError(400, "version and changes are required", code="invalid_request")
        return 200, repository.configure(company_id, store_id, payload)
    raise HttpError(404, "Route not found", code="not_found")


def _claim(event, repository, claims):
    payload = parse_body(event)
    token = payload.get("invitation_token")
    if not isinstance(token, str) or len(token) < 32:
        raise HttpError(400, "Invitation token is required", code="invalid_request")
    return 200, repository.claim_identity(_verified_profile(claims), token)


def _checkout(event, repository, claims):
    payload = parse_body(event)
    key = _header(event, "idempotency-key")
    required = {"domain", "items", "delivery", "delivery_method", "payment_method"}
    if (not required <= payload.keys() or not isinstance(key, str)
            or not 1 <= len(key) <= 128 or not isinstance(payload["items"], list)
            or not payload["items"] or not isinstance(payload["delivery"], dict)):
        raise HttpError(400, "Checkout fields and Idempotency-Key are required", code="invalid_request")
    return 201, repository.checkout(_verified_profile(claims), payload, key)


def lambda_handler(event: dict[str, Any], context: Any):
    from tenant_security.db import db_connection

    correlation_id = _header(event, "x-correlation-id") or str(uuid4())
    path = event.get("requestContext", {}).get("http", {}).get("path", "")
    public = path == "/v1/storefront/catalog"
    claim = path == "/v1/storefront/identity/claim"
    checkout = path == "/v1/storefront/checkout"
    try:
        tenant = _header(event, "x-tenant-id")
        claims = None if public else _claims(event)
        try:
            UUID(tenant or "")
        except ValueError:
            raise HttpError(400, "Valid X-Tenant-Id is required", code="invalid_request") from None
        method = event.get("requestContext", {}).get("http", {}).get("method")
        if public:
            operation = "digital_sales.ecommerce.public.read"
        elif claim:
            operation = "digital_sales.storefront.identity.claim"
        elif checkout:
            operation = "digital_sales.storefront.checkout"
        elif path.endswith("/invitations"):
            operation = "digital_sales.storefront.invitation.create"
        else:
            operation = "digital_sales.ecommerce.read" if method == "GET" else "digital_sales.ecommerce.configure"
        with db_connection(tenant_id=tenant, correlation_id=correlation_id, operation=operation) as connection:
            if not public and not claim:
                auth = resolve_auth(event, connection, verified_claims=claims)
                connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            repository = EcommerceRepository(connection)
            if claim:
                status, body = _claim(event, repository, claims)
            elif checkout:
                status, body = _checkout(event, repository, claims)
            else:
                status, body = _request(event, repository, public=public)
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except Exception as error:
        status, code = {"22023": (400, "invalid_request"), "23505": (409, "conflict"), "40001": (409, "stale_version"), "42501": (403, "forbidden"), "P0002": (404, "not_found")}.get(getattr(error, "sqlstate", None), (500, "internal_error"))
        return api_response(status, {"error": {"code": code, "message": "E-commerce request failed"}, "correlation_id": correlation_id})
