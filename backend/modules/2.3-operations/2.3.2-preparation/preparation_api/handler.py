from typing import Any
from uuid import UUID,uuid4
from tenant_security.auth import resolve_auth
from tenant_security.http import HttpError,api_response,parse_body
from .repository import PreparationRepository
def _h(e,n):return{k.lower():v for k,v in(e.get('headers')or{}).items()}.get(n.lower())
def _request(e,r):
 h=e.get('requestContext',{}).get('http',{});m=h.get('method','GET').upper();p=e.get('pathParameters')or{};company=p.get('company_id');order=p.get('order_id');line=p.get('line_id');UUID(company or '');
 if order:UUID(order)
 if line:UUID(line)
 path=h.get('path','')
 if m=='GET'and order:return 200,r.get(company,order)
 if m=='GET':q=e.get('queryStringParameters')or{};return 200,{'items':r.list(company,q.get('status'),int(q.get('limit',50)))}
 body=parse_body(e)
 if m=='POST'and path.endswith('/start'):
  if not{'node_id','order_version'}<=body.keys():raise HttpError(400,'node_id and order_version required',code='invalid_request')
  return 200,r.start(company,order,body)
 if m=='PATCH'and line:
  if not{'version','status'}<=body.keys():raise HttpError(400,'version and status required',code='invalid_request')
  return 200,r.item(company,order,line,body)
 if m=='POST'and path.endswith('/complete'):
  if'version'not in body:raise HttpError(400,'version required',code='invalid_request')
  return 200,r.complete(company,order,body)
 raise HttpError(404,'Route not found',code='not_found')
def lambda_handler(e:dict[str,Any],context:Any):
 from tenant_security.db import db_connection
 cid=_h(e,'x-correlation-id')or str(uuid4())
 try:
  claims=e.get('requestContext',{}).get('authorizer',{}).get('jwt',{}).get('claims');tenant=_h(e,'x-tenant-id');UUID(tenant or '')
  if not isinstance(claims,dict)or not claims.get('iss')or not claims.get('sub'):raise HttpError(401,'Verified JWT claims are required',code='unauthorized')
  h=e.get('requestContext',{}).get('http',{});m=h.get('method','GET').upper();path=h.get('path','');op='operations.preparation.read'if m=='GET'else'operations.preparation.start'if path.endswith('/start')else'operations.preparation.complete'if path.endswith('/complete')else'operations.preparation.item.update'
  with db_connection(tenant_id=tenant,correlation_id=cid,operation=op)as c:a=resolve_auth(e,c,verified_claims=claims);c.execute("SELECT set_config('app.current_user_id',%s,true)",(str(a.user_id),));status,body=_request(e,PreparationRepository(c))
  return api_response(status,body)
 except HttpError as x:return api_response(x.status,{'error':{'code':x.code,'message':x.message},'correlation_id':cid})
 except Exception as x:status,code={'22023':(400,'invalid_request'),'23514':(409,'invalid_state'),'40001':(409,'stale_version'),'42501':(403,'forbidden'),'P0002':(404,'not_found')}.get(getattr(x,'sqlstate',None),(500,'internal_error'));return api_response(status,{'error':{'code':code,'message':'Preparation request failed'},'correlation_id':cid})
