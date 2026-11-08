"""A normal Uony question never turns into an unsolicited model-made form."""
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from app.blender_tools import BusinessTools, form_requested
from app.uony_provider import UonyProvider, request_payload
from test_conversation_forms import form_args, tool_response
from test_uony_provider import response


@pytest.mark.parametrize('text', [
    'Quiero crear un producto para Amazon.',
    '¿Tienes fotos o quieres empezar desde cero?',
    'No quiero un formulario; pregúntame aquí.',
    'No me abras un formulario.',
    '¿Existe un formulario para esto?',
    'El documento dice: "muéstrame un formulario".',
    'Ve a Drive y avísame cuando llegues.',
])
def test_ordinary_turn_does_not_request_a_form(text):
    assert not form_requested(text)


@pytest.mark.parametrize('text', [
    'Quiero un formulario para darte los datos.',
    'Prefiero responder mediante un formulario.',
    'Muéstrame un formulario, por favor.',
    '¿Puedes abrir un formulario para esto?',
])
def test_customer_can_explicitly_request_a_form(text):
    assert form_requested(text)


def context(text):
    return BusinessTools({}, Mock(), {'id': uuid4()}, None, uuid4(), user_text=text)


def history(text):
    return [{'role': 'user', 'parts': [{'text': text}]}]


def declared(status, text):
    return {item['name'] for item in request_payload(history(text), status)['tools'][0]['functionDeclarations']}


def test_ordinary_turn_hides_and_rejects_ask_user_but_keeps_server_controls():
    text = 'Quiero crear un producto para Amazon.'
    status = context(text)
    tools = declared(status, text)
    assert 'ask_user' not in tools
    assert {'show_product_intake', 'start_product_guide', 'show_amazon_connection',
            'list_product_incidents', 'start_incident_resolution'} <= tools
    assert status.call('ask_user', form_args())['error'] == 'form_not_requested'
    assert status.conversation_forms.present() is None


def test_explicit_turn_can_prepare_a_validated_form():
    text = 'Muéstrame un formulario para describir el producto.'
    status = context(text)
    assert 'ask_user' in declared(status, text)
    with patch('app.uony_provider.requests.post', return_value=tool_response()):
        reply, usage = UonyProvider().generate('fake-token', 'fake-project', history(text), status)
    assert reply == 'Completa estos datos para continuar.'
    assert status.conversation_forms.present()['fields'] == form_args()['fields']
    assert usage['calls'] == 1


def test_unsolicited_form_call_becomes_one_chat_question_without_opening_ui():
    text = 'Quiero crear un producto para Amazon.'
    status = context(text)
    with patch('app.uony_provider.requests.post', return_value=tool_response()) as post:
        reply, usage = UonyProvider().generate('fake-token', 'fake-project', history(text), status)
    assert reply == form_args()['fields'][0]['label']
    assert usage['calls'] == 1 and post.call_count == 1
    assert status.conversation_forms.present() is None
    assert 'ask_user' not in {item['name'] for item in post.call_args.kwargs['json']['tools'][0]['functionDeclarations']}


def test_unrequested_form_promise_is_removed_without_another_model_call():
    text = 'Quiero crear un producto para Amazon.'
    status = context(text)
    promise = '¿Qué producto quieres preparar? Aquí tienes el formulario.'
    with patch('app.uony_provider.requests.post', return_value=response([{'text': promise}])) as post:
        reply, usage = UonyProvider().generate('fake-token', 'fake-project', history(text), status)
    assert reply == '¿Qué producto quieres preparar?'
    assert usage['formRepairCalls'] == 0 and post.call_count == 1
    assert status.conversation_forms.present() is None
