"""Referencias opacas y proyecciones en lista blanca de ERP · Finanzas (regla anti-ingeniería
inversa del dueño): ni el modelo ni el navegador ven un UUID interno del ERP.

Cada registro que sale hacia el modelo o la web lleva una referencia por usuario: su número de
negocio legible (número, con la serie si la hay; el código en terceros) si es único en el lote y
está libre, o un manejador corto aleatorio como 'S-7K2Q'. El servidor la guarda en uony_erp_refs
(migración 143) con el inquilino, la empresa y 30 minutos de vida, que se renuevan cada vez que
el registro se vuelve a ver. resolve() solo la traduce para el mismo usuario y tipo, con el
inquilino y la empresa vigentes de la conexión y antes de caducar: no cruza de empresa ni de
cuenta. Una referencia viva nunca pasa a otro registro. Al escribir se purgan las caducadas.

Las proyecciones copian solo campos de negocio, sin id, company_id, proveedor_id, origen_id,
profile_id ni ningún otro UUID; importes como cadenas decimales tal cual y fechas ISO. Tampoco
copian contacto_ecommerce (la cuenta de un comprador de la tienda), versiones ni estados internos.
"""
import re
import secrets
from datetime import date, datetime
from uuid import UUID

from .mastererp_api import PARTY_KINDS, PURCHASE_CLASSES, credential_scope, uuid_text
from .mastererp_types import COLLECTIONS, ErpCredential, ErpError

TTL_MINUTES = 30
PURGE_BATCH = 500
REF = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,47}')
_HEXISH = re.compile(r'[0-9A-Fa-f-]{20,}')  # Nunca una referencia con forma de id interno.
_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'  # Sin 0/O, 1/I/L: se dicta y se copia sin dudas.
_HANDLE = {'compras': 'S', 'ordenes': 'O', 'facturas': 'F', 'proveedores': 'P', 'clientes': 'C', 'ventas': 'V'}
_DECIMAL = re.compile(r'-?[0-9]+(\.[0-9]+)?')
_UUID_TEXT = re.compile(r'\s*[0-9a-fA-F]{8}-?([0-9a-fA-F]{4}-?){3}[0-9a-fA-F]{12}\s*')


def remember(connection, user_id, credential: ErpCredential, kind: str, records: list) -> list[str]:
    """Referencia opaca de cada registro de la API, en el mismo orden (un id repetido, la misma).

    Reutiliza la viva del registro y prefiere su número legible; si ese número está libre,
    caducado o ya era suyo, lo toma; si lo tiene otro registro vivo, usa un manejador aleatorio.
    Serializa por usuario con un bloqueo de transacción (llamar en una transacción corta, sin
    esperar a la red dentro) y purga caducadas sin esperar a otras transacciones (SKIP LOCKED)."""
    _kind(kind)
    tenant, company = credential_scope(credential)
    ids = [uuid_text(record.get('id')) if isinstance(record, dict) else None for record in records]
    if None in ids:
        raise ErpError('erp_unavailable')
    if not ids:
        return []
    owner = str(user_id).lower()
    connection.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', ('uony_erp_refs:' + owner,))
    connection.execute('''DELETE FROM uony_erp_refs WHERE (user_id,ref) IN (SELECT user_id,ref FROM uony_erp_refs
        WHERE expires_at<=now() LIMIT %s FOR UPDATE SKIP LOCKED)''', (PURGE_BATCH,))
    unique = list(dict.fromkeys(ids))
    known = {}
    for row in connection.execute('''SELECT ref,record_id FROM uony_erp_refs WHERE user_id=%s AND kind=%s
            AND tenant_id=%s AND company_id=%s AND record_id=ANY(%s) AND expires_at>now() ORDER BY ref''',
            (owner, kind, tenant, company, [UUID(record) for record in unique])).fetchall():
        known.setdefault(str(row['record_id']), []).append(row['ref'])
    readable, chosen = _readable(kind, records, ids), {}
    for record in unique:
        alive, wanted = known.get(record, []), readable.get(record)
        if wanted and (wanted in alive or _claim(connection, owner, wanted, kind, record, tenant, company)):
            chosen[record] = wanted
        elif alive:
            chosen[record] = alive[0]
        else:
            chosen[record] = _handle(connection, owner, kind, record, tenant, company)
    renewed = [ref for refs in known.values() for ref in refs]  # Las vivas de cada registro visto.
    if renewed:
        connection.execute('''UPDATE uony_erp_refs SET expires_at=now()+make_interval(mins => %s)
            WHERE user_id=%s AND ref=ANY(%s) AND expires_at>now()''', (TTL_MINUTES, owner, renewed))
    return [chosen[record] for record in ids]


def remember_page(connection, user_id, credential: ErpCredential, kind: str,
                  page: dict) -> tuple[list[str], str | None]:
    """Referencias de una página de list_records y su cursor opaco. El cursor de la API es el id
    de su último registro; si no estuviera en la página, se guarda como uno más."""
    items, cursor = page['items'], page['next_cursor']
    ids = [uuid_text(item.get('id')) if isinstance(item, dict) else None for item in items]
    extra = [{'id': cursor}] if cursor is not None and cursor not in ids else []
    refs = remember(connection, user_id, credential, kind, items + extra)
    return refs[:len(items)], None if cursor is None else refs[(ids + [cursor]).index(cursor)]


def resolve(connection, user_id, credential: ErpCredential, kind: str, ref: str) -> str | None:
    """El id interno de una referencia, solo para este usuario y tipo, con el inquilino y la
    empresa vigentes de la conexión y antes de caducar; si no, None."""
    if not isinstance(kind, str) or kind not in COLLECTIONS or not isinstance(ref, str) or not REF.fullmatch(ref):
        return None
    tenant, company = credential_scope(credential)
    row = connection.execute('''SELECT record_id FROM uony_erp_refs WHERE user_id=%s AND ref=%s AND kind=%s
        AND tenant_id=%s AND company_id=%s AND expires_at>now()''',
        (str(user_id).lower(), ref, kind, tenant, company)).fetchone()
    return str(row['record_id']) if row else None


def project_item(kind: str, raw: dict) -> dict:
    """Campos de negocio de una fila de lista, sin UUID."""
    return _project(raw, _spec(kind)[0])


def project_record(kind: str, raw: dict) -> dict:
    """Campos de negocio de una ficha (con sus líneas en compras y ventas), sin UUID."""
    return _project(raw, _spec(kind)[1])


def _kind(kind):
    if not isinstance(kind, str) or kind not in COLLECTIONS:
        raise ErpError('erp_invalid')
    return kind


def _claim(connection, owner, ref, kind, record, tenant, company):
    """Guarda ref → registro si la referencia está libre, caducada o ya era de ese registro."""
    return connection.execute('''INSERT INTO uony_erp_refs(user_id,ref,kind,record_id,tenant_id,company_id,expires_at)
        VALUES(%s,%s,%s,%s,%s,%s,now()+make_interval(mins => %s))
        ON CONFLICT (user_id,ref) DO UPDATE SET kind=EXCLUDED.kind,record_id=EXCLUDED.record_id,
            tenant_id=EXCLUDED.tenant_id,company_id=EXCLUDED.company_id,expires_at=EXCLUDED.expires_at
        WHERE uony_erp_refs.expires_at<=now() OR (uony_erp_refs.kind,uony_erp_refs.record_id,
            uony_erp_refs.tenant_id,uony_erp_refs.company_id)=(EXCLUDED.kind,EXCLUDED.record_id,
            EXCLUDED.tenant_id,EXCLUDED.company_id)
        RETURNING ref''', (owner, ref, kind, record, tenant, company, TTL_MINUTES)).fetchone() is not None


def _handle(connection, owner, kind, record, tenant, company):
    for _ in range(8):
        ref = _HANDLE[kind] + '-' + ''.join(secrets.choice(_ALPHABET) for _ in range(4))
        if _claim(connection, owner, ref, kind, record, tenant, company):
            return ref
    raise ErpError('erp_unavailable')


def _readable(kind, records, ids):
    """Número de negocio legible por registro, solo si en el lote no lo comparte con otro."""
    owners = {}
    for record, raw in zip(ids, records):
        text = _number(kind, raw)
        if text:
            owners.setdefault(text, set()).add(record)
    return {next(iter(found)): text for text, found in owners.items() if len(found) == 1}


def _number(kind, raw):
    if kind in PARTY_KINDS:
        text = raw.get('codigo')
    else:
        text = raw.get('numero')
        serie = raw.get('serie') if kind in PURCHASE_CLASSES else None  # Ventas no tiene serie.
        if isinstance(text, str) and isinstance(serie, str) and serie.strip():
            text = serie.strip() + '-' + text
    if not isinstance(text, str):
        return None
    text = re.sub(r'[^A-Za-z0-9._-]+', '-', text.strip()).strip('-._')
    return text if REF.fullmatch(text) and not _HEXISH.fullmatch(text) else None


def _text(value):
    return value if isinstance(value, str) and not _UUID_TEXT.fullmatch(value) else None


def _present(value):
    return _text(value) or None


def _amount(value):
    return value if isinstance(value, str) and _DECIMAL.fullmatch(value) else None


def _day(value):
    try:
        return date.fromisoformat(value).isoformat() if isinstance(value, str) and len(value) == 10 else None
    except ValueError:
        return None


def _instant(value):
    try:
        return datetime.fromisoformat(value).isoformat() if isinstance(value, str) else None
    except ValueError:
        return None


def _flag(value):
    return value if isinstance(value, bool) else None


def _whole(value):
    return value if type(value) is int else None


def _labels(value):
    return [item for item in value if _text(item)] if isinstance(value, list) else None


def _project(raw, spec):
    """Copia solo lo que nombra la especificación: campo → tipo, {objeto} o [objeto de una lista]."""
    out = {}
    for key, kind in spec.items():
        value = raw.get(key) if isinstance(raw, dict) else None
        if isinstance(kind, dict):
            out[key] = _project(value, kind) if isinstance(value, dict) else None
        elif isinstance(kind, list):
            listed = isinstance(value, list)
            out[key] = [_project(item, kind[0]) for item in value if isinstance(item, dict)] if listed else None
        else:
            out[key] = kind(value)
    return out


# Lista blanca por tipo: (fila de lista, ficha). Nombres de campo de la API del equipo.
_PURCHASE = {'numero': _text, 'serie': _present, 'fecha': _day, 'proveedor': _text, 'moneda': _text,
             'total': _amount, 'estado': _text}
_PURCHASE_FULL = {**_PURCHASE, 'moneda_base': _text, 'total_base': _amount, 'tipo_cambio': _amount,
                  'cambio_fecha': _day, 'cambio_fuente': _text, 'editable': _flag,
                  'lineas': [{'descripcion': _text, 'cantidad': _amount, 'precio_unitario': _amount,
                              'total': _amount}]}
_GENERAL = dict.fromkeys(('nombre_comercial', 'tipo_persona', 'pais_fiscal', 'tipo_identificacion',
                          'numero_identificacion', 'direccion', 'direccion_complementaria', 'ciudad', 'municipio',
                          'region', 'codigo_postal', 'pais', 'email', 'telefono', 'telefono_alterno', 'sitio_web',
                          'observaciones'), _text)
_TERMS = dict.fromkeys(('moneda', 'tipo_suministro', 'condicion_pago', 'medio_pago', 'plazo_pago_dias',
                        'descuento_pronto_pago', 'plazo_pronto_pago_dias'), _text)
_PARTY = {'codigo': _text, 'nombre': _text, 'datos_generales': {
    key: _text for key in ('nombre_comercial', 'numero_identificacion', 'email', 'telefono')}}
_PARTY_FULL = {'codigo': _text, 'nombre': _text, 'origen': _text, 'roles': _labels, 'datos_generales': _GENERAL,
               'contactos': [{'nombre': _text, 'cargo': _text, 'email': _text, 'telefono': _text,
                              'principal': _flag}], 'condiciones': _TERMS}
_SALE = {'numero': _text, 'fecha': _day, 'estado': _text, 'origen': _text,
         'cliente': {'codigo': _text, 'nombre': _text}, 'pedido': {'numero': _text}, 'moneda': _text,
         'decimales': _whole, 'total': _amount, 'moneda_base': _text, 'total_base': _amount}
_SALE_FULL = {**_SALE, 'creado_en': _instant, 'decimales_base': _whole, 'tipo_cambio': _amount,
              'cambio_fecha': _day, 'cambio_fuente': _text,
              'lineas': [{'posicion': _whole, 'descripcion': _text, 'cantidad': _amount, 'precio_unitario': _amount,
                          'subtotal': _amount, 'descuento': _amount, 'recargo': _amount, 'tributos': _amount,
                          'total': _amount}]}
_SPECS = {**dict.fromkeys(PURCHASE_CLASSES, (_PURCHASE, _PURCHASE_FULL)),
          **dict.fromkeys(PARTY_KINDS, (_PARTY, _PARTY_FULL)), 'ventas': (_SALE, _SALE_FULL)}


def _spec(kind):
    return _SPECS[_kind(kind)]
