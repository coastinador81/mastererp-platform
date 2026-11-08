"""PostgreSQL queue, expiring leases and checkpoints scoped to a product owner."""
from copy import deepcopy
from contextlib import contextmanager
from threading import Event, Thread
from uuid import uuid4
from psycopg.types.json import Jsonb
from .product_materials_ledger import MaterialsLedger

LEASE_SECONDS = 120
RECOVERY_BATCH = 64
TARGETED_RECOVERY_PASSES = 2


class LeaseLost(Exception):
    """A stale worker must stop before changing any persisted state."""


class BudgetPause(Exception):
    def __init__(self, reason='budget_exhausted'):
        self.reason = reason
        super().__init__(reason)


def merge_proposals(current, incoming):
    values = {item['id']: deepcopy(item) for item in current}
    for item in incoming:
        existing = values.get(item['id'])
        if not existing:
            values[item['id']] = deepcopy(item)
            continue
        evidence = existing.setdefault('evidence', [])
        for entry in item.get('evidence', []):
            if entry not in evidence:
                evidence.append(entry)
        if existing.get('status') not in ('confirmed', 'rejected'):
            values[item['id']] = {**existing, **deepcopy(item), 'evidence': evidence}
    return list(values.values())


class MaterialsQueue(MaterialsLedger):
    def __init__(self, database, engines=('classic',)):
        self.database = database
        self.engines = tuple(engines)

    def assert_lease(self, c, job_id, user_id, lease_token):
        row = c.execute('''SELECT * FROM product_material_jobs WHERE id=%s AND user_id=%s
            AND status='running' AND lease_token=%s AND lease_until>now() FOR UPDATE''',
                        (job_id, user_id, lease_token)).fetchone()
        if not row:
            raise LeaseLost()
        return row

    def recover(self, job_id=None):
        """Recover a bounded due batch, locking each account before its job."""
        with self.database.connect() as c:
            account = None
            if job_id is not None:
                target = c.execute('SELECT user_id FROM product_material_jobs WHERE id=%s',
                                   (job_id,)).fetchone()
                if not target:
                    return 0
                account = target['user_id']
            candidates = c.execute("""SELECT j.id,j.user_id FROM product_material_jobs j
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
                row = c.execute("""SELECT id,pause_requested FROM product_material_jobs
                    WHERE id=%s AND user_id=%s AND status='running'
                    AND coalesce(lease_until,'-infinity'::timestamptz)<=now()
                    FOR UPDATE SKIP LOCKED""",
                    (candidate['id'], candidate['user_id'])).fetchone()
                if not row:
                    continue  # A heartbeat or another recovery changed the lease.
                job_id = row['id']
                uncertain = c.execute("""UPDATE product_material_calls SET state='unknown',finished_at=now()
                    WHERE job_id=%s AND state='running' RETURNING id""", (job_id,)).fetchall()
                c.execute("""UPDATE product_material_fragments f SET state=CASE WHEN EXISTS(
                    SELECT 1 FROM product_material_calls k WHERE k.job_id=f.job_id AND k.state='unknown'
                    AND k.acknowledged_at IS NULL AND k.fragment_ids ? f.id) THEN 'unknown' ELSE 'pending' END,
                    updated_at=now() WHERE job_id=%s AND state='running'""", (job_id,))
                unresolved = c.execute("SELECT id FROM product_material_calls WHERE job_id=%s AND state='unknown' AND acknowledged_at IS NULL LIMIT 1", (job_id,)).fetchone()
                status = 'paused' if unresolved or row['pause_requested'] else 'queued'
                reason = 'consumption_unknown' if unresolved else 'user_requested' if row['pause_requested'] else None
                c.execute('''UPDATE product_material_jobs SET status=%s,lease_token=NULL,lease_owner=NULL,
                    lease_until=NULL,updated_at=now(),result=result || %s WHERE id=%s''',
                    (status, Jsonb({'stage': status, 'pauseReason': reason, 'canResume': status == 'paused'}), job_id))
                recovered += 1
        return recovered

    def claim(self, worker_id, job_id=None):
        # A targeted queued job may be blocked by an older expired running job
        # for the same account. Two bounded batches clear ordinary legacy
        # backlog; beyond that, return None safely and let a later call resume.
        for _ in range(TARGETED_RECOVERY_PASSES if job_id else 1):
            if self.recover(job_id) < RECOVERY_BATCH:
                break
        # A job may become unavailable between the account and job snapshots.
        # An explicit job never switches targets; a generic worker can retry
        # another account with a fresh transaction before sleeping.
        for _ in range(1 if job_id else 3):
            claimed, stale = self._claim_once(worker_id, job_id)
            if not stale:
                return claimed
        return None

    def _claim_once(self, worker_id, job_id):
        with self.database.connect() as c:
            params = [job_id] if job_id else []
            candidate = ' AND j.id=%s' if job_id else ''
            # Account confirmation takes FOR UPDATE on this row. Claimers need
            # an exclusive worker barrier so a second one skips this account
            # and can serve another while its oldest job is being claimed.
            user = c.execute("""SELECT u.id FROM users u JOIN LATERAL(
                SELECT j.updated_at,j.created_at,j.id FROM product_material_jobs j
                WHERE j.user_id=u.id AND j.status='queued' AND j.engine=ANY(%s)""" + candidate + """
                ORDER BY j.updated_at,j.created_at,j.id LIMIT 1) first_job ON true
                WHERE u.deletion_requested_at IS NULL
                AND NOT EXISTS(SELECT 1 FROM product_material_jobs active
                    WHERE active.user_id=u.id AND active.status='running')
                ORDER BY GREATEST(first_job.updated_at,
                    coalesce(u.materials_last_claim_at,first_job.updated_at)),
                    first_job.updated_at,first_job.created_at,first_job.id,u.id
                FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT 1""", [list(self.engines), *params]).fetchone()
            if not user:
                return None, False
            where = ' AND id=%s' if job_id else ''
            row = c.execute("SELECT * FROM product_material_jobs WHERE status='queued' AND engine=ANY(%s) AND user_id=%s" + where +
                            " AND NOT EXISTS(SELECT 1 FROM product_material_jobs active"
                            " WHERE active.user_id=%s AND active.status='running')"
                            ' ORDER BY updated_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1',
                            [list(self.engines), user['id'], *params, user['id']]).fetchone()
            if not row:
                return None, True
            claimed = c.execute('''UPDATE product_material_jobs SET status='running',lease_token=%s,
                lease_owner=%s,lease_until=now()+make_interval(secs=>%s),updated_at=now()
                WHERE id=%s RETURNING *''', (uuid4(), worker_id[:160], LEASE_SECONDS, row['id'])).fetchone()
            c.execute('UPDATE users SET materials_last_claim_at=clock_timestamp() WHERE id=%s',
                      (user['id'],))
            return claimed, False

    def heartbeat(self, job_id, user_id, lease_token):
        with self.database.connect() as c:
            row = c.execute('''UPDATE product_material_jobs SET lease_until=now()+make_interval(secs=>%s)
                WHERE id=%s AND user_id=%s AND lease_token=%s AND status='running' AND lease_until>now()
                RETURNING id''', (LEASE_SECONDS, job_id, user_id, lease_token)).fetchone()
        return bool(row)

    @contextmanager
    def keeping_lease(self, job_id, user_id, lease_token):
        stop = Event()
        def heartbeat():
            while not stop.wait(20):
                try:
                    if not self.heartbeat(job_id, user_id, lease_token):
                        break
                except Exception:
                    break  # Expiry fences the current worker even if the DB is temporarily unavailable.
        thread = Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join(timeout=1)

    def pause_requested(self, job_id, user_id, lease_token):
        with self.database.connect() as c:
            return self.assert_lease(c, job_id, user_id, lease_token)['pause_requested']

    def sources(self, job_id, user_id):
        with self.database.connect() as c:
            return [r['data'] for r in c.execute('''SELECT s.data FROM product_material_sources s
                JOIN product_material_jobs j ON j.id=s.job_id WHERE s.job_id=%s AND j.user_id=%s
                ORDER BY s.source_id''', (job_id, user_id)).fetchall()]

    def save_source(self, job_id, user_id, lease_token, source, version):
        with self.database.connect() as c:
            self.assert_lease(c, job_id, user_id, lease_token)
            c.execute('''INSERT INTO product_material_sources(job_id,source_id,version,data) VALUES(%s,%s,%s,%s)
                ON CONFLICT(job_id,source_id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=now()''',
                      (job_id, source['id'], version, Jsonb(source)))
            c.execute("""UPDATE product_material_fragments SET state='superseded',updated_at=now()
                WHERE job_id=%s AND source_id=%s AND version<>%s AND state<>'superseded'""", (job_id, source['id'], version))

    def fragments(self, job_id, user_id, source_id=None):
        with self.database.connect() as c:
            params = [job_id, user_id] + ([source_id] if source_id else [])
            clause = ' AND f.source_id=%s' if source_id else ''
            return c.execute('''SELECT f.* FROM product_material_fragments f JOIN product_material_jobs j
                ON j.id=f.job_id WHERE f.job_id=%s AND j.user_id=%s''' + clause + ' ORDER BY f.id', params).fetchall()

    def put_fragment(self, job_id, user_id, lease_token, fragment):
        with self.database.connect() as c:
            self.assert_lease(c, job_id, user_id, lease_token)
            c.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload)
                VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(job_id,id) DO NOTHING''',
                (job_id, fragment['id'], fragment['sourceId'], fragment['version'], fragment.get('locator', ''),
                 fragment.get('state', fragment.get('status', 'pending')), Jsonb(fragment['payload'])))

    def put_fragments(self, job_id, user_id, lease_token, fragments):
        """Un manifiesto completo en una transacción; sin checkpoint por objeto Blender."""
        with self.database.connect() as c:
            self.assert_lease(c, job_id, user_id, lease_token)
            with c.cursor() as cursor:
                cursor.executemany('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload,result)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(job_id,id) DO NOTHING''',
                    [(job_id, item['id'], item['sourceId'], item['version'], item.get('locator', ''),
                      item.get('state', 'pending'), Jsonb(item['payload']), Jsonb(item.get('result', {}))) for item in fragments])

    def finish_fragment(self, job_id, user_id, lease_token, fragment_id, state, result=None):
        with self.database.connect() as c:
            row = self.assert_lease(c, job_id, user_id, lease_token)
            if result and result.get('proposals'):
                merged = merge_proposals(row['result'].get('proposals', []), result['proposals'])
                c.execute("UPDATE product_material_jobs SET result=jsonb_set(result,'{proposals}',%s),updated_at=now() WHERE id=%s",
                          (Jsonb(merged), job_id))
            c.execute('''UPDATE product_material_fragments SET state=%s,result=result || %s,updated_at=now()
                WHERE job_id=%s AND id=%s''', (state, Jsonb(result or {}), job_id, fragment_id))

    def checkpoint(self, job_id, user_id, lease_token, result, status='running'):
        with self.database.connect() as c:
            row = self.assert_lease(c, job_id, user_id, lease_token)
            merged = {**row['result'], **deepcopy(result)}
            merged['proposals'] = merge_proposals(row['result'].get('proposals', []), result.get('proposals', []))
            terminal = status != 'running'
            if terminal:
                # A provider response may have arrived while its final write failed. Closing
                # the job must not make the still-running ledger entry eligible for blind retry.
                c.execute("UPDATE product_material_calls SET state='unknown',finished_at=now() WHERE job_id=%s AND state='running'", (job_id,))
                uncertain = c.execute("SELECT id FROM product_material_calls WHERE job_id=%s AND state='unknown' AND acknowledged_at IS NULL LIMIT 1", (job_id,)).fetchone()
                if uncertain:
                    c.execute("""UPDATE product_material_fragments f SET state='unknown',updated_at=now()
                        WHERE job_id=%s AND state IN ('pending','running','error') AND EXISTS (
                        SELECT 1 FROM product_material_calls k WHERE k.job_id=f.job_id AND k.state='unknown'
                        AND k.acknowledged_at IS NULL AND k.fragment_ids ? f.id)""", (job_id,))
                    status = 'paused'
                    merged.update(stage='paused', pauseReason='consumption_unknown', canResume=True)
            c.execute('''UPDATE product_material_jobs SET result=%s,status=%s,updated_at=now(),
                lease_token=CASE WHEN %s THEN NULL ELSE lease_token END,
                lease_owner=CASE WHEN %s THEN NULL ELSE lease_owner END,
                lease_until=CASE WHEN %s THEN NULL ELSE lease_until END WHERE id=%s''',
                (Jsonb(merged), status, terminal, terminal, terminal, job_id))
            return merged
