"""Operaciones compartidas del gateway y la API local, aisladas por usuario/sesión."""
from datetime import datetime, timedelta, timezone
from cryptography.fernet import Fernet
from fastapi import HTTPException
from .access import workspace_access
from .onboarding import require_user
from .security import SESSION_COOKIE, digest, random_token


def fail(code, message, status=400):
    raise HTTPException(status, detail={'error': code, 'message': message})


def entitled(connection, request):
    user = require_user(connection, request)
    if workspace_access(connection, user)['status'] != 'allowed':
        fail('subscription_required', 'Necesitas una prueba o suscripción vigente para conectar Amazon.', 403)
    return user


def original_user(connection, attempt):
    user = connection.execute('''SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
        WHERE u.id=%s AND s.token_hash=%s AND s.expires_at>now() FOR UPDATE OF u,s''',
        (attempt['user_id'], attempt['session_hash'])).fetchone()
    if user and user.get('deletion_requested_at'):
        fail('account_deletion_pending', 'Tu cuenta está pendiente de eliminación. Vuelve a Uonify para terminarla.', 403)
    if not user or workspace_access(connection, user)['status'] != 'allowed':
        fail('session_or_subscription', 'Vuelve a Uonify para revisar tu sesión y suscripción.', 403)
    return user


def cancel_pending(connection, user_id):
    connection.execute("""UPDATE amazon_oauth_attempts SET status='error',error_code='cancelled',launch_hash=NULL
        WHERE user_id=%s AND status IN ('pending','confirming','ready','authorizing','exchanging')""", (user_id,))


def create_attempt(connection, request, user, config, cipher, intent=None):
    cancel_pending(connection, user['id'])
    connection.execute('DELETE FROM amazon_oauth_attempts WHERE expires_at<now()')
    state, launch = random_token(), random_token()
    identifier = digest(state)
    connection.execute('''INSERT INTO amazon_oauth_attempts
        (id,user_id,session_hash,launch_hash,state_encrypted,browser_hash,payload_encrypted,expected_seller,expires_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (identifier, user['id'], digest(request.cookies.get(SESSION_COOKIE, '')), digest(launch),
         cipher.encrypt(state.encode()).decode(), intent['browser_hash'] if intent else None,
         intent['payload_encrypted'] if intent else None, intent['seller_id'] if intent else None,
         min(intent['expires_at'], datetime.now(timezone.utc) + timedelta(minutes=10)) if intent else
         datetime.now(timezone.utc) + timedelta(minutes=10)))
    return {'authUrl': config.login_uri + '?launch=' + launch, 'flowId': identifier}


def public_connection(connection, user_id):
    row = connection.execute('SELECT seller_id,marketplace_id,connected_at FROM amazon_connections WHERE user_id=%s',
                             (user_id,)).fetchone()
    if not row:
        return {'status': 'disconnected'}
    return {'status': 'connected', 'sellerId': row['seller_id'], 'marketplaceId': row['marketplace_id'],
            'connectedAt': row['connected_at'].isoformat()}


def record_error(database, flow_id, code):
    with database.connect() as connection:
        connection.execute("""UPDATE amazon_oauth_attempts SET status='error',error_code=%s,launch_hash=NULL
            WHERE id=%s AND status IN ('pending','confirming','ready','authorizing','exchanging')
            AND EXISTS(SELECT 1 FROM users WHERE users.id=amazon_oauth_attempts.user_id
                AND users.deletion_requested_at IS NULL)""", (code, flow_id))
