"""OAuth Amazon local y gateway HTTPS; todos los códigos y tokens son ficticios."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from threading import Event
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
import json
import re

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from conftest import client_for, login
from test_subscription import complete
from app.amazon_gateway import COOKIE, CALLBACK_PATH, LOGIN_PATH, create_gateway
from app.amazon_provider import AmazonConfig, AmazonProvider, load_config, public_origin, validate_amazon_callback
from app.security import SESSION_COOKIE, digest

BASE = '/api/connections/amazon'
PUBLIC = 'https://amazon-gateway.example.test'
APP = 'amzn1.sellerapps.app.test-app-12345678'
SELLER = 'SELLERTEST123'
REFRESH = 'fixture-amazon-refresh-token-only'


class Amazon(AmazonProvider):
    def __init__(self, ready=True):
        self.config = AmazonConfig(PUBLIC, APP, 'fixture-client' if ready else '', 'fixture-secret' if ready else '')
        self.calls = []
        self.entered = None
        self.release = None
        self.failure = False

    def exchange(self, code):
        self.calls.append(code)
        if self.entered:
            self.entered.set()
            assert self.release.wait(10), 'El test no liberó el canje ficticio'
        if self.failure:
            raise ValueError('fixture-provider-failure')
        return REFRESH


@contextmanager
def clients(environment, amazon=None):
    config, google, db = environment
    amazon = amazon or Amazon()
    with client_for(config, google, amazon=amazon) as local:
        with TestClient(create_gateway(config, amazon), base_url=PUBLIC, follow_redirects=False) as gateway:
            yield local, gateway, amazon


def ready(local, google, db):
    login(local, google)
    complete(local)
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
        c.execute("""INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
            VALUES(%s,%s,'trial',now(),now()+interval '14 days',%s)""",
                  (uuid4(), user['id'], 'amazon-test-' + str(uuid4())))


def launch(local, gateway, url):
    first = gateway.get(url)
    assert first.status_code == 303, first.text
    cookie = first.headers['set-cookie']
    assert all(part in cookie for part in ['Secure', 'HttpOnly', 'SameSite=lax', 'Path=/integrations/amazon'])
    bootstrap_url = first.headers['location']
    assert bootstrap_url.startswith(str(local.base_url).rstrip('/') + BASE + '/bootstrap?')
    bound = local.get(bootstrap_url)
    assert bound.status_code == 303, bound.text
    assert bound.headers['location'].startswith(PUBLIC + LOGIN_PATH + '?resume=')
    resumed = gateway.get(bound.headers['location'])
    assert resumed.status_code == 303, resumed.text
    return resumed


def start(local, gateway):
    response = local.post(BASE + '/start')
    assert response.status_code == 200, response.text
    started = response.json()
    launched = launch(local, gateway, started['authUrl'])
    state = parse_qs(urlsplit(launched.headers['location']).query)['state'][0]
    return started, state, launched


def callback(gateway, state, seller=SELLER, **extra):
    return gateway.get(CALLBACK_PATH, params={
        'state': state, 'selling_partner_id': seller, 'spapi_oauth_code': 'fixture-auth-code', **extra})


def disconnected(local):
    assert local.get(BASE).json()['connection']['status'] == 'disconnected'


def incoming(gateway):
    response = gateway.get(LOGIN_PATH, params={
        'amazon_callback_uri': 'https://sellercentral-europe.amazon.com/apps/authorize/confirm/' + APP,
        'amazon_state': 'fixture-amazon-state', 'selling_partner_id': SELLER, 'version': 'beta'})
    assert response.status_code == 200
    intent = re.search(r'amazon_intent=([A-Za-z0-9_-]+)', response.text).group(1)
    assert 'fixture-amazon-state' not in response.text
    return intent


def test_website_happy_path_encrypts_credentials_and_rejects_replay(environment):
    config, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        assert local.get(BASE).status_code == 401
        ready(local, google, db)
        session = local.cookies.get(SESSION_COOKIE)
        started, state, launched = start(local, gateway)
        params = parse_qs(urlsplit(launched.headers['location']).query)
        assert params['version'] == ['beta'] and params['application_id'] == [APP]
        assert params['redirect_uri'] == [PUBLIC + CALLBACK_PATH]
        assert gateway.get(started['authUrl']).status_code == 409
        assert local.get(BASE + '/flows/' + started['flowId']).json() == {'status': 'pending'}
        response = callback(gateway, state)
        assert response.status_code == 200
        assert all(value not in response.text for value in [REFRESH, state, 'fixture-auth-code', 'fixture-secret'])
        assert local.cookies.get(SESSION_COOKIE) == session
        assert local.get(BASE + '/flows/' + started['flowId']).json() == {'status': 'success'}
        connection = local.get(BASE).json()['connection']
        assert connection['sellerId'] == SELLER and connection['marketplaceId'] == 'A1RKKUPIHCS9HS'
        with db.connect() as c:
            saved = c.execute('SELECT refresh_encrypted FROM amazon_connections').fetchone()
            assert saved['refresh_encrypted'] != REFRESH
            assert Fernet(config.encryption_key).decrypt(saved['refresh_encrypted'].encode()).decode() == REFRESH
        assert callback(gateway, state).status_code == 400
        assert amazon.calls == ['fixture-auth-code']
        with db.connect() as c:
            c.execute('UPDATE access_periods SET ends_at=now()')
        assert local.delete(BASE).json()['amazonRevocationRequired'] is True
        disconnected(local)


def test_start_requires_session_subscription_origin_and_configuration(environment):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        assert local.post(BASE + '/start').status_code == 401
        login(local, google)
        complete(local)
        assert local.post(BASE + '/start').status_code == 403
        ready(local, google, db)
        assert local.post(BASE + '/start', headers={'Origin': 'https://evil.example'}).status_code == 403
        assert local.post(BASE + '/start', json={'sellerId': SELLER}).status_code == 400
        assert local.delete(BASE, headers={'Origin': 'null'}).status_code == 403
    with clients(environment, Amazon(ready=False)) as (local, gateway, amazon):
        login(local, google)
        status = local.get(BASE).json()
        assert status['available'] is False and status['setup']['credentialsReady'] is False
        assert 'fixture-secret' not in json.dumps(status)
        assert local.post(BASE + '/start').status_code == 503
        assert gateway.get(LOGIN_PATH).status_code == 200
        assert gateway.get(LOGIN_PATH, params={'launch': 'x' * 43}).status_code == 503


def test_gateway_exposes_only_its_routes_and_rejects_malformed_requests(environment):
    with clients(environment) as (_, gateway, _):
        for path in ['/api/auth/session', BASE, '/docs', '/openapi.json']:
            assert gateway.get(path).status_code == 404
        assert gateway.post(LOGIN_PATH).status_code == 405
        assert gateway.get(LOGIN_PATH, headers={'Host': 'evil.example'}).status_code == 400
        assert gateway.get(LOGIN_PATH + '?launch=a&launch=b').status_code == 400
        assert gateway.get(LOGIN_PATH + '?unknown=x').status_code == 400
        assert gateway.get(LOGIN_PATH + '?launch=' + 'a' * 8200).status_code == 400
        response = gateway.get(LOGIN_PATH)
        assert response.headers['cache-control'] == 'no-store'
        assert response.headers['referrer-policy'] == 'no-referrer'
        assert "frame-ancestors 'none'" in response.headers['content-security-policy']


def test_missing_browser_cookie_cannot_consume_valid_state(environment):
    config, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started, state, _ = start(local, gateway)
        with TestClient(create_gateway(config, amazon), base_url=PUBLIC) as other:
            assert callback(other, state).status_code == 400
        assert amazon.calls == []
        assert local.get(BASE + '/flows/' + started['flowId']).json()['status'] == 'pending'
        assert callback(gateway, state).status_code == 200


def test_flow_is_bound_to_original_session_and_user(environment):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started, state, _ = start(local, gateway)
        google.subject = 'another-account'; google.email = 'another@example.test'
        ready(local, google, db)
        assert local.get(BASE + '/flows/' + started['flowId']).status_code == 404
        assert local.delete(BASE + '/flows/' + started['flowId']).json()['cancelled'] is False
        assert callback(gateway, state).status_code == 400
        assert amazon.calls == []
        disconnected(local)


@pytest.mark.parametrize('failure', ['denied', 'expired', 'provider', 'invalid_seller'])
def test_failed_authorization_never_creates_connection(environment, failure):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started, state, _ = start(local, gateway)
        if failure == 'expired':
            with db.connect() as c:
                c.execute("UPDATE amazon_oauth_attempts SET expires_at=now()-interval '1 second'")
        amazon.failure = failure == 'provider'
        response = callback(gateway, state, seller='bad/seller' if failure == 'invalid_seller' else SELLER,
                            **({'error': 'access_denied'} if failure == 'denied' else {}))
        assert response.status_code == 400
        assert len(amazon.calls) == (1 if failure == 'provider' else 0)
        assert 'fixture-provider-failure' not in response.text
        disconnected(local)


@pytest.mark.parametrize('mutation', ['cancel', 'disconnect', 'logout', 'expire_session', 'expire_flow', 'subscription', 'restart'])
def test_changes_during_exchange_prevent_late_persistence(environment, mutation):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started, state, _ = start(local, gateway)
        amazon.entered, amazon.release = Event(), Event()
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(callback, gateway, state)
            assert amazon.entered.wait(5)
            try:
                if mutation == 'cancel':
                    assert local.delete(BASE + '/flows/' + started['flowId']).json()['cancelled'] is True
                elif mutation == 'disconnect':
                    assert local.delete(BASE).status_code == 200
                elif mutation == 'logout':
                    assert local.post('/api/auth/logout').status_code == 200
                elif mutation == 'expire_session':
                    with db.connect() as c:
                        c.execute('UPDATE sessions SET expires_at=now()')
                elif mutation == 'expire_flow':
                    with db.connect() as c:
                        c.execute('UPDATE amazon_oauth_attempts SET expires_at=now()')
                elif mutation == 'subscription':
                    with db.connect() as c:
                        c.execute('UPDATE access_periods SET ends_at=now()')
                else:
                    replacement = local.post(BASE + '/start').json()
                    assert replacement['flowId'] != started['flowId']
            finally:
                amazon.release.set()
            assert pending.result(timeout=5).status_code == 400
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM amazon_connections').fetchone()['n'] == 0
        assert len(amazon.calls) == 1
        if mutation == 'restart':
            assert local.get(BASE + '/flows/' + replacement['flowId']).json()['status'] == 'pending'
            launched = launch(local, gateway, replacement['authUrl'])
            newer = parse_qs(urlsplit(launched.headers['location']).query)['state'][0]
            assert callback(gateway, newer).status_code == 200


def test_simultaneous_callback_exchanges_code_only_once(environment):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        _, state, _ = start(local, gateway)
        amazon.entered, amazon.release = Event(), Event()
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(callback, gateway, state)
            assert amazon.entered.wait(5)
            try:
                assert callback(gateway, state).status_code == 400
            finally:
                amazon.release.set()
            assert pending.result(timeout=5).status_code == 200
        assert amazon.calls == ['fixture-auth-code']


def test_seller_cannot_change_silently_or_move_between_accounts(environment):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        _, state, _ = start(local, gateway)
        assert callback(gateway, state).status_code == 200
        started, state, _ = start(local, gateway)
        assert callback(gateway, state, seller='OTHERSELLER').status_code == 400
        assert local.get(BASE + '/flows/' + started['flowId']).json()['error'] == 'seller_changed'
        assert local.get(BASE).json()['connection']['sellerId'] == SELLER
        google.subject = 'second-account'; google.email = 'second@example.test'
        ready(local, google, db)
        started, state, _ = start(local, gateway)
        assert callback(gateway, state).status_code == 400
        assert local.get(BASE + '/flows/' + started['flowId']).json()['error'] == 'seller_conflict'
        disconnected(local)
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM amazon_connections').fetchone()['n'] == 1


@pytest.mark.parametrize('seller', [SELLER, 'WRONGSELLER'])
def test_appstore_requires_explicit_accept_original_browser_and_expected_seller(environment, seller):
    config, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        intent = incoming(gateway)
        assert local.get(BASE + '/intents/' + intent).status_code == 401
        ready(local, google, db)
        assert local.get(BASE + '/intents/' + intent).json()['sellerId'] == SELLER
        disconnected(local)
        accept = BASE + '/intents/' + intent + '/accept'
        assert local.post(accept, headers={'Origin': 'null'}).status_code == 403
        started = local.post(accept).json()
        assert local.post(accept).status_code == 404
        with TestClient(create_gateway(config, amazon), base_url=PUBLIC) as other:
            assert other.get(started['authUrl']).status_code == 403
        launched = launch(local, gateway, started['authUrl'])
        assert launched.status_code == 303
        target = urlsplit(launched.headers['location'])
        assert target.path == '/apps/authorize/confirm/' + APP
        params = parse_qs(target.query)
        assert params['amazon_state'] == ['fixture-amazon-state']
        assert params['redirect_uri'] == [PUBLIC + CALLBACK_PATH]
        response = callback(gateway, params['state'][0], seller=seller)
        assert response.status_code == (200 if seller == SELLER else 400)
        assert len(amazon.calls) == (1 if seller == SELLER else 0)
        if seller != SELLER:
            disconnected(local)


@pytest.mark.parametrize('origin', ['http://example.com', 'https://127.0.0.1', 'https://localhost',
                                  'https://x.local', 'https://example.com/path', 'https://example.com?x=1',
                                  'https://user:password@example.com', 'https://example.com:8443'])
def test_public_origin_rejects_non_public_or_ambiguous_endpoints(origin):
    assert public_origin(origin) == ''


@pytest.mark.parametrize('url', ['http://sellercentral-europe.amazon.com', 'https://evil.example',
                               'https://sellercentral-europe.amazon.com@evil.example',
                               'https://sellercentral-europe.amazon.com:443'])
def test_amazon_redirect_allowlist_is_exact(url):
    with pytest.raises(ValueError):
        validate_amazon_callback(url + '/apps/authorize/confirm/' + APP, Amazon().config)


@pytest.mark.parametrize('client_id', [None, False, 123, '', ' ', 'not-a-client'])
def test_config_file_does_not_treat_invalid_client_id_as_ready(environment, tmp_path, client_id):
    config, _, _ = environment
    (tmp_path / 'amazon-config.json').write_text(json.dumps({
        'publicOrigin': PUBLIC, 'applicationId': APP, 'clientId': client_id}))
    (tmp_path / 'amazon-client-secret').write_text('fixture-client-secret-long-enough')
    actual = load_config(replace(config, secrets_directory=str(tmp_path)))
    assert actual.ready is False


def test_valid_configuration_is_ready_without_disclosing_credentials(environment, tmp_path):
    config, _, _ = environment
    (tmp_path / 'amazon-config.json').write_text(json.dumps({
        'publicOrigin': PUBLIC, 'applicationId': APP,
        'clientId': 'amzn1.application-oa2-client.fixture-12345678'}))
    (tmp_path / 'amazon-client-secret').write_text('fixture-client-secret-long-enough')
    actual = load_config(replace(config, secrets_directory=str(tmp_path)))
    assert actual.ready is True
    assert actual.login_uri == PUBLIC + LOGIN_PATH and actual.redirect_uri == PUBLIC + CALLBACK_PATH
    assert 'fixture-client-secret' not in json.dumps(actual.status())
    assert 'application-oa2-client' not in json.dumps(actual.status())


def test_expired_launch_cannot_begin_consent_and_duplicate_callback_keeps_valid_attempt(environment):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        expired = local.post(BASE + '/start').json()
        with db.connect() as c:
            c.execute('UPDATE amazon_oauth_attempts SET expires_at=now()')
        assert gateway.get(expired['authUrl']).status_code == 409
        _, state, _ = start(local, gateway)
        duplicate = gateway.get(CALLBACK_PATH, params=[('state', state), ('state', state),
            ('selling_partner_id', SELLER), ('spapi_oauth_code', 'fixture-auth-code')])
        assert duplicate.status_code == 400 and amazon.calls == []
        assert callback(gateway, state).status_code == 200


@pytest.mark.parametrize('same_user', [False, True])
def test_bootstrap_requires_exact_local_session_and_resume_requires_public_cookie(environment, same_user):
    config, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started = local.post(BASE + '/start').json()
        first = gateway.get(started['authUrl'])
        ticket_url = first.headers['location']
        assert ticket_url.startswith(config.origin + BASE + '/bootstrap?')
        another_google = type(google)()
        if not same_user:
            another_google.subject = 'bootstrap-other-user'
            another_google.email = 'bootstrap-other@example.test'
        with client_for(config, another_google, amazon=amazon) as other_local:
            assert other_local.get(ticket_url).status_code == 401
            ready(other_local, another_google, db)
            assert other_local.get(ticket_url).status_code == 403
        assert amazon.calls == []
        # La navegación superior desde HTTPS a loopback no envía Origin.
        previous_origin = local.headers.pop('Origin')
        try:
            bound = local.get(ticket_url)
        finally:
            local.headers['Origin'] = previous_origin
        assert bound.status_code == 303
        assert local.get(ticket_url).status_code == 403
        with TestClient(create_gateway(config, amazon), base_url=PUBLIC) as other_gateway:
            assert other_gateway.get(bound.headers['location']).status_code == 403
        resumed = gateway.get(bound.headers['location'])
        assert resumed.status_code == 303
        assert gateway.get(bound.headers['location']).status_code == 409
        state = parse_qs(urlsplit(resumed.headers['location']).query)['state'][0]
        assert callback(gateway, state).status_code == 200


def test_callback_and_resume_cannot_skip_local_bootstrap(environment):
    config, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started = local.post(BASE + '/start').json()
        first = gateway.get(started['authUrl'])
        with db.connect() as c:
            attempt = c.execute('SELECT state_encrypted FROM amazon_oauth_attempts WHERE id=%s',
                                (started['flowId'],)).fetchone()
        state = Fernet(config.encryption_key).decrypt(attempt['state_encrypted'].encode()).decode()
        assert callback(gateway, state).status_code == 400
        resume_url = PUBLIC + LOGIN_PATH + '?resume=' + started['flowId']
        assert gateway.get(resume_url).status_code == 409
        assert amazon.calls == []
        assert local.get(first.headers['location']).status_code == 303
        assert gateway.get(resume_url).status_code == 303
        assert callback(gateway, state).status_code == 200


@pytest.mark.parametrize('phase', ['confirming', 'ready'])
def test_cancel_during_bootstrap_prevents_consent(environment, phase):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        started = local.post(BASE + '/start').json()
        first = gateway.get(started['authUrl'])
        if phase == 'ready':
            bound = local.get(first.headers['location'])
            assert bound.status_code == 303
        assert local.delete(BASE + '/flows/' + started['flowId']).json()['cancelled'] is True
        if phase == 'confirming':
            assert local.get(first.headers['location']).status_code == 403
        else:
            assert gateway.get(bound.headers['location']).status_code == 409
        assert amazon.calls == []
        disconnected(local)
