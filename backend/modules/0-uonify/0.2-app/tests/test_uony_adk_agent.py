"""ADK Runner checks with a fake SDK client; no provider or owner I/O."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

pytest.importorskip('google.adk.runners')
from google.genai import types
from google import genai
from google.oauth2.credentials import Credentials

from app.google_cloud_provider import CloudError
from app.conversation_forms import ConversationForms, DECLARATIONS as FORM_DECLARATIONS, PRODUCT_SOURCES_FIELD
import app.uony_adk_agent as adk_agent
from app.uony_adk_agent import AdkAgentProvider, _BoundedGemini
from app.uony_form_guard import FORM_READY_REPLY, FORM_REPAIR_INSTRUCTION


def model_response(parts, tokens=9):
    return types.GenerateContentResponse(
        candidates=[types.Candidate(
            content=types.Content(role='model', parts=parts),
            finish_reason=types.FinishReason.STOP,
        )],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            total_token_count=tokens),
    )


def text(value):
    return model_response([types.Part(text=value)])


def tool(name, args=None):
    return types.Part(function_call=types.FunctionCall(name=name, args=args or {}))


class FakeSdkClient:
    vertexai = True

    def __init__(self):
        self.responses = []
        self.calls = []
        self.closed = False
        self.aio = SimpleNamespace(models=SimpleNamespace(
            generate_content=self.generate_content), aclose=self.close)

    async def generate_content(self, *, model, contents, config):
        self.calls.append((model, contents, config))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    async def close(self):
        self.closed = True


@pytest.fixture
def sdk(monkeypatch):
    fake = FakeSdkClient()
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: fake))
    return fake


class Status(dict):
    declarations = [{
        'name': 'prepare', 'description': 'Prepara una tarjeta',
        'parameters': {'type': 'OBJECT', 'properties': {}},
    }]

    def __init__(self):
        super().__init__({'drive': 'connected'})
        self.called = []
        self.revoked = False

    def call(self, name, args):
        self.called.append((name, args))
        if self.revoked:
            return {'error': 'permission_denied'}
        return {'prepared': True}

    def will_show_product_guide(self):
        return bool(self.called)


def generate(status, history=None, **callbacks):
    return AdkAgentProvider().generate(
        'fixture-access-token', 'fixture-project',
        history or [{'role': 'user', 'parts': [{'text': 'Continúa con el producto'}]}],
        status, model='gemini-3.5-flash-lite', effort='high', **callbacks,
    )


def test_runner_single_model_answer_keeps_config_and_usage(sdk):
    sdk.responses = [text('Listo.')]
    reply, usage = generate(Status())
    assert reply == 'Listo.' and sdk.closed
    assert usage == {'calls': 1, 'attemptedCalls': 1, 'uncertainCalls': 0,
                     'totalTokenCount': 9, 'formRepairCalls': 0}
    assert len(sdk.calls) == 1
    model, contents, config = sdk.calls[0]
    assert model == 'gemini-3.5-flash-lite'
    assert contents[-1].parts[0].text == 'Continúa con el producto'
    assert config.max_output_tokens == 2048
    assert config.automatic_continuation is False
    assert config.automatic_function_calling.disable is True
    assert config.thinking_config.thinking_level == 'HIGH'
    assert config.http_options.api_version == 'v1'
    assert config.http_options.timeout == 60_000
    assert config.http_options.retry_options.attempts == 1
    assert config.system_instruction


def test_undeclared_model_form_is_only_a_chat_question(sdk):
    sdk.responses = [model_response([tool('ask_user', {
        'title': 'Datos', 'fields': [{'id': 'product',
            'label': '¿Qué producto quieres preparar?', 'type': 'text',
            'required': True}],
    })])]
    status = Status()
    reply, usage = generate(status)
    assert reply == '¿Qué producto quieres preparar?'
    assert usage['calls'] == 1 and len(sdk.calls) == 1
    assert status.called == []
    assert 'ask_user' not in {declaration.name for tool_config in sdk.calls[0][2].tools
                               for declaration in tool_config.function_declarations}


def test_real_sdk_does_not_follow_continuation_with_hidden_http_call(monkeypatch):
    """One ADK model call must remain one HTTP attempt even on CONTINUATION."""
    requests = []

    def handle(request):
        requests.append(request)
        assert request.method == 'POST'
        assert request.url.path.endswith(
            '/publishers/google/models/gemini-3.5-flash-lite:generateContent')
        payload = json.loads(request.content)
        assert payload['generationConfig']['maxOutputTokens'] == 2048
        return httpx.Response(200, json={
            'candidates': [{
                'content': {'role': 'model', 'parts': [{'text': 'Incompleto'}]},
                'finishReason': 'CONTINUATION',
                'continuationToken': 'dG9rZW4=',
            }],
            'usageMetadata': {'totalTokenCount': 9},
        })

    client = genai.Client(
        vertexai=True, project='fixture-project', location='global',
        credentials=Credentials(token='fixture-access-token'),
        http_options=types.HttpOptions(
            api_version='v1',
            async_client_args={'transport': httpx.MockTransport(handle)}),
    )
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: client))
    try:
        with pytest.raises(CloudError) as raised:
            generate(Status())
        assert raised.value.code == 'invalid_response'
        assert raised.value.usage['attemptedCalls'] == 1
        assert raised.value.usage['calls'] == 1
        assert len(requests) == 1
    finally:
        asyncio.run(client.aio.aclose())


@pytest.mark.parametrize('http_status', (429, 503))
def test_real_sdk_transient_error_does_not_retry_hidden_http_call(
        monkeypatch, http_status):
    requests = []

    def handle(request):
        requests.append(request)
        assert request.method == 'POST'
        assert request.url.path.endswith(
            '/publishers/google/models/gemini-3.5-flash-lite:generateContent')
        return httpx.Response(http_status, json={
            'error': {'code': http_status, 'message': 'Synthetic provider error',
                      'status': 'RESOURCE_EXHAUSTED' if http_status == 429 else 'UNAVAILABLE'},
        })

    client = genai.Client(
        vertexai=True, project='fixture-project', location='global',
        credentials=Credentials(token='fixture-access-token'),
        http_options=types.HttpOptions(
            api_version='v1',
            async_client_args={'transport': httpx.MockTransport(handle)}),
    )
    monkeypatch.setattr(_BoundedGemini, 'api_client', property(lambda self: client))
    try:
        with pytest.raises(CloudError) as raised:
            generate(Status())
        assert raised.value.usage['attemptedCalls'] == 1
        assert raised.value.usage['calls'] == 0
        assert raised.value.usage['uncertainCalls'] == 1
        assert len(requests) == 1
    finally:
        asyncio.run(client.aio.aclose())


def test_runner_receives_current_thread_history_as_transient_context(sdk):
    sdk.responses = [text('Continuamos.')]
    history = [
        {'role': 'user', 'parts': [{'text': 'Tengo un borrador.'}]},
        {'role': 'model', 'parts': [{'text': 'Lo revisamos.'}]},
        {'role': 'user', 'parts': [{'text': 'Continúa con él.'}]},
    ]
    reply, _ = generate(Status(), history)
    assert reply == 'Continuamos.'
    contents = sdk.calls[0][1]
    messages = [(content.role, part.text) for content in contents
                for part in content.parts or [] if part.text]
    assert messages[-3:] == [
        ('user', 'Tengo un borrador.'),
        ('model', 'Lo revisamos.'),
        ('user', 'Continúa con él.'),
    ]


def test_previous_thread_history_does_not_enter_ephemeral_session(sdk, monkeypatch):
    real_service = adk_agent.InMemorySessionService
    created = []

    class CapturedService(real_service):
        async def create_session(self, **kwargs):
            session = await super().create_session(**kwargs)
            created.append((self, kwargs['user_id'], session.id))
            return session

    monkeypatch.setattr(adk_agent, 'InMemorySessionService', CapturedService)
    sdk.responses = [text('Seguimos.')]
    history = [
        {'role': 'user', 'parts': [{'text': 'MARCADOR_ANTERIOR_UNICO'}]},
        {'role': 'model', 'parts': [{'text': 'Entendido.'}]},
        {'role': 'user', 'parts': [{'text': 'Continúa.'}]},
    ]
    generate(Status(), history)
    service, user_id, session_id = created[0]
    stored = asyncio.run(service.get_session(
        app_name='uonify_stage', user_id=user_id, session_id=session_id))
    saved_text = '\n'.join(part.text for event in stored.events
                           for part in (event.content.parts if event.content else []) or []
                           if isinstance(part.text, str))
    assert 'Continúa.' in saved_text
    assert 'MARCADOR_ANTERIOR_UNICO' not in saved_text


def test_runner_executes_one_declared_tool_and_keeps_model_signature(sdk):
    call = tool('prepare')
    call.thought_signature = b'fixture-signature'
    sdk.responses = [model_response([call]), text('La ficha está preparada.')]
    status = Status()
    reply, usage = generate(status)
    assert reply == 'La ficha está preparada.' and usage['calls'] == 2
    assert status.called == [('prepare', {})]
    assert len(sdk.calls) == 2
    second_contents = sdk.calls[1][1]
    assert any(part.thought_signature == b'fixture-signature'
               for content in second_contents for part in content.parts or [])
    assert any(part.function_response and part.function_response.name == 'prepare'
               for content in second_contents for part in content.parts or [])


def test_every_response_is_checkpointed_before_runner_dispatches_a_tool(sdk):
    events = []
    class OrderedStatus(Status):
        def call(self, name, args):
            events.append(('tool', name))
            return super().call(name, args)
    sdk.responses = [model_response([tool('prepare')]), text('Listo.')]
    reply, usage = generate(OrderedStatus(),
        on_attempt=lambda ordinal: events.append(('attempt', ordinal)),
        on_complete=lambda ordinal, saved: events.append(
            ('complete', ordinal, saved['calls'])))
    assert reply == 'Listo.' and usage['calls'] == 2
    assert events == [('attempt', 1), ('complete', 1, 1), ('tool', 'prepare'),
                      ('attempt', 2), ('complete', 2, 2)]


def test_uncheckpointed_response_never_reaches_runner_or_overstates_usage(sdk):
    sdk.responses = [model_response([tool('prepare')])]
    status = Status()
    def interrupted(ordinal, usage):
        assert ordinal == 1 and usage['calls'] == 1
        raise RuntimeError('checkpoint interrupted before commit')
    with pytest.raises(CloudError) as raised:
        generate(status, on_attempt=lambda _: None, on_complete=interrupted)
    assert status.called == []
    assert raised.value.usage['attemptedCalls'] == 1
    assert raised.value.usage['calls'] == 0
    assert raised.value.usage['uncertainCalls'] == 1


@pytest.mark.parametrize('failed_ordinal', (2, 3))
def test_second_or_third_sdk_failure_retains_completed_prefix(sdk, failed_ordinal):
    sdk.responses = [model_response([tool('prepare')])
                     for _ in range(failed_ordinal - 1)] + [TimeoutError()]
    events = []
    with pytest.raises(CloudError) as raised:
        generate(Status(),
            on_attempt=lambda ordinal: events.append(('attempt', ordinal)),
            on_complete=lambda ordinal, _: events.append(('complete', ordinal)))
    assert raised.value.usage['attemptedCalls'] == failed_ordinal
    assert raised.value.usage['calls'] == failed_ordinal - 1
    assert raised.value.usage['uncertainCalls'] == 1
    assert events == [event for ordinal in range(1, failed_ordinal + 1)
                      for event in ([('attempt', ordinal), ('complete', ordinal)]
                                    if ordinal < failed_ordinal else [('attempt', ordinal)])]


def test_parallel_batch_is_rejected_before_any_tool_effect(sdk):
    sdk.responses = [model_response([tool('prepare'), tool('prepare')])]
    status = Status()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == [] and len(sdk.calls) == 1
    assert raised.value.usage['calls'] == 1


class ReadStatus(Status):
    declarations = Status.declarations + [
        {'name': name, 'description': 'Read only',
         'parameters': {'type': 'OBJECT', 'properties': {}}}
        for name in ('list_products', 'get_product', 'get_product_materials')]

    def call(self, name, args):
        self.called.append((name, args))
        return {'read': name}

    def will_show_product_guide(self):
        return False


def test_parallel_read_batch_is_checkpointed_and_preserves_all_tool_results(sdk):
    sdk.responses = [model_response([
        tool('get_connection_status'),
        tool('list_products', {'query': 'Basic Mini Bricks'}),
        tool('get_product', {'sku': 'BMB-01'}),
    ]), text('La ficha existente está disponible.')]
    status = ReadStatus()
    events = []
    reply, usage = generate(status,
        on_attempt=lambda ordinal: events.append(('attempt', ordinal)),
        on_complete=lambda ordinal, _: events.append(('complete', ordinal)))
    assert reply == 'La ficha existente está disponible.'
    assert usage['calls'] == usage['attemptedCalls'] == 2
    assert status.called == [
        ('list_products', {'query': 'Basic Mini Bricks'}),
        ('get_product', {'sku': 'BMB-01'}),
    ]
    assert [part.function_response.name for content in sdk.calls[1][1]
            for part in content.parts or [] if part.function_response] == [
                'get_connection_status', 'list_products', 'get_product']
    assert events == [('attempt', 1), ('complete', 1),
                      ('attempt', 2), ('complete', 2)]


def test_parallel_material_read_and_product_read_are_allowed(sdk):
    sdk.responses = [model_response([
        tool('get_product_materials', {'sku': 'BMB-01'}),
        tool('get_product', {'sku': 'BMB-01'}),
    ]), text('He revisado los datos guardados.')]
    status = ReadStatus()
    reply, usage = generate(status)
    assert reply == 'He revisado los datos guardados.' and usage['calls'] == 2
    assert status.called == [
        ('get_product_materials', {'sku': 'BMB-01'}),
        ('get_product', {'sku': 'BMB-01'}),
    ]


def test_all_four_audited_reads_can_share_one_response(sdk):
    sdk.responses = [model_response([
        tool('get_connection_status'),
        tool('list_products', {'query': 'Basic Mini Bricks'}),
        tool('get_product', {'sku': 'BMB-01'}),
        tool('get_product_materials', {'sku': 'BMB-01'}),
    ]), text('La ficha y sus materiales guardados están disponibles.')]
    status = ReadStatus()
    reply, usage = generate(status)
    assert reply == 'La ficha y sus materiales guardados están disponibles.'
    assert usage['calls'] == 2
    assert [part.function_response.name for content in sdk.calls[1][1]
            for part in content.parts or [] if part.function_response] == [
                'get_connection_status', 'list_products', 'get_product',
                'get_product_materials']
    assert status.called == [
        ('list_products', {'query': 'Basic Mini Bricks'}),
        ('get_product', {'sku': 'BMB-01'}),
        ('get_product_materials', {'sku': 'BMB-01'}),
    ]


def test_mixed_read_and_action_batch_is_rejected_before_any_tool(caplog, sdk):
    sdk.responses = [model_response([
        tool('list_products', {'query': 'Basic Mini Bricks'}),
        tool('prepare', {'private': 'do not log this'}),
    ])]
    status = ReadStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == [] and len(sdk.calls) == 1
    assert 'reason=mixed_or_effectful count=2' in caplog.text
    assert 'list_products,prepare' in caplog.text
    assert 'do not log this' not in caplog.text


@pytest.mark.parametrize('effectful_name', (
    'get_blender_status', 'list_product_incidents', 'ask_user',
    'create_product', 'update_product', 'show_product_materials',
))
def test_declared_effectful_tool_cannot_join_read_batch(sdk, effectful_name):
    class EffectfulStatus(ReadStatus):
        declarations = ReadStatus.declarations + [{
            'name': effectful_name, 'description': 'Not safe in a batch',
            'parameters': {'type': 'OBJECT', 'properties': {}},
        }]

    sdk.responses = [model_response([
        tool('get_product', {'sku': 'BMB-01'}), tool(effectful_name),
    ])]
    status = EffectfulStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == [] and len(sdk.calls) == 1


def test_batch_unknown_name_is_logged_only_as_undeclared(caplog, sdk):
    sdk.responses = [model_response([
        tool('get_product', {'sku': 'BMB-01'}),
        tool('secret-customer-address@example.test'),
    ])]
    status = ReadStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == []
    assert '<undeclared>' in caplog.text
    assert 'secret-customer-address' not in caplog.text


def test_duplicate_search_batch_is_rejected_to_keep_lookup_scope_stable(sdk):
    sdk.responses = [model_response([
        tool('list_products', {'query': 'Basic'}),
        tool('list_products', {'query': 'Other'}),
    ])]
    status = ReadStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == []


def test_tool_batch_and_total_turn_budget_are_checked_before_dispatch(sdk):
    status = ReadStatus()
    sdk.responses = [model_response([tool('get_product', {'sku': str(i)})
                                     for i in range(5)])]
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == [] and len(sdk.calls) == 1
    sdk.calls.clear()

    sdk.responses = [model_response([
        tool('get_product', {'sku': f'BMB-{round_no}-{i}'})
        for i in range(3)]) for round_no in range(2)] + [
            model_response([tool('get_product_materials', {'sku': 'BMB-01'})])]
    status = ReadStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert raised.value.usage['calls'] == 3
    assert len(status.called) == 6 and len(sdk.calls) == 3
    assert all(name == 'get_product' for name, _ in status.called)


def test_unknown_tool_is_rejected_before_dispatch(sdk):
    sdk.responses = [model_response([tool('unknown')])]
    status = Status()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'invalid_response'
    assert status.called == [] and len(sdk.calls) == 1


def test_third_tool_can_handoff_card_without_fourth_model_call(sdk):
    sdk.responses = [model_response([tool('prepare')]) for _ in range(3)]
    status = Status()
    reply, usage = generate(status)
    assert reply == FORM_READY_REPLY
    assert len(sdk.calls) == 3 and len(status.called) == 3
    assert usage['attemptedCalls'] == usage['calls'] == 3
    assert usage['uncertainCalls'] == 0


def test_three_tools_without_card_stop_at_limit(sdk):
    class NoCard(Status):
        def will_show_product_guide(self):
            return False

    sdk.responses = [model_response([tool('prepare')]) for _ in range(3)]
    with pytest.raises(CloudError) as raised:
        generate(NoCard())
    assert raised.value.code == 'tool_limit'
    assert raised.value.usage['attemptedCalls'] == 3
    assert len(sdk.calls) == 3


def test_revoked_tool_permission_stops_without_another_model_call(sdk):
    sdk.responses = [model_response([tool('prepare')])]
    status = Status()
    status.revoked = True
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'permission_denied'
    assert status.called == [('prepare', {})]
    assert len(sdk.calls) == 1


def test_timeout_marks_one_uncertain_attempt_without_retry(sdk):
    sdk.responses = [TimeoutError()]
    with pytest.raises(CloudError) as raised:
        generate(Status())
    assert raised.value.code == 'google_unavailable'
    assert raised.value.usage['calls'] == 0
    assert raised.value.usage['attemptedCalls'] == 1
    assert raised.value.usage['uncertainCalls'] == 1
    assert len(sdk.calls) == 1
    assert sdk.closed


def test_quota_rejection_marks_attempt_without_retry(sdk):
    class QuotaError(Exception):
        code = 429

    sdk.responses = [QuotaError()]
    with pytest.raises(CloudError) as raised:
        generate(Status())
    assert raised.value.code == 'quota_exceeded'
    assert raised.value.usage['calls'] == 0
    assert raised.value.usage['attemptedCalls'] == 1
    assert raised.value.usage['uncertainCalls'] == 1
    assert len(sdk.calls) == 1 and sdk.closed


class FormStatus(Status):
    declarations = FORM_DECLARATIONS

    def __init__(self):
        super().__init__()
        self.conversation_forms = ConversationForms('fixture-request')

    def call(self, name, args):
        self.called.append((name, args))
        assert name == 'ask_user'
        return self.conversation_forms.ask(args)

    def will_show_product_guide(self):
        return False


VALID_FORM = {'title': 'Datos pendientes', 'fields': [
    {'id': 'nombre', 'label': 'Nombre del producto',
     'type': 'text', 'required': True}]}


@pytest.mark.parametrize('next_failure', ('quota', 'timeout'))
def test_valid_form_tool_is_prepared_for_route_to_present(sdk, next_failure):
    class QuotaError(Exception):
        code = 429

    failure = QuotaError() if next_failure == 'quota' else TimeoutError()
    sdk.responses = [model_response([tool('ask_user', VALID_FORM)], tokens=17),
                     failure]
    status = FormStatus()
    checkpoints = []
    reply, usage = generate(status,
        on_attempt=lambda ordinal: checkpoints.append(('attempt', ordinal)),
        on_complete=lambda ordinal, saved: checkpoints.append(
            ('complete', ordinal, saved['calls'])))
    assert reply == FORM_READY_REPLY
    assert status.conversation_forms.present()['title'] == 'Datos pendientes'
    assert usage == {'calls': 1, 'attemptedCalls': 1, 'uncertainCalls': 0,
                     'totalTokenCount': 17, 'formRepairCalls': 0}
    assert checkpoints == [('attempt', 1), ('complete', 1, 1)]
    assert len(sdk.calls) == 1


def test_natural_question_needs_no_form_or_second_runner_call(sdk):
    question = PRODUCT_SOURCES_FIELD['label']
    sdk.responses = [text(question)]
    status = FormStatus()
    reply, usage = generate(status)
    assert reply == question and usage['formRepairCalls'] == 0
    assert status.called == [] and status.conversation_forms.present() is None
    assert len(sdk.calls) == 1


def test_inline_origin_choice_has_natural_reply_and_one_runner_call(sdk):
    form = {'title': 'De dónde partimos', 'fields': [PRODUCT_SOURCES_FIELD]}
    sdk.responses = [model_response([tool('ask_user', form)])]
    status = FormStatus()
    reply, usage = generate(status)
    assert reply == PRODUCT_SOURCES_FIELD['label']
    assert status.conversation_forms.present()['presentation'] == 'inline_choice'
    assert usage['formRepairCalls'] == 0 and len(sdk.calls) == 1


def test_promised_form_without_control_retries_with_only_ask_user(sdk):
    sdk.responses = [text('Completa este formulario para continuar.'),
                     model_response([tool('ask_user', VALID_FORM)])]
    status = FormStatus()
    reply, usage = generate(status)
    assert reply == FORM_READY_REPLY
    assert status.called == [('ask_user', VALID_FORM)]
    assert status.conversation_forms.present()['title'] == 'Datos pendientes'
    assert usage['formRepairCalls'] == 1
    assert usage['attemptedCalls'] == usage['calls'] == 2
    assert len(sdk.calls) == 2
    config = sdk.calls[1][2]
    assert [entry.name for entry in config.tools[0].function_declarations] == ['ask_user']
    assert config.tool_config.function_calling_config.mode == 'ANY'
    assert config.tool_config.function_calling_config.allowed_function_names == ['ask_user']
    repair_input = '\n'.join(part.text for content in sdk.calls[1][1]
                             for part in content.parts or [] if isinstance(part.text, str))
    assert 'Completa este formulario para continuar.' in repair_input
    assert FORM_REPAIR_INSTRUCTION in repair_input


def test_invalid_form_is_repaired_before_another_business_tool(sdk):
    sdk.responses = [model_response([tool('ask_user', {'title': 'Sin campos'})]),
                     model_response([tool('ask_user', VALID_FORM)])]
    status = FormStatus()
    reply, usage = generate(status)
    assert reply == FORM_READY_REPLY
    assert status.conversation_forms.present()['title'] == 'Datos pendientes'
    assert len(status.called) == 2 and usage['formRepairCalls'] == 1
    assert len(sdk.calls) == 2
    config = sdk.calls[1][2]
    assert [entry.name for entry in config.tools[0].function_declarations] == ['ask_user']
    assert config.tool_config.function_calling_config.mode == 'ANY'
    assert any(part.text == FORM_REPAIR_INSTRUCTION
               for content in sdk.calls[1][1] for part in content.parts or [])


def test_invalid_form_then_question_fails_without_phantom_card(sdk):
    sdk.responses = [model_response([tool('ask_user', {'title': 'Sin campos'})]),
                     text('¿Qué producto quieres crear?')]
    status = FormStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'form_unavailable'
    assert status.conversation_forms.attempted
    assert status.conversation_forms.present() is None
    assert raised.value.usage['formRepairCalls'] == 1
    assert len(sdk.calls) == 2


def test_repair_rejects_other_tool_before_external_effect(sdk):
    class EffectfulForms(FormStatus):
        declarations = FORM_DECLARATIONS + Status.declarations

        def call(self, name, args):
            if name == 'ask_user':
                return super().call(name, args)
            self.called.append((name, args))
            return {'queued': True}

    sdk.responses = [text('Completa este formulario para continuar.'),
                     model_response([tool('prepare')])]
    status = EffectfulForms()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'form_unavailable'
    assert status.called == []
    assert raised.value.usage['formRepairCalls'] == 1
    assert len(sdk.calls) == 2


def test_external_effect_is_not_repeated_while_repairing_form(sdk):
    class EffectfulForms(FormStatus):
        declarations = FORM_DECLARATIONS + Status.declarations

        def call(self, name, args):
            if name == 'ask_user':
                return super().call(name, args)
            self.called.append((name, args))
            return {'queued': True}

    sdk.responses = [model_response([tool('prepare')]),
                     text('Completa este formulario para continuar.'),
                     model_response([tool('ask_user', VALID_FORM)])]
    status = EffectfulForms()
    reply, usage = generate(status)
    assert reply == FORM_READY_REPLY
    assert status.called == [('prepare', {}), ('ask_user', VALID_FORM)]
    assert usage['formRepairCalls'] == 1
    assert usage['attemptedCalls'] == usage['calls'] == 3
    assert [entry.name for entry in sdk.calls[2][2].tools[0].function_declarations] == ['ask_user']


def test_third_call_cannot_spawn_an_unbounded_form_repair(sdk):
    sdk.responses = [model_response([tool('ask_user', {'title': 'Sin campos'})])
                     for _ in range(3)]
    status = FormStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'form_unavailable'
    assert raised.value.usage['attemptedCalls'] == 3
    assert raised.value.usage['formRepairCalls'] == 2
    assert len(sdk.calls) == 3


def test_repair_quota_rejection_is_uncertain_and_does_not_repeat_effect(sdk):
    class QuotaError(Exception):
        code = 429

    sdk.responses = [text('Completa este formulario para continuar.'), QuotaError()]
    status = FormStatus()
    with pytest.raises(CloudError) as raised:
        generate(status)
    assert raised.value.code == 'quota_exceeded'
    assert status.called == []
    assert raised.value.usage == {'calls': 1, 'attemptedCalls': 2,
                                  'uncertainCalls': 1, 'totalTokenCount': 9,
                                  'formRepairCalls': 1}
    assert len(sdk.calls) == 2


def test_external_tool_effect_survives_later_model_timeout(sdk):
    effects = []

    class EffectfulStatus(Status):
        def call(self, name, args):
            effects.append((name, args))
            return {'queued': True}

    sdk.responses = [model_response([tool('prepare')]), TimeoutError()]
    with pytest.raises(CloudError) as raised:
        generate(EffectfulStatus())
    assert raised.value.code == 'google_unavailable'
    assert effects == [('prepare', {})]
    assert raised.value.usage['calls'] == 1
    assert raised.value.usage['attemptedCalls'] == 2
    assert raised.value.usage['uncertainCalls'] == 1
    assert len(sdk.calls) == 2
