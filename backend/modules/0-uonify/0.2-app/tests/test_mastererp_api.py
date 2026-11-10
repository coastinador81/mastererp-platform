"""Cliente de ERP · Finanzas contra una API falsa (httpx.MockTransport): nunca la API real."""
import json
import logging
import re
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import pytest

from app import mastererp_api as api
from app.mastererp_api import get_record, list_records, spaces
from app.mastererp_config import load_mastererp_config
from app.mastererp_refs import project_item, project_record
from app.mastererp_types import ErpCredential, ErpError

CONFIG = load_mastererp_config()
TOKEN = 'erp-access-fixture-only'
TENANT, COMPANY = str(uuid4()), str(uuid4())
CREDENTIAL = ErpCredential(TOKEN, TENANT, COMPANY, 'fingerprint-fixture')
UUID_TEXT = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')


@pytest.fixture(autouse=True)
def no_pause(monkeypatch):
    monkeypatch.setattr(api, 'RETRY_PAUSE', (0, 0))


class Api:
    """API falsa: contesta en orden (la última respuesta se repite) y anota cada petición."""

    def __init__(self, *answers):
        self.answers, self.requests = list(answers), []

    def __call__(self, request):
        self.requests.append(request)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        status, body = answer
        if isinstance(body, bytes):
            return httpx.Response(status, content=body)
        return httpx.Response(status, json=body)

    def client(self):
        return httpx.Client(transport=httpx.MockTransport(self))


def page(*items, cursor=None):
    return 200, {'data': {'items': list(items), 'next_cursor': cursor}, 'correlation_id': str(uuid4())}


def one(item):
    return 200, {'data': item, 'correlation_id': str(uuid4())}


def purchase(kind='compras', **extra):
    return {'id': str(uuid4()), 'company_id': COMPANY, 'version': 3, 'clase': api.PURCHASE_CLASSES[kind],
            'fecha': '2026-11-02', 'numero': '0007', 'serie': '', 'proveedor_id': str(uuid4()),
            'proveedor': 'Papelería Norte', 'origen_id': str(uuid4()), 'moneda': 'EUR', 'moneda_base': 'EUR',
            'tipo_cambio': '1.000000', 'cambio_fecha': '2026-11-02', 'cambio_fuente': 'manual',
            'total': '1250.50', 'total_base': '1250.50', 'estado': 'borrador', 'editable': True,
            'lineas': None, **extra}


def purchase_lines():
    return [{'descripcion': 'Folios A4', 'cantidad': '10.000', 'precio_unitario': '125.05', 'total': '1250.50'}]


def party(**extra):
    return {'id': str(uuid4()), 'profile_id': str(uuid4()), 'company_id': COMPANY, 'codigo': 'PROV-001',
            'nombre': 'Papelería Norte S.L.', 'version': 2, 'profile_version': 1, 'catalog_version': 4,
            'catalog_status': 'activo', 'origen': 'sin_canal_identificado', 'roles': ['proveedor', 'cliente'],
            'datos_generales': {'nombre_comercial': 'Papelería Norte', 'numero_identificacion': 'B00000000',
                                'email': 'compras@example.test', 'telefono': '+34 600 000 000', 'pais': 'ES',
                                'observaciones': 'Entrega por la mañana'},
            'contactos': [{'nombre': 'Ana', 'cargo': 'Compras', 'email': 'ana@example.test',
                           'telefono': '600000001', 'principal': True}],
            'condiciones': {'moneda': 'EUR', 'condicion_pago': 'credito', 'plazo_pago_dias': '30'},
            'contacto_ecommerce': {'telefono': '611111111', 'email': 'comprador@example.test'}, **extra}


def sale(**extra):
    return {'id': str(uuid4()), 'numero': 'V-2026-0001', 'fecha': '2026-11-03',
            'creado_en': '2026-11-03T10:15:00.123456+00:00', 'estado': 'ACTIVE', 'origen': 'ecommerce',
            'version': 1, 'cliente': {'id': str(uuid4()), 'codigo': 'CLI-9', 'nombre': 'Cliente Demo'},
            'pedido': {'id': str(uuid4()), 'numero': 'P-77'}, 'moneda': 'EUR', 'decimales': 2, 'total': '59.90',
            'moneda_base': 'EUR', 'decimales_base': 2, 'total_base': '59.90', 'tipo_cambio': '1',
            'cambio_fecha': '2026-11-03', 'cambio_fuente': 'fija', **extra}


def sale_lines():
    return [{'posicion': 1, 'producto_id': str(uuid4()), 'descripcion': 'Taza', 'cantidad': '2',
             'precio_unitario': '29.95', 'subtotal': '59.90', 'descuento': '0', 'recargo': '0',
             'tributos': '0', 'total': '59.90'}]


def code_of(call):
    with pytest.raises(ErpError) as caught:
        call()
    return caught.value.code


def test_list_sends_the_server_scope_and_returns_a_validated_page():
    first, second, after = purchase(), purchase(numero='0008'), str(uuid4()).upper()
    fake = Api(page(first, second, cursor=second['id']))
    result = list_records(CONFIG, CREDENTIAL, 'compras', after=after, limit=2, client=fake.client())
    request, = fake.requests
    assert request.method == 'GET' and request.url.host == urlsplit(CONFIG.admin_api).hostname
    assert request.url.path == '/v1/administration/compras/solicitudes'
    assert dict(request.url.params) == {'company_id': COMPANY, 'limit': '2', 'after': after.lower()}
    assert request.headers['authorization'] == 'Bearer ' + TOKEN
    assert request.headers['x-mastererp-tenant-id'] == TENANT
    assert result == {'items': [first, second], 'next_cursor': second['id']}
    for kind, path in (('ordenes', 'compras/ordenes'), ('facturas', 'compras/facturas'),
                       ('proveedores', 'proveedores'), ('clientes', 'clientes'), ('ventas', 'ventas')):
        item = purchase(kind) if kind in api.PURCHASE_CLASSES else sale() if kind == 'ventas' else party()
        fake = Api(page(item))
        assert list_records(CONFIG, CREDENTIAL, kind, client=fake.client())['items'] == [item]
        assert fake.requests[0].url.path == '/v1/administration/' + path
        assert dict(fake.requests[0].url.params) == {'company_id': COMPANY, 'limit': '10'}


def test_get_record_checks_the_requested_record_and_its_lines():
    record = purchase('ordenes', lineas=purchase_lines())
    fake = Api(one(record))
    assert get_record(CONFIG, CREDENTIAL, 'ordenes', record['id'].upper(), client=fake.client()) == record
    request, = fake.requests
    assert request.url.path == '/v1/administration/compras/ordenes/' + record['id']
    assert dict(request.url.params) == {'company_id': COMPANY}
    assert code_of(lambda: get_record(CONFIG, CREDENTIAL, 'ordenes', str(uuid4()),
                                      client=Api(one(record)).client())) == 'erp_unavailable'
    assert code_of(lambda: get_record(CONFIG, CREDENTIAL, 'ordenes', record['id'],
                                      client=Api(one({**record, 'lineas': None})).client())) == 'erp_unavailable'
    detail = sale(lineas=sale_lines())
    assert get_record(CONFIG, CREDENTIAL, 'ventas', detail['id'], client=Api(one(detail)).client()) == detail


def test_q_only_reaches_sales_without_control_characters_and_at_most_120():
    fake = Api(page(sale()))
    list_records(CONFIG, CREDENTIAL, 'ventas', q=' taza\n  roja\t' + 'x' * 200, client=fake.client())
    sent = fake.requests[0].url.params['q']
    assert sent == ('taza roja ' + 'x' * 200)[:120] and len(sent) == 120
    fake = Api(page(purchase()))
    for kind in ('compras', 'ordenes', 'facturas', 'proveedores', 'clientes'):
        assert code_of(lambda: list_records(CONFIG, CREDENTIAL, kind, q='papel', client=fake.client())) == 'erp_invalid'
    assert fake.requests == []
    list_records(CONFIG, CREDENTIAL, 'compras', q=' \n ', client=fake.client())
    assert 'q' not in fake.requests[0].url.params


@pytest.mark.parametrize('status,body,code', [
    (401, {'error': 'invalid_identity', 'correlation_id': 'c'}, 'erp_reconnect'),
    (401, {'message': 'Unauthorized'}, 'erp_reconnect'),
    (403, {'error': 'identity_not_linked', 'correlation_id': 'c'}, 'erp_not_linked'),
    (403, {'error': 'access_denied', 'correlation_id': 'c'}, 'erp_denied'),
    (403, {'error': 'api_scope_required', 'correlation_id': 'c'}, 'erp_denied'),
    (403, {'message': 'Forbidden'}, 'erp_denied'),
    (404, {'error': 'not_found', 'correlation_id': 'c'}, 'erp_not_found'),
    (400, {'error': 'invalid_request', 'correlation_id': 'c'}, 'erp_invalid'),
    (409, {'error': 'stale_version', 'correlation_id': 'c'}, 'erp_unavailable'),
    (429, {'message': 'Too Many Requests'}, 'erp_unavailable'),
    (500, {'message': 'Internal Server Error'}, 'erp_unavailable'),
    (502, b'<html>bad gateway</html>', 'erp_unavailable'),
    (504, {'message': 'Gateway Timeout'}, 'erp_unavailable'),
])
def test_http_errors_are_typed_and_never_retried(status, body, code):
    fake = Api((status, body))
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'proveedores', client=fake.client())) == code
    assert len(fake.requests) == 1


def test_a_single_retry_only_on_503_or_timeout():
    item = party()
    timeout = lambda: httpx.ReadTimeout('lenta', request=None)
    fake = Api((503, {'error': 'service_unavailable'}), page(item))
    assert list_records(CONFIG, CREDENTIAL, 'proveedores', client=fake.client())['items'] == [item]
    assert len(fake.requests) == 2
    fake = Api((503, {'error': 'service_unavailable'}))
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'proveedores', client=fake.client())) == 'erp_unavailable'
    assert len(fake.requests) == 2
    fake = Api(timeout(), page(item))
    assert list_records(CONFIG, CREDENTIAL, 'proveedores', client=fake.client())['items'] == [item]
    assert len(fake.requests) == 2
    fake = Api(timeout(), timeout(), page(item))
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'proveedores', client=fake.client())) == 'erp_unavailable'
    assert len(fake.requests) == 2
    fake = Api(httpx.ConnectError('rechazada', request=None), page(item))
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'proveedores', client=fake.client())) == 'erp_unavailable'
    assert len(fake.requests) == 1
    fake = Api((401, {'message': 'Unauthorized'}), page(item))
    assert code_of(lambda: spaces(CONFIG, TOKEN, client=fake.client())) == 'erp_reconnect'
    assert len(fake.requests) == 1


@pytest.mark.parametrize('answer', [
    (200, b'no es json'),
    (200, {'data': []}),
    (200, {'data': {'items': {}, 'next_cursor': None}}),
    (200, {'data': {'items': []}}),
    page(cursor='siguiente'),
    page(purchase(total=1250.5)),
    page(purchase(company_id=str(uuid4()))),
    page(purchase('ordenes')),
    page(purchase(fecha='02/11/2026')),
    page(purchase(id='0007')),
    page(purchase(), purchase(), purchase()),
])
def test_unexpected_shapes_are_unavailable_never_a_simulated_success(answer):
    fake = Api(answer)
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'compras', limit=2, client=fake.client())) == 'erp_unavailable'


@pytest.mark.parametrize('kind,item', [
    ('ventas', {k: v for k, v in sale().items() if k != 'pedido'}),
    ('ventas', sale(decimales='2')),
    ('ventas', sale(cliente=None)),
    ('proveedores', party(codigo=None)),
    ('clientes', party(company_id=None)),
])
def test_sales_and_parties_need_their_essential_fields(kind, item):
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, kind, client=Api(page(item)).client())) == 'erp_unavailable'


def test_arguments_are_checked_before_calling_the_api():
    fake = Api(page())
    for limit in (0, 26, '10', True, None):
        assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'compras', limit=limit, client=fake.client())) == 'erp_invalid'
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'pedidos', client=fake.client())) == 'erp_invalid'
    assert code_of(lambda: list_records(CONFIG, CREDENTIAL, 'compras', after='0007', client=fake.client())) == 'erp_invalid'
    assert code_of(lambda: get_record(CONFIG, CREDENTIAL, 'compras', '../ventas', client=fake.client())) == 'erp_invalid'
    assert code_of(lambda: list_records(CONFIG, ErpCredential(TOKEN, TENANT, '', 'f'), 'compras',
                                        client=fake.client())) == 'erp_selection_required'
    assert code_of(lambda: list_records(CONFIG, ErpCredential('', TENANT, COMPANY, 'f'), 'compras',
                                        client=fake.client())) == 'erp_reconnect'
    assert code_of(lambda: spaces(CONFIG, None, client=fake.client())) == 'erp_reconnect'
    assert code_of(lambda: spaces(CONFIG, TOKEN, 'espacio', client=fake.client())) == 'erp_invalid'
    assert fake.requests == []
    assert list_records(CONFIG, CREDENTIAL, 'compras', limit=25, client=fake.client()) == {'items': [], 'next_cursor': None}


def test_spaces_with_the_token_or_the_credential_and_a_validated_context():
    other = {'id': str(uuid4()), 'name': 'Otro espacio'}
    fake = Api((200, {'spaces': [{'id': TENANT.upper(), 'name': 'Tu espacio'}, other]}))
    assert spaces(CONFIG, TOKEN, client=fake.client()) == {
        'spaces': [{'id': TENANT, 'name': 'Tu espacio'}, other], 'context': None}
    request, = fake.requests
    assert request.url.host == urlsplit(CONFIG.agent_api).hostname and request.url.path == '/v1/uonify/spaces'
    assert dict(request.url.params) == {} and 'x-mastererp-tenant-id' not in request.headers
    assert request.headers['authorization'] == 'Bearer ' + TOKEN
    context = {'tenant_id': TENANT, 'modules': ['erp.finance'], 'permissions': ['administration.purchases.read'],
               'companies': [{'id': COMPANY, 'name': 'Empresa Demo'}]}
    fake = Api((200, {'spaces': [{'id': TENANT, 'name': 'Tu espacio'}], 'context': context}))
    assert spaces(CONFIG, CREDENTIAL, TENANT, client=fake.client())['context'] == context
    assert dict(fake.requests[0].url.params) == {'tenant_id': TENANT}
    for broken in ({**context, 'tenant_id': str(uuid4())}, {**context, 'modules': None},
                   {**context, 'companies': [{'id': 'empresa', 'name': 'Empresa Demo'}]}, None):
        fake = Api((200, {'spaces': [], 'context': broken}))
        assert code_of(lambda: spaces(CONFIG, CREDENTIAL, TENANT, client=fake.client())) == 'erp_unavailable'
    fake = Api((403, {'error': 'identity_not_linked'}))
    assert code_of(lambda: spaces(CONFIG, TOKEN, client=fake.client())) == 'erp_not_linked'


def test_logs_carry_fixed_codes_only_and_hide_erp_request_lines(caplog):
    caplog.set_level(logging.DEBUG)
    item, after = purchase(numero='SECRETO-1'), str(uuid4())
    list_records(CONFIG, CREDENTIAL, 'compras', after=after, client=Api(page(item)).client())
    list_records(CONFIG, CREDENTIAL, 'ventas', q='cliente confidencial', client=Api(page(sale())).client())
    for answer in ((503, {'error': 'service_unavailable'}), (403, {'error': 'identity_not_linked'})):
        with pytest.raises(ErpError):
            get_record(CONFIG, CREDENTIAL, 'compras', item['id'], client=Api(answer).client())
    text = '\n'.join(record.getMessage() for record in caplog.records)
    for secret in (TOKEN, TENANT, COMPANY, after, item['id'], 'SECRETO', 'confidencial', 'Papelería',
                   urlsplit(CONFIG.admin_api).hostname):
        assert secret not in text
    assert not UUID_TEXT.search(text)
    assert 'ERP API retry operation=get:compras reason=status_503' in text
    assert 'operation=get:compras status=403 upstream=identity_not_linked code=erp_not_linked' in text
    # El filtro solo calla las peticiones al ERP: httpx sigue anotando las de otros destinos.
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(204))) as other:
        other.get('https://example.test/otra')
    assert any('https://example.test/otra' in record.getMessage() for record in caplog.records)


def test_projections_are_business_fields_without_uuid_or_token():
    projected = {
        'compras': (project_item('compras', purchase()), project_record('compras', purchase(lineas=purchase_lines()))),
        'proveedores': (project_item('proveedores', party()), project_record('proveedores', party())),
        'ventas': (project_item('ventas', sale()), project_record('ventas', sale(lineas=sale_lines()))),
    }
    text = json.dumps(projected, ensure_ascii=False)
    assert not UUID_TEXT.search(text) and TOKEN not in text
    for hidden in ('company_id', 'proveedor_id', 'origen_id', 'profile_id', 'producto_id', 'version',
                   'contacto_ecommerce', 'comprador@example.test', 'catalog_status', '"id"', 'clase'):
        assert hidden not in text
    item, record = projected['compras']
    assert item == {'numero': '0007', 'serie': None, 'fecha': '2026-11-02', 'proveedor': 'Papelería Norte',
                    'moneda': 'EUR', 'total': '1250.50', 'estado': 'borrador'}
    assert record['lineas'] == purchase_lines() and record['tipo_cambio'] == '1.000000' and record['editable'] is True
    assert projected['proveedores'][0] == {'codigo': 'PROV-001', 'nombre': 'Papelería Norte S.L.', 'datos_generales': {
        'nombre_comercial': 'Papelería Norte', 'numero_identificacion': 'B00000000',
        'email': 'compras@example.test', 'telefono': '+34 600 000 000'}}
    supplier = projected['proveedores'][1]
    assert supplier['roles'] == ['proveedor', 'cliente'] and supplier['condiciones']['plazo_pago_dias'] == '30'
    assert supplier['contactos'] == [{'nombre': 'Ana', 'cargo': 'Compras', 'email': 'ana@example.test',
                                      'telefono': '600000001', 'principal': True}]
    assert projected['ventas'][0]['cliente'] == {'codigo': 'CLI-9', 'nombre': 'Cliente Demo'}
    assert projected['ventas'][0]['pedido'] == {'numero': 'P-77'} and projected['ventas'][0]['total'] == '59.90'
    detail = projected['ventas'][1]
    assert detail['creado_en'] == '2026-11-03T10:15:00.123456+00:00' and detail['lineas'][0]['subtotal'] == '59.90'
    # Un campo de negocio que traiga un id, o un importe que no sea una cadena decimal, no sale.
    odd = project_item('compras', purchase(proveedor=str(uuid4()), total=1250.5, fecha='2026-11-02T00:00:00'))
    assert odd['proveedor'] is None and odd['total'] is None and odd['fecha'] is None
    assert code_of(lambda: project_item('pedidos', purchase())) == 'erp_invalid'
