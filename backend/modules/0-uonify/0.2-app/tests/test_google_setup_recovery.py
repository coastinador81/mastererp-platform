from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4
import pytest
from conftest import client_for, login
from test_subscription import complete
from test_google_cloud import connect
from test_google_setup import SetupCloud, BASE, body, start
from app.google_cloud_provider import CloudError


def unknown(client, cloud):
    cloud.probe_error = 'google_unavailable'
    response = client.post(BASE+'/setup',json=body())
    assert response.status_code == 200, response.text
    operation = response.json()['operation']
    assert operation['modelTest'] == 'unknown'
    cloud.probe_error = None
    return operation


def retry(previous, **changes):
    return {'requestId':str(uuid4()),'retryOf':previous['id'],
            'acceptAdditionalModelCost':True,'modelTestConsent':True,**changes}


@pytest.mark.parametrize('consent',[False,1,'true',None])
def test_additional_consumption_requires_new_literal_consent(environment, consent):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = unknown(client,cloud)
        response = client.post(BASE+'/setup',json=retry(previous,acceptAdditionalModelCost=consent))
        assert response.status_code == 400
        assert cloud.probes == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM google_setup_operations').fetchone()['n'] == 1


def test_new_consented_retry_preserves_unknown_history_and_is_idempotent(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = unknown(client,cloud)
        assert previous['canRetryModel'] and previous['recovery']['kind'] == 'retry_model'
        request = retry(previous)
        for _ in range(2):
            response = client.post(BASE+'/setup',json=request)
            assert response.status_code == 200, response.text
            assert response.json()['operation']['status'] == 'ready'
        assert cloud.probes == 2
        with db.connect() as c:
            old = c.execute('SELECT * FROM google_setup_operations WHERE id=%s',(previous['id'],)).fetchone()
            new = c.execute('SELECT * FROM google_setup_operations WHERE id=%s',(request['requestId'],)).fetchone()
            assert old['model_test'] == 'unknown'
            assert new['retry_of'] == old['id'] and new['additional_cost_accepted_at']
            assert new['model_consented_at'] >= old['model_consented_at']
        client.post(BASE+'/setup',json={'requestId':previous['id']})
        with db.connect() as c:
            assert c.execute('SELECT model_test FROM google_setup_operations WHERE id=%s',(previous['id'],)).fetchone()['model_test'] == 'unknown'
        assert cloud.probes == 2


def test_retry_rejects_an_active_lease_and_another_google_identity(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = unknown(client,cloud)
        with db.connect() as c:
            c.execute("UPDATE google_setup_operations SET lease_until=now()+interval '2 minutes' WHERE id=%s",(previous['id'],))
        assert client.post(BASE+'/setup',json=retry(previous)).json()['error'] == 'setup_active'
        assert cloud.probes == 1
        with db.connect() as c:
            c.execute('UPDATE google_setup_operations SET lease_until=NULL WHERE id=%s',(previous['id'],))
        google.subject = 'other-owner'; google.email = 'other@example.test'
        cloud.subject,cloud.email = google.subject,google.email
        login(client,google); complete(client); connect(client,cloud)
        assert client.post(BASE+'/setup',json=retry(previous)).status_code == 404
        assert cloud.probes == 1


def test_double_click_new_retry_makes_at_most_one_additional_paid_call(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = unknown(client,cloud)
        request = retry(previous)
        entered, release = Event(), Event()
        actual = cloud.probe_model
        def waiting(*args):
            entered.set()
            assert release.wait(5)
            return actual(*args)
        cloud.probe_model = waiting
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(client.post,BASE+'/setup',json=request)
            assert entered.wait(5)
            second = pool.submit(client.post,BASE+'/setup',json=request)
            release.set()
            assert first.result(timeout=10).status_code == 200
            assert second.result(timeout=10).status_code in (200,409)
        assert cloud.probes == 2
        assert client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']['status'] == 'ready'
        assert cloud.probes == 2


def test_refresh_failure_before_paid_boundary_remains_not_started_and_can_resume(environment):
    config,google,db = environment
    cloud = SetupCloud()
    actual = cloud.refresh
    attempts = []
    def refresh(value):
        attempts.append(value)
        if len(attempts) == 3:
            raise CloudError('reauthorize')
        return actual(value)
    cloud.refresh = refresh
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request = body()
        result = client.post(BASE+'/setup',json=request).json()['operation']
        assert result['modelTest'] == 'not_started' and cloud.probes == 0
        assert result['recovery']['kind'] == 'authorization'
        connect(client,cloud)
        final = client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']
        assert final['status'] == 'ready' and cloud.probes == 1


def test_billing_revision_uses_the_existing_project_and_preserves_parent(environment):
    config,google,db = environment
    cloud = SetupCloud()
    initial_accounts = cloud.billing_accounts
    cloud.billing_accounts = lambda token: initial_accounts(token) + [{'name':'billingAccounts/SECOND-123','displayName':'Otra cuenta','open':True}]
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = client.post(BASE+'/setup',json=body('create',modelTestConsent=False)).json()['operation']
        assert len(cloud.created) == 1
        request = {'requestId':str(uuid4()),'revisionOf':previous['id'],'mode':'existing',
            'projectId':previous['projectId'],'billingAccountName':'billingAccounts/SECOND-123',
            'configurationApproved':True,'modelTestConsent':True}
        bad = {**request,'mode':'create'}
        assert client.post(BASE+'/setup',json=bad).status_code == 400
        final = client.post(BASE+'/setup',json=request).json()['operation']
        assert final['status'] == 'ready' and final['revisionOf'] == previous['id']
        assert len(cloud.created) == cloud.probes == 1
        assert cloud.linked[previous['projectId']] == 'billingAccounts/SECOND-123'
        with db.connect() as c:
            assert c.execute('SELECT billing_account_name FROM google_setup_operations WHERE id=%s',(previous['id'],)).fetchone()['billing_account_name'] == 'billingAccounts/TEST-123'


def test_recovery_links_are_official_and_step_specific(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = client.post(BASE+'/setup',json=body(modelTestConsent=False)).json()['operation']
        for step, expected in [('billing','billing'),('services','api'),('permissions','permissions')]:
            with db.connect() as c:
                c.execute("UPDATE google_setup_operations SET step=%s,status='action_required',error_code='configuration_incomplete' WHERE id=%s",(step,previous['id']))
            recovered = client.get(BASE+'/setup').json()['operation']['recovery']
            assert recovered['kind'] == expected
            assert recovered['url'].startswith('https://console.cloud.google.com/')
            assert 'authuser=one%40example.test' in recovered['url']


def test_daily_limit_applies_to_new_retry_and_has_a_clear_message(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        previous = unknown(client,cloud)
        for _ in range(4):
            assert client.post(BASE+'/setup',json=body(modelTestConsent=False)).status_code == 200
        response = client.post(BASE+'/setup',json=retry(previous))
        assert response.status_code == 429
        assert 'cinco preparaciones en 24 horas' in response.json()['message']
        assert cloud.probes == 1
