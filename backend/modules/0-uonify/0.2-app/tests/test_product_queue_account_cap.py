"""Material and reasoning workers share each queue fairly between accounts."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from uuid import uuid4

import pytest

from app.product_materials_queue import MaterialsQueue
from app.product_reasoning_queue import ReasoningQueue
from test_account_deletion_queue import setup_jobs


def second_job(database, kind, user_id):
    product_id, job_id = uuid4(), uuid4()
    with database.connect() as c:
        c.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                  (user_id, product_id, product_id.hex))
        if kind == 'materials':
            c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,
                google_subject,revision,folder_id,status)
                VALUES(%s,%s,%s,%s,'subject',1,'folder','queued')''',
                (job_id, user_id, product_id, uuid4()))
        else:
            c.execute('''INSERT INTO product_reasoning_jobs(id,user_id,product_id,google_subject,
                fingerprint,product_signature,schema_hash,status,revision,context)
                VALUES(%s,%s,%s,'subject',%s,'signature','schema','queued',1,'{}')''',
                (job_id, user_id, product_id, job_id.hex))
    return job_id


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_multiple_claimers_allow_only_one_running_job_per_account(environment, kind):
    _, _, database = environment
    first_user, second_user, first_job, other_job, table, _ = setup_jobs(
        database, kind, 'queued', 'queued', deleting=False)
    queued_for_first = second_job(database, kind, first_user)
    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)

    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(queue.claim, ('worker-a', 'worker-b', 'worker-c')))
    claimed = [row for row in rows if row]
    assert len(claimed) == 2
    assert {row['user_id'] for row in claimed} == {first_user, second_user}
    assert {row['id'] for row in claimed} == {first_job, other_job}
    assert queue.claim('explicit-busy-account', queued_for_first) is None
    with database.connect() as c:
        assert c.execute(f"SELECT count(*) AS n FROM {table} WHERE user_id=%s AND status='running'",
                         (first_user,)).fetchone()['n'] == 1
        c.execute(f"UPDATE {table} SET status=%s,lease_token=NULL,lease_until=NULL WHERE id=%s",
                  ('ready' if kind == 'materials' else 'completed', first_job))

    next_row = queue.claim('after-first-completes')
    assert next_row and next_row['id'] == queued_for_first


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_expired_lease_recovery_releases_account_capacity(environment, kind):
    _, _, database = environment
    first_user, second_user, first_job, other_job, table, _ = setup_jobs(
        database, kind, 'queued', 'queued', deleting=False)
    queued_for_first = second_job(database, kind, first_user)
    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)

    first = queue.claim('first-worker', first_job)
    assert first and first['id'] == first_job
    assert queue.claim('blocked-while-live', queued_for_first) is None
    with database.connect() as c:
        c.execute(f"UPDATE {table} SET lease_until=now()-interval '1 second' WHERE id=%s",
                  (first_job,))

    recovered_slot = queue.claim('after-recovery', queued_for_first)
    assert recovered_slot and recovered_slot['id'] == queued_for_first
    assert recovered_slot['user_id'] == first_user
    assert queue.claim('same-account-blocked-again', first_job) is None
    other = queue.claim('other-account')
    assert other and other['id'] == other_job and other['user_id'] == second_user


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_new_running_lease_after_account_selection_is_seen_before_job_claim(environment, kind):
    _, _, database = environment
    first_user, _, first_job, _, table, _ = setup_jobs(
        database, kind, 'queued', 'queued', deleting=False)
    queued_for_first = second_job(database, kind, first_user)

    class SelectingConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, query, params=()):
            result = self.connection.execute(query, params)
            if 'FOR NO KEY UPDATE OF u SKIP LOCKED' in query:
                with database.connect() as other:
                    other.execute(f"UPDATE {table} SET status='running',lease_until=now()+interval '2 minutes'"
                                  ' WHERE id=%s', (first_job,))
            return result

    class InterleavedDatabase:
        @contextmanager
        def connect(self):
            with database.connect() as connection:
                yield SelectingConnection(connection)

    queue = MaterialsQueue(InterleavedDatabase()) if kind == 'materials' else ReasoningQueue(InterleavedDatabase())
    assert queue.claim('racing-worker', queued_for_first) is None
    with database.connect() as c:
        rows = c.execute(f'SELECT id,status FROM {table} WHERE user_id=%s', (first_user,)).fetchall()
    assert {row['id']: row['status'] for row in rows} == {
        first_job: 'running', queued_for_first: 'queued'}


@pytest.mark.parametrize('uncertain_call', [False, True])
def test_reasoning_null_lease_recovers_without_replaying_uncertain_call(environment, uncertain_call):
    _, _, database = environment
    first_user, _, first_job, _, _, _ = setup_jobs(
        database, 'reasoning', 'queued', 'queued', deleting=False)
    queued_for_first = second_job(database, 'reasoning', first_user)
    queue = ReasoningQueue(database)
    first = queue.claim('first-worker', first_job)
    assert first and first['id'] == first_job
    call_id = uuid4()
    with database.connect() as c:
        c.execute('UPDATE product_reasoning_jobs SET lease_until=NULL WHERE id=%s', (first_job,))
        if uncertain_call:
            c.execute('''INSERT INTO product_reasoning_calls
                (id,job_id,lease_token,phase,state,reserved_tokens)
                VALUES(%s,%s,%s,'propose','running',100)''',
                (call_id, first_job, first['lease_token']))

    claimed = queue.claim('after-null-lease', queued_for_first)
    assert claimed and claimed['id'] == queued_for_first
    with database.connect() as c:
        old = c.execute('SELECT status,lease_token,lease_until FROM product_reasoning_jobs WHERE id=%s',
                        (first_job,)).fetchone()
        calls = c.execute('SELECT id,state,acknowledged_at FROM product_reasoning_calls WHERE job_id=%s',
                          (first_job,)).fetchall()
    assert old['status'] == ('unknown' if uncertain_call else 'queued')
    assert old['lease_token'] is None and old['lease_until'] is None
    assert calls == ([{'id': call_id, 'state': 'unknown', 'acknowledged_at': None}]
                     if uncertain_call else [])
    if uncertain_call:
        assert queue.claim('no-automatic-replay', first_job) is None
