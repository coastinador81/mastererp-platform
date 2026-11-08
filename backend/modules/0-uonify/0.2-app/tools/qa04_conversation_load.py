"""Disposable-schema, fake-provider load probe for the durable conversation queue.

Run inside the backend image with the source mounted read-only. No HTTP, Google,
Amazon, production schema, or shared worker is used. Results are measurements of
this local PostgreSQL host, not a production capacity promise.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from threading import Lock
from time import perf_counter, sleep
from uuid import uuid4

from fastapi import HTTPException
from psycopg import sql
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from app.database import Database
from app.settings import load_settings
from app.uony_engine import CLASSIC
from app.uony_conversation_queue import ConversationQueue
from app.uony_routes import Message


def require_local_database_target(environ, in_container):
    """Refuse remote/libpq-overridden targets before reading local credentials."""
    local = (in_container and environ.get('PGHOST', 'db') == 'db'
             and environ.get('PGDATABASE', 'uonify') == 'uonify'
             and environ.get('PGUSER', 'uonify') == 'uonify'
             and environ.get('PGPORT', '5432') == '5432'
             and environ.get('UONIFY_ORIGIN', 'http://127.0.0.1:5173')
                 == 'http://127.0.0.1:5173'
             and not any(environ.get(key) for key in
                         ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS')))
    if not local:
        raise RuntimeError('QA-04 solo permite PostgreSQL del Compose local; destino rechazado')


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return None
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))], 2)


def seed(database, count):
    rows = [(uuid4(), uuid4(), index) for index in range(count)]
    with database.connect() as connection:
        connection.cursor().executemany(
            "INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)",
            [(user, f'qa04-subject-{index}', f'qa04-{index}@example.test')
             for user, _, index in rows])
        connection.cursor().executemany(
            "INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)",
            [(user, f'qa04-thread-{index}', 'Prueba sintética')
             for user, _, index in rows])
    return rows


def admit(database, queue, rows):
    """Use the production queue's admission guard, with only synthetic inputs."""
    accepted, refused, timings = [], [], []
    for user_id, request_id, index in rows:
        body = Message(requestId=request_id, threadId=f'qa04-thread-{index}',
                       text='Petición sintética')
        user = {'id': user_id, 'google_subject': f'qa04-subject-{index}'}
        started = perf_counter()
        try:
            with database.connect() as connection:
                queued = queue.enqueue(connection, user, body,
                                       {'project_id': 'project-fixture'},
                                       'gemini-fixture', 'synthetic_load', {}, CLASSIC)
                assert queued['status'] == 'queued'
        except HTTPException as exc:
            assert exc.status_code == 429 and exc.detail['error'] == 'capacity_busy'
            refused.append((user_id, request_id, index))
        else:
            accepted.append((user_id, request_id, index))
        timings.append((perf_counter() - started) * 1000)
    return accepted, refused, timings


def assert_isolation_and_account_limit(database, queue, rows):
    first, _, _ = rows[0]
    _, other_request, _ = rows[1]
    with database.connect() as connection:
        try:
            queue.inspect(connection, {'id': first, 'google_subject': 'qa04-subject-0'},
                          other_request)
        except HTTPException as exc:
            assert exc.status_code == 404
        else:
            raise AssertionError('A second account was visible')
    duplicate = uuid4()
    try:
        with database.connect() as connection:
            connection.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,
                prompt,status,model,project_id) VALUES(%s,%s,'qa04-thread-0',
                'Otra petición','running','gemini-fixture','project-fixture')""",
                (first, duplicate))
            connection.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,
                thread_id,google_subject,project_id,payload,status) VALUES(%s,%s,
                'qa04-thread-0','qa04-subject-0','project-fixture','{}'::jsonb,'queued')""",
                (first, duplicate))
    except UniqueViolation:
        pass
    else:
        raise AssertionError('One account admitted two active jobs')


def assert_recovery(database, queue):
    # A provider call that started may have consumed credit. No replay is safe.
    started = queue.claim('qa04-fault-started')
    assert started is not None
    queue.provider_start(started)
    with database.connect() as connection:
        connection.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-
            interval '1 second' WHERE user_id=%s AND request_id=%s""",
            (started['user_id'], started['request_id']))
    assert queue.recover()
    with database.connect() as connection:
        state = connection.execute("""SELECT status,usage FROM uony_conversation_jobs
            WHERE user_id=%s AND request_id=%s""",
            (started['user_id'], started['request_id'])).fetchone()
    assert state['status'] == 'unknown'
    assert state['usage']['attemptedCalls'] == 1
    assert state['usage']['uncertainCalls'] == 1

    # Before contacting Google, a timed-out lease can cool down and retry.
    preparing = queue.claim('qa04-fault-preparing')
    assert preparing is not None
    with database.connect() as connection:
        connection.execute("""UPDATE uony_conversation_jobs SET lease_until=now()-
            interval '1 second' WHERE user_id=%s AND request_id=%s""",
            (preparing['user_id'], preparing['request_id']))
    assert queue.recover()
    with database.connect() as connection:
        state = connection.execute("""SELECT status,claim_count,usage,available_at
            FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s""",
            (preparing['user_id'], preparing['request_id'])).fetchone()
        assert state['status'] == 'queued' and state['claim_count'] == 1
        assert not state['usage'].get('attemptedCalls')
        assert state['available_at'] > datetime.now(timezone.utc)
        # Restore only the synthetic fixture's availability for throughput work.
        connection.execute("""UPDATE uony_conversation_jobs SET available_at=now()
            WHERE user_id=%s AND request_id=%s""",
            (preparing['user_id'], preparing['request_id']))
    return {'startedUnknown': str(started['request_id']),
            'preProviderRequeued': str(preparing['request_id'])}


def run_workers(database, queue, jobs_expected, workers, provider_delay_ms):
    claim_ms = []
    worker_counts = Counter()
    finished_total = 0
    finished_lock = Lock()

    def worker(worker_number):
        nonlocal finished_total
        local_claims = []
        finished = 0
        started = perf_counter()
        while True:
            began = perf_counter()
            job = queue.claim(f'qa04-worker-{worker_number}')
            elapsed = (perf_counter() - began) * 1000
            if not job:
                with finished_lock:
                    complete = finished_total == jobs_expected
                if complete:
                    break
                if perf_counter() - started > 180:
                    raise AssertionError('Workers could not drain the synthetic queue')
                sleep(.02)
                continue
            local_claims.append(elapsed)
            queue.provider_start(job)
            if provider_delay_ms:
                sleep(provider_delay_ms / 1000)
            # Deterministic fake provider refusal: no network and no retry.
            limited = int(job['thread_id'].rsplit('-', 1)[-1]) % 13 == 0
            if limited:
                with database.connect() as connection:
                    queue.terminal(connection, job, 'unknown', 'consumption_unknown',
                                   {'attemptedCalls': 1, 'uncertainCalls': 1})
            else:
                queue.provider_return(job)
                with database.connect() as connection:
                    connection.execute("""UPDATE uony_requests SET status='success',
                        reply='Respuesta sintética',usage=%s WHERE user_id=%s
                        AND request_id=%s""",
                        (Jsonb({'calls': 1, 'attemptedCalls': 1,
                                'totalTokenCount': 16}), job['user_id'], job['request_id']))
                    queue.terminal(connection, job, 'success', usage={
                        'calls': 1, 'attemptedCalls': 1, 'totalTokenCount': 16})
            finished += 1
            with finished_lock:
                finished_total += 1
        return worker_number, finished, local_claims

    began = perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(worker, range(workers)))
    elapsed = perf_counter() - began
    for number, finished, claims in results:
        worker_counts[str(number)] = finished
        claim_ms.extend(claims)
    assert sum(worker_counts.values()) == jobs_expected, (worker_counts, jobs_expected)
    return elapsed, claim_ms, worker_counts


def measure(database, queue, account_count, workers, provider_delay_ms):
    began = perf_counter()
    rows = seed(database, account_count)
    seed_seconds = perf_counter() - began
    execution_started = perf_counter()
    pending = rows
    admission_ms, claims = [], []
    worker_counts = Counter()
    refusals = waves = 0
    worker_seconds = 0
    recovered = plan = None
    while pending:
        # Overfill a bounded wave to exercise the real 429 guard. The same
        # rejected request IDs are retried only after the accepted wave drains.
        candidates, remainder = pending[:queue.active_limit * 2], pending[queue.active_limit * 2:]
        accepted, refused, timings = admit(database, queue, candidates)
        assert accepted and len(accepted) <= queue.active_limit
        admission_ms.extend(timings)
        refusals += len(refused)
        with database.connect() as connection:
            if refused:
                rejected_ids = [request_id for _, request_id, _ in refused]
                assert connection.execute("""SELECT count(*) AS n FROM uony_requests
                    WHERE request_id=ANY(%s::uuid[])""", (rejected_ids,)).fetchone()['n'] == 0
                assert connection.execute("""SELECT count(*) AS n FROM uony_conversation_jobs
                    WHERE request_id=ANY(%s::uuid[])""", (rejected_ids,)).fetchone()['n'] == 0
            assert connection.execute("""SELECT count(*) AS n FROM uony_conversation_jobs
                WHERE status IN ('queued','running')""").fetchone()['n'] == len(accepted)
        if waves == 0:
            assert_isolation_and_account_limit(database, queue, accepted)
            recovered = assert_recovery(database, queue)
            with database.connect() as connection:
                plan = connection.execute("""EXPLAIN (ANALYZE, FORMAT JSON)
                    SELECT u.id FROM uony_conversation_jobs j
                    JOIN users u ON u.id=j.user_id
                    WHERE j.status='queued' AND j.available_at<=now()
                    AND j.engine=%s AND u.deletion_requested_at IS NULL
                    ORDER BY j.available_at,j.created_at,j.user_id,j.request_id
                    LIMIT 1""", (CLASSIC,)).fetchone()['QUERY PLAN'][0]
        elapsed, wave_claims, wave_counts = run_workers(
            database, queue, len(accepted) - (1 if waves == 0 else 0),
            workers, provider_delay_ms)
        worker_seconds += elapsed
        claims.extend(wave_claims)
        worker_counts.update(wave_counts)
        pending = refused + remainder
        waves += 1
        assert waves <= account_count, 'Admission failed to drain synthetic accounts'
    assert refusals > 0 and len(admission_ms) == account_count + refusals
    execution_seconds = perf_counter() - execution_started
    with database.connect() as connection:
        latest_migration = connection.execute(
            'SELECT max(name) AS latest FROM schema_migrations').fetchone()['latest']
        summary = connection.execute("""SELECT status,count(*) AS n FROM
            uony_conversation_jobs GROUP BY status""").fetchall()
        attempts = connection.execute("""SELECT sum(coalesce((usage->>'attemptedCalls')
            ::integer,0)) AS attempted, sum(coalesce((usage->>'uncertainCalls')
            ::integer,0)) AS uncertain, sum(coalesce((usage->>'totalTokenCount')
            ::integer,0)) AS synthetic_tokens FROM uony_conversation_jobs""").fetchone()
        waits = connection.execute("""SELECT extract(epoch FROM
            (first_claimed_at-created_at))*1000 AS ms FROM uony_conversation_jobs
            WHERE first_claimed_at IS NOT NULL""").fetchall()
        isolation = connection.execute("""SELECT count(DISTINCT user_id) AS owners,
            count(*) AS total FROM uony_conversation_jobs""").fetchone()
    state = {item['status']: item['n'] for item in summary}
    assert not state.get('queued') and not state.get('running')
    assert isolation['owners'] == isolation['total'] == account_count
    assert state.get('success', 0) + state.get('unknown', 0) == account_count
    assert attempts['attempted'] == account_count
    assert attempts['uncertain'] == state['unknown']
    wait_values = [float(item['ms']) for item in waits]
    def plan_nodes(node):
        return [node['Node Type'] +
                (':' + node['Index Name'] if node.get('Index Name') else '')] + [
                item for child in node.get('Plans', []) for item in plan_nodes(child)]
    return {'kind': 'synthetic_db_only', 'utc': datetime.now(timezone.utc).isoformat(),
            'registeredAccounts': account_count, 'queuedAccounts': account_count,
            'latestSchemaMigration': latest_migration,
            'concurrentWorkers': workers, 'fakeProviderDelayMs': provider_delay_ms,
            'globalActiveLimit': queue.active_limit,
            'seedSeconds': round(seed_seconds, 3),
            'admissionAndWorkerSeconds': round(execution_seconds, 3),
            'workerSeconds': round(worker_seconds, 3),
            'jobsPerSecond': round(account_count / execution_seconds, 2),
            'admission': {'waves': waves, 'capacityRefusals': refusals,
                          'attempts': len(admission_ms),
                          'medianMs': percentile(admission_ms, .5),
                          'p95Ms': percentile(admission_ms, .95),
                          'maxMs': percentile(admission_ms, 1),
                          'rejectedRequestIdsPersisted': 0},
            'claimMs': {'median': percentile(claims, .5),
                        'p95': percentile(claims, .95),
                        'max': percentile(claims, 1)},
            'queueWaitMs': {'median': percentile(wait_values, .5),
                            'p95': percentile(wait_values, .95),
                            'max': percentile(wait_values, 1)},
            'workersFinished': dict(worker_counts), 'terminalStates': state,
            'accountIsolation': 'cross-account request 404; one active job/account',
            'recovery': recovered,
            'syntheticUsage': attempts,
            'candidateQuery': {'executionMs': round(plan['Execution Time'], 2),
                               'nodes': plan_nodes(plan['Plan'])},
            'limits': ['Synthetic active limit; no HTTP/auth/frontend latency',
                       'Queue admission measured with one submitter',
                       'No real provider quotas, credits or cost',
                       'Local Docker PostgreSQL is not production capacity']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accounts', type=int, default=200)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--active-limit', type=int, default=64)
    parser.add_argument('--provider-delay-ms', type=int, default=5)
    arguments = parser.parse_args()
    if arguments.accounts < 4 or arguments.workers < 1 or arguments.workers > 32:
        parser.error('Use at least 4 accounts and 1–32 workers')
    if arguments.active_limit < 3 or arguments.active_limit >= arguments.accounts:
        parser.error('Use an active limit from 3 to accounts minus one')
    if not 0 <= arguments.provider_delay_ms <= 5000:
        parser.error('Use 0–5000 ms fake-provider delay')

    require_local_database_target(os.environ, Path('/.dockerenv').is_file())
    settings = load_settings()
    admin = Database(settings.database)
    schema = 'qa04_' + uuid4().hex
    with admin.connect() as connection:
        connection.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
    config = replace(settings, database={**settings.database,
                                        'options': '-csearch_path=' + schema})
    database = Database(config.database)
    try:
        database.migrate()
        result = measure(database, ConversationQueue(database,
                         active_limit=arguments.active_limit), arguments.accounts,
                         arguments.workers, arguments.provider_delay_ms)
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    finally:
        with admin.connect() as connection:
            connection.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))


if __name__ == '__main__':
    main()
