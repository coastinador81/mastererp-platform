from uuid import uuid4
from urllib.parse import urlparse, parse_qs
from conftest import client_for, login
from test_subscription import complete
from test_google_cloud import Cloud, allow
from app.google_cloud_provider import CloudError
from app.google_drive_provider import GoogleDriveProvider, FOLDER

BASE='/api/connections/google-drive'
class Drive(Cloud):
    def __init__(self):
        super().__init__(); self.upload_ids=[]; self.reserved=0
    def exchange(self, code, nonce, verifier):
        result=super().exchange(code,nonce,verifier)
        return {**result,'subject':self.subject,'scope':' '.join(GoogleDriveProvider.scopes)}
    def files(self, token, parent, page, search):
        return {'files':[{'id':'document','name':'Producto.txt','mimeType':'text/plain'}], 'nextPageToken':'next-page'}
    def metadata(self, token, identifier):
        if identifier=='forbidden': raise CloudError('permission_denied')
        return {'id':identifier,'name':'Producto.txt','mimeType': FOLDER if identifier=='folder' else 'text/plain'}
    def content(self, token, identifier):
        if self.fail: raise CloudError(self.fail)
        return b'Producto de prueba','text/plain','Producto.txt'
    def folder(self, token): return 'uonify-folder'
    def reserve_id(self, token):
        self.reserved+=1; return 'upload-'+str(self.reserved)
    def upload(self, token, folder, identifier, name, mime, content):
        self.upload_ids.append(identifier)
        return {'id':identifier,'name':name,'mimeType':mime,'size':str(len(content))}


def connect(client, drive):
    start=client.post(BASE+'/start',json={'popup':True})
    assert start.status_code==200
    response=client.get('/api/auth/google/callback',params={'state':drive.state,'code':'fixture'})
    assert response.status_code==200
    assert client.get(BASE+'/flows/'+start.json()['flowId']).json()=={'status':'success'}


def test_drive_selection_access_persistence_and_disconnect(environment):
    config,google,db=environment; drive=Drive()
    with client_for(config,google,drive=drive) as client:
        assert client.get(BASE).status_code==401
        login(client,google);complete(client)
        assert client.post(BASE+'/start').status_code==200
        allow(db);connect(client,drive)
        assert client.get('/api/auth/session').json()['email']=='one@example.test'
        assert client.get('/api/connections/google-cloud').json()['connection']['status']=='disconnected'
        assert client.get(BASE+'/files').json()['nextPageToken']=='next-page'
        assert client.get(BASE+'/files?parent=../../etc').status_code==400
        assert client.post(BASE+'/materials',json={'fileId':'document'},headers={'Origin':'null'}).status_code==403
        assert client.post(BASE+'/materials',json={'fileId':'forbidden'}).status_code==503
        assert client.post(BASE+'/materials',json={'fileId':'folder'}).status_code==409
        for _ in range(2): assert client.post(BASE+'/materials',json={'fileId':'document'}).status_code==200
        assert len(client.get(BASE+'/materials').json()['files'])==1
        assert client.get(BASE+'/materials/other/content').status_code==409
        result=client.get(BASE+'/materials/document/content')
        assert result.content==b'Producto de prueba' and 'attachment' in result.headers['content-disposition']
        with db.connect() as c:
            assert c.execute('SELECT refresh_encrypted FROM google_drive_connections').fetchone()['refresh_encrypted']!='fixture-refresh-only'
            c.execute('UPDATE access_periods SET ends_at=now()')
        before=drive.calls
        assert client.get(BASE+'/files').status_code==403
        assert client.get(BASE+'/materials/document/content').status_code==403
        assert drive.calls==before
        assert client.delete(BASE).status_code==200
        with db.connect() as c: assert c.execute('SELECT count(*) AS n FROM drive_materials').fetchone()['n']==1
        assert client.get('/api/auth/session').json()['authenticated']


def test_drive_upload_retry_is_idempotent_and_cannot_change_payload(environment):
    config,google,db=environment;drive=Drive()
    with client_for(config,google,drive=drive) as client:
        login(client,google);complete(client);allow(db);connect(client,drive)
        request_id=str(uuid4()); params={'name':'Ficha.txt','requestId':request_id}; headers={'Content-Type':'text/plain'}
        for _ in range(2):
            response=client.post(BASE+'/upload',params=params,content=b'Producto de prueba',headers=headers)
            assert response.status_code==200,response.text
        assert drive.reserved==1 and drive.upload_ids==['upload-1','upload-1']
        assert len(client.get(BASE+'/materials').json()['files'])==1
        assert client.post(BASE+'/upload',params=params,content=b'Contenido distinto',headers=headers).status_code==409
        assert client.post(BASE+'/upload',params=params,content=b'x',headers={'Content-Type':'text/html'}).status_code==400
        assert client.post(BASE+'/upload',params=params,content=b'',headers=headers).status_code==400
        assert client.post(BASE+'/upload',params=params,content=b'x',headers={**headers,'content-length':str(21*1024*1024)}).status_code==413


def test_drive_oauth_denial_session_binding_and_reauthorization(environment):
    config,google,db=environment;drive=Drive()
    with client_for(config,google,drive=drive) as client:
        login(client,google);complete(client);allow(db)
        start=client.post(BASE+'/start',json={'popup':True}).json()
        client.get('/api/auth/google/callback',params={'state':drive.state,'error':'access_denied'})
        assert client.get(BASE+'/flows/'+start['flowId']).json()=={'status':'error'}
        assert client.get(BASE).json()['connection']['status']=='disconnected'
        connect(client,drive)
        drive.fail='reauthorize'
        assert client.get(BASE+'/files').status_code==409
        assert client.get(BASE).json()['connection']['status']=='reauthorize'
        drive.fail=None;start=client.post(BASE+'/start',json={'popup':True}).json();state=drive.state
        google.subject='other-user';google.email='other@example.test';login(client,google)
        assert client.get(BASE+'/flows/'+start['flowId']).status_code==404
        assert client.get(BASE+'/materials').json()['files']==[]
        assert client.get('/api/auth/google/callback',params={'state':state,'code':'fixture'}).status_code==200
        assert client.get(BASE).json()['connection']['status']=='disconnected'


def test_drive_rejects_another_account_and_preserves_current_materials(environment):
    config,google,db=environment;drive=Drive()
    with client_for(config,google,drive=drive) as client:
        login(client,google);complete(client);allow(db);connect(client,drive)
        client.post(BASE+'/materials',json={'fileId':'document'})
        drive.subject='different-drive'
        start=client.post(BASE+'/start',json={'popup':True}).json()
        client.get('/api/auth/google/callback',params={'state':drive.state,'code':'fixture'})
        assert client.get(BASE+'/flows/'+start['flowId']).json()=={'status':'error','error':'account_mismatch'}
        assert len(client.get(BASE+'/materials').json()['files'])==1
        assert client.get(BASE+'/materials/document/content').status_code==200
        drive.subject=google.subject;connect(client,drive)
        assert len(client.get(BASE+'/materials').json()['files'])==1


def test_drive_scopes_and_escaped_search(environment):
    config,_,_=environment;provider=GoogleDriveProvider(config)
    query=parse_qs(urlparse(provider.authorization_url('drive_state','nonce','verifier')).query)
    assert set(query['scope'][0].split())=={'openid','email',*GoogleDriveProvider.scopes}
    assert 'cloud-platform' not in query['scope'][0]
    captured={}
    def request(token,method,url,body=None,params=None):
        captured.update(params or {});return {'files':[]}
    provider.request=request
    provider.files('fixture',search="x' or trashed=true")
    assert "name contains 'x\\' or trashed=true'" in captured['q']


def test_drive_deferral_persists_without_granting_access_and_is_personal(environment):
    config,google,db=environment;drive=Drive()
    with client_for(config,google,drive=drive) as client:
        assert client.post(BASE+'/defer').status_code==401
        login(client,google)
        assert client.get(BASE).json()['onboardingDeferred'] is False
        assert client.post(BASE+'/defer',headers={'Origin':'null'}).status_code==403
        for _ in range(2): assert client.post(BASE+'/defer').json()=={'onboardingDeferred':True}
        assert client.get(BASE).json()['onboardingDeferred'] is True
        assert client.get(BASE).json()['connection']['status']=='disconnected'
        assert client.post(BASE+'/start').status_code==403
        google.subject='other-user';google.email='other@example.test';login(client,google)
        assert client.get(BASE).json()['onboardingDeferred'] is False
        google.subject='subject-one';google.email='one@example.test'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM drive_onboarding_preferences').fetchone()['n']==1
            assert c.execute('SELECT count(*) AS n FROM google_drive_connections').fetchone()['n']==0
