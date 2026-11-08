from datetime import datetime, timedelta, timezone
from uuid import uuid4
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from .onboarding import onboarding_state
from .security import (SESSION_COOKIE, OAUTH_COOKIE, digest, random_token,
                       require_origin, set_cookie, clear_cookie, limit_start)


class StartBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    returnTo: str = Field(max_length=512)


def routes(settings, database, google, cloud_callback=None, drive_callback=None):
    router = APIRouter(prefix='/api/auth')
    cipher = Fernet(settings.encryption_key)

    @router.get('/config')
    def config():
        return {'provider': 'google', 'mode': 'redirect', 'providers': ['google'],
                'onboardingStage': 'profile', 'ready': settings.google_ready}

    @router.post('/google/start')
    def start(body: StartBody, request: Request):
        require_origin(request, settings.origin)
        if body.returnTo != settings.return_url:
            raise HTTPException(400, detail={'error': 'invalid_return_to', 'message': 'Dirección de vuelta no válida.'})
        if not settings.google_ready:
            raise HTTPException(503, detail={'error': 'google_not_configured', 'message': 'El acceso con Google aún no está disponible. Inténtalo más tarde.'})
        limit_start(database, request)
        state, browser, nonce, verifier = [random_token() for _ in range(4)]
        expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        previous = request.cookies.get(OAUTH_COOKIE, '')
        with database.connect() as connection:
            connection.execute('DELETE FROM oauth_attempts WHERE expires_at < now() OR browser_hash=%s', (digest(previous),))
            connection.execute('INSERT INTO oauth_attempts VALUES (%s,%s,%s,%s,%s)',
                               (digest(state), digest(browser), nonce, cipher.encrypt(verifier.encode()).decode(), expires))
        response = JSONResponse({'authUrl': google.authorization_url(state, nonce, verifier)})
        set_cookie(response, OAUTH_COOKIE, browser, 600, '/api/auth')
        return response

    @router.get('/google/callback')
    def callback(request: Request):
        if drive_callback and request.query_params.get('state', '').startswith('drive_'):
            return drive_callback(request)
        if cloud_callback and request.query_params.get('state', '').startswith('cloud_'):
            return cloud_callback(request)
        query = request.query_params
        state, browser = query.get('state', ''), request.cookies.get(OAUTH_COOKIE, '')
        if not state or not browser or len(state) > 256 or len(browser) > 256:
            return failed('invalid_state')
        with database.connect() as connection:
            attempt = connection.execute('''DELETE FROM oauth_attempts WHERE state_hash=%s
                AND browser_hash=%s AND expires_at>now() RETURNING *''', (digest(state), digest(browser))).fetchone()
        if not attempt:
            return failed('invalid_state')
        if query.get('error'):
            return failed('access_denied' if query['error'] == 'access_denied' else 'provider_error')
        code = query.get('code', '')
        if not code or len(code) > 4096:
            return failed('provider_error')
        try:
            identity = google.identity(code, attempt['nonce'], cipher.decrypt(attempt['verifier_encrypted'].encode()).decode())
        except Exception:
            # No imprimir respuestas de Google, códigos, tokens ni información personal.
            return failed('provider_error')
        token = random_token()
        expires = datetime.now(timezone.utc) + timedelta(seconds=settings.session_seconds)
        with database.connect() as connection:
            # La identidad es sub de Google. Nunca se fusionan cuentas por correo.
            user = connection.execute('''INSERT INTO users (id,google_subject,email,display_name)
                VALUES (%s,%s,%s,%s) ON CONFLICT (google_subject) DO UPDATE
                SET email=CASE WHEN users.deletion_requested_at IS NULL THEN excluded.email ELSE users.email END,
                display_name=CASE WHEN users.deletion_requested_at IS NULL THEN excluded.display_name ELSE users.display_name END,
                updated_at=CASE WHEN users.deletion_requested_at IS NULL THEN now() ELSE users.updated_at END RETURNING id''',
                (uuid4(), identity['sub'], identity['email'], identity['name'])).fetchone()
            previous = request.cookies.get(SESSION_COOKIE, '')
            connection.execute('DELETE FROM sessions WHERE token_hash=%s OR expires_at<now()', (digest(previous),))
            connection.execute('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (%s,%s,%s)',
                               (digest(token), user['id'], expires))
        response = RedirectResponse(settings.return_url, status_code=303)
        clear_cookie(response, OAUTH_COOKIE, '/api/auth')
        set_cookie(response, SESSION_COOKIE, token, settings.session_seconds)
        return response

    def failed(error):
        response = RedirectResponse(settings.return_url + '&error=' + error, status_code=303)
        clear_cookie(response, OAUTH_COOKIE, '/api/auth')
        return response

    @router.get('/session')
    def session(request: Request):
        token = request.cookies.get(SESSION_COOKIE, '')
        if not token or len(token) > 256:
            return {'authenticated': False}
        with database.connect() as connection:
            user = connection.execute('''SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
                WHERE token_hash=%s AND expires_at>now()''', (digest(token),)).fetchone()
            progress = onboarding_state(connection, user) if user else None
        if not user:
            response = JSONResponse({'authenticated': False})
            clear_cookie(response, SESSION_COOKIE)
            return response
        return {'authenticated': True, 'email': user['email'],
                'accountDeletionPending': bool(user.get('deletion_requested_at')),
                'account': {'email': user['email'], 'provider': 'google'},
                'identity': {'provider': 'google', 'email': user['email'], 'name': user['display_name']},
                **progress, 'chatgptPlan': {'status': 'not_connected'}}

    @router.post('/logout')
    def logout(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            connection.execute('DELETE FROM sessions WHERE token_hash=%s', (digest(request.cookies.get(SESSION_COOKIE, '')),))
            connection.execute('DELETE FROM oauth_attempts WHERE browser_hash=%s', (digest(request.cookies.get(OAUTH_COOKIE, '')),))
        response = JSONResponse({'ok': True})
        clear_cookie(response, SESSION_COOKIE)
        clear_cookie(response, OAUTH_COOKIE, '/api/auth')
        return response

    return router
