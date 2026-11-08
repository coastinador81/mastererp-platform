"""Nexus: inicia, confirma y consulta OAuth; estas rutas nunca se exponen por el túnel."""
import re
from cryptography.fernet import Fernet
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from .access import workspace_access
from .onboarding import require_user, StrictBody
from .security import require_origin, limit_start, SESSION_COOKIE, digest
from .amazon_store import entitled, fail, create_attempt, public_connection, cancel_pending


def routes(settings, database, provider):
    router = APIRouter(prefix='/api/connections/amazon')
    config, cipher = provider.config, Fernet(settings.encryption_key)

    def configured():
        if not config.ready:
            fail('not_configured', 'Estamos preparando la conexión con Amazon. Aún no puedes autorizarla.', 503)

    @router.get('')
    def status(request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            return {'connection': public_connection(connection, user['id']), 'available': config.ready,
                    'setup': config.status(), 'accessAllowed': workspace_access(connection, user)['status'] == 'allowed'}

    @router.post('/start')
    def start(request: Request, body: StrictBody = StrictBody()):
        require_origin(request, settings.origin)
        configured()
        limit_start(database, request)
        with database.connect() as connection:
            return create_attempt(connection, request, entitled(connection, request), config, cipher)

    @router.get('/bootstrap')
    def bootstrap(request: Request):
        configured()
        # GET entre orígenes: el ticket de un uso está ligado a la sesión que hizo POST/start.
        # Un enlace copiado no funciona con otra cuenta ni otra sesión del mismo usuario.
        values = list(request.query_params.multi_items())
        if len(values) != 1 or values[0][0] != 'ticket' or not re.fullmatch(r'[A-Za-z0-9_-]{40,64}', values[0][1]):
            fail('invalid_bootstrap', 'Reinicia la conexión desde tu pestaña de Uonify.', 403)
        with database.connect() as connection:
            user = entitled(connection, request)
            row = connection.execute("""UPDATE amazon_oauth_attempts SET bootstrap_hash=NULL,status='ready'
                WHERE bootstrap_hash=%s AND user_id=%s AND session_hash=%s
                AND status='confirming' AND expires_at>now() RETURNING id""",
                (digest(values[0][1]), user['id'], digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
            if not row:
                fail('invalid_bootstrap', 'Continúa desde la misma sesión de Uonify que inició la conexión.', 403)
        return RedirectResponse(config.login_uri + '?resume=' + row['id'], status_code=303)

    @router.get('/flows/{flow_id}')
    def flow(flow_id: str, request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            row = connection.execute('''SELECT status,error_code FROM amazon_oauth_attempts
                WHERE id=%s AND user_id=%s AND session_hash=%s AND expires_at>now()''',
                (flow_id, user['id'], digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
        if not row:
            fail('flow_expired', 'La conexión ha caducado. Puedes volver a intentarlo.', 404)
        return {'status': row['status'] if row['status'] in ('error', 'success') else 'pending',
                **({'error': row['error_code']} if row['error_code'] else {})}

    @router.delete('/flows/{flow_id}')
    def cancel(flow_id: str, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            row = connection.execute("""UPDATE amazon_oauth_attempts SET status='error',error_code='cancelled',launch_hash=NULL
                WHERE id=%s AND user_id=%s AND session_hash=%s AND status IN ('pending','confirming','ready','authorizing','exchanging') RETURNING id""",
                (flow_id, user['id'], digest(request.cookies.get(SESSION_COOKIE, '')))).fetchone()
        return {'cancelled': bool(row)}

    @router.get('/intents/{intent_id}')
    def intent_status(intent_id: str, request: Request):
        with database.connect() as connection:
            entitled(connection, request)
            row = connection.execute('SELECT seller_id,expires_at FROM amazon_oauth_intents WHERE id=%s AND expires_at>now()',
                                     (digest(intent_id),)).fetchone()
        if not row:
            fail('intent_expired', 'La solicitud ha caducado. Reinicia la conexión desde Amazon.', 404)
        return {'sellerId': row['seller_id'], 'expiresAt': row['expires_at'].isoformat()}

    @router.post('/intents/{intent_id}/accept')
    def accept(intent_id: str, request: Request, body: StrictBody = StrictBody()):
        require_origin(request, settings.origin)
        configured()
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,64}', intent_id):
            fail('intent_expired', 'La solicitud no es válida.', 404)
        limit_start(database, request)
        with database.connect() as connection:
            user = entitled(connection, request)
            intent = connection.execute('DELETE FROM amazon_oauth_intents WHERE id=%s AND expires_at>now() RETURNING *',
                                        (digest(intent_id),)).fetchone()
            if not intent:
                fail('intent_expired', 'La solicitud ha caducado. Reinicia la conexión desde Amazon.', 404)
            return create_attempt(connection, request, user, config, cipher, intent)

    @router.delete('')
    def disconnect(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            cancel_pending(connection, user['id'])
            connection.execute('DELETE FROM amazon_connections WHERE user_id=%s', (user['id'],))
        return {'connection': {'status': 'disconnected'}, 'amazonRevocationRequired': True}

    return router
