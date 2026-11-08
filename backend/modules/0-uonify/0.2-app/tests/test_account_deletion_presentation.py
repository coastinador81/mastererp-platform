"""Presentar la eliminación en Uony nunca equivale a autorizarla ni ejecutarla."""
from unittest.mock import Mock, patch
from uuid import uuid4
import pytest
from app.blender_tools import BusinessTools
from app.uony_provider import request_payload
from conftest import client_for
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready
from test_uony_provider import response


@pytest.mark.parametrize('arguments', [{}, {'confirmation': 'ELIMINAR'}, {'userId': 'foreign'}, None, []])
def test_presentation_tool_never_accesses_database_or_accepts_confirmation(arguments):
    database = Mock()
    tools = BusinessTools({}, database, {'id': uuid4()}, None, uuid4())
    result = tools.call('show_account_deletion', arguments)
    expected = [{'provider': 'account', 'action': 'manage'}] if arguments == {} else []
    assert tools.connection_actions.present() == expected
    assert bool(result.get('prepared')) == (arguments == {})
    database.assert_not_called()
    assert not database.mock_calls
    assert tools.pending is None


def test_chat_stores_and_replays_presentation_without_deleting_account(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        ready(client, google, db)
        connect(db, config)
        body = {'requestId': str(uuid4()), 'threadId': 'account-controls', 'text': 'Quiero eliminar mi cuenta.'}
        with patch('app.uony_provider.requests.post', side_effect=[
            response([{'functionCall': {'name': 'show_account_deletion', 'args': {}}}]),
            response([{'text': 'Revisa y confirma la eliminación en este control.'}]),
        ]) as provider:
            result = client.post('/api/uony/messages', json=body)
            assert result.status_code == 200, result.text
            assert result.json()['connectionActions'] == [{'provider': 'account', 'action': 'manage'}]
            assert result.json()['productChanges'] == [] and result.json()['conversationForm'] is None
            assert client.post('/api/uony/messages', json=body).json() == result.json()
            assert provider.call_count == 2
        assert client.get('/api/auth/session').json()['authenticated'] is True
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['connectionActions'] == result.json()['connectionActions']
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM users').fetchone()['n'] == 1
            assert connection.execute('SELECT count(*) AS n FROM google_cloud_connections').fetchone()['n'] == 1


def test_context_counter_and_chat_share_presentation_declaration():
    tools = BusinessTools({}, Mock(), {'id': uuid4()}, None, uuid4())
    payload = request_payload([], tools)
    declared = payload['tools'][0]['functionDeclarations']
    assert any(item['name'] == 'show_account_deletion' for item in declared)
    assert not any(item['name'] in ('delete_account', 'confirm_account_deletion') for item in declared)


def test_database_whitelist_rejects_mutating_or_foreign_account_payloads(environment):
    from psycopg.types.json import Jsonb
    config, google, db = environment
    with client_for(config, google), db.connect() as connection:
        for payload, expected in [
            ([{'provider': 'account', 'action': 'manage'}], True),
            ([{'provider': 'account', 'action': 'delete'}], False),
            ([{'provider': 'account', 'action': 'manage', 'email': 'foreign@example.test'}], False),
            ([{'provider': 'account', 'action': 'manage'}] * 2, False),
            ([], True),
        ]:
            valid = connection.execute('SELECT uony_connection_actions_valid(%s) AS valid', (Jsonb(payload),)).fetchone()['valid']
            assert valid is expected
