"""El Runner ADK conserva la barrera de una ficha por turno con SDK falso."""
from uuid import uuid4

import pytest

pytest.importorskip('google.adk.runners')

from app.blender_tools import BusinessTools
from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from app.uony_form_guard import FORM_READY_REPLY
from conftest import client_for
from test_google_cloud import Cloud
from test_business_tool_exclusivity import FORM, Incidents, Materials
from test_product_guide_idempotence import setup
from test_uony_adk_agent import FakeSdkClient, model_response, text, tool


@pytest.mark.parametrize('order', ['guide_first', 'create_first'])
def test_runner_sequential_tools_cannot_cross_to_another_product(environment, monkeypatch, order):
    config, google, db = environment
    sdk = FakeSdkClient()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: sdk))
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        status = BusinessTools({}, db, user, None, uuid4(), thread_id='guide-idempotence')
        guide = tool('start_product_guide', {'sku': 'GUIDE-ONCE'})
        create = tool('create_product', {'sku': 'OTHER', 'name': 'Otro producto'})
        sequence = (guide, create) if order == 'guide_first' else (create, guide)
        sdk.responses = [model_response([sequence[0]]), model_response([sequence[1]]),
                         text('Conservo la ficha preparada.')]
        reply, usage = AdkAgentProvider().generate(
            'fixture-access-token', 'fixture-project',
            [{'role': 'user', 'parts': [{'text': 'Continúa una sola ficha.'}]}],
            status, model='gemini-3.5-flash-lite', effort='medium')
        assert reply == 'Conservo la ficha preparada.'
        assert usage['calls'] == usage['attemptedCalls'] == 3
        assert sdk.closed and len(sdk.calls) == 3
        responses = [part.function_response for content in sdk.calls[2][1]
                     for part in content.parts or [] if part.function_response]
        assert responses[-1].response['error'] == 'one_change'
        if order == 'guide_first':
            assert status.guide_sku == 'GUIDE-ONCE' and status.pending is None
        else:
            assert status.guide_sku is None and status.pending['data']['sku'] == 'OTHER'
        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 1}]


@pytest.mark.parametrize('order', [
    'guide_then_materials', 'materials_then_guide',
    'create_then_materials', 'materials_then_create',
])
def test_runner_cannot_prepare_materials_card_with_another_card_or_change(environment, monkeypatch, order):
    config, google, db = environment
    sdk = FakeSdkClient()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: sdk))
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        status = BusinessTools({}, db, user, None, uuid4(), materials=object(),
                               thread_id='guide-idempotence')
        guide = tool('start_product_guide', {'sku': 'GUIDE-ONCE'})
        create = tool('create_product', {'sku': 'NEW-OTHER', 'name': 'Nuevo producto'})
        materials_existing = tool('show_product_materials', {'sku': 'GUIDE-ONCE'})
        materials_new = tool('show_product_materials', {'sku': 'NEW-OTHER'})
        sequence = {
            'guide_then_materials': (guide, materials_existing),
            'materials_then_guide': (materials_existing, guide),
            'create_then_materials': (create, materials_new),
            'materials_then_create': (materials_existing, create),
        }[order]
        sdk.responses = [model_response([sequence[0]]), model_response([sequence[1]]),
                         text('Continúo con la única operación preparada.')]
        reply, usage = AdkAgentProvider().generate(
            'fixture-access-token', 'fixture-project',
            [{'role': 'user', 'parts': [{'text': 'Prepara una operación.'}]}],
            status, model='gemini-3.5-flash-lite', effort='medium')
        assert reply == 'Continúo con la única operación preparada.'
        assert usage['calls'] == usage['attemptedCalls'] == 3
        assert sdk.closed and len(sdk.calls) == 3
        responses = [part.function_response for content in sdk.calls[2][1]
                     for part in content.parts or [] if part.function_response]
        assert responses[-1].response.get('error')
        assert sum(bool(item) for item in (status.guide_sku, status.materials.sku, status.pending)) == 1
        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 1}]


@pytest.mark.parametrize('sequence', [
    ('incident', 'guide'), ('ask', 'incident'), ('pending', 'ask'),
])
def test_runner_preserves_first_incident_or_question_card(environment, monkeypatch, sequence):
    config, google, db = environment
    sdk = FakeSdkClient()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: sdk))
    incidents = Incidents()
    with client_for(config, google, cloud=Cloud()) as client:
        user = setup(client, google, db, config)
        prompt = ('Muéstrame un formulario para responder.' if 'ask' in sequence
                  else 'Prepara una operación.')
        status = BusinessTools({}, db, user, None, uuid4(), incidents=incidents,
                               materials=Materials(), thread_id='guide-idempotence',
                               user_text=prompt)
        calls = {
            'incident': tool('list_product_incidents', {'sku': 'GUIDE-ONCE'}),
            'guide': tool('start_product_guide', {'sku': 'GUIDE-ONCE'}),
            'ask': tool('ask_user', FORM),
            'pending': tool('create_product', {'sku': 'NEW-OTHER', 'name': 'Otro borrador'}),
        }
        sdk.responses = [model_response([calls[sequence[0]]]),
                         model_response([calls[sequence[1]]]),
                         text('Conservo la primera operación.')]
        reply, usage = AdkAgentProvider().generate(
            'fixture-access-token', 'fixture-project',
            [{'role': 'user', 'parts': [{'text': prompt}]}],
            status, model='gemini-3.5-flash-lite', effort='medium')
        if sequence[0] == 'ask':
            assert reply == FORM_READY_REPLY
            assert usage['calls'] == usage['attemptedCalls'] == 1
            assert len(sdk.calls) == 1
        else:
            assert reply == 'Conservo la primera operación.'
            assert usage['calls'] == usage['attemptedCalls'] == 3
            responses = [part.function_response for content in sdk.calls[2][1]
                         for part in content.parts or [] if part.function_response]
            assert responses[-1].response.get('error')
        assert sum(bool(item) for item in (status.guide_sku, status.materials.sku,
                                           status.pending, status.incidents.result,
                                           status.conversation_forms.present())) == 1
        assert sdk.closed
        with db.connect() as connection:
            rows = connection.execute('SELECT sku,revision FROM products WHERE user_id=%s',
                                      (user['id'],)).fetchall()
        assert rows == [{'sku': 'GUIDE-ONCE', 'revision': 1}]
