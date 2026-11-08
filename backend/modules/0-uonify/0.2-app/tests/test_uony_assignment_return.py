"""H6 local return: two saved goals, only proven work, and no execution on GET."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from psycopg.errors import LockNotAvailable
from psycopg.types.json import Jsonb

from app import uony_assignments
from conftest import client_for, login
from test_uony import Agent, ready


def _thread(db, subject, *names):
    with db.connect() as c:
        user_id = c.execute('SELECT id FROM users WHERE google_subject=%s',
                            (subject,)).fetchone()['id']
        for name in names:
            c.execute('INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)',
                      (user_id, name, name))
        return user_id


def _goal(client, thread, label, **extra):
    result = client.post('/api/uony/assignments', json={
        'requestId': str(uuid4()), 'threadId': thread, 'label': label,
        'objective': f'Preparar {label}', **extra})
    assert result.status_code == 200, result.text
    return result.json()['assignment']


def _counts(db):
    tables = ('uony_assignments', 'uony_assignment_focus', 'uony_assignment_focus_requests',
              'products', 'product_material_jobs', 'product_reasoning_jobs',
              'uony_conversation_jobs', 'uony_return_followups')
    with db.connect() as c:
        return {name: c.execute('SELECT count(*) AS n FROM ' + name).fetchone()['n']
                for name in tables}


def test_two_goals_return_ambiguous_then_explicit_focus_survives_reload_without_work(environment):
    config, google, db = environment
    agent = Agent()
    with client_for(config, google, uony=agent) as client:
        ready(client, google, db)
        _thread(db, google.subject, 'start', 'fresh')
        basic = _goal(client, 'start', 'Basic Mini Bricks')
        lamp = _goal(client, 'start', 'Lámpara azul')
        before = _counts(db)
        for _ in range(2):
            response = client.get('/api/uony/threads/fresh/assignment-return')
            assert response.status_code == 200, response.text
            assert response.headers['cache-control'] == 'no-store'
            view = response.json()
            assert view['resolution'] == 'ambiguous'
            assert view['focusVersion'] == 0
            assert {item['assignment']['id'] for item in view['assignments']} == {basic['id'], lamp['id']}
            assert len(view['assignments']) == 2 and view['moreAvailable'] is False
            assert all(item['product'] is None and item['work'] is None
                       and item['workLabel'] == 'Guardado, sin trabajo iniciado'
                       for item in view['assignments'])
        assert _counts(db) == before and agent.calls == 0
        choice = client.put('/api/uony/threads/fresh/assignment-focus', json={
            'requestId': str(uuid4()), 'assignmentId': basic['id'], 'expectedVersion': 0})
        assert choice.status_code == 200, choice.text
    with client_for(config, google, uony=agent) as reloaded:
        login(reloaded, google)
        before = _counts(db)
        view = reloaded.get('/api/uony/threads/fresh/assignment-return').json()
        assert view['resolution'] == 'focused' and view['focusVersion'] == 1
        assert view['assignments'][0]['assignment']['id'] == basic['id']
        assert {item['assignment']['id'] for item in view['assignments']} == {basic['id'], lamp['id']}
        assert _counts(db) == before and agent.calls == 0


def test_only_current_same_identity_linked_product_work_is_reported(environment):
    config, google, db = environment
    agent = Agent()
    with client_for(config, google, uony=agent) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'product-return')
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'})
        assert product.status_code == 200, product.text
        product_id = product.json()['product']['id']
        goal = _goal(client, 'product-return', 'Basic Mini Bricks', productId=product_id)
        with db.connect() as c:
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,2,'older-or-future','error',%s)''',
                (uuid4(), user_id, product_id, uuid4(), google.subject, Jsonb({})))
        first = client.get('/api/uony/threads/product-return/assignment-return').json()
        assert first['resolution'] == 'single'
        assert first['assignments'][0]['assignment']['id'] == goal['id']
        assert first['assignments'][0]['product']['name'] == 'Basic Mini Bricks'
        assert first['assignments'][0]['work'] is None
        with db.connect() as c:
            job_id = uuid4()
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'basic-folder','ready',%s)''',
                (job_id, user_id, product_id, uuid4(), google.subject, Jsonb({})))
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,'different-google-subject',1,'foreign-folder','error',%s)''',
                (uuid4(), user_id, product_id, uuid4(), Jsonb({})))
        before = _counts(db)
        view = client.get('/api/uony/threads/product-return/assignment-return').json()
        work = view['assignments'][0]['work']
        assert work['id'] == str(job_id) and work['kind'] == 'materials' and work['status'] == 'ready'
        assert work['scope'] == 'linked_product_current_revision'
        assert 'percent' not in str(view).lower()
        assert _counts(db) == before and agent.calls == 0


def test_return_does_not_expose_another_account_or_a_deleted_thread(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _thread(db, google.subject, 'first-thread')
        _goal(client, 'first-thread', 'Privado')
        google.subject, google.email = 'second-subject', 'second@example.test'
        ready(client, google, db)
        _thread(db, google.subject, 'second-thread')
        view = client.get('/api/uony/threads/second-thread/assignment-return').json()
        assert view['resolution'] == 'none' and view['assignments'] == []
        assert client.get('/api/uony/threads/first-thread/assignment-return').status_code == 404
        assert client.delete('/api/uony/threads/second-thread').status_code == 200
        assert client.get('/api/uony/threads/second-thread/assignment-return').status_code == 410


def test_earlier_revision_work_is_not_reported_as_never_started(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'historical-work')
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        _goal(client, 'historical-work', 'Basic Mini Bricks', productId=product['id'])
        with db.connect() as c:
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'basic-folder','ready',%s)''',
                (uuid4(), user_id, product['id'], uuid4(), google.subject, Jsonb({})))
        edited = client.patch('/api/products/BASIC', json={
            'revision': 1, 'name': 'Basic Mini Bricks revisado'})
        assert edited.status_code == 200 and edited.json()['product']['revision'] == 2
        item = client.get('/api/uony/threads/historical-work/assignment-return').json()['assignments'][0]
        assert item['product']['revision'] == 2
        assert item['work'] is None
        assert item['workLabel'] == 'Trabajo guardado de una revisión anterior'


def test_return_keeps_product_revision_stable_while_reading_work(environment, monkeypatch):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'concurrent-work')
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        _goal(client, 'concurrent-work', 'Basic Mini Bricks', productId=product['id'])
        with db.connect() as c:
            job_id = uuid4()
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'basic-folder','ready',%s)''',
                (job_id, user_id, product['id'], uuid4(), google.subject, Jsonb({})))

        original = uony_assignments._current_product_work
        writer_blocked = []

        def competing_edit():
            try:
                with db.connect() as c:
                    c.execute("SET LOCAL lock_timeout = '250ms'")
                    c.execute('UPDATE products SET revision=revision+1 WHERE user_id=%s AND id=%s',
                              (user_id, product['id']))
            except LockNotAvailable:
                return True
            return False

        def read_work(c, user, linked_product):
            with ThreadPoolExecutor(max_workers=1) as pool:
                writer_blocked.append(pool.submit(competing_edit).result(timeout=3))
            return original(c, user, linked_product)

        monkeypatch.setattr(uony_assignments, '_current_product_work', read_work)
        response = client.get('/api/uony/threads/concurrent-work/assignment-return')
        assert response.status_code == 200, response.text
        assert writer_blocked == [True]
        item = response.json()['assignments'][0]
        assert item['product']['revision'] == 1
        assert item['work']['id'] == str(job_id)
        assert item['work']['scope'] == 'linked_product_current_revision'
