"""Un fallo de montaje no crea otro pago: primero se concilia el existente."""
from conftest import client_for
from test_embedded_checkout import EmbeddedStripe, prepare


def test_check_status_reports_open_expired_and_complete_without_starting_another_checkout(environment):
    config, google, database = environment
    stripe = EmbeddedStripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, database)
        assert client.post('/api/billing/checkout-status').json()['checkoutStatus'] is None
        body = {'acceptRenewal': True, 'interval': 'monthly', 'offerVersion': 'launch-2026-10-09'}
        assert client.post('/api/billing/checkout-embedded', json=body).status_code == 200
        first = next(iter(stripe.sessions.values()))
        pending = client.post('/api/billing/checkout-status').json()
        assert pending['checkoutStatus'] == 'open'
        assert pending['access']['status'] == 'subscription_required'
        first['status'] = 'expired'
        expired = client.post('/api/billing/checkout-status').json()
        assert expired['checkoutStatus'] == 'expired'
        assert expired['access']['status'] == 'subscription_required'
        assert stripe.creations == 1
        # Solo una autorización posterior puede abrir otro formulario.
        assert client.post('/api/billing/checkout-embedded', json=body).status_code == 200
        assert stripe.creations == 2
        stripe.finish()
        completed = client.post('/api/billing/checkout-status').json()
        assert completed['checkoutStatus'] == 'complete'
        assert completed['access']['status'] == 'allowed'
        assert stripe.creations == 2


def test_check_status_is_scoped_to_current_account_and_never_discloses_stripe_identifiers(environment):
    config, google, database = environment
    stripe = EmbeddedStripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, database)
        body = {'acceptRenewal': True, 'interval': 'monthly', 'offerVersion': 'launch-2026-10-09'}
        client.post('/api/billing/checkout-embedded', json=body)
        response = client.post('/api/billing/checkout-status')
        assert set(response.json()) == {'subscription', 'access', 'checkoutStatus'}
        assert 'cs_test_' not in response.text and 'clientSecret' not in response.text
        google.subject = 'separate-recovery-account'
        google.email = 'separate@example.test'
        from conftest import login
        login(client, google)
        assert client.post('/api/billing/checkout-status').json()['checkoutStatus'] is None
        assert stripe.creations == 1
