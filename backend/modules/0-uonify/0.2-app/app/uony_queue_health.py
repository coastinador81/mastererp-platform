"""Worker liveness and bounded, content-free operational alerts."""
from contextlib import contextmanager
import logging
from threading import Event, Lock, Thread
from time import monotonic
from .uony_queue_monitoring import LatencyBudgets, worker_health
from .uony_queue_state import RecoveryPolicy


class WorkerMonitor:
    def __init__(self, database, worker_id, engines, *, policy=None, budgets=None):
        if not isinstance(worker_id, str) or not 1 <= len(worker_id) <= 160:
            raise ValueError('A bounded worker id is required')
        if not engines or not set(engines) <= {'classic', 'adk'}:
            raise ValueError('At least one supported engine is required')
        self.database = database
        self.worker_id = worker_id
        self.engines = tuple(engines)
        self.policy = policy or RecoveryPolicy.from_environment()
        self.budgets = budgets or LatencyBudgets.from_environment()
        if self.budgets.heartbeat_stale_seconds < self.policy.heartbeat_seconds * 2:
            raise ValueError('Worker stale threshold must allow at least two heartbeats')
        self._lock = Lock()
        self._state = 'idle'

    def state(self, state):
        if state not in ('idle', 'running', 'stopped'):
            raise ValueError('Invalid worker state')
        with self._lock:
            self._state = state
        self.pulse()

    def pulse(self):
        with self._lock:
            state = self._state
        with self.database.connect() as c:
            c.execute("""INSERT INTO uony_conversation_workers(worker_id,engines,status,stopped_at)
                VALUES(%s,%s,%s,CASE WHEN %s='stopped' THEN now() END)
                ON CONFLICT (worker_id) DO UPDATE SET engines=excluded.engines,
                    status=excluded.status,heartbeat_at=now(),stopped_at=excluded.stopped_at""",
                (self.worker_id, list(self.engines), state, state))
            # This is liveness, not an audit ledger; retain a bounded stale horizon.
            c.execute("""DELETE FROM uony_conversation_workers
                WHERE heartbeat_at<now()-interval '7 days'""")

    def operational_alerts(self):
        """Use active partial indexes, never scan historical prompts or results."""
        with self.database.connect() as c:
            rows = c.execute("""SELECT engine,
                count(*) FILTER (WHERE status='queued') AS queued,
                count(*) FILTER (WHERE status='running' AND
                    coalesce(lease_until,'-infinity'::timestamptz)<=now()) AS expired,
                count(*) FILTER (WHERE status='queued' AND
                    created_at<now()-%s*interval '1 millisecond') AS delayed,
                count(*) FILTER (WHERE status='running' AND (
                    (progress_stage='preparing' AND last_claimed_at<now()-%s*interval '1 millisecond') OR
                    (progress_stage='consulting_google' AND provider_started_at<now()-%s*interval '1 millisecond') OR
                    (progress_stage='checking_result' AND provider_returned_at<now()-%s*interval '1 millisecond')
                )) AS slow,
                count(*) FILTER (WHERE created_at<now()-%s*interval '1 millisecond') AS over_total
                FROM uony_conversation_jobs WHERE status IN ('queued','running') GROUP BY engine""",
                (self.budgets.queue_ms, self.budgets.preparation_ms, self.budgets.provider_ms,
                 self.budgets.checking_ms, self.budgets.total_ms)).fetchall()
            workers = worker_health(c, self.budgets)
        result = []
        for row in rows:
            for field, code in (('expired', 'expired_leases'), ('delayed', 'queue_over_budget'),
                                ('slow', 'stage_over_budget'), ('over_total', 'total_over_budget')):
                if row[field]:
                    result.append({'code': code, 'engine': row['engine'], 'count': row[field]})
            if row['queued'] and not workers[row['engine']]['healthy']:
                result.append({'code': 'no_healthy_worker', 'engine': row['engine'], 'count': row['queued']})
        return result

    @contextmanager
    def running(self):
        # Synchronous registration means a process never appears healthy before
        # its migrations/configuration have actually succeeded.
        self.pulse()
        stop = Event()

        def supervise():
            last_alert = 0.0
            while not stop.wait(self.policy.heartbeat_seconds):
                try:
                    self.pulse()
                    if monotonic() - last_alert >= 30:
                        for alert in self.operational_alerts():
                            logging.warning('Conversation queue alert code=%s engine=%s count=%s',
                                            alert['code'], alert['engine'], alert['count'])
                        last_alert = monotonic()
                except Exception as exc:
                    logging.error('Conversation monitor unavailable: %s', type(exc).__name__)

        thread = Thread(target=supervise, name='conversation-monitor', daemon=True)
        thread.start()
        try:
            yield self
        finally:
            stop.set()
            thread.join(timeout=1)
            try:
                self.state('stopped')
            except Exception as exc:
                logging.error('Conversation monitor shutdown unavailable: %s', type(exc).__name__)
