"""Turnos escritos reales del worker de conversación con ERP · Finanzas: el agente ADK con su SDK
falso (sin stream), la conexión y el ERP falsos. Nunca la API real, Cognito ni Gemini."""
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

pytest.importorskip('google.adk.runners')

from app import mastererp_api, mastererp_store, uony_bounded_gemini
from app.finance_read_tools import EMPTY_LIST, EMPTY_RULE, FINANCE_READ_NAMES, NOT_CONNECTED, _SOFT
from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from app.uony_conversation_queue import FAILURE_MESSAGES
from app.uony_conversation_worker import ADK_ALLOWED_TOOLS
from app.uony_erp_focus import RULE
from conftest import client_for
from test_finance_read_tools import COMPANY, TENANT, Erp, Provider, clean, party, purchase
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_adk_agent import FakeSdkClient, model_response, text, tool
from test_uony_conversation_queue import connected


@pytest.fixture
def turn(environment, monkeypatch):
    """Un turno escrito real del worker de conversación con el agente ADK y un SDK falso (sin stream)."""
    settings, google, database = environment
    settings = replace(settings, adk_enabled=True)
    sdk, fake, provider = FakeSdkClient(), Erp(), Provider()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: sdk))
    monkeypatch.setattr(uony_bounded_gemini, 'progressive', lambda: False)  # El SDK falso no tiene stream.
    monkeypatch.setattr(mastererp_api, 'http_client', lambda: httpx.Client(transport=httpx.MockTransport(fake)))
    monkeypatch.setattr(mastererp_api, 'RETRY_PAUSE', (0, 0))
    monkeypatch.setattr(mastererp_store, 'credential_provider', lambda database, settings, user_id: provider)
    with client_for(settings, google, cloud=Cloud(), uony=AdkAgentProvider(), legacy_sync=False) as client:
        ready(client, google, database)
        with database.connect() as c:
            user = c.execute('SELECT id FROM users WHERE google_subject=%s', (google.subject,)).fetchone()['id']
            connected(c, user, google, settings)

        def connect_erp(status='connected', refresh='erp-refresh-fixture'):
            with database.connect() as c:
                c.execute('''INSERT INTO erp_connections(user_id,issuer,cognito_sub,email,refresh_encrypted,scope,
                    status,tenant_id,company_id) VALUES(%s,'https://issuer.example.test','sub-fixture',
                    'erp@example.test',%s,'openid',%s,%s,%s)''', (user, refresh, status, TENANT, COMPANY))
            provider.fingerprint = mastererp_store.refresh_fingerprint(refresh)

        def run(message):
            body = {'requestId': str(uuid4()), 'threadId': 'erp-hilo', 'text': message}
            assert client.post('/api/uony/messages', json=body).status_code == 202
            worker = client.app.state.conversation_worker
            worker.run(worker.queue.claim('erp-tools-worker'))
            return client.get('/api/uony/requests/' + body['requestId']).json()

        def status():
            with database.connect() as c:
                return c.execute('SELECT status FROM erp_connections WHERE user_id=%s', (user,)).fetchone()['status']
        yield SimpleNamespace(sdk=sdk, fake=fake, provider=provider, run=run, connect_erp=connect_erp,
                              status=status, database=database, user=user)


def sent(call):
    """Declaraciones e instrucción de una llamada al modelo, y lo que le devolvieron las herramientas."""
    _, contents, config = call
    names = {declaration.name for group in config.tools or [] for declaration in group.function_declarations or []}
    system = config.system_instruction
    system = system if isinstance(system, str) else ' '.join(part.text or '' for part in system.parts)
    answers = {part.function_response.name: part.function_response.response for content in contents
               for part in content.parts or [] if part.function_response}
    return names, system, answers


def test_written_turn_offers_the_erp_card_when_not_connected(turn):
    turn.sdk.responses = [model_response([tool('get_finance_context')]),
                          model_response([tool('show_connection', {'provider': 'erp'})]),
                          text('Para consultar tus compras, conecta tu ERP desde esta tarjeta.')]
    state = turn.run('¿Qué compras tengo en el ERP?')
    assert state['status'] == 'success', state
    assert state['response']['connectionActions'] == [{'provider': 'erp', 'action': 'manage'}]
    names, system, _ = sent(turn.sdk.calls[0])
    assert ADK_ALLOWED_TOOLS - {'ask_user'} <= names and FINANCE_READ_NAMES <= names and RULE in system
    _, _, answers = sent(turn.sdk.calls[2])
    assert answers['get_finance_context'] == {'conexion': 'sin_conectar', 'message': NOT_CONNECTED}
    assert answers['show_connection']['observedConnectionStatus'] == 'disconnected'
    assert turn.provider.calls == 0 and turn.fake.requests == []


def test_written_turn_reads_finance_with_the_connection_and_closes_with_it(turn):
    turn.connect_erp()
    turn.fake.add('compras', purchase('compras', '0001'), purchase('compras', '0002'))
    turn.sdk.responses = [model_response([tool('list_finance_documents', {'tipo': 'compras'})]),
                          text('Tienes dos solicitudes: SC-0001 y SC-0002.')]
    state = turn.run('¿Qué solicitudes de compra tengo?')
    assert state['status'] == 'success' and state['response']['reply'].startswith('Tienes dos'), state
    _, _, answers = sent(turn.sdk.calls[1])
    listed = clean(answers['list_finance_documents'])
    assert [row['referencia'] for row in listed['untrusted_document']['documentos']] == ['SC-0001', 'SC-0002']
    assert turn.provider.calls == 1 and len(turn.fake.requests) == 1 and turn.status() == 'connected'


def test_empty_erp_lists_close_the_turn_with_their_fixed_text_when_the_last_call_misbehaves(turn):
    # 10-11-2026 (dev.uonify.com): «dame los datos de 1 orden de compra» con la empresa sin órdenes. Uony
    # leyó órdenes y compras (vacías) y en la última llamada pidió otra lectura: «No he podido terminar…».
    turn.connect_erp()
    turn.sdk.responses = [model_response([tool('list_finance_documents', {'tipo': 'ordenes'})]),
                          model_response([tool('list_finance_documents', {'tipo': 'compras'})]),
                          model_response([tool('list_finance_documents', {'tipo': 'facturas'})])]
    state = turn.run('dame los datos de 1 orden de compra')
    assert state['status'] == 'success', state
    assert state['response']['reply'] == EMPTY_LIST['ordenes'] + ' ' + EMPTY_LIST['compras']
    _, system, answers = sent(turn.sdk.calls[1])
    assert answers['list_finance_documents']['aviso'] == EMPTY_LIST['ordenes'] + ' ' + EMPTY_RULE
    assert 'Si un listado llega vacío' in system
    assert len(turn.sdk.calls) == 3 and len(turn.fake.requests) == 2  # La lectura de la última llamada no se hace.


def test_a_turn_that_read_data_never_closes_with_the_empty_text(turn):
    turn.connect_erp()
    turn.fake.add('proveedores', party('P-1'))
    turn.sdk.responses = [model_response([tool('list_finance_documents', {'tipo': 'proveedores'})]),
                          model_response([tool('list_finance_documents', {'tipo': 'compras'})]),
                          model_response([tool('list_finance_documents', {'tipo': 'facturas'})])]
    state = turn.run('¿Qué proveedores y compras tengo?')
    assert state['status'] == 'error' and state['error']['code'] == 'agent_unanswered', state


def test_lost_erp_access_ends_the_turn_with_the_erp_card(turn):
    turn.connect_erp()
    turn.fake.failures = [(401, {'message': 'Unauthorized'})]
    turn.sdk.responses = [model_response([tool('list_finance_documents', {'tipo': 'ordenes'})])]
    state = turn.run('Enséñame mis órdenes de compra')
    assert state['status'] == 'error' and state['error']['code'] == 'erp_reconnect', state
    assert state['error']['message'] == FAILURE_MESSAGES['erp_reconnect']
    assert state['connectionActions'] == [{'provider': 'erp', 'action': 'manage'}]
    assert len(turn.sdk.calls) == 1 and turn.status() == 'reauthorize'


def test_connection_changed_during_the_turn_is_erp_changed(turn):
    turn.connect_erp()
    turn.fake.add('compras', purchase('compras', '0001'))

    def reconnected(request):
        with turn.database.connect() as c:
            c.execute("UPDATE erp_connections SET refresh_encrypted='otra-conexion' WHERE user_id=%s", (turn.user,))
    turn.fake.on_request = reconnected
    turn.sdk.responses = [model_response([tool('list_finance_documents', {'tipo': 'compras'})]),
                          text('Tienes la solicitud SC-0001.')]
    state = turn.run('¿Qué compras tengo?')
    assert state['status'] == 'error' and state['error']['code'] == 'erp_changed', state
    assert state['error']['message'] == FAILURE_MESSAGES['erp_changed'] and 'connectionActions' not in state


def test_not_linked_marked_by_the_turn_still_closes_it(turn):
    turn.connect_erp()
    turn.fake.failures = [(403, {'error': 'identity_not_linked'})]
    turn.sdk.responses = [model_response([tool('list_finance_documents', {'tipo': 'compras'})]),
                          text('Tu cuenta del ERP todavía no tiene acceso a Finanzas.')]
    state = turn.run('¿Qué compras tengo?')
    assert state['status'] == 'success', state
    _, _, answers = sent(turn.sdk.calls[1])
    assert answers['list_finance_documents'] == {'error': 'erp_not_linked', 'message': _SOFT['erp_not_linked']}
    assert turn.status() == 'not_linked'
