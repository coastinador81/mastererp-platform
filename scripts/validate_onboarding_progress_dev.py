"""Focused real HTTP validation of both existing Onboarding functions; owned probe only."""
import argparse,json,uuid,urllib.request,urllib.error
from pathlib import Path
import boto3
import identity_qa_client as qa
API='https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com'
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    s=boto3.Session(profile_name='mastererp-admin',region_name='us-west-1');assert s.client('sts').get_caller_identity()['Account']=='277352717693'
    bundle=json.loads(s.client('secretsmanager').get_secret_value(SecretId='mastererp/dev/qa/identity-validation')['SecretString'])
    token=qa.tokens(bundle['actors']['admin_a'])['access_token'];nonce=str(uuid.uuid4());rows=[];session_id=None
    context={'qa_validation':bundle['run'],'qa_probe':nonce}
    def request(path,method='GET',body=None,authenticated=True):
        headers={'Content-Type':'application/json'}
        if authenticated:headers['Authorization']='Bearer '+token
        req=urllib.request.Request(API+path,headers=headers,method=method,data=json.dumps(body).encode() if body is not None else None)
        try:r=urllib.request.urlopen(req,timeout=30)
        except urllib.error.HTTPError as error:r=error
        return r.status,json.load(r)
    def check(name,response,expected):
        code,body=response;rows.append({'case':name,'http':code,'expected':expected,'result':'passed' if code==expected else 'failed'});return body
    try:
        body=check('create_probe',request('/v1/onboarding/sessions','POST',{'context':context}),201)
        session_id=body.get('session',{}).get('id')
        if not session_id:raise RuntimeError('probe_not_created')
        path='/v1/onboarding/sessions/'+session_id
        check('progress_without_token',request(path+'/progress',authenticated=False),401)
        check('progress_owned_session',request(path+'/progress'),200)
        check('patch_owned_session',request(path,'PATCH',{'context':{**context,'qa_status':'checked'}}),200)
        check('complete_owned_session',request(path+'/complete','POST',{}),200)
        final=check('read_completed_progress',request(path+'/progress'),200)
        rows.append({'case':'completion_persisted','result':'passed' if final.get('session',{}).get('status')=='completed' else 'failed'})
    except Exception as error:
        rows.append({'case':'runner','result':'failed','error_type':type(error).__name__})
    finally:
        if session_id:
            r=s.client('lambda').invoke(FunctionName='mastererp-dev-database-migrator',Payload=json.dumps({'action':'qa_foundation_state','run':bundle['run'],'case':'cleanup_session','session_id':session_id,'nonce':nonce}).encode())
            body=json.load(r['Payload']);rows.append({'case':'cleanup_owned_probe','result':'passed' if not r.get('FunctionError') and body.get('status')=='succeeded' else 'failed'})
        report={'validation':'real DEV HTTP; no local doubles','region':'us-west-1','results':rows,'scope':'session/progress only; completion does not claim provisioning'}
        args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,indent=2))
    if any(r['result']!='passed' for r in rows):raise SystemExit(1)
if __name__=='__main__':main()
