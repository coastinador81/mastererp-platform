from uuid import uuid4
from urllib.parse import parse_qs, urlparse
from conftest import client_for, login
from test_subscription import complete
from app.google_cloud_provider import CloudError, SCOPE, GoogleCloudProvider


class Cloud:
    def __init__(self):
        self.subject='google-test-one'; self.email='one@example.test'
        self.fail = None
        self.calls = 0

    def authorization_url(self, state, nonce, verifier, login_hint=None):
        self.state,self.nonce,self.verifier=state,nonce,verifier
        self.login_hint=login_hint
        return 'https://accounts.google.com/o/oauth2/v2/auth?state='+state

    def exchange(self, code, nonce, verifier):
        assert nonce==self.nonce and verifier==self.verifier
        return {'subject':self.subject,'email':self.email,'refresh':'fixture-refresh-only','scope':SCOPE}

    def refresh(self, refresh):
        self.calls+=1
        assert refresh=='fixture-refresh-only'
        if self.fail: raise CloudError(self.fail)
        return 'fixture-access-only'

    def projects(self, token):
        return [{'id':'customer-project','name':'Proyecto del cliente','resource':'projects/12345'}]

    def check(self, token, project):
        assert project['id']=='customer-project'
        return {'billing':'enabled','vertex':'missing','permissions':'enabled','credits':'unverified','ready':False}


def allow(db):
    with db.connect() as c:
        user=c.execute('SELECT id FROM users LIMIT 1').fetchone()
        c.execute("INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference) VALUES(%s,%s,'trial',now(),now()+interval '14 days',%s)", (uuid4(),user['id'],'fixture-'+str(uuid4())))


def connect(client, cloud):
    assert client.post('/api/connections/google-cloud/start').status_code==200
    return client.get('/api/auth/google/callback',params={'state':cloud.state,'code':'fixture-code'})


def test_cloud_binding_encryption_selection_and_disconnect(environment):
    config, google, db=environment
    cloud=Cloud()
    with client_for(config,google,cloud=cloud) as client:
        assert client.get('/api/connections/google-cloud').status_code==401
        login(client,google); complete(client)
        assert client.post('/api/connections/google-cloud/start').status_code==200
        allow(db)
        assert client.post('/api/connections/google-cloud/start',headers={'Origin':'null'}).status_code==403
        assert connect(client,cloud).headers['location'].endswith('?cloud=return')
        assert client.get('/api/auth/session').json()['email']=='one@example.test'
        payload=client.get('/api/connections/google-cloud').json()
        assert payload['connection']['email']=='one@example.test'
        assert 'fixture-refresh' not in str(payload)
        with db.connect() as c:
            assert c.execute('SELECT refresh_encrypted FROM google_cloud_connections').fetchone()['refresh_encrypted']!='fixture-refresh-only'
        assert client.get('/api/connections/google-cloud/projects').json()['projects'][0]['id']=='customer-project'
        assert client.put('/api/connections/google-cloud/project',json={'projectId':'another-project'}).status_code==403
        assert client.put('/api/connections/google-cloud/project',json={'projectId':'../../secrets'}).status_code==400
        result=client.put('/api/connections/google-cloud/project',json={'projectId':'customer-project'})
        assert result.json()['connection']['checks']['ready'] is False
        assert result.json()['connection']['checks']['credits']=='unverified'
        assert client.get('/api/connections/google-cloud').json()['connection']['projectId']=='customer-project'
        cloud.fail='reauthorize'
        assert client.get('/api/connections/google-cloud/projects').status_code==409
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='reauthorize'
        with db.connect() as c: c.execute("UPDATE access_periods SET ends_at=now()")
        previous=cloud.calls
        # Preparation is recoverable before/after payment; normal use is still blocked.
        assert client.get('/api/connections/google-cloud/projects').status_code==409
        assert cloud.calls==previous+1
        assert client.delete('/api/connections/google-cloud').status_code==200
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='disconnected'
        assert client.get('/api/auth/session').json()['authenticated'] is True


def test_oauth_requires_same_session_and_is_single_use(environment):
    config, google, db=environment; cloud=Cloud()
    with client_for(config,google,cloud=cloud) as client:
        login(client,google); complete(client); allow(db)
        assert connect(client,cloud).headers['location'].endswith('?cloud=return')
        assert client.get('/api/auth/google/callback',params={'state':cloud.state,'code':'fixture'}).headers['location'].endswith('invalid_state')
        client.post('/api/connections/google-cloud/start')
        state=cloud.state
        google.subject='other-user';google.email='other@example.test';login(client,google)
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='disconnected'
        assert client.get('/api/auth/google/callback',params={'state':state,'code':'fixture'}).headers['location'].endswith('invalid_state')
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='disconnected'


def test_denied_google_authorization_and_cloud_scopes(environment):
    config,google,db=environment;cloud=Cloud()
    real=GoogleCloudProvider(config)
    query=parse_qs(urlparse(real.authorization_url('state','nonce','verifier')).query)
    assert query['scope']==['openid email '+SCOPE]
    assert query['redirect_uri']==[config.callback]
    assert query['access_type']==['offline']
    assert query['code_challenge_method']==['S256']
    with client_for(config,google,cloud=cloud) as client:
        login(client,google);complete(client);allow(db)
        client.post('/api/connections/google-cloud/start')
        response=client.get('/api/auth/google/callback',params={'state':cloud.state,'error':'access_denied'})
        assert response.headers['location'].endswith('?cloud=denied')
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='disconnected'


def test_project_checks_do_not_invent_credit_or_ready_on_failure(environment):
    config,_,_=environment;provider=GoogleCloudProvider(config)
    def denied(*args,**kwargs): raise CloudError('permission_denied')
    provider.request=denied
    result=provider.check('fixture-access',{'id':'customer-project','resource':'projects/12345'})
    assert result=={'billing':'unknown','vertex':'unknown','permissions':'unknown','credits':'unverified','ready':False}


def test_popup_completion_is_bound_to_session_and_contains_no_tokens(environment):
    config, google, db = environment; cloud = Cloud()
    with client_for(config, google, cloud=cloud) as client:
        login(client, google); complete(client); allow(db)
        started = client.post('/api/connections/google-cloud/start', json={'popup': True}).json()
        flow = started['flowId']
        assert client.get('/api/connections/google-cloud/flows/'+flow).json() == {'status':'pending'}
        response = client.get('/api/auth/google/callback', params={'state':cloud.state,'code':'fixture-code'})
        assert response.status_code == 200
        assert 'window.close()' in response.text
        assert 'fixture-' not in response.text
        assert "default-src 'none'" in response.headers['content-security-policy']
        assert client.get('/api/connections/google-cloud/flows/'+flow).json() == {'status':'success'}
        google.subject='other-user'; google.email='other@example.test'; login(client,google)
        assert client.get('/api/connections/google-cloud/flows/'+flow).status_code == 404


def test_popup_cancel_invalidates_attempt_and_denial_reports_error(environment):
    config, google, db = environment; cloud = Cloud()
    with client_for(config, google, cloud=cloud) as client:
        login(client, google); complete(client); allow(db)
        flow = client.post('/api/connections/google-cloud/start', json={'popup':True}).json()['flowId']
        assert client.delete('/api/connections/google-cloud/flows/'+flow, headers={'Origin':'null'}).status_code==403
        assert client.delete('/api/connections/google-cloud/flows/'+flow).json()['cancelled'] is True
        client.get('/api/auth/google/callback', params={'state':cloud.state,'code':'fixture-code'})
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='disconnected'
        flow = client.post('/api/connections/google-cloud/start', json={'popup':True}).json()['flowId']
        denied = client.get('/api/auth/google/callback', params={'state':cloud.state,'error':'access_denied'})
        assert denied.status_code==200
        assert 'No se ha completado' in denied.text
        assert client.get('/api/connections/google-cloud/flows/'+flow).json()['status']=='error'
        with db.connect() as c: c.execute("UPDATE cloud_popup_flows SET expires_at=now()-interval '1 minute'")
        assert client.get('/api/connections/google-cloud/flows/'+flow).status_code==404


def test_popup_expired_cancelled_and_missing_cookie_never_redirect_to_onboarding(environment):
    from test_google_drive import Drive
    config, google, db = environment
    for name, provider in [('cloud', Cloud()), ('drive', Drive())]:
        with client_for(config, google, **{name:provider}) as client:
            login(client,google); complete(client)
            if name == 'cloud': allow(db)
            base='/api/connections/google-'+name
            for failure in ('expired','cookie','cancelled','removed'):
                started=client.post(base+'/start',json={'popup':True}).json()
                state=provider.state
                assert state.startswith(name+'_popup_')
                if failure in ('expired','removed'):
                    with db.connect() as c:
                        # Nombres de tabla internos, sin datos de usuario.
                        c.execute(f"UPDATE {name}_oauth_attempts SET expires_at=now()-interval '1 minute'")
                        c.execute(f"UPDATE {name}_popup_flows SET expires_at=now()-interval '1 minute'")
                        if failure=='removed': c.execute(f'DELETE FROM {name}_popup_flows')
                elif failure=='cookie': client.cookies.delete('uonify_'+name+'_oauth')
                else: client.delete(base+'/flows/'+started['flowId'])
                response=client.get('/api/auth/google/callback',params={'state':state,'code':'fixture'})
                assert response.status_code==200
                assert 'location' not in response.headers
                assert 'window.close()' in response.text
                assert 'No se ha completado' in response.text
                assert 'BroadcastChannel' in response.text
                assert client.get(base).json()['connection']['status']=='disconnected'
