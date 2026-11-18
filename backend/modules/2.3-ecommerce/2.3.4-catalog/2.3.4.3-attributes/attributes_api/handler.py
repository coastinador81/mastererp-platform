from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import AttributesRepository
def _header(e,n):return {k.lower():v for k,v in (e.get('headers') or {}).items()}.get(n.lower())
def _claims(e):
 c=e.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims')
 if not isinstance(c,dict) or not c.get('iss') or not c.get('sub'):raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
 return c
def _request(e,r):
 m=e.get('requestContext',{}).get('http',{}).get('method',e.get('httpMethod','GET')).upper();code=(e.get('pathParameters') or {}).get('attribute_code')
 if m=='GET' and code:return 200,r.get(code)
 if m=='GET':
  q=e.get('queryStringParameters') or {};limit=int(q.get('limit',25));offset=int(q.get('offset',0))
  if not 1<=limit<=100 or offset<0:raise HttpError(400,'Invalid pagination',code='invalid_request')
  return 200,r.list(q.get('status'),q.get('search'),limit,offset)
 p=parse_body(e)
 if m=='POST' and not code:
  key=_header(e,'idempotency-key')
  if not {'code','name','type'}<=p.keys() or not key:raise HttpError(400,'code, name, type and Idempotency-Key are required',code='invalid_request')
  return 201,r.create(p,key)
 if m=='PATCH' and code:
  if 'version' not in p or len(p)<2:raise HttpError(400,'version and a change are required',code='invalid_request')
  return 200,r.update(code,p)
 raise HttpError(404,'Route not found',code='not_found')
def lambda_handler(e:dict[str,Any],context:Any):
 from tenant_security.db import db_connection
 cid=_header(e,'x-correlation-id') or str(uuid4())
 try:
  claims=_claims(e);tenant=_header(e,'x-tenant-id');UUID(tenant or '');m=e.get('requestContext',{}).get('http',{}).get('method','GET').upper();op='catalog.attributes.read' if m=='GET' else 'catalog.attributes.create' if m=='POST' else 'catalog.attributes.update'
  with db_connection(tenant_id=tenant,correlation_id=cid,operation=op) as con:
   auth=resolve_auth(e,con,verified_claims=claims);con.execute("SELECT set_config('app.current_user_id',%s,true)",(str(auth.user_id),));status,body=_request(e,AttributesRepository(con))
  return api_response(status,body)
 except HttpError as x:return api_response(x.status,{'error':{'code':x.code,'message':x.message},'correlation_id':cid})
 except (ValueError,TypeError):return api_response(400,{'error':{'code':'invalid_request','message':'Invalid request values'},'correlation_id':cid})
 except Exception as x:
  status,code={'22023':(400,'invalid_request'),'23505':(409,'conflict'),'23514':(409,'invalid_attribute'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(x,'sqlstate',None),(500,'internal_error'));return api_response(status,{'error':{'code':code,'message':'Attribute request could not be completed'},'correlation_id':cid})
