"""Pinned chat engines with fake providers; no Google or ADK SDK calls."""
from dataclasses import replace
from uuid import uuid4

import pytest

from app.uony_conversation_worker import ConversationWorker
from app.uony_engine import ADK, CLASSIC, EngineProviders, EngineUnavailable, supports_streaming
from app.uony_provider import UonyProvider
from app.settings import load_settings
from conftest import client_for, login
from test_google_cloud import Cloud
from test_uony import ready
from test_uony_conversation_queue import connected


class FakeEngine:
    def __init__(self, label):
        self.label = label
        self.calls = []

    def generate(self, token, project, history, status, model=None, effort=None, **kwargs):
        self.calls.append((project, model, kwargs))
        usage = {'attemptedCalls': 1, 'calls': 1}
        if kwargs.get('on_attempt'):
            kwargs['on_attempt'](1)
        if kwargs.get('on_complete'):
            kwargs['on_complete'](1, usage)
        return f'Respuesta de {self.label}', usage


def setup(client, google, database, settings):
    ready(client, google, database)
    with database.connect() as connection:
        user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                  (google.subject,)).fetchone()['id']
        connected(connection, user, google, settings)
    return user


def test_default_is_classic_and_adk_import_is_deferred(environment, monkeypatch):
    settings, _, _ = environment
    assert settings.adk_enabled is False
    monkeypatch.setenv('UONIFY_ADK_ENABLED', '1')
    assert load_settings().adk_enabled is False  # QA injection only, no deployment switch.
    def missing():
        raise ModuleNotFoundError('google.adk')
    monkeypatch.setattr('app.uony_engine._load_adk_provider', missing)
    providers = EngineProviders(settings)
    assert type(providers.get(CLASSIC)) is UonyProvider
    assert providers.selected_engine == CLASSIC
    with pytest.raises(EngineUnavailable, match='deshabilitado'):
        providers.get(ADK)
    qa_providers = EngineProviders(replace(settings, adk_enabled=True))
    with pytest.raises(EngineUnavailable, match='lock compatible'):
        qa_providers.get(ADK)
    assert supports_streaming(CLASSIC, providers.get(CLASSIC), True)
    assert not supports_streaming(ADK, providers.get(CLASSIC), True)
    assert not supports_streaming(CLASSIC, type('AdkLike', (UonyProvider,), {})(), True)


def test_adk_pilot_file_is_account_scoped_and_fails_closed(tmp_path, monkeypatch):
    import json
    pilot = str(uuid4())
    (tmp_path / 'google-oauth.json').write_text(json.dumps({'web': {}}))
    (tmp_path / 'postgres-password').write_text('test-only')
    (tmp_path / 'encryption-key').write_text('test-only')
    file = tmp_path / 'adk-pilot-users.json'
    monkeypatch.setenv('UONIFY_SECRETS_DIR', str(tmp_path))
    file.write_text(json.dumps({'userIds': [pilot]}))
    settings = load_settings()
    assert settings.adk_enabled is False
    assert settings.adk_pilot_user_ids == (pilot,)
    from app.uony_engine import selected_engine, enabled_engines
    assert selected_engine(settings, pilot) == ADK
    assert selected_engine(settings, uuid4()) == CLASSIC
    assert enabled_engines(settings, uuid4()) == (CLASSIC,)
    assert enabled_engines(settings) == (CLASSIC, ADK)
    file.write_text(json.dumps({'userIds': [pilot, pilot]}))
    with pytest.raises(RuntimeError, match='piloto adk-pilot-users.json'):
        load_settings()
    file.write_text(json.dumps({'userIds': ['not-a-uuid']}))
    with pytest.raises(RuntimeError, match='piloto adk-pilot-users.json'):
        load_settings()


def test_adk_pilot_routes_only_selected_account_and_replay_does_not_repeat(environment):
    settings, google, database = environment
    classic, adk = FakeEngine('classic'), FakeEngine('adk')
    with client_for(settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as seed:
        first_user = setup(seed, google, database, settings)
        first_subject, first_email = google.subject, google.email
        google.subject, google.email = 'google-test-two', 'two@example.test'
        second_user = setup(seed, google, database, settings)
    pilot_settings = replace(settings, adk_pilot_user_ids=(str(first_user),))
    google.subject, google.email = first_subject, first_email
    with client_for(pilot_settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as client:
        worker = client.app.state.conversation_worker
        worker.providers._providers[ADK] = adk
        login(client, google)
        first = {'requestId': str(uuid4()), 'threadId': 'pilot-first', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=first).status_code == 202
        google.subject, google.email = 'google-test-two', 'two@example.test'
        login(client, google)
        second = {'requestId': str(uuid4()), 'threadId': 'pilot-second', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=second).status_code == 202
        with database.connect() as connection:
            rows = connection.execute('SELECT user_id,engine FROM uony_conversation_jobs').fetchall()
        assert {row['user_id']: row['engine'] for row in rows} == {
            first_user: ADK, second_user: CLASSIC}
        for index in range(2):
            claimed = worker.queue.claim('pilot-worker-' + str(index))
            assert claimed is not None
            worker.run(claimed)
        assert len(adk.calls) == len(classic.calls) == 1
        assert client.post('/api/uony/messages', json=second).json()['status'] == 'success'
        google.subject, google.email = first_subject, first_email
        login(client, google)
        assert client.post('/api/uony/messages', json=first).json()['status'] == 'success'
        assert len(adk.calls) == len(classic.calls) == 1


def test_revoking_one_account_pilot_fails_its_queued_job_before_google(environment):
    settings, google, database = environment
    classic, adk = FakeEngine('classic'), FakeEngine('adk')
    with client_for(settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as seed:
        user = setup(seed, google, database, settings)
    pilot_settings = replace(settings, adk_pilot_user_ids=(str(user),))
    with client_for(pilot_settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as client:
        login(client, google)
        body = {'requestId': str(uuid4()), 'threadId': 'revoked-pilot', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        old = client.app.state.conversation_worker
        # Another pilot remains enabled, so the worker can claim this pinned
        # job while refusing the revoked account before any provider call.
        revoked = replace(settings, adk_pilot_user_ids=(str(uuid4()),))
        worker = ConversationWorker(revoked, database, old.cloud,
            EngineProviders(revoked, {ADK: adk, CLASSIC: classic}),
            old.incidents, old.requirements, old.materials)
        job = worker.queue.claim('revoked-pilot-worker')
        assert job and job['engine'] == ADK
        worker.run(job)
        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'error'
        assert result['error']['code'] == 'engine_unavailable'
        assert adk.calls == classic.calls == []
        retry = {**body, 'requestId': str(uuid4())}
        with client_for(revoked, google, cloud=Cloud(), uony=classic,
                        legacy_sync=False) as revoked_client:
            login(revoked_client, google)
            assert revoked_client.post('/api/uony/messages', json=retry).status_code == 202
            with database.connect() as connection:
                row = connection.execute('SELECT engine FROM uony_conversation_jobs '
                    'WHERE user_id=%s AND request_id=%s', (user, retry['requestId'])).fetchone()
            assert row['engine'] == CLASSIC


def test_revoked_pilot_cannot_acknowledge_uncertain_adk_retry(environment):
    settings, google, database = environment
    classic = FakeEngine('classic')
    with client_for(settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as seed:
        user = setup(seed, google, database, settings)
    pilot = replace(settings, adk_pilot_user_ids=(str(user),))
    original = {'requestId': str(uuid4()), 'threadId': 'pilot-unknown', 'text': 'Hola'}
    with client_for(pilot, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as client:
        login(client, google)
        assert client.post('/api/uony/messages', json=original).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('pilot-unknown-worker')
        assert job and job['engine'] == ADK
        worker.queue.provider_start(job)
        worker.fail(job, 'google_unavailable',
                    {'attemptedCalls': 1, 'uncertainCalls': 1}, True)
        assert client.get('/api/uony/requests/' + original['requestId']).json()['status'] == 'unknown'
    # Keep ADK available to the deployment, but remove this specific account.
    revoked = replace(settings, adk_pilot_user_ids=(str(uuid4()),))
    with client_for(revoked, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as client:
        login(client, google)
        retry = {**original, 'requestId': str(uuid4()), 'retryOf': original['requestId']}
        result = client.post('/api/uony/messages', json=retry)
        assert result.status_code == 409 and result.json()['error'] == 'engine_unavailable'
        with database.connect() as connection:
            rows = connection.execute('SELECT request_id,engine,acknowledged_at '
                'FROM uony_conversation_jobs WHERE user_id=%s', (user,)).fetchall()
        assert len(rows) == 1 and rows[0]['engine'] == ADK
        assert rows[0]['acknowledged_at'] is None
        assert classic.calls == []


def test_adk_job_keeps_engine_after_qa_restart_and_replay_is_idempotent(environment):
    settings, google, database = environment
    qa_settings = replace(settings, adk_enabled=True, streaming_enabled=True)
    adk, classic = FakeEngine('adk'), FakeEngine('classic')
    with client_for(qa_settings, google, cloud=Cloud(), uony=adk,
                    legacy_sync=False) as client:
        user = setup(client, google, database, qa_settings)
        body = {'requestId': str(uuid4()), 'threadId': 'pinned', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        with database.connect() as connection:
            row = connection.execute('SELECT engine,status FROM uony_conversation_jobs '
                'WHERE user_id=%s AND request_id=%s', (user, body['requestId'])).fetchone()
        assert row == {'engine': ADK, 'status': 'queued'}
        old = client.app.state.conversation_worker
        restarted = ConversationWorker(qa_settings,
            database, old.cloud, EngineProviders(qa_settings, {ADK: adk, CLASSIC: classic}),
            old.incidents, old.requirements, old.materials)
        job = restarted.queue.claim('restarted-qa-worker')
        assert job['engine'] == ADK
        restarted.run(job)
        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'success'
        assert result['response']['reply'] == 'Respuesta de adk'
        assert len(adk.calls) == 1 and classic.calls == []
        assert set(adk.calls[0][2]) == {'on_attempt', 'on_complete'}
        assert client.post('/api/uony/messages', json=body).json() == result
        assert len(adk.calls) == 1


def test_classic_job_keeps_engine_after_qa_flag_on(environment):
    settings, google, database = environment
    classic, adk = FakeEngine('classic'), FakeEngine('adk')
    with client_for(settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as client:
        setup(client, google, database, settings)
        body = {'requestId': str(uuid4()), 'threadId': 'classic-pinned', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        old = client.app.state.conversation_worker
        qa_settings = replace(settings, adk_enabled=True)
        restarted = ConversationWorker(qa_settings, database, old.cloud,
            EngineProviders(qa_settings, {ADK: adk, CLASSIC: classic}),
            old.incidents, old.requirements, old.materials)
        claimed = restarted.queue.claim('classic-qa-worker')
        assert claimed['engine'] == CLASSIC
        restarted.run(claimed)
        assert client.get('/api/uony/requests/' + body['requestId']).json()[
            'response']['reply'] == 'Respuesta de classic'
        assert len(classic.calls) == 1 and adk.calls == []


def test_explicit_retry_keeps_original_engine_after_flag_change(environment):
    settings, google, database = environment
    qa_settings = replace(settings, adk_enabled=True)
    adk, classic = FakeEngine('adk'), FakeEngine('classic')
    initial = {'requestId': str(uuid4()), 'threadId': 'retry-pinned', 'text': 'Hola'}
    with client_for(qa_settings, google, cloud=Cloud(), uony=adk,
                    legacy_sync=False) as client:
        user = setup(client, google, database, qa_settings)
        assert client.post('/api/uony/messages', json=initial).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('first-qa-worker')
        worker.queue.provider_start(job)
        worker.fail(job, 'google_unavailable',
                    {'attemptedCalls': 1, 'uncertainCalls': 1}, True)
        assert client.get('/api/uony/requests/' + initial['requestId']).json()['status'] == 'unknown'
    with client_for(settings, google, cloud=Cloud(), uony=classic,
                    legacy_sync=False) as client:
        login(client, google)
        retry = {**initial, 'requestId': str(uuid4()), 'retryOf': initial['requestId']}
        refused = client.post('/api/uony/messages', json=retry)
        assert refused.status_code == 409 and refused.json()['error'] == 'engine_unavailable'
        with database.connect() as connection:
            rows = connection.execute('SELECT request_id,engine,acknowledged_at FROM uony_conversation_jobs '
                'WHERE user_id=%s ORDER BY created_at', (user,)).fetchall()
        assert len(rows) == 1 and rows[0]['engine'] == ADK
        assert rows[0]['acknowledged_at'] is None
        assert str(rows[0]['request_id']) == initial['requestId']
        assert client.get('/api/uony/requests/' + initial['requestId']).json()['status'] == 'unknown'
    with client_for(qa_settings, google, cloud=Cloud(), uony=adk,
                    legacy_sync=False) as client:
        login(client, google)
        assert client.post('/api/uony/messages', json=retry).status_code == 202
        with database.connect() as connection:
            rows = connection.execute('SELECT request_id,engine,acknowledged_at FROM uony_conversation_jobs '
                'WHERE user_id=%s ORDER BY created_at', (user,)).fetchall()
        assert len(rows) == 2 and {row['engine'] for row in rows} == {ADK}
        assert rows[0]['acknowledged_at'] is not None
        worker = client.app.state.conversation_worker
        claimed = worker.queue.claim('retry-qa-worker')
        assert claimed['engine'] == ADK
        worker.run(claimed)
        assert client.get('/api/uony/requests/' + retry['requestId']).json()['status'] == 'success'
        assert client.post('/api/uony/messages', json=retry).json()['status'] == 'success'
        assert len(adk.calls) == 1
        with database.connect() as connection:
            row = connection.execute('SELECT engine,provider_started_at FROM uony_conversation_jobs '
                'WHERE user_id=%s AND request_id=%s', (user, retry['requestId'])).fetchone()
        assert row['engine'] == ADK and row['provider_started_at'] is not None
        assert classic.calls == []


def test_disabling_last_pilot_drains_queued_adk_before_google(environment):
    settings, google, database = environment
    qa_settings = replace(settings, adk_enabled=True)
    fake = FakeEngine('adk')
    with client_for(qa_settings, google, cloud=Cloud(), uony=fake,
                    legacy_sync=False) as client:
        user = setup(client, google, database, qa_settings)
        body = {'requestId': str(uuid4()), 'threadId': 'missing-adk', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        old = client.app.state.conversation_worker
        disabled = ConversationWorker(settings, database, old.cloud,
            EngineProviders(settings), old.incidents, old.requirements, old.materials)
        claimed = disabled.queue.claim('disabled-worker')
        assert claimed and claimed['engine'] == ADK
        disabled.run(claimed)
        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'error'
        assert result['error']['code'] == 'engine_unavailable'
        with database.connect() as connection:
            after = connection.execute('SELECT engine,status,claim_count,provider_started_at '
                'FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user, body['requestId'])).fetchone()
        assert after == {'engine': ADK, 'status': 'error',
                         'claim_count': 1, 'provider_started_at': None}
        assert fake.calls == []
        assert disabled.queue.claim('disabled-worker') is None
    with client_for(settings, google, cloud=Cloud(), uony=FakeEngine('classic'),
                    legacy_sync=False) as rolled_back:
        login(rolled_back, google)
        next_body = {**body, 'requestId': str(uuid4())}
        assert rolled_back.post('/api/uony/messages', json=next_body).status_code == 202


def test_stale_disabled_worker_skips_adk_job_admitted_after_its_start(environment):
    settings, google, database = environment
    qa_settings = replace(settings, adk_enabled=True)
    fake = FakeEngine('adk')
    with client_for(qa_settings, google, cloud=Cloud(), uony=fake,
                    legacy_sync=False) as client:
        user = setup(client, google, database, qa_settings)
        old = client.app.state.conversation_worker
        disabled = ConversationWorker(settings, database, old.cloud,
            EngineProviders(settings), old.incidents, old.requirements, old.materials)
        body = {'requestId': str(uuid4()), 'threadId': 'new-pilot', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        assert disabled.queue.claim('stale-worker') is None
        enabled = ConversationWorker(qa_settings, database, old.cloud,
            EngineProviders(qa_settings, {ADK: fake}),
            old.incidents, old.requirements, old.materials)
        claimed = enabled.queue.claim('enabled-worker')
        assert claimed and claimed['engine'] == ADK
        enabled.run(claimed)
        assert client.get('/api/uony/requests/' + body['requestId']).json()['status'] == 'success'
        assert len(fake.calls) == 1


def test_disabled_run_defense_rejects_foreign_adk_claim_before_google(environment):
    settings, google, database = environment
    qa_settings = replace(settings, adk_enabled=True)
    fake = FakeEngine('adk')
    with client_for(qa_settings, google, cloud=Cloud(), uony=fake,
                    legacy_sync=False) as client:
        user = setup(client, google, database, qa_settings)
        body = {'requestId': str(uuid4()), 'threadId': 'foreign-adk', 'text': 'Hola'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        old = client.app.state.conversation_worker
        claimed = old.queue.claim('enabled-qa-worker')
        disabled = ConversationWorker(settings, database, old.cloud,
            EngineProviders(settings, {ADK: fake}),
            old.incidents, old.requirements, old.materials)
        disabled.run(claimed)
        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'error'
        assert result['error']['code'] == 'engine_unavailable'
        assert 'no se ha llamado a Google' in result['error']['message']
        with database.connect() as connection:
            row = connection.execute('SELECT engine,provider_started_at,usage FROM '
                'uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                (user, body['requestId'])).fetchone()
        assert row['engine'] == ADK and row['provider_started_at'] is None
        assert not row['usage'].get('attemptedCalls') and fake.calls == []
