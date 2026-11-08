"""The selected goal is bounded conversation data, never a tool authorization."""
from uuid import uuid4

from psycopg.types.json import Jsonb

from conftest import client_for, login
from test_google_cloud import Cloud
from test_uony import Agent, ready
from test_uony_conversation_queue import connected
from app.uony_provider import request_payload


class CapturingAgent(Agent):
    def __init__(self):
        super().__init__()
        self.contexts = []
        self.histories = []

    def generate(self, token, project, history, status, model=None, effort=None):
        self.contexts.append(dict(status))
        self.histories.append(history)
        return super().generate(token, project, history, status, model, effort)


def _setup(client, google, db, config, *threads):
    ready(client, google, db)
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                         (google.subject,)).fetchone()['id']
        connected(c, user, google, config)
        for thread in threads:
            c.execute('INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)',
                      (user, thread, thread))
    return user


def _goal(client, thread, label, **extra):
    response = client.post('/api/uony/assignments', json={
        'requestId': str(uuid4()), 'threadId': thread, 'label': label,
        'objective': 'Preparar ' + label, **extra})
    assert response.status_code == 200, response.text
    return response.json()['assignment']


def _focus(client, thread, goal, expected):
    response = client.put(f'/api/uony/threads/{thread}/assignment-focus', json={
        'requestId': str(uuid4()), 'assignmentId': goal['id'],
        'expectedVersion': expected})
    assert response.status_code == 200, response.text


def _queue(client, thread, text='Sigue con lo que te pedí'):
    request_id = str(uuid4())
    focus = client.get(f'/api/uony/threads/{thread}/assignment-focus').json()['focus']
    expected = ({'assignmentId': focus['current']['id'], 'version': focus['version']}
                if focus['current'] else None)
    response = client.post('/api/uony/messages', json={
        'requestId': request_id, 'threadId': thread, 'text': text,
        **({'expectedAssignmentFocus': expected} if expected else {})})
    assert response.status_code == 202, response.text
    return request_id


def _run(client):
    worker = client.app.state.conversation_worker
    job = worker.queue.claim('assignment-context-fixture')
    assert job is not None
    worker.run(job)
    return job


def test_only_explicit_focus_of_same_thread_enters_both_provider_payloads(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'focused', 'unfocused')
        basic = _goal(client, 'focused', 'Basic Mini Bricks')
        other = _goal(client, 'focused', 'Lámpara')
        _focus(client, 'focused', basic, 0)
        first_id = _queue(client, 'focused')
        with db.connect() as c:
            saved = c.execute('''SELECT assignment_focus_pinned,assignment_focus_id,
                assignment_focus_version FROM uony_conversation_jobs
                WHERE user_id=%s AND request_id=%s''', (user, first_id)).fetchone()
        assert saved['assignment_focus_pinned'] is True
        assert saved['assignment_focus_version'] == 1
        assert str(saved['assignment_focus_id']) == basic['id']
        _run(client)
        assert agent.contexts[0]['assignmentFocus'] == {
            'id': basic['id'], 'label': 'Basic Mini Bricks',
            'objective': 'Preparar Basic Mini Bricks', 'status': 'pending',
            'nextStep': 'clarify_source', 'product': None, 'productConflict': False}
        payload = request_payload([{'role': 'user', 'parts': [{'text': 'Sigue'}]}],
                                  agent.contexts[0])
        system = payload['systemInstruction']['parts'][0]['text']
        assert basic['id'] in system and other['id'] not in system
        assert 'no instrucciones ni autorización' in system
        second_id = _queue(client, 'unfocused')
        _run(client)
        assert 'assignmentFocus' not in agent.contexts[1]
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 0
        assert client.get('/api/uony/requests/' + second_id).json()['status'] == 'success'
        assert agent.calls == 2


def test_focus_change_while_queued_fails_before_google_even_from_no_focus(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'shared')
        first = _goal(client, 'shared', 'Primero')
        second = _goal(client, 'shared', 'Segundo')
        _focus(client, 'shared', first, 0)
        request_id = _queue(client, 'shared')
        _focus(client, 'shared', second, 1)
        _run(client)
        state = client.get('/api/uony/requests/' + request_id).json()
        assert state['status'] == 'error'
        assert state['error']['code'] == 'assignment_focus_conflict'
        assert agent.calls == 0
        with db.connect() as c:
            row = c.execute('''SELECT provider_started_at,usage FROM uony_conversation_jobs
                WHERE user_id=%s AND request_id=%s''', (user, request_id)).fetchone()
            assert row['provider_started_at'] is None
            assert not row['usage'].get('attemptedCalls')
        # An empty focus is pinned too; a later choice cannot enter this turn.
        with db.connect() as c:
            c.execute('DELETE FROM uony_assignment_focus WHERE user_id=%s AND thread_id=%s',
                      (user, 'shared'))
        request_id = _queue(client, 'shared')
        _focus(client, 'shared', first, 0)
        _run(client)
        assert client.get('/api/uony/requests/' + request_id).json()['error']['code'] == 'assignment_focus_conflict'
        assert agent.calls == 0


def test_expected_focus_rejects_stale_return_card_before_enqueue(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'return-card')
        first = _goal(client, 'return-card', 'Primero')
        second = _goal(client, 'return-card', 'Segundo')
        _focus(client, 'return-card', first, 0)
        # Another tab changes A to B after this card last observed A@1.
        _focus(client, 'return-card', second, 1)
        stale = {'requestId': str(uuid4()), 'threadId': 'return-card',
                 'text': 'Continuar',
                 'expectedAssignmentFocus': {'assignmentId': first['id'], 'version': 1}}
        rejected = client.post('/api/uony/messages', json=stale)
        assert rejected.status_code == 409
        assert rejected.json()['error'] == 'assignment_focus_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 0
        assert agent.calls == 0
        current = {**stale, 'expectedAssignmentFocus': {
            'assignmentId': second['id'], 'version': 2}}
        assert client.post('/api/uony/messages', json=current).status_code == 202
        assert client.post('/api/uony/messages', json=current).status_code == 202
        assert client.post('/api/uony/messages', json={
            **current, 'expectedAssignmentFocus': {
                'assignmentId': first['id'], 'version': 1}}).status_code == 409
        _run(client)
        assert agent.contexts[0]['assignmentFocus']['id'] == second['id']
        assert agent.calls == 1
        with db.connect() as c:
            assert c.execute('''SELECT assignment_focus_version FROM uony_conversation_jobs
                WHERE user_id=%s AND request_id=%s''',
                (user, stale['requestId'])).fetchone()['assignment_focus_version'] == 2


def test_new_tab_requires_focus_expectation_before_any_message_or_action(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'fresh-tab')
        product = client.post('/api/products', json={
            'sku': 'FRESH', 'name': 'Ficha de prueba'}).json()['product']
        goal = _goal(client, 'fresh-tab', 'Ficha de prueba', productId=product['id'])
        _focus(client, 'fresh-tab', goal, 0)
        message = {'requestId': str(uuid4()), 'threadId': 'fresh-tab',
                   'text': 'Continuar con esta ficha'}
        missing = client.post('/api/uony/messages', json=message)
        assert missing.status_code == 409
        assert missing.json()['error'] == 'assignment_focus_required'
        action = {**message, 'requestId': str(uuid4()), 'productAction': {
            'action': 'link', 'sku': 'FRESH', 'revision': 1, 'expectedVersion': 0}}
        missing_action = client.post('/api/uony/messages', json=action)
        assert missing_action.status_code == 409
        assert missing_action.json()['error'] == 'assignment_focus_required'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM uony_thread_products').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM uony_structured_focus_expectations').fetchone()['n'] == 0
        assert agent.calls == 0


def test_structured_action_focus_cas_and_exact_replay(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=CapturingAgent(), legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'structured')
        product = client.post('/api/products', json={
            'sku': 'STRUCT', 'name': 'Ficha de prueba'}).json()['product']
        first = _goal(client, 'structured', 'Primero', productId=product['id'])
        second = _goal(client, 'structured', 'Segundo')
        _focus(client, 'structured', first, 0)
        action = {'requestId': str(uuid4()), 'threadId': 'structured',
                  'text': 'Continuar con esta ficha',
                  'productAction': {'action': 'link', 'sku': 'STRUCT',
                                    'revision': 1, 'expectedVersion': 0},
                  'expectedAssignmentFocus': {'assignmentId': first['id'], 'version': 1}}
        _focus(client, 'structured', second, 1)
        stale = client.post('/api/uony/messages', json=action)
        assert stale.status_code == 409
        assert stale.json()['error'] == 'assignment_focus_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_thread_products').fetchone()['n'] == 0
        current = {**action, 'expectedAssignmentFocus': {
            'assignmentId': second['id'], 'version': 2}}
        assert client.post('/api/uony/messages', json=current).status_code == 200
        assert client.post('/api/uony/messages', json=current).status_code == 200
        assert client.post('/api/uony/messages', json=action).status_code == 409
        assert client.post('/api/uony/messages', json={
            key: value for key, value in current.items()
            if key != 'expectedAssignmentFocus'}).status_code == 409
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_thread_products').fetchone()['n'] == 1
            saved = c.execute('''SELECT assignment_id,focus_version FROM
                uony_structured_focus_expectations WHERE user_id=%s AND request_id=%s''',
                (user, action['requestId'])).fetchone()
            assert str(saved['assignment_id']) == second['id']
            assert saved['focus_version'] == 2


def test_old_payload_replay_treats_missing_expected_focus_as_null(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'old-payload')
        message = {'requestId': str(uuid4()), 'threadId': 'old-payload',
                   'text': 'Continúa mi consulta'}
        assert client.post('/api/uony/messages', json=message).status_code == 202
        with db.connect() as c:
            c.execute('''UPDATE uony_conversation_jobs
                SET payload=payload-'expectedAssignmentFocus'
                WHERE user_id=%s AND request_id=%s''', (user, message['requestId']))
        assert client.post('/api/uony/messages', json=message).status_code == 202
        changed = {**message, 'expectedAssignmentFocus': {
            'assignmentId': str(uuid4()), 'version': 1}}
        response = client.post('/api/uony/messages', json=changed)
        assert response.status_code == 409
        assert response.json()['error'] == 'request_conflict'
        assert agent.calls == 0


def test_mid_provider_focus_change_cannot_commit_reply_or_proposal(environment):
    config, google, db = environment

    class SwitchingAgent(CapturingAgent):
        def generate(self, token, project, history, status, model=None, effort=None):
            with db.connect() as c:
                c.execute('''UPDATE uony_assignment_focus SET assignment_id=%s,
                    previous_assignment_id=%s,version=version+1,updated_at=now()
                    WHERE user_id=%s AND thread_id='midflight' ''',
                    (other['id'], first['id'], user))
            return super().generate(token, project, history, status, model, effort)

    agent = SwitchingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'midflight')
        first = _goal(client, 'midflight', 'Primero')
        other = _goal(client, 'midflight', 'Segundo')
        _focus(client, 'midflight', first, 0)
        request_id = _queue(client, 'midflight')
        _run(client)
        state = client.get('/api/uony/requests/' + request_id).json()
        assert state['status'] == 'error'
        assert state['error']['code'] == 'assignment_focus_conflict'
        assert agent.calls == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_product_proposals').fetchone()['n'] == 0
            assert c.execute('''SELECT reply FROM uony_requests WHERE user_id=%s
                AND request_id=%s''', (user, request_id)).fetchone()['reply'] is None


def test_focused_other_product_blocks_product_tools_without_changing_thread_link(environment):
    config, google, db = environment

    class ConflictingAgent(CapturingAgent):
        def generate(self, token, project, history, status, model=None, effort=None):
            if 'assignmentFocus' not in status:
                return super().generate(token, project, history, status, model, effort)
            assert status['assignmentFocus']['productConflict'] is True
            names = {item['name'] for item in status.declarations}
            assert {'create_product', 'update_product', 'link_product_to_thread',
                    'start_product_guide'}.isdisjoint(names)
            for name, args in (
                    ('create_product', {'name': 'Erróneo', 'sku': 'WRONG'}),
                    ('update_product', {'sku': 'A', 'revision': 1, 'changes': {'name': 'Erróneo'}}),
                    ('link_product_to_thread', {'sku': 'B', 'revision': 1})):
                assert status.call(name, args)['error'] == 'assignment_product_conflict'
            assert status.call('get_product', {'sku': 'A'})['error'] == 'assignment_product_conflict'
            assert status.call('get_product', {'sku': 'B'})['product']['sku'] == 'B'
            return super().generate(token, project, history, status, model, effort)

    agent = ConflictingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'mixed-product')
        first = client.post('/api/products', json={'sku': 'A', 'name': 'Ficha A'}).json()['product']
        second = client.post('/api/products', json={'sku': 'B', 'name': 'Ficha B'}).json()['product']
        with db.connect() as c:
            c.execute('''INSERT INTO uony_thread_products
                (user_id,thread_id,product_id,google_subject,linked_revision,source)
                VALUES(%s,'mixed-product',%s,%s,1,'conversation')''',
                (user, first['id'], google.subject))
        _queue(client, 'mixed-product', 'La ficha A tiene color rojo')
        _run(client)
        goal = _goal(client, 'mixed-product', 'Ficha B', productId=second['id'])
        _focus(client, 'mixed-product', goal, 0)
        request_id = _queue(client, 'mixed-product', 'Sigue con la otra ficha')
        _run(client)
        assert client.get('/api/uony/requests/' + request_id).json()['status'] == 'success'
        payload = request_payload(agent.histories[-1], agent.contexts[-1])
        system = payload['systemInstruction']['parts'][0]['text']
        assert 'Ficha A' not in system
        assert 'La ficha A tiene color rojo' not in str(payload['contents'])
        assert 'productConflict' in system and 'Ficha B' in system
        with db.connect() as c:
            linked = c.execute('''SELECT product_id FROM uony_thread_products
                WHERE user_id=%s AND thread_id='mixed-product' ''', (user,)).fetchone()
            assert str(linked['product_id']) == first['id']
            assert c.execute('SELECT count(*) AS n FROM uony_product_proposals').fetchone()['n'] == 0


def test_unrelated_pending_intake_is_hidden_and_cannot_be_claimed_by_focus(environment):
    config, google, db = environment

    class GuardedAgent(CapturingAgent):
        def generate(self, token, project, history, status, model=None, effort=None):
            assert status['assignmentFocus']['productConflict'] is True
            assert 'productIntake' not in status
            assert status.call('show_product_intake', {})['error'] == 'assignment_product_conflict'
            return super().generate(token, project, history, status, model, effort)

    agent = GuardedAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'other-intake')
        with db.connect() as c:
            other_id = uuid4()
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id,status,
                 folder_id,folder_metadata)
                VALUES(%s,%s,'other-intake',%s,%s,'identified','secret-folder',%s)''',
                (user, other_id, google.subject, uuid4(),
                 Jsonb({'id': 'secret-folder', 'name': 'Private B materials'})))
        goal = _goal(client, 'other-intake', 'Encargo A')
        _focus(client, 'other-intake', goal, 0)
        _queue(client, 'other-intake', 'Continúa mi encargo')
        _run(client)
        system = request_payload(agent.histories[-1], agent.contexts[-1])[
            'systemInstruction']['parts'][0]['text']
        assert 'Private B materials' not in system
        with db.connect() as c:
            assert c.execute('''SELECT intake_id FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user, goal['id'])).fetchone()['intake_id'] is None
            saved = c.execute('''SELECT id,status,folder_id FROM uony_product_intakes
                WHERE user_id=%s AND id=%s''', (user, other_id)).fetchone()
            assert saved['id'] == other_id and saved['status'] == 'identified'
            assert saved['folder_id'] == 'secret-folder'


def test_new_intake_prepared_under_focus_is_linked_causally(environment):
    config, google, db = environment

    class IntakeAgent(CapturingAgent):
        def generate(self, token, project, history, status, model=None, effort=None):
            if self.calls == 0:
                assert status['assignmentFocus']['productConflict'] is False
                assert status.call('show_product_intake', {})['prepared'] is True
            return super().generate(token, project, history, status, model, effort)

    agent = IntakeAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'causal-intake')
        goal = _goal(client, 'causal-intake', 'Encargo A')
        _focus(client, 'causal-intake', goal, 0)
        first_id = _queue(client, 'causal-intake', 'Tengo fotos en Drive')
        _run(client)
        assert client.get('/api/uony/requests/' + first_id).json()['status'] == 'success'
        with db.connect() as c:
            assignment = c.execute('''SELECT intake_id,version FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user, goal['id'])).fetchone()
            assert assignment['intake_id'] is not None and assignment['version'] == 2
            intake = c.execute('''SELECT origin_request_id,status FROM uony_product_intakes
                WHERE user_id=%s AND id=%s''', (user, assignment['intake_id'])).fetchone()
            assert str(intake['origin_request_id']) == first_id
            assert intake['status'] == 'selecting'
        second_id = _queue(client, 'causal-intake', 'Sigo con esa carpeta')
        _run(client)
        assert client.get('/api/uony/requests/' + second_id).json()['status'] == 'success'
        assert agent.contexts[-1]['assignmentFocus']['productConflict'] is False
        assert agent.contexts[-1]['productIntake']['status'] == 'selecting'


def test_other_google_account_same_thread_id_cannot_receive_saved_goal(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        _setup(client, google, db, config, 'shared-thread')
        goal = _goal(client, 'shared-thread', 'Privado')
        _focus(client, 'shared-thread', goal, 0)
        google.subject, google.email = 'second-subject', 'second@example.test'
        _setup(client, google, db, config, 'shared-thread')
        _queue(client, 'shared-thread')
        _run(client)
        assert 'assignmentFocus' not in agent.contexts[0]
        assert goal['id'] not in request_payload([], agent.contexts[0])[
            'systemInstruction']['parts'][0]['text']
        assert agent.calls == 1


def test_pre_migration_unpinned_job_never_inherits_later_focus(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'legacy')
        goal = _goal(client, 'legacy', 'Privado')
        request_id = _queue(client, 'legacy')
        with db.connect() as c:
            c.execute('''UPDATE uony_conversation_jobs SET assignment_focus_pinned=false,
                assignment_focus_id=NULL,assignment_focus_version=NULL
                WHERE user_id=%s AND request_id=%s''', (user, request_id))
        _focus(client, 'legacy', goal, 0)
        _run(client)
        assert 'assignmentFocus' not in agent.contexts[0]
        assert agent.calls == 1


def test_old_material_revision_is_never_reported_as_current_focus(environment):
    config, google, db = environment
    agent = CapturingAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = _setup(client, google, db, config, 'revisions')
        product = client.post('/api/products', json={
            'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        goal = _goal(client, 'revisions', 'Basic Mini Bricks', productId=product['id'])
        _focus(client, 'revisions', goal, 0)
        with db.connect() as c:
            job_id = uuid4()
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'basic-folder','ready',%s)''',
                (job_id, user, product['id'], uuid4(), google.subject, Jsonb({})))
            c.execute('''INSERT INTO uony_assignment_material_jobs
                (user_id,assignment_id,google_subject,product_id,material_job_id,origin_request_id)
                VALUES(%s,%s,%s,%s,%s,%s)''',
                (user, goal['id'], google.subject, product['id'], job_id, uuid4()))
        changed = client.patch('/api/products/BASIC', json={
            'revision': 1, 'name': 'Basic Mini Bricks corregido'})
        assert changed.status_code == 200 and changed.json()['product']['revision'] == 2
        _queue(client, 'revisions')
        _run(client)
        focus = agent.contexts[0]['assignmentFocus']
        assert focus['status'] == 'pending' and focus['nextStep'] == 'select_folder'
        assert focus['product'] == {'id': product['id'], 'sku': 'BASIC', 'revision': 2}
        assert agent.calls == 1


