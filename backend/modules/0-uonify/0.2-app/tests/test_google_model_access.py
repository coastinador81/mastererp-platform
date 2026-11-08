"""Read-only readiness never turns into a response, capability or blind retry."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import pytest
from conftest import client_for, login
from test_subscription import complete
from test_google_cloud import connect
from test_google_setup import SetupCloud, BASE, body, start
from test_google_setup_provider import Response
from app.google_cloud_provider import CloudError
from app import google_setup_provider as setup
from app.google_setup_access import eligible


def denied(reason='IAM_PERMISSION_DENIED'):
    failure=CloudError('permission_denied')
    failure.setup_diagnostic={'httpStatus':403,'reason':reason,
        'permission':'aiplatform.endpoints.predict','providerMessage':'Permission aiplatform.endpoints.predict denied.'}
    return failure


def diagnose(client,operation):
    return client.post(BASE+'/setup/'+operation['id']+'/diagnostics')


def expire(connection,operation):
    connection.execute("UPDATE google_setup_operations SET access_check=jsonb_set(access_check,'{nextCheckAt}',to_jsonb(%s::text)) WHERE id=%s",
        ((datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat(),operation['id']))


def test_access_preflight_only_counts_a_fixed_prompt_without_generation(monkeypatch):
    calls=[]
    monkeypatch.setattr(setup.requests,'request',lambda method,url,**kwargs: (calls.append((method,url,kwargs)),Response({'totalTokens':2}))[1])
    assert setup.check_model_access('fixture-token','fixture-project')=={'totalTokens':2}
    assert len(calls)==1 and calls[0][1].endswith('/models/gemini-3.5-flash:countTokens')
    assert calls[0][2]['headers']=={'Authorization':'Bearer fixture-token','x-goog-user-project':'fixture-project'}
    assert set(calls[0][2]['json'])=={'contents'}
    assert 'tools' not in calls[0][2]['json'] and 'generationConfig' not in calls[0][2]['json']


@pytest.mark.parametrize('total',[None,True,-1,'2'])
def test_malformed_free_check_does_not_become_eligible(total,monkeypatch):
    monkeypatch.setattr(setup.requests,'request',lambda *a,**kw: Response({'totalTokens':total}))
    with pytest.raises(CloudError) as failure:
        setup.check_model_access('fixture','fixture-project')
    assert failure.value.code=='invalid_response'


def test_new_project_waits_with_durable_cooldown_before_any_generation(environment):
    config,google,db=environment
    cloud=SetupCloud(); cloud.access_error=denied()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request=body('create')
        first=client.post(BASE+'/setup',json=request).json()['operation']
        assert first['status']=='preparing' and first['modelTest']=='not_started'
        assert first['accessCheck']['status']=='waiting' and first['canDiagnose']
        assert first['canResume'] is False and first['canRetryModel'] is False
        assert cloud.probes==0 and cloud.accesses==1 and len(cloud.created)==1
        assert client.get(BASE+'/setup').json()['operation']['accessCheck']==first['accessCheck']
        assert diagnose(client,first).json()['operation']['accessCheck']==first['accessCheck']
        assert cloud.probes==0 and cloud.accesses==1
        with db.connect() as connection:
            expire(connection,first)
            assert connection.execute('SELECT count(*) AS n FROM uony_model_checks').fetchone()['n']==0
        cloud.access_error=None
        checked=diagnose(client,first).json()['operation']
        assert checked['accessCheck']['status']=='eligible' and checked['canResume']
        assert checked['modelTest']=='not_started' and cloud.probes==0 and cloud.accesses==2
        assert client.get('/api/onboarding/setup').json()['aiReady'] is False
        resumed=client.post(BASE+'/setup',json={'requestId':first['id']}).json()['operation']
        assert resumed['status']=='ready' and resumed['modelTest']=='passed'
        assert cloud.probes==1 and cloud.accesses==2


def test_waiting_is_bounded_and_diagnostics_do_not_mutate_google_configuration(environment):
    config,google,db=environment
    cloud=SetupCloud(); cloud.access_error=denied()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body('create')).json()['operation']
        cloud.create_project=lambda *a: (_ for _ in ()).throw(AssertionError('No create'))
        cloud.enable_vertex=lambda *a: (_ for _ in ()).throw(AssertionError('No enable'))
        cloud.link_billing=lambda *a: (_ for _ in ()).throw(AssertionError('No billing mutation'))
        for _ in range(6):
            with db.connect() as connection: expire(connection,first)
            first=diagnose(client,first).json()['operation']
        assert first['accessCheck']['status']=='unresolved' and cloud.accesses==7
        assert cloud.probes==0 and first['canRetryModel'] is False
        assert first['recovery']['kind']=='diagnostics' and first['recovery']['url'] is None
        assert 'IAM_PERMISSION_DENIED' not in str(first) and 'aiplatform.endpoints.predict' not in str(first)


def test_existing_project_unknown_denial_is_unresolved_not_assumed_propagation(environment):
    config,google,db=environment
    cloud=SetupCloud(); cloud.access_error=denied()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        assert first['accessCheck']['status']=='unresolved' and first['status']=='action_required'
        assert first['modelTest']=='not_started' and cloud.probes==0
        assert first['canDiagnose'] and first['recovery']['url'] is None


def test_generation_rejection_invalidates_free_eligibility_and_cannot_be_retried_blindly(environment):
    config,google,db=environment
    cloud=SetupCloud(); cloud.probe_error='permission_denied'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        assert first['modelTest']=='failed' and first['accessCheck'] is None and first['canRetryModel'] is False
        assert cloud.probes==1 and cloud.accesses==1
        request={'requestId':str(uuid4()),'retryOf':first['id'],'modelTestConsent':True,'acceptAdditionalModelCost':True}
        assert client.post(BASE+'/setup',json=request).status_code==409
        checked=diagnose(client,first).json()['operation']
        assert checked['modelTest']=='failed' and checked['accessCheck']['status']=='eligible'
        assert checked['accessCheck']['message']=='Google ha confirmado el acceso al modelo sin generar contenido. La prueba de respuesta se realiza por separado y solo con tu autorización.'
        assert checked['canRetryModel'] and cloud.probes==1
        with db.connect() as connection:
            old=connection.execute('SELECT * FROM google_setup_operations WHERE id=%s',(first['id'],)).fetchone()
            assert old['error_code']=='permission_denied' and old['model_test']=='failed'
            assert connection.execute('SELECT count(*) AS n FROM uony_model_checks').fetchone()['n']==0
        cloud.probe_error=None
        assert client.post(BASE+'/setup',json=request).json()['operation']['status']=='ready'
        assert cloud.probes==2


def test_diagnostics_respect_origin_owner_project_lease_and_stale_eligibility(environment):
    config,google,db=environment
    cloud=SetupCloud(); cloud.probe_error='permission_denied'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        path=BASE+'/setup/'+first['id']+'/diagnostics'
        assert client.post(path,headers={'Origin':'null'}).status_code==403
        with db.connect() as connection:
            connection.execute("UPDATE google_setup_operations SET lease_until=now()+interval '2 minutes' WHERE id=%s",(first['id'],))
        assert diagnose(client,first).status_code==409
        with db.connect() as connection:
            assert connection.execute('SELECT lease_until>now() AS active FROM google_setup_operations WHERE id=%s',(first['id'],)).fetchone()['active']
            connection.execute('UPDATE google_setup_operations SET lease_until=NULL WHERE id=%s',(first['id'],))
            connection.execute("UPDATE google_cloud_connections SET project_id='changed-project'")
        assert diagnose(client,first).status_code==409
        with db.connect() as connection: connection.execute("UPDATE google_cloud_connections SET project_id='customer-project'")
        assert diagnose(client,first).json()['operation']['canRetryModel']
        with db.connect() as connection:
            saved=connection.execute('SELECT * FROM google_setup_operations WHERE id=%s',(first['id'],)).fetchone()
            saved['access_check']['checkedAt']=(datetime.now(timezone.utc)-timedelta(minutes=11)).isoformat()
            assert eligible(saved) is False
        google.subject='other-google';google.email='other@example.test';cloud.subject=google.subject;cloud.email=google.email
        login(client,google);complete(client);connect(client,cloud)
        assert diagnose(client,first).status_code==404 and cloud.probes==1


def test_billing_revision_still_checks_access_before_any_new_generation(environment):
    config,google,db=environment
    cloud=SetupCloud(); cloud.probe_error='permission_denied'
    accounts=cloud.billing_accounts
    cloud.billing_accounts=lambda token: accounts(token)+[{'name':'billingAccounts/SECOND-123','displayName':'Otra cuenta','open':True}]
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        cloud.probe_error=None;cloud.access_error=denied()
        revision=client.post(BASE+'/setup',json={'requestId':str(uuid4()),'revisionOf':first['id'],
            'mode':'existing','projectId':first['projectId'],'billingAccountName':'billingAccounts/SECOND-123',
            'configurationApproved':True,'modelTestConsent':True}).json()['operation']
        assert cloud.linked[first['projectId']]=='billingAccounts/SECOND-123'
        assert revision['modelTest']=='not_started' and revision['accessCheck']['status']=='unresolved'
        assert cloud.probes==1 and cloud.accesses==2
        assert revision['revisionOf']==first['id'] and first['modelTest']=='failed'


def test_unprepared_project_diagnostic_never_counts_or_generates(environment):
    config,google,db=environment
    cloud=SetupCloud();cloud.probe_error='permission_denied'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        before=cloud.accesses
        cloud.enabled.clear()
        result=diagnose(client,first).json()['operation']
        assert result['accessCheck']['status']=='blocked' and not result['canRetryModel']
        assert cloud.accesses==before and cloud.probes==1
        assert result['modelTest']=='failed'


def test_refresh_failure_during_diagnosis_preserves_original_denial_and_clears_own_lease(environment):
    config,google,db=environment
    cloud=SetupCloud();cloud.probe_error='permission_denied'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        cloud.refresh=lambda *a: (_ for _ in ()).throw(CloudError('reauthorize'))
        response=diagnose(client,first)
        assert response.status_code==200
        assert response.json()['operation']['accessCheck']['status']=='unresolved'
        with db.connect() as connection:
            saved=connection.execute('SELECT * FROM google_setup_operations WHERE id=%s',(first['id'],)).fetchone()
            assert saved['error_code']=='permission_denied' and saved['model_test']=='failed'
            assert saved['lease_until'] is None
        assert cloud.probes==1 and cloud.accesses==1


def test_double_click_diagnostic_runs_one_free_check_and_no_response(environment):
    config,google,db=environment
    cloud=SetupCloud();cloud.probe_error='permission_denied'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        entered,release=Event(),Event()
        original=cloud.check_model_access
        def waiting(*args):
            entered.set()
            assert release.wait(5)
            return original(*args)
        cloud.check_model_access=waiting
        with ThreadPoolExecutor(max_workers=2) as pool:
            one=pool.submit(diagnose,client,first)
            assert entered.wait(5)
            two=pool.submit(diagnose,client,first)
            release.set()
            assert one.result(timeout=10).status_code==200
            assert two.result(timeout=10).status_code in (200,409)
        assert cloud.accesses==2 and cloud.probes==1
        assert diagnose(client,first).json()['operation']['accessCheck']['status']=='eligible'
        assert cloud.accesses==2


def test_free_eligibility_does_not_resume_a_response_without_initial_consent(environment):
    config,google,db=environment
    cloud=SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body(modelTestConsent=False)).json()['operation']
        assert first['modelTest']=='not_started' and cloud.probes==0
        checked=diagnose(client,first).json()['operation']
        assert checked['accessCheck']['status']=='eligible'
        assert checked['status']=='action_required' and not checked['modelTestConsent']
        assert checked['modelTest']=='not_started' and cloud.probes==0


def test_access_scope_rejection_returns_to_same_account_oauth_without_generation(environment):
    config,google,db=environment
    cloud=SetupCloud();cloud.access_error=CloudError('reauthorize')
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        response=client.post(BASE+'/setup',json=body()).json()
        operation=response['operation']
        assert response['connection']['status']=='reauthorize'
        assert operation['modelTest']=='not_started' and not operation['canRetryModel']
        assert operation['canDiagnose'] is False and operation['canResume'] is False
        assert operation['recovery']['kind']=='authorization'
        assert operation['recovery']['url'] is None
        assert cloud.probes==0


def test_generation_scope_rejection_exposes_oauth_and_no_retry_or_diagnostic(environment):
    config,google,db=environment
    cloud=SetupCloud();cloud.probe_error='reauthorize'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        operation=client.post(BASE+'/setup',json=body()).json()['operation']
        assert operation['modelTest']=='failed' and operation['recovery']['kind']=='authorization'
        assert operation['canDiagnose'] is False and operation['canRetryModel'] is False
        assert operation['canResume'] is False and cloud.probes==1


@pytest.mark.parametrize('during',['count','response'])
def test_verified_same_account_oauth_reopens_only_free_diagnosis_preserving_failure(environment,during):
    config,google,db=environment
    cloud=SetupCloud()
    if during=='count': cloud.access_error=CloudError('reauthorize')
    else: cloud.probe_error='reauthorize'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        probes=cloud.probes
        with db.connect() as connection:
            original=connection.execute('SELECT error_code,error_details,model_test,status,model_consented_at FROM google_setup_operations WHERE id=%s',(first['id'],)).fetchone()
        cloud.access_error=None;cloud.probe_error=None
        assert connect(client,cloud).status_code==303
        renewed=client.get(BASE+'/setup').json()['operation']
        assert renewed['accessCheck']['status']=='unresolved'
        assert renewed['canDiagnose'] and not renewed['canRetryModel']
        assert renewed['recovery']['kind']=='diagnostics' and cloud.probes==probes
        with db.connect() as connection:
            saved=connection.execute('SELECT error_code,error_details,model_test,status,model_consented_at FROM google_setup_operations WHERE id=%s',(first['id'],)).fetchone()
            assert saved==original
            assert connection.execute('SELECT count(*) AS n FROM uony_model_checks').fetchone()['n']==0
        checked=diagnose(client,renewed).json()['operation']
        assert checked['accessCheck']['status']=='eligible' and cloud.probes==probes
        if during=='response':
            assert checked['canRetryModel'] and checked['recovery']['kind']=='retry_model'
            assert checked['errorDetails']['category']=='model'


@pytest.mark.parametrize('failure',['denied','account_mismatch'])
def test_failed_or_other_account_oauth_does_not_clear_auth_diagnostic(environment,failure):
    config,google,db=environment
    cloud=SetupCloud();cloud.access_error=CloudError('reauthorize')
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        first=client.post(BASE+'/setup',json=body()).json()['operation']
        before=first['accessCheck']
        assert client.post(BASE+'/start').status_code==200
        query={'state':cloud.state,'code':'fixture-code'}
        if failure=='denied': query={'state':cloud.state,'error':'access_denied'}
        else: cloud.subject='foreign-subject'
        client.get('/api/auth/google/callback',params=query)
        unchanged=client.get(BASE+'/setup').json()['operation']
        assert unchanged['accessCheck']==before
        assert unchanged['canDiagnose'] is False and unchanged['canRetryModel'] is False
        assert unchanged['recovery']['kind']=='authorization' and cloud.probes==0
