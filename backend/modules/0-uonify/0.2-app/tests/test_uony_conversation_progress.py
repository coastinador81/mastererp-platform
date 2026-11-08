"""Progress is durable, scoped and content-free; no provider network calls."""
from threading import Event, Thread
from uuid import uuid4

from conftest import client_for
from test_google_cloud import Cloud
from test_uony import Agent, ready
from test_uony_conversation_queue import connected


def setup(client, google, db, config):
    ready(client, google, db)
    with db.connect() as c:
        user=c.execute('SELECT id FROM users WHERE google_subject=%s',
                       (google.subject,)).fetchone()['id']
        connected(c,user,google,config)
    return user


def test_progress_follows_one_job_without_repeating_or_exposing_content(environment):
    config,google,db=environment
    entered=Event(); release=Event(); checking=Event(); finish=Event()

    class BlockingAgent(Agent):
        def generate(self,*args,**kwargs):
            entered.set()
            assert release.wait(5)
            return super().generate(*args,**kwargs)

    agent=BlockingAgent()
    with client_for(config,google,cloud=Cloud(),uony=agent,legacy_sync=False) as client:
        setup(client,google,db,config)
        body={'requestId':str(uuid4()),'threadId':'progress','text':'Texto privado de prueba'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        get=lambda:client.get('/api/uony/requests/'+body['requestId']).json()
        first=get()
        assert first['progress']=={'stage':'queued','seq':1,'timingsMs':{}}
        assert client.post('/api/uony/messages',json=body).status_code==202
        assert get()['progress']==first['progress']
        worker=client.app.state.conversation_worker
        job=worker.queue.claim('progress-test')
        claimed=get()['progress']
        assert claimed['stage']=='preparing' and claimed['seq']==2
        assert type(claimed['timingsMs']['queueMs']) is int

        original=worker.queue.provider_return
        def pause_after_return(value):
            original(value)
            checking.set()
            assert finish.wait(5)
        worker.queue.provider_return=pause_after_return
        running=Thread(target=worker.run,args=(job,))
        running.start()
        try:
            assert entered.wait(5)
            consulting=get()['progress']
            assert consulting['stage']=='consulting_google' and consulting['seq']==3
            assert type(consulting['timingsMs']['preparationMs']) is int
            release.set()
            assert checking.wait(5)
            validating=get()['progress']
            assert validating['stage']=='checking_result' and validating['seq']==4
            assert type(validating['timingsMs']['googleMs']) is int
        finally:
            release.set();finish.set();running.join(5)
        assert not running.is_alive() and agent.calls==1
        saved=get()
        assert saved['status']=='success' and saved['progress']['stage']=='saved'
        assert saved['progress']['seq']==5
        assert all(type(value) is int and value>=0
                   for value in saved['progress']['timingsMs'].values())
        assert set(saved['progress']['timingsMs'])=={
            'queueMs','preparationMs','googleMs','checkingMs','totalMs'}
        assert 'Texto privado' not in str(saved['progress'])
        assert client.post('/api/uony/messages',json=body).json()['progress']==saved['progress']
        assert get()['progress']==saved['progress']


def test_requeue_and_uncertain_outcome_advance_sequence_without_false_save(environment):
    config,google,db=environment
    with client_for(config,google,cloud=Cloud(),uony=Agent(),legacy_sync=False) as client:
        user=setup(client,google,db,config)
        body={'requestId':str(uuid4()),'threadId':'reentry','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        queue=client.app.state.conversation_worker.queue
        get=lambda:client.get('/api/uony/requests/'+body['requestId']).json()
        first=queue.claim('crashed-before-provider')
        assert get()['progress']['seq']==2
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        assert queue.recover()
        requeued=get()
        assert requeued['status']=='queued' and requeued['progress']['stage']=='queued'
        assert requeued['progress']['seq']==3
        assert requeued['progress']['timingsMs']['queueMs']>=0
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET available_at=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        second=queue.claim('fresh-worker')
        assert second['lease_token']!=first['lease_token']
        assert get()['progress']['seq']==4
        queue.provider_start(second)
        assert get()['progress']['seq']==5
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        assert queue.recover()
        uncertain=get()
        assert uncertain['status']=='unknown'
        assert uncertain['progress']['stage']=='consulting_google'
        assert uncertain['progress']['seq']==6
        assert 'googleMs' not in uncertain['progress']['timingsMs']
        assert 'totalMs' in uncertain['progress']['timingsMs']
        assert client.get('/api/uony/requests/recent').json()['requests'][0]['progress']==uncertain['progress']
        assert client.get('/api/uony/requests/unresolved').json()['requests'][0]['progress']==uncertain['progress']
        with db.connect() as c:
            c.execute("UPDATE users SET google_subject='another-subject' WHERE id=%s",(user,))
        assert client.get('/api/uony/requests/'+body['requestId']).status_code==404


def test_cancelled_queue_has_terminal_sequence_without_google_time(environment):
    config,google,db=environment
    with client_for(config,google,cloud=Cloud(),uony=Agent(),legacy_sync=False) as client:
        setup(client,google,db,config)
        body={'requestId':str(uuid4()),'threadId':'cancel-progress','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        cancelled=client.post('/api/uony/requests/'+body['requestId']+'/cancel').json()
        assert cancelled['status']=='cancelled'
        assert cancelled['progress']['stage']=='queued' and cancelled['progress']['seq']==2
        assert set(cancelled['progress']['timingsMs'])=={'totalMs'}
        assert client.get('/api/uony/requests/'+body['requestId']).json()['progress']==cancelled['progress']
