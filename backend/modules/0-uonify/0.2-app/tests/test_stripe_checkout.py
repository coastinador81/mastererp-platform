import time
from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi import HTTPException
from conftest import client_for, login
from test_subscription import complete
from app.billing_worker import tick
from app.stripe_provider import PRICES
from billing_setup_fixture import ready_setup


class Stripe:
    ready = True
    origin = 'http://127.0.0.1:5173'

    def __init__(self):
        self.sessions = {}
        self.subs = {}
        self.creations = 0
        self.fail_create = False
        self.paid = []
        self.event = {}

    def create_checkout(self, attempt, user, offer):
        key = str(attempt['id'])
        if key not in self.sessions:
            self.creations += 1
            self.sessions[key] = {'id': 'cs_test_' + key, 'url': 'https://checkout.stripe.com/c/pay/' + key,
                                  'livemode': False, 'mode': 'subscription', 'status': 'open',
                                  'client_reference_id': str(user['id']), 'metadata': {'uonify_checkout': key},
                                  'interval': attempt['interval'], 'trial_days': attempt['trial_days']}
        if self.fail_create:
            raise HTTPException(503)
        return self.sessions[key]

    def checkout(self, identity):
        return next(x for x in self.sessions.values() if x['id'] == identity)

    def subscription(self, identity):
        return deepcopy(self.subs[identity])

    def invoices(self, identity):
        return self.paid

    def finish(self, start=None):
        session = list(self.sessions.values())[-1]
        identity = 'sub_' + session['metadata']['uonify_checkout']
        now = int(time.time()) if start is None else start
        trial = session['trial_days']
        session.update(status='complete', subscription=identity, customer='cus_test')
        self.subs[identity] = {'id': identity, 'livemode': False, 'status': 'trialing' if trial else 'active',
                              'customer': 'cus_test', 'metadata': session['metadata'], 'default_payment_method': 'pm_card',
                              'trial_start': now if trial else None, 'trial_end': now + trial*86400 if trial else None,
                              'cancel_at_period_end': False,
                              'items': {'data': [{'quantity': 1,'price': {'id': PRICES[session['interval']]},'current_period_end': now+14*86400}]}}
        return identity

    def request(self, method, path, data=None, key=None):
        assert method == 'POST' and path.endswith('/expire')
        session = self.checkout(path.split('/')[-2])
        session['status'] = 'expired'
        return session

    def cancel(self, identity):
        self.subs[identity]['cancel_at_period_end'] = True

    def preview(self, identity):
        return {'livemode': False, 'currency': 'eur', 'total': 1198}

    def verify_event(self, raw, signature):
        return self.event


def prepare(client, provider, database):
    login(client, provider)
    complete(client)
    ready_setup(database, provider.subject)
    assert client.put('/api/billing/onboarding-selection', json={'interval': 'monthly','offerVersion':'launch-2026-10-09'}).status_code == 200


def test_checkout_idempotent_activation_and_cancellation(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        assert client.post('/api/billing/checkout').status_code == 401
        prepare(client, google, db)
        assert client.post('/api/billing/checkout', headers={'Origin':'null'}).status_code == 403
        a = client.post('/api/billing/checkout')
        assert a.status_code == 200
        assert client.post('/api/billing/checkout').json() == a.json()
        assert stripe.creations == 1
        assert client.put('/api/billing/onboarding-selection',json={'interval':'annual','offerVersion':'launch-2026-10-09'}).status_code == 409
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        assert client.post('/api/billing/subscription/refresh').json()['subscription'] is None
        stripe.finish()
        for _ in range(2):
            assert client.post('/api/billing/subscription/refresh').json()['subscription']['status'] == 'trialing'
        assert client.get('/api/billing/workspace-access').json()['basis'] == 'trial'
        assert client.post('/api/billing/checkout').status_code == 409
        assert client.post('/api/billing/subscription/cancel').json()['subscription']['cancelAtPeriodEnd'] is True
        assert client.post('/api/billing/subscription/cancel').status_code == 200
        assert client.get('/api/billing/workspace-access').json()['basis'] == 'trial'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 1
            assert c.execute('SELECT canceled_at FROM billing_reminders').fetchone()['canceled_at']
        google.subject = 'second-account'
        login(client, google)
        assert client.post('/api/billing/subscription/refresh').json()['subscription'] is None
        assert client.post('/api/billing/subscription/cancel').status_code == 409


def test_timeout_retry_reuses_persisted_intent(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, db)
        stripe.fail_create = True
        assert client.post('/api/billing/checkout').status_code == 503
        stripe.fail_create = False
        assert client.post('/api/billing/checkout').status_code == 200
        assert stripe.creations == 1


def test_canonical_state_rejects_live_wrong_owner_and_missing_card(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, db)
        client.post('/api/billing/checkout')
        identity = stripe.finish()
        session = list(stripe.sessions.values())[0]
        for key, bad in [('livemode',True),('client_reference_id',str(uuid4()))]:
            original = session[key]; session[key] = bad
            assert client.post('/api/billing/subscription/refresh').status_code == 503
            session[key] = original
        stripe.subs[identity]['default_payment_method'] = None
        assert client.post('/api/billing/subscription/refresh').status_code == 503
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 0


def test_background_confirmation_reminder_and_duplicate_events(environment):
    config, google, db = environment
    stripe = Stripe()
    sent = []
    with client_for(config, google, stripe) as client:
        prepare(client, google, db)
        client.post('/api/billing/checkout')
        identity = stripe.finish(start=int(time.time()) - 11*86400 - 30)
        tick(db, stripe, sent.append)
        tick(db, stripe, sent.append)
        assert len(sent) == 1 and '11,98 €' in sent[0].get_content()
        assert '?billing=manage' in sent[0].get_content()
        stripe.cancel(identity)
        stripe.event = {'id':'evt_duplicate','data':{'object':{'id':identity,'status':'trialing'}}}
        for _ in range(2):
            assert client.post('/api/billing/stripe/webhook',json={}).status_code == 200
        assert client.get('/api/billing/onboarding-offer').json()['subscription']['cancelAtPeriodEnd'] is True
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM billing_events').fetchone()['n'] == 1
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 1


def test_expired_trial_needs_paid_invoice_and_cannot_repeat_trial(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, db)
        client.post('/api/billing/checkout')
        identity = stripe.finish(start=int(time.time()) - 15*86400)
        client.post('/api/billing/subscription/refresh')
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        stripe.subs[identity]['status'] = 'active'
        client.post('/api/billing/subscription/refresh')
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        now = int(time.time())
        stripe.paid = [{'id':'in_paid','livemode':False,'status':'paid','amount_paid':1198,
                        'parent':{'subscription_details':{'subscription':identity}},
                        'lines':{'data':[{'id':'il_paid','amount':990,'pricing':{'price_details':{'price':PRICES['monthly']}},
                                         'period':{'start':now-60,'end':now+86400}}]}}]
        client.post('/api/billing/subscription/refresh')
        assert client.get('/api/billing/workspace-access').json()['basis'] == 'paid'
        stripe.subs[identity]['status'] = 'canceled'
        client.post('/api/billing/subscription/refresh')
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM account_trial_history').fetchone()['n'] == 0
        assert client.get('/api/billing/onboarding-offer').json()['trialUsed'] is True
        assert client.post('/api/billing/checkout').status_code == 200
        assert list(stripe.sessions.values())[-1]['trial_days'] == 0


def test_pending_deletion_stops_worker_and_late_webhook_before_provider_or_grants(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, db)
        assert client.post('/api/billing/checkout').status_code == 200
        stripe.finish()
        session = list(stripe.sessions.values())[-1]
        with db.connect() as connection:
            user = connection.execute('SELECT id FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            connection.execute('UPDATE users SET deletion_requested_at=now() WHERE id=%s', (user['id'],))
        external_attempts = []
        def forbidden(*_):
            external_attempts.append(True)
            raise AssertionError('A frozen account must not contact Stripe or SMTP')
        stripe.checkout = forbidden
        tick(db, stripe, send=forbidden)
        stripe.event = {'id': 'evt_deleted_' + uuid4().hex, 'data': {'object': {'id': session['id']}}}
        assert client.post('/api/billing/stripe/webhook', content=b'fixture').json() == {'received': True}
        assert external_attempts == []
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM billing_subscriptions WHERE user_id=%s', (user['id'],)).fetchone()['n'] == 0
            assert connection.execute('SELECT count(*) AS n FROM access_periods WHERE user_id=%s', (user['id'],)).fetchone()['n'] == 0


def test_abandon_checkout_allows_a_different_interval_without_trial(environment):
    config, google, db = environment
    stripe = Stripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, db)
        client.post('/api/billing/checkout')
        assert client.post('/api/billing/checkout/abandon').status_code == 200
        assert client.put('/api/billing/onboarding-selection', json={'interval':'annual','offerVersion':'launch-2026-10-09'}).status_code == 200
        assert client.post('/api/billing/checkout').status_code == 200
        assert stripe.creations == 2
        assert list(stripe.sessions.values())[0]['status'] == 'expired'
        assert list(stripe.sessions.values())[-1]['interval'] == 'annual'
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'


@pytest.mark.parametrize('already_open',[False,True])
def test_hosted_checkout_revalidates_owner_after_session_changes_between_transactions(environment,monkeypatch,already_open):
    from app import billing_checkout
    from app.security import SESSION_COOKIE, digest
    config,google,db=environment
    stripe=Stripe()
    with client_for(config,google,stripe) as client:
        prepare(client,google,db)
        original_subject,original_email=google.subject,google.email
        with db.connect() as connection:
            first=connection.execute('SELECT id FROM users WHERE google_subject=%s',(google.subject,)).fetchone()['id']
        if already_open:
            assert client.post('/api/billing/checkout').status_code==200
        google.subject,google.email='another-checkout-owner','second@example.test'
        prepare(client,google,db)
        with db.connect() as connection:
            second=connection.execute('SELECT id FROM users WHERE google_subject=%s',(google.subject,)).fetchone()['id']
        google.subject,google.email=original_subject,original_email
        login(client,google)
        original=billing_checkout.require_user
        calls=[]
        def changed_session(connection,request):
            calls.append(True)
            if len(calls)==2:
                with db.connect() as switched:
                    switched.execute('UPDATE sessions SET user_id=%s WHERE token_hash=%s',
                        (second,digest(request.cookies[SESSION_COOKIE])))
            return original(connection,request)
        monkeypatch.setattr(billing_checkout,'require_user',changed_session)
        response=client.post('/api/billing/checkout')
        assert response.status_code==409 and 'url' not in response.json()
        assert len(calls)==2 and stripe.creations==int(already_open)
        with db.connect() as connection:
            rows=connection.execute('SELECT user_id,stripe_session,status FROM billing_checkouts').fetchall()
            assert len(rows)==1 and rows[0]['user_id']==first
            assert bool(rows[0]['stripe_session']) is already_open
            assert rows[0]['status']==('open' if already_open else 'creating')
            assert connection.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n']==0
