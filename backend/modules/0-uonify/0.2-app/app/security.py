import hashlib
import secrets
import time
from fastapi import HTTPException, Request

SESSION_COOKIE = 'uonify_session'
OAUTH_COOKIE = 'uonify_oauth'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def random_token():
    return secrets.token_urlsafe(32)


def require_origin(request: Request, origin: str):
    if request.headers.get('origin') != origin:
        raise HTTPException(403, detail={'error': 'invalid_origin', 'message': 'La petición no procede de Uonify.'})


def set_cookie(response, name, token, max_age, path='/'):
    response.set_cookie(name, token, max_age=max_age, httponly=True, secure=False, samesite='lax', path=path)


def clear_cookie(response, name, path='/'):
    response.delete_cookie(name, path=path, httponly=True, secure=False, samesite='lax')


def limit_start(database, request):
    bucket = digest((request.client.host if request.client else 'unknown') + ':' + str(int(time.time()) // 600))
    with database.connect() as connection:
        connection.execute('DELETE FROM request_limits WHERE expires_at < now()')
        row = connection.execute('''INSERT INTO request_limits VALUES (%s,1,now()+interval '10 minutes')
            ON CONFLICT (bucket) DO UPDATE SET hits=request_limits.hits+1 RETURNING hits''', (bucket,)).fetchone()
    if row['hits'] > 20:
        raise HTTPException(429, detail={'error': 'too_many_attempts', 'message': 'Has hecho varios intentos. Espera unos minutos y vuelve a probar.'})
