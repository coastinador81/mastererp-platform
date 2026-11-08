"""DB and API fixtures; stream events are fake and never contact Google."""
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Event, Thread
from unittest.mock import Mock, patch
from uuid import uuid4

from requests.exceptions import ChunkedEncodingError

from app.uony_provider import UonyProvider
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_conversation_queue import connected


def setup(client, google, db, config):
    ready(client,google,db)
    with db.connect() as c:
        user=c.execute('SELECT id FROM users WHERE google_subject=%s',
                       (google.subject,)).fetchone()['id']
        connected(c,user,google,config)
    return user


def event(text, *, finish=None):
    candidate={'index':0,'content':{'role':'model','parts':[{'text':text}]}}
    if finish:
        candidate['finishReason']=finish
    return 'data: '+json.dumps({'candidates':[candidate]})


def fake_response(lines):
    response=Mock(status_code=200,headers={'Content-Type':'text/event-stream'})
    response.iter_lines.return_value=iter(lines)
    return response


def test_partial_is_tentative_ordered_durable_and_replaced_by_one_final(environment):
    settings,google,db=environment
    settings=replace(settings,streaming_enabled=True)
    entered=Event();release=Event()
    def lines():
        yield event('Hola ')
        yield ''
        entered.set()
        assert release.wait(5)
        yield event('desde Uony.',finish='STOP')
        yield ''
        yield 'data: '+json.dumps({'usageMetadata':{'totalTokenCount':14}})
        yield ''
    response=fake_response(lines())
    with client_for(settings,google,cloud=Cloud(),uony=UonyProvider(),legacy_sync=False) as client:
        user=setup(client,google,db,settings)
        body={'requestId':str(uuid4()),'threadId':'stream-durable','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        worker=client.app.state.conversation_worker
        assert worker.streaming is True
        job=worker.queue.claim('stream-fixture')
        with patch('app.uony_provider.requests.post',return_value=response) as post:
            running=Thread(target=worker.run,args=(job,));running.start()
            try:
                assert entered.wait(5)
                with ThreadPoolExecutor(max_workers=2) as readers:
                    snapshots=list(readers.map(
                        lambda _:client.get('/api/uony/requests/'+body['requestId']).json(),range(2)))
                first,second=snapshots
                assert first==second
                assert first['status']=='running'
                assert first['progress']['provisional']=={
                    'text':'Hola ','seq':1,'tentative':True}
                assert first['progress']==client.get('/api/uony/requests/'+body['requestId']).json()['progress']
                with db.connect() as c:
                    row=c.execute('SELECT provisional_text,provider_attempt_count FROM uony_conversation_jobs '
                                  'WHERE user_id=%s AND request_id=%s',(user,body['requestId'])).fetchone()
                assert row=={'provisional_text':'Hola ','provider_attempt_count':1}
            finally:
                release.set();running.join(5)
        assert not running.is_alive() and post.call_count==1
        final=client.get('/api/uony/requests/'+body['requestId']).json()
        assert final['status']=='success'
        assert final['response']['reply']=='Hola desde Uony.'
        assert 'provisional' not in final['progress']
        assert final['progress']['seq']>first['progress']['seq']
        assert client.post('/api/uony/messages',json=body).json()==final
        with db.connect() as c:
            row=c.execute('SELECT provisional_text,provider_attempt_count,provider_completed_count '
                          'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                          (user,body['requestId'])).fetchone()
        assert row=={'provisional_text':'','provider_attempt_count':1,'provider_completed_count':1}


def test_interrupted_stream_is_uncertain_and_never_replayed(environment):
    settings,google,db=environment
    settings=replace(settings,streaming_enabled=True)
    entered=Event();release=Event()
    def lines():
        yield event('Respuesta a medio camino')
        yield ''
        entered.set()
        assert release.wait(5)
        raise ChunkedEncodingError('fixture: provider stream was cut')
    with client_for(settings,google,cloud=Cloud(),uony=UonyProvider(),legacy_sync=False) as client:
        user=setup(client,google,db,settings)
        body={'requestId':str(uuid4()),'threadId':'stream-interrupted','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        worker=client.app.state.conversation_worker
        assert worker.streaming is True
        job=worker.queue.claim('stream-fixture')
        with patch('app.uony_provider.requests.post',return_value=fake_response(lines())) as post:
            running=Thread(target=worker.run,args=(job,));running.start()
            try:
                assert entered.wait(5)
                partial=client.get('/api/uony/requests/'+body['requestId']).json()
                assert partial['status']=='running'
                assert partial['progress']['provisional']['text']=='Respuesta a medio camino'
            finally:
                release.set();running.join(5)
        assert not running.is_alive() and post.call_count==1
        final=client.get('/api/uony/requests/'+body['requestId']).json()
        assert final['status']=='unknown' and final['error']['code']=='consumption_unknown'
        assert final['progress']['seq']>partial['progress']['seq']
        assert 'provisional' not in final['progress'] and 'response' not in final
        assert client.post('/api/uony/messages',json=body).status_code==200
        assert client.post('/api/uony/messages',json={**body,'requestId':str(uuid4())}).status_code==409
        assert worker.queue.claim('another-worker') is None
        with db.connect() as c:
            row=c.execute('SELECT usage,provider_attempt_count,provider_completed_count,provisional_text '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user,body['requestId'])).fetchone()
        assert row['provider_attempt_count']==1 and row['provider_completed_count']==0
        assert row['usage']['attemptedCalls']==1 and row['usage']['calls']==0
        assert row['usage']['uncertainCalls']==1 and row['provisional_text']==''


def test_cancel_during_stream_erases_partial_and_blocks_second_reply(environment):
    settings,google,db=environment
    settings=replace(settings,streaming_enabled=True)
    entered=Event();release=Event()
    def lines():
        yield event('Texto provisional')
        yield ''
        entered.set()
        assert release.wait(5)
        yield event(' no permitido',finish='STOP')
        yield ''
    with client_for(settings,google,cloud=Cloud(),uony=UonyProvider(),legacy_sync=False) as client:
        setup(client,google,db,settings)
        body={'requestId':str(uuid4()),'threadId':'stream-cancel','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        worker=client.app.state.conversation_worker
        job=worker.queue.claim('stream-fixture')
        with patch('app.uony_provider.requests.post',return_value=fake_response(lines())) as post:
            running=Thread(target=worker.run,args=(job,));running.start()
            try:
                assert entered.wait(5)
                assert client.get('/api/uony/requests/'+body['requestId']).json()[
                    'progress']['provisional']['text']=='Texto provisional'
                cancelled=client.post('/api/uony/requests/'+body['requestId']+'/cancel').json()
                assert cancelled['status']=='unknown'
                assert 'provisional' not in cancelled['progress']
            finally:
                release.set();running.join(5)
        assert not running.is_alive() and post.call_count==1
        final=client.get('/api/uony/requests/'+body['requestId']).json()
        assert final['status']=='unknown' and 'response' not in final
        assert 'provisional' not in final['progress']
        assert client.post('/api/uony/messages',json={**body,'requestId':str(uuid4())}).status_code==409


def test_expired_second_stream_attempt_preserves_attempt_ledger(environment):
    settings,google,db=environment
    settings=replace(settings,streaming_enabled=True)
    with client_for(settings,google,cloud=Cloud(),uony=UonyProvider(),legacy_sync=False) as client:
        user=setup(client,google,db,settings)
        body={'requestId':str(uuid4()),'threadId':'stream-ledger','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code==202
        queue=client.app.state.conversation_worker.queue
        job=queue.claim('stream-fixture')
        queue.stream_attempt(job,1)
        queue.stream_complete(job,1,{'attemptedCalls':1,'calls':1,'totalTokenCount':5})
        queue.stream_attempt(job,2)
        queue.stream_partial(job,'Un fragmento')
        with db.connect() as c:
            c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'
                WHERE user_id=%s AND request_id=%s""",(user,body['requestId']))
        assert queue.recover()
        state=client.get('/api/uony/requests/'+body['requestId']).json()
        assert state['status']=='unknown' and 'provisional' not in state['progress']
        with db.connect() as c:
            row=c.execute('SELECT usage,provider_attempt_count,provider_completed_count,provisional_text '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user,body['requestId'])).fetchone()
        assert row['provider_attempt_count']==2 and row['provider_completed_count']==1
        assert row['usage']['attemptedCalls']==2 and row['usage']['calls']==1
        assert row['usage']['uncertainCalls']>=1 and row['provisional_text']==''
        assert queue.claim('another-worker') is None
