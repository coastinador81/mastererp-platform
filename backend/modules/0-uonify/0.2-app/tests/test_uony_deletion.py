from uuid import uuid4
from conftest import client_for, login
from test_uony import ready


def seed(client, google, db):
    ready(client, google, db)
    project={'id':str(uuid4()),'name':'Proyecto temporal'}
    client.post('/api/uony/projects',json=project)
    with db.connect() as c:
        user=c.execute('SELECT id FROM users').fetchone()['id']
        for thread,group in [('inside',project['id']),('outside',None)]:
            c.execute('INSERT INTO uony_threads(user_id,id,project_id,title) VALUES(%s,%s,%s,%s)',(user,thread,group,'Título privado'))
            c.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,status,model,project_id) VALUES(%s,%s,%s,'Contenido privado','Respuesta privada','success','fixture','fixture')",(user,uuid4(),thread))
    return project


def test_delete_thread_scrubs_content_preserves_quota_and_prevents_resurrection(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        project=seed(client,google,db)
        for _ in range(2):
            assert client.delete('/api/uony/threads/inside').json()=={'deleted':True,'threadIds':['inside']}
        assert [t['id'] for t in client.get('/api/uony/threads').json()['threads']]==['outside']
        assert client.get('/api/uony/projects').json()['projects']==[project]
        assert client.post('/api/uony/messages',json={'requestId':str(uuid4()),'threadId':'inside','text':'Reintento','projectId':project['id']}).status_code==410
        with db.connect() as c:
            rows=c.execute("SELECT prompt,reply FROM uony_requests WHERE thread_id='inside'").fetchall()
            assert len(rows)==1 and rows[0]=={'prompt':'','reply':None}
            assert c.execute("SELECT title,deleted_at FROM uony_threads WHERE id='inside'").fetchone()['deleted_at']
    with client_for(config,google) as client:
        login(client,google)
        assert [t['id'] for t in client.get('/api/uony/threads').json()['threads']]==['outside']


def test_delete_project_cascades_only_its_threads_and_cannot_be_recreated(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        project=seed(client,google,db)
        for _ in range(2):
            response=client.delete('/api/uony/projects/'+project['id'])
            assert response.status_code==200 and response.json()['threadIds']==['inside']
        assert client.get('/api/uony/projects').json()=={'projects':[]}
        assert [t['id'] for t in client.get('/api/uony/threads').json()['threads']]==['outside']
        assert client.post('/api/uony/projects',json=project).status_code==410
        assert client.post('/api/uony/messages',json={'requestId':str(uuid4()),'threadId':'new','text':'Nuevo','projectId':project['id']}).status_code==404
        with db.connect() as c:
            assert c.execute("SELECT prompt FROM uony_requests WHERE thread_id='outside'").fetchone()['prompt']=='Contenido privado'


def test_delete_requires_session_origin_and_ownership_but_not_subscription(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        assert client.delete('/api/uony/threads/inside').status_code==401
        project=seed(client,google,db)
        for path in ['/api/uony/threads/inside','/api/uony/projects/'+project['id']]:
            assert client.delete(path,headers={'Origin':'https://other.example'}).status_code==403
        google.subject='other';google.email='other@example.test';login(client,google)
        for path in ['/api/uony/threads/inside','/api/uony/projects/'+project['id']]:
            assert client.delete(path).status_code==404
        google.subject='google-test-one';google.email='one@example.test';login(client,google)
        with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.delete('/api/uony/projects/'+project['id']).status_code==200


def test_cannot_delete_inflight_response_and_project_deletion_is_atomic(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        project=seed(client,google,db)
        with db.connect() as c:c.execute("UPDATE uony_requests SET status='running' WHERE thread_id='inside'")
        for path in ['/api/uony/threads/inside','/api/uony/projects/'+project['id']]:
            response=client.delete(path)
            assert response.status_code==409 and response.json()['error']=='thread_busy'
        assert client.get('/api/uony/projects').json()['projects']==[project]
        with db.connect() as c:
            assert c.execute("SELECT prompt FROM uony_requests WHERE thread_id='inside'").fetchone()['prompt']=='Contenido privado'
            c.execute("UPDATE uony_requests SET status='success' WHERE thread_id='inside'")
        assert client.delete('/api/uony/projects/'+project['id']).status_code==200
