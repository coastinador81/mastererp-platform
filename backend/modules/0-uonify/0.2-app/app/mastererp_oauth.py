"""Conexión de Uony con ERP · Finanzas, como la de Drive: ventana OAuth (code + PKCE S256, state y
nonce) contra el cliente web público de Cognito del ERP. El servidor canjea y custodia los tokens;
la web solo ve el estado, el correo y los ids que necesita para elegir espacio y empresa. Solo
lectura: los permisos los decide el ERP en cada llamada (Consultor C3, C4, C7 y C8)."""
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import Field
from .security import SESSION_COOKIE, digest, random_token, require_origin, set_cookie, clear_cookie, limit_start
from .onboarding import require_user, StrictBody
from .access import workspace_access
from .google_drive_oauth import entitled
from .mastererp_config import load_mastererp_config
from .mastererp_types import ErpError
from . import mastererp_api as api
from . import mastererp_cognito as cognito
from . import mastererp_store as store
from .mastererp_popup import finish_popup, popup_status

logger = logging.getLogger(__name__)
BASE = '/api/connections/erp'
COOKIE = 'uonify_erp_oauth'
FINANCE_MODULE = 'erp.finance'
UUID_PATTERN = r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
FAILURES = {
    'erp_reconnect': (409, 'Vuelve a conectar tu cuenta del ERP para continuar.'),
    'erp_not_linked': (409, 'Tu cuenta del ERP aún no tiene acceso a ningún espacio. Pide acceso a quien lo administra.'),
    'erp_selection_required': (409, 'Elige primero el espacio y la empresa del ERP.'),
    'erp_changed': (409, 'La conexión del ERP ha cambiado. Vuelve a intentarlo.'),
    'erp_denied': (403, 'Tu cuenta del ERP no tiene Finanzas en ese espacio o en esa empresa.'),
    'erp_not_found': (404, 'Ese espacio o esa empresa ya no está disponible.'),
    'erp_invalid': (400, 'Revisa los datos enviados.'),
    'erp_unavailable': (503, 'No podemos consultar el ERP ahora. Inténtalo de nuevo en unos minutos.'),
}


class StartBody(StrictBody):
    popup: bool = False


class SelectionBody(StrictBody):
    tenantId: str = Field(pattern=UUID_PATTERN)
    companyId: str | None = Field(default=None, pattern=UUID_PATTERN)


def failure(error):
    status_code, message = FAILURES[error.code]
    return JSONResponse({'error': error.code, 'message': message}, status_code=status_code)


def routes(settings, database):
    router = APIRouter()
    config = load_mastererp_config()
    cipher = Fernet(settings.encryption_key)

    def spaces(token, tenant_id=None):
        """GET /v1/uonify/spaces[?tenant_id=] con el token del servidor (cliente de mastererp_api)."""
        with cognito.http_client() as http:
            return api.spaces(config, token, tenant_id, client=http)

    def remember(user_id, current, error):
        """Un 401 o un identity_not_linked de la API también cambian el estado guardado."""
        if error.code in ('erp_reconnect', 'erp_not_linked'):
            store.mark(database, user_id, 'reauthorize' if error.code == 'erp_reconnect' else 'not_linked', current)
        return error.code

    def directory(user_id, tenant_id):
        """Espacios y, del espacio elegido, las empresas con Finanzas, leídos con el token del servidor."""
        token, current = store.access_token(database, settings, user_id, config=config)
        try:
            try:
                data = spaces(token, tenant_id)
            except ErpError as error:
                if not tenant_id or error.code not in ('erp_denied', 'erp_not_found'):
                    raise
                data = spaces(token)
        except ErpError as error:
            remember(user_id, current, error)
            raise
        context = data.get('context')
        finance = bool(context and FINANCE_MODULE in context['modules'])
        # Módulos y permisos del contexto: la web solo los usa para enseñar u ocultar apartados.
        return {'spaces': data['spaces'], 'companies': context['companies'] if finance else [],
                'modules': list(context['modules']) if context else [],
                'permissions': list(context['permissions']) if context else []}

    @router.get(BASE)
    def status(request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            allowed = workspace_access(connection, user)['status'] == 'allowed'
            row = store.load(connection, user['id'])
        listing, error = None, None
        if allowed and row and row['status'] == 'connected':
            try:
                listing = directory(user['id'], str(row['tenant_id']) if row['tenant_id'] else None)
            except ErpError as failed:
                error = failed.code
        with database.connect() as connection:
            user = require_user(connection, request)
            body = {'connection': store.public_status(connection, user, listing), 'available': True,
                    'accessAllowed': allowed}
        return {**body, 'listingError': error} if error else body

    @router.post(BASE + '/start')
    def start(request: Request, body: StartBody = StartBody()):
        require_origin(request, settings.origin)
        limit_start(database, request)
        state = ('erp_popup_' if body.popup else 'erp_') + random_token()
        browser, nonce, verifier = random_token(), random_token(), random_token()
        session = digest(request.cookies.get(SESSION_COOKIE, ''))
        expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        with database.connect() as connection:
            user = entitled(connection, request)
            connection.execute('DELETE FROM erp_oauth_attempts WHERE expires_at<now() OR user_id=%s', (user['id'],))
            connection.execute('''INSERT INTO erp_oauth_attempts(state_hash,user_id,session_hash,browser_hash,nonce,
                verifier_encrypted,expires_at) VALUES(%s,%s,%s,%s,%s,%s,%s)''',
                (digest(state), user['id'], session, digest(browser), nonce,
                 cipher.encrypt(verifier.encode()).decode(), expires))
            connection.execute('DELETE FROM erp_popup_flows WHERE expires_at<now() OR user_id=%s', (user['id'],))
            if body.popup:
                connection.execute('INSERT INTO erp_popup_flows(id,user_id,session_hash,expires_at) VALUES(%s,%s,%s,%s)',
                                   (digest(state), user['id'], session, expires))
        response = JSONResponse({'authUrl': cognito.authorization_url(config, settings.origin, state, nonce, verifier),
                                 'flowId': digest(state) if body.popup else None})
        set_cookie(response, COOKIE, browser, 600, '/api/auth')
        return response

    @router.get(BASE + '/flows/{flow_id}')
    def flow_status(flow_id: str, request: Request):
        return popup_status(database, request, flow_id)

    @router.delete(BASE + '/flows/{flow_id}')
    def cancel_flow(flow_id: str, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            flow = connection.execute('''UPDATE erp_popup_flows SET status='error' WHERE id=%s AND user_id=%s
                AND session_hash=%s AND status='pending' RETURNING id''',
                (flow_id, user['id'], digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
            if flow:
                connection.execute('DELETE FROM erp_oauth_attempts WHERE state_hash=%s', (flow_id,))
        return {'cancelled': bool(flow)}

    @router.post(BASE + '/selection')
    def select(body: SelectionBody, request: Request):
        require_origin(request, settings.origin)
        tenant = str(UUID(body.tenantId))
        company = str(UUID(body.companyId)) if body.companyId else None
        with database.connect() as connection:
            user = entitled(connection, request)
            row = store.load(connection, user['id'])
        if not row or row['status'] != 'connected':
            return failure(ErpError('erp_not_linked' if row and row['status'] == 'not_linked' else 'erp_reconnect'))
        try:
            token, current = store.access_token(database, settings, user['id'], config=config)
            try:
                data = spaces(token, tenant)
            except ErpError as error:
                remember(user['id'], current, error)
                raise
        except ErpError as error:
            return failure(error)
        context = data['context']
        companies = context['companies'] if FINANCE_MODULE in context['modules'] else []
        if company is None and len(companies) == 1:
            company = companies[0]['id']
        if not companies or (company is not None and company not in {item['id'] for item in companies}):
            return failure(ErpError('erp_denied'))
        with database.connect() as connection:
            user = entitled(connection, request)
            if not store.select(connection, user['id'], row['issuer'], row['cognito_sub'], tenant, company):
                return failure(ErpError('erp_changed'))
            return {'connection': store.public_status(connection, user, {
                'spaces': data['spaces'], 'companies': companies,
                'modules': list(context['modules']), 'permissions': list(context['permissions'])})}

    @router.delete(BASE)
    def disconnect(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            refresh_encrypted = store.remove(connection, user['id'])
        if refresh_encrypted:
            try:
                refresh_token = cipher.decrypt(refresh_encrypted.encode()).decode()
            except InvalidToken:
                logger.warning('erp_revoke_failed reason=undecryptable')
            else:
                cognito.revoke(config, refresh_token)
        return {'connection': {'status': 'disconnected'}}

    def finish(request, error=None):
        response = finish_popup(database, request, request.query_params.get('state', ''), error)
        if response is None:
            # Vuelve a la app, no a «/?…»: la puerta de DEV deja «/» en la portada salvo las vueltas de APPQ.
            response = RedirectResponse(settings.origin + '/espacio?service=erp&erp=' + (error or 'return'), status_code=303)
        clear_cookie(response, COOKIE, '/api/auth')
        return response

    def linked(token, current):
        """(estado, espacio, empresa) según el ERP. Se conserva la elección previa de la misma cuenta
        si su espacio sigue disponible; con un solo espacio y una sola empresa con Finanzas, se eligen."""
        try:
            found = [space['id'] for space in spaces(token)['spaces']]
        except ErpError as error:
            if error.code == 'erp_not_linked':
                return 'not_linked', None, None
            raise
        if current and current['tenant_id'] and str(current['tenant_id']) in found:
            return ('connected', str(current['tenant_id']),
                    str(current['company_id']) if current['company_id'] else None)
        if len(found) != 1:
            return 'connected', None, None
        try:
            context = spaces(token, found[0])['context']
        except ErpError:
            return 'connected', None, None
        companies = context['companies'] if FINANCE_MODULE in context['modules'] else []
        if not companies:
            return 'connected', None, None
        return 'connected', found[0], companies[0]['id'] if len(companies) == 1 else None

    def link(request, user_id, current, tokens, nonce):
        identity = cognito.validate_id_token(config, tokens['id_token'], nonce)
        access = cognito.check_access_token(config, tokens['access_token'])
        if access['sub'] != identity['sub']:
            raise ErpError('erp_invalid')
        same = not current or (current['issuer'], current['cognito_sub']) == (config.issuer, identity['sub'])
        status, tenant, company = linked(tokens['access_token'], current if same else None)
        with database.connect() as connection:
            if entitled(connection, request)['id'] != user_id:
                raise ErpError('erp_changed')
            result = store.save(connection, user_id, config.issuer, identity,
                                cipher.encrypt(tokens['refresh_token'].encode()).decode(),
                                access['scope'], status, tenant, company)
        if result == 'account_mismatch':
            cognito.revoke(config, tokens['refresh_token'])  # Otra cuenta: no se guarda (C7).
        return None if result == 'connected' else result

    @router.get('/api/auth/mastererp/callback')
    def callback(request: Request):
        state, browser = request.query_params.get('state', ''), request.cookies.get(COOKIE, '')
        if len(state) > 256 or len(browser) > 256 or not browser:
            return finish(request, 'invalid_state')
        # Un solo uso: el intento se borra al leerlo y va ligado a usuario, sesión y navegador.
        with database.connect() as connection:
            attempt = connection.execute('''DELETE FROM erp_oauth_attempts WHERE state_hash=%s AND browser_hash=%s
                AND session_hash=%s AND expires_at>now()
                AND EXISTS(SELECT 1 FROM users WHERE users.id=erp_oauth_attempts.user_id
                    AND users.deletion_requested_at IS NULL) RETURNING *''',
                (digest(state), digest(browser), digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
        if not attempt:
            return finish(request, 'invalid_state')
        if request.query_params.get('error'):
            return finish(request, 'denied')
        code = request.query_params.get('code', '')
        if not code or len(code) > 4096:
            return finish(request, 'erp_unavailable')
        try:
            with database.connect() as connection:
                user = entitled(connection, request)
                if user['id'] != attempt['user_id']:
                    return finish(request, 'invalid_state')
                current = store.load(connection, user['id'])
            verifier = cipher.decrypt(attempt['verifier_encrypted'].encode()).decode()
            tokens = cognito.exchange(config, settings.origin, code, verifier)
            try:
                outcome = link(request, user['id'], current, tokens, attempt['nonce'])
            except Exception:
                cognito.revoke(config, tokens['refresh_token'])  # Lo que no se guarda se revoca.
                raise
        except HTTPException:
            return finish(request, 'session_or_subscription')
        except ErpError as error:
            logger.warning('erp_callback_rejected code=%s', error.code)
            return finish(request, 'erp_unavailable')
        except Exception as error:
            logger.warning('erp_callback_failed type=%s', type(error).__name__)
            return finish(request, 'erp_unavailable')
        return finish(request, outcome)

    return router
