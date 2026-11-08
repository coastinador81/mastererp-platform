"""Confirmed self-service deletion with a durable external-cleanup boundary."""
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from psycopg.errors import LockNotAvailable, DeadlockDetected
from psycopg.types.json import Jsonb
from .account_deletion_billing import cleanup_billing
from .account_deletion_data import blockers, counts, purge, require_isolated_graph, cancel_conversations
from .account_deletion_identity import intent_id, retain_trial, subject_hash
from .onboarding import require_user
from .security import SESSION_COOKIE, OAUTH_COOKIE, digest, require_origin


class DeletionBody(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    requestId: str = Field(min_length=36, max_length=36)
    confirmation: str = Field(max_length=30)
    email: str = Field(min_length=3, max_length=320)


def error(code, message, status=409):
    return HTTPException(status, detail={'error': code, 'message': message})


def receipt(request, request_id):
    return digest(request.cookies.get(SESSION_COOKIE, '') + ':' + str(request_id))


def public_state(connection, user, request_id=None):
    row = connection.execute('SELECT * FROM account_deletions WHERE user_id=%s', (user['id'],)).fetchone()
    busy = blockers(connection, user['id'])
    status = row['status'] if row else 'blocked' if busy else 'ready'
    return {'status': status, 'email': user['email'], 'confirmationText': 'ELIMINAR',
        'requestId': str(row['id']) if row else str(request_id or uuid4()), 'counts': counts(connection, user['id']),
        'blockers': busy, 'canRetry': bool(row) and not busy,
        'message': row['message'] if row and row['message'] else
            'Hay una operación en curso. Espera a que termine.' if busy else
            'La eliminación está pendiente. Puedes retomarla para terminar.' if row else
            'Se eliminarán los datos y conexiones de tu cuenta en Uonify. Tus archivos y servicios externos se conservarán.'}


def read_user(connection, request):
    token = request.cookies.get(SESSION_COOKIE, '')
    user = connection.execute('''SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
        WHERE s.token_hash=%s AND s.expires_at>now()''', (digest(token),)).fetchone() if token and len(token) <= 256 else None
    if not user:
        raise error('session_required', 'Vuelve a iniciar sesión para revisar tu cuenta.', 401)
    return user


class AccountDeletion:
    def __init__(self, settings, database, stripe, materials=None):
        self.settings, self.database, self.stripe, self.materials = settings, database, stripe, materials

    def begin(self, request, body, request_id):
        with self.database.connect() as connection:
            connection.execute("SET LOCAL lock_timeout='500ms'")
            existing = connection.execute('SELECT * FROM account_deletions WHERE id=%s', (request_id,)).fetchone()
            if existing and existing['status'] == 'deleted' and existing['receipt_hash'] == receipt(request, request_id):
                return None
            user = require_user(connection, request, allow_deleting=True)
            if body.email != user['email']:
                raise error('account_changed', 'La cuenta ha cambiado. Revisa de nuevo qué cuenta vas a eliminar.')
            if existing and (existing['user_id'] != user['id'] or existing['identity_hash'] != subject_hash(self.settings, user)):
                raise error('deletion_request_conflict', 'Esta solicitud no corresponde a tu cuenta actual.')
            if not existing and request_id != intent_id(self.settings, user, request.cookies.get(SESSION_COOKIE, '')):
                raise error('deletion_request_conflict', 'La cuenta o sesión ha cambiado. Revisa de nuevo la eliminación.')
            previous = connection.execute('SELECT * FROM account_deletions WHERE user_id=%s', (user['id'],)).fetchone()
            if previous and previous['id'] != request_id:
                raise error('deletion_request_conflict', 'Retoma la solicitud de eliminación que ya has confirmado.')
            cancel_conversations(connection,user['id'])
            if blockers(connection, user['id']):
                raise error('account_busy', 'Hay una operación en curso. Espera a que termine antes de eliminar la cuenta.')
            require_isolated_graph(connection, user['id'])
            connection.execute('''INSERT INTO account_deletions(id,user_id,identity_hash,receipt_hash,status)
                VALUES (%s,%s,%s,%s,'pending') ON CONFLICT(id) DO UPDATE SET status='pending',
                error_code=NULL,message=NULL,updated_at=now()''',
                (request_id, user['id'], subject_hash(self.settings, user), receipt(request, request_id)))
            connection.execute('UPDATE users SET deletion_requested_at=coalesce(deletion_requested_at,now()) WHERE id=%s', (user['id'],))
            return user

    def finish(self, request, user, request_id):
        # The confirmation was committed separately. A crash leaves a resumable
        # request; external cancellation is reconciled by GET before any retry.
        with self.database.connect() as connection:
            connection.execute("SET LOCAL lock_timeout='500ms'")
            current = connection.execute('SELECT * FROM users WHERE id=%s FOR UPDATE', (user['id'],)).fetchone()
            if not current:
                row = connection.execute('SELECT status FROM account_deletions WHERE id=%s', (request_id,)).fetchone()
                if row and row['status'] == 'deleted':
                    return
                raise error('account_changed', 'La cuenta ha cambiado. Revisa el estado de la eliminación.')
            if blockers(connection, current['id']):
                raise error('account_busy', 'Hay una operación en curso. La eliminación sigue pendiente.')
            require_isolated_graph(connection, current['id'])
            billing = cleanup_billing(connection, self.stripe, current, request_id)
            summary = {'removed': counts(connection, current['id']), 'billing': billing}
            retain_trial(connection, self.settings, current, billing['trialUsed'])
            purge(connection, current, digest(request.cookies[OAUTH_COOKIE]) if request.cookies.get(OAUTH_COOKIE) else None)
            connection.execute('''UPDATE account_deletions SET status='deleted',result=%s,error_code=NULL,
                message=NULL,deleted_at=now(),updated_at=now() WHERE id=%s''', (Jsonb(summary), request_id))
        if self.materials is not None:
            cache = getattr(self.materials, '_tokens', {})
            for key in list(cache):
                if key[0] == str(user['id']) or key[0] == user['id']:
                    cache.pop(key, None)

    def failed(self, request_id, failure):
        detail = failure.detail if isinstance(failure, HTTPException) and isinstance(failure.detail, dict) else {}
        code = detail.get('error', 'account_deletion_unavailable')
        message = (detail.get('message') or
            'No se pudo terminar la eliminación. Tu cuenta sigue conservada y puedes volver a intentarlo.')
        with self.database.connect() as connection:
            row = connection.execute('''UPDATE account_deletions SET status='error',error_code=%s,
                message=%s,updated_at=now() WHERE id=%s AND status<>'deleted' RETURNING user_id''',
                (code, message, request_id)).fetchone()
            if not row:
                done = connection.execute('SELECT status FROM account_deletions WHERE id=%s', (request_id,)).fetchone()
                if done and done['status'] == 'deleted':
                    return {'status': 'deleted', 'redirectTo': '/'}
                raise error('account_deletion_unavailable', 'No se pudo comprobar la eliminación. Revisa de nuevo tu cuenta.', 503)
            user = connection.execute('SELECT * FROM users WHERE id=%s', (row['user_id'],)).fetchone()
            return public_state(connection, user)


def routes(settings, database, stripe, materials=None):
    router = APIRouter(prefix='/api/account/deletion')
    service = AccountDeletion(settings, database, stripe, materials)

    @router.get('')
    def inspect(request: Request):
        with database.connect() as connection:
            user = read_user(connection, request)
            return public_state(connection, user, intent_id(settings, user, request.cookies[SESSION_COOKIE]))

    @router.post('')
    def delete(body: DeletionBody, request: Request):
        require_origin(request, settings.origin)
        try:
            request_id = UUID(body.requestId)
        except ValueError:
            raise error('invalid_request', 'La solicitud de eliminación no es válida.', 400)
        if body.confirmation != 'ELIMINAR':
            raise error('confirmation_required', 'Escribe ELIMINAR exactamente para confirmar.', 400)
        try:
            user = service.begin(request, body, request_id)
        except (LockNotAvailable, DeadlockDetected):
            raise error('account_busy', 'Hay una operación en curso. Espera a que termine antes de eliminar la cuenta.')
        if user:
            try:
                service.finish(request, user, request_id)
            except Exception as failure:
                # Do not expose provider responses, SQL or credentials. The
                # durable request survives and no local deletion was committed.
                return service.failed(request_id, failure)
        # The server has revoked every session of this account. Do not expire a
        # shared browser cookie: a late response may belong to a different login.
        return JSONResponse({'status': 'deleted', 'redirectTo': '/'})

    return router
