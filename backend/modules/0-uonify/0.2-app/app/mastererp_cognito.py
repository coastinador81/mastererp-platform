"""Cognito del ERP con el cliente web público (sin secreto): autorización code + PKCE S256 con
state y nonce, canje, refresco, revocación y validación de los tokens. Solo servidor: ningún
token sale de aquí hacia el navegador, el modelo, la sesión ADK ni los logs (Consultor C3, C4,
C7 y C8). Plazos cortos: las Lambdas del ERP cortan a los 15 s y el turno de Uony dura 60 s."""
import base64
import hashlib
import hmac
import json
import logging
import math
import threading
import time
from urllib.parse import urlencode
import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from .mastererp_types import ErpError

logger = logging.getLogger(__name__)
TIMEOUT = httpx.Timeout(8.0, connect=4.0)
MAX_TOKEN = 16384
# Un kid desconocido solo vuelve a pedir el JWKS pasado este tiempo: se pide una vez y se cachea.
JWKS_RETRY_SECONDS = 300
_jwks = {}  # URL del JWKS -> (monotonic de la descarga, {kid: clave pública RSA})
_jwks_lock = threading.Lock()


def http_client():
    """Cliente de servidor a servidor con plazos cortos (también para mastererp_api.spaces al
    conectar); las pruebas lo sustituyen por uno falso."""
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False)


def required_scope(config):
    return next(scope for scope in config.scopes if scope.endswith('/identity.spaces.read'))


def authorization_url(config, origin, state, nonce, verifier):
    """URL del Hosted UI: code + PKCE S256, state y nonce por intento."""
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    return config.hosted_ui + '/oauth2/authorize?' + urlencode({
        'response_type': 'code', 'client_id': config.client_id,
        'redirect_uri': config.redirect_uri(origin), 'scope': ' '.join(config.scopes),
        'state': state, 'nonce': nonce, 'code_challenge': challenge, 'code_challenge_method': 'S256'})


def _token(config, form):
    """POST /oauth2/token del cliente público: client_id en el cuerpo y ningún secreto."""
    try:
        with http_client() as http:
            response = http.post(config.hosted_ui + '/oauth2/token',
                                 data={**form, 'client_id': config.client_id},
                                 headers={'Accept': 'application/json'})
    except httpx.HTTPError:
        raise ErpError('erp_unavailable') from None
    try:
        data = response.json()
    except ValueError:
        data = None
    if response.status_code == 400 and isinstance(data, dict) and data.get('error') == 'invalid_grant':
        raise ErpError('erp_reconnect')
    if response.status_code != 200 or not isinstance(data, dict):
        raise ErpError('erp_unavailable')
    return data


def _text(value):
    return isinstance(value, str) and 0 < len(value) <= MAX_TOKEN


def _expires_in(data):
    value = data.get('expires_in')
    return value if type(value) is int and 0 < value <= 86400 else 0


def exchange(config, origin, code, verifier):
    """Canjea el código con el verificador PKCE. Devuelve los tres tokens; nadie los registra."""
    data = _token(config, {'grant_type': 'authorization_code', 'code': code,
                           'redirect_uri': config.redirect_uri(origin), 'code_verifier': verifier})
    tokens = {name: data.get(name) for name in ('id_token', 'access_token', 'refresh_token')}
    if not all(_text(value) for value in tokens.values()):
        raise ErpError('erp_unavailable')
    return {**tokens, 'expires_in': _expires_in(data)}


def refresh(config, refresh_token):
    """(access_token, expires_in, refresh nuevo o None). invalid_grant -> ErpError('erp_reconnect')."""
    data = _token(config, {'grant_type': 'refresh_token', 'refresh_token': refresh_token})
    access, rotated = data.get('access_token'), data.get('refresh_token')
    if not _text(access) or (rotated is not None and not _text(rotated)):
        raise ErpError('erp_unavailable')
    return access, _expires_in(data), rotated if rotated and rotated != refresh_token else None


def revoke(config, refresh_token):
    """Revoca el refresh en Cognito. Es lo mejor posible, pero nunca en silencio (C7): un fallo
    deja un WARNING de código fijo, sin token, sub, inquilino ni cuerpo de la respuesta."""
    try:
        with http_client() as http:
            response = http.post(config.hosted_ui + '/oauth2/revoke',
                                 data={'token': refresh_token, 'client_id': config.client_id})
    except httpx.TimeoutException:
        reason = 'timeout'
    except httpx.HTTPError:
        reason = 'network'
    else:
        if response.status_code == 200:
            return True
        reason = 'status_%dxx' % min(max(response.status_code // 100, 1), 5)
    logger.warning('erp_revoke_failed reason=%s', reason)
    return False


def _b64(part):
    return base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))


def _fetch_jwks(config):
    try:
        with http_client() as http:
            response = http.get(config.jwks_url, headers={'Accept': 'application/json'})
        document = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        document = None
    keys = {}
    for jwk in (document.get('keys') if isinstance(document, dict) else None) or ():
        if (not isinstance(jwk, dict) or jwk.get('kty') != 'RSA' or jwk.get('alg', 'RS256') != 'RS256'
                or jwk.get('use', 'sig') != 'sig' or not isinstance(jwk.get('kid'), str) or len(keys) >= 20):
            continue
        try:
            key = rsa.RSAPublicNumbers(int.from_bytes(_b64(jwk['e']), 'big'),
                                       int.from_bytes(_b64(jwk['n']), 'big')).public_key()
        except (KeyError, TypeError, ValueError):
            continue
        if key.key_size >= 2048:
            keys[jwk['kid']] = key
    if not keys:
        logger.warning('erp_jwks_unavailable')
        raise ErpError('erp_unavailable')
    return keys


def _key(config, kid):
    """Clave del JWKS del emisor, en memoria: se pide una vez y no por cada token (C3)."""
    with _jwks_lock:
        fetched, keys = _jwks.get(config.jwks_url, (None, {}))
        if kid not in keys and (fetched is None or time.monotonic() - fetched > JWKS_RETRY_SECONDS):
            keys = _fetch_jwks(config)
            _jwks[config.jwks_url] = (time.monotonic(), keys)
    if kid not in keys:
        raise ErpError('erp_invalid')
    return keys[kid]


def _claims(config, token):
    """Firma RS256 con el JWKS del emisor, emisor exacto y caducidad futura."""
    try:
        header_part, payload_part, signature_part = token.split('.')
        header, claims = json.loads(_b64(header_part)), json.loads(_b64(payload_part))
        signature = _b64(signature_part)
    except (AttributeError, TypeError, ValueError):
        raise ErpError('erp_invalid') from None
    if (not isinstance(header, dict) or not isinstance(claims, dict) or header.get('alg') != 'RS256'
            or not isinstance(header.get('kid'), str)):
        raise ErpError('erp_invalid')
    try:
        _key(config, header['kid']).verify(signature, (header_part + '.' + payload_part).encode('ascii'),
                                           padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        raise ErpError('erp_invalid') from None
    expires = claims.get('exp')
    if (claims.get('iss') != config.issuer or type(expires) not in (int, float)
            or not math.isfinite(expires) or expires <= time.time()):
        raise ErpError('erp_invalid')
    return claims


def validate_id_token(config, id_token, nonce):
    """id_token del canje: firma, iss exacto, aud == client_id, token_use 'id', exp futuro y el
    nonce del intento comparado en tiempo constante (C3). Devuelve {sub, email}."""
    claims = _claims(config, id_token)
    sub, claimed, email = claims.get('sub'), claims.get('nonce'), claims.get('email')
    if (claims.get('aud') != config.client_id or claims.get('token_use') != 'id'
            or not isinstance(claimed, str) or not isinstance(nonce, str) or not nonce
            or not hmac.compare_digest(claimed.encode(), nonce.encode())
            or not isinstance(sub, str) or not 0 < len(sub) <= 128):
        raise ErpError('erp_invalid')
    return {'sub': sub, 'email': email if isinstance(email, str) and len(email) <= 320 else ''}


def check_access_token(config, access_token):
    """Access token: firma, iss, token_use 'access', client_id del cliente y el scope de lectura
    de espacios. Sin ese scope: ErpError('erp_denied'). Devuelve {sub, scope}."""
    claims = _claims(config, access_token)
    sub, scope = claims.get('sub'), claims.get('scope')
    if (claims.get('token_use') != 'access' or claims.get('client_id') != config.client_id
            or not isinstance(sub, str) or not 0 < len(sub) <= 128):
        raise ErpError('erp_invalid')
    if not isinstance(scope, str) or required_scope(config) not in scope.split():
        raise ErpError('erp_denied')
    return {'sub': sub, 'scope': scope}
