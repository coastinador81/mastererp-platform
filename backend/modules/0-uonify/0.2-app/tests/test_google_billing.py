from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
import json
from uuid import uuid4
from unittest.mock import Mock, patch
import psycopg
import pytest
from pydantic import ValidationError
from conftest import client_for, login
from test_google_cloud import Cloud, allow
from test_products import connect
from test_subscription import complete
from test_uony import ready, Agent
from app.google_billing_observations import Observation, money, proof_files, record
from app.google_billing_routes import present
from app.google_cloud_provider import CloudError, GoogleCloudProvider
from app.import_google_billing_observation import import_observation

ACCOUNT = 'billingAccounts/01F89E-4B3350-ED1492'
SOURCE = 'https://console.cloud.google.com/billing/01F89E-4B3350-ED1492/credits'


class BillingCloud(Cloud):
    def __init__(self):
        super().__init__()
        self.account = ACCOUNT
        self.metadata_error = None
        self.lookups = []

    def billing_info(self, token, project_id):
        self.lookups.append(('project', project_id))
        if self.metadata_error:
            raise CloudError(self.metadata_error)
        return {'name': self.account, 'enabled': True}

    def billing_account(self, token, name):
        self.lookups.append(('account', name))
        return {'name': name, 'open': True}


def observation(**changes):
    data = {'projectId': 'project-fixture', 'billingAccountName': ACCOUNT, 'currency': 'EUR',
            'creditEUR': '262.02', 'consumptionEUR': '1.98', 'netConsumptionEUR': '0.00',
            'consumptionScope': 'billing_account', 'periodStart': '2026-10-01', 'periodEnd': '2026-10-15',
            'observedAt': (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            'sourceURL': SOURCE, 'proofFiles': ['credits.jpg', 'overview.jpg']}
    return Observation.model_validate_json(json.dumps({**data, **changes}))


def save(db, config, cloud, **changes):
    with db.connect() as c:
        user = c.execute('SELECT * FROM users ORDER BY created_at LIMIT 1').fetchone()
        row = c.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s', (user['id'],)).fetchone()
        return record(c, user, row, observation(**changes), [{'path': 'credits.jpg', 'sha256': 'a' * 64}])


def test_official_billing_metadata_never_claims_a_balance(environment):
    config, _, _ = environment
    provider = GoogleCloudProvider(config)
    provider.request = Mock(side_effect=[{'billingEnabled': True, 'billingAccountName': ACCOUNT},
                                        {'name': ACCOUNT, 'open': True, 'displayName': 'Private account'}])
    assert provider.billing_info('not-logged', 'project-fixture') == {'name': ACCOUNT, 'enabled': True}
    assert provider.billing_account('not-logged', ACCOUNT) == {'name': ACCOUNT, 'open': True}
    assert provider.request.call_args_list[0].args[2] == 'https://cloudbilling.googleapis.com/v1/projects/project-fixture/billingInfo'
    assert provider.request.call_args_list[1].args[2] == 'https://cloudbilling.googleapis.com/v1/' + ACCOUNT
    with pytest.raises(CloudError):
        provider.billing_account('not-logged', '../../private')
    assert provider.request.call_count == 2
    provider.request = Mock(return_value={'billingEnabled': False})
    with pytest.raises(CloudError) as error:
        provider.billing_info('not-logged', 'project-fixture')
    assert error.value.code == 'billing_not_linked'


@pytest.mark.parametrize('changes', [
    {'currency': 'USD'}, {'creditEUR': 'NaN'}, {'creditEUR': '-1'}, {'creditEUR': '1.001'},
    {'creditEUR': 12.34}, {'observedAt': '2026-10-15T12:00:00'},
    {'observedAt': (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()},
    {'sourceURL': 'https://example.com/billing'}, {'sourceURL': 'https://console.cloud.google.com/billing/OTHER/credits'},
    {'sourceURL': SOURCE + '?access_token=forbidden'},
    {'sourceURL': SOURCE + '#access_token=forbidden'},
    {'sourceURL': SOURCE + '?unexpected=not-approved'},
    {'creditEUR': None, 'consumptionEUR': None, 'netConsumptionEUR': None},
    {'consumptionEUR': '1.98', 'periodStart': None}, {'periodEnd': '2026-09-01'},
    {'creditExpiresAt': (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
    {'creditExpiresOn': (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()},
    {'creditEntries': [{'amountEUR': '1.00'}]},
    {'creditEntries': [{'amountEUR': '262.02', 'expiresOn': (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()}]},
    {'creditEntries': [{'amountEUR': '262.02', 'expiresAt': (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}]},
])
def test_observations_reject_invented_or_inconsistent_money_dates_and_currency(changes):
    with pytest.raises(ValidationError):
        observation(**changes)


def test_decimal_db_scale_and_explicit_zero_are_preserved_without_estimation():
    assert money(Decimal('1.980000')) == '1.98'
    assert money(Decimal('0.000000')) == '0.00'
    assert money(None) is None
    for value in ['NaN', 'Infinity', '-1', '1.001']:
        with pytest.raises(ValueError):
            money(value)
    assert observation(creditEUR='0.00').creditEUR == '0.00'


def test_proof_is_hashed_and_cannot_escape_the_evidence_directory(tmp_path):
    image = tmp_path / 'credits.jpg'
    image.write_bytes(b'fixture image evidence')
    proof = proof_files(tmp_path, ['credits.jpg'])
    assert proof[0]['path'] == 'credits.jpg' and len(proof[0]['sha256']) == 64
    outside = tmp_path.parent / 'outside-evidence.jpg'
    outside.write_bytes(b'outside')
    try:
        with pytest.raises(ValueError):
            proof_files(tmp_path, ['../outside-evidence.jpg'])
    finally:
        outside.unlink()


def test_get_reads_the_observation_not_tokens_and_never_mutates_saved_work(environment):
    config, google, db = environment
    cloud = BillingCloud()
    agent = Agent()
    with client_for(config, google, cloud=cloud, uony=agent) as client:
        ready(client, google, db)
        connect(db, config)
        product = client.post('/api/products', json={'sku': 'OWN', 'name': 'Madera'}).json()['product']
        assert save(db, config, cloud)
        with db.connect() as c:
            before = c.execute('SELECT * FROM google_billing_observations').fetchone()
        with patch('app.uony_routes.services', side_effect=AssertionError('must not reconcile services')):
            first = client.get('/api/uony/google-billing').json()
            second = client.get('/api/uony/google-billing').json()
        assert first['status'] == 'available' and first['currency'] == 'EUR'
        assert first['creditEUR'] == '262.02' and first['consumptionEUR'] == '1.98'
        assert first['netConsumptionEUR'] == '0.00' and first['consumptionScope'] == 'billing_account'
        assert first['observedAt'] == second['observedAt'] == before['observed_at'].isoformat()
        assert first['recordedAt'] == second['recordedAt'] == before['recorded_at'].isoformat()
        assert first['checkedAt'] != second['checkedAt']
        assert first['source'] == {'kind': 'observed_google_console', 'url': SOURCE, 'live': False}
        assert 'sha256' not in json.dumps(first) and 'proofFiles' not in first
        assert 'fixture-' not in json.dumps(first).replace('project-fixture', '')
        assert agent.calls == 0
        assert client.post('/api/uony/google-billing', json={'creditEUR': '999'}).status_code == 405
        assert client.get('/api/products').json()['products'] == [product]
        with db.connect() as c:
            assert c.execute('SELECT * FROM google_billing_observations').fetchone() == before
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 0


def test_unobserved_and_switched_billing_accounts_never_reuse_the_old_amount(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        no_data = client.get('/api/uony/google-billing').json()
        assert no_data['status'] == 'unavailable' and no_data['creditEUR'] is None
        assert no_data['consumptionEUR'] is None and no_data['observedAt'] is None
        assert no_data['billingVerified'] is True
        assert 'no se sincronizan automáticamente' in no_data['message']
        assert no_data['consoleLinks']['credits'] == SOURCE + '?authuser=one%40example.test&project=project-fixture'
        assert no_data['consoleLinks']['reports'] == SOURCE.replace('/credits', '/reports') + '?authuser=one%40example.test&project=project-fixture'
        save(db, config, cloud)
        cloud.account = 'billingAccounts/OTHER'
        changed = client.get('/api/uony/google-billing').json()
        assert changed['status'] == 'unavailable' and changed['creditEUR'] is None
        assert changed['billingAccountName'] == 'billingAccounts/OTHER'
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET project_id='second-project'")
        assert client.get('/api/uony/google-billing').json()['consumptionEUR'] is None


def test_known_new_account_with_permission_error_does_not_show_old_account_money(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        save(db, config, cloud)
        cloud.account = 'billingAccounts/OTHER'
        with patch.object(cloud, 'billing_account', side_effect=CloudError('permission_denied')):
            data = client.get('/api/uony/google-billing').json()
        assert data['status'] == 'unavailable' and data['creditEUR'] is None
        assert data['billingAccountName'] == cloud.account and data['reason'] == 'permission_denied'


def test_connection_change_during_google_query_cannot_release_the_previous_snapshot(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        save(db, config, cloud)
        def switch(token, name):
            with db.connect() as c:
                c.execute("UPDATE google_cloud_connections SET project_id='second-project'")
            return {'name': name, 'open': True}
        with patch.object(cloud, 'billing_account', side_effect=switch):
            data = client.get('/api/uony/google-billing').json()
        assert data['status'] == 'unavailable' and data['creditEUR'] is None
        assert data['reason'] == 'connection_changed' and data['projectId'] == 'second-project'


@pytest.mark.parametrize('failure', ['reauthorize', 'permission_denied', 'google_unavailable'])
def test_unverified_billing_association_hides_old_money_and_explains_failure(environment, failure):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        save(db, config, cloud)
        normal = client.get('/api/uony/google-billing').json()
        cloud.fail = failure
        failed = client.get('/api/uony/google-billing').json()
        assert failed['status'] == 'unavailable' and failed['reason'] == failure
        assert failed['creditEUR'] is None and failed['observedAt'] is None
        assert failed['consoleLinks'] is None and failed['billingVerified'] is False
        assert normal['creditEUR'] == '262.02'
        assert failed['message'] != 'Tu facturación está conectada.'
        with db.connect() as c:
            assert c.execute('SELECT status FROM google_cloud_connections').fetchone()['status'] == 'connected'


@pytest.mark.parametrize('closed,reason', [(True, 'billing_account_closed'), (False, 'billing_not_enabled')])
def test_inactive_billing_is_never_available_or_imported_as_available_credit(environment, closed, reason):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        save(db, config, cloud)
        info = {'name': ACCOUNT, 'enabled': closed}
        account = {'name': ACCOUNT, 'open': not closed}
        with patch.object(cloud, 'billing_info', return_value=info), patch.object(cloud, 'billing_account', return_value=account):
            data = client.get('/api/uony/google-billing').json()
            assert data['status'] == 'stale' and data['reason'] == reason
            with pytest.raises(ValueError):
                import_observation(config, db, cloud, google.email, observation(), [{'path': 'x.jpg', 'sha256': 'a' * 64}])


def test_old_observation_and_expired_entries_are_explicit_and_not_counted(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        save(db, config, cloud, observedAt=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
             creditEntries=[{'amountEUR': '262.02', 'expiresAt': (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}])
        data = client.get('/api/uony/google-billing').json()
        assert data['status'] == 'stale' and data['reason'] == 'credit_expired'
        assert data['creditEUR'] is None and data['consumptionEUR'] == '1.98'
        save(db, config, cloud, observedAt=(datetime.now(timezone.utc) - timedelta(hours=30)).isoformat())
        data = client.get('/api/uony/google-billing').json()
        assert data['status'] == 'stale' and data['reason'] == 'observation_old' and data['creditEUR'] == '262.02'


def test_date_only_credit_expiry_keeps_the_source_precision(environment):
    config, google, db = environment
    cloud = BillingCloud()
    expires_on = (datetime.now(timezone.utc) + timedelta(days=2)).date()
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        save(db, config, cloud, creditExpiresOn=expires_on.isoformat(),
             creditEntries=[{'amountEUR': '262.02', 'expiresOn': expires_on.isoformat()}])
        data = client.get('/api/uony/google-billing').json()
        assert data['creditExpiresOn'] == expires_on.isoformat() and data['creditExpiresAt'] is None
        with db.connect() as c:
            snapshot = c.execute('SELECT * FROM google_billing_observations').fetchone()
        assert snapshot['credit_expires_on'] == expires_on and snapshot['credit_expires_at'] is None
        assert snapshot['credit_entries'][0]['expiresOn'] == expires_on.isoformat()
        later = present(data, snapshot, datetime.combine(expires_on, time.min, timezone.utc))
        assert later['creditEUR'] is None and later['reason'] == 'credit_expired'


def test_import_is_idempotent_and_storage_is_append_only(environment):
    config, google, db = environment
    cloud = BillingCloud()
    item = observation()
    proofs = [{'path': 'credits.jpg', 'sha256': 'a' * 64}]
    with client_for(config, google, cloud=cloud) as client:
        ready(client, google, db)
        connect(db, config)
        assert import_observation(config, db, cloud, google.email, item, proofs)
        assert not import_observation(config, db, cloud, google.email, item, proofs)
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM google_billing_observations').fetchone()['n'] == 1
        for action in ('UPDATE google_billing_observations SET credit_eur=999', 'DELETE FROM google_billing_observations'):
            with pytest.raises(psycopg.Error):
                with db.connect() as c:
                    c.execute(action)
        cloud.account = 'billingAccounts/OTHER'
        with pytest.raises(ValueError):
            import_observation(config, db, cloud, google.email, item, proofs)


def test_session_access_identity_and_foreign_users_are_isolated(environment):
    config, google, db = environment
    cloud = BillingCloud()
    with client_for(config, google, cloud=cloud) as client:
        assert client.get('/api/uony/google-billing').status_code == 401
        login(client, google)
        assert client.get('/api/uony/google-billing').status_code == 403
        ready(client, google, db)
        assert client.get('/api/uony/google-billing').json()['reason'] == 'google_required'
        connect(db, config)
        save(db, config, cloud)
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET google_subject='foreign'")
        with patch.object(cloud, 'refresh', side_effect=AssertionError('must not refresh')):
            assert client.get('/api/uony/google-billing').status_code == 409
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET google_subject='google-test-one'")
            c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.get('/api/uony/google-billing').status_code == 403
        google.subject = 'second'
        google.email = 'second@example.test'
        ready(client,google,db)
        data = client.get('/api/uony/google-billing').json()
        assert data['creditEUR'] is None and data['projectId'] is None
        assert cloud.calls == 0
