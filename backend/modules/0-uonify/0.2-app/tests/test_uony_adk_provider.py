"""Contract checks for the staged ADK provider; no Google requests or DB writes."""

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

pytest.importorskip('google.adk.models')
from google.genai import types

from app.google_cloud_provider import CloudError
from app.conversation_forms import ConversationForms, DECLARATIONS as FORM_DECLARATIONS, PRODUCT_SOURCES_FIELD
from app.uony_adk_provider import AdkGeminiProvider, _model_for_request
from app.uony_form_guard import FORM_READY_REPLY


def answer(parts, tokens=9):
    return SimpleNamespace(
        content=types.Content(role='model', parts=parts),
        usage_metadata=SimpleNamespace(total_token_count=tokens),
        error_code=None,
        finish_reason=types.FinishReason.STOP,
    )


class FakeModel:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []
        self.closed = False
        self.api_client = SimpleNamespace(aio=SimpleNamespace(aclose=self.close))

    async def close(self):
        self.closed = True

    async def generate_content_async(self, request, stream=False):
        assert stream is False
        self.requests.append(request)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        yield response


def tool(name, args=None):
    return types.Part(function_call=types.FunctionCall(name=name, args=args or {}))


class Tools(dict):
    declarations = [
        {'name': 'first', 'description': 'First',
         'parameters': {'type': 'OBJECT', 'properties': {}}},
        {'name': 'second', 'description': 'Second',
         'parameters': {'type': 'OBJECT', 'properties': {}}},
    ]

    def __init__(self):
        super().__init__({'drive': 'connected'})
        self.called = []

    def call(self, name, args):
        self.called.append((name, args))
        return {'prepared': True, 'name': name}


def run_with(model, status=None, effort='medium'):
    with patch('app.uony_adk_provider._model_for_request', return_value=model) as factory:
        result = AdkGeminiProvider().generate(
            'fixture-access-token', 'fixture-project',
            [{'role': 'user', 'parts': [{'text': 'Continúa'}]}],
            status if status is not None else {},
            model='gemini-3.5-flash-lite', effort=effort,
        )
    assert factory.call_args.args[:3] == (
        'fixture-access-token', 'fixture-project', 'gemini-3.5-flash-lite')
    assert model.closed
    return result


def test_adk_model_binds_client_and_disables_transport_retries():
    model = _model_for_request('fixture-token', 'fixture-project', 'gemini-3.5-flash', types)
    assert model.client_kwargs['vertexai'] is True
    assert model.client_kwargs['project'] == 'fixture-project'
    assert model.client_kwargs['location'] == 'global'
    assert model.client_kwargs['credentials'].token == 'fixture-token'
    assert model.api_version == 'v1' and model.use_interactions_api is False
    assert model.retry_options.attempts == 1
    client = model.api_client
    assert client.vertexai is True
    asyncio.run(client.aio.aclose())


def test_provider_contract_config_and_sequential_tools_preserve_signature():
    first = tool('first')
    first.thought_signature = b'fixture-signature'
    fake = FakeModel([
        answer([first, tool('second')], 11),
        answer([types.Part(text='He preparado el borrador.')], 13),
    ])
    tools = Tools()
    reply, usage = run_with(fake, tools, effort='high')
    assert reply == 'He preparado el borrador.'
    assert usage == {'calls': 2, 'attemptedCalls': 2, 'uncertainCalls': 0,
                     'totalTokenCount': 24, 'formRepairCalls': 0}
    assert tools.called == [('first', {}), ('second', {})]
    assert len(fake.requests) == 2
    config = fake.requests[0].config
    assert config.max_output_tokens == 2048
    assert config.automatic_continuation is False
    assert config.automatic_function_calling.disable is True
    assert config.thinking_config.thinking_level == 'HIGH'
    assert config.http_options.api_version == 'v1'
    assert config.http_options.retry_options.attempts == 1
    assert config.http_options.timeout == 60_000
    assert config.system_instruction
    following = fake.requests[1].contents
    assert following[-2].parts[0].thought_signature == b'fixture-signature'
    assert [p.function_response.name for p in following[-1].parts] == ['first', 'second']


def test_unknown_tool_is_rejected_without_running_later_calls():
    fake = FakeModel([answer([tool('unknown'), tool('first')])])
    status = Tools()
    with pytest.raises(CloudError) as raised:
        run_with(fake, status)
    assert raised.value.code == 'invalid_response'
    assert raised.value.usage == {'calls': 1, 'attemptedCalls': 1, 'uncertainCalls': 0,
                                  'totalTokenCount': 9, 'formRepairCalls': 0}
    assert status.called == [] and len(fake.requests) == 1 and fake.closed


def test_last_tool_round_returns_authoritative_card_handoff():
    class GuideTools(Tools):
        def will_show_product_guide(self):
            return bool(self.called)

    fake = FakeModel([answer([tool('first')]) for _ in range(3)])
    reply, usage = run_with(fake, GuideTools())
    assert isinstance(reply, str) and usage['calls'] == 3
    assert len(fake.requests) == 3


def test_missing_form_is_repaired_with_only_ask_user_available():
    class Forms:
        attempted = False
        ready = False

        def present(self):
            return {'fields': [{'id': 'name'}]} if self.ready else None

    class FormTools(Tools):
        declarations = Tools.declarations + [{
            'name': 'ask_user', 'description': 'Ask',
            'parameters': {'type': 'OBJECT', 'properties': {}},
        }]

        def __init__(self):
            super().__init__()
            self.conversation_forms = Forms()

        def call(self, name, args):
            if name == 'ask_user':
                self.conversation_forms.attempted = True
                self.conversation_forms.ready = True
                self.called.append((name, args))
                return {'prepared': True}
            return super().call(name, args)

    fake = FakeModel([
        answer([types.Part(text='Completa este formulario para continuar.')]),
        answer([tool('ask_user')]),
    ])
    status = FormTools()
    reply, usage = run_with(fake, status)
    assert isinstance(reply, str) and usage['formRepairCalls'] == 1
    assert usage['attemptedCalls'] == 2 and usage['uncertainCalls'] == 0
    assert status.called == [('ask_user', {})]
    declarations = fake.requests[1].config.tools[0].function_declarations
    assert [entry.name for entry in declarations] == ['ask_user']
    calling = fake.requests[1].config.tool_config.function_calling_config
    assert calling.mode == 'ANY' and calling.allowed_function_names == ['ask_user']


def test_natural_question_is_delivered_without_an_extra_adk_call():
    class FormTools(Tools):
        declarations = FORM_DECLARATIONS

        def __init__(self):
            super().__init__()
            self.conversation_forms = ConversationForms('form-request')

    question = PRODUCT_SOURCES_FIELD['label']
    fake = FakeModel([answer([types.Part(text=question)])])
    status = FormTools()
    reply, usage = run_with(fake, status)
    assert reply == question and usage['formRepairCalls'] == 0
    assert status.called == [] and status.conversation_forms.present() is None
    assert len(fake.requests) == 1


def test_inline_origin_choice_uses_its_question_as_adk_reply():
    class FormTools(Tools):
        declarations = FORM_DECLARATIONS

        def __init__(self):
            super().__init__()
            self.conversation_forms = ConversationForms('form-request')

        def call(self, name, args):
            self.called.append((name, args))
            return self.conversation_forms.ask(args)

    form = {'title': 'De dónde partimos', 'fields': [PRODUCT_SOURCES_FIELD]}
    fake = FakeModel([answer([tool('ask_user', form)])])
    status = FormTools()
    reply, usage = run_with(fake, status)
    assert reply == PRODUCT_SOURCES_FIELD['label']
    assert status.conversation_forms.present()['presentation'] == 'inline_choice'
    assert usage['calls'] == 1 and usage['formRepairCalls'] == 0
    assert len(fake.requests) == 1


@pytest.mark.parametrize('next_failure', ('quota', 'timeout'))
def test_valid_form_stops_before_a_second_provider_request_and_keeps_usage(next_failure):
    class FormTools(Tools):
        declarations = FORM_DECLARATIONS

        def __init__(self):
            super().__init__()
            self.conversation_forms = ConversationForms('form-request')

        def call(self, name, args):
            self.called.append((name, args))
            return self.conversation_forms.ask(args)

    form = {'title': 'Datos pendientes', 'fields': [{
        'id': 'name', 'label': 'Nombre del producto', 'type': 'text', 'required': True,
    }]}
    class QuotaError(Exception):
        code = 429

    # A second model request would hit a simulated transport failure. The card
    # is already valid, so consuming that request would lose the prepared UI.
    failure = QuotaError() if next_failure == 'quota' else TimeoutError()
    fake = FakeModel([answer([tool('ask_user', form)], 17), failure])
    status = FormTools()
    reply, usage = run_with(fake, status)
    assert reply == FORM_READY_REPLY
    assert status.called == [('ask_user', form)]
    assert status.conversation_forms.present() == {'id': 'form-request', **form}
    assert usage == {'calls': 1, 'attemptedCalls': 1, 'uncertainCalls': 0,
                     'totalTokenCount': 17, 'formRepairCalls': 0}
    assert len(fake.requests) == 1


def test_quota_error_is_not_retried_and_reports_completed_usage():
    class QuotaError(Exception):
        code = 429

    fake = FakeModel([QuotaError()])
    with pytest.raises(CloudError) as raised:
        run_with(fake)
    assert raised.value.code == 'quota_exceeded'
    assert raised.value.usage == {'calls': 0, 'attemptedCalls': 1, 'uncertainCalls': 1,
                                  'totalTokenCount': 0, 'formRepairCalls': 0}
    assert len(fake.requests) == 1 and fake.closed


def test_timeout_is_uncertain_and_never_retried():
    fake = FakeModel([TimeoutError()])
    with pytest.raises(CloudError) as raised:
        run_with(fake)
    assert raised.value.code == 'google_unavailable'
    assert raised.value.usage['calls'] == 0
    assert raised.value.usage['attemptedCalls'] == 1
    assert raised.value.usage['uncertainCalls'] == 1
    assert len(fake.requests) == 1 and fake.closed


def test_existing_count_tokens_contract_stays_non_generating():
    with patch('app.uony_provider.requests.post', return_value=Mock(
            status_code=200, json=lambda: {'totalTokens': 123})) as post:
        count = AdkGeminiProvider().count_tokens(
            'fixture-token', 'fixture-project', [], {})
    assert count == 123
    assert post.call_count == 1
    assert ':countTokens' in post.call_args.args[0]
