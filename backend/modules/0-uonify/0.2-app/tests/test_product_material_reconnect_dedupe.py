"""A lost response must not create a second paid analysis after reconnecting."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from material_start_copy import start_kwargs
from conftest import client_for, login
from test_uony import ready
from test_google_cloud import Cloud
from test_product_materials import FolderDrive
from test_product_materials_durable import fragment, prepare


def test_lost_response_after_ready_reuses_analysis_even_with_new_request_id(environment):
    config, google, database = environment
    drive = FolderDrive()
    with client_for(config, google, cloud=Cloud(), drive=drive) as client:
        service, user, first, body = prepare(client, google, database, config)
        claimed = service.queue.claim('deterministic-fake-worker')
        assert str(claimed['id']) == first['id']
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'],
                                 {'stage': 'ready', 'discoveryComplete': True}, 'ready')

    # The browser has lost both the HTTP response and its in-memory requestId.
    with client_for(config, google, cloud=Cloud(), drive=drive) as reconnected:
        assert login(reconnected, google).status_code in (302, 303)
        new_uuid = {**body, 'requestId': str(uuid4())}
        replay = reconnected.post('/api/products/DURABLE/materials/jobs', json=new_uuid)
        assert replay.status_code == 200, replay.text
        assert replay.json()['job']['id'] == first['id']
        assert replay.json()['job']['status'] == 'ready'
        assert reconnected.post('/api/products/DURABLE/materials/jobs', json=body).json()['job']['id'] == first['id']
        with database.connect() as connection:
            count = connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                       (user['id'],)).fetchone()['n']
        assert count == 1
        assert drive.reads == []


def test_reconnecting_to_older_folder_reuses_its_job_after_another_folder_finished(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        service, user, first, body = prepare(client, google, database, config)
        claimed = service.queue.claim('first-folder-worker')
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        second_request = {**body, 'requestId': str(uuid4()), 'folderId': 'nested'}
        second_response = client.post('/api/products/DURABLE/materials/jobs', json=second_request)
        assert second_response.status_code == 200, second_response.text
        second = second_response.json()['job']
        assert second['id'] != first['id']
        claimed = service.queue.claim('second-folder-worker')
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')

    # A lost response may be retried with a fresh UUID after B became the latest job.
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as reconnected:
        assert login(reconnected, google).status_code in (302, 303)
        endpoint = '/api/products/DURABLE/materials/jobs'
        older = reconnected.post(endpoint, json={**body, 'requestId': str(uuid4())})
        assert older.status_code == 200, older.text
        assert older.json()['job']['id'] == first['id']
        newer = reconnected.post(endpoint, json={**second_request, 'requestId': str(uuid4())})
        assert newer.status_code == 200, newer.text
        assert newer.json()['job']['id'] == second['id']
        with database.connect() as connection:
            count = connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                       (user['id'],)).fetchone()['n']
        assert count == 2
        def retry(folder):
            with database.connect() as connection:
                return service.start(connection, user, 'DURABLE', 1, folder, uuid4(),
                                     **start_kwargs())['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(retry, ['folder', 'nested'])) == [first['id'], second['id']]
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                      (user['id'],)).fetchone()['n'] == 2


def test_uncertain_call_in_older_job_blocks_new_folder_without_blocking_replay(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        service, user, first, body = prepare(client, google, database, config)
        claimed = service.queue.claim('first-worker')
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        endpoint = '/api/products/DURABLE/materials/jobs'
        second = client.post(endpoint, json={**body, 'requestId': str(uuid4()), 'folderId': 'nested'})
        assert second.status_code == 200, second.text
        claimed = service.queue.claim('second-worker')
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        # Simulate a late unsettled provider call on A after B became the latest job.
        with database.connect() as connection:
            connection.execute('''INSERT INTO product_material_calls
                (id,job_id,lease_token,fragment_ids,state,reserved_tokens)
                VALUES(%s,%s,%s,%s,'unknown',0)''',
                (uuid4(), first['id'], uuid4(), Jsonb([])))
        replay = client.post(endpoint, json={**body, 'requestId': str(uuid4())})
        assert replay.status_code == 200 and replay.json()['job']['id'] == first['id']
        fresh = client.post(endpoint, json={**body, 'requestId': str(uuid4()), 'folderId': 'third'})
        assert fresh.status_code == 409 and fresh.json()['error'] == 'materials_consumption_unknown'
        with database.connect() as connection:
            count = connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                       (user['id'],)).fetchone()['n']
        assert count == 2


def test_intentional_same_folder_reanalysis_is_explicit_and_replay_safe(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        service, user, first, body = prepare(client, google, database, config)
        claimed = service.queue.claim('fake-worker')
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        request = {**body, 'requestId': str(uuid4()), 'reanalysisOf': first['id']}
        second = client.post('/api/products/DURABLE/materials/jobs', json=request)
        assert second.status_code == 200, second.text
        second_id = second.json()['job']['id']
        assert second_id != first['id']
        assert client.post('/api/products/DURABLE/materials/jobs', json=request).json()['job']['id'] == second_id
        assert client.post('/api/products/DURABLE/materials/jobs', json={**request, 'reanalysisOf': str(uuid4())}).status_code == 409
        claimed = service.queue.claim('fake-worker-again')
        assert str(claimed['id']) == second_id
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        stale_intent = client.post('/api/products/DURABLE/materials/jobs', json={**request, 'requestId': str(uuid4())})
        assert stale_intent.status_code == 409
        third = client.post('/api/products/DURABLE/materials/jobs', json={**request, 'requestId': str(uuid4()), 'reanalysisOf': second_id})
        assert third.status_code == 200 and third.json()['job']['id'] not in (first['id'], second_id)
        assert client.post('/api/products/DURABLE/materials/jobs', json={**body, 'requestId': str(uuid4())}).json()['job']['id'] == third.json()['job']['id']


def test_concurrent_new_request_ids_reuse_one_persisted_analysis(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        service, user, first, _ = prepare(client, google, database, config)
        def start_again(_):
            with database.connect() as connection:
                return service.start(connection, user, 'DURABLE', 1, 'folder', uuid4(),
                                     **start_kwargs())['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(start_again, range(2)))
        assert ids == [first['id'], first['id']]
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                      (user['id'],)).fetchone()['n'] == 1


def test_concurrent_explicit_reanalysis_from_one_prior_job_creates_at_most_one(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        service, user, first, _ = prepare(client, google, database, config)
        claimed = service.queue.claim('fake-worker')
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        def start_again(_):
            try:
                with database.connect() as connection:
                    return service.start(connection, user, 'DURABLE', 1, 'folder', uuid4(), first['id'],
                                         **start_kwargs())['id']
            except HTTPException as error:
                return error.detail['error']
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(start_again, range(2)))
        assert len([result for result in outcomes if result != 'materials_conflict']) == 1
        assert outcomes.count('materials_conflict') == 1
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                      (user['id'],)).fetchone()['n'] == 2


def test_new_analysis_cannot_bypass_unacknowledged_provider_consumption(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        service, user, first, body = prepare(client, google, database, config)
        claimed = service.queue.claim('worker-with-unknown-call')
        args = fragment(service.queue, claimed, user)
        service.queue.reserve_call(*args, ['one'], estimated_input_tokens=500)
        service.queue.checkpoint(claimed['id'], user['id'], claimed['lease_token'], {'stage': 'ready'}, 'ready')
        request = {**body, 'requestId': str(uuid4()), 'reanalysisOf': first['id']}
        denied = client.post('/api/products/DURABLE/materials/jobs', json=request)
        assert denied.status_code == 409 and denied.json()['error'] == 'materials_consumption_unknown'
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s',
                                      (user['id'],)).fetchone()['n'] == 1


def test_same_product_name_in_another_account_never_reuses_job(environment):
    config, google, database = environment
    with client_for(config, google, cloud=Cloud(), drive=FolderDrive()) as client:
        _, owner, first, body = prepare(client, google, database, config)
        google.subject, google.email = 'google-test-two', 'two@example.test'
        ready(client, google, database)
        encrypted = Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode()
        with database.connect() as connection:
            other = connection.execute('SELECT id FROM users WHERE google_subject=%s', (google.subject,)).fetchone()['id']
            connection.execute('''INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check)
                VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)''',
                (other, google.subject, google.email, encrypted, Jsonb({'ready': True})))
            connection.execute('''INSERT INTO google_drive_connections(user_id,google_subject,email,refresh_encrypted,scope)
                VALUES(%s,%s,%s,%s,'drive.readonly')''', (other, google.subject, google.email, encrypted))
        assert client.post('/api/products', json={'sku': 'DURABLE', 'name': 'Otro producto'}).status_code == 200
        response = client.post('/api/products/DURABLE/materials/jobs', json={**body, 'requestId': str(uuid4())})
        assert response.status_code == 200, response.text
        assert response.json()['job']['id'] != first['id']
        assert client.get('/api/products/DURABLE/materials/jobs/' + first['id']).status_code == 404
        with database.connect() as connection:
            rows = connection.execute('SELECT user_id FROM product_material_jobs ORDER BY created_at').fetchall()
        assert {row['user_id'] for row in rows} == {owner['id'], other}
