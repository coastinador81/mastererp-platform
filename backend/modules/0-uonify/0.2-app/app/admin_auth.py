"""Acceso de la consola de admin (/api/admin/auth/*): correo @uonify.com + código + 2FA (TOTP/recuperación).

Contrato EmailChallenge / MfaChallenge / AdminSession con el frontend (admin/model/types.ts).
El código va por correo real (Mailpit local); sin `preview` del mock. Sesión de panel propia (cookie separada).
"""
import smtplib
import secrets as pysecrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from hmac import compare_digest
from typing import Literal
from uuid import UUID, uuid4
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field
from .onboarding import StrictBody
from .security import digest, random_token, require_origin, limit_start
from .admin_security import (ADMIN_COOKIE, FLOW_COOKIE, ADMIN_SESSION_SECONDS, audit, verify_password,
                             set_admin_cookie, clear_admin_cookie, set_flow_cookie, clear_flow_cookie)
from .admin_totp import verify_totp


class EmailStartBody(StrictBody):
    email: str = Field(min_length=3, max_length=254)


class ResendBody(StrictBody):
    challengeId: str = Field(min_length=1, max_length=64)


class VerifyEmailBody(StrictBody):
    challengeId: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=12)


class VerifyMfaBody(StrictBody):
    mfaChallengeId: str = Field(min_length=1, max_length=64)
    method: Literal['totp', 'recovery']
    code: str = Field(min_length=1, max_length=32)


class PasswordLoginBody(StrictBody):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


def _now():
    return datetime.now(timezone.utc)


def _uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


def _mask(email):
    name, _, domain = email.partition('@')
    if not domain:
        return '***'
    head = name[0] if name else ''
    return head + '*' * max(1, len(name) - 1) + '@' + domain


def _send_code(to_email, code):
    # Buzón de pruebas local (Mailpit); nunca afirma entrega al correo real. Sin salida a Internet.
    message = EmailMessage()
    message['From'] = 'Uonify <acceso@uonify.test>'
    message['To'] = to_email
    message['Subject'] = 'Tu código de acceso a la consola de Uonify'
    message.set_content('Tu código de acceso a la consola es ' + code + '.\n'
                        'Caduca en 10 minutos. Si no has sido tú, ignora este mensaje.\n')
    with smtplib.SMTP('mailpit', 1025, timeout=10) as smtp:
        smtp.send_message(message)


def routes(settings, database):
    router = APIRouter(prefix='/api/admin/auth')
    cipher = Fernet(settings.encryption_key)

    @router.get('/session')
    def session(request: Request):
        # authMode indica al frontend qué formulario pintar: 'password' (local, detrás de flag) o 'mfa' (prod).
        mode = 'password' if settings.admin_dev_simple_login else 'mfa'
        token = request.cookies.get(ADMIN_COOKIE, '')
        if not token or len(token) > 256:
            return {'authenticated': False, 'authMode': mode, 'passwordLogin': settings.admin_dev_simple_login}
        with database.connect() as connection:
            row = connection.execute(
                '''SELECT a.email, a.name, a.role, s.expires_at FROM admin_users a
                   JOIN admin_sessions s ON a.id = s.admin_id
                   WHERE s.token_hash = %s AND s.expires_at > now() AND a.status = 'active' ''',
                (digest(token),)).fetchone()
        if not row:
            response = JSONResponse({'authenticated': False, 'authMode': mode, 'passwordLogin': settings.admin_dev_simple_login})
            clear_admin_cookie(response)
            return response
        return {'authenticated': True, 'expiresAt': row['expires_at'].isoformat(), 'authMode': mode,
                'passwordLogin': settings.admin_dev_simple_login,
                'member': {'email': row['email'], 'name': row['name'], 'role': row['role']}}

    @router.post('/email/start')
    def email_start(body: EmailStartBody, request: Request):
        require_origin(request, settings.origin)
        limit_start(database, request)
        email = body.email.strip().lower()
        browser = random_token()
        expires, resend, challenge_id = _now() + timedelta(minutes=10), _now() + timedelta(seconds=30), uuid4()
        masked, code = _mask(email), None
        with database.connect() as connection:
            connection.execute('DELETE FROM admin_email_challenges WHERE expires_at < now()')
            admin = connection.execute("SELECT id, email FROM admin_users WHERE email = %s AND status = 'active'", (email,)).fetchone()
            if admin:
                connection.execute('DELETE FROM admin_email_challenges WHERE admin_id = %s', (admin['id'],))
                code = f'{pysecrets.randbelow(1000000):06d}'
                connection.execute(
                    '''INSERT INTO admin_email_challenges (id, admin_id, code_hash, browser_hash, expires_at, resend_at)
                       VALUES (%s,%s,%s,%s,%s,%s)''',
                    (challenge_id, admin['id'], digest(code), digest(browser), expires, resend))
                masked = _mask(admin['email'])
        if code:  # Enviado fuera de la transacción; nunca se revela si el correo existe.
            try:
                _send_code(email, code)
            except OSError:
                raise HTTPException(503, detail={'error': 'email_unavailable', 'message': 'No hemos podido enviar el código. Inténtalo de nuevo.'})
        response = JSONResponse({'challengeId': str(challenge_id), 'maskedEmail': masked,
                                 'expiresAt': expires.isoformat(), 'resendAfter': 30})
        set_flow_cookie(response, browser)
        return response

    @router.post('/email/resend')
    def email_resend(body: ResendBody, request: Request):
        require_origin(request, settings.origin)
        cid, browser = _uuid(body.challengeId), request.cookies.get(FLOW_COOKIE, '')
        if not cid or not browser:
            raise HTTPException(400, detail={'error': 'invalid_challenge', 'message': 'Vuelve a empezar el acceso.'})
        with database.connect() as connection:
            ch = connection.execute(
                '''SELECT c.id, c.expires_at, c.resend_at, a.email FROM admin_email_challenges c
                   JOIN admin_users a ON a.id = c.admin_id
                   WHERE c.id = %s AND c.browser_hash = %s AND c.consumed_at IS NULL AND c.expires_at > now()''',
                (cid, digest(browser))).fetchone()
            if not ch:
                raise HTTPException(400, detail={'error': 'invalid_challenge', 'message': 'Vuelve a empezar el acceso.'})
            if ch['resend_at'] > _now():
                raise HTTPException(429, detail={'error': 'too_soon', 'message': 'Espera unos segundos antes de pedir otro código.'})
            code = f'{pysecrets.randbelow(1000000):06d}'
            connection.execute('UPDATE admin_email_challenges SET code_hash = %s, resend_at = %s WHERE id = %s',
                               (digest(code), _now() + timedelta(seconds=30), cid))
            email, expires = ch['email'], ch['expires_at']
        try:
            _send_code(email, code)
        except OSError:
            raise HTTPException(503, detail={'error': 'email_unavailable', 'message': 'No hemos podido enviar el código. Inténtalo de nuevo.'})
        return {'challengeId': str(cid), 'maskedEmail': _mask(email), 'expiresAt': expires.isoformat(), 'resendAfter': 30}

    @router.post('/email/verify')
    def email_verify(body: VerifyEmailBody, request: Request):
        require_origin(request, settings.origin)
        cid, browser = _uuid(body.challengeId), request.cookies.get(FLOW_COOKIE, '')
        if not cid or not browser:
            raise HTTPException(400, detail={'error': 'invalid_code', 'message': 'Código no válido o caducado. Vuelve a empezar.'})
        with database.connect() as connection:
            ch = connection.execute(
                '''SELECT * FROM admin_email_challenges
                   WHERE id = %s AND browser_hash = %s AND consumed_at IS NULL AND expires_at > now() FOR UPDATE''',
                (cid, digest(browser))).fetchone()
            if not ch:
                raise HTTPException(400, detail={'error': 'invalid_code', 'message': 'Código no válido o caducado. Vuelve a empezar.'})
            if ch['attempts'] >= 5:
                connection.execute('UPDATE admin_email_challenges SET consumed_at = now() WHERE id = %s', (cid,))
                raise HTTPException(429, detail={'error': 'too_many_attempts', 'message': 'Demasiados intentos. Vuelve a empezar el acceso.'})
            if not compare_digest(ch['code_hash'], digest(body.code.strip())):
                connection.execute('UPDATE admin_email_challenges SET attempts = attempts + 1 WHERE id = %s', (cid,))
                raise HTTPException(400, detail={'error': 'invalid_code', 'message': 'Código no válido. Revisa e inténtalo de nuevo.'})
            connection.execute('UPDATE admin_email_challenges SET consumed_at = now() WHERE id = %s', (cid,))
            mfa_id = uuid4()
            connection.execute('''INSERT INTO admin_mfa_challenges (id, admin_id, browser_hash, expires_at)
                                  VALUES (%s,%s,%s,%s)''', (mfa_id, ch['admin_id'], ch['browser_hash'], _now() + timedelta(minutes=5)))
            admin = connection.execute(
                '''SELECT totp_secret_encrypted,
                          (SELECT count(*) FROM admin_recovery_codes r WHERE r.admin_id = admin_users.id AND r.used_at IS NULL) AS recovery
                   FROM admin_users WHERE id = %s''', (ch['admin_id'],)).fetchone()
        methods = (['totp'] if admin and admin['totp_secret_encrypted'] else []) + (['recovery'] if admin and admin['recovery'] else [])
        return {'mfaChallengeId': str(mfa_id), 'methods': methods or ['totp']}

    @router.post('/mfa/verify')
    def mfa_verify(body: VerifyMfaBody, request: Request):
        require_origin(request, settings.origin)
        mid, browser = _uuid(body.mfaChallengeId), request.cookies.get(FLOW_COOKIE, '')
        if not mid or not browser:
            raise HTTPException(400, detail={'error': 'invalid_code', 'message': 'Segundo factor no válido. Vuelve a empezar.'})
        token, expires = random_token(), _now() + timedelta(seconds=ADMIN_SESSION_SECONDS)
        with database.connect() as connection:
            mfa = connection.execute(
                '''SELECT * FROM admin_mfa_challenges
                   WHERE id = %s AND browser_hash = %s AND consumed_at IS NULL AND expires_at > now() FOR UPDATE''',
                (mid, digest(browser))).fetchone()
            if not mfa:
                raise HTTPException(400, detail={'error': 'invalid_code', 'message': 'Segundo factor caducado. Vuelve a empezar.'})
            if mfa['attempts'] >= 5:
                connection.execute('UPDATE admin_mfa_challenges SET consumed_at = now() WHERE id = %s', (mid,))
                raise HTTPException(429, detail={'error': 'too_many_attempts', 'message': 'Demasiados intentos. Vuelve a empezar el acceso.'})
            admin = connection.execute("SELECT * FROM admin_users WHERE id = %s AND status = 'active'", (mfa['admin_id'],)).fetchone()
            ok = False
            if admin and body.method == 'totp' and admin['totp_secret_encrypted']:
                try:
                    secret = cipher.decrypt(admin['totp_secret_encrypted'].encode()).decode()
                except Exception:
                    secret = ''
                ok = verify_totp(secret, body.code.strip())
            elif admin and body.method == 'recovery':
                used = connection.execute(
                    '''UPDATE admin_recovery_codes SET used_at = now()
                       WHERE id = (SELECT id FROM admin_recovery_codes WHERE admin_id = %s AND code_hash = %s AND used_at IS NULL LIMIT 1)
                       RETURNING id''', (mfa['admin_id'], digest(body.code.strip().lower()))).fetchone()
                ok = bool(used)
            if not ok:
                connection.execute('UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = %s', (mid,))
                if admin:
                    audit(connection, admin, 'admin.login', result='mfa_failed')
                raise HTTPException(400, detail={'error': 'invalid_code', 'message': 'Segundo factor no válido. Inténtalo de nuevo.'})
            connection.execute('UPDATE admin_mfa_challenges SET consumed_at = now() WHERE id = %s', (mid,))
            connection.execute('DELETE FROM admin_sessions WHERE expires_at < now()')
            connection.execute('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (%s,%s,%s)',
                               (digest(token), admin['id'], expires))
            audit(connection, admin, 'admin.login', result='ok')
            member = {'email': admin['email'], 'name': admin['name'], 'role': admin['role']}
        response = JSONResponse({'authenticated': True, 'member': member, 'expiresAt': expires.isoformat()})
        clear_flow_cookie(response)
        set_admin_cookie(response, token)
        return response

    @router.post('/password')
    def password_login(body: PasswordLoginBody, request: Request):
        # SOLO local/desarrollo, detrás del flag. En prod (flag off) no existe: 404 y queda el flujo correo+código+2FA.
        if not settings.admin_dev_simple_login:
            raise HTTPException(404, detail={'error': 'not_found', 'message': 'No disponible.'})
        require_origin(request, settings.origin)
        limit_start(database, request)
        email = body.email.strip().lower()
        token, expires = random_token(), _now() + timedelta(seconds=ADMIN_SESSION_SECONDS)
        with database.connect() as connection:
            admin = connection.execute("SELECT * FROM admin_users WHERE email = %s AND status = 'active'", (email,)).fetchone()
            if not (admin and admin.get('password_hash') and verify_password(body.password, admin['password_hash'])):
                if admin:
                    audit(connection, admin, 'admin.login', detail='password', result='failed')
                raise HTTPException(401, detail={'error': 'invalid_credentials', 'message': 'Correo o contraseña no válidos.'})
            connection.execute('DELETE FROM admin_sessions WHERE expires_at < now()')
            connection.execute('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (%s,%s,%s)',
                               (digest(token), admin['id'], expires))
            audit(connection, admin, 'admin.login', detail='password', result='ok')
            member = {'email': admin['email'], 'name': admin['name'], 'role': admin['role']}
        response = JSONResponse({'authenticated': True, 'member': member, 'expiresAt': expires.isoformat()})
        set_admin_cookie(response, token)
        return response

    @router.post('/logout')
    def logout(request: Request):
        require_origin(request, settings.origin)
        token = request.cookies.get(ADMIN_COOKIE, '')
        with database.connect() as connection:
            if token and len(token) <= 256:
                row = connection.execute('''SELECT a.* FROM admin_users a JOIN admin_sessions s ON a.id = s.admin_id
                                            WHERE s.token_hash = %s''', (digest(token),)).fetchone()
                connection.execute('DELETE FROM admin_sessions WHERE token_hash = %s', (digest(token),))
                if row:
                    audit(connection, row, 'admin.logout', result='ok')
        response = JSONResponse({'ok': True})
        clear_admin_cookie(response)
        clear_flow_cookie(response)
        return response

    return router
