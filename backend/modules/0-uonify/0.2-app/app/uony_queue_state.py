"""Small shared queue contracts, without model or application dependencies."""
from dataclasses import dataclass
import os


class LeaseLost(Exception):
    """The durable fencing token expired or was superseded."""


# A logical call may take two attempts in the written agent (hallazgo B):
# up to 6 attempts; a 429 attempt is a rejection, not a consumption, and a
# call that ends failed after a possible consumption is unresolved.
USAGE_LIMITS = {'calls': 3, 'attemptedCalls': 6, 'uncertainCalls': 6, 'rejectedCalls': 6,
                'unresolvedCalls': 3, 'formRepairCalls': 3, 'totalTokenCount': 1_000_000_000,
                # Plan B (lote 6): the second opinions before a read, by count and tokens.
                'readIntentCalls': 6, 'readIntentTokens': 1_000_000}


def safe_usage(raw):
    if not isinstance(raw, dict):
        return {}
    return {key: value for key, limit in USAGE_LIMITS.items()
            if type(value := raw.get(key)) is int and 0 <= value <= limit}


def merge_usage(raw, persisted):
    """Keep the durable prefix if a worker stops after a completion commit."""
    merged = safe_usage(raw)
    for key, value in safe_usage(persisted).items():
        merged[key] = max(merged.get(key, 0), value)
    return merged


def configured_int(name, default, minimum, maximum, env=None):
    value = (os.environ if env is None else env).get(name, str(default))
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be an integer') from None
    if not minimum <= parsed <= maximum:
        raise ValueError(f'{name} must be between {minimum} and {maximum}')
    return parsed


@dataclass(frozen=True)
class RecoveryPolicy:
    lease_seconds: int = 45
    heartbeat_seconds: int = 10
    max_preparation_claims: int = 3

    def __post_init__(self):
        if not 30 <= self.lease_seconds <= 300:
            raise ValueError('lease_seconds must be between 30 and 300')
        if not 5 <= self.heartbeat_seconds <= self.lease_seconds // 3:
            raise ValueError('heartbeat_seconds must allow at least three lease pulses')
        if not 1 <= self.max_preparation_claims <= 3:
            raise ValueError('max_preparation_claims must be between 1 and 3')

    @classmethod
    def from_environment(cls, env=None):
        return cls(
            configured_int('UONIFY_QUEUE_LEASE_SECONDS', 45, 30, 300, env),
            configured_int('UONIFY_QUEUE_HEARTBEAT_SECONDS', 10, 5, 100, env),
            configured_int('UONIFY_QUEUE_MAX_PREPARATION_CLAIMS', 3, 1, 3, env),
        )
