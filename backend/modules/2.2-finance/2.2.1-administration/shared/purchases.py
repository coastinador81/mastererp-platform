"""Draft-only purchase adapter. PostgreSQL owns authorization and monetary integrity."""
import base64
import json
import logging
import os
import re
from uuid import uuid4
from parties import response, uid
from tenant_security.identity_access import authenticated_identity, application_connection, _set_actor, AccessError
from tenant_security.foundation_access import audit_result

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)
KINDS = {'solicitudes': 'solicitud_compra', 'ordenes': 'orden_compra', 'facturas': 'factura_proveedor'}


def handle(event, context):
    correlation = str(uuid4())
    actor = tenant = company = None
    operation = 'administration.purchase.read'
    try:
        method = event.get('requestContext', {}).get('http', {}).get('method', '')
        path = event.get('rawPath', '')
        if method == 'GET' and path == '/v1/administration/compras/health':
            return response(200, {'status': 'ok', 'lambda': 'mastererp-dev-adm-compras'})
        issuer, subject = authenticated_identity(event, os.environ.get('REQUIRED_API_SCOPE', 'mastererp-dev/identity.spaces.read'))
        match = re.fullmatch(r'/v1/administration/compras/(solicitudes|ordenes|facturas|opciones)(?:/([0-9a-fA-F-]{36}))?', path)
        if not match or method not in ('GET', 'POST', 'PATCH'):
            return response(404, {'error': 'route_not_found', 'correlation_id': correlation})
        options = match[1] == 'opciones'
        if options and (method != 'GET' or match[2]):
            raise ValueError()
        kind = KINDS.get(match[1])
        document = uid(match[2]) if match[2] else None
        headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
        tenant = uid(headers.get('x-mastererp-tenant-id'))
        query = event.get('queryStringParameters') or {}
        write = method != 'GET'
        body = {}
        if write:
            raw = event.get('body') or '{}'
            if event.get('isBase64Encoded'):
                raw = base64.b64decode(raw, validate=True).decode('utf-8')
            if len(raw) > 60000:
                raise ValueError()
            body = json.loads(raw)
            if not isinstance(body, dict) or set(body) - {'company_id', 'version', 'documento'} or query:
                raise ValueError()
            company = uid(body.get('company_id'))
            payload = body.get('documento')
            if not isinstance(payload, dict):
                raise ValueError()
            if method == 'POST' and (document or 'version' in body):
                raise ValueError()
            if method == 'PATCH' and (not document or type(body.get('version')) is not int or not 1 <= body['version'] < 9223372036854775807):
                raise ValueError()
            operation = 'administracion.documento.' + kind + ('.crear' if method == 'POST' else '.actualizar')
        else:
            if set(query) - {'company_id', 'limit', 'after'}:
                raise ValueError()
            company = uid(query.get('company_id'))
        key = headers.get('idempotency-key')
        if method == 'POST' and (not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', key)):
            raise ValueError()
        limit = int(query.get('limit', '25'))
        if not 1 <= limit <= 100:
            raise ValueError()
        after = uid(query['after']) if query.get('after') else None
        with application_connection(write=write) as conn:
            actor = _set_actor(conn, issuer, subject)
            conn.run("SELECT set_config('app.current_tenant_id',:tenant,true), "
                     "set_config('app.current_company_id',:company,true), set_config('app.current_branch_id','',true), "
                     "set_config('app.current_operation',:operation,true), set_config('app.correlation_id',:correlation,true)",
                     tenant=tenant, company=company, operation=operation, correlation=correlation)
            if options:
                data = conn.run('SELECT administracion.purchase_options(:company,:after,:limit)', company=company, after=after, limit=limit)[0][0]
                status = 200
            elif not write:
                data = conn.run('SELECT administracion.purchase_read(:company,:kind,:id,:limit,:after)',
                                company=company, kind=kind, id=document, limit=limit + 1, after=after)[0][0]
                if document is None:
                    data = {'items': data[:limit], 'next_cursor': data[limit - 1]['id'] if len(data) > limit else None}
                status = 200
            else:
                data = conn.run('SELECT administracion.purchase_write(:company,:kind,:id,:version,:key,CAST(:payload AS jsonb))',
                                company=company, kind=kind, id=document, version=body.get('version'), key=key,
                                payload=json.dumps(payload))[0][0]
                status = 201 if method == 'POST' and not data['replayed'] else 200
        audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company, operation=operation, result='succeeded', correlation_id=correlation)
        return response(status, {'data': data, 'correlation_id': correlation})
    except AccessError as error:
        status, code = error.status, error.code
    except (ValueError, TypeError, KeyError, UnicodeError):
        status, code = 400, 'invalid_request'
    except Exception as error:
        detail = error.args[0] if error.args and isinstance(error.args[0], dict) else {}
        # Fixed SQLSTATE/reason only; never emit database DETAIL, queries, payloads or credentials.
        reasons = {'Invalid purchase input':'input', 'Invalid purchase currency or reference':'currency_reference',
                   'Supplier unavailable in company':'supplier_scope', 'Invalid purchase line':'line',
                   'Line amount exceeds currency precision':'precision', 'Compatible purchase source required':'source'}
        LOG.info(json.dumps({'event':'purchase_command_failure','sqlstate':detail.get('C','unknown'),
                             'reason':reasons.get(detail.get('M'),'constraint_or_service'), 'correlation_id':correlation}))
        status, code = {'42501': (403, 'access_denied'), 'P0002': (404, 'not_found'),
                        '23505': (409, 'duplicate_or_idempotency_conflict'), '40001': (409, 'stale_version'),
                        '55000': (409, 'source_in_use'), '22023': (400, 'invalid_request'),
                        '22P02': (400, 'invalid_request'), '22007': (400, 'invalid_request'),
                        '22008': (400, 'invalid_request'), '22003': (400, 'invalid_request'),
                        '23503': (400, 'invalid_reference'), '23514': (400, 'invalid_request')}.get(detail.get('C'), (503, 'service_unavailable'))
    audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company, operation=operation,
                 result='denied' if status in (401, 403) else 'failed', correlation_id=correlation)
    return response(status, {'error': code, 'correlation_id': correlation})
