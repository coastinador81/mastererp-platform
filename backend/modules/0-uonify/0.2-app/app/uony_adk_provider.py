"""Opt-in ADK Gemini adapter for Uony's existing transactional chat contract.

ADK's Gemini model owns the Google client. Uonify keeps the bounded tool loop,
because BusinessTools is stateful and ADK's standard executor runs tool batches
concurrently. Nothing in an ADK event commits a product or a conversation.
"""

import asyncio

from .google_cloud_provider import CloudError
from .uony_form_guard import FORM_READY_REPLY, FORM_REPAIR_INSTRUCTION, form_ready_reply, requests_missing_form, without_unrequested_form, question_from_unrequested_form
from .uony_provider import LOCATION, MODEL, UonyProvider, connection_status, request_payload


def _model_for_request(token, project, model, types, model_type=None):
    if model_type is None:
        from google.adk.models.google_llm import Gemini
        model_type = Gemini
    from google.oauth2.credentials import Credentials

    return model_type(
        model=model,
        api_version='v1',
        use_interactions_api=False,
        retry_options=types.HttpRetryOptions(attempts=1),
        client_kwargs={
            'vertexai': True,
            'project': project,
            'location': LOCATION,
            'credentials': Credentials(token=token),
        },
    )


def _provider_error(error):
    """Preserve only public Google error categories; never expose SDK details."""
    status = getattr(error, 'code', None)
    if type(status) is int:
        return CloudError({401: 'reauthorize', 403: 'permission_denied',
                           404: 'model_unavailable', 429: 'quota_exceeded'}.get(status, 'google_unavailable'))
    return CloudError('google_unavailable')


class AdkGeminiProvider(UonyProvider):
    """Staged provider; selection remains with the existing UonyProvider.

    count_tokens deliberately inherits the current non-generating v1 request.
    generate is synchronous for the existing FastAPI route and builds an
    isolated ADK client/event loop for each authorized attempt.
    """

    def generate(self, token, project, history, status, model=MODEL, effort='medium'):
        if not isinstance(token, str) or not token or not isinstance(project, str) or not project:
            raise CloudError('google_unavailable')
        if model not in ('gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'):
            raise CloudError('model_unavailable')
        if effort not in ('low', 'medium', 'high'):
            raise CloudError('invalid_response')
        return asyncio.run(self._generate_async(token, project, history, status, model, effort))

    async def _generate_async(self, token, project, history, status, model, effort):
        usage = {'totalTokenCount': 0, 'calls': 0, 'attemptedCalls': 0,
                 'uncertainCalls': 0, 'formRepairCalls': 0}
        model_client = None
        try:
            from google.adk.models.llm_request import LlmRequest
            from google.genai import types

            payload = request_payload(history, status, effort)
            declarations = payload['tools'][0]['functionDeclarations']
            permitted = {entry['name'] for entry in declarations}
            forms = getattr(status, 'conversation_forms', None)
            can_ask = forms is not None and 'ask_user' in permitted
            contents = [types.Content.model_validate(item) for item in payload['contents']]
            model_client = _model_for_request(token, project, model, types)
            repair_form = False
            for attempt in range(3):
                available = ([entry for entry in declarations if entry['name'] == 'ask_user']
                             if repair_form else declarations)
                config = types.GenerateContentConfig(
                    system_instruction=payload['systemInstruction']['parts'][0]['text'],
                    max_output_tokens=2048,
                    automatic_continuation=False,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True),
                    thinking_config=types.ThinkingConfig(thinking_level=effort.upper()),
                    tools=[types.Tool(function_declarations=[
                        types.FunctionDeclaration.model_validate(entry) for entry in available
                    ])],
                    tool_config=(types.ToolConfig(function_calling_config=types.FunctionCallingConfig(
                        mode='ANY', allowed_function_names=['ask_user'])) if repair_form else None),
                    http_options=types.HttpOptions(
                        api_version='v1', timeout=60_000,
                        retry_options=types.HttpRetryOptions(attempts=1)),
                )
                if repair_form:
                    usage['formRepairCalls'] += 1
                response = None
                request = LlmRequest(model=model, contents=list(contents), config=config)
                usage['attemptedCalls'] += 1
                async for item in model_client.generate_content_async(request, stream=False):
                    if response is not None:
                        raise CloudError('invalid_response')
                    response = item
                if response is None:
                    raise CloudError('invalid_response')
                usage['calls'] += 1
                reported = getattr(getattr(response, 'usage_metadata', None), 'total_token_count', None)
                if reported is not None:
                    if type(reported) is not int or reported < 0:
                        raise CloudError('invalid_response')
                    usage['totalTokenCount'] += reported
                if response.error_code or not response.content or not response.content.parts:
                    raise CloudError('invalid_response')
                content = response.content
                calls = [part.function_call for part in content.parts if part.function_call]
                if calls:
                    if len(calls) > 3:
                        raise CloudError('invalid_response')
                    if not can_ask and len(calls) == 1 and calls[0].name == 'ask_user':
                        return question_from_unrequested_form(calls[0].args), usage
                    if repair_form and (len(calls) != 1 or calls[0].name != 'ask_user'):
                        raise CloudError('form_unavailable')
                    contents.append(content)
                    results = []
                    for call in calls:
                        name, args = call.name, call.args or {}
                        if not isinstance(args, dict) or name not in permitted:
                            raise CloudError('invalid_response')
                        if name == 'get_connection_status' and args == {}:
                            result = connection_status(status)
                        elif name != 'get_connection_status' and hasattr(status, 'call'):
                            result = status.call(name, args)
                        else:
                            raise CloudError('invalid_response')
                        results.append(types.Part(function_response=types.FunctionResponse(
                            name=name, response=result)))
                    contents.append(types.Content(role='user', parts=results))
                    if can_ask and forms.present():
                        return form_ready_reply(forms.present()), usage
                    if attempt == 2 and hasattr(status, 'will_show_product_guide') and status.will_show_product_guide():
                        return FORM_READY_REPLY, usage
                    if can_ask and forms.attempted and not forms.present():
                        repair_form = True
                    continue
                text = '\n'.join(part.text for part in content.parts
                                 if isinstance(part.text, str) and not part.thought).strip()
                if not text or response.finish_reason not in (
                        types.FinishReason.STOP, types.FinishReason.MAX_TOKENS):
                    raise CloudError('invalid_response')
                guide_pending = hasattr(status, 'will_show_product_guide') and status.will_show_product_guide()
                if repair_form or (can_ask and not guide_pending and not forms.present() and
                                   (forms.attempted or requests_missing_form(text))):
                    repair_form = True
                    contents.extend([content, types.Content(role='user', parts=[
                        types.Part(text=FORM_REPAIR_INSTRUCTION)])])
                    continue
                if not can_ask and not guide_pending and requests_missing_form(text):
                    text = without_unrequested_form(text)
                return text, usage
            raise CloudError('form_unavailable' if repair_form else 'tool_limit')
        except CloudError as error:
            usage['uncertainCalls'] = usage['attemptedCalls'] - usage['calls']
            error.usage = dict(usage)
            raise
        except Exception as error:
            safe = _provider_error(error)
            usage['uncertainCalls'] = usage['attemptedCalls'] - usage['calls']
            safe.usage = dict(usage)
            raise safe from None
        finally:
            if model_client is not None:
                try:
                    await model_client.api_client.aio.aclose()
                except Exception:
                    pass
