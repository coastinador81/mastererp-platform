"""Pantallas de ERP · Finanzas (/api/erp, montadas por create_app) y referencias opacas, con el ERP y
la conexión falsos donde los busca la app: nunca la API real ni Cognito."""
import logging
import re
from uuid import uuid4

import httpx
import pytest

from conftest import client_for, login
from test_google_cloud import allow
from test_subscription import complete
from app import mastererp_api, mastererp_store
from app.mastererp_refs import REF, remember, resolve
from app.mastererp_types import COLLECTIONS, ErpCredential, ErpError

TOKEN = 'erp-access-fixture-only'
UUID_TEXT = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
HANDLE = re.compile(r'[SOFPCV]-[2-9A-HJKMNP-Z]{4}')
CLASSES = {'compras': 'solicitud_compra', 'ordenes': 'orden_compra', 'facturas': 'factura_proveedor'}


class Erp:
    """ERP falso tras httpx.MockTransport: registros por empresa, lista por cursor y ficha."""

    def __init__(self):
        self.tenant, self.data, self.requests, self.failures = str(uuid4()), {}, [], []

    def add(self, company, kind, *numbers, serie=''):
        """Registros nuevos, con ids crecientes en el orden de sus números (la API lista por id)."""
        records = [{'id': key, 'company_id': company, 'version': 1, 'clase': CLASSES[kind],
                    'fecha': '2026-11-02', 'numero': number, 'serie': serie, 'proveedor_id': str(uuid4()),
                    'proveedor': 'Papelería Norte', 'origen_id': None, 'moneda': 'EUR', 'moneda_base': 'EUR',
                    'tipo_cambio': '1', 'cambio_fecha': '2026-11-02', 'cambio_fuente': 'manual',
                    'total': '125.50', 'total_base': '125.50', 'estado': 'borrador', 'editable': True}
                   for key, number in zip(sorted(str(uuid4()) for _ in numbers), numbers)]
        self.data.setdefault((company, kind), []).extend(records)
        self.data[(company, kind)].sort(key=lambda record: record['id'])
        return records

    def __call__(self, request):
        self.requests.append(request)
        if self.failures:
            status, body = self.failures.pop(0)
            return httpx.Response(status, json=body)
        if (request.headers.get('authorization') != 'Bearer ' + TOKEN
                or request.headers.get('x-mastererp-tenant-id') != self.tenant):
            return httpx.Response(401, json={'error': 'invalid_identity'})
        path = request.url.path.removeprefix('/v1/administration/')
        kind = next(k for k, v in COLLECTIONS.items() if path == v or path.startswith(v + '/'))
        rows = self.data.get((request.url.params['company_id'], kind), [])
        if path != COLLECTIONS[kind]:
            found = [row for row in rows if row['id'] == path.rsplit('/', 1)[1]]
            if not found:
                return httpx.Response(404, json={'error': 'not_found'})
            lines = [{'descripcion': 'Folios A4', 'cantidad': '1', 'precio_unitario': '125.50', 'total': '125.50'}]
            return httpx.Response(200, json={'data': {**found[0], 'lineas': lines}})
        limit, after = int(request.url.params['limit']), request.url.params.get('after')
        rest = [{**row, 'lineas': None} for row in rows if not after or row['id'] > after]
        cursor = rest[limit - 1]['id'] if len(rest) > limit else None
        return httpx.Response(200, json={'data': {'items': rest[:limit], 'next_cursor': cursor}})


class Connection:
    """Conexión falsa del ERP con las firmas de mastererp_store.credential_provider y mark."""

    def __init__(self, tenant):
        self.tenant, self.company, self.error, self.calls, self.marks = tenant, str(uuid4()), None, 0, []

    def __call__(self, database, settings, user_id):
        def provide():
            self.calls += 1
            if self.error:
                raise ErpError(self.error)
            return ErpCredential(TOKEN, self.tenant, self.company, 'fingerprint-fixture')
        return provide

    def mark(self, database, user_id, status, fingerprint=None):
        self.marks.append((status, fingerprint))


@pytest.fixture
def fakes(monkeypatch):
    erp = Erp()
    connection = Connection(erp.tenant)
    monkeypatch.setattr(mastererp_api, 'http_client', lambda: httpx.Client(transport=httpx.MockTransport(erp)))
    monkeypatch.setattr(mastererp_api, 'RETRY_PAUSE', (0, 0))
    monkeypatch.setattr(mastererp_store, 'credential_provider', connection)
    monkeypatch.setattr(mastererp_store, 'mark', connection.mark)
    return erp, connection


def clean(response):
    assert response.headers['cache-control'] == 'no-store'
    assert not UUID_TEXT.search(response.text) and TOKEN not in response.text
    return response.json()


def test_routes_need_session_subscription_and_the_erp_connection(environment, fakes):
    erp, connection = fakes
    config, provider, db = environment
    with client_for(config, provider, legacy_sync=False) as client:
        assert client.get('/api/erp/compras').json()['error'] == 'session_required'
        login(client, provider)
        complete(client)
        assert client.get('/api/erp/compras').json()['error'] == 'subscription_required'
        allow(db)
        for code, status in (('erp_reconnect', 401), ('erp_not_linked', 403), ('erp_selection_required', 409),
                             ('erp_changed', 409), ('erp_unavailable', 503)):
            connection.error = code
            response = client.get('/api/erp/compras')
            assert response.status_code == status and clean(response)['error'] == code, response.text
            assert client.get('/api/erp/compras/SC-0001').status_code == status
        connection.error, calls = None, connection.calls
        response = client.get('/api/erp/pedidos')
        assert response.status_code == 404 and response.json()['error'] == 'erp_not_found'
        assert connection.calls == calls and erp.requests == [] and connection.marks == []


def test_list_and_record_only_show_opaque_refs_and_cursors(environment, fakes, caplog):
    caplog.set_level(logging.DEBUG)
    erp, connection = fakes
    first, second, third = erp.add(connection.company, 'compras', '0001', '0002', '0003', serie='SC')
    with client_for(environment[0], environment[1], legacy_sync=False) as client:
        login(client, environment[1]); complete(client); allow(environment[2])
        data = clean(client.get('/api/erp/compras', params={'limit': 2}))
        assert [item['ref'] for item in data['items']] == ['SC-0001', 'SC-0002']
        assert data['items'][0] == {'ref': 'SC-0001', 'numero': '0001', 'serie': 'SC', 'fecha': '2026-11-02',
                                    'proveedor': 'Papelería Norte', 'moneda': 'EUR', 'total': '125.50',
                                    'estado': 'borrador'}
        assert data['nextCursor'] == 'SC-0002'
        assert dict(erp.requests[-1].url.params) == {'company_id': connection.company, 'limit': '2'}
        following = clean(client.get('/api/erp/compras', params={'limit': 2, 'after': data['nextCursor']}))
        assert erp.requests[-1].url.params['after'] == second['id']
        assert [item['ref'] for item in following['items']] == ['SC-0003'] and following['nextCursor'] is None
        record = clean(client.get('/api/erp/compras/SC-0003'))['record']
        assert erp.requests[-1].url.path == '/v1/administration/compras/solicitudes/' + third['id']
        assert dict(erp.requests[-1].url.params) == {'company_id': connection.company}
        assert record['ref'] == 'SC-0003' and record['lineas'][0]['descripcion'] == 'Folios A4'
        again = clean(client.get('/api/erp/compras', params={'limit': 2}))
        assert [item['ref'] for item in again['items']] == ['SC-0001', 'SC-0002']
        # Un cursor que no es de la página se guarda como uno más, también opaco.
        stray = str(uuid4())
        erp.failures = [(200, {'data': {'items': [{**first, 'lineas': None}], 'next_cursor': stray}})]
        odd = clean(client.get('/api/erp/compras', params={'limit': 1}))
        assert odd['items'][0]['ref'] == 'SC-0001' and HANDLE.fullmatch(odd['nextCursor'])
        clean(client.get('/api/erp/compras', params={'limit': 1, 'after': odd['nextCursor']}))
        assert erp.requests[-1].url.params['after'] == stray
    text = '\n'.join(record.getMessage() for record in caplog.records)
    for secret in (TOKEN, erp.tenant, connection.company, first['id'], second['id'], third['id']):
        assert secret not in text


def test_refs_expire_and_never_cross_company_kind_or_account(environment, fakes):
    erp, connection = fakes
    config, provider, db = environment
    company, other = connection.company, str(uuid4())
    first, = erp.add(company, 'compras', '0001', serie='SC')
    erp.add(other, 'compras', '0001', serie='SC')
    with client_for(config, provider, legacy_sync=False) as client:
        login(client, provider); complete(client); allow(db)
        assert clean(client.get('/api/erp/compras', params={'limit': 1}))['items'][0]['ref'] == 'SC-0001'
        with db.connect() as c:
            c.execute("UPDATE uony_erp_refs SET expires_at=now()+interval '1 minute'")
        clean(client.get('/api/erp/compras/SC-0001'))  # Verla de nuevo renueva sus 30 minutos.
        with db.connect() as c:
            assert c.execute("SELECT expires_at>now()+interval '29 minutes' AS ok FROM uony_erp_refs").fetchone()['ok']
        calls = len(erp.requests)
        connection.company = other
        assert client.get('/api/erp/compras/SC-0001').json()['error'] == 'erp_not_found'
        assert client.get('/api/erp/ordenes/SC-0001').json()['error'] == 'erp_not_found'
        assert len(erp.requests) == calls
        listed = clean(client.get('/api/erp/compras'))['items'][0]['ref']
        assert HANDLE.fullmatch(listed)  # El número vivo en la otra empresa no se reasigna.
        connection.company = company
        assert clean(client.get('/api/erp/compras/SC-0001'))['record']['numero'] == '0001'
        assert erp.requests[-1].url.path.endswith(first['id'])
        assert client.get('/api/erp/compras/' + listed).json()['error'] == 'erp_not_found'
        with db.connect() as c:
            user = c.execute('SELECT id FROM users LIMIT 1').fetchone()['id']
            stranger = uuid4()
            c.execute("INSERT INTO users(id,google_subject,email) VALUES(%s,'google-test-two','two@example.test')",
                      (stranger,))
            credential = ErpCredential(TOKEN, erp.tenant, company, 'f')
            assert resolve(c, user, credential, 'compras', 'SC-0001') == first['id']
            assert resolve(c, stranger, credential, 'compras', 'SC-0001') is None
            assert remember(c, stranger, credential, 'compras',
                            [{'id': str(uuid4()), 'numero': '0001', 'serie': 'SC'}]) == ['SC-0001']
            assert resolve(c, user, credential, 'compras', 'SC-0001') == first['id']
            c.execute("UPDATE uony_erp_refs SET expires_at=now()-interval '1 minute' WHERE user_id=%s", (user,))
        response = client.get('/api/erp/compras/SC-0001')
        assert response.status_code == 404 and response.json()['error'] == 'erp_not_found'
        response = client.get('/api/erp/compras', params={'after': 'SC-0001'})
        assert response.status_code == 400 and response.json()['error'] == 'erp_invalid'
        clean(client.get('/api/erp/compras'))
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_erp_refs WHERE expires_at<=now()').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM uony_erp_refs WHERE user_id=%s', (stranger,)).fetchone()['n'] == 1


def test_shared_numbers_get_short_handles_and_each_ref_keeps_its_record(environment, fakes):
    erp, connection = fakes
    twins = erp.add(connection.company, 'compras', '0009', '0009')  # Mismo número sin serie.
    order, = erp.add(connection.company, 'ordenes', 'SC-0001')
    erp.add(connection.company, 'compras', '0001', serie='SC')
    with client_for(environment[0], environment[1], legacy_sync=False) as client:
        login(client, environment[1]); complete(client); allow(environment[2])
        items = clean(client.get('/api/erp/compras'))['items']
        handles = [item['ref'] for item in items if item['numero'] == '0009']
        assert len(set(handles)) == 2 and all(HANDLE.fullmatch(ref) and ref[0] == 'S' for ref in handles)
        assert [item['ref'] for item in items if item['numero'] == '0001'] == ['SC-0001']
        assert [item['ref'] for item in clean(client.get('/api/erp/compras'))['items']] == [item['ref'] for item in items]
        opened = set()
        for ref in handles:
            clean(client.get('/api/erp/compras/' + ref))
            opened.add(erp.requests[-1].url.path.rsplit('/', 1)[1])
        assert opened == {twin['id'] for twin in twins}
        listed = clean(client.get('/api/erp/ordenes'))['items'][0]['ref']
        assert HANDLE.fullmatch(listed) and listed[0] == 'O'  # 'SC-0001' ya es de una solicitud viva.
        assert clean(client.get('/api/erp/ordenes/' + listed))['record']['numero'] == 'SC-0001'
        assert erp.requests[-1].url.path == '/v1/administration/compras/ordenes/' + order['id']
        assert clean(client.get('/api/erp/compras/SC-0001'))['record']['serie'] == 'SC'
        assert all(REF.fullmatch(ref) for ref in handles + [listed])


def test_api_failures_and_arguments_come_back_typed(environment, fakes):
    erp, connection = fakes
    erp.add(connection.company, 'compras', '0001')
    with client_for(environment[0], environment[1], legacy_sync=False) as client:
        login(client, environment[1]); complete(client); allow(environment[2])
        for failures, status, code, calls, marked in (
                ([(403, {'error': 'identity_not_linked'})], 403, 'erp_not_linked', 1, 'not_linked'),
                ([(403, {'error': 'access_denied'})], 403, 'erp_denied', 1, None),
                ([(401, {'message': 'Unauthorized'})], 401, 'erp_reconnect', 1, 'reauthorize'),
                ([(503, {'error': 'service_unavailable'})] * 2, 503, 'erp_unavailable', 2, None),
                ([(503, {'error': 'service_unavailable'})], 200, None, 2, None),
                ([(200, {'data': {'items': [{'id': 'x'}], 'next_cursor': None}})], 503, 'erp_unavailable', 1, None)):
            erp.failures, before, connection.marks = list(failures), len(erp.requests), []
            response = client.get('/api/erp/compras')
            assert response.status_code == status and len(erp.requests) - before == calls, response.text
            assert clean(response).get('error') == code
            assert connection.marks == ([(marked, 'fingerprint-fixture')] if marked else [])
        erp.failures = [(401, {'message': 'Unauthorized'})]
        assert client.get('/api/erp/compras/0001').json()['error'] == 'erp_reconnect'
        assert connection.marks == [('reauthorize', 'fingerprint-fixture')]
        before = len(erp.requests)
        for params, code in (({'q': 'papel'}, 'erp_invalid'), ({'limit': 26}, 'erp_invalid'),
                             ({'limit': 0}, 'erp_invalid'), ({'limit': 'diez'}, 'invalid_request'),
                             ({'after': 'S-ZZZZ'}, 'erp_invalid')):
            response = client.get('/api/erp/compras', params=params)
            assert response.status_code == 400 and response.json()['error'] == code
        assert client.get('/api/erp/compras/no%20vale').json()['error'] == 'erp_not_found'
        assert len(erp.requests) == before
        erp.failures = [(200, {'data': {'items': [], 'next_cursor': None}})]
        assert clean(client.get('/api/erp/ventas', params={'q': '  taza\troja ' + 'y' * 200}))['items'] == []
        assert erp.requests[-1].url.path == '/v1/administration/ventas'
        assert erp.requests[-1].url.params['q'] == ('taza roja ' + 'y' * 200)[:120]
