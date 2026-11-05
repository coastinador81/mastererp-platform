from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

from .repository import EcommerceRepository


def _header(event, name):
    return {k.lower(): v for k, v in (event.get("headers") or {}).items()}.get(name.lower())


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
    if method == "POST" and not store_id:
        if not {"node_id", "domain", "name"} <= payload.keys():
            raise HttpError(400, "node_id, domain and name are required", code="invalid_request")
        return 201, repository.configure(company_id, None, payload)
    if method == "PATCH" and store_id:
        if "version" not in payload or "changes" not in payload:
            raise HttpError(400, "version and changes are required", code="invalid_request")
        return 200, repository.configure(company_id, store_id, payload)
    raise HttpError(404, "Route not found", code="not_found")


def lambda_handler(event: dict[str, Any], context: Any):
    from tenant_security.db import db_connection

    correlation_id = _header(event, "x-correlation-id") or str(uuid4())
    path = event.get("requestContext", {}).get("http", {}).get("path", "")
    public = path == "/v1/storefront/catalog"
    try:
        tenant = _header(event, "x-tenant-id")
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
        if not public and (not isinstance(claims, dict) or not claims.get("iss") or not claims.get("sub")):
            raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
        try:
            UUID(tenant or "")
        except ValueError:
            raise HttpError(400, "Valid X-Tenant-Id is required", code="invalid_request") from None
        method = event.get("requestContext", {}).get("http", {}).get("method")
        operation = "digital_sales.ecommerce.public.read" if public else ("digital_sales.ecommerce.read" if method == "GET" else "digital_sales.ecommerce.configure")
        with db_connection(tenant_id=tenant, correlation_id=correlation_id, operation=operation) as connection:
            if not public:
                auth = resolve_auth(event, connection, verified_claims=claims)
                connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            status, body = _request(event, EcommerceRepository(connection), public=public)
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except Exception as error:
        status, code = {"22023": (400, "invalid_request"), "23505": (409, "conflict"), "40001": (409, "stale_version"), "42501": (403, "forbidden"), "P0002": (404, "not_found")}.get(getattr(error, "sqlstate", None), (500, "internal_error"))
        return api_response(status, {"error": {"code": code, "message": "E-commerce request failed"}, "correlation_id": correlation_id})
