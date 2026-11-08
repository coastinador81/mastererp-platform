"""The three model calls of one job, shared by an earlier step and the agent.

A spoken recovery (the interpreter's voice route, until F1-7a) re-interprets
its original with the job's first ordinal; the agent then takes the rest of
the same three-call budget. A written job has no earlier step (QA-03): offset
0, so the agent uses its own ordinals. No classifier lives here.

AttemptLedger (hallazgo B, «Consultor google» 21-10-2026) records each attempt
of the written agent in uony_provider_attempts before it is sent; a retry is
recorded with the failure it repeats, in one transaction.
"""
from .google_cloud_provider import CloudError


class CallAccounting:
    def __init__(self, worker, job):
        self.worker, self.job = worker, job
        self.offset, self.usage = 0, {}

    def total(self, reported):
        if not self.offset:
            return reported
        if not isinstance(reported, dict):
            with self.worker.database.connect() as c:
                row = c.execute('''SELECT usage FROM uony_conversation_jobs
                    WHERE user_id=%s AND request_id=%s''',
                    (self.job['user_id'], self.job['request_id'])).fetchone()
            return row['usage'] if row else self.usage
        keys = set(self.usage) | set(reported)
        return {key: self.usage.get(key, 0) + reported.get(key, 0) for key in keys
                if type(self.usage.get(key, 0)) is int and type(reported.get(key, 0)) is int}

    def reserve(self, ordinal):
        if ordinal + self.offset > 3:
            raise CloudError('tool_limit')
        self.worker.queue.stream_attempt(self.job, ordinal + self.offset)

    def complete(self, ordinal, reported):
        self.worker.queue.stream_complete(self.job, ordinal + self.offset, self.total(reported))

    def ledger(self, model, policy, on_start):
        """The written agent's attempt log; on_start runs once the first attempt is recorded."""
        return AttemptLedger(self, (model, policy.thinking_level), on_start)


class AttemptLedger:
    def __init__(self, accounting, meta, on_start):
        self.accounting, self.meta, self.on_start = accounting, meta, on_start

    def _ordinal(self, ordinal):
        if ordinal + self.accounting.offset > 3:
            raise CloudError('tool_limit')
        return ordinal + self.accounting.offset

    def attempt(self, ordinal, timeout_ms):
        accounting = self.accounting
        accounting.worker.queue.stream_attempt(accounting.job, self._ordinal(ordinal),
                                               (*self.meta, timeout_ms))
        self.on_start()

    def retries_left(self):
        accounting = self.accounting
        return accounting.worker.queue.retries_left(accounting.job)

    def retry(self, ordinal, kind, code, elapsed_ms, timeout_ms, attempt=1):
        accounting = self.accounting
        accounting.worker.queue.stream_retry(accounting.job, self._ordinal(ordinal), kind, code,
                                             elapsed_ms, (*self.meta, timeout_ms), attempt=attempt)

    def failed(self, ordinal, attempt, kind, code, elapsed_ms):
        accounting = self.accounting
        accounting.worker.queue.stream_attempt_failed(accounting.job, self._ordinal(ordinal),
                                                      attempt, kind, code, elapsed_ms)

    def completed(self, ordinal, attempt, usage, elapsed_ms):
        accounting = self.accounting
        accounting.worker.queue.stream_complete(accounting.job, self._ordinal(ordinal),
                                                accounting.total(usage), attempt, elapsed_ms)
