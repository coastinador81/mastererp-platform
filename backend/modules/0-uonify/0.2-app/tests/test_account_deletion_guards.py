from types import SimpleNamespace
from uuid import uuid4
import pytest
from psycopg.errors import RaiseException
from conftest import client_for, login
from test_account_deletion import body, seed
from test_account_deletion_billing import Stripe


def test_review_bound_to_session_and_google_identity_even_if_email_is_identical(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        reviewed = body(client)
        assert body(client)['requestId'] == reviewed['requestId']
        client.post('/api/auth/logout')
        google.subject = 'another-google-subject'  # Deliberately the same email.
        login(client, google)
        assert client.post('/api/account/deletion', json=reviewed).json()['error'] == 'deletion_request_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM users').fetchone()['n'] == 2
            assert not c.execute('SELECT 1 FROM account_deletions').fetchone()


def test_active_user_lock_returns_busy_without_recording_confirmation(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        request = body(client)
        with db.connect() as c:
            c.execute('SELECT id FROM users FOR UPDATE').fetchone()
            response = client.post('/api/account/deletion', json=request)
            assert response.status_code == 409 and response.json()['error'] == 'account_busy'
            assert not c.execute('SELECT 1 FROM account_deletions').fetchone()


def test_cross_owner_cascade_corruption_cannot_remove_another_accounts_control(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        with db.connect() as c:
            owner = c.execute('SELECT * FROM users').fetchone(); state = seed(c, owner)
            other = c.execute("INSERT INTO users(id,google_subject,email,display_name) VALUES(%s,'other','x@example.test','Other') RETURNING *", (uuid4(),)).fetchone()
            c.execute('''INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload)
                VALUES(%s,%s,%s,'pause','{}')''', (other['id'], uuid4(), state['material']))
            controls_before = c.execute('''SELECT user_id,request_id,job_id FROM product_material_controls''').fetchall()
            assert len(controls_before) == 2
            assert {row['user_id'] for row in controls_before} == {owner['id'], other['id']}
        result = client.post('/api/account/deletion', json=body(client))
        assert result.status_code == 409 and result.json()['error'] == 'account_deletion_integrity'
        with db.connect() as c:
            controls_after = c.execute('''SELECT user_id,request_id,job_id FROM product_material_controls''').fetchall()
            assert len(controls_after) == len(controls_before)
            assert {(row['user_id'], row['request_id'], row['job_id']) for row in controls_after} == {
                (row['user_id'], row['request_id'], row['job_id']) for row in controls_before}
            assert c.execute('SELECT count(*) n FROM users').fetchone()['n'] == 2
            assert not c.execute('SELECT 1 FROM account_deletions').fetchone()


def test_immutable_google_observation_removed_only_by_confirmed_account_deletion(environment):
    config, google, db = environment
    with client_for(config, google, SimpleNamespace(ready=False)) as client:
        login(client, google)
        with db.connect() as c:
            owner = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO google_billing_observations(id,user_id,google_subject,project_id,billing_account_name,
                currency,credit_eur,consumption_scope,observed_at,source_kind,source_url,proof_sha256,proof_files,observation_sha256)
                VALUES(%s,%s,%s,'project','billingAccounts/TEST-123','EUR',100,'billing_account',now(),
                'observed_google_console','https://console.cloud.google.com/billing/TEST-123',%s,'[]',%s)''',
                (uuid4(), owner['id'], owner['google_subject'], 'a' * 64, 'b' * 64))
        with pytest.raises(RaiseException), db.connect() as c:
            c.execute('DELETE FROM google_billing_observations WHERE user_id=%s', (owner['id'],))
        result = client.post('/api/account/deletion', json=body(client))
        assert result.json()['status'] == 'deleted', result.text
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM google_billing_observations').fetchone()


def test_real_cleanup_path_closes_subscription_and_link_before_purge_with_safe_retry(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        login(client, google)
        with db.connect() as c:
            owner = c.execute('SELECT * FROM users').fetchone()
            attempt, second = uuid4(), uuid4()
            offer = c.execute('SELECT version FROM subscription_offers LIMIT 1').fetchone()['version']
            c.execute('''INSERT INTO billing_checkouts(id,user_id,offer_version,interval,stripe_session,stripe_subscription,status,trial_days)
                VALUES(%s,%s,%s,'monthly','cs_complete','sub_owner','complete',14)''', (attempt, owner['id'], offer))
            c.execute('''INSERT INTO billing_checkouts(id,user_id,offer_version,interval,stripe_session,status,trial_days)
                VALUES(%s,%s,%s,'monthly','cs_open','open',0)''', (second, owner['id'], offer))
            c.execute('''INSERT INTO billing_subscriptions(stripe_id,user_id,checkout_id,customer_id,status,trial_start)
                VALUES('sub_owner',%s,%s,'cus_owner','trialing',now())''', (owner['id'], attempt))
            c.execute("INSERT INTO billing_reminders(subscription_id,due_at) VALUES('sub_owner',now())")
        common = {'livemode': False, 'mode': 'subscription', 'client_reference_id': str(owner['id'])}
        stripe.sessions = {
            'cs_complete': {**common, 'id': 'cs_complete', 'status': 'complete', 'metadata': {'uonify_checkout': str(attempt)}, 'subscription': 'sub_owner', 'customer': 'cus_owner'},
            'cs_open': {**common, 'id': 'cs_open', 'status': 'open', 'metadata': {'uonify_checkout': str(second)}, 'subscription': None, 'customer': None}}
        stripe.subs = {'sub_owner': {'id': 'sub_owner', 'status': 'trialing', 'customer': 'cus_owner',
            'metadata': {'uonify_checkout': str(attempt)}, 'livemode': False, 'trial_start': 1700000000}}
        stripe.cancel_failure = True
        request = body(client)
        failed = client.post('/api/account/deletion', json=request)
        assert failed.json()['status'] == 'error' and failed.json()['canRetry']
        assert stripe.sessions['cs_open']['status'] == 'expired'
        with db.connect() as c:
            assert c.execute('SELECT 1 FROM users WHERE id=%s', (owner['id'],)).fetchone()
            assert c.execute('SELECT count(*) n FROM billing_subscriptions').fetchone()['n'] == 1
        stripe.cancel_failure = False
        assert client.post('/api/account/deletion', json=request).json()['status'] == 'deleted'
        assert stripe.subs['sub_owner']['status'] == 'canceled'
        assert len([x for x in stripe.calls if x[0] == 'expire']) == 1
        with db.connect() as c:
            for table in ('billing_subscriptions', 'billing_checkouts', 'billing_reminders'):
                assert not c.execute('SELECT 1 FROM ' + table).fetchone()
            assert c.execute('SELECT trial_used FROM account_trial_history').fetchone()['trial_used'] is True
