from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import NodesRepository

def _header(event,name): return {k.lower():v for k,v in (event.get('headers') or {}).items()}.get(name.lower())
def _claims(event):
    claims=event.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims')
    if not isinstance(claims,dict) or not claims.get('iss') or not claims.get('sub'): raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
    return claims
def _request(event,repo):
    http=event.get('requestContext',{}).get('http',{});method=http.get('method',event.get('httpMethod','GET')).upper();params=event.get('pathParameters') or {};company=params.get('company_id');node=params.get('node_id')
    if not company: raise HttpError(400,'company_id is required',code='invalid_request')
    UUID(company)
    if node: UUID(node)
    if method=='GET' and node:return 200,repo.get(company,node)
    if method=='GET':
        query=event.get('queryStringParameters') or {};limit=int(query.get('limit',50))
        if not 1<=limit<=100:raise HttpError(400,'Invalid limit',code='invalid_request')
        return 200,{'items':repo.list(company,query.get('status'),limit)}
    payload=parse_body(event)
    if method=='PUT' and node:return 200,repo.configure(company,node,payload)
    if method=='POST' and node and http.get('path','').endswith('/transitions'):
        if not {'version','status','reason'}<=payload.keys():raise HttpError(400,'version, status and reason are required',code='invalid_request')
        return 200,repo.transition(company,node,payload)
    raise HttpError(404,'Route not found',code='not_found')
def _sql_error(error):
    status,code={'22023':(400,'invalid_request'),'23514':(409,'invalid_transition'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(error,'sqlstate',None),(500,'internal_error'))
    return HttpError(status,'Node request could not be completed',code=code)
def lambda_handler(event:dict[str,Any],context:Any):
    from tenant_security.db import db_connection
    correlation=_header(event,'x-correlation-id') or str(uuid4())
    try:
        claims=_claims(event);tenant=_header(event,'x-tenant-id');UUID(tenant or '')
        http=event.get('requestContext',{}).get('http',{});method=http.get('method','GET').upper();operation='operations.nodes.read' if method=='GET' else 'operations.nodes.transition' if http.get('path','').endswith('/transitions') else 'operations.nodes.configure'
        with db_connection(tenant_id=tenant,correlation_id=correlation,operation=operation) as connection:
            auth=resolve_auth(event,connection,verified_claims=claims);connection.execute("SELECT set_config('app.current_user_id',%s,true)",(str(auth.user_id),));status,body=_request(event,NodesRepository(connection))
        return api_response(status,body)
    except HttpError as error:return api_response(error.status,{'error':{'code':error.code,'message':error.message},'correlation_id':correlation})
    except (ValueError,TypeError):return api_response(400,{'error':{'code':'invalid_request','message':'Invalid request values'},'correlation_id':correlation})
    except Exception as error:
        mapped=_sql_error(error);return api_response(mapped.status,{'error':{'code':mapped.code,'message':mapped.message},'correlation_id':correlation})
