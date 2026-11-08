"""Una identidad Google: rechazo en callback y aislamiento de conexiones heredadas."""
from uuid import uuid4
import pytest
from urllib.parse import parse_qs, urlparse
from conftest import client_for
from test_google_cloud import Cloud
from test_google_drive import Drive
from test_uony import ready, Agent
from app.google_cloud_provider import GoogleCloudProvider


@pytest.mark.parametrize('name,provider_type',[('cloud',Cloud),('drive',Drive)])
def test_verified_subject_required_even_when_email_matches(environment,name,provider_type):
    config,google,db=environment; provider=provider_type()
    with client_for(config,google,**{name:provider}) as client:
        ready(client,google,db)
        base='/api/connections/google-'+name
        provider.subject='different-subject'  # Mismo correo no acredita la identidad.
        start=client.post(base+'/start',json={'popup':True}).json()
        assert provider.login_hint==google.subject
        response=client.get('/api/auth/google/callback',params={'state':provider.state,'code':'fixture'})
        assert response.status_code==200 and 'misma cuenta de Google' in response.text
        assert client.get(base+'/flows/'+start['flowId']).json()=={'status':'error','error':'account_mismatch'}
        assert client.get(base).json()['connection']['status']=='disconnected'
        assert client.get('/api/auth/session').json()['email']==google.email
        # La identidad estable sigue siendo válida si Google actualiza el correo.
        provider.subject=google.subject;provider.email='updated@example.test'
        start=client.post(base+'/start',json={'popup':True}).json()
        client.get('/api/auth/google/callback',params={'state':provider.state,'code':'fixture'})
        assert client.get(base+'/flows/'+start['flowId']).json()=={'status':'success'}
        provider.subject='other-again'
        start=client.post(base+'/start',json={'popup':True}).json()
        client.get('/api/auth/google/callback',params={'state':provider.state,'code':'fixture'})
        assert client.get(base).json()['connection']['email']=='updated@example.test'


@pytest.mark.parametrize('status',['connected','account_mismatch'])
def test_legacy_mixed_connections_cannot_consume_or_expose_resources(environment,status):
    config,google,db=environment;cloud=Cloud();drive=Drive();agent=Agent()
    with client_for(config,google,cloud=cloud,drive=drive,uony=agent) as client:
        ready(client,google,db)
        for name in ['cloud','drive']:
            with db.connect() as c:
                user=c.execute('SELECT id FROM users').fetchone()['id']
                # El refresh es deliberadamente inválido: ninguna ruta debe intentar descifrarlo.
                c.execute(f"INSERT INTO google_{name}_connections(user_id,google_subject,email,refresh_encrypted,scope,status) VALUES(%s,'foreign-sub','foreign@example.test','not-a-token','fixture',%s)",(user,status))
            assert client.get('/api/connections/google-'+name).json()['connection']=={'status':'disconnected'}
        actions=[
            client.get('/api/connections/google-cloud/projects'),
            client.put('/api/connections/google-cloud/project',json={'projectId':'customer-project'}),
            client.get('/api/connections/google-drive/files'),
            client.post('/api/connections/google-drive/materials',json={'fileId':'document'}),
            client.get('/api/connections/google-drive/materials/document/content'),
            client.post('/api/connections/google-drive/upload',params={'name':'File.txt','requestId':str(uuid4())},content=b'test',headers={'Content-Type':'text/plain'}),
            client.post('/api/uony/messages',json={'requestId':str(uuid4()),'threadId':'test','text':'Hola'}),
        ]
        for response in actions:
            assert response.status_code==409,response.text
            assert 'account_mismatch' in response.text
        assert client.get('/api/connections/google-drive/materials').json()['files']==[]
        assert client.get('/api/uony/options').json()['models']==[]
        services=client.get('/api/uony/services').json()
        assert services['googleCloud']=='disconnected' and services['drive']=='disconnected'
        assert services['googleCloudEmail'] is None and services['driveEmail'] is None
        assert services['projectId'] is None and not services['projectReady']
        assert cloud.calls==drive.calls==agent.calls==0
        assert client.get('/api/auth/session').json()['email']==google.email
        assert client.get('/api/billing/workspace-access').json()['status']=='allowed'


def test_provider_uses_session_subject_as_google_hint(environment):
    config,_,_=environment
    query=parse_qs(urlparse(GoogleCloudProvider(config).authorization_url('state','nonce','verifier',login_hint='stable-sub')).query)
    assert query['login_hint']==['stable-sub']
    assert query['prompt']==['consent']
