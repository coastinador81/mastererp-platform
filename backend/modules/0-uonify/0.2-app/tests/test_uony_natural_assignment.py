"""A natural request remembers a goal without creating or analyzing a product."""
from uuid import uuid4
import pytest

from conftest import client_for, login
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_conversation_queue import connected
from app.google_cloud_provider import CloudError


USAGE = {'calls': 1, 'attemptedCalls': 1, 'totalTokenCount': 30}


class GoalAgent:
    def __init__(self):
        self.calls = 0
        self.tool_results = []
        self.contexts = []
        self.fail_after_tool = False
        self.extra_intake = False
        self.intake_first = False
        self.forced_source = None

    def generate(self, token, project, history, status, model=None, effort=None):
        self.calls += 1
        self.contexts.append(dict(status))
        text = history[-1]['parts'][0]['text']
        if text.startswith(('Sigue', 'Tengo una carpeta')):
            return 'Seguimos con el encargo seleccionado.', USAGE
        label = ('Basic Mini Bricks' if 'Basic Mini Bricks' in text else
                 'Lámpara' if 'Lámpara' in text else 'Producto en Amazon')
        source = self.forced_source or ('materials' if 'Drive' in text else
                                        'from_scratch' if 'desde cero' in text else 'unknown')
        if self.intake_first:
            self.tool_results.append(status.call('show_product_intake', {}))
        self.tool_results.append(status.call('remember_assignment', {
            'kind': 'amazon_product', 'label': label,
            'intentQuote': text, 'startingPoint': source}))
        if self.extra_intake:
            self.tool_results.append(status.call('show_product_intake', {}))
        if self.fail_after_tool:
            raise CloudError('invalid_response')
        return 'Respuesta del modelo no autoritativa.', USAGE


def setup(client, google, db, config):
    ready(client, google, db)
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                         (google.subject,)).fetchone()['id']
        connected(c, user, google, config)
        c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'goal-chat','Encargos')", (user,))
    return user


def send(client, text, expected=None, request_id=None):
    body = {'requestId': request_id or str(uuid4()), 'threadId': 'goal-chat', 'text': text}
    if expected:
        body['expectedAssignmentFocus'] = expected
    result = client.post('/api/uony/messages', json=body)
    assert result.status_code == 202, result.text
    return body


def finish(client, request_id):
    worker = client.app.state.conversation_worker
    job = worker.queue.claim('natural-goal-fixture')
    assert job is not None
    worker.run(job)
    return client.get('/api/uony/requests/' + request_id).json()


def counts(db, user):
    with db.connect() as c:
        names = ('uony_assignments', 'products', 'uony_product_intakes',
                 'product_material_jobs', 'product_reasoning_jobs')
        return [c.execute('SELECT count(*) AS n FROM ' + name + ' WHERE user_id=%s',
                          (user,)).fetchone()['n'] for name in names]


def test_first_natural_request_saves_goal_and_focus_in_successful_turn(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        body = send(client, 'Quiero crear un producto en Amazon')
        assert counts(db, user) == [0, 0, 0, 0, 0]
        result = finish(client, body['requestId'])
        assert result['status'] == 'success'
        assert 'He guardado el encargo' in result['response']['reply']
        assert '¿Tienes fotos o documentos' in result['response']['reply']
        assert agent.tool_results == [{'prepared': True, 'message':
            'Guardaré solo el objetivo y el punto de partida. Aún no he creado una ficha, leído Drive ni iniciado un análisis.'}]
        focus = result['response']['createdAssignmentFocus']
        assert focus['version'] == 1
        assert counts(db, user) == [1, 0, 0, 0, 0]
        returned = client.get('/api/uony/threads/goal-chat/assignment-return').json()
        assert returned['resolution'] == 'focused'
        assert returned['assignments'][0]['assignment']['id'] == focus['assignmentId']
        assert returned['assignments'][0]['assignmentWork'] is None
        assert client.post('/api/uony/messages', json=body).status_code == 200
        assert counts(db, user) == [1, 0, 0, 0, 0]
        assert agent.calls == 1


def test_basic_mini_bricks_chat_goal_survives_reload_and_request_replay_without_work(environment):
    config, google, db = environment
    agent = GoalAgent()
    text = 'Quiero crear Basic Mini Bricks como producto en Amazon'
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        body = send(client, text)
        assert counts(db, user) == [0, 0, 0, 0, 0]
        completed = finish(client, body['requestId'])
        assert completed['status'] == 'success'
        assert 'Basic Mini Bricks' in completed['response']['reply']
        receipt = completed['response']['createdAssignmentFocus']
        assert receipt['version'] == 1
        first_return = client.get('/api/uony/threads/goal-chat/assignment-return').json()
        assert first_return['resolution'] == 'focused'
        assert first_return['focusVersion'] == 1
        assert len(first_return['assignments']) == 1
        assert first_return['assignments'][0]['assignment']['id'] == receipt['assignmentId']
        assert first_return['assignments'][0]['assignment']['label'] == 'Basic Mini Bricks'
        assert first_return['assignments'][0]['product'] is None
        assert first_return['assignments'][0]['assignmentWork'] is None
        assert counts(db, user) == [1, 0, 0, 0, 0]
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as reloaded:
        login(reloaded, google)
        replay = reloaded.post('/api/uony/messages', json=body)
        assert replay.status_code == 200, replay.text
        saved = reloaded.get('/api/uony/requests/' + body['requestId']).json()
        assert saved['response']['createdAssignmentFocus'] == receipt
        returned = reloaded.get('/api/uony/threads/goal-chat/assignment-return').json()
        assert returned['resolution'] == 'focused'
        assert returned['focusVersion'] == 1
        assert [item['assignment']['id'] for item in returned['assignments']] == [receipt['assignmentId']]
        assert returned['assignments'][0]['product'] is None
        assert returned['assignments'][0]['assignmentWork'] is None
        assert counts(db, user) == [1, 0, 0, 0, 0]
        assert agent.calls == 1


def test_repeating_generic_request_does_not_create_second_goal(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        created = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        again = send(client, 'Quiero crear un producto en Amazon', created)
        result = finish(client, again['requestId'])
        assert result['status'] == 'success'
        assert 'ya estaba guardado' in result['response']['reply']
        assert 'createdAssignmentFocus' not in result['response']
        assert counts(db, user) == [1, 0, 0, 0, 0]
        current = client.get('/api/uony/threads/goal-chat/assignment-focus').json()['focus']
        assert current['version'] == 1 and current['current']['id'] == created['assignmentId']


def test_explicit_second_generic_goal_creates_once_and_repeated_text_reuses_it(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        focus_a = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        text = 'Quiero crear otro producto en Amazon'
        second = send(client, text, focus_a)
        focus_b = finish(client, second['requestId'])['response']['createdAssignmentFocus']
        assert focus_b['assignmentId'] != focus_a['assignmentId']
        assert focus_b['version'] == 2
        assert counts(db, user) == [2, 0, 0, 0, 0]
        assert client.post('/api/uony/messages', json=second).status_code == 200
        repeated = send(client, text, focus_b)
        response = finish(client, repeated['requestId'])
        assert response['status'] == 'success'
        assert 'ya estaba guardado' in response['response']['reply']
        assert 'createdAssignmentFocus' not in response['response']
        assert counts(db, user) == [2, 0, 0, 0, 0]
        selected = client.get('/api/uony/threads/goal-chat/assignment-focus').json()['focus']
        assert selected['current']['id'] == focus_b['assignmentId']
        assert selected['version'] == 2


def test_ambiguous_generic_request_asks_in_chat_without_mutation(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        focus = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        unclear = send(client, 'Necesito preparar un producto en Amazon', focus)
        result = finish(client, unclear['requestId'])
        assert result['status'] == 'success'
        assert '¿Quieres continuar el encargo' in result['response']['reply']
        assert 'createdAssignmentFocus' not in result['response']
        assert counts(db, user) == [1, 0, 0, 0, 0]
        selected = client.get('/api/uony/threads/goal-chat/assignment-focus').json()['focus']
        assert selected['current']['id'] == focus['assignmentId']
        assert selected['version'] == focus['version']
        assert client.post('/api/uony/messages', json=unclear).status_code == 200
        assert counts(db, user) == [1, 0, 0, 0, 0]


def test_denial_hypothetical_quote_and_consultation_do_not_create_goal(environment):
    config, google, db = environment
    agent = GoalAgent()
    texts = ('No quiero crear un producto en Amazon',
             '¿Y si quisiera crear un producto en Amazon?',
             '«Quiero crear un producto en Amazon»',
             '"Quiero crear un producto en Amazon"',
             'Quiero saber cómo crear un producto en Amazon',
             'Quiero crear una tienda en Amazon',
             'Quiero crear una tienda para vender un producto en Amazon',
             'Quiero crear un producto en Amazon, pero no lo guardes todavía')
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        for text in texts:
            body = send(client, text)
            result = finish(client, body['requestId'])
            assert result['status'] == 'success'
            assert '¿Quieres que guardemos ahora' in result['response']['reply']
            assert 'createdAssignmentFocus' not in result['response']
            assert agent.tool_results[-1]['error'] == 'invalid_intent'
            assert counts(db, user) == [0, 0, 0, 0, 0]


@pytest.mark.parametrize('unsupported', ['materials', 'from_scratch'])
def test_model_cannot_invent_starting_point_without_current_message_evidence(environment, unsupported):
    config, google, db = environment
    agent = GoalAgent()
    agent.forced_source = unsupported
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        body = send(client, 'Quiero crear un producto en Amazon')
        result = finish(client, body['requestId'])
        assert result['status'] == 'success'
        assert '¿Tienes fotos o documentos' in result['response']['reply']
        saved = client.get('/api/uony/threads/goal-chat/assignment-return').json()
        assert saved['assignments'][0]['assignment']['nextStep'] == 'clarify_source'
        assert counts(db, user) == [1, 0, 0, 0, 0]


def test_explicit_from_scratch_is_preserved(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        body = send(client, 'Quiero crear un producto en Amazon desde cero')
        result = finish(client, body['requestId'])
        assert result['status'] == 'success'
        assert '¿Qué producto vamos a preparar?' in result['response']['reply']
        saved = client.get('/api/uony/threads/goal-chat/assignment-return').json()
        assert saved['assignments'][0]['assignment']['nextStep'] == 'select_product'
        assert counts(db, user) == [1, 0, 0, 0, 0]


def test_text_answer_about_sources_continues_focused_goal_without_new_one(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        focus = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        answer = send(client, 'Tengo una carpeta de fotos en Drive', focus)
        result = finish(client, answer['requestId'])
        assert result['status'] == 'success'
        assert 'Seguimos' in result['response']['reply']
        assert 'createdAssignmentFocus' not in result['response']
        assert agent.contexts[1]['assignmentFocus']['id'] == focus['assignmentId']
        assert counts(db, user) == [1, 0, 0, 0, 0]


def test_explicit_named_second_goal_switches_focus_only_after_provider_success(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        selected_a = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        second = send(client, 'Quiero crear otro producto en Amazon: Lámpara', selected_a)
        assert client.get('/api/uony/threads/goal-chat/assignment-focus').json()['focus']['version'] == 1
        saved = finish(client, second['requestId'])
        selected_b = saved['response']['createdAssignmentFocus']
        assert saved['status'] == 'success' and selected_b['version'] == 2
        assert selected_b['assignmentId'] != selected_a['assignmentId']
        assert counts(db, user) == [2, 0, 0, 0, 0]
        focus = client.get('/api/uony/threads/goal-chat/assignment-focus').json()['focus']
        assert focus['current']['label'] == 'Lámpara'
        assert focus['previous']['id'] == selected_a['assignmentId']
        following = send(client, 'Sigue con la Lámpara', selected_b)
        assert finish(client, following['requestId'])['status'] == 'success'
        assert agent.contexts[2]['assignmentFocus']['id'] == selected_b['assignmentId']


def test_materials_are_not_opened_in_same_turn_as_new_goal(environment):
    config, google, db = environment
    agent = GoalAgent()
    agent.extra_intake = True
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        body = send(client, 'Quiero crear un producto en Amazon y tengo fotos en Drive')
        result = finish(client, body['requestId'])
        assert result['status'] == 'success'
        assert 'Podemos elegir la carpeta' in result['response']['reply']
        assert agent.tool_results[-1]['error'] == 'assignment_pending'
        assert counts(db, user) == [1, 0, 0, 0, 0]
        assignment = client.get('/api/uony/threads/goal-chat/assignment-return').json()['assignments'][0]['assignment']
        assert assignment['nextStep'] == 'select_folder'


def test_intake_before_new_goal_cannot_link_selection_to_prior_focus(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        first = send(client, 'Quiero crear un producto en Amazon')
        focus_a = finish(client, first['requestId'])['response']['createdAssignmentFocus']
        agent.intake_first = True
        second = send(client, 'Quiero crear otro producto en Amazon: Lámpara, tengo fotos en Drive', focus_a)
        result = finish(client, second['requestId'])
        assert result['status'] == 'error'
        assert agent.tool_results[-1]['error'] == 'operation_pending'
        assert counts(db, user) == [1, 0, 0, 0, 0]
        current = client.get('/api/uony/threads/goal-chat/assignment-focus').json()['focus']
        assert current['current']['id'] == focus_a['assignmentId']


def test_invalid_or_old_quote_cannot_prepare_goal_and_failure_does_not_commit(environment):
    config, google, db = environment
    agent = GoalAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        text = 'Quiero crear un producto en Amazon'
        body = send(client, text)
        agent.fail_after_tool = True
        assert finish(client, body['requestId'])['status'] in ('error', 'unknown')
        assert counts(db, user) == [0, 0, 0, 0, 0]
        with db.connect() as c:
            from app.uony_assignment_tool import AssignmentTools
            tool = AssignmentTools(db, {'id': user, 'google_subject': google.subject},
                                   'goal-chat', uuid4(), 'No quiero crear un producto en Amazon')
            invalid = tool.prepare({'kind': 'amazon_product', 'label': 'Producto en Amazon',
                'intentQuote': text, 'startingPoint': 'unknown'})
            assert invalid['error'] == 'invalid_intent'
        assert counts(db, user) == [0, 0, 0, 0, 0]
