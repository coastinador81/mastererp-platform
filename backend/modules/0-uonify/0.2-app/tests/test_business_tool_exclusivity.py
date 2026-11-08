"""Una respuesta de Uony prepara una sola tarjeta o cambio; las lecturas siguen libres."""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.blender_tools import BusinessTools
from app.products import find
from conftest import client_for
from test_google_cloud import Cloud
from test_product_guide_idempotence import setup


FORM = {'title': 'Dato pendiente', 'fields': [
    {'id': 'detalle', 'label': '¿Qué detalle falta?', 'type': 'text', 'required': True},
]}


class Incidents:
    def __init__(self):
        self.calls = 0
        self.first = {'id': str(uuid4()), 'sku': 'GUIDE-ONCE', 'message': 'Revisar peso',
                      'status': 'needs_attention', 'revision': 1}
        self.second = {'id': str(uuid4()), 'sku': 'OTHER', 'message': 'Revisar tamaño',
                       'status': 'needs_attention', 'revision': 1}

    def listing(self, user_id, sku=None):
        self.calls += 1
        return {'incidents': [self.second if sku == 'OTHER' else self.first]}


class Materials:
    def get(self, connection, user, sku):
        find(connection, user, sku)
        return {'job': None}


def tools_for(db, user, incidents, *, thread_id='exclusive-turn',
              user_text='continúa Basic Mini Bricks (prueba)'):
    return BusinessTools({}, db, user, None, uuid4(), incidents=incidents,
                         materials=Materials(), thread_id=thread_id,
                         user_text=user_text)


def prepare(tools, state):
    if state == 'guide':
        return tools.call('start_product_guide', {'sku': 'GUIDE-ONCE'})
    if state == 'materials':
        return tools.call('show_product_materials', {'sku': 'GUIDE-ONCE'})
    if state == 'pending':
        return tools.call('create_product', {'sku': 'NEW-OTHER', 'name': 'Otro borrador'})
    if state == 'link':
        assert tools.call('list_products', {'query': 'Basic Mini Bricks'})['products'][0]['sku'] == 'GUIDE-ONCE'
        assert tools.call('get_product', {'sku': 'GUIDE-ONCE'})['product']['revision'] == 1
        return tools.call('link_product_to_thread', {'sku': 'GUIDE-ONCE', 'revision': 1})
    if state == 'incident':
        return tools.call('list_product_incidents', {'sku': 'GUIDE-ONCE'})
    if state == 'ask':
        return tools.call('ask_user', FORM)
    raise AssertionError(state)


def state_of(tools, state):
    return {
        'guide': tools.guide_sku,
        'materials': tools.materials.sku,
        'pending': deepcopy(tools.pending),
        'link': deepcopy(tools.product_link.prepared),
        'incident': deepcopy(tools.incidents.result),
        'ask': tools.conversation_forms.present(),
    }[state]


def assert_reads_available(tools):
    assert tools.call('get_product', {'sku': 'GUIDE-ONCE'})['product']['revision'] == 1
    assert tools.call('list_products', {'query': 'Basic Mini Bricks'})['products'][0]['sku'] == 'GUIDE-ONCE'
    assert tools.call('get_product_materials', {'sku': 'GUIDE-ONCE'})['job'] is None


@pytest.mark.parametrize('other', ['guide', 'materials', 'pending', 'link'])
@pytest.mark.parametrize('order', ['incident_first', 'other_first'])
def test_incident_choice_is_exclusive_with_other_prepared_states(environment, other, order):
    config, google, db = environment
    incidents = Incidents()
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        with db.connect() as connection:
            connection.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'exclusive-turn','Test')",
                               (user['id'],))
        tools = tools_for(db, user, incidents)
        first, second = ('incident', other) if order == 'incident_first' else (other, 'incident')
        initial = prepare(tools, first)
        assert initial.get('prepared') or (first == 'incident' and len(initial['incidents']) == 1)
        before = state_of(tools, first)
        assert before
        rejected = prepare(tools, second)
        assert rejected.get('error')
        assert state_of(tools, first) == before
        assert not state_of(tools, second)
        assert_reads_available(tools)
        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 1}]


@pytest.mark.parametrize('other', ['guide', 'materials', 'incident', 'pending'])
@pytest.mark.parametrize('order', ['ask_first', 'other_first'])
def test_ask_user_is_exclusive_with_other_prepared_states(environment, other, order):
    config, google, db = environment
    incidents = Incidents()
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        tools = tools_for(db, user, incidents,
                          user_text='Muéstrame un formulario para continuar.')
        first, second = ('ask', other) if order == 'ask_first' else (other, 'ask')
        initial = prepare(tools, first)
        assert initial.get('prepared') or (first == 'incident' and len(initial['incidents']) == 1)
        before = state_of(tools, first)
        assert before
        rejected = prepare(tools, second)
        assert rejected.get('error')
        assert state_of(tools, first) == before
        assert not state_of(tools, second)
        assert_reads_available(tools)


def test_second_incident_listing_cannot_replace_first_choice(environment):
    config, google, db = environment
    incidents = Incidents()
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        tools = tools_for(db, user, incidents)
        first = tools.call('list_product_incidents', {'sku': 'GUIDE-ONCE'})
        assert first['incidents'][0]['id'] == incidents.first['id']
        choice = deepcopy(tools.incidents.result)
        second = tools.call('list_product_incidents', {'sku': 'OTHER'})
        assert second.get('error')
        assert tools.incidents.result == choice
        assert incidents.calls == 1
        assert_reads_available(tools)
