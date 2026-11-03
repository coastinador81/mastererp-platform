from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

from .repository import DriversRepository


def _header(event, name):
    return {key.lower(): value for key, value in (event.get("headers") or {}).items()}.get(name.lower())


def _claims(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(claims, dict) or not claims.get("iss") or not claims.get("sub"):
        raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
    return claims


def _request(event, repository):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", event.get("httpMethod", "GET")).upper()
    path = http.get("path", "")
    params = event.get("pathParameters") or {}
    company_id = params.get("company_id")
    driver_id = params.get("driver_id")
    node_id = params.get("node_id")
    if not company_id:
        raise HttpError(400, "company_id is required", code="invalid_request")
    UUID(company_id)
    if driver_id:
        UUID(driver_id)
    if node_id:
        UUID(node_id)
    if method == "GET" and driver_id:
        return 200, repository.get(company_id, driver_id)
    if method == "GET":
        query = event.get("queryStringParameters") or {}
        limit = int(query.get("limit", 50))
        if not 1 <= limit <= 100:
            raise HttpError(400, "Invalid limit", code="invalid_request")
        filter_node = query.get("node_id")
        if filter_node:
            UUID(filter_node)
        return 200, {"items": repository.list(company_id, filter_node, query.get("status"), limit)}
    payload = parse_body(event)
    if method == "POST" and path.endswith("/drivers"):
        if not isinstance(payload, dict) or not {"name", "phone"} <= payload.keys():
            raise HttpError(400, "name and phone are required", code="invalid_request")
        idempotency_key = _header(event, "idempotency-key")
        if not idempotency_key or len(idempotency_key) > 200:
            raise HttpError(400, "A valid Idempotency-Key is required", code="invalid_request")
        return 201, repository.create(company_id, payload, idempotency_key)
    if method == "PATCH" and driver_id:
        if not isinstance(payload, dict) or "version" not in payload or len(payload) < 2:
            raise HttpError(400, "version and at least one change are required", code="invalid_request")
        return 200, repository.update(company_id, driver_id, payload)
    if method == "PUT" and driver_id and node_id:
        if not isinstance(payload, dict) or not isinstance(payload.get("active"), bool):
            raise HttpError(400, "active must be boolean", code="invalid_request")
        return 200, repository.assign(company_id, node_id, driver_id, payload["active"])
    raise HttpError(404, "Route not found", code="not_found")


def _sql_error(error):
    status, code = {
        "22023": (400, "invalid_request"), "23505": (409, "conflict"),
        "23514": (409, "invalid_state"), "40001": (409, "stale_version"),
        "42501": (403, "forbidden"), "P0002": (404, "not_found"),
    }.get(getattr(error, "sqlstate", None), (500, "internal_error"))
    return HttpError(status, "Driver request could not be completed", code=code)


def lambda_handler(event: dict[str, Any], context: Any):
    from tenant_security.db import db_connection
    correlation_id = _header(event, "x-correlation-id") or str(uuid4())
    try:
        claims = _claims(event)
        tenant_id = _header(event, "x-tenant-id")
        UUID(tenant_id or "")
        http = event.get("requestContext", {}).get("http", {})
        method = http.get("method", "GET").upper()
        path = http.get("path", "")
        operation = ("transport.drivers.read" if method == "GET" else
                     "transport.drivers.create" if method == "POST" else
                     "transport.drivers.assign" if method == "PUT" and "/nodes/" in path else
                     "transport.drivers.update")
        with db_connection(tenant_id=tenant_id, correlation_id=correlation_id, operation=operation) as connection:
            auth = resolve_auth(event, connection, verified_claims=claims)
            connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            status, body = _request(event, DriversRepository(connection))
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except (ValueError, TypeError):
        return api_response(400, {"error": {"code": "invalid_request", "message": "Invalid request values"}, "correlation_id": correlation_id})
    except Exception as error:
        mapped = _sql_error(error)
        return api_response(mapped.status, {"error": {"code": mapped.code, "message": mapped.message}, "correlation_id": correlation_id})
