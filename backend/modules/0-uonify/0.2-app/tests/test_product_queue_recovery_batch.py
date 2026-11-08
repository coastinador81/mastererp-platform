"""Expired leases are recovered in bounded, account-safe PostgreSQL batches."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from app.product_materials_queue import MaterialsQueue, RECOVERY_BATCH as MATERIAL_BATCH
from app.product_reasoning_queue import ReasoningQueue, RECOVERY_BATCH as REASONING_BATCH


def seeded(database, kind, count, *, running_call=False):
    database.migrate()
    table = 'product_material_jobs' if kind == 'materials' else 'product_reasoning_jobs'
    rows = [(uuid4(), uuid4(), uuid4()) for _ in range(count)]
    with database.connect() as c:
        with c.cursor() as cur:
            cur.executemany('INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)',
                            [(user, user.hex, f'{user.hex}@example.test')
                             for user, _, _ in rows])
            cur.executemany("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                            [(user, product, product.hex) for user, product, _ in rows])
            if kind == 'materials':
                cur.executemany("""INSERT INTO product_material_jobs(id,user_id,product_id,
                    request_id,google_subject,revision,folder_id,status,lease_token,lease_until)
                    VALUES(%s,%s,%s,%s,'test',1,'folder','running',%s,
                    now()-interval '1 minute')""",
                    [(job, user, product, uuid4(), uuid4()) for user, product, job in rows])
            else:
                cur.executemany("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                    google_subject,fingerprint,product_signature,schema_hash,status,revision,
                    context,lease_token,lease_until)
                    VALUES(%s,%s,%s,'test',%s,'signature','schema','running',1,'{}',%s,
                    now()-interval '1 minute')""",
                    [(job, user, product, job.hex, uuid4()) for user, product, job in rows])
        if running_call:
            job = rows[0][2]
            c.execute(f"UPDATE {table} SET lease_until=now()-interval '2 minutes' WHERE id=%s", (job,))
            if kind == 'materials':
                c.execute("""INSERT INTO product_material_calls(id,job_id,lease_token,
                    fragment_ids,state,reserved_tokens) SELECT %s,id,lease_token,%s,
                    'running',100 FROM product_material_jobs WHERE id=%s""",
                    (uuid4(), Jsonb(['one']), job))
            else:
                c.execute("""INSERT INTO product_reasoning_calls(id,job_id,lease_token,
                    phase,state,reserved_tokens) SELECT %s,id,lease_token,'propose',
                    'running',100 FROM product_reasoning_jobs WHERE id=%s""",
                    (uuid4(), job))
    return rows, table


def make_queue(database, kind):
    return MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)


@pytest.mark.parametrize('kind,batch', [('materials', MATERIAL_BATCH), ('reasoning', REASONING_BATCH)])
def test_recovery_is_bounded_and_uncertain_call_never_requeued(environment, kind, batch):
    _, _, database = environment
    rows, table = seeded(database, kind, batch + 5, running_call=True)
    queue = make_queue(database, kind)
    assert queue.recover() == batch
    with database.connect() as c:
        states = {r['status']: r['n'] for r in c.execute(
            f'SELECT status,count(*) AS n FROM {table} GROUP BY status').fetchall()}
    assert states == ({'paused': 1, 'queued': batch - 1, 'running': 5} if kind == 'materials'
                      else {'unknown': 1, 'queued': batch - 1, 'running': 5})
    assert queue.recover() == 5
    assert queue.recover() == 0
    with database.connect() as c:
        old = c.execute(f'SELECT status,lease_token,lease_owner,lease_until FROM {table} WHERE id=%s',
                        (rows[0][2],)).fetchone()
        calls = c.execute(f"SELECT state,acknowledged_at FROM product_{'material' if kind == 'materials' else 'reasoning'}_calls WHERE job_id=%s",
                          (rows[0][2],)).fetchall()
        assert c.execute(f"SELECT count(*) AS n FROM {table} WHERE status='running'").fetchone()['n'] == 0
    assert old['status'] == ('paused' if kind == 'materials' else 'unknown')
    assert old['lease_token'] is old['lease_owner'] is old['lease_until'] is None
    assert calls == [{'state': 'unknown', 'acknowledged_at': None}]
    assert queue.claim('must-not-replay', rows[0][2]) is None


@pytest.mark.parametrize('kind,batch', [('materials', MATERIAL_BATCH), ('reasoning', REASONING_BATCH)])
def test_targeted_claim_recovers_its_account_beyond_generic_batch(environment, kind, batch):
    _, _, database = environment
    rows, table = seeded(database, kind, batch + 1)
    owner, _, expired = rows[-1]
    queued = uuid4()
    product = uuid4()
    with database.connect() as c:
        c.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                  (owner, product, product.hex))
        c.execute(f"UPDATE {table} SET lease_until=now()-interval '1 second' WHERE id=%s",
                  (expired,))
        if kind == 'materials':
            c.execute("""INSERT INTO product_material_jobs(id,user_id,product_id,request_id,
                google_subject,revision,folder_id,status) VALUES(%s,%s,%s,%s,
                'test',1,'folder','queued')""", (queued, owner, product, uuid4()))
        else:
            c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                google_subject,fingerprint,product_signature,schema_hash,status,revision,context)
                VALUES(%s,%s,%s,'test',%s,'signature','schema','queued',1,'{}')""",
                (queued, owner, product, queued.hex))
    queue = make_queue(database, kind)
    # A generic batch can leave this last account untouched; the explicit
    # job still releases that account's expired lease before claiming.
    assert queue.recover() == batch
    claimed = queue.claim('targeted-worker', queued)
    assert claimed and claimed['id'] == queued and claimed['user_id'] == owner


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_targeted_claim_caps_recovery_of_oversized_account_backlog(environment, kind):
    _, _, database = environment
    database.migrate()
    owner, target = uuid4(), uuid4()
    active = [(uuid4(), uuid4()) for _ in range(130)]
    target_product = uuid4()
    table = 'product_material_jobs' if kind == 'materials' else 'product_reasoning_jobs'
    with database.connect() as c:
        c.execute('INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)',
                  (owner, owner.hex, 'oversized@example.test'))
        with c.cursor() as cur:
            cur.executemany("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                            [(owner, product, product.hex)
                             for product in [*(p for p, _ in active), target_product]])
            if kind == 'materials':
                cur.executemany("""INSERT INTO product_material_jobs(id,user_id,product_id,
                    request_id,google_subject,revision,folder_id,status,lease_token,lease_until)
                    VALUES(%s,%s,%s,%s,'test',1,'folder','running',%s,
                    now()-interval '1 minute')""",
                    [(job, owner, product, uuid4(), uuid4()) for product, job in active])
                c.execute("""INSERT INTO product_material_jobs(id,user_id,product_id,
                    request_id,google_subject,revision,folder_id,status)
                    VALUES(%s,%s,%s,%s,'test',1,'folder','queued')""",
                    (target, owner, target_product, uuid4()))
            else:
                cur.executemany("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                    google_subject,fingerprint,product_signature,schema_hash,status,
                    revision,context,lease_token,lease_until)
                    VALUES(%s,%s,%s,'test',%s,'signature','schema','running',1,'{}',%s,
                    now()-interval '1 minute')""",
                    [(job, owner, product, job.hex, uuid4()) for product, job in active])
                c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                    google_subject,fingerprint,product_signature,schema_hash,status,
                    revision,context) VALUES(%s,%s,%s,'test',%s,'signature','schema',
                    'queued',1,'{}')""", (target, owner, target_product, target.hex))

    candidate_queries = []

    class CountingConnection:
        def __init__(self, c):
            self.c = c

        def execute(self, query, params=()):
            if 'FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT %s' in query:
                candidate_queries.append(True)
            return self.c.execute(query, params)

    class CountingDatabase:
        @contextmanager
        def connect(self):
            with database.connect() as c:
                yield CountingConnection(c)

    queue = make_queue(CountingDatabase(), kind)
    assert queue.claim('first-pass', target) is None
    assert len(candidate_queries) == 2
    with database.connect() as c:
        assert c.execute(f"SELECT count(*) AS n FROM {table} WHERE status='running'").fetchone()['n'] == 2
        assert c.execute(f'SELECT status FROM {table} WHERE id=%s', (target,)).fetchone()['status'] == 'queued'
    claimed = queue.claim('later-pass', target)
    assert claimed and claimed['id'] == target
    assert len(candidate_queries) == 3


@pytest.mark.parametrize('kind,batch', [('materials', MATERIAL_BATCH), ('reasoning', REASONING_BATCH)])
def test_large_expired_backlog_does_not_starve_a_waiting_account(environment, kind, batch):
    _, _, database = environment
    _, table = seeded(database, kind, batch + 1)
    waiting_user, waiting_product, waiting_job = uuid4(), uuid4(), uuid4()
    with database.connect() as c:
        c.execute('INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)',
                  (waiting_user, waiting_user.hex, 'waiting@example.test'))
        c.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                  (waiting_user, waiting_product, waiting_product.hex))
        if kind == 'materials':
            c.execute("""INSERT INTO product_material_jobs(id,user_id,product_id,request_id,
                google_subject,revision,folder_id,status,updated_at) VALUES(%s,%s,%s,%s,
                'test',1,'folder','queued',now()-interval '5 minutes')""",
                (waiting_job, waiting_user, waiting_product, uuid4()))
        else:
            c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                google_subject,fingerprint,product_signature,schema_hash,status,revision,
                context,updated_at) VALUES(%s,%s,%s,'test',%s,'signature','schema',
                'queued',1,'{}',now()-interval '5 minutes')""",
                (waiting_job, waiting_user, waiting_product, waiting_job.hex))
    queue = make_queue(database, kind)
    claimed = queue.claim('fair-worker')
    assert claimed and claimed['id'] == waiting_job
    with database.connect() as c:
        # The first recovery cycle stays bounded even while claim progresses.
        assert c.execute(f"SELECT count(*) AS n FROM {table} WHERE status='running'").fetchone()['n'] == 2


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_recovery_skips_locked_account_and_other_account_progresses(environment, kind):
    _, _, database = environment
    rows, table = seeded(database, kind, 2)
    first_user, _, first_job = rows[0]
    second_job = rows[1][2]
    with database.connect() as c:
        c.execute(f"UPDATE {table} SET lease_until=now()-interval '2 minutes' WHERE id=%s",
                  (first_job,))
    queue = make_queue(database, kind)
    with database.connect() as holder:
        holder.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (first_user,))
        assert queue.recover() == 1
        with database.connect() as c:
            state = c.execute(f'SELECT status FROM {table} WHERE id=%s', (second_job,)).fetchone()
            assert state['status'] == 'queued'
            state = c.execute(f'SELECT status FROM {table} WHERE id=%s', (first_job,)).fetchone()
            assert state['status'] == 'running'
    assert queue.recover() == 1


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_concurrent_recoveries_fence_each_job_once(environment, kind):
    _, _, database = environment
    _, table = seeded(database, kind, 12)
    queue = make_queue(database, kind)
    with ThreadPoolExecutor(max_workers=4) as pool:
        counts = list(pool.map(lambda _: queue.recover(), range(4)))
    assert sum(counts) == 12
    with database.connect() as c:
        assert c.execute(f"SELECT count(*) AS n FROM {table} WHERE status='queued'").fetchone()['n'] == 12


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_renewed_lease_between_candidate_and_job_lock_is_not_recovered(environment, kind):
    _, _, database = environment
    rows, table = seeded(database, kind, 1)
    job = rows[0][2]
    intercepted = []

    class RacingConnection:
        def __init__(self, c):
            self.c = c

        def execute(self, query, params=()):
            result = self.c.execute(query, params)
            if 'FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT' in query and not intercepted:
                intercepted.append(True)
                with database.connect() as other:
                    other.execute(f"UPDATE {table} SET lease_until=now()+interval '2 minutes' WHERE id=%s",
                                  (job,))
            return result

    class RacingDatabase:
        @contextmanager
        def connect(self):
            with database.connect() as c:
                yield RacingConnection(c)

    assert make_queue(RacingDatabase(), kind).recover() == 0
    assert intercepted == [True]
    with database.connect() as c:
        assert c.execute(f'SELECT status FROM {table} WHERE id=%s', (job,)).fetchone()['status'] == 'running'
