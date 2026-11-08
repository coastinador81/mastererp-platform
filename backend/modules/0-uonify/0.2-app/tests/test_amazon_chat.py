"""Tarjeta conversacional real: API/DB, idempotencia y permisos sin mutación Amazon."""
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from psycopg.errors import CheckViolation
from psycopg.types.json import Jsonb

from conftest import client_for, login
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_provider import response
from app.blender_tools import BusinessTools
from app.connection_tools import AMAZON_ACTION


ACTION = [AMAZON_ACTION]


def message():
    return {'requestId': str(uuid4()), 'threadId': 'amazon-chat', 'text': 'Quiero gestionar mi conexión de Amazon aquí.'}


def tool_response(args=None):
    return response([{'functionCall': {'name': 'show_amazon_connection', 'args': args if args is not None else {}}}])


def amazon_state(db):
    with db.connect() as c:
        return (
            c.execute('SELECT user_id,seller_id,marketplace_id,connected_at FROM amazon_connections').fetchall(),
            c.execute('SELECT count(*) AS count FROM amazon_oauth_attempts').fetchone(),
        )


@pytest.mark.parametrize('connected', [False, True])
def test_card_persists_replays_and_reenters_without_changing_amazon(environment, connected):
    config, google, db = environment
    amazon = Mock()
    with client_for(config, google, cloud=Cloud(), amazon=amazon) as client:
        ready(client, google, db)
        connect(db, config)
        if connected:
            with db.connect() as c:
                user = c.execute('SELECT id FROM users').fetchone()['id']
                c.execute("INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted) VALUES(%s,'SELLER-FIXTURE','test-only-not-a-token')", (user,))
        before = amazon_state(db)
        body = message()
        with patch('app.uony_provider.requests.post', side_effect=[
            tool_response(), tool_response(), response([{'text': 'Puedes gestionar Amazon desde esta tarjeta.'}]),
        ]) as post:
            result = client.post('/api/uony/messages', json=body)
            assert result.status_code == 200, result.text
            assert result.json()['connectionActions'] == ACTION
            assert result.json()['productChanges'] == []
            assert client.post('/api/uony/messages', json=body).json() == result.json()
            assert post.call_count == 3
            declared = post.call_args.kwargs['json']['tools'][0]['functionDeclarations']
            assert any(d['name'] == 'show_amazon_connection' for d in declared)
            returned = post.call_args.kwargs['json']['contents'][-1]['parts'][0]['functionResponse']['response']
            assert returned['observedConnectionStatus'] == ('connected' if connected else 'disconnected')
            assert returned['primaryAction'] == ('Gestionar conexión' if connected else 'Conectar Amazon')
            assert client.post('/api/uony/messages', json={**body, 'text': 'Otro mensaje'}).status_code == 409
        assert amazon_state(db) == before
        assert not amazon.mock_calls
        with db.connect() as c:
            saved = c.execute('SELECT connection_actions,status FROM uony_requests').fetchone()
        assert saved == {'connection_actions': ACTION, 'status': 'success'}
    with client_for(config, google, cloud=Cloud(), amazon=amazon) as client:
        login(client, google)
        history = client.get('/api/uony/threads').json()['threads']
        assert history[0]['messages'][-1]['connectionActions'] == ACTION
        assert amazon_state(db) == before


def test_card_has_no_action_when_model_does_not_call_tool_and_old_rows_default_empty(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        with patch('app.uony_provider.requests.post', return_value=response([{'text': 'Hola.'}])):
            result = client.post('/api/uony/messages', json=message())
        assert result.json()['connectionActions'] == []
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['connectionActions'] == []
        with db.connect() as c:
            row = c.execute('SELECT user_id,thread_id FROM uony_requests').fetchone()
            c.execute("INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,status,model,project_id) VALUES(%s,%s,%s,'Anterior','Respuesta anterior','success','fixture','project-fixture')", (row['user_id'], uuid4(), row['thread_id']))
            assert c.execute("SELECT connection_actions FROM uony_requests WHERE prompt='Anterior'").fetchone()['connection_actions'] == []


@pytest.mark.parametrize('args', [{'userId': 'another-account'}, {'provider': 'google'}, {'url': 'https://example.test'}, [], None])
def test_tool_rejects_arguments_and_never_opens_or_changes_external_connection(environment, args):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
        tools = BusinessTools({}, db, user, None, uuid4())
        assert tools.call('show_amazon_connection', args)['error'] == 'invalid_tool'
        assert tools.connection_actions.present() == []
        assert amazon_state(db) == ([], {'count': 0})


def test_actions_not_saved_or_replayed_when_model_fails(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        body = message()
        with patch('app.uony_provider.requests.post', side_effect=[tool_response(), Mock(status_code=429)]) as post:
            assert client.post('/api/uony/messages', json=body).status_code == 503
            assert client.post('/api/uony/messages', json=body).status_code == 409
            assert post.call_count == 2
        history=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert len(history)==2 and history[1]['requestStatus']=='unknown'
        assert history[1]['model']=='uonify-guide'
        with db.connect() as c:
            row = c.execute('SELECT connection_actions,status FROM uony_requests').fetchone()
        assert row == {'connection_actions': [], 'status': 'error'}
        assert amazon_state(db) == ([], {'count': 0})


def test_connection_cards_keep_session_origin_access_isolation_and_delete_rules(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        body = message()
        assert client.post('/api/uony/messages', json=body).status_code == 401
        assert client.get('/api/uony/threads').status_code == 401
        ready(client, google, db)
        connect(db, config)
        with patch('app.uony_provider.requests.post', side_effect=[tool_response(), response([{'text': 'Aquí tienes la tarjeta.'}])]) as post:
            assert client.post('/api/uony/messages', json=body, headers={'Origin': 'null'}).status_code == 403
            assert client.post('/api/uony/messages', json=body).json()['connectionActions'] == ACTION
            assert post.call_count == 2
        google.subject = 'another-user'
        google.email = 'other@example.test'
        login(client, google)
        assert client.get('/api/uony/threads').json() == {'threads': []}
        assert client.post('/api/uony/messages', json=body).status_code == 403
        assert client.delete('/api/uony/threads/amazon-chat').status_code == 404
        google.subject = 'google-test-one'
        google.email = 'one@example.test'
        login(client, google)
        with db.connect() as c:
            c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.post('/api/uony/messages', json={**body, 'requestId': str(uuid4())}).status_code == 403
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['connectionActions'] == ACTION
        assert client.delete('/api/uony/threads/amazon-chat').status_code == 200
        assert client.get('/api/uony/threads').json() == {'threads': []}
        with db.connect() as c:
            assert c.execute('SELECT connection_actions FROM uony_requests').fetchone()['connection_actions'] == []


@pytest.mark.parametrize('invalid', [
    [{'provider': 'google', 'action': 'manage'}],
    [{'provider': 'amazon', 'action': 'disconnect'}],
    [{'provider': 'amazon', 'action': 'manage', 'url': 'https://example.test'}],
    {'provider': 'amazon', 'action': 'manage'},
    [AMAZON_ACTION, AMAZON_ACTION],
])
def test_database_rejects_actions_outside_exact_allowlist(environment, invalid):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        with patch('app.uony_provider.requests.post', return_value=response([{'text': 'Hola.'}])):
            assert client.post('/api/uony/messages', json=message()).status_code == 200
        with pytest.raises(CheckViolation), db.connect() as c:
            c.execute('UPDATE uony_requests SET connection_actions=%s', (Jsonb(invalid),))
