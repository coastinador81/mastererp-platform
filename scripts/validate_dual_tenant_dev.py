"""Real HTTP same actor/two tenants. Temporary QA membership and settings restored."""
import argparse,json,uuid,re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import boto3
from botocore.config import Config
import identity_qa_client as qa

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    s=boto3.Session(profile_name='mastererp-admin',region_name='us-west-1');assert s.client('sts').get_caller_identity()['Account']=='277352717693'
    bundle=json.loads(s.client('secretsmanager').get_secret_value(SecretId='mastererp/dev/qa/identity-validation')['SecretString'])
    token=qa.tokens(bundle['actors']['admin_a'])['access_token'];client=s.client('lambda',config=Config(read_timeout=310,retries={'max_attempts':0}))
    nonce=str(uuid.uuid4());baselines={};prepared=False;results=[];initial_spaces=None;phase='initial'
    def invoke(event):
        r=client.invoke(FunctionName='mastererp-dev-database-migrator',Payload=json.dumps({'run':bundle['run'],**event}).encode());body=json.load(r['Payload'])
        if r.get('FunctionError') or body.get('status')!='succeeded':
            # Official QA helper errors contain only phase/SQLSTATE, not parameters.
            match=re.search(r'sqlstate=([0-9A-Z]{5}|unknown)',str(body.get('errorMessage','')))
            raise RuntimeError('fixture_action_failed; sqlstate='+(match[1] if match else 'unknown'))
        return body
    def state(case,label,**extra):return invoke({'action':'qa_foundation_state','case':case,'actor_label':label,**extra})
    def dual(operation):return invoke({'action':'qa_dual_tenant','operation':operation,'nonce':nonce})
    def check(name,response,code,predicate=lambda body:True):
        actual,headers,body=response;results.append({'case':name,'http':actual,'expected':code,'result':'passed' if actual==code and predicate(body) else 'failed'});return body
    a,b=bundle['tenants']['a'],bundle['tenants']['b']
    honest=lambda body:body=={'provider':'google_cloud','status':'not_configured','oauthImplemented':False,'geminiEnabled':False}
    try:
        initial_spaces=check('initial_spaces',qa.api(qa.SPACES,token),200)
        original_ids={x['id'] for x in initial_spaces['spaces']}
        for label in ('admin_a','admin_b'):baselines[label]=state('inspect',label)['baseline']
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.with_suffix('.recovery.json').write_text(json.dumps({'run':bundle['run'],'nonce':nonce,'baseline':baselines},indent=2),encoding='utf-8')
        phase='prepare'
        for label in baselines:state('baseline',label)
        dual('prepare');prepared=True
        check('same_actor_spaces_include_both',qa.api(qa.SPACES,token),200,lambda body:{x['id'] for x in body['spaces']}==original_ids|{b})
        check('tenant_a_permission_allowed',qa.api(qa.STATUS,token,a),200,honest)
        check('tenant_b_explicit_deny',qa.api(qa.STATUS,token,b),403)
        phase='parallel_context'
        tenants=[a,b]*4
        with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(lambda tenant:qa.api(qa.STATUS,token,tenant),tenants))
        for i,(tenant,response) in enumerate(zip(tenants,responses)):check('parallel_same_actor_'+str(i+1),response,200 if tenant==a else 403)
        phase='tenant_b_permission'
        dual('allow')
        check('tenant_b_permission_allowed',qa.api(qa.STATUS,token,b),200,honest)
        check('tenant_a_still_allowed',qa.api(qa.STATUS,token,a),200,honest)
        dual('deny')
        check('tenant_b_revoked_by_api',qa.api(qa.STATUS,token,b),403)
        check('tenant_a_not_revoked',qa.api(qa.STATUS,token,a),200,honest)
    except Exception as error:
        results.append({'case':'runner','phase':phase,'result':'failed','error':str(error) if isinstance(error,RuntimeError) else type(error).__name__})
    finally:
        if prepared:
            try:dual('cleanup');results.append({'case':'temporary_membership_removed','result':'passed'})
            except Exception:results.append({'case':'temporary_membership_removed','result':'failed'})
        for label,baseline in baselines.items():
            try:state('restore',label,baseline=baseline);results.append({'case':'restore_'+label,'result':'passed'})
            except Exception:results.append({'case':'restore_'+label,'result':'failed'})
        if initial_spaces is not None:
            check('spaces_return_to_original',qa.api(qa.SPACES,token),200,lambda body:{x['id'] for x in body['spaces']}=={x['id'] for x in initial_spaces['spaces']})
        report={'environment':'DEV','region':'us-west-1','validation':'real Cognito access token and HTTP; no doubles','model_application_invoked':False,'results':results}
        args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,indent=2))
    if any(row['result']!='passed' for row in results):raise SystemExit(1)
if __name__=='__main__':main()
