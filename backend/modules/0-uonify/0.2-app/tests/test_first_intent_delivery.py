from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4
from conftest import client_for, login
from test_google_setup import SetupCloud, BASE, body, start

CLAIM = '/api/onboarding/first-intent/claim'
STATE = '/api/onboarding/first-intent'


class Agent:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.entered = self.release = None

    def generate(self, token, project, history, status, model=None, effort=None):
        from app.google_cloud_provider import CloudError
        self.calls += 1
        if self.entered:
            self.entered.set()
            assert self.release.wait(5)
        if self.fail:
            raise CloudError('google_unavailable')
        return 'Tu primera petición está atendida.', {'totalTokenCount':5}


def prepared_paid(client, google, db, cloud):
    start(client,google,cloud)
    client.post('/api/connections/google-drive/defer')
    assert client.post(BASE+'/setup',json=body()).json()['operation']['status'] == 'ready'
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s',(google.subject,)).fetchone()['id']
        c.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
            VALUES(%s,%s,'paid',now(),now()+interval '1 year',%s)''',(uuid4(),user,'verified-existing-paid-'+str(uuid4())))
    assert client.post('/api/onboarding/complete').status_code == 200


def save(client, text='Quiero crear Basic Mini Bricks con los documentos de Drive.'):
    response = client.put('/api/onboarding/setup',json={'firstIntent':text})
    assert response.status_code == 200, response.text
    return response.json()


def message(delivery):
    return {key:delivery[key] for key in ('requestId','threadId','text','model','effort')}


def test_existing_paid_return_claim_send_reload_is_exactly_once_without_checkout(environment):
    config,google,db = environment
    cloud, agent = SetupCloud(), Agent()
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        prepared_paid(client,google,db,cloud)
        assert save(client)['firstIntentDelivery'] is None
        assert client.get(STATE).json() == {'delivery':None}
        request = {'model':'auto','effort':'medium'}
        first = client.post(CLAIM,json=request).json()['delivery']
        assert first['status'] == 'pending' and agent.calls == 0
        assert client.post(CLAIM,json=request).json()['delivery'] == first
        assert client.get('/api/onboarding/setup').json()['firstIntentDelivery'] == first
        sent = client.post('/api/uony/messages',json=message(first))
        assert sent.status_code == 200, sent.text
        assert client.post('/api/uony/messages',json=message(first)).json() == sent.json()
        assert agent.calls == 1
        for _ in range(2):
            result = client.get(STATE).json()['delivery']
            assert result['status'] == 'complete' and result['requestId'] == first['requestId']
            assert client.post(CLAIM,json=request).json()['delivery']['status'] == 'complete'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM billing_checkouts').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 1
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 1
        threads = client.get('/api/uony/threads').json()['threads']
        assert len(threads) == 1 and threads[0]['id'] == first['threadId']


def test_concurrent_claim_reserves_one_body_and_rejects_mutating_it(environment):
    config,google,db = environment
    cloud, agent = SetupCloud(), Agent()
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        prepared_paid(client,google,db,cloud); save(client)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(client.post,CLAIM,json={'model':'auto','effort':'medium'}) for _ in range(2)]
            deliveries = [future.result(timeout=5).json()['delivery'] for future in futures]
        assert deliveries[0] == deliveries[1]
        first = deliveries[0]
        for changed in ({'text':'Un contenido distinto'}, {'threadId':'another-thread'}, {'model':'gemini-3.5-flash'},
                        {'productContext':{'sku':'OTHER','revision':1}}, {'projectId':str(uuid4())}):
            response = client.post('/api/uony/messages',json={**message(first),**changed})
            assert response.status_code == 409 and response.json()['error'] == 'first_intent_conflict'
        assert client.put('/api/onboarding/setup',json={'firstIntent':'Cambiar la petición reservada'}).status_code == 409
        assert agent.calls == 0
        assert client.get(STATE).json()['delivery']['text'] == first['text']


def test_running_and_unknown_deliveries_never_trigger_an_automatic_retry(environment):
    config,google,db = environment
    cloud, agent = SetupCloud(), Agent()
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        prepared_paid(client,google,db,cloud); save(client)
        first = client.post(CLAIM,json={'model':'auto','effort':'medium'}).json()['delivery']
        agent.entered,agent.release = Event(),Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(client.post,'/api/uony/messages',json=message(first))
            assert agent.entered.wait(5)
            assert client.get(STATE).json()['delivery']['status'] == 'sending'
            assert client.post('/api/uony/messages',json=message(first)).status_code == 202
            agent.fail = True
            agent.release.set()
            assert running.result(timeout=10).status_code == 503
        assert client.get(STATE).json()['delivery']['status'] == 'unknown'
        assert client.post(CLAIM,json={'model':'auto','effort':'medium'}).json()['delivery']['status'] == 'unknown'
        assert client.post('/api/uony/messages',json=message(first)).status_code == 409
        assert agent.calls == 1


def test_first_intent_stays_sending_while_durable_job_is_queued_past_four_minutes(environment):
    config,google,db=environment
    cloud,agent=SetupCloud(),Agent()
    with client_for(config,google,cloud=cloud,uony=agent,legacy_sync=False) as client:
        prepared_paid(client,google,db,cloud);save(client)
        first=client.post(CLAIM,json={'model':'auto','effort':'medium'}).json()['delivery']
        assert client.post('/api/uony/messages',json=message(first)).status_code==202
        with db.connect() as c:
            c.execute("""UPDATE uony_requests SET created_at=now()-interval '10 minutes'
                WHERE request_id=%s""",(first['requestId'],))
        assert client.get(STATE).json()['delivery']['status']=='sending'
        assert agent.calls==0


def test_claim_requires_ready_paid_owner_and_preserves_an_overlong_original(environment):
    config,google,db = environment
    cloud, agent = SetupCloud(), Agent()
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        assert client.post(CLAIM,json={}).status_code == 401
        start(client,google,cloud); save(client)
        assert client.post(CLAIM,json={}).status_code == 403
        client.post('/api/connections/google-drive/defer')
        client.post(BASE+'/setup',json=body())
        with db.connect() as c:
            user = c.execute('SELECT id FROM users').fetchone()['id']
            c.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
                VALUES(%s,%s,'paid',now(),now()+interval '1 year','already-paid')''',(uuid4(),user))
        assert client.post('/api/onboarding/complete').status_code == 200
        original = 'a'*3001
        save(client,original)
        assert client.post(CLAIM,json={}).json()['error'] == 'first_intent_too_long'
        assert client.get('/api/onboarding/setup').json()['firstIntent'] == original
        assert client.get(STATE).json()['delivery'] is None
        save(client,'Petición más corta')
        assert client.post(CLAIM,json={},headers={'Origin':'null'}).status_code == 403
        claimed = client.post(CLAIM,json={}).json()['delivery']
        assert claimed['status'] == 'pending'
        google.subject = 'other-user'; google.email = 'other@example.test'; login(client,google)
        assert client.get(STATE).json() == {'delivery':None}
        assert client.get('/api/onboarding/setup').json()['firstIntent'] == ''
        assert client.post(CLAIM,json={}).status_code == 403
        assert agent.calls == 0


def test_claimed_intent_blocks_after_access_expiry_without_losing_reserved_ids(environment):
    config,google,db = environment
    cloud = SetupCloud()
    with client_for(config,google,cloud=cloud) as client:
        prepared_paid(client,google,db,cloud); save(client)
        first = client.post(CLAIM,json={}).json()['delivery']
        with db.connect() as c:
            c.execute('UPDATE access_periods SET ends_at=now()')
        blocked = client.get(STATE).json()['delivery']
        assert blocked['status'] == 'blocked' and blocked['requestId'] == first['requestId']
        assert client.post(CLAIM,json={}).status_code == 403


def test_late_delivery_cannot_send_old_account_text_with_a_new_paid_session(environment):
    config,google,db = environment
    cloud, agent = SetupCloud(), Agent()
    with client_for(config,google,cloud=cloud,uony=agent) as client:
        prepared_paid(client,google,db,cloud); save(client,'Petición privada de la primera cuenta')
        first = client.post(CLAIM,json={}).json()['delivery']
        google.subject = 'second-paid-owner'; google.email = 'second@example.test'
        cloud.subject,cloud.email = google.subject,google.email
        prepared_paid(client,google,db,cloud)
        response = client.post('/api/uony/messages',json=message(first))
        assert response.status_code == 404 and agent.calls == 0
        assert client.get(STATE).json() == {'delivery':None}
        assert client.get('/api/uony/threads').json()['threads'] == []
