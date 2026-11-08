"""Self-deletion against an isolated PostgreSQL schema; no real account/provider."""
from types import SimpleNamespace
from uuid import UUID, uuid4
import pytest
from fastapi import HTTPException
from psycopg import sql
from psycopg.errors import ObjectNotInPrerequisiteState
from app.account_deletion import AccountDeletion
from app.account_deletion_data import PRIVATE_TABLES
from app.account_deletion_identity import trial_was_used
from app.product_materials_consent import (
    start_consent, MATERIAL_START_CONSENT_VERSION, MATERIAL_START_CONSENT_TEXT,
    MATERIAL_START_CONSENT_SHA256,
)
from app.product_materials_control_consent import advertised_control_consent
from app.security import SESSION_COOKIE
from conftest import client_for, login


def body(client, **changes):
    state = client.get('/api/account/deletion').json()
    return {'requestId': state['requestId'], 'email': state['email'], 'confirmation': 'ELIMINAR', **changes}


def seed(connection, user, *, status='ready'):
    uid, product, material, reasoning, agent = user['id'], uuid4(), uuid4(), uuid4(), uuid4()
    material_request = uuid4()
    control_request = uuid4()
    connection.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,'TEST','{}')", (uid, product))
    connection.execute("INSERT INTO product_revisions(user_id,product_id,revision,data,source) VALUES(%s,%s,1,'{}','test')", (uid, product))
    connection.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'thread','Private chat')", (uid,))
    connection.execute('''INSERT INTO uony_live_pilot_admissions(user_id,session_id)
        VALUES(%s,%s)''', (uid, uuid4()))
    connection.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,status,model,project_id)
        VALUES(%s,%s,'thread','private','reply','success','test','test')''', (uid, uuid4()))
    connection.execute('''INSERT INTO uony_structured_focus_expectations
        (user_id,request_id,thread_id,google_subject,focus_version)
        VALUES(%s,%s,'thread',%s,0)''', (uid, uuid4(), user['google_subject']))
    connection.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,
        revision,folder_id,project_id,status) VALUES(%s,%s,%s,%s,%s,1,'external-original','test-project',%s)''',
        (material, uid, product, material_request, user['google_subject'], status))
    consent = start_consent(MATERIAL_START_CONSENT_VERSION,
                            MATERIAL_START_CONSENT_SHA256, MATERIAL_START_CONSENT_TEXT)
    connection.execute('''INSERT INTO product_material_job_authorizations
        (user_id,job_id,origin_request_id,google_subject,product_id,revision,
         folder_id,action,source,consent_version,consent_text,consent_sha256,accepted_at)
        VALUES(%s,%s,%s,%s,%s,1,'external-original','start',%s,%s,%s,%s,now())''',
        (uid, material, material_request, user['google_subject'], product,
         consent['source'], consent['version'], consent['text'], consent['sha256']))
    control_copy = advertised_control_consent('upgrade_readers')
    connection.execute('''INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload)
        VALUES(%s,%s,%s,'upgrade_readers','{}')''', (uid, control_request, material))
    connection.execute('''INSERT INTO product_material_control_authorizations
        (user_id,request_id,job_id,action,google_subject,product_id,revision,folder_id,
         project_id,source,consent_version,consent_text,consent_sha256,accepted_at)
        VALUES(%s,%s,%s,'upgrade_readers',%s,%s,1,'external-original','test-project',
               'versioned_ui_ack',%s,%s,%s,now())''',
        (uid, control_request, material, user['google_subject'], product,
         control_copy['version'], control_copy['text'], control_copy['sha256']))
    connection.execute("INSERT INTO product_material_sources(job_id,source_id,version,data) VALUES(%s,'source','v1','{}')", (material,))
    connection.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload)
        VALUES(%s,'fragment','source','v1','page1','done','{"private":"text"}')''', (material,))
    connection.execute('''INSERT INTO product_material_calls(id,job_id,lease_token,fragment_ids,state,reserved_tokens,usage)
        VALUES(%s,%s,%s,'[]','unknown',100,'{"unconfirmedCalls":1}')''', (uuid4(), material, uuid4()))
    connection.execute('''INSERT INTO product_reasoning_jobs(id,user_id,product_id,material_job_id,google_subject,
        fingerprint,product_signature,schema_hash,status,revision,context)
        VALUES(%s,%s,%s,%s,%s,'fingerprint','sig','schema','unknown',1,'{}')''',
        (reasoning, uid, product, material, user['google_subject']))
    connection.execute('''INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens,usage)
        VALUES(%s,%s,%s,'propose','unknown',100,'{"unconfirmedCalls":1}')''', (uuid4(), reasoning, uuid4()))
    connection.execute('''INSERT INTO blender_agents(id,token_hash,device_name,user_id,pair_expires_at)
        VALUES(%s,%s,'Local device',%s,now())''', (agent, str(uuid4()), uid))
    connection.execute('''INSERT INTO blender_jobs(id,user_id,agent_id,request_id,operation,source,status,preview)
        VALUES(%s,%s,%s,%s,'render_preview','uony','completed',%s)''', (uuid4(), uid, agent, uuid4(), b'private-pixels'))
    for table in ('google_drive_connections', 'google_cloud_connections'):
        connection.execute(sql.SQL('''INSERT INTO {}(user_id,google_subject,email,refresh_encrypted,scope)
            VALUES(%s,%s,%s,'encrypted-test-token','test')''').format(sql.Identifier(table)),
            (uid, user['google_subject'], user['email']))
    connection.execute('INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted) VALUES(%s,%s,\'encrypted\')', (uid, 'seller-' + str(uid)))
    connection.execute('''INSERT INTO drive_materials(user_id,google_subject,file_id,metadata)
        VALUES(%s,%s,'external-original','{}')''', (uid, user['google_subject']))
    connection.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
        VALUES(%s,%s,'trial',now()-interval '1 day',now()+interval '1 day',%s)''', (uuid4(), uid, str(uuid4())))
    return {'product': product, 'material': material, 'reasoning': reasoning, 'agent': agent}


def test_delete_private_graph_other_account_untouched_and_new_google_is_empty(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        token = client.cookies.get(SESSION_COOKIE)
        with db.connect() as c:
            owner = c.execute('SELECT * FROM users').fetchone(); seed(c, owner)
            owned = c.execute('''SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema()
                AND column_name='user_id' AND table_name<>'account_deletions' ''').fetchall()
            assert {row['table_name'] for row in owned} == set(PRIVATE_TABLES)
            other = c.execute('''INSERT INTO users(id,google_subject,email,display_name)
                VALUES(%s,'other','other@example.test','Other') RETURNING *''', (uuid4(),)).fetchone()
            seed(c, other)
            shared = c.execute('SELECT count(*) n FROM subscription_offers').fetchone()['n']
        before = client.get('/api/account/deletion').json()
        assert before['status'] == 'ready' and before['counts'] == {'products': 1, 'conversations': 1, 'connections': 4}
        request = body(client)
        result = client.post('/api/account/deletion', json=request)
        assert result.status_code == 200 and result.json()['status'] == 'deleted', result.text
        assert client.get('/api/auth/session').json() == {'authenticated': False}
        with db.connect() as c:
            assert c.execute('SELECT id FROM users WHERE id=%s', (owner['id'],)).fetchone() is None
            for table in PRIVATE_TABLES:
                assert c.execute(sql.SQL('SELECT count(*) n FROM {} WHERE user_id=%s').format(sql.Identifier(table)), (owner['id'],)).fetchone()['n'] == 0
            for table in ('product_material_sources', 'product_material_fragments',
                          'product_material_calls', 'product_reasoning_calls',
                          'product_material_job_authorizations',
                          'product_material_control_authorizations'):
                assert c.execute(sql.SQL('SELECT count(*) n FROM {}').format(sql.Identifier(table))).fetchone()['n'] == 1
            assert c.execute('SELECT count(*) n FROM products WHERE user_id=%s', (other['id'],)).fetchone()['n'] == 1
            assert c.execute('''SELECT count(*) n FROM uony_live_pilot_admissions
                WHERE user_id=%s''', (other['id'],)).fetchone()['n'] == 1
            assert c.execute('SELECT count(*) n FROM subscription_offers').fetchone()['n'] == shared
            row = c.execute('SELECT * FROM account_deletions').fetchone()
            assert row['status'] == 'deleted' and row['user_id'] is None and owner['email'] not in str(row)
        # A response lost after commit can be acknowledged with the old receipt;
        # this reveals no account data and cannot delete a subsequently new one.
        client.cookies.set(SESSION_COOKIE, token)
        assert client.post('/api/account/deletion', json=request).json()['status'] == 'deleted'
        client.cookies.clear()
        login(client, google)
        with db.connect() as c:
            fresh = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            assert fresh['id'] != owner['id'] and fresh['onboarding_completed_at'] is None
            assert trial_was_used(c, config, fresh) is True
            assert not c.execute('SELECT 1 FROM products WHERE user_id=%s', (fresh['id'],)).fetchone()
        assert client.get('/api/auth/session').json()['onboarding']['step'] == 'terms'
        assert client.post('/api/account/deletion', json=request).status_code == 409


@pytest.mark.parametrize('changes,origin,status', [
    ({'confirmation': 'eliminar'}, None, 400), ({'confirmation': ' ELIMINAR'}, None, 400),
    ({'email': 'other@example.test'}, None, 409), ({}, 'https://foreign.example', 403),
    ({'requestId': 'a' * 36}, None, 400)])
def test_delete_requires_exact_confirmation_identity_and_origin(environment, changes, origin, status):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        assert client.get('/api/account/deletion').status_code == 401
        login(client, google)
        result = client.post('/api/account/deletion', json=body(client, **changes), headers={'Origin': origin} if origin else {})
        assert result.status_code == status
        with db.connect() as c:
            assert c.execute('SELECT deletion_requested_at FROM users').fetchone()['deletion_requested_at'] is None
            assert not c.execute('SELECT 1 FROM account_deletions').fetchone()


def test_external_failure_freezes_account_and_relogin_can_retry_same_request(environment, monkeypatch):
    config, google, db = environment
    calls = []
    def failing(c, stripe, user, identity):
        calls.append(identity)
        raise HTTPException(503, detail={'error': 'stripe_unavailable', 'message': 'No podemos comprobar Stripe ahora.'})
    monkeypatch.setattr('app.account_deletion.cleanup_billing', failing)
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        with db.connect() as c:
            owner = c.execute('SELECT * FROM users').fetchone(); seed(c, owner)
        request = body(client)
        result = client.post('/api/account/deletion', json=request)
        assert result.status_code == 200 and result.json()['status'] == 'error'
        assert result.json()['requestId'] == request['requestId'] and result.json()['canRetry']
        assert client.get('/api/auth/session').json()['accountDeletionPending'] is True
        assert client.post('/api/onboarding/complete').json()['error'] == 'account_deletion_pending'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM products WHERE user_id=%s', (owner['id'],)).fetchone()['n'] == 1
        with pytest.raises(ObjectNotInPrerequisiteState), db.connect() as c:
            c.execute("UPDATE products SET data='{}' WHERE user_id=%s", (owner['id'],))
        with pytest.raises(ObjectNotInPrerequisiteState), db.connect() as c:
            c.execute("UPDATE product_reasoning_calls SET state='done' WHERE job_id IN(SELECT id FROM product_reasoning_jobs WHERE user_id=%s)", (owner['id'],))
        client.post('/api/auth/logout'); login(client, google)
        assert client.get('/api/account/deletion').json()['requestId'] == request['requestId']
        assert client.post('/api/account/deletion', json={**request, 'requestId': str(uuid4())}).status_code == 409
        def done(*args):
            calls.append(args[-1])
            return {'trialUsed': True, 'checkouts': 0, 'subscriptions': 0, 'expiredSessions': [], 'canceledSubscriptions': []}
        monkeypatch.setattr('app.account_deletion.cleanup_billing', done)
        assert client.post('/api/account/deletion', json=request).json()['status'] == 'deleted'
        assert calls == [UUID(request['requestId'])] * 2


def test_active_queue_is_blocked_but_unknown_historical_calls_do_not_require_ack(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone(); seeded = seed(c, user, status='queued')
        state = client.get('/api/account/deletion').json()
        assert state['status'] == 'blocked' and state['blockers'][0]['code'] == 'materials'
        request = body(client)
        assert client.post('/api/account/deletion', json=request).json()['error'] == 'account_busy'
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM account_deletions').fetchone()
            c.execute("UPDATE product_material_jobs SET status='paused' WHERE id=%s", (seeded['material'],))
        assert client.post('/api/account/deletion', json=request).json()['status'] == 'deleted'


def test_cloud_preparation_blocks_deletion_only_while_its_lease_is_active(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute("""INSERT INTO onboarding_setup_states(user_id,first_intent)
                VALUES(%s,'Quiero preparar mi catálogo')""", (user['id'],))
            c.execute("""INSERT INTO google_setup_operations(id,user_id,google_subject,mode,
                project_id,project_name,lease_until) VALUES(%s,%s,%s,'existing',
                'test-project','Uonify',now()+interval '2 minutes')""",
                (uuid4(), user['id'], user['google_subject']))
        state = client.get('/api/account/deletion').json()
        assert state['status'] == 'blocked' and state['blockers'][0]['code'] == 'google_setup'
        assert client.post('/api/account/deletion', json=body(client)).json()['error'] == 'account_busy'
        with db.connect() as c:
            c.execute("UPDATE google_setup_operations SET lease_until=now()-interval '1 second'")
        assert client.get('/api/account/deletion').json()['status'] == 'ready'
        assert client.post('/api/account/deletion', json=body(client)).json()['status'] == 'deleted'
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM onboarding_setup_states').fetchone()
            assert not c.execute('SELECT 1 FROM google_setup_operations').fetchone()


def test_receipt_missing_is_never_reported_as_deleted(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)):
        service = AccountDeletion(config, db, SimpleNamespace(ready=False))
        with pytest.raises(HTTPException) as failure:
            service.failed(uuid4(), RuntimeError('private diagnostic'))
        assert failure.value.status_code == 503


@pytest.mark.parametrize('link', ['retry_of', 'revision_of'])
def test_cross_owner_google_recovery_stops_deletion_before_billing(environment, monkeypatch, link):
    config, google, db = environment
    billing_calls = []
    monkeypatch.setattr('app.account_deletion.cleanup_billing', lambda *args: billing_calls.append(True))
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        parent = uuid4()
        with db.connect() as c:
            owner = c.execute('SELECT * FROM users').fetchone()
            other = c.execute("""INSERT INTO users(id,google_subject,email,display_name)
                VALUES(%s,'foreign-google','foreign@example.test','Foreign') RETURNING *""", (uuid4(),)).fetchone()
            c.execute("""INSERT INTO google_setup_operations(id,user_id,google_subject,mode,project_id,project_name)
                VALUES(%s,%s,%s,'existing','test-project','Uonify')""", (parent, owner['id'], owner['google_subject']))
            c.execute(sql.SQL('''INSERT INTO google_setup_operations(id,user_id,google_subject,mode,project_id,project_name,{})
                VALUES(%s,%s,%s,'existing','test-project','Uonify',%s)''').format(sql.Identifier(link)),
                (uuid4(), other['id'], other['google_subject'], parent))
        result = client.post('/api/account/deletion', json=body(client))
        assert result.status_code == 409 and result.json()['error'] == 'account_deletion_integrity'
        assert not billing_calls
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM users').fetchone()['n'] == 2
            assert c.execute('SELECT count(*) n FROM google_setup_operations').fetchone()['n'] == 2


def test_google_recovery_history_is_deleted_with_its_owner(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        parent = uuid4()
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute("""INSERT INTO google_setup_operations(id,user_id,google_subject,mode,project_id,project_name)
                VALUES(%s,%s,%s,'existing','test-project','Uonify')""", (parent, user['id'], user['google_subject']))
            c.execute("""INSERT INTO google_setup_operations(id,user_id,google_subject,mode,project_id,project_name,retry_of)
                VALUES(%s,%s,%s,'existing','test-project','Uonify',%s)""", (uuid4(), user['id'], user['google_subject'], parent))
        assert client.post('/api/account/deletion', json=body(client)).json()['status'] == 'deleted'
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM google_setup_operations').fetchone()
