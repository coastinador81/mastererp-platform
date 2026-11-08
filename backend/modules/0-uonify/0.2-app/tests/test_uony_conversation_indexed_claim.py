"""Job-first conversation claims stay fair without scanning every account."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import os
from threading import Barrier
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from app.uony_conversation_queue import ConversationQueue


def seed(database, *, engine='classic', seconds=0, deleted=False):
    user_id, request_id = uuid4(), uuid4()
    subject = f'indexed-{user_id.hex}'
    with database.connect() as c:
        c.execute("""INSERT INTO users(id,google_subject,email)
            VALUES(%s,%s,%s)""",
            (user_id, subject, f'{user_id.hex}@example.test'))
        c.execute("""INSERT INTO uony_threads(user_id,id,title)
            VALUES(%s,'indexed','Synthetic')""", (user_id,))
        c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,
            status,model,project_id) VALUES(%s,%s,'indexed','Synthetic',
            'running','fixture','fixture')""", (user_id, request_id))
        c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
            google_subject,project_id,payload,status,engine,available_at)
            VALUES(%s,%s,'indexed',%s,'fixture',%s,'queued',%s,
            now()-make_interval(secs=>%s))""",
            (user_id, request_id, subject, Jsonb({'text': 'synthetic'}),
             engine, seconds))
        if deleted:
            c.execute('UPDATE users SET deletion_requested_at=now() WHERE id=%s',
                      (user_id,))
    return user_id, request_id


def test_two_claimers_take_distinct_jobs_without_duplicates(environment):
    _, _, db = environment
    db.migrate()
    jobs = [seed(db, seconds=30 - i) for i in range(12)]
    queue = ConversationQueue(db)
    barrier = Barrier(4)

    def claim(index):
        barrier.wait(timeout=5)
        return queue.claim(f'indexed-{index}')

    with ThreadPoolExecutor(max_workers=4) as pool:
        claimed = list(pool.map(claim, range(4)))
    ids = [item['request_id'] for item in claimed if item]
    assert len(ids) == 4 and len(set(ids)) == 4
    assert set(ids).issubset({request_id for _, request_id in jobs})
    with db.connect() as c:
        rows = c.execute("""SELECT request_id,claim_count FROM uony_conversation_jobs
            WHERE status='running'""").fetchall()
    assert {row['request_id'] for row in rows} == set(ids)
    assert all(row['claim_count'] == 1 for row in rows)


def test_locked_oldest_account_is_skipped_without_locking_job_first(environment):
    _, _, db = environment
    db.migrate()
    oldest_user, oldest_job = seed(db, seconds=30)
    next_user, next_job = seed(db, seconds=10)
    queue = ConversationQueue(db)
    with db.connect() as held:
        held.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',
                     (oldest_user,))
        claimed = queue.claim('next')
        assert claimed and (claimed['user_id'], claimed['request_id']) == (
            next_user, next_job)
        assert held.execute("""SELECT status FROM uony_conversation_jobs
            WHERE user_id=%s AND request_id=%s""",
            (oldest_user, oldest_job)).fetchone()['status'] == 'queued'
    claimed = queue.claim('oldest')
    assert claimed and (claimed['user_id'], claimed['request_id']) == (
        oldest_user, oldest_job)


def test_disabled_engine_and_deleted_account_do_not_block_eligible_work(environment):
    _, _, db = environment
    db.migrate()
    _, disabled_job = seed(db, engine='adk', seconds=30)
    _, deleted_job = seed(db, seconds=20, deleted=True)
    active_user, active_job = seed(db, seconds=10)
    claimed = ConversationQueue(db, engines=('classic',)).claim('eligible')
    assert claimed and (claimed['user_id'], claimed['request_id']) == (
        active_user, active_job)
    with db.connect() as c:
        states = {row['request_id']: row['status'] for row in c.execute(
            'SELECT request_id,status FROM uony_conversation_jobs').fetchall()}
    assert states[disabled_job] == states[deleted_job] == 'queued'


@pytest.mark.parametrize('engines,expected_engine', [
    (('classic',), 'classic'),
    (('classic', 'adk'), 'adk'),
])
def test_claim_plan_probes_queued_jobs_not_ten_thousand_users(
        environment, engines, expected_engine):
    _, _, db = environment
    db.migrate()
    with db.connect() as c:
        c.execute("""INSERT INTO users(id,google_subject,email)
            SELECT gen_random_uuid(), 'indexed-bulk-' || n,
                'bulk-' || n || '@example.test'
            FROM generate_series(1,10000) AS n""")
        c.execute("""CREATE TEMP TABLE disabled_jobs AS
            SELECT id,google_subject,gen_random_uuid() AS request_id
            FROM users WHERE google_subject LIKE 'indexed-bulk-%' LIMIT 1000""")
        c.execute("""INSERT INTO uony_threads(user_id,id,title)
            SELECT id,'indexed','Synthetic' FROM disabled_jobs""")
        c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,
            status,model,project_id)
            SELECT id,request_id,'indexed','Synthetic','running','fixture','fixture'
            FROM disabled_jobs""")
        c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
            google_subject,project_id,payload,status,engine,available_at)
            SELECT id,request_id,'indexed',google_subject,'fixture',
                '{"text":"synthetic"}'::jsonb,'queued','adk',
                now()-interval '20 seconds' FROM disabled_jobs""")
    wanted_user, wanted_job = seed(db, seconds=10)
    with db.connect() as c:
        c.execute('ANALYZE users')
        c.execute('ANALYZE uony_conversation_jobs')

    plans = []
    recovery_plans = []

    class ExplainingConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, params=()):
            if "WHERE j.status='running'" in statement and 'FOR UPDATE OF u SKIP LOCKED' in statement and not recovery_plans:
                result = self.connection.execute(
                    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement,
                    params).fetchone()
                recovery_plans.append(result['QUERY PLAN'][0])
            if 'FOR NO KEY UPDATE OF u SKIP LOCKED' in statement and not plans:
                result = self.connection.execute(
                    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement,
                    params).fetchone()
                plans.append(result['QUERY PLAN'][0])
            return self.connection.execute(statement, params)

    class ExplainingDatabase:
        @contextmanager
        def connect(self):
            with db.connect() as connection:
                yield ExplainingConnection(connection)

    claimed = ConversationQueue(ExplainingDatabase(), engines=engines).claim('plan')
    assert claimed and claimed['engine'] == expected_engine
    if expected_engine == 'classic':
        assert (claimed['user_id'], claimed['request_id']) == (
            wanted_user, wanted_job)
    assert len(plans) == len(recovery_plans) == 1

    def walk(node):
        yield node
        for child in node.get('Plans', []):
            yield from walk(child)

    for explanation in (*plans, *recovery_plans):
        nodes = list(walk(explanation['Plan']))
        user_nodes = [node for node in nodes if node.get('Relation Name') == 'users']
        assert all(node['Node Type'] != 'Seq Scan' for node in user_nodes)
        assert sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
                   for node in user_nodes) <= 4
    claim_user_nodes = [node for node in walk(plans[0]['Plan'])
                        if node.get('Relation Name') == 'users']
    job_nodes = [node for node in walk(plans[0]['Plan'])
                 if node.get('Relation Name') == 'uony_conversation_jobs']
    assert job_nodes
    assert sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
               for node in job_nodes) <= 4
    assert plans[0]['Planning Time'] >= 0
    if os.environ.get('UONIFY_QA_PLAN_DETAILS') == '1':
        print('CLAIM_PLAN_METRICS ' + json.dumps({
            'accounts': 10001,
            'disabledAdkJobs': 1000,
            'engines': engines,
            'claimExecutionMs': plans[0]['Execution Time'],
            'recoveryExecutionMs': recovery_plans[0]['Execution Time'],
            'claimUserProbes': sum(node.get('Actual Loops', 1)
                                   for node in claim_user_nodes),
            'claimJobRows': sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
                                for node in job_nodes),
            'claimIndexes': [node['Index Name'] for node in walk(plans[0]['Plan'])
                             if node.get('Index Name')],
        }, sort_keys=True))
