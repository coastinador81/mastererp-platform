from uuid import uuid4
import json
import pytest
from conftest import client_for
from test_google_setup import SetupCloud, BASE, body, start
from test_google_setup_provider import Response
from app import google_setup_provider as setup
from app.google_cloud_provider import CloudError


def denied(reason='SERVICE_DISABLED',service='aiplatform.googleapis.com',status=403,message='Servicio no activo.'):
    return Response({'error':{'code':status,'status':'PERMISSION_DENIED','message':message,
        'details':[{'@type':'type.googleapis.com/google.rpc.ErrorInfo','reason':reason,
            'domain':'googleapis.com','metadata':{'service':service,'permission':'aiplatform.endpoints.predict',
                'untrusted':'not-persisted'}}]}},code=status)


@pytest.mark.parametrize('reason,code',[
    ('SERVICE_DISABLED','service_disabled'),('BILLING_DISABLED','billing_required'),
    ('ACCESS_TOKEN_SCOPE_INSUFFICIENT','reauthorize'),('QUOTA_EXCEEDED','quota_exceeded'),
    ('USER_PROJECT_DENIED','quota_project_denied'),('CONSUMER_INVALID','quota_project_required'),
    ('SECURITY_POLICY_VIOLATED','organization_policy'),('IAM_PERMISSION_DENIED','permission_denied'),
])
def test_google_error_reason_survives_without_exposing_raw_response(reason,code,monkeypatch):
    calls=[]
    def http(method,url,**kwargs):
        calls.append((method,url,kwargs))
        return denied(reason)
    monkeypatch.setattr(setup.requests,'request',http)
    with pytest.raises(CloudError) as caught:
        setup.probe_model('fixture-token','project-fixture')
    assert caught.value.code==code
    details=caught.value.setup_diagnostic
    assert details['reason']==reason and details['httpStatus']==403
    assert set(details)=={'httpStatus','googleStatus','providerMessage','reason','domain','service','permission'}
    assert len(calls)==1
    assert calls[0][2]['headers']=={'Authorization':'Bearer fixture-token','x-goog-user-project':'project-fixture'}


@pytest.mark.parametrize('status,code',[(400,'invalid_request'),(404,'model_unavailable'),(429,'quota_exceeded'),(500,'google_unavailable')])
def test_rejected_model_requests_are_distinguished_from_an_uncertain_provider_failure(status,code,monkeypatch):
    monkeypatch.setattr(setup.requests,'request',lambda *args,**kwargs: Response({'error':{'message':'Rejected'}},code=status))
    with pytest.raises(CloudError) as caught:
        setup.probe_model('fixture-token','project-fixture')
    assert caught.value.code==code and caught.value.setup_diagnostic['httpStatus']==status


def test_provider_messages_are_bounded_and_credentials_urls_and_arbitrary_metadata_are_not_retained(monkeypatch):
    message='Authorization: Bearer secret-token access_token=private ya29.fixture-token https://bad.test/?client_secret=secret '+('x'*2000)
    monkeypatch.setattr(setup.requests,'request',lambda *args,**kwargs: denied(message=message))
    with pytest.raises(CloudError) as caught:
        setup.probe_model('fixture-token','project-fixture')
    saved=json.dumps(caught.value.setup_diagnostic)
    assert all(secret not in saved for secret in ('secret-token','private','ya29.fixture-token','bad.test','client_secret','untrusted'))
    assert len(caught.value.setup_diagnostic['providerMessage'])<=1200


def test_real_http_adapter_failure_is_durable_private_and_never_repeats_without_a_new_consent(environment,monkeypatch):
    config,google,db=environment
    cloud=SetupCloud()
    cloud.probe_model=setup.probe_model
    calls=[]
    def http(method,url,**kwargs):
        assert url.endswith(':generateContent')
        calls.append((method,url))
        return denied()
    monkeypatch.setattr(setup.requests,'request',http)
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request=body()
        first=client.post(BASE+'/setup',json=request).json()['operation']
        assert first['status']=='action_required' and first['modelTest']=='failed'
        assert first['errorDetails']['category']=='api'
        assert first['recovery']['kind']=='api' and 'apis/library/aiplatform.googleapis.com' in first['recovery']['url']
        assert 'ErrorInfo' not in json.dumps(first) and 'SERVICE_DISABLED' not in json.dumps(first)
        with db.connect() as c:
            saved=c.execute('SELECT error_details FROM google_setup_operations WHERE id=%s',(request['requestId'],)).fetchone()['error_details']
            assert saved['reason']=='SERVICE_DISABLED' and saved['httpStatus']==403
            assert c.execute('SELECT count(*) AS n FROM uony_model_checks').fetchone()['n']==0
        refresh=cloud.refresh
        cloud.refresh=lambda value: (_ for _ in ()).throw(AssertionError('Terminal result must not call Google again'))
        assert client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']==first
        assert client.get(BASE+'/setup').json()['operation']==first and len(calls)==1
        cloud.refresh=refresh
        without_consent={'requestId':str(uuid4()),'retryOf':first['id']}
        assert client.post(BASE+'/setup',json=without_consent).status_code==409
        # A second consent cannot bypass an unresolved structural rejection.
        assert client.post(BASE+'/setup',json={**without_consent,'modelTestConsent':True,'acceptAdditionalModelCost':True}).status_code==409
        diagnostic=client.post(BASE+'/setup/'+first['id']+'/diagnostics').json()['operation']
        assert diagnostic['accessCheck']['status']=='eligible' and diagnostic['modelTest']=='failed'
        assert len(calls)==1
        assert client.post(BASE+'/setup',json=without_consent).status_code==400
        retried=client.post(BASE+'/setup',json={**without_consent,'modelTestConsent':True,'acceptAdditionalModelCost':True}).json()['operation']
        assert retried['status']=='action_required' and retried['modelTest']=='failed'
        assert retried['retryOf']==first['id'] and retried['errorDetails']['category']=='api' and len(calls)==2
        assert client.get('/api/onboarding/setup').json()['aiReady'] is False


def test_denied_quota_project_links_iam_with_an_explicit_new_probe_instead_of_resuming_failed_result():
    from app.onboarding_setup import public_operation
    row={'id':uuid4(),'status':'action_required','step':'model','project_id':'project-fixture',
        'project_name':'Mi proyecto','mode':'existing','billing_account_name':None,
        'model_consented_at':True,'retry_of':None,'revision_of':None,'additional_cost_accepted_at':None,
        'model_test':'failed','lease_until':None,'error_code':'quota_project_denied','message':'Guardado',
        'error_details':{'httpStatus':403,'reason':'USER_PROJECT_DENIED'}}
    operation=public_operation(row,{'email':'owner@example.test'})
    assert operation['errorDetails']['category']=='permissions'
    assert operation['recovery']['kind']=='permissions'
    assert '/iam-admin/iam?' in operation['recovery']['url']
    assert operation['canRetryModel'] is False and operation['canResume'] is False
    assert 'USER_PROJECT_DENIED' not in json.dumps(operation)


def test_model_predict_denial_explains_access_without_inventing_a_missing_iam_permission():
    from app.google_setup_diagnostics import public_failure, response_error
    raw=denied(reason='IAM_PERMISSION_DENIED',message='Permission aiplatform.endpoints.predict denied on resource.')
    raw.data['error']['details'][0]['metadata']['resource']='projects/12345/locations/global/publishers/google/models/gemini-3.5-flash'
    error=response_error(raw)
    assert error.setup_diagnostic['domain']=='googleapis.com'
    assert error.setup_diagnostic['resource'].endswith('/gemini-3.5-flash')
    public=public_failure({'status':'action_required','step':'model','model_test':'failed',
        'error_code':error.code,'error_details':error.setup_diagnostic})
    assert public['category']=='model' and 'no confirma que falten permisos' in public['message']
    assert all(value not in str(public) for value in ('aiplatform.endpoints.predict','IAM_PERMISSION_DENIED','projects/12345'))
    raw.data['error']['details'][0]['metadata']['resource']='https://bad.test/?access_token=private'
    assert 'resource' not in response_error(raw).setup_diagnostic
