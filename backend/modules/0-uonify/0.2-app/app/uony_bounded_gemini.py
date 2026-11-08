"""The written agent's model: its call budget, retries, attempt log and live text.

Moved out of uony_adk_agent in lote 8 (≤500 lines; uony_adk_agent re-exports
it). One logical call is `_call`, with the lote 6 retries; one HTTP attempt is
`_attempt`.

F1-S («Consultor google», revisiones/20261022-VEREDICTO-LOTE8-1B-F1S.md): with
a LiveText whose turn may show text, an attempt streams inside this class only
(no RunConfig SSE). ADK still gets one response: the aggregate, made what the
unary reply would have been (LlmResponse.create), so after_model, LastCall,
max_llm_calls and the empty-reply policy do not change. httpx gives a stream
no total limit, so the attempt has its own: the first chunk within the
attempt's timeout (20 s), all of it within the deadline (60 s), whose rest is
also its X-Server-Timeout. An attempt that already showed text is never sent
again (D, AI-17): the text goes and the call ends failed, capa 2 as today.
"""
import asyncio
import logging
import time
from contextlib import aclosing

from google.adk.features import FeatureName, is_feature_enabled
from google.adk.models.google_llm import Gemini
from google.genai import types
from pydantic import PrivateAttr

from .google_cloud_provider import CloudError
from .uony_call_policy import (NOT_CONSUMED, StreamTimeout, backoff_seconds, error_kind,
                               http_code, invalid, retry_kind)
from .uony_conversation_queue import LeaseLost
from .uony_last_call import visible_text

logger = logging.getLogger('app.uony_adk_agent')


def progressive():
    """REA (22-10-2026): ADK keeps a stream's function calls in its aggregate
    only in its progressive SSE mode (experimental, on by default). Without it
    nothing streams: the turn takes the unary path, as before lote 8."""
    return is_feature_enabled(FeatureName.PROGRESSIVE_SSE_STREAMING)


def unary(response):
    """The stream's aggregate as the unary reply: a finish reason with content
    is no error there (MAX_TOKENS stays a valid partial answer, lote 7 C3)."""
    if response is None:
        raise invalid('no_response')
    if (response.content and response.content.parts and response.error_code is not None
            and response.error_code == response.finish_reason):
        response.error_code = response.error_message = None
    return response


def _forces_function_call(request):
    """Invariante (Consultor, 2026-10-22): la NONE de la última llamada (LastCall.prepare) NUNCA
    debe sobrescribir un tool_config que el emisor ya fijó a ANY (una llamada FORZADA). Se mira el
    tool_config del propio request, no un flag de reparación, así que preserva CUALQUIER llamada
    forzada a ANY. Hoy el único emisor de ANY es la reparación de formulario (before_model,
    uony_adk_agent.py:195-197, allowed_function_names=['ask_user']); machacarla a NONE dejaría al
    modelo sin poder llamar ask_user y el turno acabaría en form_unavailable."""
    config = getattr(request, 'config', None)
    tool_config = getattr(config, 'tool_config', None)
    fcc = getattr(tool_config, 'function_calling_config', None)
    mode = getattr(fcc, 'mode', None)
    return getattr(mode, 'name', mode) == 'ANY'


class _BoundedGemini(Gemini):
    _usage: dict = PrivateAttr(default_factory=dict)
    _on_attempt: object = PrivateAttr(default=None)
    _on_complete: object = PrivateAttr(default=None)
    _policy: object = PrivateAttr(default=None)
    _ledger: object = PrivateAttr(default=None)
    _last_config: object = PrivateAttr(default=None)
    _live: object = PrivateAttr(default=None)
    _last_ms: int = PrivateAttr(default=0)

    def set_usage(self, usage, on_attempt=None, on_complete=None, policy=None, ledger=None,
                  last_config=None, live=None):
        """policy and ledger (hallazgo B): the written agent's retries, with
        every attempt recorded through the ledger before it is sent.
        last_config: prepares the last call (lote 7), for a call asked again here.
        live: what the customer sees while a call writes (F1-S, with a policy only)."""
        self._usage = usage
        self._on_attempt = on_attempt
        self._on_complete = on_complete
        self._policy = policy
        self._ledger = ledger
        self._last_config = last_config
        self._live = live if policy is not None else None

    async def generate_content_async(self, request, stream=False):
        # The budget counts logical calls; a retry belongs to its call (ESPEC-F1 §6.4).
        if stream or self._usage['calls'] >= 3:
            raise CloudError('tool_limit')
        # ADK merges agent/run configs and can drop these SDK-only controls.
        # Set them on the final LlmRequest immediately before the SDK call.
        if request.config is None:
            raise CloudError('invalid_response')
        request.config.automatic_continuation = False
        request.config.automatic_function_calling = types.AutomaticFunctionCallingConfig(
            disable=True)
        while True:
            collected = await self._call(request)
            # Gemini occasionally emits an unparseable function call, or (lote
            # 6) a reply with nothing in it. That call is already accounted and
            # logged; ask again within the same three-call budget instead of
            # failing the turn (20-10-2026, spoken Drive turn).
            malformed = str(getattr(collected, 'error_code', None) or '').endswith(
                'MALFORMED_FUNCTION_CALL')
            empty = (not getattr(collected, 'error_code', None)
                     and not collected.get_function_calls() and not visible_text(collected))
            if (malformed or empty) and self._usage['calls'] < 3:
                logger.warning(
                    'ADK agent %s, retrying attempt=%s',
                    'malformed function call' if malformed else 'empty reply',
                    self._usage['attemptedCalls'])
                if (self._usage['calls'] == 2 and self._last_config
                        and not _forces_function_call(request)):
                    self._last_config(request)
                continue
            yield collected
            return

    async def _call(self, request):
        """One logical call. With a policy, one retry of a transient Google
        error that fits the deadline, two after a 429 (lote 6): the same
        request (contents and thought signatures); no tool runs before the
        completion checkpoint. Never again once it showed text (F1-S, D)."""
        ordinal = self._usage['calls'] + 1
        attempt, failures = 1, []
        while True:
            timeout_ms = None
            streamed = bool(self._live and self._live.allowed() and progressive())
            if self._policy:
                timeout_ms = self._policy.attempt_timeout_ms()
                if timeout_ms is None:  # No whole attempt fits: nothing is sent.
                    if not failures:
                        raise CloudError('deadline_exceeded')
                    self._unresolved(*(failure[1] for failure in failures))
                    self._ledger.failed(ordinal, attempt - 1, *failures[-1][1:])
                    raise failures[-1][0]
                request.config.http_options = types.HttpOptions(
                    api_version='v1',
                    timeout=self._policy.remaining_ms() if streamed else timeout_ms,
                    retry_options=types.HttpRetryOptions(attempts=1))
            # The durable record precedes the SDK's HTTP call.
            if self._ledger:
                if attempt == 1:
                    self._ledger.attempt(ordinal, timeout_ms)
                else:
                    self._ledger.retry(ordinal, *failures[-1][1:], timeout_ms, attempt=attempt - 1)
            elif self._on_attempt:
                self._on_attempt(ordinal)
            started = time.monotonic()
            try:
                return await self._attempt(request, ordinal, attempt, started,
                                           timeout_ms if streamed else None)
            except LeaseLost:
                raise
            except Exception as error:
                elapsed = round((time.monotonic() - started) * 1000)
                shown = streamed and self._live.drop()
                kind, code = error_kind(error), http_code(error)
                wait = (backoff_seconds(kind, retry=attempt)
                        if retry_kind(error) and not shown else None)
                if (wait is not None and self._policy and
                        attempt <= self._policy.retries_for(kind) and self._policy.fits(wait)
                        and (not self._ledger or self._ledger.retries_left() > 0)):
                    failures.append((error, kind, code, elapsed))
                    await asyncio.sleep(wait)
                    attempt += 1
                    continue
                self._unresolved(kind, *(failure[1] for failure in failures))
                if self._ledger:
                    self._ledger.failed(ordinal, attempt, kind, code, elapsed)
                raise

    def _unresolved(self, *kinds):
        """A call that ends failed stays unresolved if an attempt of it may have
        consumed: the request is then unknown. A retry that completes resolves
        its call; the failed attempt still counts in uncertainCalls."""
        if any(kind and kind not in NOT_CONSUMED for kind in kinds):
            self._usage['unresolvedCalls'] = self._usage.get('unresolvedCalls', 0) + 1

    async def _attempt(self, request, ordinal, attempt, started, first_chunk_ms=None):
        self._usage['attemptedCalls'] += 1
        completed = rejected = False
        collected = None
        try:
            if first_chunk_ms:
                collected = await self._streamed(request, ordinal, attempt, first_chunk_ms)
            else:
                async for response in super().generate_content_async(request, stream=False):
                    if collected is not None:
                        raise invalid('multiple_responses')
                    collected = response
            if collected is None:
                raise invalid('no_response')
            reported = getattr(getattr(collected, 'usage_metadata', None),
                               'total_token_count', None)
            if reported is not None and (type(reported) is not int or reported < 0):
                raise invalid('bad_usage')
            completed_usage = {**self._usage, 'calls': ordinal,
                'totalTokenCount': self._usage['totalTokenCount'] + (reported or 0)}
            if self._ledger:
                self._ledger.completed(ordinal, attempt, completed_usage,
                                       round((time.monotonic() - started) * 1000))
            elif self._on_complete:
                self._on_complete(ordinal, completed_usage)
            self._usage.update(completed_usage)
            completed = True
            # Runner cannot inspect the reply or dispatch a tool until the
            # completion checkpoint has committed.
            return collected
        except Exception as error:
            rejected = error_kind(error) in NOT_CONSUMED  # A 429, or a 401/403 with its reason.
            raise
        finally:
            if not completed:
                key = 'rejectedCalls' if rejected else 'uncertainCalls'
                self._usage[key] = self._usage.get(key, 0) + 1
            # ADK-FLUJOS §13: wall clock and observed usage per call, counts
            # only (real voice, 20-10-2026: one call took 2 s, another 33 s).
            meta = getattr(collected, 'usage_metadata', None)
            self._last_ms = round((time.monotonic() - started) * 1000)
            logger.warning('ADK agent model call ordinal=%d attempt=%d model=%s completed=%s '
                'elapsed_ms=%d prompt=%s output=%s thoughts=%s total=%s', ordinal, attempt,
                self.model, completed, self._last_ms,
                *(getattr(meta, key, None) for key in ('prompt_token_count',
                  'candidates_token_count', 'thoughts_token_count', 'total_token_count')))

    async def _streamed(self, request, ordinal, attempt, first_chunk_ms):
        """One streamed attempt: its text shown as it comes, its aggregate returned."""
        live, final, first = self._live, None, None
        live.start(request)
        loop = asyncio.get_running_loop()
        opened = loop.time()
        total = opened + self._policy.remaining_ms() / 1000
        limit = asyncio.timeout_at(min(total, opened + first_chunk_ms / 1000))
        try:
            async with limit:
                async with aclosing(super().generate_content_async(request, stream=True)) as chunks:
                    async for response in chunks:
                        if first is None:  # Only the total is left once the stream answers.
                            first = round((loop.time() - opened) * 1000)
                            limit.reschedule(total)
                        if response.partial:
                            live.feed(response)
                        elif final is not None:
                            raise invalid('multiple_responses')
                        else:
                            final = response
        except TimeoutError:
            if not limit.expired():
                raise
            raise StreamTimeout('total' if first is not None else 'first_chunk') from None
        finally:
            # Counts only: never the text.
            logger.warning('ADK agent live text ordinal=%d attempt=%d first_chunk_ms=%s '
                           'writes=%d chars=%d', ordinal, attempt, first, live.writes,
                           len(live.shown))
        final = unary(final)
        if final.finish_reason is None and final.error_code is None and visible_text(final):
            # It ended without its last chunk: never an apparently whole answer.
            raise invalid('stream_cut')
        return final
