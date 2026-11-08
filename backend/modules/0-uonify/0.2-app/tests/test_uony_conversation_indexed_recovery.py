"""Expired conversation leases are found through running jobs, not users."""

from contextlib import contextmanager
import json
import os
from time import perf_counter

from app.uony_conversation_queue import ConversationQueue
from test_uony_conversation_indexed_claim import seed


def running(database, seconds, *, provider_started=False):
    user_id, request_id = seed(database)
    with database.connect() as c:
        c.execute("""UPDATE uony_conversation_jobs SET status='running',
            claim_count=1,lease_until=CASE WHEN %s::integer IS NULL THEN NULL
                ELSE now()+make_interval(secs=>%s::integer) END,
            provider_started_at=CASE WHEN %s THEN now() ELSE NULL END
            WHERE user_id=%s AND request_id=%s""",
            (seconds, seconds, provider_started, user_id, request_id))
    return user_id, request_id


def test_missing_and_expired_leases_recover_but_future_does_not(environment):
    _, _, db = environment
    db.migrate()
    missing_user, missing_job = running(db, None, provider_started=True)
    expired_user, expired_job = running(db, -30)
    future_user, future_job = running(db, 300)
    queue = ConversationQueue(db)

    assert queue.recover()
    with db.connect() as c:
        missing = c.execute("""SELECT status,error_code,usage FROM
            uony_conversation_jobs WHERE user_id=%s AND request_id=%s""",
            (missing_user, missing_job)).fetchone()
        expired = c.execute("""SELECT status FROM uony_conversation_jobs
            WHERE user_id=%s AND request_id=%s""",
            (expired_user, expired_job)).fetchone()
    assert missing['status'] == 'unknown'
    assert missing['error_code'] == 'consumption_unknown'
    assert missing['usage']['attemptedCalls'] >= 1
    assert missing['usage']['uncertainCalls'] >= 1
    assert expired['status'] == 'running'

    assert queue.recover()
    assert not queue.recover()
    with db.connect() as c:
        states = {row['request_id']: row['status'] for row in c.execute(
            'SELECT request_id,status FROM uony_conversation_jobs').fetchall()}
    assert states[expired_job] == 'queued'
    assert states[future_job] == 'running'


def test_recovery_skips_locked_account_without_locking_its_job(environment):
    _, _, db = environment
    db.migrate()
    first_user, first_job = running(db, -30)
    second_user, second_job = running(db, -10)
    queue = ConversationQueue(db)

    with db.connect() as held:
        held.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',
                     (first_user,))
        assert queue.recover()
        with db.connect() as c:
            states = {row['request_id']: row['status'] for row in c.execute(
                'SELECT request_id,status FROM uony_conversation_jobs').fetchall()}
        assert states[first_job] == 'running'
        assert states[second_job] == 'queued'
    assert queue.recover()
    with db.connect() as c:
        state = c.execute("""SELECT status FROM uony_conversation_jobs
            WHERE user_id=%s AND request_id=%s""",
            (first_user, first_job)).fetchone()
    assert state['status'] == 'queued'


def test_idle_batch_drains_many_expired_accounts_without_delaying_queued_work(
        environment):
    _, _, db = environment
    db.migrate()
    with db.connect() as c:
        c.execute("""CREATE TEMP TABLE batch AS SELECT gen_random_uuid() AS id,
            'recovery-batch-'||n AS subject,gen_random_uuid() AS request_id,n
            FROM generate_series(1,1024) AS n""")
        c.execute("""INSERT INTO users(id,google_subject,email)
            SELECT id,subject,subject||'@example.test' FROM batch""")
        c.execute("""INSERT INTO uony_threads(user_id,id,title)
            SELECT id,'batch','Synthetic' FROM batch""")
        c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,
            prompt,status,model,project_id) SELECT id,request_id,'batch',
            'Synthetic','running','fixture','fixture' FROM batch""")
        c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,
            thread_id,google_subject,project_id,payload,status,engine,
            claim_count,lease_until,provider_started_at)
            SELECT id,request_id,'batch',subject,'fixture',
            '{"text":"synthetic"}'::jsonb,'running','classic',1,
            now()-interval '30 seconds',
            CASE WHEN n%7=0 THEN now()-interval '1 minute' ELSE NULL END
            FROM batch""")
    fresh_user, fresh_job = seed(db)
    queue = ConversationQueue(db)
    claimed = queue.claim('new-work')
    assert claimed and (claimed['user_id'], claimed['request_id']) == (
        fresh_user, fresh_job)
    started = perf_counter()
    assert queue.recover_many(32) == 32

    total = 32
    cycles = 1
    while recovered := queue.recover_many(32):
        assert recovered <= 32
        total += recovered
        cycles += 1
    assert total == 1023  # claim() already recovered one account.
    assert cycles == 32
    with db.connect() as c:
        counts = c.execute("""SELECT count(*) FILTER (WHERE status='running') AS running,
            count(*) FILTER (WHERE status='unknown') AS unknown,
            count(*) FILTER (WHERE status='queued') AS queued,
            count(*) FILTER (WHERE status='unknown' AND
                (usage->>'attemptedCalls')::int>=1 AND
                (usage->>'uncertainCalls')::int>=1) AS accounted
            FROM uony_conversation_jobs
            WHERE google_subject LIKE 'recovery-batch-%'""").fetchone()
        fresh = c.execute("""SELECT status FROM uony_conversation_jobs
            WHERE user_id=%s AND request_id=%s""",
            (fresh_user, fresh_job)).fetchone()
    assert counts['running'] == 0
    assert counts['unknown'] == 1024//7 == counts['accounted']
    assert counts['queued'] == 1024-1024//7
    assert fresh['status'] == 'running'
    if os.environ.get('UONIFY_QA_PLAN_DETAILS') == '1':
        print('RECOVERY_BATCH_METRICS ' + json.dumps({
            'expiredAccounts': 1024,
            'recoveredAfterFreshClaim': total,
            'idleCycles': cycles,
            'drainMs': round((perf_counter()-started)*1000),
            'unknownNeverReplayed': counts['unknown'],
        }, sort_keys=True))


def test_renewed_lease_between_account_and_job_lock_is_not_recovered(
        environment):
    _, _, db = environment
    db.migrate()
    user_id, request_id = running(db, -10, provider_started=True)
    renewed = []

    class OneRow:
        def __init__(self, row):
            self.row = row

        def fetchone(self):
            return self.row

    class RenewingConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, params=()):
            cursor = self.connection.execute(statement, params)
            if 'FOR UPDATE OF u SKIP LOCKED' in statement and not renewed:
                selected = cursor.fetchone()
                assert selected['id'] == user_id
                # A different transaction extends the lease while recover()
                # still holds only the account lock.
                with db.connect() as heartbeat:
                    heartbeat.execute("SET LOCAL lock_timeout='2s'")
                    heartbeat.execute("""UPDATE uony_conversation_jobs
                        SET lease_until=now()+interval '2 minutes'
                        WHERE user_id=%s AND request_id=%s""",
                        (user_id, request_id))
                renewed.append(True)
                return OneRow(selected)
            return cursor

    class RenewingDatabase:
        @contextmanager
        def connect(self):
            with db.connect() as connection:
                yield RenewingConnection(connection)

    assert ConversationQueue(RenewingDatabase()).recover() is None
    assert not ConversationQueue(db).recover_many()
    with db.connect() as c:
        job = c.execute("""SELECT status,lease_until,error_code,usage
            FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s""",
            (user_id, request_id)).fetchone()
    assert job['status'] == 'running'
    assert job['lease_until'] is not None
    assert job['error_code'] is None
    assert not job['usage'].get('attemptedCalls')


def test_recovery_plan_probes_expired_jobs_not_ten_thousand_users(environment):
    _, _, db = environment
    db.migrate()
    with db.connect() as c:
        c.execute("""CREATE TEMP TABLE bulk AS SELECT gen_random_uuid() AS id,
            'recovery-bulk-'||n AS subject,gen_random_uuid() AS request_id
            FROM generate_series(1,10000) AS n""")
        c.execute("""INSERT INTO users(id,google_subject,email)
            SELECT id,subject,subject||'@example.test' FROM bulk""")
        c.execute("""INSERT INTO uony_threads(user_id,id,title)
            SELECT id,'recovery','Synthetic' FROM bulk""")
        c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,
            prompt,status,model,project_id) SELECT id,request_id,'recovery',
            'Synthetic','running','fixture','fixture' FROM bulk""")
        c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,
            thread_id,google_subject,project_id,payload,status,engine,
            claim_count,lease_until) SELECT id,request_id,'recovery',subject,
            'fixture','{"text":"synthetic"}'::jsonb,'running','classic',1,
            now()+interval '5 minutes' FROM bulk""")
    due_user, due_job = running(db, -20)
    with db.connect() as c:
        c.execute('ANALYZE users')
        c.execute('ANALYZE uony_conversation_jobs')

    plans = []

    class ExplainingConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, params=()):
            if "WHERE j.status='running'" in statement and \
                    'FOR UPDATE OF u SKIP LOCKED' in statement:
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

    queue = ConversationQueue(ExplainingDatabase())
    assert queue.recover()
    assert not queue.recover()
    assert len(plans) == 2
    plan = plans[0]['Plan']

    def walk(node):
        yield node
        for child in node.get('Plans', []):
            yield from walk(child)

    nodes = list(walk(plan))
    user_nodes = [node for node in nodes if node.get('Relation Name') == 'users']
    job_nodes = [node for node in nodes if node.get('Relation Name') == 'uony_conversation_jobs']
    assert user_nodes and job_nodes
    assert all(node['Node Type'] != 'Seq Scan' for node in user_nodes)
    assert any(node.get('Index Name') == 'uony_conversation_running_lease_due'
               for node in job_nodes)
    assert sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
               for node in user_nodes) <= 4
    assert sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
               for node in job_nodes) <= 4
    empty_nodes = list(walk(plans[1]['Plan']))
    assert not any(node['Node Type'] == 'Seq Scan' and
                   node.get('Relation Name') == 'users' for node in empty_nodes)
    assert sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
               for node in empty_nodes
               if node.get('Relation Name') == 'users') == 0
    assert any(node.get('Index Name') == 'uony_conversation_running_lease_due'
               for node in empty_nodes)
    with db.connect() as c:
        state = c.execute("""SELECT status FROM uony_conversation_jobs
            WHERE user_id=%s AND request_id=%s""",
            (due_user, due_job)).fetchone()
    assert state['status'] == 'queued'
    if os.environ.get('UONIFY_QA_PLAN_DETAILS') == '1':
        print('RECOVERY_PLAN_METRICS ' + json.dumps({
            'runningJobs': 10001,
            'futureRunningJobs': 10000,
            'executionMs': plans[0]['Execution Time'],
            'emptyExecutionMs': plans[1]['Execution Time'],
            'userProbes': sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
                              for node in user_nodes),
            'jobRows': sum(node.get('Actual Rows', 0) * node.get('Actual Loops', 1)
                           for node in job_nodes),
            'indexes': [node['Index Name'] for node in nodes
                        if node.get('Index Name')],
        }, sort_keys=True))
