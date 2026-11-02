"""Real DEV HTTP probes. Secrets/tokens stay in memory; QA changes restored in finally."""
import argparse,json,time,uuid,urllib.request,urllib.error,urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import boto3
from botocore.config import Config
import identity_qa_client as qa
ADMIN='https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com'
AGENT='https://ebn01q74hh.execute-api.us-west-1.amazonaws.com'

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();results=[];started=int(time.time()*1000)
    s=boto3.Session(profile_name='mastererp-admin',region_name='us-west-1')
    assert s.client('sts').get_caller_identity()['Account']=='277352717693'
    bundle=json.loads(s.client('secretsmanager').get_secret_value(SecretId='mastererp/dev/qa/identity-validation')['SecretString'])
    tokens={label:qa.tokens(bundle['actors'][label]) for label in ('admin_a','admin_b','member_a')}
    access=lambda label:tokens[label]['access_token']
    secret_values=[x['password'] for x in bundle['actors'].values()]+[v for t in tokens.values() for k,v in t.items() if k.endswith('_token')]
    client=s.client('lambda',config=Config(read_timeout=310,retries={'max_attempts':0}))
    def state(case,label='admin_a',**extra):
        response=client.invoke(FunctionName='mastererp-dev-database-migrator',Payload=json.dumps({'action':'qa_foundation_state','run':bundle['run'],'case':case,'actor_label':label,**extra}).encode())
        body=json.load(response['Payload'])
        if response.get('FunctionError') or body.get('status')!='succeeded':raise RuntimeError('qa_state_'+case+'_failed')
        return body
    def http(base,path,token=None,tenant=None,method='GET',body=None):
        headers={'Origin':qa.ORIGIN}
        if token:headers['Authorization']='Bearer '+token
        if tenant:headers['X-MasterERP-Tenant-Id']=tenant
        data=None
        if body is not None:headers['Content-Type']='application/json';data=json.dumps(body).encode()
        request=urllib.request.Request(base+path,headers=headers,method=method,data=data)
        try:response=urllib.request.urlopen(request,timeout=30)
        except urllib.error.HTTPError as e:response=e
        return response.status,json.load(response)
    def check(case,response,expected,predicate=lambda body:True):
        code,body=response;ok=code==expected and predicate(body)
        results.append({'case':case,'http':code,'expected':expected,'result':'passed' if ok else 'failed'})
        return body
    baseline={};session_id=None;nonce=str(uuid.uuid4())
    path=qa.STATUS;session_path='/v1/onboarding/sessions'
    try:
        for label in ('admin_a','admin_b'):baseline[label]=state('inspect',label)['baseline']
        # Preserve restoration data outside Git before the first mutation.
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.with_suffix('.qa-baseline.json').write_text(json.dumps(baseline,indent=2),encoding='utf-8')
        for label in baseline:state('baseline',label)
        a,b=bundle['tenants']['a'],bundle['tenants']['b']
        honest=lambda body:body=={'provider':'google_cloud','status':'not_configured','oauthImplemented':False,'geminiEnabled':False}
        check('uonify_missing_token',http(AGENT,path,tenant=a),401)
        check('uonify_invalid_token',http(AGENT,path,'invalid',a),401)
        check('uonify_id_token_rejected',http(AGENT,path,tokens['admin_a']['id_token'],a),403)
        check('uonify_owner_a',http(AGENT,path,access('admin_a'),a),200,honest)
        check('uonify_owner_b',http(AGENT,path,access('admin_b'),b),200,honest)
        check('uonify_non_admin_member',http(AGENT,path,access('member_a'),a),403)
        check('uonify_foreign_tenant',http(AGENT,path,access('admin_a'),b),403)
        check('uonify_actor_switch_back',http(AGENT,path,access('admin_a'),a),200,honest)
        refresh_request=urllib.request.Request(qa.DOMAIN+'/oauth2/token',data=urllib.parse.urlencode({
            'grant_type':'refresh_token','client_id':qa.CLIENT,'refresh_token':tokens['admin_a']['refresh_token']}).encode(),
            headers={'Content-Type':'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(refresh_request,timeout=30) as response:refreshed=json.load(response)
        secret_values.extend(v for k,v in refreshed.items() if k.endswith('_token'))
        check('cognito_existing_session_refresh',http(AGENT,path,refreshed['access_token'],a),200,honest)
        probes=[('admin_a',a,200),('admin_b',b,200),('admin_a',b,403),('admin_b',a,403)]*2
        with ThreadPoolExecutor(max_workers=4) as pool:
            replies=list(pool.map(lambda item:http(AGENT,path,access(item[0]),item[1]),probes))
        for index,(probe,response) in enumerate(zip(probes,replies)):
            check('parallel_read_context_'+str(index+1),response,probe[2])
        check('spaces_a',http(AGENT,qa.SPACES,access('admin_a')),200,lambda body:[x['id'] for x in body.get('spaces',[])]==[a])
        check('spaces_b',http(AGENT,qa.SPACES,access('admin_b')),200,lambda body:[x['id'] for x in body.get('spaces',[])]==[b])
        check('onboarding_missing_token',http(ADMIN,session_path+'/ffffffff-ffff-ffff-ffff-ffffffffffff'),401)
        check('onboarding_invalid_token',http(ADMIN,session_path+'/ffffffff-ffff-ffff-ffff-ffffffffffff','invalid'),401)
        created=check('onboarding_create_owned_session',http(ADMIN,session_path,access('admin_a'),method='POST',body={'context':{'qa_validation':bundle['run'],'qa_probe':nonce}}),201)
        session_id=created.get('session',{}).get('id')
        if not session_id:raise RuntimeError('qa_session_not_created')
        owned=session_path+'/'+session_id
        check('onboarding_read_owned_session',http(ADMIN,owned,access('admin_a')),200,lambda body:body.get('session',{}).get('initiated_by_user_id')==bundle['actors']['admin_a']['id'])
        check('onboarding_foreign_session_hidden',http(ADMIN,owned,access('admin_b')),404)
        check('onboarding_foreign_tenant',http(ADMIN,owned,access('admin_a'),b),403)
        check('onboarding_cannot_attach_foreign_tenant',http(ADMIN,owned,access('admin_a'),method='PATCH',body={'tenant_id':b}),403)
        check('onboarding_no_partial_foreign_association',http(ADMIN,owned,access('admin_a')),200,lambda body:body.get('session',{}).get('tenant_id') is None)
        for case in ('user_inactive','tenant_inactive','membership_inactive','permission_denied','module_disabled'):
            state(case)
            check('uonify_'+case,http(AGENT,path,access('admin_a'),a),403)
            if case in ('user_inactive','tenant_inactive','membership_inactive'):
                check('onboarding_'+case,http(ADMIN,owned,access('admin_a'),a),403)
            state('baseline')
            check('uonify_context_restored_after_'+case,http(AGENT,path,access('admin_a'),a),200,honest)
        logs=s.client('logs');records=[];events=[]
        for name in ('mastererp-dev-uonify-google-connection-handler','mastererp-dev-onboarding-session-manager'):
            response=logs.filter_log_events(logGroupName='/aws/lambda/'+name,startTime=started)
            events+=response.get('events',[])
        leaked=any(value and value in e['message'] for value in secret_values for e in events)
        for event in events:
            message=event['message'];start=message.find('{')
            if start<0:continue
            try:record=json.loads(message[start:])
            except ValueError:continue
            if isinstance(record,dict):records.append(record)
        required={'actor','tenant','company','operation','result','correlation_id'}
        audits=[record for record in records if required.issubset(record)]
        results.append({'case':'no_credentials_in_sampled_logs','result':'failed' if leaked else 'passed','events_checked':len(events)})
        results.append({'case':'structured_audit_observed','result':'passed' if audits else 'failed','records':len(audits)})
    except Exception as error:
        results.append({'case':'runner','result':'failed','error_type':type(error).__name__,'reason':str(error) if isinstance(error,RuntimeError) else 'details_redacted'})
    finally:
        for label,original in baseline.items():
            try:state('restore',label,baseline=original);results.append({'case':'restore_'+label,'result':'passed'})
            except Exception:results.append({'case':'restore_'+label,'result':'failed'})
        if session_id:
            try:state('cleanup_session',session_id=session_id,nonce=nonce);results.append({'case':'cleanup_own_session_probe','result':'passed'})
            except Exception:results.append({'case':'cleanup_own_session_probe','result':'failed'})
        report={'environment':'DEV','region':'us-west-1','validation':'real Cognito Code+PKCE and HTTP; no local doubles','results':results,
                'pending':['HTTP tenant/company creation concurrency and content conflicts','HTTP cross-company/branch operations','HTTP same actor with two tenant memberships','HTTP provisioning and six routes with removed targets'],
                'qa_mutations':'limited existing synthetic fixtures; original baseline restored in finally; new owned session removed by guarded action'}
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2))
    if any(x['result']!='passed' for x in results):raise SystemExit(1)
if __name__=='__main__':main()
