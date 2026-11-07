"""Read-only sales API over the canonical company-scoped PostgreSQL projection."""
import json
import logging
import os
import re
from uuid import UUID, uuid4
from tenant_security.identity_access import authenticated_identity, application_connection, _set_actor, AccessError
from tenant_security.foundation_access import audit_result

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)


def response(status, body):
    return {"statusCode": status, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps(body, default=str)}


def uid(value):
    if not isinstance(value, str):
        raise ValueError()
    return str(UUID(value))


def lambda_handler(event, context):
    correlation = str(uuid4())
    actor = tenant = company = None
    try:
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        path = event.get("rawPath", "")
        base = "/v1/administration/ventas"
        if method == "GET" and path == base + "/health":
            return response(200, {"status": "ok", "lambda": "mastererp-dev-adm-ventas"})
        issuer, subject = authenticated_identity(event, os.environ.get("REQUIRED_API_SCOPE", "mastererp-dev/identity.spaces.read"))
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        tenant = uid(headers.get("x-mastererp-tenant-id"))
        match = re.fullmatch(re.escape(base) + r"(?:/([0-9a-fA-F-]{36}))?", path)
        if not match:
            return response(404, {"error": "not_found", "correlation_id": correlation})
        if method != "GET":
            return response(405, {"error": "method_not_allowed", "correlation_id": correlation})
        query = event.get("queryStringParameters") or {}
        company = uid(query.get("company_id"))
        sale = uid(match[1]) if match[1] else None
        limit = int(query.get("limit", "25"))
        if not 1 <= limit <= 100:
            raise ValueError()
        after = uid(query["after"]) if query.get("after") else None
        search = query.get("q", "")
        if not isinstance(search, str) or len(search) > 120 or any(ord(c) < 32 for c in search):
            raise ValueError()
        with application_connection(write=False) as conn:
            actor = _set_actor(conn, issuer, subject)
            conn.run("""SELECT set_config('app.current_tenant_id',:tenant,true),
                set_config('app.current_company_id',:company,true),set_config('app.current_branch_id','',true),
                set_config('app.current_operation','administration.ventas.read',true),
                set_config('app.correlation_id',:correlation,true)""", tenant=tenant, company=company, correlation=correlation)
            data = conn.run("SELECT administracion.ventas_leer(:company,:sale,:limit,:after,:search)",
                            company=company, sale=sale, limit=limit + 1, after=after, search=search)[0][0]
            if not sale:
                data = {"items": data[:limit], "next_cursor": data[limit - 1]["id"] if len(data) > limit else None}
        audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company,
                     operation="administration.ventas.read", result="succeeded", correlation_id=correlation)
        return response(200, {"data": data, "correlation_id": correlation})
    except AccessError as error:
        status, code = error.status, error.code
    except (ValueError, TypeError, KeyError):
        status, code = 400, "invalid_request"
    except Exception as error:
        details = error.args[0] if error.args and isinstance(error.args[0], dict) else {}
        status, code = {"42501": (403, "access_denied"), "P0002": (404, "not_found"),
                        "22023": (400, "invalid_request")}.get(details.get("C"), (503, "service_unavailable"))
    audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company,
                 operation="administration.ventas.read", result="denied" if status in (401, 403) else "failed", correlation_id=correlation)
    return response(status, {"error": code, "correlation_id": correlation})
