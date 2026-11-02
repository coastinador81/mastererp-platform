"""Trusted API JWT context -> stable identity -> application-role SQL reads.

No email linking, Cognito group authorization, local auth mode or admin fallback.
"""
import json
import os
import ssl
from contextlib import contextmanager
from uuid import UUID
from pathlib import Path
import logging
from uuid import uuid4
from tenant_security.foundation_access import require_capability, CapabilityDenied, audit_result

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


class AccessError(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code
        super().__init__(code)


def authenticated_identity(event, scope):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    if not claims or claims.get("token_use") != "access":
        raise AccessError(401, "access_token_required")
    issuer, client = os.environ.get("COGNITO_ISSUER"), os.environ.get("COGNITO_APP_CLIENT_ID")
    if not issuer or not client:
        raise AccessError(503, "identity_not_configured")
    subject = claims.get("sub")
    if (claims.get("iss") != issuer or claims.get("client_id") != client
            or not isinstance(subject, str) or not 1 <= len(subject) <= 255):
        raise AccessError(401, "invalid_identity")
    if scope not in str(claims.get("scope", "")).split():
        raise AccessError(403, "api_scope_required")
    # Signature, exp/nbf and issuer/client validation are performed by API Gateway.
    # Direct Lambda invocation is restricted by IAM; browser headers are never read here.
    return issuer, subject


@contextmanager
def application_connection():
    if os.environ.get("IDENTITY_DB_ENABLED", "false") != "true" or not os.environ.get("DATABASE_SECRET_ARN"):
        raise AccessError(503, "identity_database_pending")
    import boto3
    import pg8000.native
    from botocore.config import Config
    raw = boto3.client("secretsmanager", config=Config(connect_timeout=2, read_timeout=3,
        retries={"max_attempts": 1})).get_secret_value(SecretId=os.environ["DATABASE_SECRET_ARN"])
    credentials = json.loads(raw["SecretString"])
    if credentials.get("username") != "mastererp_app":
        raise AccessError(503, "application_credentials_required")
    connection = pg8000.native.Connection(
        user="mastererp_app", password=credentials["password"],
        host=os.environ["DATABASE_HOST"], port=int(credentials.get("port", 5432)),
        database="mastererp", ssl_context=ssl.create_default_context(
            cafile=str(Path(__file__).with_name("rds-us-west-1-bundle.pem"))), timeout=5)
    try:
        connection.run("BEGIN READ ONLY")
        if connection.run("SELECT current_user")[0][0] != "mastererp_app":
            raise AccessError(503, "application_role_required")
        # Always clear both values transaction-locally before resolving any actor.
        connection.run("SELECT set_config('app.current_user_id','',true), set_config('app.current_tenant_id','',true)")
        yield connection
    finally:
        try:
            connection.run("ROLLBACK")
        finally:
            connection.close()


def _set_actor(connection, issuer, subject):
    actor = connection.run("SELECT plataforma.resolve_external_identity(:issuer,:subject)",
                           issuer=issuer, subject=subject)[0][0]
    if actor is None:
        raise AccessError(403, "identity_not_linked")
    connection.run("SELECT set_config('app.current_user_id',:actor,true)", actor=str(actor))
    return actor


def connection_access(issuer, subject, tenant_id, *, correlation_id=None):
    try:
        tenant_id = str(UUID(tenant_id))
    except (ValueError, TypeError, AttributeError):
        raise AccessError(400, "invalid_tenant_context") from None
    actor = None
    outcome = "failed"
    try:
        with application_connection() as connection:
            actor = _set_actor(connection, issuer, subject)
            connection.run("SELECT set_config('app.current_tenant_id',:tenant,true)", tenant=tenant_id)
            require_capability(connection,module_code="uonify.core",permission_code="uonify.connections.manage")
            outcome = "succeeded"
    except CapabilityDenied:
        outcome = "denied"
        raise AccessError(403,"tenant_permission_denied") from None
    except AccessError as error:
        outcome = "denied" if error.status in (401,403) else "failed"
        raise
    finally:
        audit_result(LOGGER,actor_id=actor,tenant_id=tenant_id,company_id=None,
                     operation="uonify.connections.status",result=outcome,
                     correlation_id=correlation_id or str(uuid4()))


def user_spaces(issuer, subject):
    with application_connection() as connection:
        _set_actor(connection, issuer, subject)
        return [{"id": str(row[0]), "name": row[1]} for row in connection.run(
            "SELECT tenant_id,tenant_name FROM plataforma.list_current_user_spaces()")]
