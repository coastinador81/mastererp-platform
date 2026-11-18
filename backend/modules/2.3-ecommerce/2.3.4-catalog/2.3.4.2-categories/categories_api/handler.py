from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import CategoriesRepository

def _header(event,name):return {key.lower():value for key,value in (event.get('headers') or {}).items()}.get(name.lower())
def _claims(event):
    claims=event.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims')
    if not isinstance(claims,dict) or not claims.get('iss') or not claims.get('sub'):raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
    return claims
def _request(event,repo):
    http=event.get('requestContext',{}).get('http',{});method=http.get('method',event.get('httpMethod','GET')).upper();slug=(event.get('pathParameters') or {}).get('category_slug')
    if method=='GET' and slug:return 200,repo.get(slug)
    if method=='GET':
        query=event.get('queryStringParameters') or {};limit=int(query.get('limit',25));offset=int(query.get('offset',0))
        if not 1<=limit<=100 or offset<0:raise HttpError(400,'Invalid pagination',code='invalid_request')
        return 200,repo.list(query.get('status'),query.get('search'),limit,offset)
    payload=parse_body(event)
    if method=='POST' and not slug:
        key=_header(event,'idempotency-key')
        if not {'slug','name'}<=payload.keys() or not key or len(key)>128:raise HttpError(400,'slug, name and Idempotency-Key are required',code='invalid_request')
        return 201,repo.create(payload,key)
    if method=='PATCH' and slug:
        if 'version' not in payload or len(payload)<2:raise HttpError(400,'version and at least one change are required',code='invalid_request')
        return 200,repo.update(slug,payload)
    raise HttpError(404,'Route not found',code='not_found')
def _sql_error(error):
    status,code={'22023':(400,'invalid_request'),'23505':(409,'conflict'),'23514':(409,'invalid_hierarchy'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(error,'sqlstate',None),(500,'internal_error'))
    return HttpError(status,'Category request could not be completed',code=code)
def lambda_handler(event:dict[str,Any],context:Any):
    from tenant_security.db import db_connection
    correlation=_header(event,'x-correlation-id') or str(uuid4())
    try:
        claims=_claims(event);tenant=_header(event,'x-tenant-id');UUID(tenant or '')
        method=event.get('requestContext',{}).get('http',{}).get('method','GET').upper();operation='catalog.categories.read' if method=='GET' else 'catalog.categories.create' if method=='POST' else 'catalog.categories.update'
        with db_connection(tenant_id=tenant,correlation_id=correlation,operation=operation) as connection:
            auth=resolve_auth(event,connection,verified_claims=claims);connection.execute("SELECT set_config('app.current_user_id',%s,true)",(str(auth.user_id),));status,body=_request(event,CategoriesRepository(connection))
        return api_response(status,body)
    except HttpError as error:return api_response(error.status,{'error':{'code':error.code,'message':error.message},'correlation_id':correlation})
    except (ValueError,TypeError):return api_response(400,{'error':{'code':'invalid_request','message':'Invalid request values'},'correlation_id':correlation})
    except Exception as error:
        mapped=_sql_error(error);return api_response(mapped.status,{'error':{'code':mapped.code,'message':mapped.message},'correlation_id':correlation})
