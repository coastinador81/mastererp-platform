import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError, api_response, parse_body

from .repository import EcommerceRepository
from .exchange_rate import current_rate


def _validate_payment_configuration(changes):
    if not isinstance(changes, dict) or "configuration" not in changes:
        return
    configuration = changes["configuration"]
    if not isinstance(configuration, dict):
        raise HttpError(400, "Invalid store configuration", code="invalid_request")
    payments = configuration.get("payments", {})
    details = configuration.get("paymentDetails", {})
    if not isinstance(payments, dict) or not isinstance(details, dict):
        raise HttpError(400, "Invalid payment configuration", code="invalid_request")
    for key in ("efectivo", "al-recibir", "pago-movil", "transferencia", "punto-venta-entrega", "punto-venta-retiro"):
        if key in payments and not isinstance(payments[key], bool):
            raise HttpError(400, "Payment flags must be boolean", code="invalid_request")
    _validate_custom_methods(details.get("customMethods", []))
    mobile = details.get("mobilePayment")
    transfer = details.get("bankTransfer")
    if payments.get("pago-movil") is True and (not isinstance(mobile, dict)
            or not re.fullmatch(r"[VEJG]-?\d{6,12}", str(mobile.get("document", "")), re.I)
            or not re.fullmatch(r"0\d{10}", str(mobile.get("phone", "")))
            or not re.fullmatch(r"\d{4}", str(mobile.get("bankCode", "")))):
        raise HttpError(400, "Invalid mobile payment recipient", code="invalid_request")
    if payments.get("transferencia") is True and (not isinstance(transfer, dict)
            or not re.fullmatch(r"[VEJG]-?\d{6,12}", str(transfer.get("document", "")), re.I)
            or not re.fullmatch(r"\d{4}", str(transfer.get("bankCode", "")))
            or not re.fullmatch(r"\d{10,30}", str(transfer.get("accountNumber", "")))):
        raise HttpError(400, "Invalid bank transfer recipient", code="invalid_request")


def _validate_custom_methods(methods):
    if not isinstance(methods, list) or len(methods) > 10:
        raise HttpError(400, "Invalid custom payment methods", code="invalid_request")
    ids = set()
    for item in methods:
        if (not isinstance(item, dict) or set(item) - {"id", "name", "instructions", "enabled"}
                or not re.fullmatch(r"[a-z0-9-]{1,40}", str(item.get("id", ""))) or item["id"] in ids
                or not isinstance(item.get("name"), str) or not 2 <= len(item["name"].strip()) <= 60
                or not isinstance(item.get("instructions"), str) or not 1 <= len(item["instructions"].strip()) <= 500
                or not isinstance(item.get("enabled"), bool)):
            raise HttpError(400, "Invalid custom payment method", code="invalid_request")
        ids.add(item["id"])


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
        _validate_payment_configuration(payload["changes"])
        return 200, repository.configure(company_id, store_id, payload)
    raise HttpError(404, "Route not found", code="not_found")


def _claim(event, repository, claims):
    payload = parse_body(event)
    token = payload.get("invitation_token")
    if not isinstance(token, str) or len(token) < 32:
        raise HttpError(400, "Invitation token is required", code="invalid_request")
    return 200, repository.claim_identity(_verified_profile(claims), token)


def _register(event, repository, claims):
    payload = parse_body(event)
    domain = payload.get("domain")
    if not isinstance(domain, str) or not domain:
        raise HttpError(400, "Store domain is required", code="invalid_request")
    return 200, repository.register_identity(_verified_profile(claims), domain)


def _checkout(event, repository, claims):
    payload = parse_body(event)
    key = _header(event, "idempotency-key")
    required = {"domain", "items", "delivery", "delivery_method", "payment_method"}
    if (not required <= payload.keys() or not isinstance(key, str)
            or not 1 <= len(key) <= 128 or not isinstance(payload["items"], list)
            or not payload["items"] or not isinstance(payload["delivery"], dict)):
        raise HttpError(400, "Checkout fields and Idempotency-Key are required", code="invalid_request")
    delivery = payload["delivery"]
    latitude, longitude = delivery.get("latitude"), delivery.get("longitude")
    if (not isinstance(delivery.get("address"), str) or not 5 <= len(delivery["address"].strip()) <= 500
            or isinstance(latitude, bool) or not isinstance(latitude, (int, float)) or not -90 <= latitude <= 90
            or isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or not -180 <= longitude <= 180):
        raise HttpError(400, "A geocoded delivery address is required", code="invalid_delivery_address")
    method = payload.get("payment_method")
    reference = payload.get("payment_reference")
    if method not in ("cash", "pos", "mobile", "transfer", "custom") or (method not in ("cash", "pos") and (
            not isinstance(reference, str) or not reference.isdigit() or not 4 <= len(reference) <= 40)):
        raise HttpError(400, "Valid payment method and reference are required", code="invalid_request")
    if method == "custom" and not re.fullmatch(r"[a-z0-9-]{1,40}", str(payload.get("payment_method_id", ""))):
        raise HttpError(400, "Valid payment method is required", code="invalid_request")
    payer = _payer(method, payload.get("payer"))
    profile = _verified_profile(claims)
    rate = current_rate() if method in ("mobile", "transfer") else None
    if method in ("mobile", "transfer") and not rate:
        raise HttpError(503, "Current exchange rate is unavailable", code="exchange_rate_unavailable")
    order = repository.checkout(profile, {**payload, "_payer": payer, "_exchange_rate": rate}, key)
    if payer:
        repository.save_payment_method(profile, payload["domain"], method, payer)
    return 201, order


def _payer(method, payer):
    if payer is None or method not in ("mobile", "transfer"):
        return None
    phone = payer.get("phone") if isinstance(payer, dict) else None
    holder = payer.get("holder") if isinstance(payer, dict) else None
    if (not isinstance(payer, dict)
            or not re.fullmatch(r"\d{4}", str(payer.get("bankCode", "")))
            or not re.fullmatch(r"[VEJGP]-?\d{5,12}", str(payer.get("document", "")), re.I)
            or (phone is not None and not re.fullmatch(r"0\d{10}", str(phone)))
            or (method == "mobile" and phone is None)
            or (holder is not None and (not isinstance(holder, str) or not 2 <= len(holder.strip()) <= 120))):
        raise HttpError(400, "Valid payer details are required", code="invalid_request")
    return {"bankCode": payer["bankCode"], "document": payer["document"], "phone": phone, "holder": holder}


def _customer_portal(event, repository, claims, path):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET").upper()
    query = event.get("queryStringParameters") or {}
    domain = query.get("domain")
    if not isinstance(domain, str) or not domain:
        raise HttpError(400, "Store domain is required", code="invalid_request")
    profile = _verified_profile(claims)
    if path == "/v1/storefront/me":
        if method == "GET":
            return 200, repository.customer_read(profile, domain, "profile")
        if method != "PATCH":
            raise HttpError(404, "Route not found", code="not_found")
        payload = parse_body(event)
        if not all(isinstance(payload.get(field), str) for field in ("name", "phone", "birthDate")):
            raise HttpError(400, "Profile fields are required", code="invalid_request")
        return 200, repository.update_profile(profile, domain, payload)
    if path == "/v1/storefront/me/addresses":
        if method == "GET":
            return 200, {"items": repository.customer_read(profile, domain, "addresses")}
        if method != "POST":
            raise HttpError(404, "Route not found", code="not_found")
        payload = parse_body(event)
        required = ("label", "address", "zone", "latitude", "longitude")
        if any(payload.get(field) in (None, "") for field in required):
            raise HttpError(400, "Address fields are required", code="invalid_request")
        return 201, repository.save_address(profile, domain, payload)
    if path.startswith("/v1/storefront/me/addresses/") and method == "PATCH":
        address_id = UUID((event.get("pathParameters") or {}).get("address_id") or "")
        payload = parse_body(event)
        if not isinstance(payload.get("version"), int):
            raise HttpError(400, "Address version is required", code="invalid_request")
        return 200, repository.save_address(profile, domain, payload, address_id)
    if path == "/v1/storefront/me/payment-methods" and method == "GET":
        return 200, {"items": repository.payment_methods(profile, domain)}
    if path == "/v1/storefront/orders" and method == "GET":
        return 200, {"items": repository.customer_read(profile, domain, "orders", limit=int(query.get("limit", 25)))}
    if path.startswith("/v1/storefront/orders/") and method == "GET":
        order_id = UUID((event.get("pathParameters") or {}).get("order_id") or "")
        return 200, repository.customer_read(profile, domain, "orders", item_id=order_id, limit=1)
    raise HttpError(404, "Route not found", code="not_found")


def lambda_handler(event: dict[str, Any], context: Any):
    from tenant_security.db import db_connection

    correlation_id = _header(event, "x-correlation-id") or str(uuid4())
    path = event.get("requestContext", {}).get("http", {}).get("path", "")
    public = path == "/v1/storefront/catalog"
    claim = path == "/v1/storefront/identity/claim"
    registration = path == "/v1/storefront/identity/register"
    checkout = path == "/v1/storefront/checkout"
    portal = path == "/v1/storefront/me" or path.startswith("/v1/storefront/me/") or path.startswith("/v1/storefront/orders")
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
        elif registration:
            operation = "digital_sales.storefront.identity.register"
        elif checkout:
            operation = "digital_sales.storefront.checkout"
        elif portal:
            operation = "digital_sales.storefront.customer.read" if method == "GET" else "digital_sales.storefront.customer.write"
        elif path.endswith("/invitations"):
            operation = "digital_sales.storefront.invitation.create"
        else:
            operation = "digital_sales.ecommerce.read" if method == "GET" else "digital_sales.ecommerce.configure"
        with db_connection(tenant_id=tenant, correlation_id=correlation_id, operation=operation) as connection:
            if not public and not claim and not registration:
                auth = resolve_auth(event, connection, verified_claims=claims)
                connection.execute("SELECT set_config('app.current_user_id',%s,true)", (str(auth.user_id),))
            repository = EcommerceRepository(connection)
            if claim:
                status, body = _claim(event, repository, claims)
            elif registration:
                status, body = _register(event, repository, claims)
            elif checkout:
                status, body = _checkout(event, repository, claims)
            elif portal:
                status, body = _customer_portal(event, repository, claims, path)
            else:
                status, body = _request(event, repository, public=public)
        return api_response(status, body)
    except HttpError as error:
        return api_response(error.status, {"error": {"code": error.code, "message": error.message}, "correlation_id": correlation_id})
    except Exception as error:
        status, code = {"22023": (400, "invalid_request"), "23505": (409, "conflict"), "40001": (409, "stale_version"), "42501": (403, "forbidden"), "P0002": (404, "not_found")}.get(getattr(error, "sqlstate", None), (500, "internal_error"))
        if status in (403, 500):
            print(json.dumps({"level": "error", "correlation_id": correlation_id, "path": path,
                              "error_type": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None),
                              "message": getattr(getattr(error, "diag", None), "message_primary", None)}))
        detail = str(error).split("\n", 1)[0] if status != 500 else "E-commerce request failed"
        return api_response(status, {"error": {"code": code, "message": detail}, "correlation_id": correlation_id})
