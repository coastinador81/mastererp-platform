from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import RoutesRepository
def _h(e,n):return{k.lower():v for k,v in(e.get('headers')or{}).items()}.get(n.lower())
def _request(e,r):
 h=e.get('requestContext',{}).get('http',{});m=h.get('method','GET').upper();p=e.get('pathParameters')or{};company=p.get('company_id');rid=p.get('route_id');order=p.get('order_id');UUID(company or '');
 if rid:UUID(rid)
 if order:UUID(order)
 path=h.get('path','')
 if m=='GET'and rid:return 200,r.get(company,rid)
 if m=='GET':q=e.get('queryStringParameters')or{};return 200,{'items':r.list(company,q.get('status'),int(q.get('limit',50)))}
 b=parse_body(e)
 if m=='POST'and not rid:
  key=_h(e,'idempotency-key')
  if not{'node_id','date','order_ids'}<=b.keys()or not key:raise HttpError(400,'node_id, date, order_ids and Idempotency-Key required',code='invalid_request')
  return 201,r.create(company,b,key)
 if m=='PUT'and path.endswith('/driver'):return 200,r.assign(company,rid,b)
 if m=='POST'and path.endswith('/transitions'):return 200,r.transition(company,rid,b)
 if m=='POST'and order:return 200,r.stop(company,rid,order,b)
 raise HttpError(404,'Route not found',code='not_found')
def lambda_handler(e:dict[str,Any],context:Any):
 from tenant_security.db import db_connection
 cid=_h(e,'x-correlation-id')or str(uuid4())
 try:
  claims=e.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims');tenant=_h(e,'x-tenant-id')
  if not isinstance(claims,dict)or not claims.get('iss')or not claims.get('sub'):raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
  try:UUID(tenant or '')
  except ValueError:raise HttpError(400,'Valid X-Tenant-Id is required',code='invalid_request')from None
  h=e.get('requestContext',{}).get('http',{});m=h.get('method','GET').upper();path=h.get('path','');op='operations.routes.read'if m=='GET'else'operations.routes.create'if m=='POST'and'/stops/'not in path and not path.endswith('/transitions')else'operations.routes.assign'if m=='PUT'else'operations.routes.transition'if path.endswith('/transitions')else'operations.routes.stop.complete'
  with db_connection(tenant_id=tenant,correlation_id=cid,operation=op)as c:a=resolve_auth(e,c,verified_claims=claims);c.execute("SELECT set_config('app.current_user_id',%s,true)",(str(a.user_id),));status,body=_request(e,RoutesRepository(c))
  return api_response(status,body)
 except HttpError as x:return api_response(x.status,{'error':{'code':x.code,'message':x.message},'correlation_id':cid})
 except Exception as x:status,code={'22023':(400,'invalid_request'),'23505':(409,'conflict'),'23514':(409,'invalid_state'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(x,'sqlstate',None),(500,'internal_error'));return api_response(status,{'error':{'code':code,'message':'Route request failed'},'correlation_id':cid})
