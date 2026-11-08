"""Model call policy of the written agent («Consultor google», 21-10-2026,
hallazgo B: ESPEC-F1 §6.1 brought forward for text).

One retry per logical call for a transient Google error, two for a 429 (lote
6), inside one end-to-end deadline counted from the start of the agent (a
parked order may legitimately wait before it). A 429 is a rejection: nothing
was consumed; so is a 401 or 403, an authorization refusal before generating
(capa 2, D8), which ends the request with its step, never unknown. Any other
failure after dispatch (503, 504, 499, a timeout, a lost connection, a reply
the SDK could not hand over whole) is uncertain consumption, yet retryable: a
model call has no effect beyond its cost, since tools are dispatched apart
and are idempotent. This loop is the only one: no SDK or ADK retry options.
F1-S (lote 8): a streamed attempt has its own clock, since httpx gives a
stream no total limit: its first chunk within the attempt's timeout, all of
it within the deadline (StreamTimeout, uncertain like any timeout).
"""
import random
import re
import time
from dataclasses import dataclass

import httpx
from google.genai import errors as genai_errors

from .google_cloud_provider import CloudError

# The models the ADK agent may call, in one place («Consultor google»,
# 21-10-2026). Status and retirement per docs/conocimiento/vertex-gemini-models.md
# §5.1; thinking LOW/MEDIUM/HIGH only, never MINIMAL (3.8 Flash rejects it).
ALLOWED_AGENT_MODELS = frozenset({
    'gemini-3.5-flash',        # GA, 2026-05-19 → ≥2027-05-19.
    'gemini-3.5-flash-lite',   # GA, 2026-07-21 → ≥2027-07-21.
    'gemini-3.1-pro-preview',  # Preview since 2026-02-19: shorter life and capacity.
    'gemini-3.8-flash',        # GA, 2026-09-02 → ≥2027-09-02 (B2 n.º 3 candidate).
})
RETRYABLE_STATUS = frozenset({408, 429, 499, 500, 502, 503, 504})
REFUSED_STATUS = frozenset({401, 403})
NOT_CONSUMED = frozenset({'api_429', 'api_401', 'api_403'})
TEXT_DEADLINE_SECONDS = 60.0
# Lote 6 («Consultor google»): the longest completed call of B2 n.º 4 took
# 5,65 s and of C2 9,45 s; a stalled one waits for nothing past 20 s.
TEXT_ATTEMPT_TIMEOUT_MS = 20_000
MIN_ATTEMPT_SECONDS = 3
COMMIT_RESERVE_SECONDS = 2
LOCATION = 'global'
# A 429 burst outlasted one retry in B2 n.º 4 and C2: two for a 429 only, so
# three attempts of one call (migration 128), within the job's caps.
RETRIES_429 = 2
# Shapes of an answer the SDK could not hand over whole: retried once (a
# stream that ended without its last chunk too, F1-S, unless it showed text).
TRANSIENT_INVALID = frozenset({'no_response', 'multiple_responses', 'stream_cut'})
_TYPED_REASON = re.compile(r'^[a-z0-9_:]{1,40}$')


class StreamTimeout(Exception):
    """F1-S: a streamed attempt passed its own limit (first chunk or total)."""


def invalid(reason):
    """invalid_response with its typed reason (lote 6: kept in the log and the job)."""
    error = CloudError('invalid_response')
    error.reason = reason
    return error


def typed_reason(value):
    """A reason our code typed, safe to keep in provider_error_code; else None."""
    return value if isinstance(value, str) and _TYPED_REASON.match(value) else None


def typed_code(prefix, value):
    """prefix + an SDK enum's name (SAFETY, RECITATION…), typed for the job."""
    name = getattr(value, 'name', None) or str(value)
    return (prefix + re.sub(r'[^a-z0-9_]', '_', name.lower()))[:40]


@dataclass(frozen=True)
class CallPolicy:
    thinking_level: str
    timeout_ms: int
    retries_per_call: int
    deadline: float  # time.monotonic()

    @classmethod
    def written(cls, effort):
        return cls(effort.upper(), TEXT_ATTEMPT_TIMEOUT_MS, 1, time.monotonic() + TEXT_DEADLINE_SECONDS)

    def retries_for(self, kind):
        """Retries a call may take when its last attempt failed with `kind`."""
        if not self.retries_per_call:
            return 0
        return RETRIES_429 if kind == 'api_429' else self.retries_per_call

    def attempt_timeout_ms(self):
        """None when no whole attempt fits the deadline: then nothing is sent."""
        left = self.deadline - time.monotonic() - COMMIT_RESERVE_SECONDS
        if left < MIN_ATTEMPT_SECONDS:
            return None
        return min(self.timeout_ms, int(left * 1000))

    def remaining_ms(self):
        """F1-S: what a streamed attempt may last, its X-Server-Timeout too (Consultor:
        coherent with the total; a backstop, not the client's limit)."""
        return max(0, int((self.deadline - time.monotonic() - COMMIT_RESERVE_SECONDS) * 1000))

    def fits(self, wait):
        return time.monotonic() + wait + MIN_ATTEMPT_SECONDS + COMMIT_RESERVE_SECONDS <= self.deadline


def retry_kind(error):
    code = getattr(error, 'code', None)
    if isinstance(error, genai_errors.APIError) and type(code) is int and code in RETRYABLE_STATUS:
        return f'api_{code}'
    if isinstance(error, httpx.TimeoutException):
        return 'httpx_timeout'
    if isinstance(error, StreamTimeout):
        return 'stream_timeout'
    if isinstance(error, httpx.ConnectError):
        return 'httpx_connect'
    # A connection cut while sending or reading the answer (verification of
    # lote 3, H): a lost connection too, uncertain and retryable.
    if isinstance(error, (httpx.NetworkError, httpx.RemoteProtocolError)):
        return 'httpx_network'
    reason = getattr(error, 'reason', None)
    if isinstance(error, CloudError) and error.code == 'invalid_response' and reason in TRANSIENT_INVALID:
        return f'invalid_{reason}'
    return None


def refusal_kind(error):
    """A 401 or 403: refused before generating, whatever its reason; the
    reason (api_error_reason) only chooses the customer's step."""
    code = getattr(error, 'code', None)
    if isinstance(error, genai_errors.APIError) and type(code) is int and code in REFUSED_STATUS:
        return f'api_{code}'
    return None


def error_kind(error):
    return retry_kind(error) or refusal_kind(error) or type(error).__name__.lower()[:40]


def http_code(error):
    code = getattr(error, 'code', None)
    return code if type(code) is int and 100 <= code <= 599 else None


def backoff_seconds(kind, rng=random, retry=1):
    """1-2 s; after a 429, ~2 s and then ~6 s, with jitter (lote 6)."""
    if kind == 'api_429':
        return rng.uniform(1.5, 2.5) if retry == 1 else rng.uniform(5.0, 7.0)
    return rng.uniform(1.0, 2.0)
