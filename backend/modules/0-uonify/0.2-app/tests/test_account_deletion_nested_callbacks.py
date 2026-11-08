"""An OAuth result can be recorded while its caller still owns the user lock."""
from dataclasses import replace
import pytest
from conftest import client_for, login
from test_google_cloud import Cloud, allow
from test_google_drive import Drive
from test_subscription import complete


@pytest.mark.parametrize('name,factory', [('cloud', Cloud), ('drive', Drive)])
def test_mismatched_popup_result_does_not_lock_its_parent_user_transaction(environment, name, factory):
    config, google, _ = environment
    # A regression fails promptly rather than hanging the whole suite. This is
    # still the real callback and two independent PostgreSQL connections.
    config = replace(config, database={**config.database,
        'options': config.database['options'] + ' -clock_timeout=200ms -cstatement_timeout=2000ms'})
    from app.database import Database
    db, provider = Database(config.database), factory()
    with client_for(config, google, **{name: provider}) as client:
        login(client, google); complete(client)
        allow(db)
        started = client.post('/api/connections/google-' + name + '/start', json={'popup': True})
        assert started.status_code == 200, started.text
        provider.subject = 'different-google-identity'
        result = client.get('/api/auth/google/callback', params={'state': provider.state, 'code': 'fixture'})
        assert result.status_code == 200 and 'Usa la misma cuenta de Google' in result.text
        with db.connect() as c:
            flow = c.execute('SELECT status,error_code FROM ' + name + '_popup_flows').fetchone()
            assert flow == {'status': 'error', 'error_code': 'account_mismatch'}
            assert not c.execute('SELECT 1 FROM google_' + name + '_connections').fetchone()


@pytest.mark.parametrize('name,factory', [('cloud', Cloud), ('drive', Drive)])
def test_pending_deletion_callback_has_no_provider_call_or_result_mutation(environment, name, factory):
    config, google, db = environment
    provider, calls = factory(), []
    def no_exchange(*args):
        calls.append(args)
        raise AssertionError('A deleting account must not contact Google')
    provider.exchange = no_exchange
    with client_for(config, google, **{name: provider}) as client:
        login(client, google); complete(client); allow(db)
        assert client.post('/api/connections/google-' + name + '/start', json={'popup': True}).status_code == 200
        with db.connect() as c:
            c.execute('UPDATE users SET deletion_requested_at=now()')
            before = c.execute('SELECT * FROM ' + name + '_popup_flows').fetchone()
            before_attempt = c.execute('SELECT * FROM ' + name + '_oauth_attempts').fetchone()
        result = client.get('/api/auth/google/callback', params={'state': provider.state, 'code': 'fixture'})
        assert result.status_code == 200 and 'No se ha completado la conexión' in result.text
        assert calls == []
        with db.connect() as c:
            assert c.execute('SELECT * FROM ' + name + '_popup_flows').fetchone() == before
            assert c.execute('SELECT * FROM ' + name + '_oauth_attempts').fetchone() == before_attempt
            assert not c.execute('SELECT 1 FROM google_' + name + '_connections').fetchone()
