from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response
from .repository import InventoryReceiptsRepository


def _header(event, name):
    return {key.lower(): value for key, value in (event.get("headers") or {}).items()}.get(name.lower())


def _claims(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(claims, dict) or not claims.get("iss") or not claims.get("sub"):
        raise HttpError(401, "Verified JWT claims are required", code="unauthorized")
    return claims


def _parse_uuid(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise HttpError(400, "Invalid request values", code="invalid_request") from None


def _validation(order, *, detail=False):
    reasons = []
    if order.get("clase") != "orden_compra":
        reasons.append({"code": "not_purchase_order", "message": "El documento no es una orden de compra."})
    if (order.get("estado") or "").lower() == "borrador":
        reasons.append({"code": "draft_not_issued", "message": "La orden sigue en borrador; Finanzas aún no define aprobación o emisión."})
    else:
        reasons.append({"code": "receipt_state_undefined", "message": "El contrato de Compras aún no define estados habilitados para recepción."})
    if not order.get("proveedor_id"):
        reasons.append({"code": "supplier_missing", "message": "La orden no tiene proveedor asociado."})
    if detail:
        lines = order.get("lineas")
        if not isinstance(lines, list) or not lines:
            reasons.append({"code": "lines_missing", "message": "La orden no tiene líneas de productos."})
        elif any(not line.get("product_id") for line in lines):
            reasons.append({"code": "catalog_product_missing", "message": "Una o más líneas no están vinculadas a un producto de Catálogo."})
        reasons.append({"code": "receipt_tracking_missing", "message": "Inventario todavía no registra recepciones parciales o cantidades previamente recibidas."})
    record_valid = bool(
        order.get("id") and order.get("company_id") and order.get("clase") == "orden_compra"
        and order.get("proveedor_id") and order.get("numero") and order.get("fecha")
    )
    return {"record_valid": record_valid, "receipt_eligible": record_valid and not reasons, "reasons": reasons}


def _safe_order(order, *, detail=False):
    result = {
        "id": order.get("id"),
        "company_id": order.get("company_id"),
        "number": order.get("numero"),
        "date": order.get("fecha"),
        "supplier_id": order.get("proveedor_id"),
        "supplier": order.get("proveedor"),
        "status": order.get("estado"),
        "receipt_validation": _validation(order, detail=detail),
    }
    if detail:
        result["lines"] = [
            {
                "product_id": line.get("product_id"),
                "description": line.get("descripcion"),
                "quantity_ordered": line.get("cantidad"),
            }
            for line in order.get("lineas", [])
        ]
    return result


def _request(event, repository):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", event.get("httpMethod", "GET")).upper()
    params = event.get("pathParameters") or {}
    company_id = _parse_uuid(params.get("company_id"))
    order_id = params.get("purchase_order_id")
    query = event.get("queryStringParameters") or {}
    if method != "GET":
        raise HttpError(404, "Route not found", code="not_found")
    if order_id:
        if query:
            raise HttpError(400, "Invalid request values", code="invalid_request")
        order = repository.get_order(company_id, _parse_uuid(order_id))
        return 200, {"item": _safe_order(order, detail=True)}
    if set(query) - {"limit", "after"}:
        raise HttpError(400, "Invalid request values", code="invalid_request")
    try:
        limit = int(query.get("limit", "25"))
        if not 1 <= limit <= 100:
            raise ValueError()
        after = _parse_uuid(query["after"]) if query.get("after") else None
    except (ValueError, TypeError):
        raise HttpError(400, "Invalid request values", code="invalid_request") from None
    rows = repository.list_orders(company_id, limit + 1, after)
    has_more = len(rows) > limit
    page = rows[:limit]
    return 200, {
        "items": [_safe_order(order) for order in page],
        "next_cursor": page[-1]["id"] if has_more and page else None,
    }


def _sql_error(error):
    return {
        "42501": (403, "forbidden"),
        "P0002": (404, "not_found"),
        "22023": (400, "invalid_request"),
        "22P02": (400, "invalid_request"),
    }.get(getattr(error, "sqlstate", None), (500, "internal_error"))


def lambda_handler(event: dict[str, Any], context: Any):
    from tenant_security.db import db_connection

    correlation = _header(event, "x-correlation-id") or str(uuid4())
    try:
        claims = _claims(event)
        tenant = _parse_uuid(_header(event, "x-tenant-id"))
        with db_connection(tenant_id=tenant, correlation_id=correlation,
                           operation="administration.purchase.read") as connection:
            auth = resolve_auth(event, connection, verified_claims=claims)
            connection.execute("SELECT set_config('app.current_user_id', %s, true)", (str(auth.user_id),))
            status, body = _request(event, InventoryReceiptsRepository(connection))
        return api_response(status, {**body, "correlation_id": correlation})
    except HttpError as error:
        return api_response(error.status, {
            "error": {"code": error.code, "message": error.message},
            "correlation_id": correlation,
        })
    except Exception as error:
        status, code = _sql_error(error)
        return api_response(status, {
            "error": {"code": code, "message": "Purchase orders could not be validated"},
            "correlation_id": correlation,
        })
