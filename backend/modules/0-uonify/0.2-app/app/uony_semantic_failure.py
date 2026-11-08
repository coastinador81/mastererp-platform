"""Typed semantic failures and one deadline shared by Live admission phases."""
import asyncio
from contextvars import ContextVar
from dataclasses import dataclass, field
import time
import math

SEMANTIC_SECONDS = 20.0
# Existing SDK close is bounded to 1 s. Observed local receipt writes are <100 ms;
# reserve 200 ms (2x that observation), then measure again on each candidate.
CLOSE_RESERVE_SECONDS = 1.0
PERSIST_RESERVE_SECONDS = .2
RESERVE_SECONDS = CLOSE_RESERVE_SECONDS + PERSIST_RESERVE_SECONDS
PHASES = frozenset({'dependency', 'preparation', 'authentication',
    'connection_revalidation', 'classification', 'client_setup', 'client_close', 'request_setup',
    'provider_wait', 'response_validation', 'decision_validation', 'persist_success',
    'persist_failure', 'admission', 'delivery'})
CATEGORIES = frozenset({'provider', 'timeout', 'invalid_response', 'preparation', 'admission',
    'dependency', 'persistence', 'internal'})
CODES = frozenset({'semantic_timeout', 'semantic_dependency_timeout',
    'semantic_invalid_response', 'semantic_preparation_failed',
    'semantic_persistence_failed', 'semantic_internal_error', 'google_unavailable',
    'reauthorize', 'permission_denied', 'model_unavailable', 'quota_exceeded',
    'semantic_admission_unknown', 'semantic_admission_failed'})
MESSAGES = {
    'timeout': 'La interpretación de esta petición agotó el tiempo disponible. No he iniciado ninguna acción. La solicitud se conserva; no la repetiré automáticamente.',
    'dependency': 'La petición anterior no terminó de resolverse a tiempo. No he procesado esta petición ni iniciado una acción. La solicitud se conserva; no la repetiré automáticamente.',
}
DEFAULT_MESSAGE = 'No pude interpretar esta petición por un fallo técnico. No he iniciado ninguna acción. La solicitud se conserva; no la repetiré automáticamente.'
CURRENT_BUDGET = ContextVar('uony_semantic_budget', default=None)


class SemanticDeadlineExceeded(TimeoutError):
    pass


@dataclass
class SemanticBudget:
    started: float = field(default_factory=time.monotonic)
    seconds: float = SEMANTIC_SECONDS
    active: bool = True

    @property
    def expires_at(self):
        return time.time() + self.remaining()

    @property
    def deadline(self):
        return self.started + self.seconds

    def remaining(self, reserve=0):
        return max(0., self.deadline - time.monotonic() - reserve)

    def require(self):
        if not self.active or self.remaining() <= 0:
            raise SemanticDeadlineExceeded('semantic deadline expired')

    def invalidate(self):
        self.active = False


def require_semantic_budget():
    budget = CURRENT_BUDGET.get()
    if budget is not None:
        budget.require()


def require_receipt_budget(usage):
    """Persisted expiry also fences replay after a socket/process is replaced."""
    expiry = usage.get('semanticDeadlineAt') if isinstance(usage, dict) else None
    if expiry is None:
        return  # Historical receipts predate the deadline contract.
    if (type(expiry) not in (int, float) or not math.isfinite(expiry)
            or expiry <= time.time()):
        raise SemanticDeadlineExceeded('semantic receipt deadline expired')


def consume_task(task):
    """Retrieve a fenced task's exception without waiting for uncooperative I/O."""
    if not task.cancelled():
        task.exception()


def merge_semantic_usage(previous, incoming):
    previous = previous if isinstance(previous, dict) else {}
    incoming = incoming if isinstance(incoming, dict) else {}
    merged = dict(previous)
    for key in ('attemptedCalls', 'calls', 'totalTokenCount'):
        values = [item[key] for item in (previous, incoming)
                  if type(item.get(key)) is int and item[key] >= 0]
        if values:
            merged[key] = max(values)
    if 'attemptedCalls' in merged or 'uncertainCalls' in previous or 'uncertainCalls' in incoming:
        merged['uncertainCalls'] = max(0, merged.get('attemptedCalls', 0) - merged.get('calls', 0),
            *([item['uncertainCalls'] for item in (previous, incoming)
               if type(item.get('uncertainCalls')) is int and item['uncertainCalls'] >= 0]
              if not merged.get('calls') else []))
    return merged


async def bounded(awaitable, seconds, *, budget=None):
    task = asyncio.create_task(awaitable)
    try:
        done, _ = await asyncio.wait((task,), timeout=max(0., seconds))
        if not done:
            if budget:
                budget.invalidate()
            raise SemanticDeadlineExceeded('semantic deadline expired')
        return task.result()
    finally:
        if not task.done():
            if budget:
                budget.invalidate()
            task.cancel()
            task.add_done_callback(consume_task)


@dataclass(frozen=True)
class SemanticFailure:
    category: str
    phase: str
    code: str
    provider_code: int | None = None
    usage: dict = field(default_factory=dict, compare=False)

    @classmethod
    def from_error(cls, error, phase='classification'):
        from .uony_semantic_classifier import semantic_error_diagnostics
        details = semantic_error_diagnostics(error)
        phase = details.get('classifierPhase', getattr(error, 'semantic_phase', phase))
        phase = phase if isinstance(phase, str) and phase in PHASES else 'classification'
        raw_code = details.get('providerCode')
        provider_code = raw_code if type(raw_code) is int and 400 <= raw_code <= 599 else None
        if phase == 'dependency':
            category, code = 'dependency', 'semantic_dependency_timeout'
        elif isinstance(error, TimeoutError) or details['errorClass'] in ('TimeoutError', 'ReadTimeout', 'ConnectTimeout'):
            category, code = 'timeout', 'semantic_timeout'
        elif phase in ('persist_success', 'persist_failure'):
            category, code = 'persistence', 'semantic_persistence_failed'
        elif raw_code == 'invalid_response' or phase in ('response_validation', 'decision_validation'):
            category, code = 'invalid_response', 'semantic_invalid_response'
        elif provider_code or raw_code in CODES:
            category, code = 'provider', raw_code if raw_code in CODES else 'google_unavailable'
        elif phase in ('preparation', 'authentication', 'connection_revalidation'):
            category, code = 'preparation', 'semantic_preparation_failed'
        else:
            category, code = 'internal', 'semantic_internal_error'
        usage = getattr(error, 'usage', {})
        usage = {key: value for key in ('attemptedCalls', 'calls', 'uncertainCalls', 'totalTokenCount')
                 if isinstance(usage, dict) and type(value := usage.get(key)) is int and value >= 0}
        return cls(category, phase, code, provider_code, usage)

    def payload(self):
        admission = self.category == 'admission'
        uncertain = self.code == 'semantic_admission_unknown'
        message = (('He interpretado la petición, pero no puedo confirmar si llegó a iniciarse. '
            'La solicitud se conserva; hay que comprobar su estado antes de volver a ejecutarla.')
            if uncertain else ('He interpretado la petición, pero no pudo iniciarse la acción. '
            'La solicitud se conserva; no la repetiré automáticamente.')) if admission else (
            MESSAGES.get(self.category, DEFAULT_MESSAGE))
        return {'category': self.category, 'phase': self.phase, 'code': self.code,
            'message': message, 'interpretation': 'succeeded' if admission else 'failed',
            'execution': 'unknown' if uncertain else 'not_started', 'delivery': 'text_only',
            **({'providerCode': self.provider_code} if self.provider_code else {})}


def saved_semantic_failure(usage):
    value = usage.get('semanticFailure') if isinstance(usage, dict) else None
    if not isinstance(value, dict):
        return None
    if any(not isinstance(value.get(key), str) or value[key] not in allowed
           for key, allowed in (('category', CATEGORIES), ('phase', PHASES), ('code', CODES))):
        return None
    admission_code = value['code'] in ('semantic_admission_unknown', 'semantic_admission_failed')
    if (value['category'] == 'admission') != admission_code or (admission_code and value['phase'] != 'admission'):
        return None
    code = value.get('providerCode')
    failure = SemanticFailure(value['category'], value['phase'], value['code'],
        code if type(code) is int and 400 <= code <= 599 else None)
    return {**failure.payload(), 'persistence': 'saved'}
