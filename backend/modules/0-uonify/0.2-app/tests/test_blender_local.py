import base64
import struct
import zlib
from uuid import uuid4
from conftest import client_for,login
from test_uony import ready
from app.blender_tools import BusinessTools
from app.blender_store import enqueue

BASE='/api/connections/blender-local'
SCENE={'name':'Torre','fileName':'propuesta.blend','objectCount':54}
POLL={'blenderVersion':'5.1.0','capabilities':['inspect_scene','render_preview'],'scene':SCENE,'available':True}


def native(client,path,body,token=None):
    origin=client.headers.pop('Origin',None)
    try:
        return client.post('/api/blender-agent/'+path,json=body,headers={'Authorization':'Bearer '+token} if token else {})
    finally:
        if origin:client.headers['Origin']=origin


def pair(client):
    registration=native(client,'register',{'deviceName':'Mac de prueba'}).json()
    assert set(registration)=={'pairId','agentToken','approvalUrl','expiresAt'}
    assert client.get(BASE+'/pair/'+registration['pairId']).json()['deviceName']=='Mac de prueba'
    assert client.post(BASE+'/connect',json={'pairId':registration['pairId']}).status_code==200
    token=registration['agentToken']
    assert native(client,'poll',POLL,token).json()=={'status':'connected','job':None}
    return token


def png():
    def chunk(kind,body):
        return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'tEXt',b'File\x00/private/work.blend')+chunk(b'IDAT',zlib.compress(b'\x00\x00\x00\x00'))+chunk(b'IEND',b'')


def test_pair_requires_session_origin_access_and_expires(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        assert client.get(BASE).status_code==401
        assert client.post('/api/blender-agent/register',json={'deviceName':'Mac'}).status_code==403
        registration=native(client,'register',{'deviceName':'Mac'}).json();token=registration['agentToken']
        assert native(client,'poll',POLL,token).json()=={'status':'pending','job':None}
        login(client,google)
        assert client.post(BASE+'/connect',json={'pairId':registration['pairId']}).status_code==403
        ready(client,google,db)
        assert client.post(BASE+'/connect',json={'pairId':registration['pairId']},headers={'Origin':'https://evil.invalid'}).status_code==403
        with db.connect() as c:c.execute("UPDATE blender_agents SET pair_expires_at=now()-interval '1 second'")
        assert client.get(BASE+'/pair/'+registration['pairId']).status_code==404
        assert client.post(BASE+'/connect',json={'pairId':registration['pairId']}).status_code==409
        assert native(client,'poll',POLL,token).json()['status']=='disconnected'
        with db.connect() as c:
            saved=c.execute('SELECT token_hash FROM blender_agents').fetchone()['token_hash']
            assert saved!=token and len(saved)==64


def test_jobs_metrics_persist_idempotency_and_private_preview(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        before=client.get(BASE).json()
        assert before['status']=='connected' and before['scene']==SCENE
        assert before['costPolicy']=={'execution':'local','billing':'included_subscription','extraCharge':0}
        body={'requestId':str(uuid4())}
        job=client.post(BASE+'/preview',json=body).json()['job']
        assert client.post(BASE+'/preview',json=body).json()['job']==job
        assert client.post(BASE+'/inspect',json=body).status_code==409
        assert client.post(BASE+'/inspect',json={'requestId':str(uuid4())}).status_code==409
        assert native(client,'poll',POLL,token).json()['job']=={'id':job['id'],'operation':'render_preview'}
        assert native(client,'poll',POLL,token).json()['job'] is None
        report={'jobId':job['id'],'status':'completed','result':{'scene':SCENE},'durationMs':137,
                'previewBase64':base64.b64encode(png()).decode()}
        assert native(client,'report',report,token).json()=={'ok':True}
        assert native(client,'report',report,token).json()=={'ok':True}
        assert native(client,'report',{**report,'durationMs':138},token).status_code==409
        saved=client.get(BASE+'/jobs/'+job['id']).json()['job']
        assert saved['status']=='completed' and saved['localDurationMs']==137
        image=client.get(saved['previewUrl'])
        assert image.status_code==200 and image.headers['content-type']=='image/png'
        assert b'/private' not in image.content and b'tEXt' not in image.content
        status=client.get(BASE).json();usage=status['usage']
        assert usage['calls']>before['usage']['calls'] and usage['requestBytes']>0 and usage['responseBytes']>0
        assert usage['localDurationMs']==137 and usage['backendDurationMs']>=0 and usage['estimatedCost'] is None
        assert usage['storedPreviewBytes']==len(image.content)
        assert status['lastJob']==saved
        assert 'token' not in str(status).lower()
        assert client.get('/api/uony/services').json()['blenderLocal']['status']=='connected'
        google.subject='other-blender-user';google.email='other@example.test';login(client,google)
        assert client.get(BASE).json()['status']=='disconnected'
        assert client.get(BASE+'/jobs/'+job['id']).status_code==404
        assert client.get(saved['previewUrl']).status_code==404
    with client_for(config,google) as client:
        google.subject='google-test-one';google.email='one@example.test';login(client,google)
        assert client.get(BASE).json()['lastJob']['id']==job['id']


def test_offline_revoked_and_expired_access_never_dispatch(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        with db.connect() as c:c.execute("UPDATE blender_agents SET last_seen_at=now()-interval '31 seconds'")
        assert client.get(BASE).json()['status']=='offline'
        assert client.post(BASE+'/inspect',json={'requestId':str(uuid4())}).status_code==409
        native(client,'poll',POLL,token)
        job=client.post(BASE+'/inspect',json={'requestId':str(uuid4())}).json()['job']
        with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
        assert native(client,'poll',POLL,token).json()['job'] is None
        assert client.get(BASE+'/jobs/'+job['id']).json()['job']['status']=='failed'
        assert client.post(BASE+'/inspect',json={'requestId':str(uuid4())}).status_code==403
        assert client.get(BASE).json()['accessAllowed'] is False
        assert client.post(BASE+'/disconnect').json()['status']=='disconnected'
        assert native(client,'poll',POLL,token).json()['status']=='disconnected'
        report={'jobId':job['id'],'status':'failed','error':'Conector cerrado','durationMs':10}
        assert native(client,'report',report,token).status_code==401


def test_lease_and_validation_do_not_repeat_work(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        assert native(client,'poll',{**POLL,'scene':{**SCENE,'fileName':'/Users/private.blend'}},token).status_code==400
        body={'requestId':str(uuid4())}
        job=client.post(BASE+'/preview',json=body).json()['job']
        native(client,'poll',POLL,token)
        report={'jobId':job['id'],'status':'completed','result':{'scene':SCENE},'durationMs':1,'previewBase64':base64.b64encode(b'bad').decode()}
        assert native(client,'report',report,token).status_code==400
        assert native(client,'report',{**report,'previewBase64':None},token).status_code==400
        with db.connect() as c:c.execute("UPDATE blender_jobs SET lease_expires_at=now()-interval '1 second'")
        assert client.get(BASE+'/jobs/'+job['id']).json()['job']['status']=='unknown'
        assert native(client,'poll',POLL,token).json()['job'] is None
        assert client.post(BASE+'/preview',json=body).json()['job']['status']=='unknown'
        assert native(client,'report',{**report,'previewBase64':base64.b64encode(png()).decode()},token).status_code==409


def test_uony_tools_use_account_and_one_request_identity(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);pair(client)
        with db.connect() as c:user=c.execute('SELECT * FROM users').fetchone()
        tools=BusinessTools({},db,user,None,uuid4())
        result=tools.call('get_blender_status',{})
        assert result['status']=='connected'
        import json
        json.dumps(result)  # También debe poder serializarse hacia Gemini, sin Decimal de sum(bigint).
        assert tools.call('inspect_blender_scene',{'code':'delete'})['error']=='invalid_tool'
        first=tools.call('inspect_blender_scene',{})['job']
        assert tools.call('inspect_blender_scene',{})['job']['id']==first['id']
        assert first['status']=='queued'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM blender_jobs').fetchone()['n']==1
            assert c.execute('SELECT source FROM blender_jobs').fetchone()['source']=='uony'


def test_concurrent_enqueue_reuses_request_and_serializes_account(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);pair(client)
        with db.connect() as c:user=c.execute('SELECT * FROM users').fetchone()
        gate=Barrier(2);request_id=uuid4()
        def reserve():
            with db.connect() as c:
                gate.wait(timeout=5)
                return enqueue(c,user,request_id,'inspect_scene')['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            one=pool.submit(reserve);two=pool.submit(reserve)
            assert one.result(timeout=10)==two.result(timeout=10)
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM blender_jobs').fetchone()['n']==1
