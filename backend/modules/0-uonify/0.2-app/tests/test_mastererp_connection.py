"""Conexión ERP · Finanzas como Drive, con Cognito y la API del ERP falsos (httpx.MockTransport):
ninguna petición sale a la red. JWKS generado aquí; cada token emitido se busca en los logs."""
import base64
import hashlib
import json
import logging
import time
from urllib.parse import parse_qs, parse_qsl, urlparse
from uuid import uuid4
import httpx
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from conftest import client_for, login
from test_subscription import complete
from test_google_cloud import allow
from app import mastererp_cognito as cognito, mastererp_store as store
from app.mastererp_config import load_mastererp_config
from app.mastererp_types import ErpError
from app.account_deletion_data import purge

BASE, CALLBACK = '/api/connections/erp', '/api/auth/mastererp/callback'
ENV = {'ISSUER': 'https://cognito.example.test/pool-test', 'CLIENT_ID': 'erp-test-client',
       'HOSTED_UI': 'https://auth.example.test', 'AGENT_API': 'https://agent.example.test',
       'ADMIN_API': 'https://admin.example.test'}
SCOPE = 'openid email mastererp-dev/identity.spaces.read'
TENANT, OTHER_TENANT, COMPANY, OTHER_COMPANY = (str(uuid4()) for _ in range(4))
DROP = object()


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


class Keys:
    def __init__(self, kid='k1'):
        self.kid, self.private = kid, rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def jwk(self):
        numbers = self.private.public_key().public_numbers()
        raw = lambda n: n.to_bytes((n.bit_length() + 7) // 8, 'big')
        return {'kty': 'RSA', 'kid': self.kid, 'alg': 'RS256', 'use': 'sig', 'n': b64(raw(numbers.n)), 'e': b64(raw(numbers.e))}

    def sign(self, claims, header=None):
        head = b64(json.dumps(header or {'alg': 'RS256', 'kid': self.kid}).encode())
        body = b64(json.dumps({k: v for k, v in claims.items() if v is not DROP}).encode())
        return head + '.' + body + '.' + b64(self.private.sign((head + '.' + body).encode(), padding.PKCS1v15(), hashes.SHA256()))


KEYS, IMPOSTOR = Keys(), Keys()  # Mismo kid, otra clave: firma no válida.


class FakeErp:
    """Hosted UI, /oauth2/token, /oauth2/revoke, JWKS y GET /v1/uonify/spaces, en memoria."""

    def __init__(self):
        self.sub, self.email = 'cognito-sub-one', 'erp-one@example.test'
        self.codes, self.refresh_sub, self.issued, self.verifiers, self.revoked = {}, {}, [], [], []
        self.refreshes = self.jwks_calls = 0
        self.refresh_error, self.rotate, self.revoke_mode, self.spaces_mode = None, False, 'ok', 'ok'
        self.id_claims, self.access_claims, self.signer = {}, {}, KEYS
        self.spaces = [{'id': TENANT, 'name': 'Espacio demo'}]
        self.contexts = {TENANT: (['erp.finance'], [{'id': COMPANY, 'name': 'Empresa demo'}])}

    def authorize(self, auth_url):
        query = {key: values[0] for key, values in parse_qs(urlparse(auth_url).query).items()}
        code = 'code-' + uuid4().hex
        self.codes[code] = {**query, 'sub': self.sub, 'email': self.email}
        return query['state'], code

    def token(self, kind, sub, nonce=None):
        now = int(time.time())
        claims = ({'iss': ENV['ISSUER'], 'aud': ENV['CLIENT_ID'], 'token_use': 'id', 'sub': sub, 'email': self.email,
                   'nonce': nonce, 'iat': now, 'exp': now + 900, 'jti': uuid4().hex, **self.id_claims} if kind == 'id' else
                  {'iss': ENV['ISSUER'], 'client_id': ENV['CLIENT_ID'], 'token_use': 'access', 'scope': SCOPE,
                   'sub': sub, 'iat': now, 'exp': now + 900, 'jti': uuid4().hex, **self.access_claims})
        token = self.signer.sign(claims)
        self.issued.append(token)
        return token

    def refresh_token(self, sub):
        token = 'refresh-' + uuid4().hex
        self.refresh_sub[token] = sub
        self.issued.append(token)
        return token

    def handle(self, request):
        url, form = request.url, dict(parse_qsl(request.content.decode())) if request.method == 'POST' else {}
        if (url.host, url.path) == ('cognito.example.test', '/pool-test/.well-known/jwks.json'):
            self.jwks_calls += 1
            return httpx.Response(200, json={'keys': [KEYS.jwk()]})
        if (url.host, url.path) == ('auth.example.test', '/oauth2/token'):
            assert form['client_id'] == ENV['CLIENT_ID'] and 'client_secret' not in form
            return self.grant(form)
        if (url.host, url.path) == ('auth.example.test', '/oauth2/revoke'):
            if self.revoke_mode == 'network':
                raise httpx.ConnectError('down', request=request)
            if self.revoke_mode == 'timeout':
                raise httpx.ReadTimeout('slow', request=request)
            if self.revoke_mode == 'error':
                return httpx.Response(500, json={'error': 'internal', 'token': form['token']})
            self.revoked.append(form['token'])
            self.refresh_sub.pop(form['token'], None)
            return httpx.Response(200)
        if (url.host, url.path) == ('agent.example.test', '/v1/uonify/spaces'):
            return self.spaces_response(request)
        return httpx.Response(404, json={'error': 'route_not_found'})

    def grant(self, form):
        if form['grant_type'] == 'authorization_code':
            grant = self.codes.pop(form['code'], None)
            if grant is None:
                return httpx.Response(400, json={'error': 'invalid_grant'})
            assert b64(hashlib.sha256(form['code_verifier'].encode()).digest()) == grant['code_challenge']
            assert form['redirect_uri'] == grant['redirect_uri'] and grant['code_challenge_method'] == 'S256'
            self.verifiers.append(form['code_verifier'])
            return httpx.Response(200, json={'id_token': self.token('id', grant['sub'], grant['nonce']),
                'access_token': self.token('access', self.access_claims.get('sub', grant['sub'])),
                'refresh_token': self.refresh_token(grant['sub']), 'expires_in': 900, 'token_type': 'Bearer'})
        assert form['grant_type'] == 'refresh_token'
        self.refreshes += 1
        sub = self.refresh_sub.get(form['refresh_token'])
        if self.refresh_error or sub is None:
            return httpx.Response(400, json={'error': self.refresh_error or 'invalid_grant'})
        body = {'access_token': self.token('access', sub), 'expires_in': 900, 'token_type': 'Bearer'}
        if self.rotate:
            del self.refresh_sub[form['refresh_token']]
            body['refresh_token'] = self.refresh_token(sub)
        return httpx.Response(200, json=body)

    def spaces_response(self, request):
        token = request.headers['authorization'].removeprefix('Bearer ')
        payload = token.split('.')[1]
        assert json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['token_use'] == 'access'
        modes = {'not_linked': (403, 'identity_not_linked'), 'unavailable': (503, 'service_unavailable'),
                 'unauthorized': (401, 'invalid_identity')}
        if self.spaces_mode in modes:
            status, error = modes[self.spaces_mode]
            return httpx.Response(status, json={'error': error, 'correlation_id': str(uuid4())})
        tenant = request.url.params.get('tenant_id')
        if tenant and tenant not in self.contexts:
            return httpx.Response(403, json={'error': 'access_denied', 'correlation_id': str(uuid4())})
        body = {'spaces': self.spaces}
        if tenant:
            modules, companies = self.contexts[tenant]
            body['context'] = {'tenant_id': tenant, 'modules': modules, 'companies': companies,
                               'permissions': ['administration.purchases.read']}
        return httpx.Response(200, json=body)


@pytest.fixture
def erp(monkeypatch):
    for name, value in ENV.items():
        monkeypatch.setenv('UONIFY_MASTERERP_' + name, value)
    fake = FakeErp()
    monkeypatch.setattr(cognito, 'http_client', lambda: httpx.Client(transport=httpx.MockTransport(fake.handle)))
    cognito._jwks.clear(); store._tokens.clear()
    yield fake
    cognito._jwks.clear(); store._tokens.clear()


def ready(client, google, db):
    login(client, google); complete(client); allow(db)


def connect(client, fake, popup=True):
    start = client.post(BASE + '/start', json={'popup': popup})
    assert start.status_code == 200, start.text
    state, code = fake.authorize(start.json()['authUrl'])
    return start.json(), client.get(CALLBACK, params={'state': state, 'code': code}), (state, code)


def flow(client, start):
    return client.get(BASE + '/flows/' + start['flowId']).json()


def row(db):
    with db.connect() as c:
        return c.execute('SELECT * FROM erp_connections').fetchone()


def user_id(db):
    with db.connect() as c:
        return c.execute('SELECT id FROM users').fetchone()['id']


def test_connects_in_a_window_selects_the_only_company_and_keeps_tokens_on_the_server(environment, erp):
    config, google, db = environment
    with client_for(config, google) as client:
        assert client.get(BASE).status_code == 401
        login(client, google); complete(client)
        assert client.post(BASE + '/start', json={'popup': True}).status_code == 403  # Sin suscripción.
        allow(db)
        assert client.post(BASE + '/start', json={'popup': True}, headers={'Origin': 'null'}).status_code == 403
        start = client.post(BASE + '/start', json={'popup': True})
        url = urlparse(start.json()['authUrl']); query = parse_qs(url.query)
        assert (url.netloc, url.path) == ('auth.example.test', '/oauth2/authorize')
        assert query['response_type'] == ['code'] and query['client_id'] == [ENV['CLIENT_ID']] and query['scope'] == [SCOPE]
        assert query['redirect_uri'] == [config.origin + CALLBACK] and query['code_challenge_method'] == ['S256']
        assert query['state'][0].startswith('erp_popup_') and query['nonce'][0] and 'client_secret' not in url.query
        state, code = erp.authorize(start.json()['authUrl'])
        page = client.get(CALLBACK, params={'state': state, 'code': code})
        assert page.status_code == 200 and "BroadcastChannel('uonify-erp-return')" in page.text
        assert "script-src 'nonce-" in page.headers['content-security-policy']
        assert flow(client, start.json()) == {'status': 'success'}
        status = client.get(BASE).json()
        # PR #22: el estado lleva también los módulos y permisos del espacio (el menú de Finanzas los usa).
        assert status['connection'] == {'status': 'connected', 'email': erp.email, 'spaces': erp.spaces,
            'tenantId': TENANT, 'companies': erp.contexts[TENANT][1], 'companyId': COMPANY,
            'modules': erp.contexts[TENANT][0], 'permissions': ['administration.purchases.read']}
        assert status['accessAllowed'] and not any(secret in page.text + json.dumps(status)
                                                   for secret in erp.issued + erp.verifiers + [erp.sub])
        saved = row(db)
        assert saved['cognito_sub'] == erp.sub and saved['issuer'] == ENV['ISSUER'] and saved['scope'] == SCOPE
        assert Fernet(config.encryption_key).decrypt(saved['refresh_encrypted'].encode()).decode() in erp.refresh_sub
        assert erp.jwks_calls == 1
        # Un solo uso: el mismo retorno no vuelve a canjear nada ni cambia el resultado.
        assert 'uonify-erp-return' in client.get(CALLBACK, params={'state': state, 'code': code}).text
        assert len(erp.verifiers) == 1 and flow(client, start.json()) == {'status': 'success'}
        # Sin ventana, vuelve a Uonify.
        _, redirect, _ = connect(client, erp, popup=False)
        # Vuelve a la app, no a «/?…» (PR #23): la puerta de DEV deja «/» en la portada.
        assert redirect.status_code == 303 and redirect.headers['location'] == config.origin + '/espacio?service=erp&erp=return'


def test_attempt_is_bound_to_the_session_cancellable_and_rejects_bad_tokens(environment, erp):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        start = client.post(BASE + '/start', json={'popup': True}).json()
        assert client.delete(BASE + '/flows/' + start['flowId']).json() == {'cancelled': True}
        state, code = erp.authorize(start['authUrl'])
        client.get(CALLBACK, params={'state': state, 'code': code})
        assert flow(client, start) == {'status': 'error'} and not erp.verifiers and row(db) is None
        for claims in ({'nonce': 'otro-nonce'}, {'aud': 'otro-cliente'}, {'iss': 'https://evil.example.test'},
                       {'token_use': 'access'}, {'sub': DROP}, {'exp': int(time.time()) - 5}):
            erp.id_claims = claims
            start, _, _ = connect(client, erp)
            assert flow(client, start) == {'status': 'error'} and row(db) is None, claims
        erp.id_claims, erp.access_claims = {}, {'sub': 'otra-persona'}
        start, _, _ = connect(client, erp)
        assert flow(client, start) == {'status': 'error'} and row(db) is None
        assert len(erp.revoked) == 7  # Todo refresh que no se guarda se revoca.
        erp.access_claims = {}
        start = client.post(BASE + '/start', json={'popup': True}).json()
        google.subject, google.email = 'google-test-two', 'two@example.test'
        login(client, google)  # Otra sesión: el intento ya no le pertenece.
        state, code = erp.authorize(start['authUrl'])
        assert 'uonify-erp-return' in client.get(CALLBACK, params={'state': state, 'code': code}).text
        assert client.get(BASE + '/flows/' + start['flowId']).status_code == 404 and row(db) is None


def test_id_and_access_tokens_are_validated_with_a_cached_jwks(erp):
    config = load_mastererp_config()
    good = lambda **claims: (setattr(erp, 'id_claims', claims), erp.token('id', erp.sub, 'nonce-1'))[1]
    assert cognito.validate_id_token(config, good(), 'nonce-1') == {'sub': erp.sub, 'email': erp.email}
    for token, nonce in ((good(), 'nonce-2'), (good(iss='https://evil.example.test'), 'nonce-1'),
                         (good(aud='otro'), 'nonce-1'), (good(token_use='access'), 'nonce-1'),
                         (good(sub=''), 'nonce-1'), (good(sub=DROP), 'nonce-1'),
                         (good(exp=int(time.time()) - 1), 'nonce-1'), (good(exp=DROP), 'nonce-1'),
                         (good() + 'x', 'nonce-1'), (IMPOSTOR.sign({'sub': erp.sub, 'nonce': 'nonce-1'}), 'nonce-1'),
                         (KEYS.sign({'sub': erp.sub}, {'alg': 'none', 'kid': 'k1'}), 'nonce-1'),
                         (KEYS.sign({'sub': erp.sub}, {'alg': 'RS256', 'kid': 'k2'}), 'nonce-1'), ('a.b', 'nonce-1')):
        with pytest.raises(ErpError) as rejected:
            cognito.validate_id_token(config, token, nonce)
        assert rejected.value.code == 'erp_invalid'
    access = lambda **claims: (setattr(erp, 'access_claims', claims), erp.token('access', erp.sub))[1]
    assert cognito.check_access_token(config, access()) == {'sub': erp.sub, 'scope': SCOPE}
    for token, code in ((access(token_use='id'), 'erp_invalid'), (access(client_id='otro'), 'erp_invalid'),
                        (access(iss='https://evil.example.test'), 'erp_invalid'),
                        (access(scope='openid email'), 'erp_denied'), (access(scope=DROP), 'erp_denied')):
        with pytest.raises(ErpError) as rejected:
            cognito.check_access_token(config, token)
        assert rejected.value.code == code
    assert erp.jwks_calls == 1  # Pedido una vez; un kid desconocido no lo vuelve a pedir enseguida.


def test_other_account_is_account_mismatch_until_disconnected(environment, erp):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db); connect(client, erp)
        first = row(db)
        erp.sub, erp.email = 'cognito-sub-two', 'erp-two@example.test'
        start, _, _ = connect(client, erp)
        assert flow(client, start) == {'status': 'error', 'error': 'account_mismatch'}
        assert client.get(BASE).json()['connection']['status'] == 'account_mismatch'
        mismatch = row(db)
        assert (mismatch['cognito_sub'], mismatch['refresh_encrypted'], mismatch['email']) == (
            first['cognito_sub'], first['refresh_encrypted'], first['email'])
        assert erp.revoked and erp.refresh_sub.get(erp.revoked[-1]) is None
        with pytest.raises(ErpError) as rejected:
            store.credential_provider(db, config, user_id(db))()
        assert rejected.value.code == 'erp_reconnect'
        erp.sub, erp.email = 'cognito-sub-one', 'erp-one@example.test'
        start, _, _ = connect(client, erp)
        assert flow(client, start) == {'status': 'success'} and row(db)['company_id'] is not None
        old = Fernet(config.encryption_key).decrypt(row(db)['refresh_encrypted'].encode()).decode()
        assert client.delete(BASE, headers={'Origin': 'null'}).status_code == 403
        assert client.delete(BASE).json() == {'connection': {'status': 'disconnected'}}
        assert old in erp.revoked and row(db) is None
        erp.sub = 'cognito-sub-two'
        start, _, _ = connect(client, erp)
        assert flow(client, start) == {'status': 'success'} and row(db)['cognito_sub'] == 'cognito-sub-two'


def test_identity_not_linked_and_api_failures(environment, erp):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        erp.spaces_mode = 'unavailable'
        start, _, _ = connect(client, erp)
        assert flow(client, start) == {'status': 'error'} and row(db) is None and len(erp.revoked) == 1
        erp.spaces_mode = 'not_linked'
        start, _, _ = connect(client, erp)
        assert flow(client, start) == {'status': 'error', 'error': 'not_linked'}
        assert client.get(BASE).json()['connection']['status'] == 'not_linked'
        with pytest.raises(ErpError) as rejected:
            store.credential_provider(db, config, user_id(db))()
        assert rejected.value.code == 'erp_not_linked'
        assert client.post(BASE + '/selection', json={'tenantId': TENANT}).json()['error'] == 'erp_not_linked'
        erp.spaces_mode = 'ok'
        connect(client, erp)
        erp.spaces_mode = 'unauthorized'
        status = client.get(BASE).json()
        assert status['listingError'] == 'erp_reconnect' and status['connection']['status'] == 'reauthorize'


def test_selection_is_checked_against_the_erp_and_drops_foreign_refs(environment, erp):
    config, google, db = environment
    erp.spaces = [{'id': TENANT, 'name': 'Espacio demo'}, {'id': OTHER_TENANT, 'name': 'Sin Finanzas'}]
    erp.contexts = {TENANT: (['erp.finance'], [{'id': COMPANY, 'name': 'Una'}, {'id': OTHER_COMPANY, 'name': 'Otra'}]),
                    OTHER_TENANT: (['erp.sales'], [{'id': OTHER_COMPANY, 'name': 'Otra'}])}
    with client_for(config, google) as client:
        ready(client, google, db); connect(client, erp)
        assert client.get(BASE).json()['connection'] == {'status': 'connected', 'email': erp.email,
            'spaces': erp.spaces, 'tenantId': None, 'companies': [], 'companyId': None, 'modules': [], 'permissions': []}
        with pytest.raises(ErpError) as rejected:
            store.credential_provider(db, config, user_id(db))()
        assert rejected.value.code == 'erp_selection_required' and erp.refreshes == 1  # Solo el estado.
        select = lambda body, **kw: client.post(BASE + '/selection', json=body, **kw)
        assert select({'tenantId': OTHER_TENANT, 'companyId': OTHER_COMPANY}).status_code == 403
        assert select({'tenantId': TENANT, 'companyId': str(uuid4())}).json()['error'] == 'erp_denied'
        assert select({'tenantId': 'no-es-un-uuid'}).status_code == 400
        assert select({'tenantId': TENANT}, headers={'Origin': 'null'}).status_code == 403
        chosen = select({'tenantId': TENANT}).json()['connection']
        assert (chosen['tenantId'], chosen['companyId'], len(chosen['companies'])) == (TENANT, None, 2)
        with db.connect() as c:
            for ref, company in (('A-1', COMPANY), ('B-1', OTHER_COMPANY)):
                c.execute('''INSERT INTO uony_erp_refs(user_id,ref,kind,record_id,tenant_id,company_id,expires_at)
                    VALUES(%s,%s,'compras',%s,%s,%s,now()+interval '30 minutes')''', (user_id(db), ref, uuid4(), TENANT, company))
        assert select({'tenantId': TENANT, 'companyId': COMPANY.upper()}).json()['connection']['companyId'] == COMPANY
        with db.connect() as c:
            assert [r['ref'] for r in c.execute('SELECT ref FROM uony_erp_refs').fetchall()] == ['A-1']
        credential = store.credential_provider(db, config, user_id(db))()
        assert (credential.tenant_id, credential.company_id) == (TENANT, COMPANY) and 'refresh' not in repr(credential)


def test_access_token_lives_at_most_240_seconds_and_invalid_grant_asks_to_reconnect(environment, erp, monkeypatch):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db); connect(client, erp)
    owner, clock = user_id(db), [time.monotonic()]
    monkeypatch.setattr(store, 'monotonic', lambda: clock[0])
    provider = store.credential_provider(db, config, owner)
    first, second = provider(), provider()
    assert erp.refreshes == 1 and first == second and first.fingerprint == store.connection_fingerprint(db, owner)
    assert all(expires - clock[0] <= 240 for expires, _ in store._tokens.values())
    clock[0] += 241
    assert provider().access_token != first.access_token and erp.refreshes == 2
    erp.rotate = True; clock[0] += 241
    rotated = provider()
    saved = Fernet(config.encryption_key).decrypt(row(db)['refresh_encrypted'].encode()).decode()
    assert saved in erp.refresh_sub and rotated.fingerprint == store.connection_fingerprint(db, owner) != first.fingerprint
    erp.rotate, erp.refresh_error = False, 'invalid_grant'; clock[0] += 241
    with pytest.raises(ErpError) as rejected:
        provider()
    assert rejected.value.code == 'erp_reconnect' and row(db)['status'] == 'reauthorize'
    assert store.connection_fingerprint(db, owner) is None


def test_failed_revocation_leaves_a_fixed_warning_and_no_secret_reaches_the_logs(environment, erp, caplog):
    caplog.set_level(logging.DEBUG)
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db); connect(client, erp); client.get(BASE)
        store.credential_provider(db, config, user_id(db))()
        erp.revoke_mode = 'error'
        assert client.delete(BASE).status_code == 200 and row(db) is None
        connect(client, erp)
        erp.revoke_mode = 'network'
        assert client.delete(BASE).status_code == 200 and row(db) is None
        erp.revoke_mode = 'ok'; connect(client, erp)
        erp.refresh_error = 'invalid_grant'; store._tokens.clear()
        assert client.get(BASE).json()['connection']['status'] == 'reauthorize'
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING and r.name.startswith('app.mastererp')]
    assert 'erp_revoke_failed reason=status_5xx' in warnings and 'erp_revoke_failed reason=network' in warnings
    assert any(message.startswith('erp_refresh_failed ref=') for message in warnings)
    secrets = erp.issued + erp.verifiers + [erp.sub, erp.email, TENANT, COMPANY, str(user_id(db))]
    assert not [secret for secret in secrets if secret in caplog.text]


def test_revoke_timeout_warns_and_account_deletion_purges_erp_rows(environment, erp, caplog):
    config, google, db = environment
    erp.revoke_mode = 'timeout'
    assert cognito.revoke(load_mastererp_config(), 'refresh-x') is False
    with client_for(config, google) as client:
        ready(client, google, db); connect(client, erp); client.post(BASE + '/start', json={'popup': True})
    with db.connect() as c:
        owner = c.execute('SELECT * FROM users').fetchone()
        c.execute('''INSERT INTO uony_erp_refs(user_id,ref,kind,record_id,tenant_id,company_id,expires_at)
            VALUES(%s,'A-1','compras',%s,%s,%s,now()+interval '30 minutes')''', (owner['id'], uuid4(), TENANT, COMPANY))
        purge(c, owner, None)
        for table in ('erp_connections', 'erp_oauth_attempts', 'erp_popup_flows', 'uony_erp_refs'):
            assert c.execute(f'SELECT count(*) n FROM {table}').fetchone()['n'] == 0
        valid = lambda actions: c.execute('SELECT uony_connection_actions_valid(%s::jsonb) ok', (json.dumps(actions),)).fetchone()['ok']
        every = [{'provider': p, 'action': 'manage'} for p in ('amazon', 'cloud', 'drive', 'blender', 'account', 'erp')]
        assert valid(every) and valid(every[-1:]) and not valid(every[-1:] * 2)
        assert not valid([{'provider': 'erp', 'action': 'delete'}])
    assert 'erp_revoke_failed reason=timeout' in caplog.text and 'refresh-x' not in caplog.text
