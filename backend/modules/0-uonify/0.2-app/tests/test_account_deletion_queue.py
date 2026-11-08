"""Una eliminación pendiente no bloquea las colas de los demás clientes."""
from uuid import uuid4
from contextlib import contextmanager
import pytest
from psycopg.errors import LockNotAvailable
from app.product_materials_queue import MaterialsQueue
from app.product_reasoning_queue import ReasoningQueue


def setup_jobs(database, kind, frozen_status, other_status='running', deleting=True):
    database.migrate()
    frozen, other, frozen_product, other_product, frozen_job, other_job = [uuid4() for _ in range(6)]
    table = 'product_material_jobs' if kind == 'materials' else 'product_reasoning_jobs'
    with database.connect() as c:
        for user_id, product_id, job_id, status in (
            (frozen, frozen_product, frozen_job, frozen_status), (other, other_product, other_job, other_status)):
            c.execute('INSERT INTO users(id,google_subject,email,display_name) VALUES(%s,%s,%s,%s)',
                      (user_id, 'subject-'+user_id.hex, 'fixture@example.test', 'Fixture'))
            c.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                      (user_id, product_id, user_id.hex))
            if kind == 'materials':
                c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,
                    google_subject,revision,folder_id,status,lease_token,lease_until)
                    VALUES(%s,%s,%s,%s,'subject',1,'folder',%s,%s,now()-interval '1 minute')''',
                    (job_id, user_id, product_id, uuid4(), status, uuid4()))
            else:
                c.execute('''INSERT INTO product_reasoning_jobs(id,user_id,product_id,google_subject,
                    fingerprint,product_signature,schema_hash,status,revision,context,lease_token,lease_until)
                    VALUES(%s,%s,%s,'subject',%s,'signature','schema',%s,1,'{}',%s,now()-interval '1 minute')''',
                    (job_id, user_id, product_id, job_id.hex, status, uuid4()))
        if deleting:
            c.execute('UPDATE users SET deletion_requested_at=now() WHERE id=%s', (frozen,))
        before = c.execute(f'SELECT * FROM {table} WHERE id=%s', (frozen_job,)).fetchone()
    return frozen, other, frozen_job, other_job, table, before


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
@pytest.mark.parametrize('frozen_status', ['running', 'queued'])
def test_frozen_jobs_are_not_recovered_or_claimed_and_other_user_continues(environment, kind, frozen_status):
    _, _, database = environment
    frozen, other, frozen_job, other_job, table, before = setup_jobs(database, kind, frozen_status)
    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)
    queue.recover()
    claimed = queue.claim('another-account-worker')
    assert claimed['id'] == other_job and claimed['user_id'] == other
    assert queue.claim('cannot-claim-frozen', frozen_job) is None
    with database.connect() as c:
        after = c.execute(f'SELECT * FROM {table} WHERE id=%s', (frozen_job,)).fetchone()
        assert after == before


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_account_confirmation_lock_is_skipped_before_job_claim_and_other_user_continues(environment, kind):
    _, _, database = environment
    frozen, other, frozen_job, other_job, _, _ = setup_jobs(database, kind, 'queued', 'queued', deleting=False)
    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)
    with database.connect() as deletion:
        deletion.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (frozen,))
        claimed = queue.claim('skip-confirming-account')
        assert claimed['id'] == other_job and claimed['user_id'] == other
        assert queue.claim('explicit-confirming-job', frozen_job) is None


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_claim_skips_account_being_claimed_and_serves_another_user(environment, kind):
    _, _, database = environment
    first_user, second_user, first_job, second_job, table, _ = setup_jobs(
        database, kind, 'queued', 'queued', deleting=False)
    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)
    with database.connect() as c:
        c.execute(f"UPDATE {table} SET updated_at=now()-interval '5 seconds' WHERE id=%s", (first_job,))
        c.execute(f"UPDATE {table} SET updated_at=now()-interval '1 second' WHERE id=%s", (second_job,))

    # The first claimant holds its account barrier and job in an open PG
    # transaction. A second claimant must skip both and claim the other user.
    # KEY SHARE was compatible with NO KEY UPDATE, so it selected first_user
    # again, saw the job locked, and returned None despite pending work.
    with database.connect() as first_claimant:
        first_claimant.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE', (first_user,))
        first_claimant.execute(f'SELECT id FROM {table} WHERE id=%s FOR UPDATE', (first_job,))
        claimed = queue.claim('second-claimant')
        assert claimed and claimed['id'] == second_job and claimed['user_id'] == second_user
        assert queue.claim('explicit-busy-job', first_job) is None

    first = queue.claim('first-claimant')
    assert first and first['id'] == first_job and first['user_id'] == first_user


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_claim_holds_account_barrier_before_marking_job_running(environment, kind):
    _, _, database = environment
    frozen, _, frozen_job, _, table, _ = setup_jobs(database, kind, 'queued', 'queued', deleting=False)
    checked = []
    class Proxy:
        def __init__(self, connection): self.connection = connection
        def execute(self, query, params=()):
            if f'UPDATE {table}' in query and "SET status='running'" in query:
                with pytest.raises(LockNotAvailable):
                    with database.connect() as deletion:
                        deletion.execute('SELECT id FROM users WHERE id=%s FOR UPDATE NOWAIT', (frozen,))
                checked.append(True)
            return self.connection.execute(query, params)
    class BarrierDatabase:
        @contextmanager
        def connect(self):
            with database.connect() as connection:
                yield Proxy(connection)
    queue = MaterialsQueue(BarrierDatabase()) if kind == 'materials' else ReasoningQueue(BarrierDatabase())
    claimed = queue.claim('account-first', frozen_job)
    assert claimed['id'] == frozen_job and checked == [True]
