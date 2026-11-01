import logging
from uuid import UUID

from tenant_security.auth import resolve_auth, resolve_tenant_for_request
from tenant_security.db import db_connection
from tenant_security.http import HttpError, api_response, parse_body

from tenant_onboarding.services.provisioning import provision_tenant

LOGGER = logging.getLogger(__name__)


def lambda_handler(event, context):
    """Invocado de forma interna (EventBridge/Lambda invoke), no expuesto en API Gateway."""
    try:
        payload = event if isinstance(event, dict) and "tenant_id" in event else parse_body(event)
        tenant_id = UUID(str(payload["tenant_id"]))
        idempotency_key = payload.get("idempotency_key")
        with db_connection() as conn:
            auth = resolve_auth(event, conn)
            with db_connection(user_id=auth.user_id, tenant_id=tenant_id) as scoped:
                resolve_tenant_for_request(auth, scoped, tenant_id)
                result = provision_tenant(scoped, auth, tenant_id, idempotency_key=idempotency_key)
        return api_response(200, result)
    except HttpError as exc:
        return api_response(exc.status, {"error": exc.message, "code": exc.code})
    except Exception:
        LOGGER.exception("provisioner_failed")
        return api_response(500, {"error": "Internal server error"})
