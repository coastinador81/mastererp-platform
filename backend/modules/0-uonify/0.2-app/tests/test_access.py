from dataclasses import replace
from app.security import SESSION_COOKIE, OAUTH_COOKIE, digest
from conftest import client_for, login


def test_round_trip_persists_across_server_restart_and_logout(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        assert client.get('/api/auth/session').json() == {'authenticated': False}
        result = login(client, provider)
        assert result.status_code == 303 and result.headers['location'] == config.return_url
        cookie = client.cookies.get(SESSION_COOKIE)
        assert 'HttpOnly' in result.headers.get('set-cookie') and 'SameSite=lax' in result.headers.get('set-cookie')
        session = client.get('/api/auth/session').json()
        assert session['authenticated'] and session['email'] == provider.email
        assert session['profileComplete'] is False and session['onboarding']['step'] == 'terms'
        with db.connect() as connection:
            assert connection.execute('SELECT token_hash FROM sessions').fetchone()['token_hash'] == digest(cookie)
    # Otra instancia de API; solo conserva la cookie del navegador y PostgreSQL.
    with client_for(config, provider) as restarted:
        restarted.cookies.set(SESSION_COOKIE, cookie)
        assert restarted.get('/api/auth/session').json()['authenticated']
        assert restarted.post('/api/auth/logout').json() == {'ok': True}
        restarted.cookies.set(SESSION_COOKIE, cookie)
        assert restarted.get('/api/auth/session').json() == {'authenticated': False}
        assert restarted.post('/api/auth/logout').status_code == 200
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM users').fetchone()['n'] == 1


def test_binding_replay_and_cancel(environment):
    config, provider, db = environment
    with client_for(config, provider) as owner, client_for(config, provider) as attacker:
        owner.post('/api/auth/google/start', json={'returnTo': config.return_url})
        state = provider.state
        assert 'invalid_state' in attacker.get('/api/auth/google/callback', params={'state': state, 'code': 'x'}).headers['location']
        accepted = owner.get('/api/auth/google/callback', params={'state': state, 'code': 'x'})
        assert accepted.headers['location'] == config.return_url
        assert 'invalid_state' in owner.get('/api/auth/google/callback', params={'state': state, 'code': 'x'}).headers['location']
        owner.post('/api/auth/google/start', json={'returnTo': config.return_url})
        cancelled = owner.get('/api/auth/google/callback', params={'state': provider.state, 'error': 'access_denied'})
        assert 'error=access_denied' in cancelled.headers['location']
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM oauth_attempts').fetchone()['n'] == 0


def test_expired_and_invalid_sessions(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        login(client, provider)
        with db.connect() as connection:
            connection.execute("UPDATE sessions SET expires_at=now()-interval '1 second'")
        assert client.get('/api/auth/session').json() == {'authenticated': False}
        client.cookies.set(SESSION_COOKIE, 'not-a-session')
        assert client.get('/api/auth/session').json() == {'authenticated': False}
        client.post('/api/auth/google/start', json={'returnTo': config.return_url})
        with db.connect() as connection:
            connection.execute("UPDATE oauth_attempts SET expires_at=now()-interval '1 second'")
        assert 'invalid_state' in client.get('/api/auth/google/callback', params={'state': provider.state, 'code': 'x'}).headers['location']


def test_identity_is_subject_not_email_and_logout_does_not_affect_other_user(environment):
    config, provider, db = environment
    with client_for(config, provider) as first, client_for(config, provider) as second:
        login(first, provider)
        login(first, provider)
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM users').fetchone()['n'] == 1
        provider.subject = 'google-test-two'
        # Mismo correo no permite fusionar identidades diferentes.
        login(second, provider)
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM users').fetchone()['n'] == 2
        first.post('/api/auth/logout')
        assert second.get('/api/auth/session').json()['authenticated']


def test_csrf_redirects_validation_unconfigured_and_provider_failure(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        assert client.post('/api/auth/google/start', json={'returnTo': config.return_url}, headers={'Origin': 'https://evil.test'}).status_code == 403
        assert client.post('/api/auth/logout', headers={'Origin': 'null'}).status_code == 403
        assert client.post('/api/auth/google/start', json={'returnTo': 'https://evil.test'}).status_code == 400
        assert client.post('/api/auth/google/start', json={'returnTo': config.return_url, 'loginHint': 'victim@example.test'}).status_code == 400
        provider.fail = True
        assert 'provider_error' in login(client, provider).headers['location']
        assert client.get('/api/auth/session').json() == {'authenticated': False}
    with client_for(replace(config, google_client_secret=''), provider) as client:
        assert client.get('/api/auth/config').json()['ready'] is False
        assert client.post('/api/auth/google/start', json={'returnTo': config.return_url}).status_code == 503


def test_no_stub_access_to_unimplemented_routes_and_rate_limit(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        assert client.post('/api/auth/email/start', json={}).status_code == 404
        assert client.post('/api/profile', json={}).status_code == 404
        assert client.get('/api/auth/session').headers['cache-control'] == 'no-store'
        for _ in range(20):
            assert client.post('/api/auth/google/start', json={'returnTo': config.return_url}).status_code == 200
        assert client.post('/api/auth/google/start', json={'returnTo': config.return_url}).status_code == 429
        client.post('/api/auth/logout')
        assert client.cookies.get(OAUTH_COOKIE) is None
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM oauth_attempts').fetchone()['n'] == 0
