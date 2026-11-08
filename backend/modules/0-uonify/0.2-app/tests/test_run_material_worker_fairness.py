"""The shared worker must not starve materials behind a busy reasoning queue."""
from uuid import uuid4

from app.product_materials_queue import MaterialsQueue
from app.product_reasoning_queue import ReasoningQueue
from app.run_material_worker import claim_next


def _queued_jobs(database, reasoning_count, material_count):
    database.migrate()
    expected = {'reasoning': set(), 'materials': set()}
    with database.connect() as connection:
        for kind, count in (('reasoning', reasoning_count), ('materials', material_count)):
            for _ in range(count):
                user_id, product_id, job_id = uuid4(), uuid4(), uuid4()
                connection.execute(
                    'INSERT INTO users(id,google_subject,email,display_name) VALUES(%s,%s,%s,%s)',
                    (user_id, 'fixture-' + user_id.hex, 'fixture@example.test', 'Fixture'))
                connection.execute(
                    "INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                    (user_id, product_id, product_id.hex))
                if kind == 'reasoning':
                    connection.execute('''INSERT INTO product_reasoning_jobs(
                        id,user_id,product_id,google_subject,fingerprint,product_signature,
                        schema_hash,status,revision,context)
                        VALUES(%s,%s,%s,'subject',%s,'signature','schema','queued',1,'{}')''',
                        (job_id, user_id, product_id, job_id.hex))
                else:
                    connection.execute('''INSERT INTO product_material_jobs(
                        id,user_id,product_id,request_id,google_subject,revision,folder_id,status)
                        VALUES(%s,%s,%s,%s,'subject',1,'folder','queued')''',
                        (job_id, user_id, product_id, uuid4()))
                expected[kind].add(job_id)
    return expected


def test_sustained_reasoning_backlog_does_not_starve_other_accounts_materials(environment):
    _, _, database = environment
    expected = _queued_jobs(database, reasoning_count=12, material_count=6)
    reasoning, materials = ReasoningQueue(database), MaterialsQueue(database)
    prefer_reasoning, claimed = True, []
    for _ in range(18):
        kind, row, prefer_reasoning = claim_next(
            reasoning, materials, 'fairness-fixture', prefer_reasoning)
        assert kind and row and row['lease_token'] and row['lease_until']
        claimed.append((kind, row['id'], row['user_id']))

    # While both queues are busy, no more than one reasoning claim can pass
    # before a material claim, even though reasoning never becomes empty.
    assert [kind for kind, _, _ in claimed[:12]] == ['reasoning', 'materials'] * 6
    assert [kind for kind, _, _ in claimed[12:]] == ['reasoning'] * 6
    for kind in expected:
        assert {job_id for claimed_kind, job_id, _ in claimed if claimed_kind == kind} == expected[kind]
    assert len({user_id for _, _, user_id in claimed}) == 18
    assert claim_next(reasoning, materials, 'fairness-fixture', prefer_reasoning)[:2] == (None, None)
    with database.connect() as connection:
        for table, count in (('product_reasoning_jobs', 12), ('product_material_jobs', 6)):
            row = connection.execute(
                f"SELECT count(*) AS n FROM {table} WHERE status='running' AND lease_token IS NOT NULL"
            ).fetchone()
            assert row['n'] == count


def test_empty_preferred_queue_falls_back_and_preserves_next_priority():
    class Queue:
        def __init__(self, rows):
            self.rows = list(rows)
            self.calls = 0

        def claim(self, worker_id):
            assert worker_id == 'fixture'
            self.calls += 1
            return self.rows.pop(0) if self.rows else None

    reasoning, materials = Queue([]), Queue([{'id': 'material'}])
    kind, row, preference = claim_next(reasoning, materials, 'fixture', True)
    assert (kind, row['id'], preference) == ('materials', 'material', True)
    assert (reasoning.calls, materials.calls) == (1, 1)
    assert claim_next(reasoning, materials, 'fixture', preference) == (None, None, True)


def test_claim_reserves_only_one_job_when_both_queues_are_busy():
    class Queue:
        def __init__(self, name):
            self.name, self.calls = name, 0

        def claim(self, worker_id):
            assert worker_id == 'fixture'
            self.calls += 1
            return {'id': self.name}

    reasoning, materials = Queue('reasoning'), Queue('materials')
    assert claim_next(reasoning, materials, 'fixture', True) == (
        'reasoning', {'id': 'reasoning'}, False)
    assert (reasoning.calls, materials.calls) == (1, 0)
    assert claim_next(reasoning, materials, 'fixture', False) == (
        'materials', {'id': 'materials'}, True)
    assert (reasoning.calls, materials.calls) == (1, 1)
