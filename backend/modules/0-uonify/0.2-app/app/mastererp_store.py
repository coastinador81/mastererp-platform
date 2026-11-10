"""Custodia de la conexión con ERP · Finanzas, como la de Drive (Consultor C4): el refresh se guarda
cifrado con Fernet y la MISMA settings.encryption_key de Drive; el access token vive solo en la
memoria del servidor, como mucho 240 s, con clave (usuario, sha256(refresh_encrypted)), y nunca se
persiste ni llega a la web, al modelo, a la sesión ADK ni a los logs (C8). La huella de la conexión
(sha256 de refresh_encrypted) se recomprueba al cerrar el turno."""
import hashlib
import logging
import threading
from time import monotonic
from cryptography.fernet import Fernet, InvalidToken
from .mastererp_config import load_mastererp_config
from .mastererp_types import ErpCredential, ErpError
from . import mastererp_cognito as cognito

logger = logging.getLogger(__name__)
TOKEN_SECONDS = 240
_tokens = {}  # (user_id, huella) -> (monotonic de caducidad, access token)
_lock = threading.Lock()


def refresh_fingerprint(refresh_encrypted):
    return hashlib.sha256(refresh_encrypted.encode()).hexdigest()


def opaque(value):
    """Referencia opaca para logs (C8): nunca el id."""
    return hashlib.sha256(str(value).encode()).hexdigest()[:16]


def load(connection, user_id):
    return connection.execute('SELECT * FROM erp_connections WHERE user_id=%s', (user_id,)).fetchone()


def forget(user_id):
    """Olvida los access tokens en memoria de un usuario."""
    with _lock:
        for key in [key for key in _tokens if key[0] == str(user_id)]:
            del _tokens[key]


def mark(database, user_id, status, fingerprint=None):
    """Una conexión 'connected' pasa a 'reauthorize' (401 o invalid_grant) o a 'not_linked'
    (403 identity_not_linked). Con huella, solo si sigue siendo esa credencial: una reconexión
    posterior nunca se pisa."""
    if status not in ('reauthorize', 'not_linked'):
        raise ValueError('estado no admitido')
    with database.connect() as connection:
        row = connection.execute('''SELECT refresh_encrypted FROM erp_connections
            WHERE user_id=%s AND status='connected' FOR UPDATE''', (user_id,)).fetchone()
        if row and (fingerprint is None or refresh_fingerprint(row['refresh_encrypted']) == fingerprint):
            connection.execute('UPDATE erp_connections SET status=%s WHERE user_id=%s', (status, user_id))
    forget(user_id)


def _require(row, config):
    if row is None or row['issuer'] != config.issuer:
        raise ErpError('erp_reconnect')
    if row['status'] == 'not_linked':
        raise ErpError('erp_not_linked')
    if row['status'] != 'connected':
        raise ErpError('erp_reconnect')


def _access(database, cipher, config, user_id, row):
    """(access token, huella vigente) de la fila leída: de la memoria o refrescado en Cognito."""
    current = refresh_fingerprint(row['refresh_encrypted'])
    with _lock:
        cached = _tokens.get((str(user_id), current))
    if cached and cached[0] > monotonic():
        return cached[1], current
    try:
        refresh_token = cipher.decrypt(row['refresh_encrypted'].encode()).decode()
        access, expires_in, rotated = cognito.refresh(config, refresh_token)
    except (InvalidToken, ErpError) as error:
        code = error.code if isinstance(error, ErpError) else 'erp_reconnect'
        if code == 'erp_reconnect':
            mark(database, user_id, 'reauthorize', current)
        logger.warning('erp_refresh_failed ref=%s code=%s', opaque(user_id), code)
        raise ErpError(code) from None
    with database.connect() as connection:
        if rotated:
            # Cognito ha rotado el refresh: se guarda el nuevo cifrado si la conexión sigue igual.
            saved = connection.execute('''UPDATE erp_connections SET refresh_encrypted=%s, refreshed_at=now()
                WHERE user_id=%s AND refresh_encrypted=%s AND status='connected' RETURNING refresh_encrypted''',
                (cipher.encrypt(rotated.encode()).decode(), user_id, row['refresh_encrypted'])).fetchone()
        else:
            saved = connection.execute('''UPDATE erp_connections SET refreshed_at=now()
                WHERE user_id=%s AND refresh_encrypted=%s AND status='connected' RETURNING refresh_encrypted''',
                (user_id, row['refresh_encrypted'])).fetchone()
    if not saved:
        raise ErpError('erp_changed')
    current = refresh_fingerprint(saved['refresh_encrypted'])
    seconds = min(TOKEN_SECONDS, expires_in - 60)
    if seconds > 0:
        with _lock:
            if len(_tokens) >= 256:
                _tokens.clear()
            _tokens[(str(user_id), current)] = (monotonic() + seconds, access)
    return access, current


def access_token(database, settings, user_id, *, config=None):
    """(access token, huella) de una conexión 'connected', sin exigir espacio ni empresa: sirve
    para elegirlos. Lanza ErpError('erp_reconnect' | 'erp_not_linked' | 'erp_unavailable' |
    'erp_changed')."""
    config = config or load_mastererp_config()
    with database.connect() as connection:
        row = load(connection, user_id)
    _require(row, config)
    return _access(database, Fernet(settings.encryption_key), config, user_id, row)


def credential_provider(database, settings, user_id, *, config=None):
    """CredentialProvider ligado a un usuario: el token llega a las herramientas por closure, nunca
    por el estado de ADK ni por argumentos del modelo. Cada llamada relee la conexión; además de los
    errores de access_token, lanza ErpError('erp_selection_required') sin espacio o sin empresa.
    Si Cognito rota el refresh, la huella cambia: al cerrar el turno se compara la de la última
    credencial obtenida con connection_fingerprint()."""
    config = config or load_mastererp_config()
    cipher = Fernet(settings.encryption_key)

    def credential():
        with database.connect() as connection:
            row = load(connection, user_id)
        _require(row, config)
        if not row['tenant_id'] or not row['company_id']:
            raise ErpError('erp_selection_required')
        token, current = _access(database, cipher, config, user_id, row)
        return ErpCredential(access_token=token, tenant_id=str(row['tenant_id']),
                             company_id=str(row['company_id']), fingerprint=current)
    return credential


def connection_fingerprint(database, user_id):
    """Huella de la conexión vigente ('connected'), o None: se compara al cerrar el turno (C4)."""
    with database.connect() as connection:
        row = connection.execute('SELECT refresh_encrypted,status FROM erp_connections WHERE user_id=%s',
                                 (user_id,)).fetchone()
    return refresh_fingerprint(row['refresh_encrypted']) if row and row['status'] == 'connected' else None


def _drop_refs(connection, user_id, tenant_id, company_id):
    """Las referencias opacas solo valen en el espacio y la empresa en los que se emitieron."""
    connection.execute('''DELETE FROM uony_erp_refs WHERE user_id=%s
        AND NOT (tenant_id IS NOT DISTINCT FROM %s AND company_id IS NOT DISTINCT FROM %s)''',
        (user_id, tenant_id, company_id))


def save(connection, user_id, issuer, identity, refresh_encrypted, scope, status, tenant_id, company_id):
    """Guarda la conexión con la regla de cuenta: el sub de Cognito se fija en la primera conexión;
    otra cuenta deja 'account_mismatch' sin tocar la credencial guardada (desconectar para cambiar).
    Devuelve el estado resultante."""
    if status not in ('connected', 'not_linked'):
        raise ValueError('estado no admitido')
    current = connection.execute('SELECT issuer,cognito_sub FROM erp_connections WHERE user_id=%s FOR UPDATE',
                                 (user_id,)).fetchone()
    forget(user_id)
    if current and (current['issuer'], current['cognito_sub']) != (issuer, identity['sub']):
        connection.execute("UPDATE erp_connections SET status='account_mismatch' WHERE user_id=%s", (user_id,))
        return 'account_mismatch'
    if status != 'connected':
        tenant_id = company_id = None
    connection.execute('''INSERT INTO erp_connections(user_id,issuer,cognito_sub,email,refresh_encrypted,scope,
            status,tenant_id,company_id,connected_at,refreshed_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now()) ON CONFLICT(user_id) DO UPDATE SET
            email=EXCLUDED.email,refresh_encrypted=EXCLUDED.refresh_encrypted,scope=EXCLUDED.scope,
            status=EXCLUDED.status,tenant_id=EXCLUDED.tenant_id,company_id=EXCLUDED.company_id,
            connected_at=now(),refreshed_at=now()''',
        (user_id, issuer, identity['sub'], identity['email'], refresh_encrypted, scope, status,
         tenant_id, company_id))
    _drop_refs(connection, user_id, tenant_id, company_id)
    return status


def select(connection, user_id, issuer, sub, tenant_id, company_id):
    """Guarda espacio y empresa ya comprobados en el ERP con la misma identidad. Solo ids."""
    updated = connection.execute('''UPDATE erp_connections SET tenant_id=%s, company_id=%s
        WHERE user_id=%s AND status='connected' AND issuer=%s AND cognito_sub=%s RETURNING user_id''',
        (tenant_id, company_id, user_id, issuer, sub)).fetchone()
    if updated:
        _drop_refs(connection, user_id, tenant_id, company_id)
    return bool(updated)


def remove(connection, user_id):
    """Borra la conexión, sus referencias, intentos y ventanas. Devuelve el refresh cifrado (para
    revocarlo en Cognito después de confirmar el borrado) o None."""
    row = connection.execute('DELETE FROM erp_connections WHERE user_id=%s RETURNING refresh_encrypted',
                             (user_id,)).fetchone()
    connection.execute('DELETE FROM uony_erp_refs WHERE user_id=%s', (user_id,))
    connection.execute('DELETE FROM erp_oauth_attempts WHERE user_id=%s', (user_id,))
    connection.execute('DELETE FROM erp_popup_flows WHERE user_id=%s', (user_id,))
    forget(user_id)
    return row['refresh_encrypted'] if row else None


def public_status(connection, user, listing=None):
    """Estado para la web, sin tokens, sub ni huellas: solo los ids que necesita para elegir
    espacio y empresa. listing = {spaces, companies} leídos en el ERP por el servidor (o None)."""
    row = load(connection, user['id'])
    if not row:
        return {'status': 'disconnected'}
    listing = listing or {}
    return {'status': row['status'], 'email': row['email'],
            'spaces': list(listing.get('spaces', ())),
            'tenantId': str(row['tenant_id']) if row['tenant_id'] else None,
            'companies': list(listing.get('companies', ())),
            'companyId': str(row['company_id']) if row['company_id'] else None,
            **({'modules': list(listing['modules']), 'permissions': list(listing['permissions'])}
               if 'modules' in listing and 'permissions' in listing else {})}
