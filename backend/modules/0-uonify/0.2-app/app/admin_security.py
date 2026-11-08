"""Núcleo de privilegios de la consola de admin: sesión propia, roles/capacidades y auditoría.

Superficie PRIVILEGIADA: el backend es la fuente de verdad (recomprueba cada acción);
el frontend solo oculta controles. La matriz refleja `admin/model/permissions.ts`.
"""
import base64
import hashlib
import hmac
import secrets
from uuid import uuid4
from fastapi import HTTPException
from .security import digest

ADMIN_COOKIE = 'uonify_admin'
FLOW_COOKIE = 'uonify_admin_flow'
# Sesión de admin más corta que la del cliente (12 h); re-autenticación para acciones críticas (fases siguientes).
ADMIN_SESSION_SECONDS = 12 * 60 * 60
FLOW_SECONDS = 600

# Capacidades por rol (= AdminAction del frontend). superadmin lo puede todo.
CAPABILITY_ROLES = {
    'customers.suspend': {'superadmin', 'operaciones', 'soporte', 'finanzas'},
    'customers.aiBlock': {'superadmin', 'operaciones', 'soporte'},
    'customers.adjust': {'superadmin', 'soporte', 'finanzas'},
    'customers.approve': {'superadmin', 'finanzas'},
    'customers.note': {'superadmin', 'operaciones', 'soporte', 'finanzas'},
    'pricing.edit': {'superadmin'},
    'providers.edit': {'superadmin', 'operaciones'},
    'support.reply': {'superadmin', 'soporte', 'operaciones'},
    'articles.edit': {'superadmin', 'soporte'},
    'finance.retry': {'superadmin', 'finanzas'},
    'audit.all': {'superadmin'},
}


def require_admin(connection, request):
    token = request.cookies.get(ADMIN_COOKIE, '')
    admin = None
    if token and len(token) <= 256:
        admin = connection.execute(
            '''SELECT a.*, s.expires_at AS session_expires_at
               FROM admin_users a JOIN admin_sessions s ON a.id = s.admin_id
               WHERE s.token_hash = %s AND s.expires_at > now() AND a.status = 'active' ''',
            (digest(token),)).fetchone()
    if not admin:
        raise HTTPException(401, detail={'error': 'admin_session_required',
                                         'message': 'Inicia sesión en la consola.'})
    return admin


def require_capability(admin, capability):
    if admin['role'] not in CAPABILITY_ROLES.get(capability, set()):
        raise HTTPException(403, detail={'error': 'forbidden',
                                         'message': 'Tu rol no permite esta acción.'})


def audit(connection, admin, action, *, target_type=None, target_id=None,
          target_label=None, reason=None, detail=None, result='ok'):
    connection.execute(
        '''INSERT INTO admin_audit_log
           (id, actor_admin_id, actor_email, action, target_type, target_id, target_label, reason, detail, result)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (uuid4(), admin['id'] if admin else None, admin['email'] if admin else '—',
         action, target_type, target_id, target_label, reason, detail, result))


def _set(response, name, token, max_age, path):
    # secure=True: los navegadores aceptan cookies Secure en 127.0.0.1/localhost (contexto seguro).
    response.set_cookie(name, token, max_age=max_age, httponly=True, secure=True, samesite='lax', path=path)


def _clear(response, name, path):
    response.delete_cookie(name, path=path, httponly=True, secure=True, samesite='lax')


def set_admin_cookie(response, token, max_age=ADMIN_SESSION_SECONDS):
    _set(response, ADMIN_COOKIE, token, max_age, '/api/admin')


def clear_admin_cookie(response):
    _clear(response, ADMIN_COOKIE, '/api/admin')


def set_flow_cookie(response, token):
    _set(response, FLOW_COOKIE, token, FLOW_SECONDS, '/api/admin/auth')


def clear_flow_cookie(response):
    _clear(response, FLOW_COOKIE, '/api/admin/auth')


# Hash de contraseña con PBKDF2-HMAC-SHA256 (biblioteca estándar; requirements está fijado, sin bcrypt/argon2).
# Formato: pbkdf2_sha256$<iteraciones>$<salt_b64>$<hash_b64>. Solo para el login local simple (detrás de flag).
def hash_password(password):
    salt = secrets.token_bytes(16)
    iterations = 600_000
    derived = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
    return 'pbkdf2_sha256$%d$%s$%s' % (iterations, base64.b64encode(salt).decode(), base64.b64encode(derived).decode())


def verify_password(password, stored):
    try:
        algorithm, iterations, salt_b64, hash_b64 = (stored or '').split('$')
        if algorithm != 'pbkdf2_sha256':
            return False
        derived = hashlib.pbkdf2_hmac('sha256', password.encode(), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(derived, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False
