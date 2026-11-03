"""API Gateway v2 adapter for the canonical Orders capability."""
from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

from .repository import OrdersRepository

REQUIRED_CREATE = frozenset({"branch_id", "customer_id", "currency", "items", "customer_snapshot",
                             "delivery_snapshot", "payment_snapshot", "delivery_window_ref",
                             "delivery_method", "inventory_reservation_ref"})


def _header(event: dict[str, Any], name: str) -> str | None:
    headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
    return headers.get(name.lower())


def _verified_claims(event: dict[str, Any]) -> dict[str, Any]:
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(claims, dict) or not claims.get("iss") or not claims.get("sub"):
        raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
    return claims


def _request(event: dict[str, Any], repository: OrdersRepository) -> tuple[int, Any]:
    request = event.get("requestContext", {}).get("http", {})
    method = request.get("method", event.get("httpMethod", "GET")).upper()
    params = event.get("pathParameters") or {}
    company_id, order_id = params.get("company_id"), params.get("order_id")
    if not company_id:
        raise HttpError(400, "company_id is required", code="invalid_request")
    UUID(company_id)
    if method == "GET" and order_id:
        UUID(order_id)
        return 200, repository.get(company_id, order_id)
    if method == "GET":
        query = event.get("queryStringParameters") or {}
        limit = int(query.get("limit", 25))
        if not 1 <= limit <= 100:
            raise HttpError(400, "limit must be between 1 and 100", code="invalid_request")
        return 200, {"items": repository.list(company_id, query.get("status"), limit)}
    if method == "POST" and order_id and request.get("path", "").endswith("/transitions"):
        UUID(order_id)
        payload = parse_body(event)
        if not {"version", "status", "reason"} <= payload.keys():
            raise HttpError(400, "version, status and reason are required", code="invalid_request")
        return 200, repository.transition(company_id, order_id, payload)
    if method == "POST" and not order_id:
        payload = parse_body(event)
        missing = REQUIRED_CREATE - payload.keys()
        key = _header(event, "idempotency-key")
        if missing or not key or not 1 <= len(key) <= 128:
            raise HttpError(400, "Required order fields and Idempotency-Key are required", code="invalid_request")
        return 201, repository.create(company_id, payload, key)
    raise HttpError(404, "Route not found", code="not_found")


def _sql_error(error: Exception) -> HttpError:
    state = getattr(error, "sqlstate", None)
    mapping = {"22023": (400, "invalid_request"), "23514": (409, "invalid_transition"),
               "23505": (409, "idempotency_conflict"), "40001": (409, "stale_version"),
               "42501": (403, "forbidden"), "P0002": (404, "not_found")}
    status, code = mapping.get(state, (500, "internal_error"))
    return HttpError(status, "Order request could not be completed", code=code)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    from tenant_security.db import db_connection

    correlation_id = _header(event, "x-correlation-id") or str(uuid4())
    try:
        claims = _verified_claims(event)
        tenant_id = _header(event, "x-tenant-id")
        if not tenant_id:
            raise HttpError(400, "X-Tenant-Id is required", code="invalid_request")
        UUID(tenant_id)
        request = event.get("requestContext", {}).get("http", {})
        operation = "operations.orders.create" if request.get("method") == "POST" and not (event.get("pathParameters") or {}).get("order_id") else "operations.orders.transition"
        if request.get("method", "GET") == "GET":
            operation = "operations.orders.read"
        with db_connection(tenant_id=tenant_id, correlation_id=correlation_id, operation=operation) as connection:
            auth = resolve_auth(event, connection, verified_claims=claims)
            connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            status, body = _request(event, OrdersRepository(connection))
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except (ValueError, TypeError):
        return api_response(400, {"error": {"code": "invalid_request", "message": "Invalid request values"}, "correlation_id": correlation_id})
    except Exception as error:
        mapped = _sql_error(error)
        return api_response(mapped.status, {"error": {"code": mapped.code, "message": mapped.message}, "correlation_id": correlation_id})
