from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

from .repository import ProductsRepository
from .media import ProductMedia


def _header(event: dict[str, Any], name: str) -> str | None:
    return {key.lower(): value for key, value in (event.get("headers") or {}).items()}.get(name.lower())


def _claims(event: dict[str, Any]) -> dict[str, Any]:
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(claims, dict) or not claims.get("iss") or not claims.get("sub"):
        raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
    return claims


def _request(event: dict[str, Any], repository: ProductsRepository, media: ProductMedia | None = None) -> tuple[int, Any]:
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", event.get("httpMethod", "GET")).upper()
    product_id = (event.get("pathParameters") or {}).get("product_id")
    if product_id:
        UUID(product_id)
    path = http.get("path", event.get("rawPath", ""))
    if method == "POST" and product_id and path.endswith("/images/upload-request"):
        repository.require_write()
        repository.get(product_id)
        if media is None:
            raise HttpError(503, "Product media is not configured", code="media_unavailable")
        try:
            return 201, media.upload_request(product_id, parse_body(event))
        except ValueError:
            raise HttpError(400, "Use a JPG, PNG or WebP image up to 5 MB", code="invalid_image")
    if method == "GET" and product_id:
        return 200, repository.get(product_id)
    if method == "GET":
        query = event.get("queryStringParameters") or {}
        limit = int(query.get("limit", 50))
        if not 1 <= limit <= 100:
            raise HttpError(400, "limit must be between 1 and 100", code="invalid_request")
        return 200, {"items": repository.list(query.get("status"), query.get("search"), limit)}
    if method == "POST" and not product_id:
        payload = parse_body(event)
        key = _header(event, "idempotency-key")
        if not {"name", "price"} <= payload.keys() or not key or not 1 <= len(key) <= 128:
            raise HttpError(400, "name, price and Idempotency-Key are required", code="invalid_request")
        return 201, repository.create(payload, key)
    if method == "PATCH" and product_id:
        payload = parse_body(event)
        if "version" not in payload or len(payload) < 2:
            raise HttpError(400, "version and at least one change are required", code="invalid_request")
        return 200, repository.update(product_id, payload)
    raise HttpError(404, "Route not found", code="not_found")


def _sql_error(error: Exception) -> HttpError:
    mapping = {"22023": (400, "invalid_request"), "23514": (409, "invalid_product"),
               "23505": (409, "idempotency_conflict"), "40001": (409, "stale_version"),
               "42501": (403, "forbidden"), "P0002": (404, "not_found")}
    status, code = mapping.get(getattr(error, "sqlstate", None), (500, "internal_error"))
    return HttpError(status, "Product request could not be completed", code=code)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    from tenant_security.db import db_connection

    correlation_id = _header(event, "x-correlation-id") or str(uuid4())
    try:
        claims = _claims(event)
        tenant_id = _header(event, "x-tenant-id")
        if not tenant_id:
            raise HttpError(400, "X-Tenant-Id is required", code="invalid_request")
        UUID(tenant_id)
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET").upper()
        product_id = (event.get("pathParameters") or {}).get("product_id")
        operation = "catalog.products.read" if method == "GET" else "catalog.products.update" if product_id else "catalog.products.create"
        with db_connection(tenant_id=tenant_id, correlation_id=correlation_id, operation=operation) as connection:
            auth = resolve_auth(event, connection, verified_claims=claims)
            connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            status, body = _request(event, ProductsRepository(connection), ProductMedia(tenant_id) if product_id and method == "POST" else None)
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except (ValueError, TypeError):
        return api_response(400, {"error": {"code": "invalid_request", "message": "Invalid request values"}, "correlation_id": correlation_id})
    except Exception as error:
        mapped = _sql_error(error)
        return api_response(mapped.status, {"error": {"code": mapped.code, "message": mapped.message}, "correlation_id": correlation_id})
