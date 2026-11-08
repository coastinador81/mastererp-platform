"""Entrada HTTPS aislada para OAuth Amazon; sin proxy a la API o al frontend local."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlencode
import hmac
import json
import re
import psycopg
from cryptography.fernet import Fernet
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .database import Database
from .security import digest, random_token, limit_start
from .amazon_provider import AmazonProvider, LOGIN_PATH, CALLBACK_PATH, validate_amazon_callback
from .amazon_store import original_user, fail, record_error
from .amazon_pages import page, result_page

COOKIE = 'uonify_amazon_browser'
COOKIE_PATH = '/integrations/amazon'


def set_browser(response, token):
    response.set_cookie(COOKIE, token, max_age=600, secure=True, httponly=True,
                        samesite='lax', path=COOKIE_PATH)
    return response


def fields(request, allowed):
    items = list(request.query_params.multi_items())
    if len(items) != len({k for k, _ in items}) or any(k not in allowed for k, _ in items):
        fail('invalid_request', 'La solicitud de Amazon no es válida.')
    return dict(items)


def create_gateway(settings, provider=None):
    database = Database(settings.database)
    provider = provider or AmazonProvider(settings)
    config, cipher = provider.config, Fernet(settings.encryption_key)

    @asynccontextmanager
    async def lifespan(app):
        database.migrate()
        yield

    app = FastAPI(title='Uonify · Retorno Amazon', lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[
        '127.0.0.1', 'localhost', urlsplit(config.origin).hostname or 'unconfigured.invalid'])

    @app.middleware('http')
    async def headers(request, call_next):
        if len(request.scope.get('query_string', b'')) > 8192 or request.headers.get('content-length', '0') != '0':
            response = JSONResponse({'error': 'invalid_request'}, status_code=400)
        else:
            response = await call_next(request)
        response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                                 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
                                 'Strict-Transport-Security': 'max-age=86400'})
        if 'Content-Security-Policy' not in response.headers:
            response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        return response

    @app.exception_handler(HTTPException)
    async def expected_error(request, error):
        return page('Conexión no disponible', 'Vuelve a tu pestaña de Uonify para iniciar o repetir la conexión.',
                    settings.origin, status=error.status_code)

    @app.exception_handler(psycopg.Error)
    async def database_error(request, error):
        return page('Conexión no disponible', 'No podemos completar esta conexión ahora. Vuelve a tu pestaña de Uonify para intentarlo de nuevo.',
                    settings.origin, status=503)

    @app.get('/integrations/amazon/health')
    def health():
        return {'service': 'uonify-amazon-oauth', 'status': 'ready' if config.ready else 'setup_required'}

    @app.get(LOGIN_PATH)
    def login(request: Request):
        values = fields(request, {'launch', 'resume', 'amazon_callback_uri', 'amazon_state', 'selling_partner_id', 'version'})
        if not values:
            return page('Conecta Amazon con Uonify',
                        'Vuelve a tu pestaña de Uonify para vincular tu cuenta de vendedor.' if config.ready else
                        'Estamos preparando la conexión con Amazon. La autorización aún no está disponible.', settings.origin)
        if not config.ready:
            fail('not_configured', 'Conexión en preparación.', 503)
        limit_start(database, request)
        if 'launch' in values:
            if len(values) != 1 or not re.fullmatch(r'[A-Za-z0-9_-]{40,64}', values['launch']):
                fail('invalid_launch', 'La conexión no es válida.')
            return launch(request, values['launch'])
        if 'resume' in values:
            if len(values) != 1 or not re.fullmatch(r'[a-f0-9]{64}', values['resume']):
                fail('invalid_launch', 'La conexión no es válida.')
            return resume(request, values['resume'])
        return incoming(request, values)

    def launch(request, token):
        browser = request.cookies.get(COOKIE, '')
        with database.connect() as connection:
            attempt = connection.execute('''SELECT * FROM amazon_oauth_attempts
                WHERE launch_hash=%s AND status='pending' AND expires_at>now()''', (digest(token),)).fetchone()
            if not attempt:
                fail('invalid_launch', 'Inicia la conexión de nuevo.', 409)
            if attempt['browser_hash'] and (not browser or not hmac.compare_digest(attempt['browser_hash'], digest(browser))):
                fail('invalid_browser', 'Continúa desde el mismo navegador.', 403)
            original_user(connection, attempt)
            browser = browser if attempt['browser_hash'] else random_token()
            ticket = random_token()
            claimed = connection.execute("""UPDATE amazon_oauth_attempts SET launch_hash=NULL,
                browser_hash=%s,bootstrap_hash=%s,status='confirming'
                WHERE id=%s AND launch_hash=%s AND status='pending' RETURNING id""",
                (digest(browser), digest(ticket), attempt['id'], digest(token))).fetchone()
            if not claimed:
                fail('invalid_launch', 'La conexión ya ha comenzado.', 409)
        target = settings.origin + '/api/connections/amazon/bootstrap?ticket=' + ticket
        return set_browser(RedirectResponse(target, status_code=303), browser)

    def resume(request, flow_id):
        browser = request.cookies.get(COOKIE, '')
        if not browser or len(browser) > 128:
            fail('invalid_browser', 'Continúa desde el mismo navegador.', 403)
        with database.connect() as connection:
            attempt = connection.execute("""SELECT * FROM amazon_oauth_attempts
                WHERE id=%s AND browser_hash=%s AND status='ready' AND expires_at>now()""",
                (flow_id, digest(browser))).fetchone()
            if not attempt:
                fail('invalid_launch', 'Reinicia la conexión desde tu pestaña de Uonify.', 409)
            original_user(connection, attempt)
            claimed = connection.execute("""UPDATE amazon_oauth_attempts SET status='authorizing'
                WHERE id=%s AND status='ready' RETURNING id""", (flow_id,)).fetchone()
            if not claimed:
                fail('invalid_launch', 'La conexión ya ha comenzado.', 409)
            state = cipher.decrypt(attempt['state_encrypted'].encode()).decode()
            if attempt['payload_encrypted']:
                payload = json.loads(cipher.decrypt(attempt['payload_encrypted'].encode()).decode())
                target = validate_amazon_callback(payload['callback'], config) + '?' + urlencode({
                    'amazon_state': payload['amazonState'], 'state': state,
                    'redirect_uri': config.redirect_uri, 'version': 'beta'})
            else:
                target = provider.authorization_url(state)
        return RedirectResponse(target, status_code=303)

    def incoming(request, values):
        seller, amazon_state = values.get('selling_partner_id', ''), values.get('amazon_state', '')
        if (not re.fullmatch(r'[A-Za-z0-9]{1,64}', seller) or not 1 <= len(amazon_state) <= 2048
                or values.get('version', 'beta') != 'beta'):
            fail('invalid_request', 'La solicitud no es válida.')
        try:
            callback = validate_amazon_callback(values.get('amazon_callback_uri', ''), config)
        except ValueError:
            fail('invalid_callback', 'El destino de Amazon no es válido.')
        token, browser = random_token(), random_token()
        payload = cipher.encrypt(json.dumps({'callback': callback, 'amazonState': amazon_state}).encode()).decode()
        with database.connect() as connection:
            connection.execute('DELETE FROM amazon_oauth_intents WHERE expires_at<now()')
            connection.execute('INSERT INTO amazon_oauth_intents VALUES(%s,%s,%s,%s,%s)',
                (digest(token), digest(browser), payload, seller, datetime.now(timezone.utc) + timedelta(minutes=10)))
        return set_browser(page('Continúa en Uonify',
            'Inicia sesión y confirma en Nexus qué cuenta de Uonify quieres vincular a este vendedor.',
            settings.origin, intent=token), browser)

    @app.get(CALLBACK_PATH)
    def callback(request: Request):
        values = fields(request, {'state', 'selling_partner_id', 'spapi_oauth_code', 'error', 'error_description'})
        state, browser = values.get('state', ''), request.cookies.get(COOKIE, '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,64}', state) or not browser or len(browser) > 128:
            return result_page(settings.origin, error='invalid_state')
        flow_id = digest(state)
        with database.connect() as connection:
            attempt = connection.execute('''SELECT * FROM amazon_oauth_attempts
                WHERE id=%s AND browser_hash=%s AND status='authorizing' AND expires_at>now()''',
                (flow_id, digest(browser))).fetchone()
            if not attempt:
                return result_page(settings.origin, error='invalid_state')
            try:
                original_user(connection, attempt)
            except HTTPException as failure:
                if not isinstance(failure.detail, dict) or failure.detail.get('error') != 'account_deletion_pending':
                    connection.execute("UPDATE amazon_oauth_attempts SET status='error',error_code='session_or_subscription' WHERE id=%s", (flow_id,))
                return result_page(settings.origin, flow_id, 'session_or_subscription')
            claimed = connection.execute("""UPDATE amazon_oauth_attempts SET status='exchanging'
                WHERE id=%s AND status='authorizing' RETURNING id""", (flow_id,)).fetchone()
            if not claimed:
                return result_page(settings.origin, error='invalid_state')
        # La transacción ya confirmó el consumo. Nunca se repite el canje LWA.
        code, seller = values.get('spapi_oauth_code', ''), values.get('selling_partner_id', '')
        error = 'denied' if values.get('error') else None
        if not error and (not 1 <= len(code) <= 4096 or not re.fullmatch(r'[A-Za-z0-9]{1,64}', seller)
                          or attempt['expected_seller'] and seller != attempt['expected_seller']):
            error = 'invalid_response'
        if not error:
            try:
                refresh = provider.exchange(code)
                error = persist(attempt, seller, refresh)
            except HTTPException:
                error = 'session_or_subscription'
            except psycopg.errors.UniqueViolation:
                error = 'seller_conflict'
            except Exception:
                error = 'amazon_unavailable'
        if error:
            record_error(database, flow_id, error)
        response = result_page(settings.origin, flow_id, error)
        response.delete_cookie(COOKIE, path=COOKIE_PATH, secure=True, httponly=True, samesite='lax')
        return response

    def persist(attempt, seller, refresh):
        with database.connect() as connection:
            original_user(connection, attempt)
            current = connection.execute("""SELECT id FROM amazon_oauth_attempts
                WHERE id=%s AND status='exchanging' AND expires_at>now() FOR UPDATE""", (attempt['id'],)).fetchone()
            if not current:
                return 'cancelled'
            old = connection.execute('SELECT seller_id FROM amazon_connections WHERE user_id=%s', (attempt['user_id'],)).fetchone()
            if old and old['seller_id'] != seller:
                return 'seller_changed'
            connection.execute('''INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted)
                VALUES(%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET
                refresh_encrypted=EXCLUDED.refresh_encrypted,connected_at=now()''',
                (attempt['user_id'], seller, cipher.encrypt(refresh.encode()).decode()))
            connection.execute("""UPDATE amazon_oauth_attempts SET status='success',state_encrypted='',payload_encrypted=NULL
                WHERE id=%s""", (attempt['id'],))
        return None

    return app
