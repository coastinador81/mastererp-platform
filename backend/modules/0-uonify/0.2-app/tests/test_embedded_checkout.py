from dataclasses import replace
from unittest.mock import Mock
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from conftest import client_for, login
from test_subscription import complete
from test_stripe_checkout import Stripe
from billing_setup_fixture import ready_setup
from app.stripe_provider import StripeProvider


class EmbeddedStripe(Stripe):
    embedded_ready = True
    publishable_key = 'pk_test_' + 'FixtureOnly000000000000'

    def create_checkout(self, attempt, user, offer):
        session = super().create_checkout(attempt, user, offer)
        session.update(ui_mode=attempt['ui_mode'], client_secret=session['id'] + '_secret_FixtureOnly')
        return session


def prepare(client, google, database, ready=True):
    login(client, google); complete(client)
    if ready:
        ready_setup(database, google.subject)
    assert client.put('/api/billing/onboarding-selection', json={'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code == 200


def test_embedded_requires_preparation_consent_and_origin_before_creating(environment):
    config, google, database = environment
    stripe = EmbeddedStripe()
    with client_for(config, google, stripe) as client:
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code == 401
        prepare(client, google, database, ready=False)
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code == 409
        assert client.post('/api/billing/checkout').status_code == 409
        ready_setup(database,google.subject)
        for body in [{}, {'acceptRenewal':False}, {'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09','userId':str(uuid4())}]:
            assert client.post('/api/billing/checkout-embedded',json=body).status_code == 400
        for changed in [{'interval':'annual'},{'offerVersion':'old'}]:
            body={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09',**changed}
            assert client.post('/api/billing/checkout-embedded',json=body).status_code == 409
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'},headers={'Origin':'null'}).status_code == 403
        assert stripe.creations == 0
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'


def test_embedded_resume_timeout_and_confirmation_are_server_authoritative(environment):
    config, google, database = environment
    stripe = EmbeddedStripe()
    with client_for(config, google, stripe) as client:
        prepare(client,google,database)
        stripe.fail_create=True
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code == 503
        stripe.fail_create=False
        a = client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'})
        assert a.status_code == 200 and a.headers['cache-control']=='no-store'
        assert 'url' not in a.json()
        assert a.json()['summary']['dueTodayCents']==0 and a.json()['summary']['totalCents']==1198
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).json()==a.json()
        assert stripe.creations==1
        assert client.get('/api/billing/onboarding-offer').json()['embeddedReady'] is True
        assert client.post('/api/billing/checkout-status').json()['access']['status']=='subscription_required'
        stripe.finish()
        for _ in range(2):
            assert client.post('/api/billing/checkout-status').json()['access']['basis']=='trial'
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code==409
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n']==1
            assert connection.execute('SELECT renewal_accepted_at FROM billing_checkouts').fetchone()['renewal_accepted_at']


def test_used_trial_and_ambiguous_stale_intent_never_create_second_free_trial(environment):
    config, google, database = environment
    stripe = EmbeddedStripe()
    with client_for(config,google,stripe) as client:
        prepare(client,google,database)
        with database.connect() as connection:
            user=connection.execute('SELECT id FROM users').fetchone()
            connection.execute("INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference) VALUES(%s,%s,'trial',now()-interval '15 days',now()-interval '1 day','fixture-old-trial')",(uuid4(),user['id']))
        response=client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'})
        assert response.json()['summary']['dueTodayCents']==1198
        assert response.json()['summary']['trialDays']==0
        assert client.post('/api/billing/checkout/abandon').status_code==200
        with database.connect() as connection:
            connection.execute("INSERT INTO billing_checkouts(id,user_id,offer_version,interval,trial_days,ui_mode,created_at) VALUES(%s,%s,'launch-2026-10-09','monthly',0,'embedded',now()-interval '24 hours')",(uuid4(),user['id']))
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code==409
        assert stripe.creations==1


@pytest.mark.parametrize('field,value',[('livemode',True),('client_reference_id','someone-else'),('ui_mode','hosted'),('client_secret','')])
def test_embedded_rejects_wrong_owner_mode_secret_and_live_response(environment,field,value):
    config,google,database=environment
    stripe=EmbeddedStripe()
    with client_for(config,google,stripe) as client:
        prepare(client,google,database)
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code==200
        next(iter(stripe.sessions.values()))[field]=value
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code in (409,503)
        assert client.get('/api/billing/workspace-access').json()['status']=='subscription_required'


def test_opaque_long_secret_is_accepted_and_missing_secret_keeps_external_reference(environment):
    config,google,database=environment
    stripe=EmbeddedStripe()
    original=stripe.create_checkout
    def create(attempt,user,offer):
        result=original(attempt,user,offer)
        result['client_secret']=None
        return result
    stripe.create_checkout=create
    body={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}
    with client_for(config,google,stripe) as client:
        prepare(client,google,database)
        assert client.post('/api/billing/checkout-embedded',json=body).status_code==503
        with database.connect() as connection:
            row=connection.execute('SELECT stripe_session FROM billing_checkouts').fetchone()
            assert row['stripe_session']==next(iter(stripe.sessions.values()))['id']
        # Formato de fixture largo y opaco: no copiar secretos reales a un test.
        session=next(iter(stripe.sessions.values()))
        session['client_secret']='cs_test_fixture_secret_' + 'Opaque_fixture-123='*24
        response=client.post('/api/billing/checkout-embedded',json=body)
        assert response.status_code==200
        assert response.json()['clientSecret']==session['client_secret']
        assert stripe.creations==1
        assert client.post('/api/billing/checkout/abandon').status_code==200
        assert session['status']=='expired'


def test_missing_publicable_key_does_not_open_checkout_or_change_account(environment):
    config,google,database=environment
    stripe=EmbeddedStripe();stripe.embedded_ready=False
    with client_for(config,google,stripe) as client:
        prepare(client,google,database)
        assert client.post('/api/billing/checkout-embedded',json={'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code==503
        assert stripe.creations==0
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM billing_checkouts').fetchone()['n']==0


def test_two_concurrent_opens_share_one_durable_session_and_consent(environment):
    config,google,database=environment
    stripe=EmbeddedStripe()
    with client_for(config,google,stripe) as client:
        prepare(client,google,database)
        def open_checkout():
            return client.post('/api/billing/checkout-embedded',json={
                'acceptRenewal':True,'interval':'monthly','offerVersion':'launch-2026-10-09'})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:open_checkout(),range(2)))
        assert [r.status_code for r in results]==[200,200]
        assert results[0].json()==results[1].json() and stripe.creations==1
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM billing_checkouts').fetchone()['n']==1
            assert connection.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n']==0


@pytest.mark.parametrize('value',[False,1,'true',None])
def test_renewal_consent_requires_literal_boolean(value,environment):
    config,google,database=environment
    stripe=EmbeddedStripe()
    with client_for(config,google,stripe) as client:
        prepare(client,google,database)
        assert client.post('/api/billing/checkout-embedded',json={
            'acceptRenewal':value,'interval':'monthly','offerVersion':'launch-2026-10-09'}).status_code==400
        assert stripe.creations==0


def test_basil_embedded_provider_uses_no_redirect_and_preserves_trial_rules(environment,tmp_path):
    config,_,_=environment
    (tmp_path/'stripe-test-key').write_text('fixture')
    (tmp_path/'stripe-test-vat21').touch()
    (tmp_path/'stripe-test-publishable-key').write_text('pk_test_'+'FixtureOnly000000000000')
    stripe=StripeProvider(replace(config,secrets_directory=str(tmp_path)))
    stripe.verify_catalog=Mock()
    calls=[]
    def request(method,path,data=None,key=None):
        calls.append((method,path,data,key))
        return {'data':[{'id':'txr_fixture','description':'IVA de ejemplo para pruebas locales de Uonify','percentage':21,'inclusive':False,'livemode':False}]} if path=='/tax_rates' else {'id':'cs_test_fixture'}
    stripe.request=request
    stripe.create_checkout({'id':'fixture','interval':'monthly','trial_days':0,'ui_mode':'embedded'},{'id':'fixture','email':'one@example.test'}, {})
    data=calls[-1][2]
    assert data['ui_mode']=='embedded' and data['redirect_on_completion']=='never'
    assert 'success_url' not in data and 'cancel_url' not in data and 'return_url' not in data
    assert 'trial_period_days' not in data['subscription_data']
    assert data['payment_method_collection']=='always' and data['payment_method_types']==['card']
