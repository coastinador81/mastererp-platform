"""Real authenticated DEV CRUD. Fixtures are new/identified; cleanup runs in finally."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.error
import urllib.request
import uuid
import boto3
from botocore.config import Config
import identity_qa_client as qa

API = 'https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    session = boto3.Session(profile_name='mastererp-admin', region_name='us-west-1')
    assert session.client('sts').get_caller_identity()['Account'] == '277352717693'
    bundle = json.loads(session.client('secretsmanager').get_secret_value(SecretId='mastererp/dev/qa/identity-validation')['SecretString'])
    tokens = {k: qa.tokens(bundle['actors'][k])['access_token'] for k in ('admin_a','admin_b','member_a')}
    client = session.client('lambda', config=Config(read_timeout=310, retries={'max_attempts':0}))
    run = 'qa-parties-'+uuid.uuid4().hex[:12]
    results = []
    report = {'run':run, 'environment':'AWS DEV us-west-1', 'results':results}
    prepared = False

    def save():
        args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')

    def state(operation):
        r = client.invoke(FunctionName='mastererp-dev-database-migrator',Payload=json.dumps(
            {'action':'party_fixture','operation':operation,'run':run,'identity_run':bundle['run']}).encode())
        body = json.load(r['Payload'])
        if r.get('FunctionError') or body.get('status')!='succeeded':
            raise RuntimeError('fixture_'+operation+'_failed')
        return body

    def http(path, method='GET', data=None, actor='admin_a', tenant=None, key=None):
        headers = {'Origin':qa.ORIGIN}
        if actor: headers['Authorization']='Bearer '+tokens[actor]
        if tenant: headers['X-MasterERP-Tenant-Id']=tenant
        if key: headers['Idempotency-Key']=key
        if data is not None: headers['Content-Type']='application/json'
        if method=='OPTIONS':
            headers.update({'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,idempotency-key,x-mastererp-tenant-id'})
        req = urllib.request.Request(API+path, headers=headers, method=method,
                                     data=json.dumps(data).encode() if data is not None else None)
        try: response=urllib.request.urlopen(req,timeout=35)
        except urllib.error.HTTPError as error: response=error
        raw=response.read()
        return response.status, json.loads(raw) if raw else {},dict(response.headers)

    def check(name, reply, expected, predicate=lambda body:True):
        status,body,headers=reply
        ok=status==expected and predicate(body)
        results.append({'case':name,'http':status,'expected':expected,'result':'passed' if ok else 'failed'})
        save()
        if not ok: raise RuntimeError(name+'_failed_http_'+str(status))
        return body.get('data',body)

    try:
        prepared_data=state('prepare');prepared=True;ids=prepared_data['ids'];report['fixture_ids']=ids;save()
        tenant=ids['tenant_a'];company=ids['company_a']
        customers='/v1/administration/clientes';suppliers='/v1/administration/proveedores'
        query='?company_id='+company
        for cap in (customers,suppliers):
            check(cap.split('/')[-1]+'_health_preserved',http(cap+'/health',actor=None),200)
        check('missing_token',http(customers+query,actor=None,tenant=tenant),401)
        preflight=http(customers,method='OPTIONS',actor=None)
        check('preflight_no_token',preflight,204)
        assert {k.lower():v for k,v in preflight[2].items()}.get('access-control-allow-origin')==qa.ORIGIN
        body={'company_id':company,'codigo':run+'-one','nombre':'QA '+run}
        first=check('create_customer_persisted',http(customers,'POST',body,tenant=tenant,key='first'),201)
        third=first['id'];assert first['version']==1
        check('detail_persisted',http(customers+'/'+third+query,tenant=tenant),200,lambda b:b['data']['codigo']==body['codigo'])
        check('idempotent_replay',http(customers,'POST',body,tenant=tenant,key='first'),200,lambda b:b['data']['id']==third and b['data']['replayed'])
        check('idempotent_content_conflict',http(customers,'POST',{**body,'nombre':'Different'},tenant=tenant,key='first'),409)
        check('supplier_same_party',http(suppliers,'POST',{'company_id':company,'tercero_id':third},tenant=tenant,key='supplier'),201,lambda b:b['data']['id']==third and len(b['data']['roles'])==2)
        check('supplier_detail',http(suppliers+'/'+third+query,tenant=tenant),200)
        check('supplier_list',http(suppliers+query,tenant=tenant),200,lambda b:len(b['data']['items'])==1)
        check('company_without_profile_hidden',http(customers+'/'+third+'?company_id='+ids['company_a2'],tenant=tenant),404)
        check('company_list_isolated',http(customers+'?company_id='+ids['company_a2'],tenant=tenant),200,lambda b:b['data']['items']==[])
        check('second_customer',http(customers,'POST',{**body,'codigo':run+'-two'},tenant=tenant,key='second'),201)
        page=check('pagination_first',http(customers+query+'&limit=1',tenant=tenant),200,lambda b:len(b['data']['items'])==1 and b['data']['next_cursor'] is not None)
        check('pagination_next',http(customers+query+'&limit=1&after='+page['next_cursor'],tenant=tenant),200,lambda b:len(b['data']['items'])==1 and b['data']['items'][0]['id']!=page['items'][0]['id'])
        check('same_party_second_company',http(customers,'POST',{'company_id':ids['company_a2'],'tercero_id':third},tenant=tenant,key='company2'),201,lambda b:b['data']['id']==third)
        update={**body,'nombre':'Updated '+run,'version':1}
        check('customer_update',http(customers+'/'+third,'PATCH',update,tenant=tenant),200,lambda b:b['data']['version']==2)
        check('shared_name_supplier',http(suppliers+'/'+third+query,tenant=tenant),200,lambda b:b['data']['nombre']==update['nombre'])
        check('stale_update',http(customers+'/'+third,'PATCH',update,tenant=tenant),409)
        # Test the supplier update operation too, before simultaneous clients updates.
        update['version']=2;update['nombre']='Supplier update '+run
        check('supplier_update',http(suppliers+'/'+third,'PATCH',update,tenant=tenant),200,lambda b:b['data']['version']==3)
        def writer(label):return http(customers+'/'+third,'PATCH',{**body,'nombre':run+label,'version':3},tenant=tenant)
        with ThreadPoolExecutor(max_workers=2) as pool: replies=list(pool.map(writer,['-race-a','-race-b']))
        assert sorted(x[0] for x in replies)==[200,409]
        results.append({'case':'real_concurrent_update','http':sorted(x[0] for x in replies),'result':'passed'});save()
        def creator(_):return http(customers,'POST',{**body,'codigo':run+'-three'},tenant=tenant,key='concurrent-create')
        with ThreadPoolExecutor(max_workers=2) as pool: replies=list(pool.map(creator,range(2)))
        assert sorted(x[0] for x in replies)==[200,201] and replies[0][1]['data']['id']==replies[1][1]['data']['id']
        results.append({'case':'real_concurrent_idempotent_create','http':sorted(x[0] for x in replies),'result':'passed'});save()
        check('member_without_permission',http(customers+query,actor='member_a',tenant=tenant),403)
        check('foreign_tenant',http(customers+'?company_id='+ids['company_b'],tenant=ids['tenant_b']),403)
        check('foreign_company',http(customers+'?company_id='+ids['company_b'],tenant=tenant),403)
        check('tenant_b_valid_empty',http(customers+'?company_id='+ids['company_b'],actor='admin_b',tenant=ids['tenant_b']),200,lambda b:b['data']['items']==[])
        check('return_to_tenant_a',http(customers+'/'+third+query,tenant=tenant),200,lambda b:b['data']['version']==4)
        for case in ('module_disabled','membership_inactive','tenant_inactive'):
            state(case);check(case,http(customers+query,tenant=tenant),403);state('restore')
        state('deny')
        check('override_write_denied',http(customers,'POST',{**body,'codigo':run+'-denied'},tenant=tenant,key='denied'),403)
        check('read_survives_write_deny',http(customers+query,tenant=tenant),200)
        state('restore')
        inspection=state('inspect');report['persisted_evidence']=inspection
        assert inspection['counts']['catalogo.terceros']==3 and inspection['counts']['administracion.perfiles_tercero']==5
        assert inspection['counts']['plataforma.idempotency_keys']==5 and inspection['valid_party_audit_events']>=8
        report['status']='passed';save()
    except Exception as error:
        report['status']='failed';report['error_type']=type(error).__name__
        if isinstance(error,RuntimeError):report['error']=str(error)
        save();raise
    finally:
        if prepared:
            try:report['cleanup']=state('cleanup')
            except Exception:
                report['cleanup']={'status':'failed','recovery_run':run};report['status']='failed';save();raise
        save()
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
