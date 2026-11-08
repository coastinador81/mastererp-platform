"""La guía conserva un solo destino y no duplica revisiones tras un corte."""
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.blender_tools import BusinessTools
from app.google_cloud_provider import CloudError
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_conversation_queue import connected


class GuideAgent:
    def __init__(self, uncertain_first=False, double_call=False, targets=None):
        self.calls = 0
        self.uncertain_first = uncertain_first
        self.double_call = double_call
        self.targets = targets or ['GUIDE-ONCE']
        self.tools = []

    def generate(self, token, project, history, status, model=None, effort=None):
        self.calls += 1
        assert token == 'fixture-access-only' and project == 'project-fixture'
        target = self.targets[min(self.calls - 1, len(self.targets) - 1)]
        self.tools.append(status.call('start_product_guide', {'sku': target}))
        if self.double_call:
            self.tools.append(status.call('start_product_guide', {'sku': target}))
        if self.uncertain_first and self.calls == 1:
            error = CloudError('google_unavailable')
            error.usage = {'attemptedCalls': 1, 'uncertainCalls': 1}
            raise error
        return 'La guía está preparada.', {'attemptedCalls': 1, 'calls': 1, 'totalTokenCount': 8}


def setup(client, google, db, config):
    ready(client, google, db)
    with db.connect() as connection:
        user = connection.execute('SELECT * FROM users WHERE google_subject=%s',
                                  (google.subject,)).fetchone()
        connected(connection, user['id'], google, config)
    created = client.post('/api/products', json={'sku': 'GUIDE-ONCE', 'name': 'Basic Mini Bricks (prueba)'})
    assert created.status_code == 200, created.text
    return user


def message(request_id=None, retry_of=None, text='Continúa la guía de GUIDE-ONCE.'):
    result = {'requestId': str(request_id or uuid4()), 'threadId': 'guide-idempotence',
              'text': text}
    if retry_of:
        result['retryOf'] = str(retry_of)
    return result


def run_queued(client, body, *, break_after_save=False):
    accepted = client.post('/api/uony/messages', json=body)
    assert accepted.status_code == 202, accepted.text
    worker = client.app.state.conversation_worker
    job = worker.queue.claim('guide-fixture-worker')
    assert job and str(job['request_id']) == body['requestId']
    if break_after_save:
        # `apply` ya guardó la revisión dentro de finish, pero se corta antes
        # de confirmar la respuesta y el job en esa misma transacción.
        with patch('app.product_guide.guided_form', side_effect=RuntimeError('simulated crash')):
            worker.run(job)
    else:
        worker.run(job)
    return client.get('/api/uony/requests/' + body['requestId']).json()


def product_revision(client, db, user):
    product = client.get('/api/products').json()['products'][0]
    with db.connect() as connection:
        history = connection.execute('SELECT revision,source FROM product_revisions '
                                     'WHERE user_id=%s AND product_id=%s ORDER BY revision',
                                     (user['id'], product['id'])).fetchall()
    return product, history


def test_double_guide_call_and_same_request_replay_save_one_revision(environment):
    config, google, db = environment
    agent = GuideAgent(double_call=True)
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        body = message()
        result = run_queued(client, body)
        assert result['status'] == 'success'
        assert result['response']['conversationForm']['context']['revision'] == 2
        assert len(agent.tools) == 2 and all(tool.get('prepared') for tool in agent.tools)
        replay = client.post('/api/uony/messages', json=body)
        assert replay.status_code == 200 and replay.json() == result
        # Otra petición explícita para continuar la misma guía puede crear
        # una nueva tarjeta, pero no una nueva revisión sin datos nuevos.
        continued = run_queued(client, message())
        assert continued['status'] == 'success'
        assert continued['response']['conversationForm']['context']['revision'] == 2
        product, history = product_revision(client, db, user)
        assert agent.calls == 2 and product['revision'] == 2
        assert [item['revision'] for item in history] == [1, 2]


def test_one_model_response_cannot_switch_guide_target_or_mode(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        second = client.post('/api/products', json={'sku': 'OTHER', 'name': 'Otro producto'})
        assert second.status_code == 200
        tools = BusinessTools({}, db, user, None, uuid4(), thread_id='guide-idempotence')
        first = tools.call('start_product_guide', {'sku': 'GUIDE-ONCE'})
        repeated = tools.call('start_product_guide', {'sku': 'GUIDE-ONCE'})
        other = tools.call('start_product_guide', {'sku': 'OTHER'})
        different_mode = tools.call('start_product_guide', {'sku': 'GUIDE-ONCE', 'offerModeChoice': True})
        assert first.get('prepared') and repeated == first
        assert other['error'] == different_mode['error'] == 'one_change'
        assert tools.guide_sku == 'GUIDE-ONCE' and tools.guide_mode_choice is False
        # A later user turn has its own tool context and may choose a new SKU.
        later = BusinessTools({}, db, user, None, uuid4(), thread_id='guide-idempotence')
        assert later.call('start_product_guide', {'sku': 'OTHER'}).get('prepared')
        assert later.guide_sku == 'OTHER'
        assert client.get('/api/products').json()['products'][0]['revision'] == 1


@pytest.mark.parametrize('first,second', [
    ('GUIDE-ONCE', ' guide-once '),
    (' guide-once ', 'GUIDE-ONCE'),
])
def test_repeated_guide_accepts_casing_and_outer_spaces_of_same_sku(environment, first, second):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        tools = BusinessTools({}, db, user, None, uuid4(), thread_id='guide-idempotence')
        original = tools.call('start_product_guide', {'sku': first})
        repeated = tools.call('start_product_guide', {'sku': second})
        assert original.get('prepared') and repeated == original
        assert tools.guide_sku == 'GUIDE-ONCE'
        with db.connect() as connection:
            row = connection.execute("SELECT revision FROM products WHERE user_id=%s AND sku='GUIDE-ONCE'",
                                     (user['id'],)).fetchone()
        assert row['revision'] == 1  # La herramienta solo prepara el efecto.


@pytest.mark.parametrize('order', ['guide_first', 'update_first'])
def test_guide_and_update_of_same_sku_are_allowed_with_normalized_name(environment, order):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        tools = BusinessTools({}, db, user, None, uuid4(), thread_id='guide-idempotence')

        def update_same_product():
            read = tools.call('get_product', {'sku': 'guide-once'})
            assert read['product']['sku'] == 'GUIDE-ONCE'
            return tools.call('update_product', {'sku': 'guide-once', 'revision': 1,
                                                 'changes': {'brand': 'Marca confirmada'}})

        if order == 'guide_first':
            assert tools.call('start_product_guide', {'sku': ' GUIDE-once '}).get('prepared')
            assert update_same_product().get('prepared')
        else:
            assert update_same_product().get('prepared')
            assert tools.call('start_product_guide', {'sku': ' GUIDE-once '}).get('prepared')
        assert tools.guide_sku == 'GUIDE-ONCE'
        assert tools.pending['sku'] == 'GUIDE-ONCE'
        assert tools.pending['data']['brand'] == 'Marca confirmada'
        with db.connect() as connection:
            row = connection.execute("SELECT revision FROM products WHERE user_id=%s AND sku='GUIDE-ONCE'",
                                     (user['id'],)).fetchone()
        assert row['revision'] == 1


@pytest.mark.parametrize('order,mutation', [
    ('guide_first', 'create'), ('guide_first', 'update'),
    ('mutation_first', 'create'), ('mutation_first', 'update'),
])
def test_guide_and_other_product_mutation_cannot_share_one_turn(environment, order, mutation):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        created = client.post('/api/products', json={'sku': 'OTHER', 'name': 'Otro producto'})
        assert created.status_code == 200
        tools = BusinessTools({}, db, user, None, uuid4(), thread_id='guide-idempotence')

        def change_other():
            if mutation == 'create':
                return tools.call('create_product', {'sku': 'NEW-OTHER', 'name': 'Nuevo producto'})
            read = tools.call('get_product', {'sku': 'OTHER'})
            assert read['product']['revision'] == 1
            return tools.call('update_product', {'sku': 'OTHER', 'revision': 1,
                                                 'changes': {'name': 'Otro nombre'}})

        if order == 'guide_first':
            assert tools.call('start_product_guide', {'sku': 'GUIDE-ONCE'}).get('prepared')
            rejected = change_other()
            assert rejected.get('error')
            assert tools.guide_sku == 'GUIDE-ONCE' and tools.pending is None
        else:
            assert change_other().get('prepared')
            pending = tools.pending
            rejected = tools.call('start_product_guide', {'sku': 'GUIDE-ONCE'})
            assert rejected.get('error')
            assert tools.pending == pending and tools.guide_sku is None

        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s ORDER BY sku',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 1}, {'sku': 'OTHER', 'revision': 1}]


def test_an_explicit_later_turn_may_guide_a_different_product(environment):
    config, google, db = environment
    agent = GuideAgent(targets=['GUIDE-ONCE', 'OTHER'])
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        assert client.post('/api/products', json={'sku': 'OTHER', 'name': 'Otro producto'}).status_code == 200
        first = run_queued(client, message())
        assert first['status'] == 'success'
        assert first['response']['conversationForm']['context']['sku'] == 'GUIDE-ONCE'
        later = run_queued(client, message(text='Ahora continúa la guía de OTHER.'))
        assert later['status'] == 'success'
        assert later['response']['conversationForm']['context']['sku'] == 'OTHER'
        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s ORDER BY sku',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 2}, {'sku': 'OTHER', 'revision': 2}]
        assert agent.calls == 2


@pytest.mark.parametrize('order', ['guide_first', 'materials_first'])
def test_guide_and_materials_card_cannot_share_one_turn(environment, order):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        tools = BusinessTools({}, db, user, None, uuid4(), materials=object(),
                              thread_id='guide-idempotence')
        guide = lambda: tools.call('start_product_guide', {'sku': 'GUIDE-ONCE'})
        materials = lambda: tools.call('show_product_materials', {'sku': 'GUIDE-ONCE'})
        if order == 'guide_first':
            assert guide().get('prepared')
            rejected = materials()
            assert tools.guide_sku == 'GUIDE-ONCE' and tools.materials.sku is None
        else:
            assert materials().get('prepared')
            rejected = guide()
            assert tools.materials.sku == 'GUIDE-ONCE' and tools.guide_sku is None
        assert rejected.get('error')
        with db.connect() as connection:
            row = connection.execute("SELECT revision FROM products WHERE user_id=%s AND sku='GUIDE-ONCE'",
                                     (user['id'],)).fetchone()
        assert row['revision'] == 1


@pytest.mark.parametrize('order,mutation', [
    ('mutation_first', 'create'), ('materials_first', 'create'),
    ('mutation_first', 'update'), ('materials_first', 'update'),
])
def test_pending_product_change_and_materials_card_cannot_share_one_turn(environment, order, mutation):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        tools = BusinessTools({}, db, user, None, uuid4(), materials=object(),
                              thread_id='guide-idempotence')

        def change():
            if mutation == 'create':
                return tools.call('create_product', {'sku': 'NEW-OTHER', 'name': 'Nuevo producto'})
            assert tools.call('get_product', {'sku': 'GUIDE-ONCE'})['product']['revision'] == 1
            return tools.call('update_product', {'sku': 'GUIDE-ONCE', 'revision': 1,
                                                 'changes': {'brand': 'Marca de prueba'}})

        # Para creación, la tarjeta se refiere al borrador aún sin confirmar
        # si el cambio va primero; en el otro orden usa la ficha existente.
        material_sku = 'NEW-OTHER' if order == 'mutation_first' and mutation == 'create' else 'GUIDE-ONCE'
        materials = lambda: tools.call('show_product_materials', {'sku': material_sku})
        if order == 'mutation_first':
            assert change().get('prepared')
            pending = tools.pending
            rejected = materials()
            assert tools.pending == pending and tools.materials.sku is None
        else:
            assert materials().get('prepared')
            rejected = change()
            assert tools.materials.sku == 'GUIDE-ONCE' and tools.pending is None
        assert rejected.get('error')
        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 1}]


@pytest.mark.parametrize('failure', ['provider_uncertain', 'finish_rollback'])
def test_retry_after_uncertain_guide_does_not_duplicate_revision(environment, failure):
    config, google, db = environment
    agent = GuideAgent(uncertain_first=failure == 'provider_uncertain')
    with client_for(config, google, cloud=Cloud(), uony=agent, legacy_sync=False) as client:
        user = setup(client, google, db, config)
        original = message()
        state = run_queued(client, original, break_after_save=failure == 'finish_rollback')
        assert state['status'] == 'unknown'
        product, history = product_revision(client, db, user)
        assert product['revision'] == 1 and [row['revision'] for row in history] == [1]
        # Un nuevo UUID sin autorización ligada al intento incierto no avanza.
        assert client.post('/api/uony/messages', json=message()).status_code == 409
        retry = message(retry_of=original['requestId'])
        recovered = run_queued(client, retry)
        assert recovered['status'] == 'success'
        assert recovered['response']['conversationForm']['context']['revision'] == 2
        product, history = product_revision(client, db, user)
        assert product['revision'] == 2
        assert [row['revision'] for row in history] == [1, 2]
        assert agent.calls == 2
        # El mismo retryId tampoco vuelve a llamar al proveedor ni guarda más.
        assert client.post('/api/uony/messages', json=retry).json() == recovered
        assert agent.calls == 2
