"""Preparación creativa por el mismo worker/chat, sin ejecutar medios."""
from dataclasses import replace
from uuid import uuid4

import pytest
from conftest import client_for, login
from test_creative_planning import connect
from test_creative_preparation import _seed
from test_google_cloud import Cloud
from test_uony import ready
from app.creative_planning import AUDITED_PROJECT


def configured(client, google, database, settings):
    user = connect(client, google, database, settings)
    with database.connect() as connection:
        connection.execute('UPDATE google_cloud_connections SET project_id=%s WHERE user_id=%s',
                           (AUDITED_PROJECT, user))
        connection.execute('''INSERT INTO uony_model_checks
            (user_id,project_id,google_subject,model,effort)
            VALUES(%s,%s,%s,'gemini-3.5-flash','medium')''',
            (user, AUDITED_PROJECT, google.subject))
    return user


class PreparationReader:
    def __init__(self, *, prepare=False, after_read=None, read_first=False):
        self.prepare, self.after_read = prepare, after_read
        self.read_first, self.previous = read_first, None
        self.read = None
        self.calls = 0

    def generate(self, token, project, history, context, model=None, effort=None, **kwargs):
        self.calls += 1
        usage = {'attemptedCalls': 1, 'calls': 1, 'totalTokenCount': 5}
        if kwargs.get('on_attempt'):
            kwargs['on_attempt'](1)
        if kwargs.get('on_complete'):
            kwargs['on_complete'](1, usage)
        assert 'get_creative_preparation' in {item['name'] for item in context.declarations}
        if self.read_first:
            self.previous = context.call('get_creative_preparation', {})
        if self.prepare:
            prepared = context.call('prepare_creative_plan', {
                'recipe': 'cinematic_video', 'objective': 'Ciudad nueva bajo la lluvia',
                'sourceMode': 'uony_concept', 'modelChoice': 'gemini-omni-1.1-flash-preview',
            })
            assert prepared['prepared'] is True
        assert context.call('get_creative_preparation', {'threadId': 'foreign'})['error'] == 'invalid_tool'
        self.read = context.call('get_creative_preparation', {})
        if self.after_read:
            self.after_read()
        # No provider prose about execution may override the authoritative read.
        return 'Ya está generado y aprobado.', usage


@pytest.mark.parametrize('adk', [False, True])
def test_preparation_read_flows_through_queue_and_existing_chat(environment, adk):
    settings, google, database = environment
    settings = replace(settings, adk_enabled=adk)
    reader = PreparationReader()
    with client_for(settings, google, cloud=Cloud(), uony=reader) as client:
        user = configured(client, google, database, settings)
        with database.connect() as connection:
            plan_id = _seed(connection, user, google.subject)
        request = {'requestId': str(uuid4()), 'threadId': 'creative-prepare',
                   'text': '¿Cómo va mi plan creativo y qué falta?'}
        answer = client.post('/api/uony/messages', json=request)
        assert answer.status_code == 200, answer.text
        reply = answer.json()['reply']
        assert 'El plan creativo está guardado y vigente.' in reply
        assert 'presupuesto máximo completo' in reply
        assert 'Ya está generado' not in reply
        assert 'ownership' not in reply and 'CAS' not in reply and 'lease' not in reply
        assert not answer.json().get('conversationForm')
        assert reader.read['creativePreparation']['planId'] == str(plan_id)
        duplicate = client.post('/api/uony/messages', json=request)
        assert duplicate.json()['reply'] == reply and reader.calls == 1
        messages = client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert messages[-1]['text'] == reply
        with database.connect() as connection:
            job = connection.execute('SELECT engine,status FROM uony_conversation_jobs').fetchone()
            assert job == {'engine': 'adk' if adk else 'classic', 'status': 'success'}
            for table in ('creative_generation_attempts', 'creative_generation_quotes',
                          'creative_generation_approvals', 'products'):
                assert connection.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n'] == 0


@pytest.mark.parametrize('adk', [False, True])
@pytest.mark.parametrize('read_first', [False, True])
def test_same_turn_read_waits_for_saved_plan_not_previous_snapshot(environment, adk, read_first):
    settings, google, database = environment
    settings = replace(settings, adk_enabled=adk)
    reader = PreparationReader(prepare=True, read_first=read_first)
    with client_for(settings, google, cloud=Cloud(), uony=reader) as client:
        user = configured(client, google, database, settings)
        with database.connect() as connection:
            old_id = _seed(connection, user, google.subject)
        response = client.post('/api/uony/messages', json={
            'requestId': str(uuid4()), 'threadId': 'creative-prepare',
            'text': 'Guarda un nuevo vídeo de ciudad desde cero con Omni 1.1 Flash y dime qué falta.'})
        assert response.status_code == 200, response.text
        assert reader.read['status'] == 'pending_plan_commit'
        assert 'creativePreparation' not in reader.read
        if read_first:
            assert reader.previous['creativePreparation']['planId'] == str(old_id)
        reply = response.json()['reply']
        assert 'decidir la duración' in reply and '¿Cuánto quieres que dure el vídeo?' in reply
        current = client.get('/api/uony/threads/creative-prepare/creative-preparation').json()['creativePreparation']
        assert current['planId'] != str(old_id)
        assert current['state'] == 'needs_input'
        assert current['missingInputs'] == ['fijar la duración total']
        if read_first:
            assert current['planSha256'] != reader.previous['creativePreparation']['planSha256']
        assert not response.json().get('conversationForm')


def test_finish_refreshes_snapshot_changed_after_tool_read(environment):
    settings, google, database = environment
    def mark_stale():
        with database.connect() as connection:
            connection.execute("UPDATE uony_creative_plans SET status='stale'")
    reader = PreparationReader(after_read=mark_stale)
    with client_for(settings, google, cloud=Cloud(), uony=reader) as client:
        user = configured(client, google, database, settings)
        with database.connect() as connection:
            _seed(connection, user, google.subject)
        answer = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
            'threadId': 'creative-prepare', 'text': 'Consulta el estado de mi plan creativo.'})
        assert answer.status_code == 200, answer.text
        assert reader.read['creativePreparation']['sourceCurrent'] is True
        assert 'necesita revisarse' in answer.json()['reply']
        assert 'guardado y vigente' not in answer.json()['reply']


def test_registered_endpoint_requires_owner_and_hides_deleted_project(environment):
    settings, google, database = environment
    with client_for(settings, google, cloud=Cloud()) as client:
        assert client.get('/api/uony/threads/creative-prepare/creative-preparation').status_code == 401
        user = configured(client, google, database, settings)
        project_id = str(uuid4())
        assert client.post('/api/uony/projects', json={'id': project_id, 'name': '1er producto'}).status_code == 200
        with database.connect() as connection:
            plan_id = _seed(connection, user, google.subject)
            connection.execute('UPDATE uony_threads SET project_id=%s WHERE user_id=%s', (project_id, user))
        endpoint = '/api/uony/threads/creative-prepare/creative-preparation'
        response = client.get(endpoint)
        assert response.status_code == 200
        assert response.json()['creativePreparation']['planId'] == str(plan_id)
        assert response.json()['creativePreparation']['uonifyProjectId'] == project_id
        google.subject = 'other-person'; google.email = 'other@example.test'
        login(client, google)
        assert client.get(endpoint).status_code == 403
        ready(client, google, database)
        assert client.get(endpoint).status_code == 404
        google.subject = 'google-test-one'; google.email = 'one@example.test'
        login(client, google)
        assert client.delete('/api/uony/projects/' + project_id).status_code == 200
        assert client.get(endpoint).status_code == 404


def test_lost_lease_cannot_save_preparation_or_publish_reply(environment):
    settings, google, database = environment
    def expire_lease():
        with database.connect() as connection:
            connection.execute("UPDATE uony_conversation_jobs SET lease_until=now()-interval '1 second'")
    reader = PreparationReader(prepare=True, after_read=expire_lease)
    with client_for(settings, google, cloud=Cloud(), uony=reader, legacy_sync=False) as client:
        configured(client, google, database, settings)
        accepted = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
            'threadId': 'lease-preparation',
            'text': 'Prepara un vídeo desde cero con Omni 1.1 Flash y dime qué falta.'})
        assert accepted.status_code == 202, accepted.text
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('preparation-lost-lease-test')
        assert job
        worker.run(job)
        assert reader.read['status'] == 'pending_plan_commit'
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM uony_creative_plans').fetchone()['n'] == 0
            assert connection.execute('SELECT reply FROM uony_requests').fetchone()['reply'] is None
            assert connection.execute('SELECT count(*) AS n FROM creative_generation_attempts').fetchone()['n'] == 0


def test_question_with_no_saved_plan_stays_in_chat(environment):
    settings, google, database = environment
    reader = PreparationReader()
    with client_for(settings, google, cloud=Cloud(), uony=reader) as client:
        configured(client, google, database, settings)
        answer = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
            'threadId': 'no-creative-plan', 'text': '¿Qué falta en mi plan creativo?'})
        assert answer.status_code == 200, answer.text
        assert reader.read == {'creativePreparation': None}
        assert answer.json()['reply'] == ('Todavía no hay un plan creativo guardado en esta conversación. '
                                          '¿Qué imagen o vídeo quieres preparar?')
        assert not answer.json().get('conversationForm')
