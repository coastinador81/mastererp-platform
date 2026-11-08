"""Durable conversation admission and recovery without external services."""
from uuid import uuid4
from pathlib import Path
from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Thread
import pytest
from cryptography.fernet import Fernet
from psycopg.types.json import Jsonb
from conftest import client_for, login
from test_uony import ready, Agent
from test_google_cloud import Cloud
from app.uony_conversation_queue import LeaseLost


def connected(c, user, google, config):
    c.execute("""INSERT INTO google_cloud_connections(user_id,google_subject,email,
        refresh_encrypted,scope,project_id,project_check)
        VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)""",
        (user,google.subject,google.email,
         Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),
         Jsonb({'ready':True})))
    c.execute("""INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort)
        VALUES(%s,'project-fixture',%s,'gemini-3.5-flash','medium')""",
        (user,google.subject))


def test_queue_persists_and_worker_commits_once(environment):
    config,google,db=environment
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'durable','text':'Hola'}
        first=client.post('/api/uony/messages',json=body)
        assert first.status_code==202 and first.json()['status']=='queued'
        assert client.post('/api/uony/messages',json=body).status_code==202
        assert agent.calls==0
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET created_at=now()-interval '8 days'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        assert client.get('/api/uony/requests/recent').json()['requests'][0]['status']=='queued'
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET created_at=now()
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        claimed=client.app.state.conversation_worker.queue.claim('fixture-worker')
        assert claimed and str(claimed['request_id'])==body['requestId']
        assert client.get('/api/uony/requests/'+body['requestId']).json()['status']=='running'
        client.app.state.conversation_worker.run(claimed)
        result=client.get('/api/uony/requests/'+body['requestId']).json()
        assert result['status']=='success' and result['response']['reply'].startswith('¿Tienes')
        assert agent.calls==1
        assert client.post('/api/uony/messages',json=body).json()['status']=='success'
        assert agent.calls==1
        assert client.get('/api/uony/requests/recent').json()['requests'][0]['text']=='Hola'
        history=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert history[0]['requestId']==body['requestId']==history[1]['requestId']


def test_started_expired_lease_is_unknown_never_replayed(environment):
    config,google,db=environment
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'uncertain','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        queue=client.app.state.conversation_worker.queue
        job=queue.claim('fixture-worker')
        queue.provider_start(job)
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        assert queue.recover()
        assert queue.claim('other-worker') is None
        result=client.get('/api/uony/requests/'+body['requestId']).json()
        assert result['status']=='unknown' and result['error']['code']=='consumption_unknown'
        assert agent.calls==0
        repeat={**body,'requestId':str(uuid4())}
        assert client.post('/api/uony/messages',json=repeat).status_code==409
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][1]['requestStatus']=='unknown'
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET created_at=now()-interval '9 days'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
            c.execute("""UPDATE uony_requests SET created_at=now()-interval '9 days'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        assert client.get('/api/uony/requests/recent').json()['requests']==[]
        unresolved=client.get('/api/uony/requests/unresolved').json()
        assert unresolved['nextCursor'] is None
        assert unresolved['requests'][0]['requestId']==body['requestId']
        # An unresolved attempt remains in the transcript even after the
        # ordinary 200-message history window moves beyond it.
        with db.connect() as c:
            for index in range(205):
                c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,
                    prompt,reply,status,model,project_id)
                    VALUES(%s,%s,'uncertain',%s,'Guardado','success',
                        'gemini-3.5-flash','project-fixture')""",
                    (user,uuid4(),f'Prueba guardada {index}'))
            c.execute("""UPDATE uony_requests SET created_at=now()-interval '8 days'
                WHERE user_id=%s AND status='success' AND thread_id='uncertain'""",(user,))
        history=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert sum(item.get('requestId')==body['requestId'] for item in history)==2
        assert len(history)==402
        assert client.post('/api/uony/messages',json={**repeat,'retryOf':str(uuid4())}).status_code==409
        authorized=client.post('/api/uony/messages',json={**repeat,'retryOf':body['requestId']})
        assert authorized.status_code==202
        assert str(queue.claim('second-worker')['request_id'])==repeat['requestId']


@pytest.mark.parametrize('provider_started,expected', [
    (False, 'queued'), (True, 'unknown'),
])
def test_missing_lease_is_recovered_without_replaying_google(environment, provider_started, expected):
    config,google,db=environment
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'missing-lease','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        queue=client.app.state.conversation_worker.queue
        old=queue.claim('worker-before-crash')
        assert old and old['lease_until'] is not None
        if provider_started:
            queue.provider_start(old)
        with db.connect() as c:
            c.execute('''UPDATE uony_conversation_jobs SET lease_until=NULL
                WHERE user_id=%s AND request_id=%s''',(user,body['requestId']))
        assert queue.recover()
        with db.connect() as c:
            row=c.execute('''SELECT status,lease_token,lease_until,usage
                FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s''',
                (user,body['requestId'])).fetchone()
        assert row['status']==expected
        assert row['lease_token'] is None and row['lease_until'] is None
        with pytest.raises(LeaseLost):
            queue.provider_start(old)
        if provider_started:
            assert row['usage']['uncertainCalls']==1
            assert queue.claim('worker-after-crash') is None
            state=client.get('/api/uony/requests/'+body['requestId']).json()
            assert state['status']=='unknown' and state['error']['code']=='consumption_unknown'
        else:
            assert not row['usage'].get('attemptedCalls')
            with db.connect() as c:
                c.execute('''UPDATE uony_conversation_jobs SET available_at=now()-interval '1 second'
                    WHERE user_id=%s AND request_id=%s''',(user,body['requestId']))
            again=queue.claim('worker-after-crash')
            assert again and again['request_id']==old['request_id']
            assert again['lease_token']!=old['lease_token']
        assert agent.calls==0


def test_pre_provider_crash_cools_down_and_other_account_claims(environment):
    config,google,db=environment
    with client_for(config,google,cloud=Cloud(),uony=Agent(),legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            first_user=c.execute('SELECT id FROM users WHERE google_subject=%s',(google.subject,)).fetchone()['id']
            connected(c,first_user,google,config)
        first={'requestId':str(uuid4()),'threadId':'first','text':'Hola'}
        assert client.post('/api/uony/messages',json=first).status_code==202
        queue=client.app.state.conversation_worker.queue
        held=queue.claim('crashing-worker')
        assert held['user_id']==first_user
        google.subject='google-test-two';google.email='two@example.test'
        ready(client,google,db)
        with db.connect() as c:
            second_user=c.execute('SELECT id FROM users WHERE google_subject=%s',(google.subject,)).fetchone()['id']
            connected(c,second_user,google,config)
        second={'requestId':str(uuid4()),'threadId':'second','text':'Hola de otra cuenta'}
        assert client.post('/api/uony/messages',json=second).status_code==202
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(first_user,first['requestId']))
        next_job=queue.claim('healthy-worker')
        assert next_job['user_id']==second_user
        assert client.get('/api/uony/requests/'+first['requestId']).status_code==404
        assert client.get('/api/uony/requests/'+second['requestId']).json()['status']=='running'
        # Repeated pre-provider crashes stop after three claims with zero
        # attempted provider calls, instead of monopolising the worker.
        cancelled=client.post('/api/uony/requests/'+second['requestId']+'/cancel')
        assert cancelled.json()['status']=='cancelled'
        for attempt in range(2,4):
            with db.connect() as c:
                c.execute("""UPDATE uony_conversation_jobs SET available_at=now()-interval '1 second'
                    WHERE user_id=%s AND request_id=%s""",(first_user,first['requestId']))
            job=queue.claim('crashing-worker')
            assert job and job['claim_count']==attempt
            with db.connect() as c:
                c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'
                    WHERE user_id=%s AND request_id=%s""",(first_user,first['requestId']))
            assert queue.recover()
        with db.connect() as c:
            final=c.execute("""SELECT status,error_code,usage FROM uony_conversation_jobs
                WHERE user_id=%s AND request_id=%s""",(first_user,first['requestId'])).fetchone()
        assert final['status']=='error' and final['error_code']=='preparation_interrupted'
        assert not final['usage'].get('attemptedCalls')


def test_cancel_fences_started_provider_and_thread_delete_scrubs_payload(environment):
    config,google,db=environment
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'erase','text':'Texto privado'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        queue=client.app.state.conversation_worker.queue
        job=queue.claim('worker-one')
        queue.provider_start(job)
        cancelled=client.post('/api/uony/requests/'+body['requestId']+'/cancel')
        assert cancelled.json()['status']=='unknown'
        client.app.state.conversation_worker.run(job)
        assert agent.calls==0
        with db.connect() as c:
            c.execute("""UPDATE uony_requests SET product_changes=%s,product_context=%s
                WHERE user_id=%s AND request_id=%s""",
                (Jsonb([{'name':'Privado'}]),Jsonb({'sku':'SECRET','revision':1}),user,body['requestId']))
        assert client.delete('/api/uony/threads/erase').status_code==200
        with db.connect() as c:
            request=c.execute("""SELECT prompt,reply,product_changes,product_context
                FROM uony_requests WHERE user_id=%s AND request_id=%s""",
                (user,body['requestId'])).fetchone()
            saved=c.execute("""SELECT payload,memory_snapshot,google_subject,project_id
                FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s""",
                (user,body['requestId'])).fetchone()
        assert request=={'prompt':'','reply':None,'product_changes':[],'product_context':None}
        assert saved=={'payload':{},'memory_snapshot':None,'google_subject':'','project_id':''}


def test_uncertain_google_permission_error_keeps_reconnection_action(environment):
    config,google,db=environment
    with client_for(config,google,cloud=Cloud(),uony=Agent(),legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'permission','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        worker=client.app.state.conversation_worker
        job=worker.queue.claim('fixture-worker')
        worker.queue.provider_start(job)
        worker.fail(job,'permission_denied',{'attemptedCalls':1,'uncertainCalls':1},True)
        response=client.get('/api/uony/requests/'+body['requestId']).json()
        assert response['status']=='unknown'
        assert response['error']['code']=='consumption_unknown'
        assert response['connectionActions']==[{'provider':'cloud','action':'manage'}]
        assert client.post('/api/uony/messages',json={**body,'requestId':str(uuid4())}).status_code==409


def test_inflight_provider_cannot_commit_or_run_tool_after_cancellation(environment):
    config,google,db=environment
    entered=Event();resume=Event()
    class BlockingAgent:
        calls=0
        def generate(self,token,project,history,status,model=None,effort=None):
            self.calls+=1
            entered.set()
            assert resume.wait(5)
            # Cancellation revokes the lease before the tool can touch data.
            status.call('create_product',{'sku':'SHOULD-NOT-EXIST','name':'Private'})
            return 'No debe guardarse',{'attemptedCalls':1,'calls':1}
    agent=BlockingAgent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'inflight','text':'Crea un producto'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        worker=client.app.state.conversation_worker
        job=worker.queue.claim('worker-inflight')
        running=Thread(target=worker.run,args=(job,))
        running.start()
        try:
            assert entered.wait(5)
            with db.connect() as c:
                worker.queue.cancel(c,{'id':user,'google_subject':google.subject},body['requestId'])
        finally:
            resume.set();running.join(5)
        assert not running.is_alive() and agent.calls==1
        with db.connect() as c:
            request=c.execute('SELECT status,reply FROM uony_requests WHERE user_id=%s AND request_id=%s',
                              (user,body['requestId'])).fetchone()
            product=c.execute("SELECT 1 FROM products WHERE user_id=%s AND sku='SHOULD-NOT-EXIST'",(user,)).fetchone()
        assert request=={'status':'error','reply':None}
        assert product is None
        assert client.get('/api/uony/requests/'+body['requestId']).json()['status']=='unknown'


def test_two_workers_claim_one_job_only(environment):
    config,google,db=environment
    with client_for(config,google,cloud=Cloud(),uony=Agent(),legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'one-worker','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        queue=client.app.state.conversation_worker.queue
        with ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(queue.claim,'worker-a')
            second=pool.submit(queue.claim,'worker-b')
            claims=[first.result(),second.result()]
        assert sum(job is not None for job in claims)==1
        assert str(next(job for job in claims if job)['request_id'])==body['requestId']


def test_claim_skips_busy_account_and_serves_another_account(environment):
    config,google,db=environment
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            first_user=c.execute('SELECT id FROM users WHERE google_subject=%s',
                                 (google.subject,)).fetchone()['id']
            connected(c,first_user,google,config)
        first={'requestId':str(uuid4()),'threadId':'fair-first','text':'Primera cuenta'}
        assert client.post('/api/uony/messages',json=first).status_code==202

        google.subject='google-test-two';google.email='two@example.test'
        ready(client,google,db)
        with db.connect() as c:
            second_user=c.execute('SELECT id FROM users WHERE google_subject=%s',
                                  (google.subject,)).fetchone()['id']
            connected(c,second_user,google,config)
        second={'requestId':str(uuid4()),'threadId':'fair-second','text':'Segunda cuenta'}
        assert client.post('/api/uony/messages',json=second).status_code==202
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET available_at=now()-interval '5 seconds'
                WHERE user_id=%s AND request_id=%s""",(first_user,first['requestId']))
            c.execute("""UPDATE uony_conversation_jobs SET available_at=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(second_user,second['requestId']))

        queue=client.app.state.conversation_worker.queue
        # Another worker is claiming the oldest account. A second claimant
        # must skip that account, not idle while the other account waits.
        with db.connect() as held:
            held.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(first_user,))
            held.execute("""SELECT request_id FROM uony_conversation_jobs
                WHERE user_id=%s AND request_id=%s FOR UPDATE""",
                (first_user,first['requestId']))
            claimed=queue.claim('second-worker')
            assert claimed and claimed['user_id']==second_user
            assert str(claimed['request_id'])==second['requestId']
            assert agent.calls==0
        first_claim=queue.claim('first-worker')
        assert first_claim and first_claim['user_id']==first_user
        assert str(first_claim['request_id'])==first['requestId']


def test_changed_google_project_blocks_execution_and_subject_scopes_poll(environment):
    config,google,db=environment
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        body={'requestId':str(uuid4()),'threadId':'changed-google','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET project_id='other-project' WHERE user_id=%s",(user,))
            c.execute("""UPDATE uony_model_checks SET project_id='other-project'
                WHERE user_id=%s AND project_id='project-fixture'""",(user,))
        worker=client.app.state.conversation_worker
        worker.run(worker.queue.claim('changed-project-worker'))
        assert agent.calls==0
        assert client.get('/api/uony/requests/'+body['requestId']).json()['error']['code']=='google_changed'
        with db.connect() as c:
            c.execute("UPDATE users SET google_subject='another-google-subject' WHERE id=%s",(user,))
        assert client.get('/api/uony/requests/'+body['requestId']).status_code==404
        assert client.get('/api/uony/requests/recent').json()['requests']==[]
        # The Uonify account can still read its own history; no old Google
        # subject is passed back to the model or admitted as a new job.
        history=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert history[0]['requestId']==body['requestId']


def test_unknown_of_previous_google_subject_does_not_hide_current_intent(environment):
    config,google,db=environment
    with client_for(config,google,cloud=Cloud(),uony=Agent(),legacy_sync=False) as client:
        ready(client,google,db)
        with db.connect() as c:
            user=c.execute('SELECT id FROM users').fetchone()['id']
            connected(c,user,google,config)
        first={'requestId':str(uuid4()),'threadId':'new-google','text':'Hola'}
        assert client.post('/api/uony/messages',json=first).status_code==202
        queue=client.app.state.conversation_worker.queue
        job=queue.claim('old-subject-worker')
        queue.provider_start(job)
        with db.connect() as c:
            c.execute("UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'")
        assert queue.recover()
        with db.connect() as c:
            c.execute("UPDATE users SET google_subject='new-subject' WHERE id=%s",(user,))
            c.execute("UPDATE google_cloud_connections SET google_subject='new-subject' WHERE user_id=%s",(user,))
            c.execute("UPDATE uony_model_checks SET google_subject='new-subject' WHERE user_id=%s",(user,))
        assert client.get('/api/uony/requests/unresolved').json()['requests']==[]
        second={**first,'requestId':str(uuid4())}
        assert client.post('/api/uony/messages',json=second).status_code==202


def test_migration_backfills_legacy_running_without_reexecution(environment):
    _,_,db=environment
    paths=sorted((Path(__file__).parent.parent/'migrations').glob('*.sql'))
    user=uuid4();first=uuid4();second=uuid4()
    with db.connect() as c:
        c.execute('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)')
        for path in paths:
            if path.name.startswith(('053_','054_','055_','058_','060_','062_','063_','072_','086_','087_')):continue
            content=path.read_text()
            c.execute(content)
            c.execute('INSERT INTO schema_migrations VALUES(%s,%s)',
                      (path.name,sha256(content.encode()).hexdigest()))
        c.execute("INSERT INTO users(id,google_subject,email) VALUES(%s,'subject-fixture','legacy@example.test')",(user,))
        c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'legacy-open','Legacy'),(%s,'legacy-deleted','')",
                  (user,user))
        c.execute("UPDATE uony_threads SET deleted_at=now() WHERE user_id=%s AND id='legacy-deleted'",(user,))
        c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,
            project_id,requested_model,effort)
            VALUES(%s,%s,'legacy-open','Hola','running','gemini-3.5-flash','fixture','auto','medium'),
            (%s,%s,'legacy-deleted','Privado','running','gemini-3.5-flash','fixture','auto','medium')""",
            (user,first,user,second))
    db.migrate()
    with db.connect() as c:
        rows=c.execute("""SELECT r.status,r.error_code,j.status AS job_status,j.provider_started_at,
            j.payload,j.engine FROM uony_requests r JOIN uony_conversation_jobs j USING(user_id,request_id)
            WHERE r.user_id=%s ORDER BY r.thread_id""",(user,)).fetchall()
        assert len(rows)==2
        assert all(row['status']=='error' and row['job_status']=='unknown'
                   and row['error_code']=='consumption_unknown' and row['provider_started_at']
                   for row in rows)
        assert all('productAction' in row['payload'] for row in rows)
        assert all(row['engine']=='classic' for row in rows)
        assert c.execute("SELECT count(*) AS n FROM uony_conversation_jobs WHERE status='queued'").fetchone()['n']==0
    # The migration's checksum is stable on a second startup.
    db.migrate()
