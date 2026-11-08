from uuid import uuid4
from conftest import client_for,login
from test_subscription import complete
from test_google_cloud import Cloud,allow
from app.google_cloud_provider import CloudError
from psycopg.types.json import Jsonb

class Agent:
    def __init__(self):self.calls=0;self.fail=False
    def generate(self,token,project,history,status,model=None,effort=None):
        self.calls+=1
        assert project=='project-fixture' and history[-1]['role']=='user'
        assert not any(key.endswith('Email') for key in status)
        if self.fail:raise CloudError('quota_exceeded')
        return '¿Tienes materiales o quieres empezar desde cero?',{'calls':1,'attemptedCalls':1,'totalTokenCount':30}

def ready(client,google,db):
    login(client,google);complete(client)
    # Explicit fixture for the new pre-checkout setup gate. Remove these
    # temporary connections afterwards so each business test owns its inputs.
    with db.connect() as c:
        user=c.execute('SELECT id FROM users WHERE google_subject=%s',(google.subject,)).fetchone()['id']
        c.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
            VALUES(%s,%s,'trial',now(),now()+interval '14 days',%s)''',(uuid4(),user,'fixture-'+str(uuid4())))
        c.execute('INSERT INTO drive_onboarding_preferences(user_id) VALUES(%s) ON CONFLICT DO NOTHING',(user,))
        c.execute('''INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check)
            VALUES(%s,%s,%s,'fixture-not-a-credential','cloud-platform','setup-fixture',%s)''',
            (user,google.subject,google.email,Jsonb({'ready':True})))
        c.execute('''INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort)
            VALUES(%s,'setup-fixture',%s,'gemini-3.5-flash','medium')''',(user,google.subject))
    assert client.post('/api/onboarding/complete').status_code==200
    with db.connect() as c:
        assert c.execute('SELECT onboarding_completed_at FROM users WHERE id=%s',(user,)).fetchone()['onboarding_completed_at']
        c.execute("DELETE FROM uony_model_checks WHERE user_id=%s AND project_id='setup-fixture'",(user,))
        c.execute("DELETE FROM google_cloud_connections WHERE user_id=%s AND project_id='setup-fixture'",(user,))
        c.execute('DELETE FROM drive_onboarding_preferences WHERE user_id=%s',(user,))

def test_completion_and_reentry_optional_connections(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        assert client.post('/api/onboarding/complete').status_code==401
        login(client,google)
        assert client.post('/api/onboarding/complete').status_code==403
        complete(client)
        assert client.post('/api/onboarding/complete').status_code==403
        allow(db)
        assert client.post('/api/onboarding/complete',headers={'Origin':'null'}).status_code==403
        assert client.post('/api/onboarding/complete').status_code==409
        ready(client,google,db)
        # Once complete, reconnecting Google does not restart a paid onboarding.
        for _ in range(2):assert client.post('/api/onboarding/complete').json()['profileComplete'] is True
        assert client.get('/api/auth/session').json()['profileComplete'] is True
        with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.get('/api/auth/session').json()['profileComplete'] is True
        assert client.get('/api/billing/workspace-access').json()['status']=='subscription_required'

def test_chat_persistence_idempotency_isolation_and_failure(environment):
    config,google,db=environment;cloud=Cloud();agent=Agent()
    from cryptography.fernet import Fernet
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            c.execute("INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check) VALUES(%s,'google-test-one','one@example.test',%s,'cloud-platform','project-fixture',%s)",(user,Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),Jsonb({'ready':True})))
            c.execute("INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,'project-fixture','google-test-one','gemini-3.5-flash','medium')",(user,))
        body={'requestId':str(uuid4()),'threadId':'t_test','text':'Hola'}
        assert client.post('/api/uony/messages',json=body,headers={'Origin':'null'}).status_code==403
        for _ in range(2):assert client.post('/api/uony/messages',json=body).status_code==200
        assert agent.calls==1
        assert len(client.get('/api/uony/threads').json()['threads'][0]['messages'])==2
        assert client.get('/api/uony/services').json()['lastResponseAt']
        identities=client.get('/api/uony/services').json()
        assert identities['accountEmail']==google.email
        assert identities['googleCloudEmail']=='one@example.test'
        assert identities['driveEmail'] is None
        assert client.post('/api/uony/messages',json={**body,'text':'distinto'}).status_code==409
        agent.fail=True;failed={**body,'requestId':str(uuid4())}
        assert client.post('/api/uony/messages',json=failed).status_code==503
        assert client.post('/api/uony/messages',json=failed).status_code==409
        assert agent.calls==2
        with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.post('/api/uony/messages',json={**body,'requestId':str(uuid4())}).status_code==403
        assert agent.calls==2
        google.subject='another-user';google.email='other@example.test';login(client,google)
        assert client.get('/api/uony/threads').json()=={'threads':[]}
        assert client.get('/api/uony/services').json()['googleCloud']=='disconnected'
        assert client.get('/api/uony/services').json()['googleCloudEmail'] is None
        assert client.get('/api/uony/services').json()['accountEmail']=='other@example.test'


def test_model_preferences_routing_and_request_audit(environment):
    config,google,db=environment
    class SelectedAgent(Agent):
        def generate(self,token,project,history,status,model=None,effort=None):
            self.selected=(model,effort)
            return super().generate(token,project,history,status,model,effort)
    cloud=Cloud();agent=SelectedAgent()
    from cryptography.fernet import Fernet
    from app.uony_models import FLASH,LITE,PRO
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            c.execute("INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check) VALUES(%s,'google-test-one','one@example.test',%s,'cloud-platform','project-fixture',%s)",(user,Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),Jsonb({'ready':True})))
            for model in [FLASH,LITE,PRO]:
                for effort in ['low','medium','high']:
                    c.execute("INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,'project-fixture','google-test-one',%s,%s)",(user,model,effort))
        assert len(client.get('/api/uony/options').json()['models'])==3
        for model,effort,expected in [('auto','low',LITE),('auto','high',FLASH),(PRO,'medium',PRO)]:
            preferences={'model':model,'effort':effort}
            assert client.put('/api/uony/preferences',json=preferences).json()==preferences
            assert client.get('/api/uony/options').json()['preferences']==preferences
            body={'requestId':str(uuid4()),'threadId':'selection','text':'Hola',**preferences}
            response=client.post('/api/uony/messages',json=body)
            assert response.status_code==200
            assert agent.selected==(expected,effort)
            assert response.json()['model']==expected
            assert response.json()['effort']==effort
            assert client.post('/api/uony/messages',json={**body,'effort':'low' if effort!='low' else 'high'}).status_code==409
        with db.connect() as c:
            rows=c.execute('SELECT model,effort,requested_model FROM uony_requests ORDER BY created_at').fetchall()
            assert rows[0]=={'model':LITE,'effort':'low','requested_model':'auto'}
            c.execute("UPDATE google_cloud_connections SET project_id='other-project'")
        assert client.get('/api/uony/options').json()['models']==[]
        assert client.post('/api/uony/messages',json={**body,'requestId':str(uuid4())}).status_code==409
        assert client.put('/api/uony/preferences',json={'model':'gpt-other','effort':'medium'}).status_code==400
        assert client.put('/api/uony/preferences',json={'model':'auto','effort':'max'}).status_code==400
        google.subject='other';google.email='other@example.test';login(client,google)
        assert client.get('/api/uony/options').json()['preferences']=={'model':'auto','effort':'medium'}
