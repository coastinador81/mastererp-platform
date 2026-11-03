from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import BrandsRepository
def _h(e,n):return {k.lower():v for k,v in(e.get('headers')or{}).items()}.get(n.lower())
def _request(e,r):
 m=e.get('requestContext',{}).get('http',{}).get('method','GET').upper();slug=(e.get('pathParameters')or{}).get('brand_slug')
 if m=='GET' and slug:return 200,r.get(slug)
 if m=='GET':q=e.get('queryStringParameters')or{};return 200,{'items':r.list(q.get('status'),int(q.get('limit',100)))}
 p=parse_body(e)
 if m=='POST' and not slug:
  key=_h(e,'idempotency-key')
  if not {'slug','name'}<=p.keys() or not key:raise HttpError(400,'slug, name and Idempotency-Key are required',code='invalid_request')
  return 201,r.create(p,key)
 if m=='PATCH' and slug:
  if 'version' not in p or len(p)<2:raise HttpError(400,'version and a change are required',code='invalid_request')
  return 200,r.update(slug,p)
 raise HttpError(404,'Route not found',code='not_found')
def lambda_handler(e:dict[str,Any],context:Any):
 from tenant_security.db import db_connection
 cid=_h(e,'x-correlation-id')or str(uuid4())
 try:
  claims=e.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims');tenant=_h(e,'x-tenant-id');UUID(tenant or '')
  if not isinstance(claims,dict)or not claims.get('iss')or not claims.get('sub'):raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
  m=e.get('requestContext',{}).get('http',{}).get('method','GET').upper();op='catalog.brands.read'if m=='GET'else'catalog.brands.create'if m=='POST'else'catalog.brands.update'
  with db_connection(tenant_id=tenant,correlation_id=cid,operation=op)as c:a=resolve_auth(e,c,verified_claims=claims);c.execute("SELECT set_config('app.current_user_id',%s,true)",(str(a.user_id),));status,body=_request(e,BrandsRepository(c))
  return api_response(status,body)
 except HttpError as x:return api_response(x.status,{'error':{'code':x.code,'message':x.message},'correlation_id':cid})
 except Exception as x:status,code={'22023':(400,'invalid_request'),'23505':(409,'conflict'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(x,'sqlstate',None),(500,'internal_error'));return api_response(status,{'error':{'code':code,'message':'Brand request could not be completed'},'correlation_id':cid})
