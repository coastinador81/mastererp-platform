import logging
from typing import Any
from uuid import UUID

from tenant_security.auth import resolve_auth, resolve_tenant_for_request
from tenant_security.db import db_connection
from tenant_security.http import HttpError, api_response, match_route, parse_body, parse_path_params

from tenant_onboarding.services import modules as modules_service
from tenant_onboarding.services import progress as progress_service
from tenant_onboarding.services import provisioning as provisioning_service
from tenant_onboarding.services import sessions as sessions_service
from tenant_onboarding.services import tenants as tenants_service

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


def _path(event: dict[str, Any]) -> str:
    return event.get("rawPath") or event.get("path") or "/"


def handle_admin_request(event: dict[str, Any], *, invoke_provisioner: bool = False) -> dict[str, Any]:
    method = event.get("requestContext", {}).get("http", {}).get("method") or event.get("httpMethod", "GET")
    path = _path(event)
    try:
        with db_connection() as conn:
            auth = resolve_auth(event, conn)
            body = parse_body(event) if method in ("POST", "PUT", "PATCH") else {}
            params = parse_path_params(event)

            if method == "POST" and path.endswith("/v1/onboarding/sessions"):
                return api_response(201, sessions_service.create_session(conn, auth, body))

            match = match_route(method, path, "/v1/onboarding/sessions/{id}")
            if match and method == "GET":
                session_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id) as scoped:
                    return api_response(200, sessions_service.get_session(scoped, auth, session_id))

            if match and method == "PATCH":
                session_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id) as scoped:
                    return api_response(200, sessions_service.patch_session(scoped, auth, session_id, body))

            match = match_route(method, path, "/v1/onboarding/sessions/{id}/complete")
            if match and method == "POST":
                session_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id) as scoped:
                    payload = sessions_service.complete_session(scoped, auth, session_id)
                    session = payload["session"]
                    if invoke_provisioner and session.get("tenant_id"):
                        tenant_id = UUID(str(session["tenant_id"]))
                        resolve_tenant_for_request(auth, scoped, tenant_id)
                        provisioning_service.provision_tenant(
                            scoped, auth, tenant_id, idempotency_key=body.get("idempotency_key")
                        )
                    return api_response(200, payload)

            match = match_route(method, path, "/v1/onboarding/sessions/{id}/progress")
            if match and method == "GET":
                session_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id) as scoped:
                    return api_response(200, progress_service.get_progress(scoped, auth, session_id))

            match = match_route(method, path, "/v1/onboarding/sessions/{id}/steps/{stepId}")
            if match and method == "PUT":
                session_id = UUID(match.group("id"))
                step_id = UUID(match.group("stepId"))
                with db_connection(user_id=auth.user_id) as scoped:
                    return api_response(200, progress_service.upsert_step(scoped, auth, session_id, step_id, body))

            if method == "POST" and path.endswith("/v1/tenants"):
                with db_connection(user_id=auth.user_id) as scoped:
                    return api_response(201, tenants_service.create_tenant(scoped, auth, body))

            match = match_route(method, path, "/v1/tenants/{id}/config")
            if match and method == "GET":
                tenant_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id, tenant_id=tenant_id) as scoped:
                    resolve_tenant_for_request(auth, scoped, tenant_id)
                    return api_response(200, tenants_service.get_tenant_config(scoped, auth, tenant_id))

            if match and method == "PATCH":
                tenant_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id, tenant_id=tenant_id) as scoped:
                    resolve_tenant_for_request(auth, scoped, tenant_id)
                    return api_response(200, tenants_service.patch_tenant_config(scoped, auth, tenant_id, body))

            if method == "GET" and path.endswith("/v1/modules"):
                with db_connection(user_id=auth.user_id) as scoped:
                    return api_response(200, modules_service.list_catalog(scoped, auth))

            match = match_route(method, path, "/v1/tenants/{id}/modules")
            if match and method == "GET":
                tenant_id = UUID(match.group("id"))
                with db_connection(user_id=auth.user_id, tenant_id=tenant_id) as scoped:
                    resolve_tenant_for_request(auth, scoped, tenant_id)
                    return api_response(200, modules_service.list_tenant_modules(scoped, auth, tenant_id))

            match = match_route(method, path, "/v1/tenants/{id}/modules/{moduleId}")
            if match and method == "PUT":
                tenant_id = UUID(match.group("id"))
                module_id = UUID(match.group("moduleId"))
                with db_connection(user_id=auth.user_id, tenant_id=tenant_id) as scoped:
                    resolve_tenant_for_request(auth, scoped, tenant_id)
                    return api_response(
                        200,
                        modules_service.upsert_tenant_module(scoped, auth, tenant_id, module_id, body),
                    )

            raise HttpError(404, "Route not found")
    except HttpError as exc:
        LOGGER.info("http_error", extra={"status": exc.status, "message": exc.message})
        return api_response(exc.status, {"error": exc.message, "code": exc.code})
    except Exception:
        LOGGER.exception("unhandled_error")
        return api_response(500, {"error": "Internal server error", "code": "internal"})
