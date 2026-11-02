"""Existing Onboarding routes; authenticate before opening an application transaction."""
import logging
from uuid import UUID, uuid4
import psycopg
from tenant_security.auth import validate_request, resolve_auth, resolve_tenant_for_request
from tenant_security.db import db_connection
from tenant_security.http import HttpError, api_response, match_route, parse_body
from tenant_security.foundation_access import audit_result
from tenant_onboarding.services import sessions, progress
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

def handle_admin_request(event, *, invoke_provisioner=False):
    actor = tenant = None
    correlation = str(uuid4())
    operation = "onboarding.request"
    method = event.get("requestContext",{}).get("http",{}).get("method") or event.get("httpMethod","GET")
    path = event.get("rawPath") or event.get("path") or "/"
    result = "failed"
    try:
        claims = validate_request(event)  # 401 never needs database/secrets access.
        body = parse_body(event) if method in ("POST","PATCH","PUT") else {}
        headers = {k.lower():v for k,v in (event.get("headers") or {}).items()}
        selected = headers.get("x-mastererp-tenant-id") or body.get("tenant_id")
        tenant = str(UUID(selected)) if selected else None
        operation = "onboarding.session." + method.lower()
        with db_connection(tenant_id=tenant, correlation_id=correlation, operation=operation) as conn:
            auth = resolve_auth(event, conn, verified_claims=claims)
            actor = auth.user_id
            conn.execute("SELECT set_config('app.current_user_id',%s,true)",(str(actor),))
            if tenant:
                resolve_tenant_for_request(auth,conn,UUID(tenant))
            match = match_route(method,path,"/v1/onboarding/sessions/{id}")
            if method=="POST" and path=="/v1/onboarding/sessions":
                payload = sessions.create_session(conn,auth,body); code=201
            elif match and method=="GET":
                payload = sessions.get_session(conn,auth,UUID(match['id'])); code=200
            elif match and method=="PATCH":
                if body.get("tenant_id") and str(UUID(body['tenant_id'])) != tenant:
                    raise HttpError(403,"Tenant context mismatch")
                payload = sessions.patch_session(conn,auth,UUID(match['id']),body); code=200
            else:
                complete=match_route(method,path,"/v1/onboarding/sessions/{id}/complete")
                status=match_route(method,path,"/v1/onboarding/sessions/{id}/progress")
                step=match_route(method,path,"/v1/onboarding/sessions/{id}/steps/{stepId}")
                if complete and method=="POST":
                    # Provisioning is deliberately not delegated with admin credentials.
                    payload=sessions.complete_session(conn,auth,UUID(complete['id']));code=200
                elif status and method=="GET":
                    payload=progress.get_progress(conn,auth,UUID(status['id']));code=200
                elif step and method=="PUT":
                    payload=progress.upsert_step(conn,auth,UUID(step['id']),UUID(step['stepId']),body);code=200
                else:
                    raise HttpError(404,"Route not implemented by this function")
            result="succeeded"
        return api_response(code,payload)
    except HttpError as error:
        result="denied" if error.status in (401,403) else "failed"
        return api_response(error.status,{"error":error.message,"code":error.code})
    except psycopg.Error as error:
        code=403 if error.sqlstate=='42501' else 409 if error.sqlstate in ('23505','23503') else 503
        result="denied" if code==403 else "failed"
        return api_response(code,{"error":"Operation denied" if code==403 else "Operation unavailable","code":"onboarding_operation_failed"})
    except (ValueError,TypeError):
        return api_response(400,{"error":"Invalid request","code":"invalid_request"})
    except Exception:
        # Never log tokens, parameters, SQL text, connection strings or bodies.
        return api_response(503,{"error":"Onboarding unavailable","code":"onboarding_unavailable"})
    finally:
        audit_result(LOGGER,actor_id=actor,tenant_id=tenant,company_id=None,
                     operation=operation,result=result,correlation_id=correlation)
