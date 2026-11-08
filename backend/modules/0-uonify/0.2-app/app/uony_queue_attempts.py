"""Model call checkpoints of a conversation job, with its attempts.

provider_attempt_count counts HTTP attempts; provider_completed_count, the
logical calls completed; provider_retry_count, the retries (hallazgo B,
«Consultor google» 21-10-2026: one per logical call in the written agent,
two after a 429 since lote 6).
Every attempt of the written agent is recorded in uony_provider_attempts
before it is sent (`meta` = model, thinking level and its timeout); the
spoken route keeps its counters without that log until F1.
"""
from psycopg.types.json import Jsonb

from .uony_call_policy import LOCATION, NOT_CONSUMED
from .uony_queue_state import LeaseLost, merge_usage, safe_usage


class ProviderAttempts:
    def _log_attempt(self, c, job, ordinal, attempt, meta):
        model, thinking_level, timeout_ms = meta
        c.execute('''INSERT INTO uony_provider_attempts(user_id,request_id,ordinal,attempt,model,
            location,thinking_level,timeout_ms) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',
            (job['user_id'], job['request_id'], ordinal, attempt, model, LOCATION,
             thinking_level, timeout_ms))

    def _close_attempt(self, c, job, ordinal, attempt, outcome, kind=None, code=None,
                       elapsed_ms=None, usage=None):
        return c.execute('''UPDATE uony_provider_attempts SET outcome=%s,error_kind=%s,http_code=%s,
            elapsed_ms=%s,usage=coalesce(%s,usage),finished_at=now()
            WHERE user_id=%s AND request_id=%s AND ordinal=%s AND attempt=%s AND outcome='started'
            RETURNING attempt''',
            (outcome, kind, code, elapsed_ms, Jsonb(usage) if usage is not None else None,
             job['user_id'], job['request_id'], ordinal, attempt)).fetchone()

    def _started(self, c, row, job, attempts):
        usage = safe_usage(row['usage'])
        usage.update(attemptedCalls=attempts, uncertainCalls=max(usage.get('uncertainCalls', 0), 1))
        c.execute("""UPDATE uony_conversation_jobs SET
            provider_started_at=coalesce(provider_started_at,now()),
            provider_attempt_count=%s,usage=%s,provisional_text='',
            progress_stage='consulting_google',progress_seq=progress_seq+1,
            updated_at=now() WHERE user_id=%s AND request_id=%s""",
            (attempts, Jsonb(usage), job['user_id'], job['request_id']))

    def stream_attempt(self, job, ordinal, meta=None):
        """The first attempt of a logical call, before it is sent."""
        if type(ordinal) is not int or not 1 <= ordinal <= 3:
            raise LeaseLost()
        with self.database.connect() as c:
            row = self.assert_lease(c, job)
            retries = row['provider_retry_count']
            if (row['provider_attempt_count'] != ordinal-1+retries or
                    row['provider_completed_count'] != ordinal-1):
                raise LeaseLost()
            self._started(c, row, job, row['provider_attempt_count']+1)
            if meta:
                self._log_attempt(c, job, ordinal, 1, meta)

    def stream_retry(self, job, ordinal, kind, code, elapsed_ms, meta, attempt=1):
        """The failed attempt `attempt` of this call and the start of the next,
        in one transaction, before it is sent. A third attempt only after a 429
        (lote 6, migration 128), within the job's caps: 3 retries, 6 attempts."""
        if attempt not in (1, 2) or (attempt == 2 and kind != 'api_429'):
            raise LeaseLost()
        with self.database.connect() as c:
            row = self.assert_lease(c, job)
            retries = row['provider_retry_count']
            if (retries >= 3 or row['provider_completed_count'] != ordinal-1 or
                    row['provider_attempt_count'] != ordinal+retries or
                    not self._close_attempt(c, job, ordinal, attempt, 'failed', kind, code, elapsed_ms)):
                raise LeaseLost()
            c.execute('''UPDATE uony_conversation_jobs SET provider_retry_count=provider_retry_count+1
                WHERE user_id=%s AND request_id=%s''', (job['user_id'], job['request_id']))
            self._started(c, row, job, row['provider_attempt_count']+1)
            self._log_attempt(c, job, ordinal, attempt+1, meta)

    def retries_left(self, job):
        """Retries this job may still record (3 per job): asked before waiting,
        so a fourth is never requested (lote 6: two after a 429)."""
        with self.database.connect() as c:
            return max(0, 3 - self.assert_lease(c, job)['provider_retry_count'])

    def stream_attempt_failed(self, job, ordinal, attempt, kind, code, elapsed_ms):
        """A final failed attempt; its job ends through terminal()."""
        with self.database.connect() as c:
            self.assert_lease(c, job)
            self._close_attempt(c, job, ordinal, attempt, 'failed', kind, code, elapsed_ms)

    def stream_complete(self, job, ordinal, raw_usage, attempt=None, elapsed_ms=None):
        with self.database.connect() as c:
            row = self.assert_lease(c, job)
            retries = row['provider_retry_count']
            if (row['provider_attempt_count'] != ordinal+retries or
                    row['provider_completed_count'] != ordinal-1):
                raise LeaseLost()
            usage = safe_usage(raw_usage)
            if usage.get('attemptedCalls') != ordinal+retries or usage.get('calls') != ordinal:
                raise LeaseLost()
            c.execute("""UPDATE uony_conversation_jobs SET
                provider_completed_count=%s,usage=%s,updated_at=now()
                WHERE user_id=%s AND request_id=%s""",
                (ordinal, Jsonb(usage), job['user_id'], job['request_id']))
            if attempt is not None:
                self._close_attempt(c, job, ordinal, attempt, 'completed', elapsed_ms=elapsed_ms,
                                    usage=usage)

    def stream_not_dispatched(self, job, ordinal, usage):
        """Settle a reservation only when its live caller never entered transport."""
        with self.database.connect() as c:
            row = self.assert_lease(c, job)
            if row['provider_attempt_count'] == ordinal and row['provider_completed_count'] == ordinal-1:
                c.execute('''UPDATE uony_conversation_jobs SET provider_attempt_count=%s,
                    usage=%s,provider_started_at=CASE WHEN %s=1 THEN NULL ELSE provider_started_at END,
                    updated_at=now() WHERE user_id=%s AND request_id=%s''',
                    (ordinal-1, Jsonb(safe_usage(usage)), ordinal, job['user_id'], job['request_id']))

    @staticmethod
    def attempt_uncertainty(c, job):
        """None without an attempt log (the spoken route keeps its counters).
        Otherwise `uncertain`: attempts that may have consumed without
        completing (still started, or failed other than by a 429); and
        `unresolved`: those of a call that never completed, which alone make
        the request unknown (a retry that completed resolves its call)."""
        row = c.execute('''SELECT count(*) AS n, count(*) FILTER (WHERE a.outcome='started'
              OR (a.outcome='failed' AND NOT coalesce(a.error_kind=ANY(%s),false))) AS uncertain,
            count(*) FILTER (WHERE (a.outcome='started'
              OR (a.outcome='failed' AND NOT coalesce(a.error_kind=ANY(%s),false)))
              AND NOT EXISTS (SELECT 1 FROM uony_provider_attempts done
                WHERE done.user_id=a.user_id AND done.request_id=a.request_id
                  AND done.ordinal=a.ordinal AND done.outcome='completed')) AS unresolved
            FROM uony_provider_attempts a WHERE a.user_id=%s AND a.request_id=%s''',
            (list(NOT_CONSUMED), list(NOT_CONSUMED), job['user_id'], job['request_id'])).fetchone()
        return None if not row['n'] else {'uncertain': row['uncertain'], 'unresolved': row['unresolved']}

    def settled_usage(self, c, job, usage, row=None):
        """Hallazgo B: the attempt log and the durable prefix are the truth.
        (usage crossed with the log, the log's counts or None), for fail() and
        for a turn that closed with its card after a failed last call (lote 8,
        1b): a success that keeps its uncertain call, counted once."""
        row = row or self.assert_lease(c, job)
        logged = self.attempt_uncertainty(c, job)
        if logged and isinstance(usage, dict):
            usage = {**merge_usage(usage, row['usage']), 'uncertainCalls': logged['uncertain'],
                     'unresolvedCalls': logged['unresolved']}
        return usage, logged
