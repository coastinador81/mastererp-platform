"""H3 first cut: two durable goals, explicit focus and no business execution."""
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from psycopg.errors import RaiseException
from psycopg.types.json import Jsonb

from conftest import client_for, login
from test_account_deletion import body as deletion_body
from test_uony import ready


def _thread(db, subject, *names):
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s', (subject,)).fetchone()
        for name in names:
            c.execute('INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)',
                      (user['id'], name, name))
        return user['id']


def _create(client, thread, label, request_id=None, **extra):
    body = {'requestId': request_id or str(uuid4()), 'threadId': thread,
            'label': label, 'objective': 'Preparar el listado de ' + label, **extra}
    response = client.post('/api/uony/assignments', json=body)
    assert response.status_code == 200, response.text
    return body, response.json()['assignment']


def _select(client, thread, assignment, expected, request_id=None):
    body = {'requestId': request_id or str(uuid4()), 'assignmentId': assignment['id'],
            'expectedVersion': expected}
    response = client.put(f'/api/uony/threads/{thread}/assignment-focus', json=body)
    assert response.status_code == 200, response.text
    return body, response.json()['focus']


def test_two_goals_survive_topic_change_reload_and_new_thread_without_product_or_job(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'main', 'fresh')
        _, basic = _create(client, 'main', 'Basic Mini Bricks')
        _, lamp = _create(client, 'main', 'Lámpara azul')
        assert basic['status'] == lamp['status'] == 'pending'
        assert basic['nextStep'] == lamp['nextStep'] == 'clarify_source'
        assert basic['productId'] is None and basic['intakeId'] is None
        assert _select(client, 'main', basic, 0)[1]['version'] == 1
        assert _select(client, 'main', lamp, 1)[1]['version'] == 2
        # A change of subject in the conversation must not erase either goal.
        with db.connect() as c:
            c.execute('''INSERT INTO uony_requests
                (user_id,request_id,thread_id,prompt,reply,status,model,project_id)
                VALUES(%s,%s,'main','Hablemos de otra cosa','De acuerdo',
                       'success','uonify-guide','uonify-guide')''', (user_id, uuid4()))
            for table in ('products', 'uony_product_intakes', 'product_material_jobs',
                          'product_reasoning_jobs', 'uony_conversation_jobs'):
                assert c.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n'] == 0
        previous = client.get('/api/uony/threads/main/assignment-focus/previous').json()
        assert previous['resolution'] == 'resolved'
        assert previous['assignment']['id'] == basic['id']
        assert client.get('/api/uony/threads/fresh/assignment-focus/previous').json()['resolution'] == 'ambiguous'
    # A new authenticated browser session retrieves the goals without a model call.
    with client_for(config, google) as reloaded:
        login(reloaded, google)
        saved = reloaded.get('/api/uony/assignments').json()['assignments']
        assert {row['id'] for row in saved} == {basic['id'], lamp['id']}
        assert reloaded.get('/api/uony/threads/main/assignment-focus').json()['focus']['current']['id'] == lamp['id']
        choices = reloaded.get('/api/uony/threads/fresh/assignment-focus/previous').json()
        assert {row['id'] for row in choices['options']} == {basic['id'], lamp['id']}
        assert len(choices['options']) == 2 and not choices['moreAvailable']
        assert _select(reloaded, 'fresh', basic, 0)[1]['current']['id'] == basic['id']


def test_create_and_focus_replay_are_idempotent_with_two_tab_version_conflict(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _thread(db, google.subject, 'shared')
        create, first = _create(client, 'shared', 'Primero')
        same = client.post('/api/uony/assignments', json=create)
        assert same.status_code == 200 and same.json()['replayed'] is True
        assert same.json()['assignment']['id'] == first['id']
        with pytest.raises(RaiseException):
            with db.connect() as c:
                c.execute('''UPDATE uony_assignments SET origin_scope=%s WHERE id=%s''',
                          (Jsonb({'productId': str(uuid4()), 'intakeId': None}), first['id']))
        changed = client.post('/api/uony/assignments', json={**create, 'label': 'Distinto'})
        assert changed.status_code == 409 and changed.json()['error'] == 'assignment_request_conflict'
        _, second = _create(client, 'shared', 'Segundo')
        first_request, focus = _select(client, 'shared', first, 0)
        assert focus['current']['id'] == first['id'] and focus['version'] == 1
        stale = client.put('/api/uony/threads/shared/assignment-focus', json={
            'requestId': str(uuid4()), 'assignmentId': second['id'], 'expectedVersion': 0})
        assert stale.status_code == 409 and stale.json()['error'] == 'assignment_focus_conflict'
        second_request, focus = _select(client, 'shared', second, 1)
        assert focus['current']['id'] == second['id'] and focus['previous']['id'] == first['id']
        replay = client.put('/api/uony/threads/shared/assignment-focus', json=first_request)
        assert replay.status_code == 200 and replay.json()['replayed'] is True
        assert replay.json()['focus']['current']['id'] == second['id']
        assert replay.json()['outcome'] == {'assignmentId': first['id'], 'appliedVersion': 1}
        assert client.get('/api/uony/threads/shared/assignment-focus').json()['focus']['current']['id'] == second['id']
        mismatched = client.put('/api/uony/threads/shared/assignment-focus', json={
            **second_request, 'assignmentId': first['id']})
        assert mismatched.status_code == 409 and mismatched.json()['error'] == 'assignment_request_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_assignments').fetchone()['n'] == 2
            assert c.execute('SELECT count(*) n FROM uony_assignment_focus_requests').fetchone()['n'] == 2


def test_two_sessions_racing_create_and_focus_get_replay_or_conflict_not_500(environment):
    config, google, db = environment
    with client_for(config, google) as first:
        ready(first, google, db)
        _thread(db, google.subject, 'parallel')
        with client_for(config, google) as second:
            login(second, google)
            body = {'requestId': str(uuid4()), 'threadId': 'parallel',
                    'label': 'Basic', 'objective': 'Preparar Basic'}
            barrier = Barrier(2)

            def create(client):
                barrier.wait(timeout=5)
                return client.post('/api/uony/assignments', json=body)

            with ThreadPoolExecutor(max_workers=2) as pool:
                a, b = list(pool.map(create, (first, second)))
            assert a.status_code == b.status_code == 200
            assert a.json()['assignment']['id'] == b.json()['assignment']['id']
            assert {a.json()['replayed'], b.json()['replayed']} == {False, True}
            chosen = a.json()['assignment']
            _, other = _create(first, 'parallel', 'Segundo')
            one = {'requestId': str(uuid4()), 'assignmentId': chosen['id'], 'expectedVersion': 0}
            two = {'requestId': str(uuid4()), 'assignmentId': other['id'], 'expectedVersion': 0}
            barrier = Barrier(2)

            def select(pair):
                client, payload = pair
                barrier.wait(timeout=5)
                return client.put('/api/uony/threads/parallel/assignment-focus', json=payload)

            with ThreadPoolExecutor(max_workers=2) as pool:
                a, b = list(pool.map(select, ((first, one), (second, two))))
            assert sorted((a.status_code, b.status_code)) == [200, 409]
            loser = a if a.status_code == 409 else b
            assert loser.json()['error'] == 'assignment_focus_conflict'
            with db.connect() as c:
                assert c.execute('SELECT count(*) n FROM uony_assignments').fetchone()['n'] == 2
                assert c.execute('SELECT count(*) n FROM uony_assignment_focus').fetchone()['n'] == 1
                assert c.execute('SELECT count(*) n FROM uony_assignment_focus_requests').fetchone()['n'] == 1


def test_account_and_subject_isolation_and_thread_deletion_preserve_goal(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _thread(db, google.subject, 'owner')
        _, assignment = _create(client, 'owner', 'Privado')
        product = client.post('/api/products', json={'sku': 'PRIVATE', 'name': 'Producto privado'})
        assert product.status_code == 200
        _select(client, 'owner', assignment, 0)
        google.subject = 'google-test-two'
        google.email = 'two@example.test'
        ready(client, google, db)
        _thread(db, google.subject, 'other')
        assert client.get('/api/uony/assignments').json()['assignments'] == []
        assert client.get('/api/uony/assignments/' + assignment['id']).status_code == 404
        denied = client.put('/api/uony/threads/other/assignment-focus', json={
            'requestId': str(uuid4()), 'assignmentId': assignment['id'], 'expectedVersion': 0})
        assert denied.status_code == 404
        foreign_reference = client.post('/api/uony/assignments', json={
            'requestId': str(uuid4()), 'threadId': 'other', 'label': 'Ajeno',
            'objective': 'No debe enlazar una ficha ajena',
            'productId': product.json()['product']['id']})
        assert foreign_reference.status_code == 404
        google.subject = 'google-test-one'
        google.email = 'one@example.test'
        login(client, google)
        assert client.delete('/api/uony/threads/owner').status_code == 200
        assert client.get('/api/uony/assignments/' + assignment['id']).json()['assignment']['label'] == 'Privado'
        assert client.get('/api/uony/threads/owner/assignment-focus').status_code == 410
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_assignment_focus').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_assignment_focus_requests').fetchone()['n'] == 0


def test_account_deletion_removes_assignment_focus_and_replay_rows(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'delete-me')
        product = client.post('/api/products', json={'sku': 'DELETE-ME', 'name': 'Producto privado'})
        assert product.status_code == 200
        _, assignment = _create(client, 'delete-me', 'Producto privado',
                                productId=product.json()['product']['id'])
        _select(client, 'delete-me', assignment, 0)
        result = client.post('/api/account/deletion', json=deletion_body(client))
        assert result.status_code == 200 and result.json()['status'] == 'deleted', result.text
        with db.connect() as c:
            for table in ('uony_assignments', 'uony_assignment_focus',
                          'uony_assignment_focus_requests'):
                assert c.execute(f'SELECT count(*) n FROM {table} WHERE user_id=%s',
                                 (user_id,)).fetchone()['n'] == 0


def test_deleting_thread_clears_only_the_deleted_intake_reference(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'materials', 'continuation')
        intake_id = uuid4()
        with db.connect() as c:
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id)
                VALUES(%s,%s,'materials',%s,%s)''',
                (user_id, intake_id, google.subject, uuid4()))
        _, assignment = _create(client, 'materials', 'Producto con carpeta',
                                intakeId=str(intake_id))
        assert assignment['intakeId'] == str(intake_id)
        assert client.delete('/api/uony/threads/materials').status_code == 200
        saved = client.get('/api/uony/assignments/' + assignment['id']).json()['assignment']
        assert saved['intakeId'] is None and saved['version'] == 2
        assert _select(client, 'continuation', saved, 0)[1]['current']['id'] == assignment['id']


def test_physical_thread_cleanup_keeps_goal_and_source_provenance(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'historical', 'new-home')
        _, assignment = _create(client, 'historical', 'Meta duradera')
        with db.connect() as c:
            c.execute('DELETE FROM uony_threads WHERE user_id=%s AND id=%s',
                      (user_id, 'historical'))
            row = c.execute('''SELECT origin_thread_id FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user_id, assignment['id'])).fetchone()
            assert row['origin_thread_id'] == 'historical'
        assert _select(client, 'new-home', assignment, 0)[1]['current']['id'] == assignment['id']


def test_product_deletion_forgets_linked_goals_and_focus_history(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        user_id = _thread(db, google.subject, 'one', 'two')
        product = client.post('/api/products', json={'sku': 'DELETE-PRIVATE',
                                                      'name': 'Ficha privada'})
        assert product.status_code == 200
        product_id = product.json()['product']['id']
        intake_id = uuid4()
        with db.connect() as c:
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id,product_id,
                 status,folder_id,folder_metadata)
                VALUES(%s,%s,'one',%s,%s,%s,'linked','sample',
                    '{"id":"sample","name":"Carpeta"}'::jsonb)''',
                (user_id, intake_id, google.subject, uuid4(), product_id))
        _, direct = _create(client, 'one', 'Nombre privado', productId=product_id)
        _, through_intake = _create(client, 'one', 'Carpeta privada', intakeId=str(intake_id))
        _, unrelated = _create(client, 'one', 'Otra tarea')
        first_request, _ = _select(client, 'one', direct, 0)
        _select(client, 'one', unrelated, 1)
        _select(client, 'two', through_intake, 0)
        assert client.delete('/api/products/DELETE-PRIVATE').status_code == 200
        assert client.get('/api/uony/assignments/' + direct['id']).status_code == 404
        assert client.get('/api/uony/assignments/' + through_intake['id']).status_code == 404
        saved = client.get('/api/uony/assignments').json()['assignments']
        assert [row['id'] for row in saved] == [unrelated['id']]
        focus = client.get('/api/uony/threads/one/assignment-focus').json()['focus']
        assert focus['current']['id'] == unrelated['id'] and focus['previous'] is None
        assert focus['version'] == 3
        assert client.get('/api/uony/threads/two/assignment-focus').json()['focus']['current'] is None
        # A deleted goal's old request cannot replay its label into the chat.
        assert client.put('/api/uony/threads/one/assignment-focus',
                          json=first_request).status_code == 404
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_assignment_focus_requests').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_assignments').fetchone()['n'] == 1
