"""Durable reasoning leases and paid-call ledger, independent from material extraction."""
from contextlib import contextmanager
from threading import Event, Thread
from uuid import uuid4
from psycopg.types.json import Jsonb
from .product_materials_queue import LeaseLost, BudgetPause

RECOVERY_BATCH = 64
TARGETED_RECOVERY_PASSES = 2


class ReasoningQueue:
    def __init__(self, database):
        self.database = database

    def assert_lease(self, c, row):
        found = c.execute("""SELECT * FROM product_reasoning_jobs WHERE id=%s AND user_id=%s
            AND status='running' AND lease_token=%s AND lease_until>now() FOR UPDATE""",
            (row['id'], row['user_id'], row['lease_token'])).fetchone()
        if not found:
            raise LeaseLost()
        return found

    def recover(self, job_id=None):
        with self.database.connect() as c:
            account = None
            if job_id is not None:
                target = c.execute('SELECT user_id FROM product_reasoning_jobs WHERE id=%s',
                                   (job_id,)).fetchone()
                if not target:
                    return 0
                account = target['user_id']
            candidates = c.execute("""SELECT j.id,j.user_id FROM product_reasoning_jobs j
                JOIN users u ON u.id=j.user_id
                WHERE j.status='running'
                AND coalesce(j.lease_until,'-infinity'::timestamptz)<=now()
                AND u.deletion_requested_at IS NULL
                AND (%s::uuid IS NULL OR j.user_id=%s)
                ORDER BY coalesce(j.lease_until,'-infinity'::timestamptz),j.user_id,j.id
                FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT %s""",
                (account, account, RECOVERY_BATCH)).fetchall()
            recovered = 0
            for candidate in candidates:
                row = c.execute("""SELECT id FROM product_reasoning_jobs
                    WHERE id=%s AND user_id=%s AND status='running'
                    AND coalesce(lease_until,'-infinity'::timestamptz)<=now()
                    FOR UPDATE SKIP LOCKED""",
                    (candidate['id'], candidate['user_id'])).fetchone()
                if not row:
                    continue  # A heartbeat or another recovery changed the lease.
                c.execute("UPDATE product_reasoning_calls SET state='unknown',finished_at=now() WHERE job_id=%s AND state='running'", (row['id'],))
                unknown = c.execute("SELECT id FROM product_reasoning_calls WHERE job_id=%s AND state='unknown' AND acknowledged_at IS NULL LIMIT 1", (row['id'],)).fetchone()
                c.execute("""UPDATE product_reasoning_jobs SET status=%s,lease_token=NULL,lease_owner=NULL,lease_until=NULL,
                    result=result || %s,updated_at=now() WHERE id=%s""", ('unknown' if unknown else 'queued',
                    Jsonb({'error': 'consumption_unknown'} if unknown else {}), row['id']))
                recovered += 1
        return recovered

    def claim(self, worker_id, job_id=None):
        # The named queued job can share its account with expired running
        # work. Keep each recovery transaction bounded; an oversized legacy
        # backlog returns None until a later attempt frees the account.
        for _ in range(TARGETED_RECOVERY_PASSES if job_id else 1):
            if self.recover(job_id) < RECOVERY_BATCH:
                break
        # A queued job can change after account selection used its snapshot.
        # Retry generic claims in fresh transactions; a targeted claim stays
        # bound to its requested job.
        for _ in range(1 if job_id else 3):
            claimed, stale = self._claim_once(worker_id, job_id)
            if not stale:
                return claimed
        return None

    def _claim_once(self, worker_id, job_id):
        with self.database.connect() as c:
            candidate, args = (' AND j.id=%s', [job_id]) if job_id else ('', [])
            # Lock the account barrier first, matching deletion's user→job order.
            # Claimers must conflict here so another account is not starved
            # while this account's oldest job is being claimed.
            user = c.execute("""SELECT u.id FROM users u JOIN LATERAL(
                SELECT j.updated_at,j.created_at,j.id FROM product_reasoning_jobs j
                WHERE j.user_id=u.id AND j.status='queued'""" + candidate + """
                ORDER BY j.updated_at,j.created_at,j.id LIMIT 1) first_job ON true
                WHERE u.deletion_requested_at IS NULL
                AND NOT EXISTS(SELECT 1 FROM product_reasoning_jobs active
                    WHERE active.user_id=u.id AND active.status='running')
                ORDER BY GREATEST(first_job.updated_at,
                    coalesce(u.reasoning_last_claim_at,first_job.updated_at)),
                    first_job.updated_at,first_job.created_at,first_job.id,u.id
                FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT 1""", args).fetchone()
            if not user:
                return None, False
            where = ' AND id=%s' if job_id else ''
            row = c.execute("SELECT id FROM product_reasoning_jobs WHERE status='queued' AND user_id=%s" + where +
                            " AND NOT EXISTS(SELECT 1 FROM product_reasoning_jobs active"
                            " WHERE active.user_id=%s AND active.status='running')"
                            ' ORDER BY updated_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1',
                            [user['id'], *args, user['id']]).fetchone()
            if not row:
                return None, True
            claimed = c.execute("""UPDATE product_reasoning_jobs SET status='running',lease_token=%s,
                lease_owner=%s,lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=%s RETURNING *""",
                (uuid4(), worker_id, row['id'])).fetchone()
            c.execute('UPDATE users SET reasoning_last_claim_at=clock_timestamp() WHERE id=%s',
                      (user['id'],))
            return claimed, False

    @contextmanager
    def keeping_lease(self, row):
        stop = Event()
        def pulse():
            while not stop.wait(20):
                try:
                    with self.database.connect() as c:
                        changed = c.execute("""UPDATE product_reasoning_jobs SET lease_until=now()+interval '120 seconds'
                            WHERE id=%s AND status='running' AND lease_token=%s AND lease_until>now() RETURNING id""",
                            (row['id'], row['lease_token'])).fetchone()
                    if not changed:
                        return
                except Exception:
                    return
        thread = Thread(target=pulse, daemon=True); thread.start()
        try:
            yield
        finally:
            stop.set(); thread.join(timeout=1)

    def completed(self, row, phase):
        from .product_reasoning_recovery import RECOVERY_VERSION
        with self.database.connect() as c:
            self.assert_lease(c, row)
            found = c.execute("""SELECT state,result FROM product_reasoning_calls WHERE job_id=%s AND phase=%s
                AND (state='done' OR (state='error' AND result->'localRecovery'->>'version'=%s))
                ORDER BY created_at DESC LIMIT 1""", (row['id'], phase, str(RECOVERY_VERSION))).fetchone()
            if not found: return None
            return found['result'] if found['state'] == 'done' else found['result']['localRecovery']['result']

    def rejected(self, row, phase):
        with self.database.connect() as c:
            self.assert_lease(c, row)
            return c.execute("""SELECT id,result,usage FROM product_reasoning_calls WHERE job_id=%s AND phase=%s
                AND state='error' AND result ? 'rejectedResponse' ORDER BY created_at DESC LIMIT 1""",
                (row['id'], phase)).fetchone()

    def record_recovery(self, row, call_id, recovery):
        with self.database.connect() as c:
            self.assert_lease(c, row)
            # La salida original, estado error, uso y fechas del proveedor son inmutables.
            c.execute("""UPDATE product_reasoning_calls SET result=result || %s
                WHERE id=%s AND job_id=%s AND state='error'""",
                (Jsonb({'localRecovery': recovery}), call_id, row['id']))

    def reserve(self, row, phase, input_tokens):
        with self.database.connect() as c:
            live = self.assert_lease(c, row)
            totals = self.usage(c, row['id'])
            # Otra ejecución puede vencer DESPUÉS de crear esta continuación.
            # Comprobar todo el producto también al reservar evita saltarse la
            # aceptación del consumo incierto mediante un trabajo nuevo.
            unknown = c.execute("""SELECT k.id FROM product_reasoning_calls k
                JOIN product_reasoning_jobs j ON j.id=k.job_id
                WHERE j.user_id=%s AND j.product_id=%s AND k.acknowledged_at IS NULL
                AND (k.state='unknown' OR coalesce((k.usage->>'unconfirmedCalls')::integer,0)>0)
                LIMIT 1""", (live['user_id'], live['product_id'])).fetchone()
            if unknown:
                raise BudgetPause('consumption_unknown')
            reserved = max(0, input_tokens) + 16384
            if totals['calls'] >= live['max_calls'] or totals['tokens'] + totals['reserved'] + reserved > live['max_tokens']:
                raise BudgetPause('budget_exhausted')
            identifier = uuid4()
            c.execute("""INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens)
                VALUES(%s,%s,%s,%s,'running',%s)""", (identifier, row['id'], row['lease_token'], phase, reserved))
            return identifier

    def finish(self, row, call_id, usage, result=None, state='done'):
        with self.database.connect() as c:
            self.assert_lease(c, row)
            c.execute("""UPDATE product_reasoning_calls SET state=%s,usage=%s,total_tokens=%s,result=%s,finished_at=now()
                WHERE id=%s AND job_id=%s AND lease_token=%s AND state='running'""",
                (state, Jsonb(usage), max(0, int(usage.get('totalTokenCount', 0))), Jsonb(result or {}), call_id, row['id'], row['lease_token']))

    def usage(self, c, job_id):
        row = c.execute("""SELECT count(*) AS calls,coalesce(sum(total_tokens),0) AS tokens,
            coalesce(sum(reserved_tokens) FILTER(WHERE state IN ('running','unknown') OR
            coalesce((usage->>'unconfirmedCalls')::integer,0)>0),0) AS reserved,
            count(*) FILTER(WHERE state='unknown' OR coalesce((usage->>'unconfirmedCalls')::integer,0)>0) AS unknown
            FROM product_reasoning_calls WHERE job_id=%s""", (job_id,)).fetchone()
        return {key: int(value) for key, value in row.items()}

    def terminal(self, row, status, result):
        with self.database.connect() as c:
            self.assert_lease(c, row)
            running = c.execute("UPDATE product_reasoning_calls SET state='unknown',finished_at=now() WHERE job_id=%s AND state='running' RETURNING id", (row['id'],)).fetchall()
            if running:
                status, result = 'unknown', {**result, 'error': 'consumption_unknown'}
            c.execute("""UPDATE product_reasoning_jobs SET status=%s,result=result || %s,
                lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=%s""", (status, Jsonb(result), row['id']))
