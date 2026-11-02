"""Reusable capability guard; requires SQL 007. No identity or database fallback.

Called only after the trusted issuer/sub lookup and transaction-local actor/tenant context.
This module does not authenticate headers, create identities or open connections.
"""
from uuid import UUID
from contextlib import contextmanager
import json


class CapabilityDenied(Exception):
    status = 403
    code = 'capability_access_denied'


def require_capability(connection, *, module_code, permission_code, company_id=None, branch_id=None):
    """Check tenant module activation, permission (including deny override), and containment."""
    company = str(UUID(str(company_id))) if company_id is not None else None
    branch = str(UUID(str(branch_id))) if branch_id is not None else None
    allowed = connection.run(
        'SELECT plataforma.has_current_tenant_capability(:module,:permission,:company,:branch)',
        module=module_code, permission=permission_code, company=company, branch=branch)[0][0]
    if allowed is not True:
        raise CapabilityDenied()


@contextmanager
def request_context(connection, *, issuer, subject, tenant_id, operation, correlation_id):
    """Read-only request transaction on an already opened application connection.

    issuer/subject must come from the existing verified JWT adapter, never browser headers.
    No commit path, credentials, admin fallback, email lookup or Cognito-group permissions.
    Write operations need their own explicit atomic command/idempotency transaction.
    """
    tenant = str(UUID(str(tenant_id)))
    correlation = str(UUID(str(correlation_id)))
    if not isinstance(operation, str) or not 1 <= len(operation) <= 80:
        raise ValueError('invalid_operation')
    connection.run('BEGIN READ ONLY')
    try:
        if connection.run('SELECT current_user')[0][0] != 'mastererp_app':
            raise RuntimeError('application_role_required')
        connection.run("SELECT set_config('app.current_user_id','',true), "
                       "set_config('app.current_tenant_id','',true), "
                       "set_config('app.current_operation','',true), "
                       "set_config('app.correlation_id','',true), "
                       "set_config('app.current_company_id','',true), "
                       "set_config('app.current_branch_id','',true)")
        actor = connection.run('SELECT plataforma.resolve_external_identity(:issuer,:subject)',
                               issuer=issuer, subject=subject)[0][0]
        if actor is None:
            raise CapabilityDenied()
        connection.run("SELECT set_config('app.current_user_id',:actor,true), "
                       "set_config('app.current_tenant_id',:tenant,true), "
                       "set_config('app.current_operation',:operation,true), "
                       "set_config('app.correlation_id',:correlation,true)",
                       actor=str(actor), tenant=tenant, operation=operation, correlation=correlation)
        yield connection
    finally:
        connection.run('ROLLBACK')


def audit_result(logger, *, actor_id, tenant_id, company_id, operation, result, correlation_id):
    """Fixed-schema operational audit; caller cannot pass bodies, tokens or secrets."""
    if result not in {'succeeded', 'denied', 'failed'}:
        raise ValueError('invalid_result')
    if not isinstance(operation, str) or not 1 <= len(operation) <= 80:
        raise ValueError('invalid_operation')
    record = {name: str(UUID(str(value))) if value is not None else None
              for name, value in [('actor', actor_id), ('tenant', tenant_id),
                                  ('company', company_id), ('correlation_id', correlation_id)]}
    record.update({'operation': operation, 'result': result})
    logger.info(json.dumps(record, sort_keys=True))
