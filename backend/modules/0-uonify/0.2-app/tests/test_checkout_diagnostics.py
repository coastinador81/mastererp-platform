"""Diagnóstico seguro del SDK, independiente de la autoridad financiera."""
from copy import deepcopy
from unittest.mock import Mock
from uuid import UUID, uuid4
import pytest
from conftest import client_for, login
from test_embedded_checkout import EmbeddedStripe, prepare
from app.billing_diagnostics import safe_message


def payload(attempt=None, **changes):
    return {'checkoutAttemptId': str(attempt or uuid4()), 'phase': 'initialization',
            'category': 'integration', 'errorName': 'IntegrationError',
            'message': 'You cannot have multiple Embedded Checkout objects.', **changes}


def seed_attempt(database, status='open', mode='embedded'):
    with database.connect() as connection:
        user = connection.execute('SELECT id FROM users ORDER BY created_at LIMIT 1').fetchone()
        attempt = uuid4()
        connection.execute('''INSERT INTO billing_checkouts
            (id,user_id,offer_version,interval,trial_days,ui_mode,status,stripe_session)
            VALUES(%s,%s,'launch-2026-10-09','monthly',0,%s,%s,%s)''',
            (attempt, user['id'], mode, status, 'cs_test_' + str(attempt)))
    return attempt


def attempt_row(database, attempt):
    with database.connect() as connection:
        return connection.execute('SELECT * FROM billing_checkouts WHERE id=%s', (attempt,)).fetchone()


def test_diagnostics_require_session_origin_owned_embedded_attempt(environment):
    config, google, database = environment
    with client_for(config, google, EmbeddedStripe()) as client:
        assert client.post('/api/billing/checkout-diagnostics', json=payload()).status_code == 401
        login(client, google)
        attempt = seed_attempt(database)
        assert client.post('/api/billing/checkout-diagnostics', json=payload(attempt),
                           headers={'Origin': 'null'}).status_code == 403
        client.headers.pop('Origin')
        assert client.post('/api/billing/checkout-diagnostics', json=payload(attempt)).status_code == 403
        client.headers['Origin'] = config.origin
        absent = client.post('/api/billing/checkout-diagnostics', json=payload())
        assert absent.status_code == 404
        google.subject = 'another-diagnostic-owner'
        google.email = 'other@example.test'
        login(client, google)
        other = client.post('/api/billing/checkout-diagnostics', json=payload(attempt))
        assert other.status_code == 404 and other.json() == absent.json()
        assert attempt_row(database, attempt)['client_error_details'] is None


@pytest.mark.parametrize('changes', [
    {'checkoutAttemptId': 'not-a-uuid'}, {'checkoutAttemptId': 12},
    {'phase': 'unknown'}, {'category': 'unknown'}, {'errorName': 'Window'},
    {'message': 'x' * 1201}, {'message': ''}, {'message': 12}, {'userId': str(uuid4())},
])
def test_diagnostics_validate_bounded_payload_without_echo(environment, changes):
    config, google, database = environment
    with client_for(config, google, EmbeddedStripe()) as client:
        login(client, google)
        attempt = seed_attempt(database)
        response = client.post('/api/billing/checkout-diagnostics', json=payload(attempt, **changes))
        assert response.status_code == 400
        assert response.json() == {'error': 'invalid_request', 'message': 'Revisa los datos enviados.'}
        assert attempt_row(database, attempt)['client_error_details'] is None


@pytest.mark.parametrize('status', ['creating', 'open', 'complete', 'expired'])
def test_latest_diagnostic_never_calls_stripe_changes_status_or_grants_access(environment, status):
    config, google, database = environment
    stripe = EmbeddedStripe()
    for name in ['checkout', 'create_checkout', 'subscription', 'invoices', 'request', 'cancel']:
        setattr(stripe, name, Mock(side_effect=AssertionError('No provider call for diagnostics')))
    with client_for(config, google, stripe) as client:
        login(client, google)
        attempt = seed_attempt(database, status)
        before = attempt_row(database, attempt)
        response = client.post('/api/billing/checkout-diagnostics', json=payload(attempt))
        assert response.status_code == 200 and response.json() == {'recorded': True}
        assert response.headers['cache-control'] == 'no-store'
        first = attempt_row(database, attempt)
        assert first['client_error_details'] == {k: v for k, v in payload(attempt).items() if k != 'checkoutAttemptId'}
        assert first['client_error_at'] is not None
        response = client.post('/api/billing/checkout-diagnostics', json=payload(attempt,
            phase='mount', category='mount', errorName='Error', message='Mount target unavailable'))
        assert response.status_code == 200
        after = attempt_row(database, attempt)
        assert after['client_error_details']['message'] == 'Mount target unavailable'
        assert after['client_error_at'] >= first['client_error_at']
        for key, value in before.items():
            if key not in ('client_error_details', 'client_error_at'):
                assert after[key] == value
        for name in ['checkout', 'create_checkout', 'subscription', 'invoices', 'request', 'cancel']:
            getattr(stripe, name).assert_not_called()
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM access_periods').fetchone()['n'] == 0
            assert connection.execute('SELECT count(*) AS n FROM billing_subscriptions').fetchone()['n'] == 0


def test_diagnostics_redact_sensitive_text_again_before_persistence_and_never_echo(environment):
    config, google, database = environment
    values = ['pk_test_short', 'sk_live_secret', 'cs_test_fixture_secret_value',
              'A1b2C3d4E5f6G7h8I9j0K1l2', 'person@example.test', 'token123', 'querysecret', 'fragmentsecret']
    message = ('Failed to initialize: ' + ' '.join(values[:5]) + ' token=token123 '
               'https://sdk.example.test/frame?client_secret=querysecret#fragmentsecret')
    with client_for(config, google, EmbeddedStripe()) as client:
        login(client, google)
        attempt = seed_attempt(database)
        response = client.post('/api/billing/checkout-diagnostics', json=payload(attempt, message=message))
        assert response.json() == {'recorded': True}
        saved = attempt_row(database, attempt)['client_error_details']['message']
        for value in values:
            assert value not in saved and value not in response.text
        assert 'Failed to initialize:' in saved
        assert '[URL]' in saved and 'sdk.example.test' not in saved and '?' not in saved and '#' not in saved


def test_diagnostic_sanitizer_strips_url_credentials_headers_control_and_long_tokens():
    message = ('https://name:pass@example.test/private-short-secret?token=short#fragment '
               'Bearer short-token client_secret="another-secret" access_token=short '
               'eyJfixtureHeader.abcdefghijklmnopqrstuvwxyz0123456789.signature '
               '4242 4242 4242 4242 4000000000000002 whsec_short pm_fixture\n\tready\x7f')
    saved = safe_message(message)
    for text in ['name:pass', 'example.test', 'private-short-secret', 'short-token', 'another-secret', '=short', 'token=short',
                 'fragment', 'abcdefghijklmnopqrstuvwxyz0123456789', '4242',
                 '4000000000000002', 'whsec_short', 'pm_fixture', '\n', '\t', '\x7f']:
        assert text not in saved
    assert saved.endswith('ready')


def test_hosted_attempt_is_not_a_client_embedded_diagnostic_target(environment):
    config, google, database = environment
    with client_for(config, google, EmbeddedStripe()) as client:
        login(client, google)
        attempt = seed_attempt(database, mode='hosted')
        assert client.post('/api/billing/checkout-diagnostics', json=payload(attempt)).status_code == 404
        assert attempt_row(database, attempt)['client_error_details'] is None


@pytest.mark.parametrize('text,secret', [
    ('Cookie: session=short-secret; user=person', 'short-secret'),
    ('Authorization: Basic c2hvcnQ=', 'c2hvcnQ='),
    ('Proxy-Authorization: Basic c2hvcnQ=', 'c2hvcnQ='),
    ('Set-Cookie: sid=short-secret; Secure', 'short-secret'),
    ('client secret: short-value', 'short-value'),
    ('api key: short-value', 'short-value'),
    ('"client secret": "short-value"', 'short-value'),
    ('"access token": "short-value"', 'short-value'),
    ("'Authorization': 'Basic c2hvcnQ='", 'c2hvcnQ='),
])
def test_diagnostic_sanitizer_removes_headers_and_short_secrets_with_spaced_keys(text, secret):
    sanitized = safe_message('SDK failed\n' + text + '\nPublic explanation')
    assert secret not in sanitized
    assert 'SDK failed' in sanitized and 'Public explanation' in sanitized


def test_checkout_dto_exposes_only_owned_stable_attempt_id_and_diagnostics_do_not_reshape_status(environment):
    config, google, database = environment
    stripe = EmbeddedStripe()
    with client_for(config, google, stripe) as client:
        prepare(client, google, database)
        consent = {'acceptRenewal': True, 'interval': 'monthly', 'offerVersion': 'launch-2026-10-09'}
        first = client.post('/api/billing/checkout-embedded', json=consent).json()
        assert set(first) == {'checkoutAttemptId', 'clientSecret', 'publishableKey', 'summary'}
        attempt = UUID(first['checkoutAttemptId'])
        assert attempt_row(database, attempt)['user_id'] is not None
        status_before = client.post('/api/billing/checkout-status').json()
        session_before = deepcopy(stripe.sessions)
        assert client.post('/api/billing/checkout-diagnostics', json=payload(attempt)).status_code == 200
        assert client.post('/api/billing/checkout-status').json() == status_before
        assert client.post('/api/billing/checkout-embedded', json=consent).json() == first
        assert stripe.sessions == session_before and stripe.creations == 1
