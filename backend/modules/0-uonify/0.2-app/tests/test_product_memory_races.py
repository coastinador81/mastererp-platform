"""A generation based on an old product revision cannot become the saved answer."""
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import inspect
from cryptography.fernet import Fernet
from psycopg.errors import LockNotAvailable
from psycopg.types.json import Jsonb
import pytest
import app.product_memory as memory_module
from app.products import save
from app.product_materials_review import custom_id
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import ready
from test_product_memory import _product, message


@pytest.mark.parametrize('mutation', ['source', 'job'])
def test_final_memory_read_serializes_material_invalidation(environment, mutation):
    """A saved answer must not outlive a changed source or material status."""
    config, google, db = environment
    proposal = {'id': 'fact-weight', 'field': 'custom:peso_producto',
        'canonicalField': 'custom:peso_producto', 'label': 'Peso del producto',
        'value': '500 g', 'confirmedValue': '500 g',
        'confirmedField': 'custom:peso_producto', 'scope': 'product',
        'channel': 'product', 'claimType': 'declared', 'status': 'confirmed',
        'supportStatus': 'supported', 'evidence': [
            {'sourceId': 'weight-document', 'sourceVersion': 'v1', 'locator': '$.peso'}]}
    field = {'id': custom_id(proposal), 'name': 'Peso del producto',
        'value': '500 g', 'isConfirmed': True, 'source': 'Drive',
        'type': 'text', 'options': []}
    with client_for(config, google) as client:
        ready(client, google, db)
        product = _product(client, fields=[field])
        assert client.post('/api/uony/messages', json=message(
            'material-race', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO google_drive_connections(user_id,google_subject,email,
                refresh_encrypted,scope) VALUES(%s,%s,%s,'test-only','drive.readonly')''',
                (user['id'], google.subject, google.email))
            job_id = uuid4()
            c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,
                google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'folder','ready',%s)''',
                (job_id, user['id'], product['id'], uuid4(), google.subject,
                 Jsonb({'facts': {'version': 1, 'stale': False,
                                  'proposals': [proposal]}})))
            c.execute('''INSERT INTO product_material_sources(job_id,source_id,version,data)
                VALUES(%s,'weight-document','v1',%s)''',
                (job_id, Jsonb({'id': 'weight-document'})))

        def change_material():
            with db.connect() as c:
                c.execute("SET LOCAL lock_timeout='300ms'")
                if mutation == 'source':
                    c.execute("UPDATE product_material_sources SET version='v2' WHERE job_id=%s",
                              (job_id,))
                else:
                    c.execute("UPDATE product_material_jobs SET status='paused' WHERE id=%s",
                              (job_id,))

        with db.connect() as reading:
            user = reading.execute('SELECT * FROM users').fetchone()
            snapshot = memory_module.project(reading, user, 'material-race')
            assert snapshot['materialState'] == 'saved_sources'
            assert snapshot['confirmedFacts'][0]['freshness'] == 'saved_source_version'
            with ThreadPoolExecutor(max_workers=1) as executor:
                with pytest.raises(LockNotAvailable):
                    executor.submit(change_material).result(timeout=5)

        change_material()
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            stale = memory_module.project(c, user, 'material-race')
        assert stale['materialState'] == 'review_required'
        assert stale['confirmedFacts'][0]['freshness'] == 'source_not_rechecked'


def test_read_only_answer_is_rejected_if_confirmed_fact_changes_during_generation(environment):
    config, google, db = environment
    started, release = Event(), Event()

    class PausedAgent:
        calls = 0

        def generate(self, token, project_id, history, status, model=None, effort=None):
            self.calls += 1
            assert status['productMemory']['confirmedFacts'][0]['value'] == '500 g'
            started.set()
            assert release.wait(10)
            return 'El peso confirmado es 500 g.', {'calls': 1, 'totalTokenCount': 1}

    agent = PausedAgent()
    field = {'id': 'weight', 'name': 'Peso', 'value': '500 g', 'isConfirmed': True,
             'source': 'Cliente', 'type': 'text', 'options': []}
    with client_for(config, google, cloud=Cloud(), uony=agent) as client:
        ready(client, google, db)
        _product(client, fields=[field])
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO google_cloud_connections(user_id,google_subject,email,
                refresh_encrypted,scope,project_id,project_check)
                VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)''',
                (user['id'], google.subject, google.email,
                 Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),
                 Jsonb({'ready': True})))
            c.execute('''INSERT INTO uony_model_checks
                (user_id,project_id,google_subject,model,effort)
                VALUES(%s,'project-fixture',%s,'gemini-3.5-flash','medium')''',
                (user['id'], google.subject))
        assert client.post('/api/uony/messages', json=message('race-memory', 'BASIC', 1)).status_code == 200
        request = {'requestId': str(uuid4()), 'threadId': 'race-memory',
                   'text': '¿Cuánto pesa este producto?'}
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(client.post, '/api/uony/messages', json=request)
            try:
                assert started.wait(10)
                edit = client.patch('/api/products/BASIC', json={
                    'revision': 1, 'customFields': [{**field, 'value': '600 g'}]})
                assert edit.status_code == 200, edit.text
            finally:
                release.set()
            stale = future.result(timeout=10)
        assert stale.status_code == 409
        assert stale.json()['error'] == 'product_memory_conflict'
        assert agent.calls == 1
        assert client.get('/api/products').json()['products'][0]['revision'] == 2
        assert all('500 g' not in item['text'] for thread in client.get('/api/uony/threads').json()['threads']
                   for item in thread['messages'])
        with db.connect() as c:
            row = c.execute('SELECT status,error_code,usage FROM uony_requests WHERE request_id=%s',
                            (request['requestId'],)).fetchone()
            assert row['status'] == 'error' and row['error_code'] == 'product_memory_conflict'
            assert row['usage']['calls'] == 1


def test_edit_waits_when_final_memory_check_has_read_confirmed_fact(environment, monkeypatch):
    config, google, db = environment
    checked, release = Event(), Event()
    field = {'id': 'weight', 'name': 'Peso', 'value': '500 g', 'isConfirmed': True,
             'source': 'Cliente', 'type': 'text', 'options': []}

    class Agent:
        def generate(self, token, project_id, history, status, model=None, effort=None):
            assert status['productMemory']['confirmedFacts'][0]['value'] == '500 g'
            return 'El peso confirmado es 500 g.', {'calls': 1, 'totalTokenCount': 1}

    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        _product(client, fields=[field])
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO google_cloud_connections(user_id,google_subject,email,
                refresh_encrypted,scope,project_id,project_check)
                VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)''',
                (user['id'], google.subject, google.email,
                 Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),
                 Jsonb({'ready': True})))
            c.execute('''INSERT INTO uony_model_checks
                (user_id,project_id,google_subject,model,effort)
                VALUES(%s,'project-fixture',%s,'gemini-3.5-flash','medium')''',
                (user['id'], google.subject))
        assert client.post('/api/uony/messages', json=message('race-after-check', 'BASIC', 1)).status_code == 200

        original = memory_module.project

        def pause_after_check(connection, user, thread_id):
            memory = original(connection, user, thread_id)
            if inspect.currentframe().f_back.f_code.co_name == 'finish':
                assert memory['confirmedFacts'][0]['value'] == '500 g'
                checked.set()
                assert release.wait(10)
            return memory

        monkeypatch.setattr(memory_module, 'project', pause_after_check)

        def edit_while_final_check_is_open():
            with db.connect() as c:
                c.execute("SET LOCAL lock_timeout='300ms'")
                owner = c.execute('SELECT * FROM users').fetchone()
                return save(c, owner, {'revision': 1,
                    'customFields': [{**field, 'value': '600 g'}]}, 'BASIC')

        request = {'requestId': str(uuid4()), 'threadId': 'race-after-check',
                   'text': '¿Cuánto pesa este producto?'}
        with ThreadPoolExecutor(max_workers=2) as executor:
            answer = executor.submit(client.post, '/api/uony/messages', json=request)
            try:
                assert checked.wait(10)
                edit = executor.submit(edit_while_final_check_is_open)
                with pytest.raises(LockNotAvailable):
                    edit.result(timeout=5)
            finally:
                release.set()
            response = answer.result(timeout=10)

        assert response.status_code == 200, response.text
        assert response.json()['reply'] == 'El peso confirmado es 500 g.'
        updated = client.patch('/api/products/BASIC', json={
            'revision': 1, 'customFields': [{**field, 'value': '600 g'}]})
        assert updated.status_code == 200, updated.text
        memory = client.get('/api/uony/threads/race-after-check/product-memory').json()['productMemory']
        assert memory['product']['revision'] == 2
        assert memory['confirmedFacts'][0]['value'] == '600 g'
