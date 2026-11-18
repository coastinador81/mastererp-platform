"""Authenticated Orders DEV checks, with bounded official QA fixtures and no secret output."""
import argparse,json,sys,uuid,urllib.request,urllib.error
from pathlib import Path
import boto3
from botocore.config import Config
import identity_qa_client as qa

API='https://finanzas-dev.uonify.com'
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--keep-fixtures',action='store_true');args=parser.parse_args()
 session=boto3.Session(profile_name='mastererp-admin',region_name='us-west-1')
 assert session.client('sts').get_caller_identity()['Account']=='277352717693'
 bundle=json.loads(session.client('secretsmanager').get_secret_value(SecretId='mastererp/dev/qa/identity-validation')['SecretString'])
 client=session.client('lambda',config=Config(read_timeout=310,retries={'max_attempts':0}))
 run='qa-parties-'+uuid.uuid4().hex[:12];prepared=False;ids={}
 report={'run':run,'scope':'AWS DEV us-west-1, isolated QA fixtures','cases':[],'orders':[]}
 def save():args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 def fixture(operation):
  r=client.invoke(FunctionName='mastererp-dev-database-migrator',Payload=json.dumps({'action':'party_fixture','operation':operation,'run':run,'identity_run':bundle['run']}).encode());body=json.load(r['Payload'])
  if r.get('FunctionError') or body.get('status')!='succeeded':raise RuntimeError('fixture_'+operation+'_failed')
  return body
 tokens={key:qa.tokens(bundle['actors'][key])['access_token'] for key in ['admin_a','admin_b','member_a']}
 def http(path,method='GET',body=None,actor='admin_a',tenant=None,key=None):
  headers={'Origin':API}
  if actor:headers['Authorization']='Bearer '+tokens[actor]
  if tenant:headers['X-MasterERP-Tenant-Id']=tenant
  if key:headers['Idempotency-Key']=key
  if body is not None:headers['Content-Type']='application/json'
  req=urllib.request.Request(API+'/v1/administration/'+path,method=method,headers=headers,data=json.dumps(body).encode() if body is not None else None)
  try:r=urllib.request.urlopen(req,timeout=40)
  except urllib.error.HTTPError as error:r=error
  raw=r.read();return r.status,json.loads(raw) if raw else {}
 def check(name,response,expected):
  status,body=response;ok=status==expected;report['cases'].append({'name':name,'http':status,'expected':expected,'passed':ok,'correlation_id':body.get('correlation_id')});save()
  if not ok:raise RuntimeError(name+'_http_'+str(status))
  return body.get('data',body)
 try:
  ids=fixture('prepare')['ids'];prepared=True;report['fixture_ids']=ids;save();tenant=ids['tenant_a'];company=ids['company_a'];query='?company_id='+company
  check('missing_token',http('compras/ordenes'+query,actor=None),401)
  check('member_without_permission',http('compras/ordenes'+query,actor='member_a',tenant=tenant),403)
  check('foreign_tenant',http('compras/ordenes'+query,actor='admin_b',tenant=tenant),403)
  check('foreign_company',http('compras/ordenes?company_id='+ids['company_b'],tenant=tenant),403)
  supplier=check('supplier_create',http('proveedores','POST',{'company_id':company,'codigo':run+'-supplier','nombre':'PRUEBA Ordenes proveedor '+run},tenant=tenant,key=run+'-supplier'),201)
  for index in range(1,4):
   payload={'company_id':company,'documento':{'proveedor_id':supplier['id'],'origen_id':'','fecha':'2026-11-18','numero':'PRUEBA-SOL-'+run[-12:]+'-'+str(index),'serie':'QA','moneda':'USD','tipo_cambio':'1','cambio_fecha':'2026-11-18','cambio_fuente':'misma moneda','lineas':[{'descripcion':'PRUEBA: suministro para validar ordenes','cantidad':str(index+1),'precio_unitario':'12.35'}]}}
   source=check('source_create_'+str(index),http('compras/solicitudes','POST',payload,tenant=tenant,key=run+'-source-'+str(index)),201)
   payload['documento']['origen_id']=source['id'];payload['documento']['numero']='PRUEBA-OC-'+run[-12:]+'-'+str(index)
   order=check('order_create_'+str(index),http('compras/ordenes','POST',payload,tenant=tenant,key=run+'-order-'+str(index)),201)
   replay=check('idempotent_replay_'+str(index),http('compras/ordenes','POST',payload,tenant=tenant,key=run+'-order-'+str(index)),200)
   assert replay['id']==order['id'] and replay['replayed']
   detail=check('persisted_detail_'+str(index),http('compras/ordenes/'+order['id']+query,tenant=tenant),200)
   assert detail['company_id']==company and detail['origen_id']==source['id'] and len(detail['lineas'])==1
   report['orders'].append({'id':detail['id'],'reference':detail['numero'],'total':detail['total'],'source_id':source['id']});save()
   conflict=dict(payload,documento=dict(payload['documento'],numero='PRUEBA-CONFLICTO-'+str(index)))
   check('idempotent_content_conflict_'+str(index),http('compras/ordenes','POST',conflict,tenant=tenant,key=run+'-order-'+str(index)),409)
  first=check('list_page_1',http('compras/ordenes'+query+'&limit=2',tenant=tenant),200);assert len(first['items'])==2 and first['next_cursor']
  second=check('list_page_2',http('compras/ordenes'+query+'&limit=2&after='+first['next_cursor'],tenant=tenant),200);assert len(second['items'])==1 and second['next_cursor'] is None
  assert {r['id'] for r in first['items']+second['items']}=={r['id'] for r in report['orders']}
  other=check('same_tenant_other_company_empty',http('compras/ordenes?company_id='+ids['company_a2'],tenant=tenant),200);assert other['items']==[]
  check('detail_not_visible_in_other_company',http('compras/ordenes/'+report['orders'][0]['id']+'?company_id='+ids['company_a2'],tenant=tenant),404)
  inspection=fixture('inspect');report['audit_events']=inspection['valid_purchase_audit_events'];assert report['audit_events']>=6;report['status']='passed'
 except Exception as error:
  report['status']='failed';report['error']=str(error) if str(error).replace('_','').replace('-','').isalnum() else 'validation_failed'
 finally:
  if prepared and (not args.keep_fixtures or report.get('status')!='passed'):
   try:fixture('cleanup');report['cleanup']='passed'
   except Exception:report['cleanup']='failed';report['status']='failed'
  elif prepared:report['cleanup']='pending_browser_validation';report['cleanup_run']=run
  save();print(json.dumps(report,indent=2))
 return 0 if report.get('status')=='passed' else 1
if __name__=='__main__':sys.exit(main())
