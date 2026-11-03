"""Customers/suppliers adapter over controlled PostgreSQL commands. No raw DML."""
import base64
import json
import logging
import os
import re
from uuid import UUID, uuid4
from tenant_security.identity_access import authenticated_identity, application_connection, _set_actor, AccessError
from tenant_security.foundation_access import audit_result

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)


def uid(value):
    if not isinstance(value, str):
        raise ValueError()
    return str(UUID(value))


def response(status, body):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
            'body': json.dumps(body, default=str)}


def handle(event, context, *, role, capability):
    correlation = str(uuid4())
    actor = tenant = company = None
    operation = 'administration.' + role + '.read'
    result = 'failed'
    try:
        method = event.get('requestContext', {}).get('http', {}).get('method', '')
        path = event.get('rawPath', '')
        base = '/v1/administration/' + capability
        if method == 'GET' and path == base + '/health':
            return response(200, {'status': 'ok', 'lambda': 'mastererp-dev-adm-' + capability})
        issuer, subject = authenticated_identity(event, os.environ.get('REQUIRED_API_SCOPE','mastererp-dev/identity.spaces.read'))
        headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
        tenant = uid(headers.get('x-mastererp-tenant-id'))
        query = event.get('queryStringParameters') or {}
        match = re.fullmatch(re.escape(base) + r'(?:/([0-9a-fA-F-]{36}))?', path)
        if not match or method not in ('GET', 'POST', 'PATCH'):
            return response(404, {'error': 'route_not_found', 'correlation_id': correlation})
        third_id = uid(match[1]) if match[1] else None
        write = method != 'GET'
        body = {}
        if write:
            raw = event.get('body') or '{}'
            if event.get('isBase64Encoded'):
                raw = base64.b64decode(raw, validate=True).decode('utf-8')
            if len(raw) > 16384:
                raise ValueError()
            body = json.loads(raw)
            if not isinstance(body, dict) or set(body) - {'company_id', 'codigo', 'nombre', 'tercero_id', 'version'}:
                raise ValueError()
            company = uid(body.get('company_id'))
        else:
            if set(query) - {'company_id', 'limit', 'after'}:
                raise ValueError()
            company = uid(query.get('company_id'))
        if method == 'POST':
            if third_id or 'version' in body:
                raise ValueError()
            third_id = uid(body['tercero_id']) if 'tercero_id' in body else None
            if third_id:
                if 'codigo' in body or 'nombre' in body:
                    raise ValueError()
            elif set(body) != {'company_id', 'codigo', 'nombre'}:
                raise ValueError()
            operation = 'administration.' + role + '.create'
        elif method == 'PATCH':
            if not third_id or set(body) != {'company_id', 'codigo', 'nombre', 'version'}:
                raise ValueError()
            if type(body['version']) is not int or not 1 <= body['version'] < 9223372036854775807:
                raise ValueError()
            operation = 'administration.' + role + '.update'
        for field, maximum in [('codigo', 80), ('nombre', 200)]:
            if field in body and (not isinstance(body[field], str) or not 1 <= len(body[field]) <= maximum
                                  or body[field] != body[field].strip() or any(ord(c) < 32 for c in body[field])):
                raise ValueError()
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
                     "set_config('app.current_company_id',:company,true), "
                     "set_config('app.current_branch_id','',true), "
                     "set_config('app.current_operation',:operation,true), "
                     "set_config('app.correlation_id',:correlation,true)",
                     tenant=tenant, company=company, operation=operation, correlation=correlation)
            if method == 'GET':
                data = conn.run('SELECT administracion.parties_read(:company,:role,:id,:limit,:after)',
                                company=company, role=role, id=third_id, limit=limit+1, after=after)[0][0]
                if not third_id:
                    data = {'items': data[:limit], 'next_cursor': data[limit-1]['id'] if len(data) > limit else None}
                status = 200
            else:
                data = conn.run('SELECT administracion.party_write(:company,:role,:action,:id,:code,:name,:version,:key)',
                                company=company, role=role, action='create' if method == 'POST' else 'update',
                                id=third_id, code=body.get('codigo'), name=body.get('nombre'),
                                version=body.get('version'), key=key)[0][0]
                status = 201 if method == 'POST' and not data['replayed'] else 200
        result = 'succeeded'
        audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company,
                     operation=operation, result=result, correlation_id=correlation)
        return response(status, {'data': data, 'correlation_id': correlation})
    except AccessError as error:
        status, code = error.status, error.code
    except (ValueError, TypeError, KeyError, UnicodeError):
        status, code = 400, 'invalid_request'
    except Exception as error:
        detail = error.args[0] if error.args and isinstance(error.args[0], dict) else {}
        status, code = {'42501': (403, 'access_denied'), 'P0002': (404, 'not_found'),
                        '23505': (409, 'duplicate_or_idempotency_conflict'), '40001': (409, 'stale_version'),
                        '22023': (400, 'invalid_request'), '23514': (400, 'invalid_request')}.get(
                            detail.get('C'), (503, 'service_unavailable'))
    result = 'denied' if status in (401, 403) else 'failed'
    # Fixed schema only; no request bodies, names, codes, tokens or credentials.
    audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company,
                 operation=operation, result=result, correlation_id=correlation)
    return response(status, {'error': code, 'correlation_id': correlation})
