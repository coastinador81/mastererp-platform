from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import Mock, patch
import pytest
from conftest import client_for, login
from test_uony import ready, Agent
from test_google_cloud import Cloud
from test_products import connect
from test_uony_provider import response
from app.google_cloud_provider import CloudError
from app.uony_provider import UonyProvider, request_payload
from app.uony_context import MODEL_INPUT_LIMITS
from app.uony_models import FLASH, LITE, PRO


class Meter(Agent):
    def __init__(self):
        super().__init__()
        self.counts=[]
        self.value=900000
        self.count_error=None

    def count_tokens(self,token,project,history,status,model=None,effort=None):
        self.counts.append({'history':history,'status':status,'model':model,'effort':effort})
        assert project=='project-fixture'
        if self.count_error:
            raise CloudError(self.count_error)
        return self.value


def seed(connection,user,thread='history',count=15):
    connection.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,'Hilo de prueba')",(user,thread))
    for index in range(count):
        connection.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,status,model,project_id,created_at) VALUES(%s,%s,%s,%s,%s,'success',%s,'project-fixture',%s)",
                           (user,uuid4(),thread,f'Pregunta {index}',f'Respuesta {index}',FLASH,datetime.now(timezone.utc)-timedelta(minutes=count-index)))
    connection.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,project_id) VALUES(%s,%s,%s,'Fallo ignorado','error',%s,'project-fixture')",(user,uuid4(),thread,FLASH))


def test_count_uses_the_exact_initial_generation_payload_without_generating():
    history=[{'role':'user','parts':[{'text':'Mi producto'}]}]
    status={'productContext':{'sku':'OWN','revision':3}}
    with patch('app.uony_provider.requests.post',side_effect=[
        Mock(status_code=200,json=lambda:{'totalTokens':4321}),response([{'text':'Respuesta'}]),
    ]) as post:
        assert UonyProvider().count_tokens('test-token','project-fixture',history,status,model=LITE,effort='high')==4321
        UonyProvider().generate('test-token','project-fixture',history,status,model=LITE,effort='high')
    count,generate=post.call_args_list
    assert count.args[0].endswith('/gemini-3.5-flash-lite:countTokens')
    assert count.kwargs['json']==generate.kwargs['json']==request_payload(history,status,'high')
    assert 'systemInstruction' in count.kwargs['json'] and 'tools' in count.kwargs['json']
    assert 'toolConfig' not in count.kwargs['json']
    assert 'Ficha abierta' in count.kwargs['json']['systemInstruction']['parts'][0]['text']


def test_new_empty_chat_counts_system_and_tools_without_inventing_a_prompt_or_generating(environment):
    config,google,db=environment
    provider=UonyProvider()
    requests=[]

    def google_count(url,**kwargs):
        assert url.endswith('/gemini-3.5-flash:countTokens')
        payload=kwargs['json'];requests.append(payload)
        # Respuesta observada en Google: sin contents devuelve {} e ignora la base.
        return Mock(status_code=200,json=lambda: {'totalTokens':2977} if payload['contents'] else {})

    with client_for(config,google,cloud=Cloud(),uony=provider) as client:
        ready(client,google,db);connect(db,config)
        with patch('app.uony_provider.requests.post',side_effect=google_count):
            result=client.post('/api/uony/context',json={})
            retried=client.post('/api/uony/context',json={})
        assert result.status_code==200,result.text
        assert result.json()['status']==retried.json()['status']=='measured'
        assert result.json()['usedTokens']==2977 and result.json()['historyTurns']==0
        assert len(requests)==2 and requests[0]==requests[1]
        payload=requests[0]
        assert payload['contents']==[{'role':'user','parts':[{'text':''}]}]
        assert payload['systemInstruction']==request_payload([],{},'medium')['systemInstruction']
        assert len(payload['tools'][0]['functionDeclarations'])>1
        assert any(d['name']=='create_product' for d in payload['tools'][0]['functionDeclarations'])
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n']==0
            assert c.execute('SELECT count(*) AS n FROM uony_threads').fetchone()['n']==0


@pytest.mark.parametrize('total',[None,-1,True,'4321',1.5])
def test_count_rejects_invalid_provider_counts(total):
    with patch('app.uony_provider.requests.post',return_value=Mock(status_code=200,json=lambda:{'totalTokens':total})) as post:
        with pytest.raises(CloudError) as error:
            UonyProvider().count_tokens('test','project',[],{})
    assert error.value.code=='invalid_response' and post.call_count==1


@pytest.mark.parametrize('status,code',[(401,'reauthorize'),(403,'permission_denied'),(404,'model_unavailable'),(429,'quota_exceeded'),(500,'google_unavailable')])
def test_count_provider_errors_are_honest_and_never_retried(status,code):
    with patch('app.uony_provider.requests.post',return_value=Mock(status_code=status)) as post:
        with pytest.raises(CloudError) as error:
            UonyProvider().count_tokens('test','project',[],{})
    assert error.value.code==code and post.call_count==1


def test_context_counts_only_last_twelve_success_pairs_and_draft_readonly(environment):
    config,google,db=environment
    meter=Meter()
    with client_for(config,google,cloud=Cloud(),uony=meter) as client:
        ready(client,google,db);connect(db,config)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            seed(c,user)
            seed(c,user,'another',2)
        body={'threadId':'history','text':'Mi borrador','model':'auto','effort':'medium'}
        result=client.post('/api/uony/context',json=body)
        assert result.status_code==200,result.text
        data=result.json()
        assert data['status']=='measured' and data['model']==FLASH
        assert data['usedTokens']==900000 and data['limitTokens']==1048576
        assert data['remainingTokens']==148576 and data['usageRatio']==900000/1048576
        assert data['measurement']=='google_count_tokens' and data['historyTurns']==12
        history=meter.counts[-1]['history']
        assert len(history)==25 and history[0]['parts']==[{'text':'Pregunta 3'}]
        assert history[-2]['parts']==[{'text':'Respuesta 14'}]
        assert history[-1]['parts']==[{'text':'Mi borrador'}]
        assert not any(key.endswith('Email') for key in meter.counts[-1]['status'])
        assert meter.calls==0
        client.post('/api/uony/context',json={**body,'text':''})
        assert len(meter.counts[-1]['history'])==24
        client.post('/api/uony/context',json={'threadId':None})
        assert meter.counts[-1]['history']==[]
        client.post('/api/uony/context',json={'threadId':'new-preview'})
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n']==19
            assert c.execute('SELECT count(*) AS n FROM uony_threads').fetchone()['n']==2


def test_spoken_turns_are_context_for_the_same_thread_without_reexecuting_voice(environment):
    config, google, db = environment
    meter = Meter()
    with client_for(config, google, cloud=Cloud(), uony=meter) as client:
        ready(client, google, db)
        connect(db, config)
        with db.connect() as c:
            user = c.execute('SELECT id FROM users').fetchone()['id']
            seed(c, user, 'spoken-thread', 0)
            session = uuid4()
            for role, text in (('user', 'Quiero preparar una lámpara'),
                               ('assistant', '¿Tienes fotos o empezamos desde cero?')):
                c.execute('''INSERT INTO uony_live_turns
                    (user_id,thread_id,session_id,turn_id,role,text)
                    VALUES(%s,%s,%s,%s,%s,%s)''',
                    (user, 'spoken-thread', session, uuid4(), role, text))
        measured = client.post('/api/uony/context', json={
            'threadId': 'spoken-thread', 'text': 'Tengo fotos', 'model': 'auto',
            'effort': 'medium'})
        assert measured.status_code == 200, measured.text
        history = meter.counts[-1]['history']
        assert [turn['parts'][0]['text'] for turn in history] == [
            'Quiero preparar una lámpara', '¿Tienes fotos o empezamos desde cero?',
            'Tengo fotos']
        assert measured.json()['historyTurns'] == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 1
            assert c.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 0


def test_context_resolves_current_model_and_unknown_limits_without_percentage(environment):
    config,google,db=environment
    meter=Meter()
    with client_for(config,google,cloud=Cloud(),uony=meter) as client:
        ready(client,google,db);connect(db,config)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            for model in [LITE,PRO]:
                c.execute("INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,'project-fixture','google-test-one',%s,'low')",(user,model))
        for model,expected in [('auto',LITE),(PRO,PRO)]:
            result=client.post('/api/uony/context',json={'model':model,'effort':'low'}).json()
            assert result['model']==expected and meter.counts[-1]['model']==expected
        with patch.dict(MODEL_INPUT_LIMITS,{PRO:None}):
            unavailable=client.post('/api/uony/context',json={'model':PRO,'effort':'low'}).json()
        assert unavailable['status']=='unavailable' and unavailable['reason']=='limit_unknown'
        assert unavailable['limitTokens'] is None and unavailable['usageRatio'] is None
        assert len(meter.counts)==2
        meter.value=1048600
        full=client.post('/api/uony/context',json={}).json()
        assert full['usageRatio']>1 and full['remainingTokens']==0
        meter.count_error='quota_exceeded'
        unavailable=client.post('/api/uony/context',json={}).json()
        assert unavailable['status']=='unavailable' and unavailable['usedTokens'] is None
        assert unavailable['usageRatio'] is None and unavailable['reason']=='quota_exceeded'


def test_context_enforces_session_origin_access_and_model_checks(environment):
    config,google,db=environment
    meter=Meter()
    with client_for(config,google,cloud=Cloud(),uony=meter) as client:
        assert client.post('/api/uony/context',json={}).status_code==401
        login(client,google)
        assert client.post('/api/uony/context',json={}).status_code==403
        ready(client,google,db)
        assert client.post('/api/uony/context',json={}).status_code==409
        connect(db,config)
        assert client.post('/api/uony/context',json={},headers={'Origin':'null'}).status_code==403
        assert client.post('/api/uony/context',json={'model':PRO}).status_code==409
        for bad in [{'text':'a'*3001},{'threadId':'../other'},{'model':'other'},{'userId':'foreign'}]:
            assert client.post('/api/uony/context',json=bad).status_code==400
        with db.connect() as c:
            c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.post('/api/uony/context',json={}).status_code==403
        assert meter.counts==[]


def test_context_product_and_thread_permissions_preserve_all_saved_data(environment):
    config,google,db=environment
    meter=Meter()
    with client_for(config,google,cloud=Cloud(),uony=meter) as client:
        ready(client,google,db);connect(db,config)
        product=client.post('/api/products',json={'sku':'OWN','name':'Madera'}).json()['product']
        project=client.post('/api/uony/projects',json={'id':str(uuid4()),'name':'Proyecto'}).json()
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            c.execute("INSERT INTO uony_threads(user_id,id,title,project_id) VALUES(%s,'project-thread','Prueba',%s)",(user,project['id']))
        body={'threadId':'project-thread','projectId':project['id'],'productContext':{'sku':'OWN','revision':1}}
        assert client.post('/api/uony/context',json=body).status_code==200
        assert meter.counts[-1]['status']['productContext']==body['productContext']
        assert client.post('/api/uony/context',json={**body,'projectId':None}).status_code==409
        assert client.post('/api/uony/context',json={**body,'projectId':str(uuid4())}).status_code==404
        assert client.post('/api/uony/context',json={**body,'productContext':{'sku':'FOREIGN','revision':1}}).status_code==404
        assert client.get('/api/products').json()['products']==[product]
        assert client.delete('/api/uony/threads/project-thread').status_code==200
        assert client.post('/api/uony/context',json=body).status_code==410
        google.subject='second';google.email='second@example.test';login(client,google)
        # Same thread ID cannot disclose a different user's history/project/product.
        assert client.post('/api/uony/context',json=body).status_code==403
        assert len(meter.counts)==1


def test_context_account_mismatch_does_not_refresh_or_count(environment):
    config,google,db=environment
    cloud=Cloud();meter=Meter()
    with client_for(config,google,cloud=cloud,uony=meter) as client:
        ready(client,google,db);connect(db,config)
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET google_subject='foreign-subject'")
        with patch.object(cloud,'refresh',side_effect=AssertionError('must not refresh')):
            assert client.post('/api/uony/context',json={}).status_code==409
        assert meter.counts==[]


def test_context_same_thread_identifier_is_isolated_across_allowed_accounts(environment):
    from cryptography.fernet import Fernet
    from psycopg.types.json import Jsonb
    from test_subscription import complete
    config,google,db=environment
    meter=Meter()
    with client_for(config,google,cloud=Cloud(),uony=meter) as client:
        ready(client,google,db);connect(db,config)
        with db.connect() as c:
            original=c.execute('SELECT id FROM users').fetchone()['id']
            seed(c,original,'shared-id',3)
        client.post('/api/products',json={'sku':'PRIVATE','name':'Propio'})
        google.subject='second';google.email='second@example.test';login(client,google)
        complete(client)
        with db.connect() as c:
            second=c.execute('SELECT id FROM users WHERE email=%s',(google.email,)).fetchone()['id']
            c.execute("INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference) VALUES(%s,%s,'trial',now(),now()+interval '14 days','second-fixture')",(uuid4(),second))
            c.execute("INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check) VALUES(%s,'second','second@example.test',%s,'cloud-platform','project-fixture',%s)",(second,Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),Jsonb({'ready':True})))
            c.execute("INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,'project-fixture','second',%s,'medium')",(second,FLASH))
            c.execute('INSERT INTO drive_onboarding_preferences(user_id) VALUES(%s)',(second,))
        assert client.post('/api/onboarding/complete').status_code==200
        # The second user's new thread is empty even when its ID equals a saved foreign ID.
        with patch('app.blender_store.expire_jobs',side_effect=AssertionError('context must not reconcile jobs')):
            result=client.post('/api/uony/context',json={'threadId':'shared-id','text':'Propio'}).json()
        assert result['historyTurns']==0
        assert meter.counts[-1]['history']==[{'role':'user','parts':[{'text':'Propio'}]}]
        assert meter.counts[-1]['status'].user['id']==second
        assert client.post('/api/uony/context',json={'productContext':{'sku':'PRIVATE','revision':1}}).status_code==404
        assert len(meter.counts)==1 and meter.calls==0
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_threads WHERE user_id=%s',(second,)).fetchone()['n']==0
            assert c.execute('SELECT count(*) AS n FROM uony_requests WHERE user_id=%s',(second,)).fetchone()['n']==0


def test_context_refresh_failure_preserves_connection_and_has_no_fake_usage(environment):
    config,google,db=environment
    meter=Meter();cloud=Cloud()
    with client_for(config,google,cloud=cloud,uony=meter) as client:
        ready(client,google,db);connect(db,config)
        with db.connect() as c:
            before=c.execute('SELECT * FROM google_cloud_connections').fetchone()
        cloud.fail='reauthorize'
        result=client.post('/api/uony/context',json={}).json()
        assert result['status']=='unavailable' and result['reason']=='reauthorize'
        assert result['usedTokens'] is None and result['usageRatio'] is None
        assert meter.counts==[] and meter.calls==0
        with db.connect() as c:
            assert c.execute('SELECT * FROM google_cloud_connections').fetchone()==before
