from uuid import uuid4
from conftest import client_for, login
from test_onboarding import TERMS, PERSON, WORK


def complete(client):
    for step, body in [('terms', TERMS), ('you', PERSON), ('work', WORK)]:
        assert client.post('/api/onboarding/' + step, json=body).status_code == 200


def test_offer_and_selection_persist_without_activating_trial(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        assert client.get('/api/billing/onboarding-offer').status_code == 401
        login(client, provider)
        payload = client.get('/api/billing/onboarding-offer').json()
        assert payload['offer']['annualCents'] == 11880 and payload['offer']['monthlyCents'] == 990
        assert payload['selection'] is None and payload['checkoutReady'] is False
        body = {'interval': 'monthly', 'offerVersion': payload['offer']['version']}
        assert client.put('/api/billing/onboarding-selection', json=body).status_code == 409
        complete(client)
        assert client.put('/api/billing/onboarding-selection', json=body, headers={'Origin': 'null'}).status_code == 403
        for extra in [{'interval':'weekly'}, {'offerVersion':'old'}, {'annualCents':1}]:
            assert client.put('/api/billing/onboarding-selection', json={**body, **extra}).status_code in (400,409)
        for _ in range(2):
            assert client.put('/api/billing/onboarding-selection', json=body).json()['selection']['interval'] == 'monthly'
        client.post('/api/auth/logout')
        login(client, provider)
        assert client.get('/api/billing/onboarding-offer').json()['selection']['interval'] == 'monthly'
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM subscription_selections').fetchone()['n'] == 1
            assert c.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 0
        provider.subject = 'second-user'
        login(client, provider)
        assert client.get('/api/billing/onboarding-offer').json()['selection'] is None


def test_access_uses_verified_current_periods_and_account(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        assert client.get('/api/billing/workspace-access').status_code == 401
        login(client, provider)
        assert client.get('/api/billing/workspace-access').json()['status'] == 'onboarding_required'
        complete(client)
        for kind in ('trial','paid'):
            with db.connect() as c:
                user = c.execute('SELECT id FROM users WHERE google_subject=%s',(provider.subject,)).fetchone()
                c.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
                    VALUES(%s,%s,%s,now()-interval '1 day',now()+interval '1 day',%s)''', (uuid4(),user['id'],kind,'test-'+kind))
            assert client.get('/api/billing/workspace-access').json()['basis'] == kind
            with db.connect() as c:
                c.execute("UPDATE access_periods SET ends_at=now() WHERE user_id=%s",(user['id'],))
            assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        with db.connect() as c:
            c.execute("UPDATE access_periods SET starts_at=now()+interval '1 day', ends_at=now()+interval '2 days'")
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        with db.connect() as c:
            c.execute("UPDATE access_periods SET starts_at=now()-interval '1 day', revoked_at=now()")
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
        provider.subject = 'other'
        login(client, provider)
        complete(client)
        assert client.get('/api/billing/workspace-access').json()['status'] == 'subscription_required'
