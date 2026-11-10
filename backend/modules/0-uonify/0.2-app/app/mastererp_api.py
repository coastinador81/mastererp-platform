"""Cliente de ERP · Finanzas de MasterERP DEV: servidor a servidor, solo lectura, con httpx.

Cada llamada lleva el access token de la conexión del usuario (Bearer) y, en Finanzas, el
inquilino en X-MasterERP-Tenant-Id y la empresa en company_id: todo sale de la credencial del
servidor (mastererp_types.ErpCredential), nunca del modelo ni del navegador. Solo GET, 8 s por
intento y un único reintento ante 503 o tiempo agotado. Cada fallo es un ErpError tipado y cada
respuesta se valida por su forma, como validSale de la pantalla de Ventas del equipo: si no
cuadra es 'erp_unavailable', nunca un éxito simulado. Logs: solo códigos fijos, sin token,
inquilino, empresa, ids ni valores de negocio (Consultor C8).

Contratos del equipo: GET {agent_api}/v1/uonify/spaces[?tenant_id] (Lambda heredada de
0-uonify) y GET {admin_api}/v1/administration/<colección>[/<id>]?company_id&limit&after, con q
solo en ventas (2.2.1-administration: shared/purchases.py, shared/parties.py y el handler de
ventas). Listas: {data: {items, next_cursor}}; errores: {error, correlation_id}.
"""
import logging
import random
import re
import time
from datetime import date

import httpx

from .mastererp_types import COLLECTIONS, ErpCredential, ErpError

logger = logging.getLogger(__name__)
TIMEOUT = 8.0  # Por intento: la Lambda corta a los 15 s y el turno de Uony dura 60 s.
MAX_LIMIT = 25  # Registros por página para Uony y las pantallas (la API admite hasta 100).
QUERY_CHARS = 120  # q de ventas (handler de ventas: máximo 120, sin caracteres de control).
MAX_BYTES = 4_000_000
RETRY_PAUSE = (0.2, 0.5)  # Segundos antes del único reintento, con variación.
PURCHASE_CLASSES = {'compras': 'solicitud_compra', 'ordenes': 'orden_compra', 'facturas': 'factura_proveedor'}
PARTY_KINDS = ('proveedores', 'clientes')
_UUID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
_DECIMAL = re.compile(r'-?[0-9]+(\.[0-9]+)?')
_UPSTREAM = re.compile(r'[a-z_]{1,48}')
_QUIET_HOSTS = set()


class _QuietRequests(logging.Filter):
    """httpx anota en INFO cada petición con su URL completa (company_id, after, q o tenant_id)
    y el worker de conversación registra INFO: esas líneas del ERP no llegan a los logs (C8)."""

    def filter(self, record):
        args = record.args if isinstance(record.args, tuple) else ()
        return not any(isinstance(arg, httpx.URL) and arg.host in _QUIET_HOSTS for arg in args)


logging.getLogger('httpx').addFilter(_QuietRequests())


def http_client() -> httpx.Client:
    """Cliente de cada llamada sin cliente propio (las pruebas lo sustituyen por uno falso)."""
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False)


def uuid_text(value) -> str | None:
    """UUID canónico en minúsculas, o None: valida lo que llega de la API y de la conexión."""
    return value.lower() if isinstance(value, str) and _UUID.fullmatch(value) else None


def credential_scope(credential: ErpCredential) -> tuple[str, str]:
    """Inquilino y empresa de la credencial, validados. Sin token: reconectar; sin espacio o
    empresa válidos: elegirlos."""
    token = getattr(credential, 'access_token', None)
    if not isinstance(token, str) or not token:
        raise ErpError('erp_reconnect')
    tenant = uuid_text(getattr(credential, 'tenant_id', None))
    company = uuid_text(getattr(credential, 'company_id', None))
    if tenant is None or company is None:
        raise ErpError('erp_selection_required')
    return tenant, company


def spaces(config, credential_or_token, tenant_id: str | None = None, *, client: httpx.Client | None = None) -> dict:
    """Espacios del usuario y, con tenant_id, su contexto:
    {'spaces': [{id, name}], 'context': {tenant_id, modules, permissions, companies: [{id, name}]} | None}.
    Admite la credencial o, al conectar, el access token recién canjeado. Sin cabecera de inquilino."""
    token = (credential_or_token if isinstance(credential_or_token, str)
             else getattr(credential_or_token, 'access_token', None))
    params = {}
    if tenant_id is not None:
        params['tenant_id'] = uuid_text(tenant_id)
        if params['tenant_id'] is None:
            raise ErpError('erp_invalid')
    body = _get(client, config.agent_api + '/v1/uonify/spaces', token, params, None, 'spaces')
    found, context = body.get('spaces'), body.get('context')
    if not _named(found) or tenant_id is not None and not _context(context, params['tenant_id']):
        raise _invalid('spaces')
    return {'spaces': _names(found), 'context': None if tenant_id is None else {
        'tenant_id': params['tenant_id'], 'modules': list(context['modules']),
        'permissions': list(context['permissions']), 'companies': _names(context['companies'])}}


def list_records(config, credential: ErpCredential, kind: str, after: str | None = None, limit: int = 10,
                 q: str | None = None, *, client: httpx.Client | None = None) -> dict:
    """Una página de la colección: {'items': [registros validados, tal cual], 'next_cursor': id | None}.
    `after` es el id interno que el servidor resolvió desde una referencia opaca; q solo en ventas."""
    collection, search = _collection(kind), _search(q)
    tenant, company = credential_scope(credential)
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ErpError('erp_invalid')
    if search and kind != 'ventas':
        raise ErpError('erp_invalid')  # Compras y terceros rechazan cualquier filtro en el servidor.
    params = {'company_id': company, 'limit': limit}
    if after is not None:
        params['after'] = uuid_text(after)
        if params['after'] is None:
            raise ErpError('erp_invalid')
    if search:
        params['q'] = search
    operation = 'list:' + kind
    body = _get(client, f'{config.admin_api}/v1/administration/{collection}', credential.access_token,
                params, tenant, operation)
    data = body.get('data')
    items = data.get('items') if isinstance(data, dict) else None
    cursor = data.get('next_cursor') if isinstance(data, dict) else None
    if (not isinstance(items, list) or len(items) > limit or 'next_cursor' not in data
            or cursor is not None and uuid_text(cursor) is None
            or not all(_valid(kind, item, company, False) for item in items)):
        raise _invalid(operation)
    return {'items': items, 'next_cursor': uuid_text(cursor)}


def get_record(config, credential: ErpCredential, kind: str, record_id: str, *,
               client: httpx.Client | None = None) -> dict:
    """La ficha de un registro de la empresa de la conexión, validada y tal cual."""
    collection = _collection(kind)
    tenant, company = credential_scope(credential)
    record = uuid_text(record_id)
    if record is None:
        raise ErpError('erp_invalid')
    operation = 'get:' + kind
    body = _get(client, f'{config.admin_api}/v1/administration/{collection}/{record}', credential.access_token,
                {'company_id': company}, tenant, operation)
    data = body.get('data')
    if not _valid(kind, data, company, True) or uuid_text(data.get('id')) != record:
        raise _invalid(operation)
    return data


def _collection(kind):
    if not isinstance(kind, str) or kind not in COLLECTIONS:
        raise ErpError('erp_invalid')
    return COLLECTIONS[kind]


def _search(q):
    """q de ventas: sin caracteres de control (la API los rechaza), espacios simples y 120 como máximo."""
    if q is None:
        return None
    if not isinstance(q, str):
        raise ErpError('erp_invalid')
    return ' '.join(''.join(c if c.isprintable() else ' ' for c in q).split())[:QUERY_CHARS].strip() or None


def _get(client, url, token, params, tenant, operation):
    """GET con un único reintento, solo ante 503 o tiempo agotado. Devuelve el cuerpo JSON (dict)."""
    if not isinstance(token, str) or not token:
        raise ErpError('erp_reconnect')
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    if tenant:
        headers['X-MasterERP-Tenant-Id'] = tenant
    _QUIET_HOSTS.add(httpx.URL(url).host)
    http = client if client is not None else http_client()
    try:
        for attempt in (1, 2):
            try:
                response = http.get(url, params=params, headers=headers, timeout=TIMEOUT, follow_redirects=False)
            except httpx.TimeoutException:
                if attempt == 1:
                    _pause(operation, 'timeout')
                    continue
                logger.warning('ERP API failure operation=%s reason=timeout code=erp_unavailable', operation)
                raise ErpError('erp_unavailable') from None
            except httpx.HTTPError:
                logger.warning('ERP API failure operation=%s reason=network code=erp_unavailable', operation)
                raise ErpError('erp_unavailable') from None
            if response.status_code == 503 and attempt == 1:
                _pause(operation, 'status_503')
                continue
            return _payload(response, operation)
    finally:
        if client is None:
            http.close()


def _pause(operation, reason):
    logger.warning('ERP API retry operation=%s reason=%s', operation, reason)
    time.sleep(random.uniform(*RETRY_PAUSE))


def _payload(response, operation):
    status = response.status_code
    if status != 200:
        code = _code(response)
        logger.warning('ERP API failure operation=%s status=%s upstream=%s code=%s',
                       operation, status, _upstream(response), code)
        raise ErpError(code)
    if len(response.content) > MAX_BYTES:
        raise _invalid(operation)
    try:
        body = response.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise _invalid(operation)
    return body


def _code(response):
    """401 → reconectar; 403 identity_not_linked → sin alta en el ERP; otros 403 → sin permiso;
    404 → no existe o no es visible; 400 → petición no válida; el resto → no disponible."""
    status = response.status_code
    if status == 401:
        return 'erp_reconnect'
    if status == 403:
        return 'erp_not_linked' if _upstream(response) == 'identity_not_linked' else 'erp_denied'
    return {400: 'erp_invalid', 404: 'erp_not_found'}.get(status, 'erp_unavailable')


def _upstream(response):
    """Código de error del equipo ({"error": ...}) solo si es un código fijo; si no, '-'."""
    try:
        code = response.json().get('error')
    except (ValueError, AttributeError):
        return '-'
    return code if isinstance(code, str) and _UPSTREAM.fullmatch(code) else '-'


def _invalid(operation):
    logger.warning('ERP API failure operation=%s reason=invalid_shape code=erp_unavailable', operation)
    return ErpError('erp_unavailable')


def _str(value):
    return isinstance(value, str)


def _amount(value):
    return isinstance(value, str) and _DECIMAL.fullmatch(value) is not None


def _day(value):
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _lines(lines, amounts):
    return isinstance(lines, list) and all(
        isinstance(line, dict) and _str(line.get('descripcion')) and all(_amount(line.get(key)) for key in amounts)
        for line in lines)


def _valid(kind, item, company, detail):
    """Forma mínima de cada registro (como validSale del equipo): lo que la web y Uony necesitan."""
    if not isinstance(item, dict) or uuid_text(item.get('id')) is None:
        return False
    if kind in PURCHASE_CLASSES:
        return (item.get('clase') == PURCHASE_CLASSES[kind] and uuid_text(item.get('company_id')) == company
                and _day(item.get('fecha')) and _str(item.get('moneda')) and _amount(item.get('total'))
                and _str(item.get('estado'))
                and (not detail or _lines(item.get('lineas'), ('cantidad', 'precio_unitario'))))
    if kind in PARTY_KINDS:
        return (uuid_text(item.get('company_id')) == company and _str(item.get('codigo'))
                and _str(item.get('nombre')))
    customer, order = item.get('cliente'), item.get('pedido')
    return (_amount(item.get('total')) and _str(item.get('moneda')) and type(item.get('decimales')) is int
            and isinstance(customer, dict) and _str(customer.get('nombre'))
            and isinstance(order, dict) and _str(order.get('numero')) and _day(item.get('fecha'))
            and (not detail or _lines(item.get('lineas'), ('cantidad', 'precio_unitario', 'total'))))


def _named(values):
    return isinstance(values, list) and all(
        isinstance(value, dict) and uuid_text(value.get('id')) is not None and _str(value.get('name'))
        for value in values)


def _names(values):
    return [{'id': uuid_text(value['id']), 'name': value['name']} for value in values]


def _context(context, tenant):
    return (isinstance(context, dict) and uuid_text(context.get('tenant_id')) == tenant
            and isinstance(context.get('modules'), list) and all(map(_str, context['modules']))
            and isinstance(context.get('permissions'), list) and all(map(_str, context['permissions']))
            and _named(context.get('companies')))
