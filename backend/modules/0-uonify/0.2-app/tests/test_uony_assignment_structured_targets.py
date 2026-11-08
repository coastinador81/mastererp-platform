"""A focused goal cannot execute a typed action against a different product."""
from uuid import uuid4

from psycopg.types.json import Jsonb

from conftest import client_for
from test_google_cloud import Cloud
from test_uony_assignment_conversation_context import CapturingAgent, _focus, _goal, _setup
from test_uony_natural_assignment import GoalAgent, counts, finish, send, setup
from app.product_guide import form_for
from app.products import find, present


def _expected(goal, version=1):
    return {'assignmentId': goal['id'], 'version': version}


def _message(thread, goal, **fields):
    return {'requestId': str(uuid4()), 'threadId': thread,
            'text': 'Continuar', 'expectedAssignmentFocus': _expected(goal), **fields}


def test_focused_a_rejects_product_link_to_b_without_mutation(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=CapturingAgent(), legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'wrong-link')
        a = client.post('/api/products', json={'sku': 'A', 'name': 'Ficha A'}).json()['product']
        b = client.post('/api/products', json={'sku': 'B', 'name': 'Ficha B'}).json()['product']
        goal = _goal(client, 'wrong-link', 'Ficha A', productId=a['id'])
        _focus(client, 'wrong-link', goal, 0)
        response = client.post('/api/uony/messages', json=_message('wrong-link', goal,
            productAction={'action': 'link', 'sku': b['sku'], 'revision': 1,
                           'expectedVersion': 0}))
        assert response.status_code == 409
        assert response.json()['error'] == 'assignment_focus_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_requests').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_thread_products').fetchone()['n'] == 0
            saved = c.execute('''SELECT product_id,version FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user, goal['id'])).fetchone()
            assert str(saved['product_id']) == a['id'] and saved['version'] == 1


def test_explicit_link_claims_unlinked_goal_atomically_and_retryof_conflicts(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=CapturingAgent(), legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'claim-link')
        b = client.post('/api/products', json={'sku': 'B', 'name': 'Ficha B'}).json()['product']
        goal = _goal(client, 'claim-link', 'Producto a elegir')
        _focus(client, 'claim-link', goal, 0)
        body = _message('claim-link', goal, productAction={
            'action': 'link', 'sku': b['sku'], 'revision': 1, 'expectedVersion': 0})
        assert client.post('/api/uony/messages', json=body).status_code == 200
        assert client.post('/api/uony/messages', json=body).status_code == 200
        altered = client.post('/api/uony/messages', json={
            **body, 'retryOf': str(uuid4())})
        assert altered.status_code == 409
        assert altered.json()['error'] == 'request_conflict'
        with db.connect() as c:
            assignment = c.execute('''SELECT product_id,version FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user, goal['id'])).fetchone()
            assert str(assignment['product_id']) == b['id'] and assignment['version'] == 2
            linked = c.execute('''SELECT product_id FROM uony_thread_products
                WHERE user_id=%s AND thread_id='claim-link' ''', (user,)).fetchone()
            assert str(linked['product_id']) == b['id']
            assert c.execute('SELECT count(*) n FROM uony_requests').fetchone()['n'] == 1


def test_focused_a_rejects_b_material_requirements_and_incident_actions(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=CapturingAgent(), legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'wrong-actions')
        a = client.post('/api/products', json={'sku': 'A', 'name': 'Ficha A'}).json()['product']
        b = client.post('/api/products', json={'sku': 'B', 'name': 'Ficha B'}).json()['product']
        goal = _goal(client, 'wrong-actions', 'Ficha A', productId=a['id'])
        _focus(client, 'wrong-actions', goal, 0)
        incident_id = uuid4()
        with db.connect() as c:
            c.execute('''INSERT INTO amazon_incidents(id,user_id,seller_id,marketplace_id,
                sku,issue_key,code,message,severity,raw_issue,product_name,product_id)
                VALUES(%s,%s,'seller','ES','B','wrong-focus','ISSUE','Error de B',
                'error',%s,'Ficha B',%s)''',
                (incident_id, user, Jsonb({}), b['id']))
        actions = (
            {'materialAction': {'action': 'review', 'sku': 'B',
                                'analysisId': str(uuid4())}},
            {'requirementsAction': {'action': 'prepare', 'sku': 'B'}},
            {'incidentAction': {'incidentId': str(incident_id), 'action': 'start'}},
        )
        for action in actions:
            response = client.post('/api/uony/messages', json=_message(
                'wrong-actions', goal, **action))
            assert response.status_code == 409, response.text
            assert response.json()['error'] == 'assignment_focus_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_requests').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_structured_focus_expectations').fetchone()['n'] == 0
            assert c.execute('SELECT revision FROM products WHERE user_id=%s AND id=%s',
                             (user, b['id'])).fetchone()['revision'] == 1


def test_unrelated_pending_intake_blocks_explicit_product_link(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=CapturingAgent(), legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'old-intake')
        b = client.post('/api/products', json={'sku': 'B', 'name': 'Ficha B'}).json()['product']
        with db.connect() as c:
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id)
                VALUES(%s,%s,'old-intake',%s,%s)''',
                (user, uuid4(), google.subject, uuid4()))
        goal = _goal(client, 'old-intake', 'Nuevo encargo A')
        _focus(client, 'old-intake', goal, 0)
        response = client.post('/api/uony/messages', json=_message('old-intake', goal,
            productAction={'action': 'link', 'sku': b['sku'], 'revision': 1,
                           'expectedVersion': 0}))
        assert response.status_code == 409
        assert response.json()['error'] == 'assignment_focus_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_requests').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_thread_products').fetchone()['n'] == 0
            saved = c.execute('''SELECT product_id FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user, goal['id'])).fetchone()
            assert saved['product_id'] is None


def test_old_b_form_is_rejected_but_current_a_form_can_be_answered(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=CapturingAgent(), legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'form-scope')
        a = client.post('/api/products', json={'sku': 'A', 'name': 'Ficha A'}).json()['product']
        b = client.post('/api/products', json={'sku': 'B', 'name': 'Ficha B'}).json()['product']
        with db.connect() as c:
            b_form_id = uuid4()
            b_form = form_for(present(find(c, {'id': user}, 'B')), b_form_id)
            c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,
                status,model,project_id,conversation_form)
                VALUES(%s,%s,'form-scope','Formulario B','Pregunta B','success',
                'uonify-guide','uonify-guide',%s)''', (user,b_form_id,Jsonb(b_form)))
        goal = _goal(client, 'form-scope', 'Ficha A', productId=a['id'])
        _focus(client, 'form-scope', goal, 0)
        old = client.post('/api/uony/messages', json=_message('form-scope', goal,
            formResponse={'formId': str(b_form_id),
                          'answers': {'mode': 'Módulo Producto'}}))
        assert old.status_code == 409
        assert old.json()['error'] == 'assignment_focus_conflict'
        with db.connect() as c:
            a_form_id = uuid4()
            a_form = form_for(present(find(c, {'id': user}, 'A')), a_form_id)
            c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,
                status,model,project_id,conversation_form)
                VALUES(%s,%s,'form-scope','Formulario A','Pregunta A','success',
                'uonify-guide','uonify-guide',%s)''', (user,a_form_id,Jsonb(a_form)))
        current = client.post('/api/uony/messages', json=_message('form-scope', goal,
            formResponse={'formId': str(a_form_id),
                          'answers': {'mode': 'Módulo Producto'}}))
        assert current.status_code == 200, current.text
        with db.connect() as c:
            a_latest = c.execute('SELECT revision FROM products WHERE user_id=%s AND id=%s',
                                 (user,a['id'])).fetchone()['revision']
            b_latest = c.execute('SELECT revision FROM products WHERE user_id=%s AND id=%s',
                                 (user,b['id'])).fetchone()['revision']
            assert a_latest > 1 and b_latest == 1


def test_first_goal_source_question_is_answered_as_text_with_pinned_focus(environment):
    config, google, db = environment

    class SourceAnswerAgent(GoalAgent):
        def generate(self, token, project, history, status, model=None, effort=None):
            if history[-1]['parts'][0]['text'] == 'Tengo una carpeta en Drive':
                self.calls += 1
                self.contexts.append(dict(status))
                return 'Vamos a elegir la carpeta de este encargo.', {
                    'calls': 1, 'attemptedCalls': 1, 'totalTokenCount': 20}
            return super().generate(token, project, history, status, model, effort)

    agent = SourceAnswerAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        created = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        answer = send(client, 'Tengo una carpeta en Drive', created)
        assert 'formResponse' not in answer
        result = finish(client, answer['requestId'])
        assert result['status'] == 'success'
        assert agent.contexts[-1]['assignmentFocus']['id'] == created['assignmentId']
        assert counts(db, user) == [1, 0, 0, 0, 0]
