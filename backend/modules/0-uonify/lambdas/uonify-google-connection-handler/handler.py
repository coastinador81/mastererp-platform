"""Google connection diagnostic and authenticated space discovery. No Google I/O."""
import json
import logging
import re
import uuid

from tenant_security.identity_access import AccessError, authenticated_identity, connection_access, user_spaces

ROUTE = "GET /v1/uonify/google/connection/status"
SPACES_ROUTE = "GET /v1/uonify/spaces"


def response(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json",
            "cache-control": "no-store"}, "body": json.dumps(body)}


def _handle(event, correlation_id):
    route = event.get("routeKey")
    if route not in (ROUTE, SPACES_ROUTE):
        return response(404, {"error": "not_found"})
    try:
        scope = "mastererp-dev/" + ("identity.spaces.read" if route == SPACES_ROUTE else "uonify.connections.status")
        issuer, subject = authenticated_identity(event, scope)
        if route == SPACES_ROUTE:
            return response(200, {"spaces": user_spaces(issuer, subject)})
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        tenant = headers.get("x-mastererp-tenant-id")
        if not tenant:
            raise AccessError(403, "tenant_context_required")
        connection_access(issuer, subject, tenant, correlation_id=correlation_id)
        return response(200, {"provider": "google_cloud", "status": "not_configured",
                             "oauthImplemented": False, "geminiEnabled": False})
    except AccessError as error:
        return response(error.status, {"error": error.code})
    except Exception:
        return response(503, {"error": "identity_authorization_unavailable"})


def lambda_handler(event, context):
    try:
        correlation_id = str(uuid.UUID(str(getattr(context, "aws_request_id", ""))))
    except (ValueError, TypeError, AttributeError):
        correlation_id = str(uuid.uuid4())
    result = _handle(event, correlation_id)
    logging.getLogger(__name__).warning(json.dumps({
        "correlation_id": correlation_id, "status_code": result["statusCode"]}))
    return result
