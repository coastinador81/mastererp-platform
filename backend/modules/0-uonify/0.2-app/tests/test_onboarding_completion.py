"""A verified period unlocks the final summary, not a message before Continue."""
from uuid import uuid4
import pytest
from conftest import client_for
from test_first_intent_delivery import Agent, message, save
from test_google_setup import SetupCloud, BASE, body, start

SETUP = '/api/onboarding/setup'
CLAIM = '/api/onboarding/first-intent/claim'


def prepared(client, google, cloud):
    start(client, google, cloud)
    client.post('/api/connections/google-drive/defer')
    assert client.post(BASE+'/setup', json=body()).json()['operation']['status'] == 'ready'
    save(client)


def period(db, google, kind='paid'):
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s', (google.subject,)).fetchone()['id']
        row = c.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
            VALUES(%s,%s,%s,now()-interval '1 minute',now()+interval '14 days',%s)
            RETURNING ends_at''', (uuid4(), user, kind, 'verified-summary-'+str(uuid4()))).fetchone()
    return user, row['ends_at'].isoformat()


@pytest.mark.parametrize('kind', ['trial', 'paid'])
def test_final_summary_survives_reload_and_only_continue_unlocks_first_message(environment, kind):
    config, google, db = environment
    cloud, agent = SetupCloud(), Agent()
    with client_for(config, google, cloud=cloud, uony=agent) as client:
        prepared(client, google, cloud)
        user, ends_at = period(db, google, kind)
        for _ in range(2):
            state = client.get(SETUP).json()
            assert state['step'] == 'complete'
            assert state['activation'] == {'basis':kind, 'endsAt':ends_at}
            assert state['firstIntentDelivery'] is None
            assert client.get('/api/auth/session').json()['profileComplete'] is False
            assert client.post(CLAIM, json={}).status_code == 403
            assert client.post('/api/uony/messages', json={
                'requestId':str(uuid4()), 'threadId':'before-continue', 'text':'Hola'}).status_code == 403
        with db.connect() as c:
            assert c.execute('SELECT onboarding_completed_at FROM users WHERE id=%s', (user,)).fetchone()['onboarding_completed_at'] is None
            assert c.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 0
        assert agent.calls == 0 and cloud.probes == 1
        for _ in range(2):
            assert client.post('/api/onboarding/complete').json()['profileComplete'] is True
        first = client.post(CLAIM, json={}).json()['delivery']
        assert client.post('/api/uony/messages', json=message(first)).status_code == 200
        assert client.post('/api/uony/messages', json=message(first)).status_code == 200
        final = client.get(SETUP).json()
        assert final['step'] == 'complete' and final['activation'] == state['activation']
        assert final['firstIntentDelivery']['status'] == 'complete'
        assert final['firstIntentDelivery']['threadId'] == first['threadId']
        assert agent.calls == 1 and cloud.probes == 1


@pytest.mark.parametrize('condition', ['expired', 'revoked', 'future'])
def test_invalidated_period_cannot_restore_final_summary_or_complete(environment, condition):
    config, google, db = environment
    cloud = SetupCloud()
    with client_for(config, google, cloud=cloud) as client:
        prepared(client, google, cloud)
        period(db, google)
        assert client.get(SETUP).json()['step'] == 'complete'
        with db.connect() as c:
            if condition == 'expired':
                c.execute('UPDATE access_periods SET ends_at=now()')
            elif condition == 'revoked':
                c.execute('UPDATE access_periods SET revoked_at=now()')
            else:
                c.execute("UPDATE access_periods SET starts_at=now()+interval '1 day'")
        state = client.get(SETUP).json()
        assert state['step'] == 'subscription' and state['activation'] is None
        assert client.post('/api/onboarding/complete').status_code == 403
        assert client.post(CLAIM, json={}).status_code == 403
        assert state['firstIntent'].startswith('Quiero crear Basic')


def test_active_subscription_without_verified_period_does_not_claim_activation(environment):
    config, google, db = environment
    cloud = SetupCloud()
    with client_for(config, google, cloud=cloud) as client:
        prepared(client, google, cloud)
        with db.connect() as c:
            user = c.execute('SELECT id FROM users').fetchone()['id']
            checkout = uuid4()
            c.execute('''INSERT INTO billing_checkouts(id,user_id,offer_version,interval,status,trial_days)
                SELECT %s,%s,version,'annual','complete',0 FROM subscription_offers LIMIT 1''', (checkout, user))
            c.execute('''INSERT INTO billing_subscriptions(stripe_id,user_id,checkout_id,customer_id,status,period_end)
                VALUES('summary-fixture-sub',%s,%s,'summary-fixture-customer','active',now()+interval '1 year')''', (user, checkout))
        state = client.get(SETUP).json()
        assert state['step'] == 'subscription' and state['activation'] is None
        assert client.post('/api/onboarding/complete').status_code == 403


def test_paid_period_does_not_skip_unfinished_google_preparation(environment):
    config, google, db = environment
    cloud = SetupCloud()
    with client_for(config, google, cloud=cloud) as client:
        start(client, google, cloud)
        period(db, google)
        assert client.get(SETUP).json()['step'] == 'drive'
        client.post('/api/connections/google-drive/defer')
        assert client.get(SETUP).json()['step'] == 'cloud'
        assert client.post('/api/onboarding/complete').status_code == 409


def test_reserved_first_intent_stays_blocked_while_final_summary_is_open(environment):
    config, google, db = environment
    cloud = SetupCloud()
    with client_for(config, google, cloud=cloud) as client:
        prepared(client, google, cloud)
        period(db, google)
        # A persisted reservation is not permission to skip the closing step.
        with db.connect() as c:
            c.execute('''UPDATE onboarding_setup_states SET delivery_request_id=%s,
                delivery_thread_id='saved-first-thread',delivery_text=first_intent,
                delivery_model='auto',delivery_effort='medium',delivery_claimed_at=now()''', (uuid4(),))
        state = client.get(SETUP).json()
        assert state['step'] == 'complete'
        assert state['firstIntentDelivery']['status'] == 'blocked'
        assert client.post(CLAIM, json={}).status_code == 403
        assert client.post('/api/uony/messages', json=message(state['firstIntentDelivery'])).status_code == 403
