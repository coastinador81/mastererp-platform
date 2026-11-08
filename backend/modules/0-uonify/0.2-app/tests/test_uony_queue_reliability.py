"""Crash, fencing and scoped operational observations; no provider/network calls."""
from datetime import timedelta
from uuid import uuid4
import json
import pytest
from app.database import Database
from app.uony_conversation_queue import ConversationQueue, LeaseLost
from app.uony_queue_health import WorkerMonitor
from app.uony_queue_monitoring import LatencyBudgets, queue_snapshot, worker_health
from app.uony_queue_state import RecoveryPolicy


@pytest.fixture
def database(environment):
    db = environment[2]
    db.migrate()
    return db


def seed(c, *, user=None, project=None, engine='adk', status='queued'):
    user = user or {'id': uuid4(), 'google_subject': 'fixture-' + uuid4().hex}
    request = uuid4()
    thread = uuid4().hex
    c.execute("""INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)
        ON CONFLICT DO NOTHING""", (user['id'], user['google_subject'], thread + '@example.test'))
    if project:
        c.execute("""INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')
            ON CONFLICT DO NOTHING""", (user['id'], project))
    c.execute("INSERT INTO uony_threads(user_id,id,project_id,title) VALUES(%s,%s,%s,'Fixture')",
              (user['id'], thread, project))
    c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,project_id)
        VALUES(%s,%s,%s,'SECRET TEST PROMPT','running','test-model','test-google-project')""",
              (user['id'], request, thread))
    c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
        google_subject,project_id,payload,status,engine)
        VALUES(%s,%s,%s,%s,'test-google-project','{}',%s,%s)""",
              (user['id'], request, thread, user['google_subject'], status, engine))
    return user, request


def expire(c, request):
    c.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-interval '2 seconds'
        WHERE request_id=%s""", (request,))


def due(c, request):
    c.execute("UPDATE uony_conversation_jobs SET available_at=now() WHERE request_id=%s", (request,))


def test_takeover_before_provider_is_fenced_and_keeps_adk(database):
    with database.connect() as c:
        user, request = seed(c)
    first = ConversationQueue(database, ('adk',))
    abandoned = first.claim('lost-worker')
    with database.connect() as c:
        expire(c, request)
    # A fresh process recovers the durable intent; it cannot silently use Classic.
    restarted = ConversationQueue(Database(database.config), ('classic',))
    assert restarted.claim('classic-worker') is None
    with database.connect() as c:
        due(c, request)
    second = ConversationQueue(Database(database.config), ('adk',))
    rescued = second.claim('replacement-worker')
    assert rescued['request_id'] == request and rescued['engine'] == 'adk'
    assert rescued['lease_token'] != abandoned['lease_token']
    assert rescued['claim_count'] == 2
    assert not first.renew_lease(abandoned)
    with pytest.raises(LeaseLost):
        first.provider_start(abandoned)
    with database.connect() as c, pytest.raises(LeaseLost):
        first.terminal(c, abandoned, 'success')
    second.provider_start(rescued)
    with database.connect() as c:
        rows = c.execute('SELECT * FROM uony_conversation_recoveries').fetchall()
        assert len(rows) == 1 and rows[0]['outcome'] == 'queued' and rows[0]['resumed_at']
        metrics = second.metrics(c, user)
    assert metrics['recovery']['requeued'] == metrics['recovery']['resumed'] == 1
    assert metrics['recovery']['maxDetectionMs'] >= 2000
    assert metrics['recovery']['maxResumeMs'] >= metrics['recovery']['maxDetectionMs']


@pytest.mark.parametrize('completed', [0, 1])
def test_crash_after_adk_start_never_replays_even_if_return_was_recorded(database, completed):
    with database.connect() as c:
        user, request = seed(c)
    queue = ConversationQueue(database, ('adk',))
    job = queue.claim('provider-worker')
    queue.stream_attempt(job, 1)
    if completed:
        queue.stream_complete(job, 1, {'attemptedCalls': 1, 'calls': 1})
        queue.provider_return(job)
    with database.connect() as c:
        expire(c, request)
    restored = ConversationQueue(Database(database.config), ('adk', 'classic'))
    assert restored.recover_many() == 1
    assert restored.claim('replacement') is None
    with database.connect() as c:
        saved = c.execute('SELECT * FROM uony_conversation_jobs WHERE request_id=%s', (request,)).fetchone()
        assert saved['status'] == 'unknown' and saved['engine'] == 'adk'
        assert saved['usage']['attemptedCalls'] == 1
        assert saved['usage']['calls'] == completed
        assert saved['usage']['uncertainCalls'] >= 1
        assert saved['lease_token'] is None
        assert restored.metrics(c, user)['recovery']['unknown'] == 1
    with pytest.raises(LeaseLost):
        queue.stream_complete(job, 1, {'attemptedCalls': 1, 'calls': 1})


def test_safe_recovery_has_bounded_attempts_and_no_fabricated_provider_usage(database):
    with database.connect() as c:
        user, request = seed(c)
    queue = ConversationQueue(database, ('adk',))
    for attempt in range(1, 4):
        job = queue.claim('worker-' + str(attempt))
        assert job['claim_count'] == attempt
        with database.connect() as c:
            expire(c, request)
        queue.recover()
        with database.connect() as c:
            due(c, request)
    assert queue.claim('fourth-worker') is None
    with database.connect() as c:
        saved = c.execute('SELECT * FROM uony_conversation_jobs').fetchone()
        assert saved['status'] == 'error' and saved['error_code'] == 'preparation_interrupted'
        assert saved['provider_attempt_count'] == 0 and saved['usage'] == {}
        metrics = queue.metrics(c, user)
        assert metrics['recovery']['requeued'] == 2
        assert metrics['recovery']['exhausted'] == 1


def test_renewal_preserves_live_lease_but_never_revives_expired_lease(database):
    with database.connect() as c:
        _, request = seed(c)
    queue = ConversationQueue(database, ('adk',))
    job = queue.claim('alive-worker')
    assert queue.renew_lease(job)
    assert queue.recover() is False
    with database.connect() as c:
        remaining = c.execute("SELECT extract(epoch FROM lease_until-now()) AS n FROM uony_conversation_jobs").fetchone()['n']
        assert 43 <= remaining <= 45
        expire(c, request)
    assert not queue.renew_lease(job)


def test_monitoring_percentiles_scope_and_redaction(database):
    project = uuid4()
    other_project = uuid4()
    with database.connect() as c:
        user = None
        clock = c.execute("SELECT now()-interval '3 minutes' AS at").fetchone()['at']
        for n in range(1, 21):
            user, request = seed(c, user=user, project=project, status='success')
            c.execute("""UPDATE uony_conversation_jobs SET created_at=%s,first_claimed_at=%s,
                last_claimed_at=%s,provider_started_at=%s,provider_returned_at=%s,finished_at=%s
                WHERE request_id=%s""", (clock, clock+timedelta(seconds=n),
                    clock+timedelta(seconds=n), clock+timedelta(seconds=n+2),
                    clock+timedelta(seconds=n+12), clock+timedelta(seconds=n+13), request))
        # Both a different workspace project and a different account are excluded.
        _, other = seed(c, user=user, project=other_project, status='success')
        seed(c, project=project, status='success')
        c.execute("""UPDATE uony_conversation_jobs SET created_at=now()-interval '1 hour',
            first_claimed_at=now(),finished_at=now() WHERE request_id=%s""", (other,))
        snapshot = queue_snapshot(c, user, project_id=project)
        assert snapshot['counts'] == {'success': 20}
        assert snapshot['timings']['queueMs'] == {
            'samples': 20, 'p95Ms': 19050.0, 'p99Ms': 19810.0, 'maxMs': 20000.0}
        assert snapshot['timings']['preparationMs']['p95Ms'] == 2000
        assert snapshot['timings']['providerMs']['p99Ms'] == 10000
        assert snapshot['timings']['checkingMs']['p99Ms'] == 1000
        assert snapshot['timings']['totalMs']['p95Ms'] == 32050
        assert len([a for a in snapshot['alerts'] if a['code'] == 'percentile_over_budget']) == 2
        text = json.dumps(snapshot)
        assert 'SECRET' not in text and str(request) not in text and user['google_subject'] not in text
        wrong_subject = queue_snapshot(c, {**user, 'google_subject': 'unrelated'}, project_id=project)
        assert wrong_subject['counts'] == {}
        with pytest.raises(ValueError):
            queue_snapshot(c, None)
        with pytest.raises(ValueError):
            queue_snapshot(c, user, window_seconds=86401)


def test_backlog_includes_old_jobs_and_reports_missing_or_stale_worker(database):
    with database.connect() as c:
        user, request = seed(c)
        c.execute("UPDATE uony_conversation_jobs SET created_at=now()-interval '2 days' WHERE request_id=%s", (request,))
        snapshot = queue_snapshot(c, user)
        assert snapshot['backlog']['queued'] == 1
        assert snapshot['backlog']['oldestQueuedMs'] >= 172800000
        assert snapshot['timings']['queueMs']['samples'] == 0
        assert {'code': 'no_healthy_worker', 'engine': 'adk'} in snapshot['alerts']
    monitor = WorkerMonitor(database, 'healthy', ('adk',))
    monitor.pulse()
    with database.connect() as c:
        snapshot = queue_snapshot(c, user)
        assert snapshot['workers']['adk']['healthy'] == 1
        assert not any(a['code'] == 'no_healthy_worker' for a in snapshot['alerts'])
        c.execute("UPDATE uony_conversation_workers SET heartbeat_at=now()-interval '31 seconds'")
        health = worker_health(c, LatencyBudgets())
        assert health['adk'] == {'healthy': 0, 'stale': 1}
    alerts = monitor.operational_alerts()
    assert {'code': 'queue_over_budget', 'engine': 'adk', 'count': 1} in alerts
    assert {'code': 'no_healthy_worker', 'engine': 'adk', 'count': 1} in alerts
    monitor.state('stopped')
    with database.connect() as c:
        assert worker_health(c, LatencyBudgets())['adk'] == {'healthy': 0, 'stale': 0}


def test_budget_configuration_and_worker_lifecycle(database):
    assert RecoveryPolicy.from_environment({}) == RecoveryPolicy(45, 10, 3)
    with pytest.raises(ValueError):
        RecoveryPolicy.from_environment({'UONIFY_QUEUE_LEASE_SECONDS': '20'})
    with pytest.raises(ValueError):
        RecoveryPolicy(lease_seconds=30, heartbeat_seconds=15)
    with pytest.raises(ValueError):
        LatencyBudgets.from_environment({'UONIFY_QUEUE_PROVIDER_BUDGET_MS': 'none'})
    assert LatencyBudgets.from_environment({'UONIFY_QUEUE_PROVIDER_BUDGET_MS': '40000'}).provider_ms == 40000
    with pytest.raises(ValueError):
        WorkerMonitor(database, 'inconsistent', ('adk',), policy=RecoveryPolicy(90, 30))
    monitor = WorkerMonitor(database, 'monitored', ('adk',))
    with monitor.running():
        monitor.state('running')
        with database.connect() as c:
            assert c.execute('SELECT status FROM uony_conversation_workers').fetchone()['status'] == 'running'
    with database.connect() as c:
        saved = c.execute('SELECT status,stopped_at FROM uony_conversation_workers').fetchone()
        assert saved['status'] == 'stopped' and saved['stopped_at']


def _crashable_worker(config, provider_started, pipe):
    from threading import Event
    database = Database(config)
    queue = ConversationQueue(database, ('adk',))
    job = queue.claim('process-that-dies')
    if provider_started:
        queue.stream_attempt(job, 1)
    pipe.send(str(job['request_id']))
    Event().wait(30)


@pytest.mark.parametrize('provider_started', [False, True])
def test_actual_worker_process_death_respects_checkpoint(database, provider_started):
    from multiprocessing import get_context
    with database.connect() as c:
        _, request = seed(c)
    context = get_context('spawn')
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_crashable_worker,
                              args=(database.config, provider_started, sender))
    process.start()
    try:
        assert receiver.poll(10), 'Worker did not reach the durable checkpoint'
        assert receiver.recv() == str(request)
        process.terminate()
        process.join(5)
        assert not process.is_alive()
        with database.connect() as c:
            # Advance the DB lease clock instead of spending 45s sleeping.
            expire(c, request)
        replacement = ConversationQueue(Database(database.config), ('adk',))
        replacement.recover()
        with database.connect() as c:
            due(c, request)
        claimed = replacement.claim('process-replacement')
        assert (claimed is None) == provider_started
        if claimed:
            assert claimed['request_id'] == request and claimed['claim_count'] == 2
        with database.connect() as c:
            row = c.execute('SELECT status,provider_attempt_count FROM uony_conversation_jobs').fetchone()
        assert row == {'status': 'unknown' if provider_started else 'running',
                       'provider_attempt_count': int(provider_started)}
    finally:
        if process.is_alive():
            process.terminate()
        process.join(5)
        receiver.close()
        sender.close()
