"""Staged ADK LlmAgent/Runner coordinator using Uonify's existing tool authority.

This provider is deliberately opt-in. Uonify's request ledger, thread history,
product revisions and final transaction stay authoritative in PostgreSQL.
The ADK session exists only for one invocation and never becomes client memory.
"""

import asyncio
import logging
from uuid import uuid4

from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.base_tool import BaseTool
from google.genai import types
from pydantic import PrivateAttr

from .drive_read_tools import DRIVE_READ_NAMES
from .finance_read_tools import FINANCE_READ_NAMES, TURN_ENDING as FINANCE_TURN_ENDING, turn_empty_notice
from .google_cloud_provider import CloudError
from .google_setup_diagnostics import REASONS, api_error_reason
from .uony_adk_provider import _model_for_request, _provider_error
from .uony_form_guard import FORM_READY_REPLY, FORM_REPAIR_INSTRUCTION, form_ready_reply, requests_missing_form, without_unrequested_form, question_from_unrequested_form
from .uony_provider import MODEL, UonyProvider, connection_status, request_payload
from .uony_conversation_queue import LeaseLost
from .uony_call_policy import ALLOWED_AGENT_MODELS, invalid, typed_code
# The last of the three calls: always NONE, text only (lote 7); QA-06 kept in calls 1-2.
from .uony_last_call import (LAST_CALL_TOOLS, REPAIR_MODE, LastCall, batch_rejected,  # noqa: F401
                             log_last_call, reply_failure, unanswered, visible_text)
# Lote 8: the model with its retries and live text, in its own module.
from .uony_bounded_gemini import _BoundedGemini
from .uony_live_text import LiveText

logger = logging.getLogger(__name__)

# ADK dispatches a model's function calls concurrently. These four operations
# only read an owner-bound snapshot/DB state; all other BusinessTools either
# prepare an action, stage a write, or can reach an external system.
PARALLEL_READ_TOOLS = frozenset({
    'get_connection_status', 'list_products', 'get_product',
    'get_product_materials',
    # Drive reads are side-effect-free and safe to run in one parallel batch.
    # Without them here, the open Drive agent's normal multi-read turns (e.g.
    # list + count, or several listings) were rejected as mixed_or_effectful
    # and surfaced to the client as "La petición no terminó" (invalid_response).
    'list_drive_folders', 'list_drive_files',
    'get_drive_item', 'count_drive_folders', 'read_drive_document',
    # ERP · Finanzas: GET sin efectos (Consultor C5: con ello entran en LIVE_TEXT_TOOLS, el texto
    # progresivo escrito, nunca en la voz).
    'get_finance_context', 'list_finance_documents', 'get_finance_document',
})
# The four audited read kinds can be combined in one model response. The
# per-turn budget below still bounds repeated database work across responses.
MAX_TOOL_BATCH = 4
MAX_TOOL_CALLS = 6
# F1-S (lote 8, condition F): the model's text is shown as it is written only
# while the turn has run nothing but these. Their effects never replace the
# reply (a card goes with it); any other tool may prepare what finish() puts
# in its place, so from then on the reply comes whole.
LIVE_TEXT_TOOLS = PARALLEL_READ_TOOLS | {'request_drive_scope', 'show_connection',
                                         'show_amazon_connection'}


class _BusinessTool(BaseTool):
    """Delegate one declared call to the already owner-bound BusinessTools."""

    _dispatch_lock: asyncio.Lock = PrivateAttr()

    def __init__(self, declaration, status, dispatch_lock):
        super().__init__(name=declaration['name'], description=declaration.get('description', ''))
        self.declaration = types.FunctionDeclaration.model_validate(declaration)
        self.status = status
        self._dispatch_lock = dispatch_lock

    def _get_declaration(self):
        return self.declaration

    async def run_async(self, *, args, tool_context):
        # Some reads update the per-turn lookup cache used by a later write.
        # Serializing them avoids racing on that shared, account-bound object.
        async with self._dispatch_lock:
            # Lote 6: the turn's record of tools run, which decides whether an
            # uncertain failure had any effect beyond the model's cost.
            if hasattr(self.status, '__dict__'):  # A plain dict status has no attributes: nothing to count.
                self.status.tools_run = getattr(self.status, 'tools_run', 0) + 1
            if not isinstance(args, dict):
                raise invalid('tool_args')
            if self.name == 'get_connection_status':
                if args:
                    raise invalid('tool_args')
                return connection_status(self.status)
            if not hasattr(self.status, 'call'):
                raise invalid('tool_unavailable')
            result = self.status.call(self.name, args)
            if (self.name in FINANCE_READ_NAMES and isinstance(result, dict)
                    and result.get('error') in FINANCE_TURN_ENDING):
                # El ERP perdido o cambiado: su tarjeta y su texto, nunca los de Google Cloud.
                raise CloudError(result['error'])
            if isinstance(result, dict) and result.get('error') in (
                    'reauthorize', 'permission_denied', 'account_mismatch',
                    'connection_required', 'google_required'):
                # A lost Drive connection is not the model's access (capa 2):
                # the customer gets the Drive card, not Cloud's billing text.
                raise CloudError('drive_reconnect' if self.name in DRIVE_READ_NAMES
                                 else 'permission_denied')
            return result


class AdkAgentProvider(UonyProvider):
    """One-request ADK coordinator with the existing generate/count_tokens API."""

    def generate(self, token, project, history, status, model=MODEL, effort='medium',
                 *, on_attempt=None, on_complete=None, only_tools=None, instruction=None,
                 policy=None, ledger=None, on_text=None, on_clear=None):
        """only_tools/instruction make a restricted agent (D8): exactly those
        tools, and a rule added to Uony's instruction. on_text/on_clear: the
        reply as it is written (F1-S), for a written turn (with a policy)."""
        if not isinstance(token, str) or not token or not isinstance(project, str) or not project:
            raise CloudError('google_unavailable')
        if model not in ALLOWED_AGENT_MODELS:
            raise CloudError('model_unavailable')
        if effort not in ('low', 'medium', 'high'):
            raise invalid('effort')
        return asyncio.run(self._generate_async(
            token, project, history, status, model, effort, on_attempt, on_complete,
            only_tools, instruction, policy, ledger, on_text, on_clear))

    async def _generate_async(self, token, project, history, status, model, effort,
                              on_attempt, on_complete, only_tools=None, instruction=None,
                              policy=None, ledger=None, on_text=None, on_clear=None):
        usage = {'totalTokenCount': 0, 'calls': 0, 'attemptedCalls': 0,
                 'uncertainCalls': 0, 'formRepairCalls': 0}
        bounded_model = None
        try:
            # A policy comes with its attempt log and the request's own effort.
            if (policy is None) != (ledger is None) or (
                    policy is not None and policy.thinking_level != effort.upper()):
                raise invalid('policy')
            payload = request_payload(history, status, effort)
            declarations = payload['tools'][0]['functionDeclarations']
            if only_tools is not None:
                declarations = [entry for entry in declarations if entry['name'] in only_tools]
            system = payload['systemInstruction']['parts'][0]['text'] + (
                '\n' + instruction if instruction else '')
            declared = {entry['name'] for entry in declarations}
            if len(declared) != len(declarations):
                raise invalid('declarations')
            contents = [types.Content.model_validate(item) for item in history]
            if not contents or contents[-1].role != 'user':
                raise invalid('history')
            dispatch_lock = asyncio.Lock()
            tools = [_BusinessTool(entry, status, dispatch_lock) for entry in declarations]
            bounded_model = _model_for_request(
                token, project, model, types, model_type=_BoundedGemini)
            used = set()  # The tools this turn called: logged with the last call (lote 7).
            # 10-11-2026: if every ERP list of the turn came back empty, its fixed «No hay …» closes it.
            last_call = LastCall(declared, used, notice=turn_empty_notice)
            # F1-S: never in a form repair, nor after a tool whose effect replaces the reply.
            live = on_text and on_clear and LiveText(on_text, on_clear, lambda: (
                not repair_form and used <= LIVE_TEXT_TOOLS))
            bounded_model.set_usage(usage, on_attempt, on_complete, policy=policy, ledger=ledger,
                                    last_config=last_call.prepare, live=live or None)
            forms = getattr(status, 'conversation_forms', None)
            can_ask = forms is not None and 'ask_user' in declared
            ask_declaration = next((entry for entry in declarations
                                    if entry['name'] == 'ask_user'), None)
            repair_form = False
            repair_instruction_sent = False
            tool_calls = 0

            def reject_batch(reason, calls):
                raise batch_rejected(reason, calls, declared)

            def before_model(callback_context, llm_request):
                nonlocal repair_form, repair_instruction_sent
                # A tool that finishes the turn by itself (D8: an order left
                # in the queue) leaves its fixed reply; no other model call.
                if getattr(status, 'final_reply', None):
                    return LlmResponse(
                        content=types.Content(role='model', parts=[types.Part(text=status.final_reply)]),
                        finish_reason=types.FinishReason.STOP)
                if getattr(getattr(status, 'assignment', None), 'prepared', None):
                    return LlmResponse(
                        content=types.Content(role='model', parts=[
                            types.Part(text='El encargo está preparado para guardarse.')]),
                        finish_reason=types.FinishReason.STOP)
                if can_ask and forms.present():
                    return LlmResponse(
                        content=types.Content(role='model', parts=[
                            types.Part(text=form_ready_reply(forms.present() if can_ask else None))]),
                        finish_reason=types.FinishReason.STOP)
                if usage['calls'] < 3:
                    if can_ask and forms.attempted and not forms.present():
                        repair_form = True
                    if repair_form:
                        # Restrict the actual request, not just dispatch: an
                        # earlier tool may already have staged an effect.
                        llm_request.config.tools = [types.Tool(
                            function_declarations=[types.FunctionDeclaration.model_validate(
                                ask_declaration)])]
                        llm_request.config.tool_config = types.ToolConfig(
                            function_calling_config=types.FunctionCallingConfig(
                                mode='ANY', allowed_function_names=['ask_user']))
                        if not repair_instruction_sent:
                            llm_request.contents.append(types.Content(
                                role='user', parts=[types.Part(text=FORM_REPAIR_INSTRUCTION)]))
                            repair_instruction_sent = True
                        usage['formRepairCalls'] += 1
                    elif usage['calls'] == 2:  # The last call: text only (NONE, lote 7).
                        last_call.prepare(llm_request)
                    return None
                card = ((can_ask and forms.present()) or
                        (hasattr(status, 'will_show_product_guide') and
                         status.will_show_product_guide()))
                if card:
                    return LlmResponse(
                        content=types.Content(role='model', parts=[
                            types.Part(text=form_ready_reply(forms.present() if can_ask else None))]),
                        finish_reason=types.FinishReason.STOP)
                # Lote 7: the last call runs no tool, so only the form repair gets here.
                raise CloudError('form_unavailable' if repair_form else 'tool_limit')

            def after_model(callback_context, llm_response):
                nonlocal tool_calls
                calls = llm_response.get_function_calls()
                if usage['calls'] == 3 and not repair_form:  # Lote 7: own text, the card's or capa 2.
                    return last_call.reply(llm_response, calls, bounded_model._last_ms)
                if usage['calls'] == 3:  # D1: the form repair, ANY with ask_user only.
                    log_last_call(REPAIR_MODE, calls, declared, llm_response.finish_reason,
                                  bounded_model._last_ms, used=used)
                if llm_response.error_code:
                    logging.getLogger(__name__).warning(
                        'ADK agent response rejected: error_code=%s finish_reason=%s',
                        llm_response.error_code, getattr(llm_response, 'finish_reason', None))
                    raise invalid(typed_code('error_code:', llm_response.error_code))
                if not can_ask and len(calls) == 1 and calls[0].name == 'ask_user':
                    return LlmResponse(content=types.Content(role='model', parts=[
                        types.Part(text=question_from_unrequested_form(calls[0].args))]),
                        finish_reason=types.FinishReason.STOP)
                if repair_form and (len(calls) != 1 or calls[0].name != 'ask_user'):
                    raise CloudError('form_unavailable')
                if len(calls) > MAX_TOOL_BATCH:
                    reject_batch('batch_limit', calls)
                if tool_calls + len(calls) > MAX_TOOL_CALLS:
                    reject_batch('turn_limit', calls)
                if any(call.name not in declared or
                       not isinstance(call.args or {}, dict) or
                       (call.name == 'get_connection_status' and call.args)
                       for call in calls):
                    reject_batch('invalid_tool', calls)
                # Validate the whole response before ADK can dispatch any
                # member. Mixed read/action batches would otherwise allow a
                # partial write or interactive card to be prepared.
                if len(calls) > 1 and any(call.name not in PARALLEL_READ_TOOLS
                                          for call in calls):
                    reject_batch('mixed_or_effectful', calls)
                # list_products stores one search scope for a possible later
                # link action. Two searches in one ADK batch would make that
                # scope depend on task scheduling order.
                if sum(call.name == 'list_products' for call in calls) > 1:
                    reject_batch('duplicate_search', calls)
                tool_calls += len(calls)
                used.update(call.name for call in calls)
                if not calls:
                    failure = reply_failure(llm_response)
                    if failure:
                        raise failure
                    if repair_form and not forms.present():
                        raise CloudError('form_unavailable')
                return None

            config = types.GenerateContentConfig(
                # Pro with thinking_level=HIGH needs output room for the reasoning
                # plus the answer; keep it generous so a thinking turn is not truncated.
                max_output_tokens=8192,
                # The SDK otherwise follows CONTINUATION tokens with extra HTTP
                # requests hidden inside one Runner/model call.
                automatic_continuation=False,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(
                    disable=True),
                thinking_config=types.ThinkingConfig(thinking_level=effort.upper()),
                http_options=types.HttpOptions(
                    api_version='v1', timeout=60_000,
                    retry_options=types.HttpRetryOptions(attempts=1)))

            def make_agent(repair=False):
                return LlmAgent(
                    name='uonify_coordinator', model=bounded_model,
                    instruction=system,
                    generate_content_config=config,
                    tools=tools if not repair else [tool for tool in tools
                                                    if tool.name == 'ask_user'],
                    before_model_callback=before_model,
                    after_model_callback=after_model,
                )

            async def run(agent, context, message):
                service = InMemorySessionService()
                identity = uuid4().hex
                async with Runner(app_name='uonify_stage', agent=agent,
                                  session_service=service) as runner:
                    session = await service.create_session(
                        app_name='uonify_stage', user_id=identity,
                        session_id=identity)
                    reply = None
                    async for event in runner.run_async(
                            user_id=identity, session_id=session.id,
                            new_message=message,
                            run_config=RunConfig(max_llm_calls=3,
                                                 model_input_context=context)):
                        if event.is_final_response() and event.content:
                            reply = '\n'.join(part.text for part in event.content.parts or []
                                              if isinstance(part.text, str) and not part.thought).strip()
                return reply

            try:
                reply = await run(make_agent(), contents[:-1], contents[-1])
            except Exception as error:
                # 1b (lote 8): a written turn whose last call failed after a card.
                kind = (policy is not None and not repair_form and
                        last_call.after_failure(error, usage, bounded_model._last_ms))
                if not kind:
                    raise
                if hasattr(status, '__dict__'):  # finish() keeps the failed call's accounting.
                    status.closed_with_card = kind
                return last_call.card[1], usage
            guide = (hasattr(status, 'will_show_product_guide') and
                     status.will_show_product_guide())
            if (can_ask and not forms.present() and not guide and reply and
                    (forms.attempted or requests_missing_form(reply))):
                if usage['calls'] >= 3:
                    raise CloudError('form_unavailable')
                repair_form = True
                repair_instruction_sent = True
                repair_context = contents + [types.Content(
                    role='model', parts=[types.Part(text=reply)])]
                reply = await run(make_agent(repair=True), repair_context,
                                  types.Content(role='user', parts=[
                                      types.Part(text=FORM_REPAIR_INSTRUCTION)]))
            if repair_form and not forms.present():
                raise CloudError('form_unavailable')
            if not reply:
                raise unanswered('no_final_reply')
            if not can_ask and not guide and requests_missing_form(reply):
                reply = without_unrequested_form(reply)
            return reply, usage
        except CloudError as error:
            error.usage = dict(usage)
            raise
        except LeaseLost:
            raise
        except Exception as error:
            safe = _provider_error(error)
            # D8: the refusal's own reason, mapped (billing, API…); never its text.
            safe.reason = REASONS.get(api_error_reason(error))
            safe.usage = dict(usage)
            raise safe from None
        finally:
            if bounded_model is not None:
                try:
                    await bounded_model.api_client.aio.aclose()
                except Exception:
                    pass
