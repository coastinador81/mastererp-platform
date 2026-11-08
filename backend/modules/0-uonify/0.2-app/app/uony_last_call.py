"""The last of the three model calls of the written agent (F0-R1, QA-06, lote 7).

Lote 7 («Consultor google», 22-10-2026, revisiones/20261022-VEREDICTO-LOTE7-
ULTIMA-LLAMADA-NONE.md): the last call is ALWAYS NONE, text only. VALIDATED
there stalled for 17-27 s or ended in 504 (C2); NONE answers in 1,3-2 s.
Every declaration stays in the request (the history may hold their calls). The
cards (connection, intake, materials, ask_user) are asked for in calls 1-2;
the server shows what those calls prepared when the turn finishes. A short
note in that call's own system instruction (D4) tells the model it may only
write, so it never announces a card it can no longer show.

The last call never runs a tool. When it gives no valid answer (empty,
malformed, blocked, or calls it may not make) the reply is, in this order: the
model's own text, the fixed text of a card this turn already showed in calls
1-2 (QA-06 kept there, owner's list), or capa 2's text (agent_unanswered or
the typed invalid). D1: the one exception is the form repair, ANY with
ask_user only, logged as ANY_REPAIR. ADK 2.12.0 does not count an answer of
before_model against max_llm_calls (_model_call.py:194-211, before :227).

One log line per turn that reaches the last call (condition d): mode, the
last call's calls, the turn's tools, the card shown (or -), finish, time and
reason; only names our code declared, never arguments, text or IDs.

Lote 8, 1b («Consultor google» D3, revisiones/20261022-VEREDICTO-LOTE8-1B-
F1S.md): when Google fails the last call transiently (a 429, 504, timeout or a
cut answer, retries spent) after calls 1-2 showed a card, that card's fixed
text closes the turn, with no other model call (C4, closed_with_card:<kind>).
"""
import logging

from google.adk.models.llm_response import LlmResponse
from google.genai import types

from .connection_tools import PROVIDERS
from .google_cloud_provider import CloudError
from .uony_call_policy import invalid, retry_kind, typed_code

LAST_CALL_TOOLS = frozenset({
    'ask_user', 'show_amazon_connection', 'show_connection',
    'show_product_intake', 'show_product_materials',
})
# The cards with a fixed text; a form already closes the turn in before_model.
CARD_TOOLS = LAST_CALL_TOOLS - {'ask_user'}
LAST_CALL_MODE = 'NONE'
REPAIR_MODE = 'ANY_REPAIR'
# D4: the mechanism is the Consultor's; the owner may adjust the wording.
LAST_CALL_NOTE = (
    'Esta es tu última respuesta para este mensaje: escribe solo texto. No digas que '
    'muestras una tarjeta, ficha, formulario o conexión que no aparezca ya en la '
    'conversación; si falta, explica el paso y ofrécete a hacerlo en el siguiente mensaje.')
# The owner's list of fixed texts: what the customer reads with the card.
CLOSING_TEXTS = {
    'show_amazon_connection': 'Aquí tienes la conexión de Amazon.',
    'show_product_intake': 'Aquí tienes la ficha para completar los datos del producto.',
    'show_product_materials': 'Aquí tienes los materiales del producto.',
}


def last_call_tool_config():
    return types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode='NONE'))


def visible_text(response):
    """The non-thought text of a model response."""
    parts = (response.content.parts if response.content else None) or []
    return '\n'.join(part.text for part in parts
                     if isinstance(part.text, str) and not part.thought).strip()


def unanswered(reason):
    """No answer for the customer: capa 2's text, its typed reason in the job."""
    error = CloudError('agent_unanswered')
    error.reason = reason
    return error


def last_call_rejection(calls):
    """Why the last call's calls cannot run (a typed reason): it may run none."""
    if len(calls) > 1 and all(call.name in LAST_CALL_TOOLS for call in calls):
        return f'last_call_cards:{min(len(calls), 99)}'
    return 'last_call_not_allowed'


def _names(calls, declared):
    # Never model-supplied arguments, text, account IDs or unknown names.
    return ','.join(sorted(call.name if call.name in declared else '<undeclared>'
                           for call in calls)) or '-'


def log_last_call(mode, calls, declared, finish, elapsed_ms, reason=None, used=(), card=None):
    """Condition d: what the last call did, in a turn that reached it."""
    logging.getLogger(__name__).warning(
        'ADK last call mode=%s tools=%s turn_tools=%s card=%s finish=%s elapsed_ms=%s reason=%s',
        mode, _names(calls, declared),
        ','.join(sorted(name for name in used if name in declared)) or '-', card or '-',
        getattr(finish, 'name', finish), elapsed_ms, reason or '-')


def batch_rejected(reason, calls, declared):
    """A batch the server will not dispatch: invalid_response with its reason."""
    logging.getLogger('app.uony_adk_agent').warning(
        'adk_tool_batch_rejected reason=%s count=%d tools=%s', reason, len(calls),
        _names(calls, declared))
    return invalid(reason)


def reply_failure(response):
    """Why a reply without calls cannot end the turn, or None. An empty one,
    already asked again within the budget, reads capa 2's text (lote 6)."""
    text = visible_text(response)
    finish = getattr(response, 'finish_reason', None)
    if text and getattr(finish, 'name', finish) in ('STOP', 'MAX_TOKENS'):
        return None
    parts = (response.content.parts if response.content else None) or []
    logging.getLogger('app.uony_adk_agent').warning(
        'ADK agent empty/invalid response: finish_reason=%s text_len=%d parts=%d thoughts=%d',
        finish, len(text), len(parts), sum(1 for part in parts if getattr(part, 'thought', False)))
    return unanswered('empty_reply') if not text else invalid(typed_code('finish:', finish))


def closing_text(name, args):
    if name == 'show_connection':
        provider = PROVIDERS.get(args.get('provider')) if isinstance(args, dict) else None
        return f'Aquí tienes la conexión de {provider}.' if provider else None
    return CLOSING_TEXTS.get(name)


def turn_card(contents):
    """(name, fixed text) of the last card this turn showed in calls 1-2 and
    whose result came back without an error; (None, None) without one. The
    text is None when the owner's list has none for it (then capa 2)."""
    start = max((index for index, content in enumerate(contents) if content.role == 'user'
                 and any(isinstance(part.text, str) and part.text for part in content.parts or [])),
                default=-1)
    calls, card = {}, (None, None)
    for content in contents[start + 1:]:
        for part in content.parts or []:
            call, result = part.function_call, part.function_response
            if call and call.name in CARD_TOOLS:
                calls[call.id or call.name] = call
            if (result and result.name in CARD_TOOLS and isinstance(result.response, dict)
                    and 'error' not in result.response):
                shown = calls.get(result.id or result.name)
                card = (result.name, closing_text(result.name, shown.args if shown else None))
    return card


class LastCall:
    """The third call of a written turn: prepared in before_model, answered
    in after_model (lote 7)."""

    def __init__(self, declared, used):
        self.declared, self.used = declared, used  # used: the turn's tools, filled as it runs.
        self.card = (None, None)

    def prepare(self, llm_request):
        """NONE and the note for this request only; the card calls 1-2 showed."""
        llm_request.config.tool_config = last_call_tool_config()
        llm_request.append_instructions([LAST_CALL_NOTE])
        self.card = turn_card(llm_request.contents)

    def reply(self, response, calls, elapsed_ms):
        """None: the response ends the turn as it is. Else the answer that
        replaces it (own text, then the card's fixed text), or capa 2."""
        error = getattr(response, 'error_code', None)
        if error:
            failure = invalid(typed_code('error_code:', error))
        elif calls:
            failure = unanswered(last_call_rejection(calls))
        else:
            failure = reply_failure(response)
        name, card_text = self.card
        reason = failure and (getattr(failure, 'reason', None) or failure.code)
        log_last_call(LAST_CALL_MODE, calls, self.declared, response.finish_reason, elapsed_ms,
                      reason, self.used, name)
        if failure is None:
            return None
        finish = getattr(response.finish_reason, 'name', response.finish_reason)
        own = (visible_text(response)
               if calls and not error and finish in ('STOP', 'MAX_TOKENS') else '')
        answer = own or card_text
        if not answer:
            raise failure
        return LlmResponse(content=types.Content(role='model', parts=[types.Part(text=answer)]),
                           finish_reason=types.FinishReason.STOP)

    def after_failure(self, error, usage, elapsed_ms=None):
        """1b: the kind of a transient failure of the prepared last call, when
        calls 1-2 showed a card with its fixed text; else None (capa 2 as
        before). A 401/403 keeps its access step, and LeaseLost, tool_limit,
        form_unavailable, drive_reconnect or agent_unanswered are no transient
        Google failure (retry_kind is None for them)."""
        name, text = self.card
        kind = retry_kind(error) or (
            'deadline_exceeded' if isinstance(error, CloudError)
            and error.code == 'deadline_exceeded' else None)
        if not (name and text and kind and usage.get('calls') == 2):
            return None
        log_last_call(LAST_CALL_MODE, (), self.declared, None, elapsed_ms,
                      f'closed_with_card:{kind}', self.used, name)
        return kind
