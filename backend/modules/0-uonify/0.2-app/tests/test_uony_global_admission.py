"""Global conversation admission: isolated accounts, one durable slot, no provider."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from dataclasses import replace
from threading import Barrier
from time import monotonic
from uuid import uuid4

from conftest import Provider, client_for
from test_google_cloud import Cloud
from test_uony import Agent, ready
from test_uony_conversation_queue import connected


@contextmanager
def active_clients(config, db, count):
    with ExitStack() as stack:
        clients = []
        for index in range(count):
            google = Provider()
            google.subject = f'capacity-google-{index}'
            google.email = f'capacity-{index}@example.test'
            agent = Agent()
            client = stack.enter_context(client_for(config, google, cloud=Cloud(),
                                                    uony=agent, legacy_sync=False))
            ready(client, google, db)
            with db.connect() as connection:
                user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                          (google.subject,)).fetchone()['id']
                connected(connection, user, google, config)
            clients.append((client, google, agent))
        yield clients


def test_global_admission_is_atomic_and_replay_survives_saturation(environment):
    base, first_google, db = environment
    config = replace(base, conversation_active_limit=1)
    second_google = Provider()
    second_google.subject = 'google-test-two'
    second_google.email = 'two@example.test'
    first_agent, second_agent = Agent(), Agent()

    with client_for(config, first_google, cloud=Cloud(), uony=first_agent,
                    legacy_sync=False) as first, client_for(
                    config, second_google, cloud=Cloud(), uony=second_agent,
                    legacy_sync=False) as second:
        for client, google in ((first, first_google), (second, second_google)):
            ready(client, google, db)
            with db.connect() as connection:
                user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                          (google.subject,)).fetchone()['id']
                connected(connection, user, google, config)

        bodies = [
            {'requestId': str(uuid4()), 'threadId': 'first-admission', 'text': 'Hola'},
            {'requestId': str(uuid4()), 'threadId': 'second-admission', 'text': 'Hola'},
        ]
        clients = [first, second]
        barrier = Barrier(3)

        def send(index):
            barrier.wait(timeout=5)
            return clients[index].post('/api/uony/messages', json=bodies[index])

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(send, index) for index in range(2)]
            barrier.wait(timeout=5)
            responses = [future.result(timeout=10) for future in futures]

        assert sorted(response.status_code for response in responses) == [202, 429]
        accepted = next(i for i, response in enumerate(responses) if response.status_code == 202)
        rejected = 1 - accepted
        assert responses[rejected].json()['error'] == 'capacity_busy'
        assert responses[rejected].json()['message'].startswith('Uony está atendiendo')
        assert first_agent.calls == second_agent.calls == 0
        with db.connect() as connection:
            assert connection.execute("""SELECT count(*) AS n FROM uony_conversation_jobs
                WHERE status IN ('queued','running')""").fetchone()['n'] == 1
            assert connection.execute('SELECT 1 FROM uony_requests WHERE request_id=%s',
                                      (bodies[rejected]['requestId'],)).fetchone() is None
            assert connection.execute('SELECT 1 FROM uony_threads WHERE id=%s',
                                      (bodies[rejected]['threadId'],)).fetchone() is None

        # A replay of the admitted UUID resolves before checking capacity.
        replay = clients[accepted].post('/api/uony/messages', json=bodies[accepted])
        assert replay.status_code == 202
        assert replay.json()['requestId'] == bodies[accepted]['requestId']
        assert clients[rejected].get('/api/uony/requests/' +
                                     bodies[accepted]['requestId']).status_code == 404

        job = clients[accepted].app.state.conversation_worker.queue.claim('admission-test')
        assert job and str(job['request_id']) == bodies[accepted]['requestId']
        assert clients[rejected].post('/api/uony/messages',
                                       json=bodies[rejected]).status_code == 429
        cancelled = clients[accepted].post('/api/uony/requests/' +
                                            bodies[accepted]['requestId'] + '/cancel')
        assert cancelled.status_code == 200 and cancelled.json()['status'] == 'cancelled'

        # Reuse the rejected UUID: no request or job was created by the 429.
        admitted = clients[rejected].post('/api/uony/messages', json=bodies[rejected])
        assert admitted.status_code == 202
        assert admitted.json()['requestId'] == bodies[rejected]['requestId']
        with db.connect() as connection:
            assert connection.execute("""SELECT count(*) AS n FROM uony_conversation_jobs
                WHERE status IN ('queued','running')""").fetchone()['n'] == 1
        assert first_agent.calls == second_agent.calls == 0


def test_uncertain_retry_acknowledgement_rolls_back_when_capacity_is_full(environment):
    base, _, db = environment
    config = replace(base, conversation_active_limit=1)
    with active_clients(config, db, 2) as pairs:
        first, first_google, first_agent = pairs[0]
        second, _, second_agent = pairs[1]
        original = {'requestId': str(uuid4()), 'threadId': 'uncertain-capacity',
                    'text': 'Ayúdame con mi producto'}
        assert first.post('/api/uony/messages', json=original).status_code == 202
        queue = first.app.state.conversation_worker.queue
        job = queue.claim('uncertain-capacity-test')
        queue.provider_start(job)
        first.app.state.conversation_worker.fail(job, 'google_unavailable',
                                                  {'attemptedCalls': 1, 'uncertainCalls': 1}, True)
        assert first.get('/api/uony/requests/' + original['requestId']).json()['status'] == 'unknown'

        occupied = {'requestId': str(uuid4()), 'threadId': 'occupying-capacity', 'text': 'Hola'}
        assert second.post('/api/uony/messages', json=occupied).status_code == 202
        retry = {**original, 'requestId': str(uuid4()), 'retryOf': original['requestId']}
        blocked = first.post('/api/uony/messages', json=retry)
        assert blocked.status_code == 429 and blocked.json()['error'] == 'capacity_busy'
        with db.connect() as connection:
            assert connection.execute("""SELECT acknowledged_at FROM uony_conversation_jobs
                WHERE request_id=%s""", (original['requestId'],)).fetchone()['acknowledged_at'] is None
            assert connection.execute('SELECT 1 FROM uony_requests WHERE request_id=%s',
                                      (retry['requestId'],)).fetchone() is None
        assert first_agent.calls == second_agent.calls == 0

        assert second.post('/api/uony/requests/' + occupied['requestId'] +
                           '/cancel').json()['status'] == 'cancelled'
        assert first.post('/api/uony/messages', json=retry).status_code == 202
        with db.connect() as connection:
            saved = connection.execute("""SELECT acknowledged_at FROM uony_conversation_jobs
                WHERE request_id=%s AND google_subject=%s""",
                (original['requestId'], first_google.subject)).fetchone()
            assert saved['acknowledged_at'] is not None
        assert first_agent.calls == second_agent.calls == 0


def test_twenty_accounts_cannot_overfill_two_global_slots(environment):
    base, _, db = environment
    config = replace(base, conversation_active_limit=2)
    with active_clients(config, db, 20) as pairs:
        bodies = [{'requestId': str(uuid4()), 'threadId': f'burst-{index}',
                   'text': 'Hola'} for index in range(len(pairs))]
        barrier = Barrier(len(pairs) + 1)

        def send(index):
            barrier.wait(timeout=15)
            return pairs[index][0].post('/api/uony/messages', json=bodies[index])

        with ThreadPoolExecutor(max_workers=len(pairs)) as pool:
            futures = [pool.submit(send, index) for index in range(len(pairs))]
            barrier.wait(timeout=15)
            responses = [future.result(timeout=30) for future in futures]
        assert [response.status_code for response in responses].count(202) == 2
        assert [response.status_code for response in responses].count(429) == 18
        assert all(response.json()['error'] == 'capacity_busy' for response in responses
                   if response.status_code == 429)
        with db.connect() as connection:
            assert connection.execute("""SELECT count(*) AS n FROM uony_conversation_jobs
                WHERE status IN ('queued','running')""").fetchone()['n'] == 2
            assert connection.execute('SELECT count(*) AS n FROM uony_requests').fetchone()['n'] == 2
        assert all(agent.calls == 0 for _, _, agent in pairs)


def test_global_lock_wait_is_bounded_without_reserving_a_request(environment):
    base, _, db = environment
    config = replace(base, conversation_active_limit=1)
    with active_clients(config, db, 1) as pairs:
        client, _, agent = pairs[0]
        body = {'requestId': str(uuid4()), 'threadId': 'blocked-lock', 'text': 'Hola'}
        with db.connect() as holder:
            holder.execute('SELECT pg_advisory_xact_lock(71072027)')
            started = monotonic()
            refused = client.post('/api/uony/messages', json=body)
            elapsed = monotonic() - started
            assert refused.status_code == 429
            assert refused.json()['error'] == 'capacity_busy'
            assert .35 <= elapsed < 2
            with db.connect() as connection:
                assert connection.execute('SELECT 1 FROM uony_requests WHERE request_id=%s',
                                          (body['requestId'],)).fetchone() is None
                assert connection.execute('SELECT 1 FROM uony_threads WHERE id=%s',
                                          (body['threadId'],)).fetchone() is None
        assert client.post('/api/uony/messages', json=body).status_code == 202
        assert agent.calls == 0


def test_local_admission_limit_must_be_positive(environment):
    base, _, db = environment
    from app.uony_conversation_queue import ConversationQueue
    import pytest

    for limit in (0, -1):
        with pytest.raises(ValueError, match='positive'):
            ConversationQueue(db, active_limit=limit)
    assert base.conversation_active_limit == 256
