"""QA-04 guard and accepted-request replay in disposable PostgreSQL schemas."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.uony_conversation_queue import ConversationQueue
from app.uony_engine import CLASSIC
from app.uony_routes import Message
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import Agent, ready
from test_uony_conversation_queue import connected
from tools.qa04_conversation_load import require_local_database_target, seed


@pytest.mark.parametrize('overrides,in_container', [
    ({'PGHOST': 'prod.example'}, True),
    ({'PGHOSTADDR': '203.0.113.10'}, True),
    ({'PGSERVICE': 'remote'}, True),
    ({'PGOPTIONS': '-c search_path=public'}, True),
    ({'PGDATABASE': 'another'}, True),
    ({}, False),
])
def test_qa04_rejects_nonlocal_database_before_connecting(overrides, in_container):
    with pytest.raises(RuntimeError, match='destino rechazado'):
        require_local_database_target(overrides, in_container)
    require_local_database_target({}, True)


def test_concurrent_accounts_never_exceed_global_admission_limit(environment):
    _, _, db = environment
    db.migrate()
    rows = seed(db, 8)
    queue = ConversationQueue(db, active_limit=3)
    release = Barrier(len(rows))

    def enqueue(row):
        user_id, request_id, index = row
        body = Message(requestId=request_id, threadId=f'qa04-thread-{index}',
                       text='Petición sintética concurrente')
        try:
            with db.connect() as connection:
                queue.enqueue(connection,
                              {'id': user_id, 'google_subject': f'qa04-subject-{index}'},
                              body, {'project_id': 'project-fixture'},
                              'gemini-fixture', 'synthetic_load', {}, CLASSIC)
        except HTTPException as exc:
            assert exc.status_code == 429 and exc.detail['error'] == 'capacity_busy'
            return 'refused'
        return 'accepted'

    def submit(row):
        release.wait(timeout=30)
        return enqueue(row)

    with ThreadPoolExecutor(max_workers=len(rows)) as pool:
        outcomes = list(pool.map(submit, rows))
    accepted = outcomes.count('accepted')
    assert 1 <= accepted <= 3
    assert outcomes.count('refused') == len(rows) - accepted
    with db.connect() as connection:
        assert connection.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == accepted
        assert connection.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == accepted

    # A busy lock may reject an otherwise available slot after 500 ms. Once
    # contention ends, the same rejected requests must fill the remaining
    # slots; every later request must still be refused at the global limit.
    for row, outcome in zip(rows, outcomes):
        if outcome == 'refused':
            result = enqueue(row)
            assert result == ('accepted' if accepted < 3 else 'refused')
            if result == 'accepted':
                accepted += 1
    assert accepted == 3
    with db.connect() as connection:
        assert connection.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 3
        assert connection.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 3


def test_accepted_request_replay_and_payload_conflict_execute_once(environment):
    config, google, db = environment
    fake_agent = Agent()
    with client_for(config, google, cloud=Cloud(), uony=fake_agent,
                    legacy_sync=False) as client:
        ready(client, google, db)
        with db.connect() as connection:
            user_id = connection.execute(
                'SELECT id FROM users WHERE google_subject=%s',
                (google.subject,)).fetchone()['id']
            connected(connection, user_id, google, config)

        body = {'requestId': str(uuid4()), 'threadId': 'qa04-replay',
                'text': 'Petición sintética'}
        first = client.post('/api/uony/messages', json=body)
        same = client.post('/api/uony/messages', json=body)
        conflict = client.post('/api/uony/messages',
                               json={**body, 'text': 'Otro mensaje'})
        assert first.status_code == same.status_code == 202
        assert first.json()['requestId'] == same.json()['requestId'] == body['requestId']
        assert conflict.status_code == 409
        assert conflict.json()['error'] == 'request_conflict'
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 1
            assert connection.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 1

        worker = client.app.state.conversation_worker
        job = worker.queue.claim('qa04-replay-fixture')
        assert job and str(job['request_id']) == body['requestId']
        worker.run(job)  # Agent is a fake: no Google or Amazon connection.
        assert fake_agent.calls == 1
        completed = client.post('/api/uony/messages', json=body)
        assert completed.status_code == 200
        assert completed.json()['status'] == 'success'
        assert client.post('/api/uony/messages',
                           json={**body, 'text': 'Otro mensaje'}).status_code == 409
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 1
            assert connection.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 1
        assert fake_agent.calls == 1
