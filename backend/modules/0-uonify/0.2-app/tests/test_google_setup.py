"""The first Google call is fake; no test talks to a customer provider."""
from uuid import uuid4
from psycopg.types.json import Jsonb
from conftest import client_for, login
from test_subscription import complete
from test_google_cloud import Cloud, connect, allow
from test_google_drive import Drive
from app.google_cloud_provider import CloudError

BASE = '/api/connections/google-cloud'


class SetupCloud(Cloud):
    def __init__(self):
        super().__init__()
        self.saved = {'customer-project':{'id':'customer-project','name':'Mi proyecto','resource':'projects/12345'}}
        self.created = []
        self.linked = {}
        self.enabled = set()
        self.probes = 0
        self.probe_error = None
        self.accesses = 0
        self.access_error = None
        self.async_create = False
        self.done = False

    def billing_accounts(self, token):
        return [{'name':'billingAccounts/TEST-123','displayName':'Facturación propia','open':True}]

    def project(self, token, identifier):
        return self.saved.get(identifier)

    def create_project(self, token, identifier):
        assert identifier not in self.created
        self.created.append(identifier)
        if not self.async_create:
            self.saved[identifier] = {'id':identifier,'name':'Uonify','resource':'projects/777'}
        return 'operations/cp.123'

    def operation(self, token, name):
        if self.done or not self.async_create:
            identifier = self.created[0]
            self.saved[identifier] = {'id':identifier,'name':'Uonify','resource':'projects/777'}
        return self.done or not self.async_create

    def billing_info(self, token, identifier):
        return {'name':self.linked.get(identifier),'enabled':identifier in self.linked}

    def link_billing(self, token, identifier, name):
        self.linked[identifier] = name

    def enable_vertex(self, token, resource):
        self.enabled.add(resource)

    def check(self, token, project):
        ready = project['id'] in self.linked and project['resource'] in self.enabled
        return {'ready':ready,'billing':'enabled' if project['id'] in self.linked else 'missing',
                'vertex':'enabled' if project['resource'] in self.enabled else 'missing','permissions':'enabled','credits':'unverified'}

    def probe_model(self, token, identifier):
        self.probes += 1
        if self.probe_error:
            raise CloudError(self.probe_error)
        return {'calls':1,'totalTokenCount':8}

    def check_model_access(self, token, identifier):
        self.accesses += 1
        if self.access_error:
            raise self.access_error
        return {'totalTokens':8}


def body(mode='existing', **values):
    return {'requestId':str(uuid4()),'mode':mode,'configurationApproved':True,
        **({'projectId':'customer-project'} if mode == 'existing' else {}),
        'billingAccountName':'billingAccounts/TEST-123','modelTestConsent':True,**values}


def start(client, google, cloud):
    login(client,google)
    complete(client)
    assert connect(client,cloud).headers['location'].endswith('?cloud=return')


def test_before_payment_setup_is_allowed_but_files_and_work_are_not(environment):
    config,google,db = environment
    cloud, drive = SetupCloud(), Drive()
    with client_for(config,google,cloud=cloud,drive=drive) as client:
        start(client,google,cloud)
        assert client.get(BASE+'/projects').status_code == 200
        assert client.get(BASE+'/billing-accounts').json()['accounts'][0]['open'] is True
        assert client.post('/api/connections/google-drive/start').status_code == 200
        assert client.get('/api/auth/google/callback',params={'state':drive.state,'code':'fixture'}).status_code == 303
        assert client.get('/api/connections/google-drive/files').status_code == 403
        assert client.post('/api/uony/messages',json={'requestId':str(uuid4()),'threadId':'start','text':'Hola'}).status_code == 403
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 0


def test_create_resume_uses_same_project_and_one_consented_probe(environment):
    config,google,db = environment
    cloud = SetupCloud()
    cloud.async_create = True
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        client.post('/api/connections/google-drive/defer')
        request = body('create')
        first = client.post(BASE+'/setup',json=request)
        assert first.status_code == 200, first.text
        operation = first.json()['operation']
        assert operation['status'] == 'preparing' and operation['projectId'].startswith('uonify-')
        assert cloud.probes == 0 and len(cloud.created) == 1
        assert client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']['status'] == 'preparing'
        cloud.done = True
        final = client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()
        assert final['operation']['status'] == 'ready' and final['operation']['modelTest'] == 'passed'
        assert final['connection']['projectId'] == operation['projectId']
        assert len(cloud.created) == cloud.probes == 1
        assert client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']['status'] == 'ready'
        assert cloud.probes == 1
        state = client.get('/api/onboarding/setup').json()
        assert state['setupReady'] is True and state['step'] == 'subscription'
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        with db.connect() as c:
            row = c.execute('SELECT * FROM google_setup_operations').fetchone()
            assert row['model_consented_at'] and row['configuration_approved_at'] and row['lease_until'] is None


def test_no_model_consumption_until_explicit_consent_and_reuse_after_reconnect(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request = body(modelTestConsent=False)
        first = client.post(BASE+'/setup',json=request).json()
        assert first['operation']['step'] == 'model' and first['operation']['status'] == 'action_required'
        assert cloud.probes == 0
        ready = client.post(BASE+'/setup',json={'requestId':request['requestId'],'modelTestConsent':True}).json()
        assert ready['operation']['status'] == 'ready' and cloud.probes == 1
        before = client.get(BASE).json()['connection']
        assert connect(client,cloud).status_code == 303
        assert client.get(BASE).json()['connection']['projectId'] == before['projectId']
        client.post(BASE+'/setup',json=body(modelTestConsent=False))
        assert cloud.probes == 1


def test_uncertain_probe_is_not_repeated_by_same_or_new_request(environment):
    config,google,db = environment
    cloud = SetupCloud()
    cloud.probe_error = 'google_unavailable'
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request = body()
        failed = client.post(BASE+'/setup',json=request).json()['operation']
        assert failed['status'] == failed['modelTest'] == 'unknown'
        cloud.probe_error = None
        for retry in ({'requestId':request['requestId']},body()):
            response = client.post(BASE+'/setup',json=retry).json()['operation']
            assert response['status'] == 'unknown' and response['canResume'] is False
        assert cloud.probes == 1
        assert client.get('/api/onboarding/setup').json()['aiReady'] is False


def test_state_intent_and_existing_paid_account_are_preserved(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM onboarding_setup_states').fetchone()['n'] == 0
        state = client.put('/api/onboarding/setup',json={'firstIntent':'Crear Basic Mini Bricks desde Drive'}).json()
        assert state['firstIntent'].startswith('Crear Basic')
        client.post('/api/connections/google-drive/defer')
        allow(db)
        client.post(BASE+'/setup',json=body())
        assert client.post('/api/onboarding/complete').status_code == 200
        assert client.get('/api/onboarding/setup').json()['step'] == 'complete'
        assert cloud.probes == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 1


def test_origin_identity_approval_and_request_binding(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        assert client.post(BASE+'/setup',json=body(),headers={'Origin':'null'}).status_code == 403
        assert client.post(BASE+'/setup',json=body(configurationApproved=False)).status_code == 400
        request = body(modelTestConsent=False)
        assert client.post(BASE+'/setup',json=request).status_code == 200
        assert client.post(BASE+'/setup',json={**request,'projectId':'other-project'}).status_code == 409
        google.subject = 'another-person'; google.email = 'other@example.test'
        login(client,google); complete(client)
        connect(client,cloud)  # Wrong OAuth sub is rejected, never replaces account state.
        assert client.get(BASE).json()['connection']['status'] == 'disconnected'
        assert cloud.probes == 0
        assert client.get('/api/onboarding/setup').json()['firstIntent'] == ''


def test_crashed_model_call_becomes_unknown_on_status_without_replay(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request = body(modelTestConsent=False)
        assert client.post(BASE+'/setup',json=request).status_code == 200
        with db.connect() as c:
            c.execute('''UPDATE google_setup_operations SET status='preparing',model_test='pending',
                model_consented_at=now(),lease_until=now()-interval '1 second' WHERE id=%s''',(request['requestId'],))
        operation = client.get(BASE+'/setup').json()['operation']
        assert operation['status'] == operation['modelTest'] == 'unknown'
        assert operation['canResume'] is False and cloud.probes == 0
        assert client.get('/api/onboarding/setup').json()['aiReady'] is False
        with db.connect() as c:
            assert c.execute('SELECT model_test FROM google_setup_operations').fetchone()['model_test'] == 'unknown'


def test_real_adapter_creates_before_get_and_links_empty_billing(environment, monkeypatch):
    from app.google_cloud_provider import GoogleCloudProvider, PERMISSIONS
    from app import google_setup_provider
    from test_google_setup_provider import Response
    config,google,db = environment
    oauth = Cloud()
    cloud = GoogleCloudProvider(config)
    cloud.authorization_url, cloud.exchange, cloud.refresh = oauth.authorization_url, oauth.exchange, oauth.refresh
    calls, state = [], {'created':False,'billing':None,'vertex':False}
    def http(method,url,**kwargs):
        calls.append((method,url))
        if url.endswith('/v3/projects') and method == 'POST':
            state['created'] = True
            state['id'] = kwargs['json']['projectId']
            return Response({'name':'operations/cp.123','done':True})
        if '/v3/operations/' in url:
            return Response({'done':True})
        if '/v3/projects/' in url:
            if not state['created']:
                return Response(code=403)
            return Response({'projectId':state['id'],'displayName':'Uonify','name':'projects/777','state':'ACTIVE'})
        if url.endswith('/billingInfo'):
            if method == 'PUT':
                state['billing'] = kwargs['json']['billingAccountName']
            return Response({'billingEnabled':bool(state['billing']),
                **({'billingAccountName':state['billing']} if state['billing'] else {})})
        if url.endswith('/billingAccounts'):
            return Response({'billingAccounts':[{'name':'billingAccounts/TEST-123','open':True}]})
        if url.endswith(':testIamPermissions'):
            return Response({'permissions':PERMISSIONS})
        if '/services/aiplatform.googleapis.com' in url:
            if method == 'POST':
                state['vertex'] = True
            return Response({'state':'ENABLED' if state['vertex'] else 'DISABLED'})
        if url.endswith(':generateContent'):
            return Response({'candidates':[{'content':{'parts':[{'text':'Listo.'}]}}],
                             'usageMetadata':{'totalTokenCount':8}})
        if url.endswith(':countTokens'):
            return Response({'totalTokens':2})
        raise AssertionError((method,url))
    monkeypatch.setattr(google_setup_provider.requests,'request',http)
    with client_for(config,google,cloud=cloud) as client:
        login(client,google); complete(client)
        assert connect(client,oauth).status_code == 303
        request = body('create')
        response = client.post(BASE+'/setup',json=request)
        assert response.status_code == 200, response.text
        assert response.json()['operation']['status'] == 'ready'
        assert calls[0] == ('POST','https://cloudresourcemanager.googleapis.com/v3/projects')
        assert state['billing'] == 'billingAccounts/TEST-123'
        assert sum(url.endswith('/v3/projects') and method == 'POST' for method,url in calls) == 1
        assert sum(url.endswith(':generateContent') for _,url in calls) == 1
        client.post(BASE+'/setup',json={'requestId':request['requestId']})
        assert sum(url.endswith(':generateContent') for _,url in calls) == 1


def test_interrupted_creation_retries_only_the_reserved_id_after_confirmed_absence(environment):
    config,google,db = environment
    cloud = SetupCloud()
    actual_create, attempts = cloud.create_project, []
    def interrupted(token, identifier):
        attempts.append(identifier)
        if len(attempts) == 1:
            raise CloudError('google_unavailable')
        return actual_create(token,identifier)
    cloud.create_project = interrupted
    with client_for(config,google,cloud=cloud) as client:
        start(client,google,cloud)
        request = body('create')
        first = client.post(BASE+'/setup',json=request).json()['operation']
        assert first['status'] == 'action_required'
        assert client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']['status'] == 'preparing'
        final = client.post(BASE+'/setup',json={'requestId':request['requestId']}).json()['operation']
        assert final['status'] == 'ready' and final['projectId'] == first['projectId']
        assert len(set(attempts)) == 1 and len(cloud.created) == cloud.probes == 1
