"""Authorized Finance adapter for reviewing Storefront payment evidence."""
import json
import logging
from uuid import UUID, uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)

def database_error(error, correlation_id):
    sqlstate = getattr(error, "sqlstate", None)
    diagnostic = getattr(error, "diag", None)
    LOG.error(json.dumps({"event": "payment_review_failure", "correlation_id": correlation_id,
        "sqlstate": sqlstate or "unknown", "constraint": getattr(diagnostic, "constraint_name", None),
        "exception": type(error).__name__}, sort_keys=True))
    return {"40001": (409, "stale_version"), "23514": (409, "invalid_review"),
        "23505": (409, "idempotency_conflict"), "42501": (403, "forbidden"),
        "P0002": (404, "not_found"), "55P03": (409, "resource_busy"),
        "57014": (503, "review_timeout")}.get(sqlstate, (500, "internal_error"))

def header(event, name):
    return {key.lower(): value for key, value in (event.get("headers") or {}).items()}.get(name.lower())

def claims(event):
    value = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(value, dict) or not value.get("iss") or not value.get("sub"):
        raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
    return value

def request(event, connection):
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method", "GET").upper(), http.get("path", "")
    query, params = event.get("queryStringParameters") or {}, event.get("pathParameters") or {}
    company_id = query.get("company_id") or params.get("company_id")
    if not company_id: raise HttpError(400, "company_id is required", code="invalid_request")
    UUID(company_id)
    if method == "GET" and path.endswith("/pending"):
        limit = int(query.get("limit", 50))
        row = connection.execute("SELECT administracion.pagos_pendientes_leer(%s,%s) AS value", (company_id, limit)).fetchone()
        return 200, {"items": row["value"]}
    if method == "POST" and path.endswith("/review"):
        order_id = params.get("order_id"); UUID(order_id)
        payload, key = parse_body(event), header(event, "idempotency-key")
        required = {"version", "decision", "reason", "evidence"}
        if not required <= payload.keys() or type(payload["version"]) is not int or payload["version"] < 1:
            raise HttpError(400, "Review fields are required", code="invalid_request")
        if payload["decision"] not in ("VALIDATED", "REJECTED") or not isinstance(payload["reason"], str):
            raise HttpError(400, "Invalid payment decision", code="invalid_request")
        if not 1 <= len(payload["reason"].strip()) <= 300 or not isinstance(payload["evidence"], dict):
            raise HttpError(400, "Invalid payment review", code="invalid_request")
        if not key or not 1 <= len(key) <= 128: raise HttpError(400, "Idempotency-Key is required", code="invalid_request")
        row = connection.execute("SELECT administracion.pago_revisar(%s,%s,%s,%s,%s,%s,%s) AS value",
            (company_id, order_id, payload["version"], payload["decision"], payload["reason"],
             json.dumps(payload["evidence"]), key)).fetchone()
        return 200, row["value"]
    raise HttpError(404, "Route not found", code="not_found")

def lambda_handler(event, context):
    from tenant_security.db import db_connection
    correlation_id = header(event, "x-correlation-id") or str(uuid4())
    try:
        verified = claims(event); tenant_id = header(event, "x-tenant-id")
        if not tenant_id: raise HttpError(400, "X-Tenant-Id is required", code="invalid_request")
        UUID(tenant_id)
        with db_connection(tenant_id=tenant_id, correlation_id=correlation_id, operation="administration.receipts.validate") as connection:
            auth = resolve_auth(event, connection, verified_claims=verified)
            connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            status, body = request(event, connection)
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except (ValueError, TypeError):
        return api_response(400, {"error": {"code": "invalid_request", "message": "Invalid request values"}, "correlation_id": correlation_id})
    except Exception as error:
        status, code = database_error(error, correlation_id)
        return api_response(status, {"error": {"code": code, "message": "Payment review could not be completed"}, "correlation_id": correlation_id})
