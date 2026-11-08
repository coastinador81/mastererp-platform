"""La preparación se recupera sin crear intentos, jobs ni gasto."""

from uuid import uuid4

from psycopg.types.json import Jsonb

from conftest import client_for
from test_creative_planning import connect
from app.creative_planning import AUDITED_PROJECT, SKILL_VERSION, SOURCE_SHA256
from app.creative_preparation_service import get_creative_preparation
from app.creative_preparation_tools import CreativePreparationTools


def _seed(connection, user_id, subject, *, thread='creative-prepare'):
    connection.execute('''INSERT INTO uony_threads(user_id,id,title)
        VALUES(%s,%s,'Preparación creativa')''', (user_id, thread))
    plan = {
        'recipe': 'cinematic_video',
        'objective': 'Crear una ciudad futurista bajo lluvia nocturna',
        'audience': None, 'offer': None, 'sourceMode': 'uony_concept',
        'modelChoice': 'gemini-omni-1.1-flash-preview',
        'evidence': None, 'cta': None, 'assetNeeds': [],
        'referenceNeeds': [], 'durationSeconds': 9,
        'sourceSha256': SOURCE_SHA256,
    }
    identifier = uuid4()
    connection.execute('''INSERT INTO uony_creative_plans
        (user_id,id,google_subject,project_id,thread_id,origin_request_id,
         skill_version,recipe,plan) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (user_id, identifier, subject, AUDITED_PROJECT, thread, uuid4(),
         SKILL_VERSION, 'cinematic_video', Jsonb(plan)))
    return identifier


def test_preparation_binds_owner_plan_hash_and_has_no_side_effects(environment):
    config, google, database = environment
    with client_for(config, google) as client:
        user_id = connect(client, google, database, config)
        with database.connect() as connection:
            connection.execute('''UPDATE google_cloud_connections
                SET project_id=%s,status='connected' WHERE user_id=%s''',
                (AUDITED_PROJECT, user_id))
            plan_id = _seed(connection, user_id, google.subject)
            user = connection.execute('SELECT * FROM users WHERE id=%s',
                                      (user_id,)).fetchone()
            before = connection.execute('''SELECT
                (SELECT count(*) FROM creative_generation_attempts) AS attempts,
                (SELECT count(*) FROM uony_conversation_jobs) AS jobs''').fetchone()
            result = get_creative_preparation(
                connection, user, 'creative-prepare')
            after = connection.execute('''SELECT
                (SELECT count(*) FROM creative_generation_attempts) AS attempts,
                (SELECT count(*) FROM uony_conversation_jobs) AS jobs''').fetchone()
        assert result['planId'] == str(plan_id)
        assert result['revision'] == 1 and len(result['planSha256']) == 64
        assert result['state'] == 'needs_preparation' and result['sourceCurrent']
        assert result['draft']['unitIds'] == ['shot-01', 'shot-02', 'shot-03']
        assert result['quoteReadiness']['completeMaximumUsd'] is None
        assert not result['quoteReadiness']['approvalReady']
        assert result['limits'] == {'spendLimitUsd': '0.00',
                                    'providerCallsStarted': 0,
                                    'executionAuthorized': False}
        assert before == after


def test_preparation_isolated_by_owner_thread_and_current_project(environment):
    config, google, database = environment
    with client_for(config, google) as client:
        user_id = connect(client, google, database, config)
        with database.connect() as connection:
            connection.execute('''UPDATE google_cloud_connections
                SET project_id=%s,status='connected' WHERE user_id=%s''',
                (AUDITED_PROJECT, user_id))
            _seed(connection, user_id, google.subject)
            connection.execute('''INSERT INTO uony_threads(user_id,id,title)
                VALUES(%s,'empty-creative','Vacío')''', (user_id,))
            user = connection.execute('SELECT * FROM users WHERE id=%s',
                                      (user_id,)).fetchone()
            assert get_creative_preparation(
                connection, user, 'empty-creative') is None
            connection.execute('''UPDATE google_cloud_connections
                SET project_id='different-project' WHERE user_id=%s''',
                (user_id,))
            stale = get_creative_preparation(
                connection, user, 'creative-prepare')
        assert stale['state'] == 'stale' and not stale['sourceCurrent']
        assert stale['technicalBlockers'][0].startswith('actualizar el plan')


def test_preparation_reads_one_snapshot_and_honours_persisted_stale(environment):
    config, google, database = environment
    with client_for(config, google) as client:
        user_id = connect(client, google, database, config)
        with database.connect() as connection:
            connection.execute('''UPDATE google_cloud_connections
                SET project_id=%s,status='connected' WHERE user_id=%s''',
                (AUDITED_PROJECT, user_id))
            plan_id = _seed(connection, user_id, google.subject)
            connection.execute('''UPDATE uony_creative_plans SET status='stale'
                WHERE user_id=%s AND id=%s''', (user_id, plan_id))
            user = connection.execute('SELECT * FROM users WHERE id=%s',
                                      (user_id,)).fetchone()

            class OneSnapshot:
                def __init__(self, source):
                    self.source, self.calls = source, 0

                def execute(self, query, params):
                    self.calls += 1
                    return self.source.execute(query, params)

            snapshot = OneSnapshot(connection)
            result = get_creative_preparation(snapshot, user, 'creative-prepare')
        assert snapshot.calls == 1
        assert result['revision'] == 1
        assert result['state'] == 'stale' and not result['sourceCurrent']


def test_tool_only_reads_current_thread(environment):
    config, google, database = environment
    with client_for(config, google) as client:
        user_id = connect(client, google, database, config)
        with database.connect() as connection:
            connection.execute('''UPDATE google_cloud_connections
                SET project_id=%s,status='connected' WHERE user_id=%s''',
                (AUDITED_PROJECT, user_id))
            _seed(connection, user_id, google.subject)
            user = connection.execute('SELECT * FROM users WHERE id=%s',
                                      (user_id,)).fetchone()
        tool = CreativePreparationTools(
            database, user, 'creative-prepare')
        result = tool.call('get_creative_preparation', {})
        assert result['creativePreparation']['threadId'] == 'creative-prepare'
        assert tool.call('get_creative_preparation', {'write': True}) == {
            'error': 'invalid_tool',
            'message': 'Esta consulta no recibe argumentos.',
        }
