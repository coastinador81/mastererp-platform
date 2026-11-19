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


DETAIL_FIELDS={'nombre_comercial':200,'tipo_persona':30,'pais_fiscal':2,'tipo_identificacion':30,
    'numero_identificacion':50,'direccion':250,'direccion_complementaria':250,'ciudad':100,'municipio':100,
    'region':100,'codigo_postal':20,'pais':2,'email':254,'telefono':40,'telefono_alterno':40,'sitio_web':300,'observaciones':2000}
COMMERCIAL_FIELDS={'moneda','tipo_suministro','condicion_pago','medio_pago','plazo_pago_dias','descuento_pronto_pago','plazo_pronto_pago_dias'}
EXTENSION_FIELDS={'datos_generales','contactos','condiciones','profile_version','catalog_version'}


def validate_details(details):
    def text(value, maximum, null=False, multiline=False):
        if value is None and null:return
        if not isinstance(value,str) or len(value)>maximum or (not multiline and any(ord(c)<32 for c in value)):raise ValueError()
    def email(value):
        if value and not re.fullmatch(r'[^\s@]+@[^\s@]+[.][^\s@]+',value):raise ValueError()
    if 'datos_generales' in details:
        fields=details['datos_generales']
        if not isinstance(fields,dict) or set(fields)-set(DETAIL_FIELDS):raise ValueError()
        for key,value in fields.items():
            text(value,DETAIL_FIELDS[key],null=True,multiline=key=='observaciones')
            if value in ('',None):continue
            if key in ('pais','pais_fiscal') and not re.fullmatch('[A-Z]{2}',value):raise ValueError()
            if key=='tipo_persona' and value not in ('natural','juridica'):raise ValueError()
            if key=='email':email(value)
            if key=='sitio_web' and not re.fullmatch(r'https?://[^\s]+',value):raise ValueError()
    if 'contactos' in details:
        contacts=details['contactos']
        if not isinstance(contacts,list) or len(contacts)>10:raise ValueError()
        principal=0
        for row in contacts:
            if not isinstance(row,dict) or set(row)-{'nombre','cargo','email','telefono','principal'}:raise ValueError()
            for key,value in row.items():
                if key=='principal':
                    if type(value) is not bool:raise ValueError()
                    principal+=int(value)
                else:
                    text(value,{'nombre':150,'cargo':100,'email':254,'telefono':40}[key])
                    if key=='email':email(value)
        if principal>1:raise ValueError()
    if 'condiciones' in details:
        fields=details['condiciones']
        if not isinstance(fields,dict) or set(fields)-COMMERCIAL_FIELDS:raise ValueError()
        for key,value in fields.items():
            text(value,30)
            if not value:continue
            if key=='moneda' and not re.fullmatch('[A-Z]{3}',value):raise ValueError()
            if key=='tipo_suministro' and value not in ('productos','servicios','ambos'):raise ValueError()
            if key=='condicion_pago' and value not in ('contado','credito','por_acordar'):raise ValueError()
            if key=='medio_pago' and value not in ('transferencia','efectivo','tarjeta','otro'):raise ValueError()
            if key.endswith('_dias') and (not re.fullmatch('[0-9]{1,10}',value) or int(value)>2147483647):raise ValueError()
            if key=='descuento_pronto_pago' and (not re.fullmatch(r'[0-9]+([.][0-9]{1,6})?',value) or float(value)>100):raise ValueError()
        if bool(fields.get('descuento_pronto_pago')) != bool(fields.get('plazo_pronto_pago_dias')):raise ValueError()


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
        propose_code = role == 'proveedor' and method == 'GET' and third_id is None and query.get('proponer_codigo') == '1'
        write = method != 'GET'
        body = {}
        if write:
            raw = event.get('body') or '{}'
            if event.get('isBase64Encoded'):
                raw = base64.b64decode(raw, validate=True).decode('utf-8')
            if len(raw) > 16384:
                raise ValueError()
            body = json.loads(raw)
            if not isinstance(body, dict) or set(body) - ({'company_id', 'codigo', 'nombre', 'tercero_id', 'version'}|EXTENSION_FIELDS):
                raise ValueError()
            company = uid(body.get('company_id'))
        else:
            allowed_query = {'company_id', 'proponer_codigo'} if propose_code else {'company_id', 'limit', 'after'}
            if set(query) - allowed_query:
                raise ValueError()
            company = uid(query.get('company_id'))
        details={k:body[k] for k in ('datos_generales','contactos','condiciones') if k in body}
        validate_details(details)
        basic=set(body)-EXTENSION_FIELDS
        if 'profile_version' in body and ('condiciones' not in body or method!='PATCH' or type(body['profile_version']) is not int or not 1<=body['profile_version']<9223372036854775807):raise ValueError()
        if method=='PATCH' and 'condiciones' in body and 'profile_version' not in body:raise ValueError()
        if 'catalog_version' in body and (method!='PATCH' or type(body['catalog_version']) is not int or not 0<=body['catalog_version']<9223372036854775807):raise ValueError()
        if method=='PATCH' and any(k in body for k in ('datos_generales','contactos')) and 'catalog_version' not in body:raise ValueError()
        # Approved common administrative identity/contact for customer and supplier.
        if role not in ('cliente','proveedor') and details:raise ValueError()
        if method == 'POST':
            if third_id or 'version' in body or 'profile_version' in body or 'catalog_version' in body:
                raise ValueError()
            third_id = uid(body['tercero_id']) if 'tercero_id' in body else None
            if third_id:
                if 'codigo' in body or 'nombre' in body or 'datos_generales' in body or 'contactos' in body:
                    raise ValueError()
            elif basic != {'company_id', 'codigo', 'nombre'} and not (
                role == 'proveedor' and basic == {'company_id', 'nombre'}
            ):
                raise ValueError()
            operation = 'administration.' + role + '.create'
        elif method == 'PATCH':
            if not third_id or basic != {'company_id', 'codigo', 'nombre', 'version'}:
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
            if propose_code:
                code = conn.run('SELECT administracion.proponer_codigo_proveedor(:company)', company=company)[0][0]
                data, status = {'codigo': code}, 200
            elif method == 'GET':
                data = conn.run('SELECT administracion.parties_read_v2(:company,:role,:id,:limit,:after)',
                                company=company, role=role, id=third_id, limit=limit+1, after=after)[0][0]
                if not third_id:
                    data = {'items': data[:limit], 'next_cursor': data[limit-1]['id'] if len(data) > limit else None}
                status = 200
            elif role == 'proveedor' and method == 'POST' and third_id is None and 'codigo' not in body:
                data = conn.run(
                    'SELECT administracion.crear_proveedor_codigo_automatico(:company,:name,:key,CAST(:details AS jsonb))',
                    company=company, name=body['nombre'], key=key, details=json.dumps(details))[0][0]
                status = 200 if data['replayed'] else 201
            else:
                data = conn.run('SELECT administracion.party_write_v2(:company,:role,:action,:id,:code,:name,:version,:key,CAST(:details AS jsonb),:profile_version,:catalog_version)',
                                company=company, role=role, action='create' if method == 'POST' else 'update',
                                id=third_id, code=body.get('codigo'), name=body.get('nombre'),
                                version=body.get('version'), key=key, details=json.dumps(details), profile_version=body.get('profile_version'), catalog_version=body.get('catalog_version'))[0][0]
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
                        '22023': (400, 'invalid_request'), '23503': (400, 'invalid_reference'), '23514': (400, 'invalid_request')}.get(
                            detail.get('C'), (503, 'service_unavailable'))
    result = 'denied' if status in (401, 403) else 'failed'
    # Fixed schema only; no request bodies, names, codes, tokens or credentials.
    audit_result(LOG, actor_id=actor, tenant_id=tenant, company_id=company,
                 operation=operation, result=result, correlation_id=correlation)
    return response(status, {'error': code, 'correlation_id': correlation})
