from uuid import uuid4
from conftest import client_for,login
from test_uony import ready,Agent
from test_google_cloud import Cloud
from cryptography.fernet import Fernet
from psycopg.types.json import Jsonb


def test_projects_validation_persistence_retry_and_access(environment):
    config,google,db=environment
    project={'id':str(uuid4()),'name':'Colección otoño'}
    with client_for(config,google) as client:
        assert client.get('/api/uony/projects').status_code==401
        assert client.post('/api/uony/projects',json=project).status_code==401
        ready(client,google,db)
        assert client.post('/api/uony/projects',json=project,headers={'Origin':'null'}).status_code==403
        for name in [' ', 'a'*81]:
            assert client.post('/api/uony/projects',json={**project,'name':name}).status_code==400
        for _ in range(2):assert client.post('/api/uony/projects',json=project).json()==project
        assert client.post('/api/uony/projects',json={**project,'name':'Otro nombre'}).status_code==409
        assert client.get('/api/uony/projects').json()=={'projects':[project]}
    with client_for(config,google) as client:
        login(client,google)
        assert client.get('/api/uony/projects').json()=={'projects':[project]}
        with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.post('/api/uony/projects',json={'id':str(uuid4()),'name':'Otro'}).status_code==403
        assert client.get('/api/uony/projects').json()=={'projects':[project]}
        google.subject='other';google.email='other@example.test';login(client,google)
        assert client.get('/api/uony/projects').json()=={'projects':[]}


def test_thread_project_association_and_cross_account_protection(environment):
    config,google,db=environment;agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent) as client:
        ready(client,google,db)
        project={'id':str(uuid4()),'name':'Producto de prueba'}
        assert client.post('/api/uony/projects',json=project).status_code==200
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            c.execute("INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check) VALUES(%s,'google-test-one','one@example.test',%s,'cloud-platform','project-fixture',%s)",(user,Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),Jsonb({'ready':True})))
            c.execute("INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,'project-fixture','google-test-one','gemini-3.5-flash','medium')",(user,))
        body={'requestId':str(uuid4()),'threadId':'project-thread','text':'Hola','projectId':project['id']}
        assert client.post('/api/uony/messages',json={**body,'projectId':str(uuid4())}).status_code==404
        assert agent.calls==0
        assert client.post('/api/uony/messages',json=body).status_code==200
        thread=client.get('/api/uony/threads').json()['threads'][0]
        assert thread['projectId']==project['id'] and len(thread['messages'])==2
        assert client.post('/api/uony/messages',json={**body,'projectId':None}).status_code==409
        assert client.post('/api/uony/messages',json={**body,'requestId':str(uuid4()),'projectId':None}).status_code==409
        assert agent.calls==1
        google.subject='other';google.email='other@example.test';ready(client,google,db)
        assert client.post('/api/uony/messages',json=body).status_code==404
        assert client.get('/api/uony/threads').json()=={'threads':[]}
        assert agent.calls==1
