"""Autorización Drive independiente del login y de Cloud. Tokens solo en servidor."""
from datetime import datetime, timedelta, timezone
from cryptography.fernet import Fernet
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from .security import SESSION_COOKIE, digest, random_token, require_origin, set_cookie, clear_cookie, limit_start
from .google_account import same_account, connection_matches, require_same_connection
from .onboarding import require_user, StrictBody
from .access import workspace_access
from .onboarding_setup import preparation_user, preparation_allowed

from .drive_popup import finish_popup, popup_status

COOKIE = 'uonify_drive_oauth'
class StartBody(StrictBody):
    popup: bool = False


def entitled(connection, request):
    user = require_user(connection, request)
    if workspace_access(connection, user)['status'] != 'allowed':
        raise HTTPException(403, detail={'error':'subscription_required','message':'Necesitas una prueba o suscripción vigente para conectar tus herramientas.'})
    return user


def public_connection(connection, user):
    row = connection.execute('SELECT * FROM google_drive_connections WHERE user_id=%s', (user['id'],)).fetchone()
    if not row:
        return {'status': 'disconnected'}
    if not connection_matches(user, row):
        return {'status': 'disconnected'}
    return {'status': row['status'], 'email': row['email'], 'folderId': row['folder_id']}


def routes(settings, database, provider):
    router = APIRouter(prefix='/api/connections/google-drive')
    cipher = Fernet(settings.encryption_key)

    @router.get('')
    def status(request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            return {'connection': public_connection(connection, user), 'available': settings.google_ready,
                    'accessAllowed': workspace_access(connection, user)['status'] == 'allowed',
                    'preparationAllowed': preparation_allowed(connection,user),
                    'onboardingDeferred': bool(connection.execute('SELECT 1 FROM drive_onboarding_preferences WHERE user_id=%s', (user['id'],)).fetchone())}

    @router.post('/defer')
    def defer(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            connection.execute('INSERT INTO drive_onboarding_preferences(user_id) VALUES(%s) ON CONFLICT DO NOTHING', (user['id'],))
        return {'onboardingDeferred': True}

    @router.post('/start')
    def start(request: Request, body: StartBody = StartBody()):
        require_origin(request, settings.origin)
        if not settings.google_ready:
            raise HTTPException(503, detail={'error':'not_configured','message':'La conexión con Google no está disponible ahora.'})
        limit_start(database, request)
        state, browser, nonce, verifier = ('drive_popup_' if body.popup else 'drive_') + random_token(), random_token(), random_token(), random_token()
        with database.connect() as connection:
            user = preparation_user(connection, request)
            connection.execute('DELETE FROM drive_oauth_attempts WHERE expires_at<now() OR user_id=%s', (user['id'],))
            connection.execute('INSERT INTO drive_oauth_attempts VALUES(%s,%s,%s,%s,%s,%s,%s)',
                (digest(state), user['id'], digest(request.cookies.get(SESSION_COOKIE,'')), digest(browser), nonce,
                 cipher.encrypt(verifier.encode()).decode(), datetime.now(timezone.utc)+timedelta(minutes=10)))
            connection.execute('DELETE FROM drive_popup_flows WHERE expires_at<now() OR user_id=%s', (user['id'],))
            if body.popup:
                connection.execute('INSERT INTO drive_popup_flows(id,user_id,session_hash,expires_at) VALUES(%s,%s,%s,%s)',
                    (digest(state),user['id'],digest(request.cookies.get(SESSION_COOKIE,'')),datetime.now(timezone.utc)+timedelta(minutes=10)))
        response = JSONResponse({'authUrl': provider.authorization_url(state, nonce, verifier, login_hint=user['google_subject']), 'flowId': digest(state) if body.popup else None})
        set_cookie(response, COOKIE, browser, 600, '/api/auth')
        return response

    @router.get('/flows/{flow_id}')
    def flow_status(flow_id: str, request: Request):
        return popup_status(database, request, flow_id)

    @router.delete('/flows/{flow_id}')
    def cancel_flow(flow_id: str, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            flow = connection.execute("UPDATE drive_popup_flows SET status='error' WHERE id=%s AND user_id=%s AND session_hash=%s AND status='pending' RETURNING id",
                (flow_id,user['id'],digest(request.cookies.get(SESSION_COOKIE,'')))).fetchone()
            if flow:
                connection.execute('DELETE FROM drive_oauth_attempts WHERE state_hash=%s', (flow_id,))
        return {'cancelled': bool(flow)}

    def finish(request, error=None):
        response = finish_popup(database, request, request.query_params.get('state',''), error)
        if response is None:
            response = RedirectResponse(settings.origin + '/?drive=' + (error or 'return'), status_code=303)
        clear_cookie(response, COOKIE, '/api/auth')
        return response

    def callback(request: Request):
        state, browser = request.query_params.get('state',''), request.cookies.get(COOKIE,'')
        if len(state)>256 or len(browser)>256 or not browser:
            return finish(request, 'invalid_state')
        with database.connect() as connection:
            attempt = connection.execute('''DELETE FROM drive_oauth_attempts WHERE state_hash=%s AND browser_hash=%s
                AND session_hash=%s AND expires_at>now()
                AND EXISTS(SELECT 1 FROM users WHERE users.id=drive_oauth_attempts.user_id
                    AND users.deletion_requested_at IS NULL) RETURNING *''',
                (digest(state),digest(browser),digest(request.cookies.get(SESSION_COOKIE,'')))).fetchone()
        if not attempt:
            return finish(request, 'invalid_state')
        if request.query_params.get('error'):
            return finish(request, 'denied')
        code = request.query_params.get('code','')
        if not code or len(code)>4096:
            return finish(request, 'google_unavailable')
        try:
            with database.connect() as connection:
                user = preparation_user(connection, request)
                if user['id'] != attempt['user_id']:
                    return finish(request, 'invalid_state')
                identity = provider.exchange(code,attempt['nonce'],cipher.decrypt(attempt['verifier_encrypted'].encode()).decode())
                if not same_account(user, identity['subject']):
                    return finish(request, 'account_mismatch')
                connection.execute('''INSERT INTO google_drive_connections(user_id,google_subject,email,refresh_encrypted,scope)
                    VALUES(%s,%s,%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET
                    google_subject=EXCLUDED.google_subject,email=EXCLUDED.email,refresh_encrypted=EXCLUDED.refresh_encrypted,
                    scope=EXCLUDED.scope,status='connected',folder_id=CASE WHEN google_drive_connections.google_subject=EXCLUDED.google_subject THEN google_drive_connections.folder_id ELSE NULL END,connected_at=now()''',
                    (user['id'],identity['subject'],identity['email'],cipher.encrypt(identity['refresh'].encode()).decode(),identity['scope']))
        except HTTPException:
            return finish(request, 'session_or_subscription')
        except Exception:
            return finish(request, 'google_unavailable')
        return finish(request)

    @router.delete('')
    def disconnect(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            connection.execute('DELETE FROM google_drive_connections WHERE user_id=%s', (user['id'],))
            connection.execute('DELETE FROM drive_oauth_attempts WHERE user_id=%s', (user['id'],))
            connection.execute('DELETE FROM drive_popup_flows WHERE user_id=%s', (user['id'],))
        return {'connection': {'status':'disconnected'}}

    return router, callback
