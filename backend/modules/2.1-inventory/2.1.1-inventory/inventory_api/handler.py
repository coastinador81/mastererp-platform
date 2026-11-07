from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import InventoryRepository
def _header(event,name):return {k.lower():v for k,v in (event.get('headers') or {}).items()}.get(name.lower())
def _claims(event):
    claims=event.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims')
    if not isinstance(claims,dict) or not claims.get('iss') or not claims.get('sub'):raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
    return claims
def _request(event,repo):
    http=event.get('requestContext',{}).get('http',{});method=http.get('method',event.get('httpMethod','GET')).upper();params=event.get('pathParameters') or {};company=params.get('company_id');node=params.get('node_id');product=params.get('product_id');reservation=params.get('reservation_id')
    for value in (company,node,product,reservation):
        if value:UUID(value)
    if not company:raise HttpError(400,'company_id is required',code='invalid_request')
    path=http.get('path','')
    if method=='GET' and node:
        limit=int((event.get('queryStringParameters') or {}).get('limit',100))
        if not 1<=limit<=200:raise HttpError(400,'Invalid limit',code='invalid_request')
        value=repo.list(company,node,product,limit);return 200,value if product else {'items':value}
    payload=parse_body(event);key=_header(event,'idempotency-key')
    if method=='PUT' and node and product and path.endswith('/stock'):
        if not {'stock','reason'}<=payload.keys() or not key:raise HttpError(400,'stock, reason and Idempotency-Key are required',code='invalid_request')
        return 200,repo.set_stock(company,node,product,payload,key)
    if method=='POST' and node and path.endswith('/reservations'):
        if not payload.get('items') or not key:raise HttpError(400,'items and Idempotency-Key are required',code='invalid_request')
        return 201,repo.reserve(company,node,payload,key)
    if method=='POST' and reservation and path.endswith('/finalize'):
        if not {'action','reason'}<=payload.keys():raise HttpError(400,'action and reason are required',code='invalid_request')
        return 200,repo.finalize(company,reservation,payload)
    raise HttpError(404,'Route not found',code='not_found')
def _sql_error(error):
    status,code={'22023':(400,'invalid_request'),'23514':(409,'insufficient_or_reserved_stock'),'23505':(409,'idempotency_conflict'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(error,'sqlstate',None),(500,'internal_error'))
    return HttpError(status,'Inventory request could not be completed',code=code)
def lambda_handler(event:dict[str,Any],context:Any):
    from tenant_security.db import db_connection
    correlation=_header(event,'x-correlation-id') or str(uuid4())
    try:
        claims=_claims(event);tenant=_header(event,'x-tenant-id');UUID(tenant or '');http=event.get('requestContext',{}).get('http',{});method=http.get('method','GET').upper();path=http.get('path','')
        operation='catalog.inventory.read' if method=='GET' else 'catalog.inventory.set' if method=='PUT' else 'catalog.inventory.reservation.finalize' if path.endswith('/finalize') else 'catalog.inventory.reserve'
        with db_connection(tenant_id=tenant,correlation_id=correlation,operation=operation) as connection:
            auth=resolve_auth(event,connection,verified_claims=claims);connection.execute("SELECT set_config('app.current_user_id',%s,true)",(str(auth.user_id),));status,body=_request(event,InventoryRepository(connection))
        return api_response(status,body)
    except HttpError as error:return api_response(error.status,{'error':{'code':error.code,'message':error.message},'correlation_id':correlation})
    except (ValueError,TypeError):return api_response(400,{'error':{'code':'invalid_request','message':'Invalid request values'},'correlation_id':correlation})
    except Exception as error:
        mapped=_sql_error(error);return api_response(mapped.status,{'error':{'code':mapped.code,'message':mapped.message},'correlation_id':correlation})
