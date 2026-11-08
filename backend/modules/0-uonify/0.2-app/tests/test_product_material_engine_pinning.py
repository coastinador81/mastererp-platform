"""Document-pilot admission and billing guards with PostgreSQL and fake analyzers."""
from dataclasses import replace
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.google_cloud_provider import CloudError
from app.product_materials import ProductMaterials
from app.product_materials_control_consent import advertised_control_consent
from app.product_materials_queue import MaterialsQueue
from app.product_materials_worker import identity, process_fragment
from material_start_copy import start_kwargs
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials import Analyzer, FolderDrive
from test_product_materials_durable import fragment
from test_uony import ready


def connect_account(db, config, user):
    secret = Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode()
    with db.connect() as c:
        c.execute("""INSERT INTO google_cloud_connections
            (user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check)
            VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)""",
            (user['id'], user['google_subject'], user['email'], secret, Jsonb({'ready': True})))
        c.execute("""INSERT INTO google_drive_connections
            (user_id,google_subject,email,refresh_encrypted,scope)
            VALUES(%s,%s,%s,%s,'drive.readonly')""",
            (user['id'], user['google_subject'], user['email'], secret))


def current_user(db, subject):
    with db.connect() as c:
        return c.execute('SELECT * FROM users WHERE google_subject=%s', (subject,)).fetchone()


def start(service, db, user, request_id=None):
    with db.connect() as c:
        return service.start(c, user, 'PILOT', 1, 'folder', request_id or uuid4(),
                             **start_kwargs())


def test_engine_and_project_are_pinned_at_admission_and_duplicate_is_one_job(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        selected = replace(config, material_adk_pilot_user_ids=(str(user['id']),))
        classic, adk = Analyzer(), Analyzer()
        service = ProductMaterials(selected, db, drive, cloud, classic, adk_analyzer=adk)
        request_id = uuid4()
        first = start(service, db, user, request_id)
        assert start(service, db, user, request_id)['id'] == first['id']
        restarted_without_adapter = ProductMaterials(config, db, drive, cloud, Analyzer())
        assert start(restarted_without_adapter, db, user, request_id)['id'] == first['id']
        with db.connect() as c:
            row = c.execute('SELECT engine,project_id FROM product_material_jobs WHERE id=%s',
                            (first['id'],)).fetchone()
            count = c.execute('SELECT count(*) n FROM product_material_jobs WHERE user_id=%s',
                              (user['id'],)).fetchone()['n']
        assert row == {'engine': 'adk', 'project_id': 'project-fixture'}
        assert count == 1 and classic.calls == adk.calls == 0
        assert MaterialsQueue(db).claim('classic-only', first['id']) is None
        claimed = service.queue.claim('pilot-only', first['id'])
        assert str(claimed['id']) == first['id'] and claimed['engine'] == 'adk'


def test_gate_is_per_account_and_requires_an_injected_adapter(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        first_user = current_user(db, google.subject)
        connect_account(db, config, first_user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Primero'})
        google.subject, google.email = 'pilot-second', 'second@example.test'
        ready(client, google, db)
        second_user = current_user(db, google.subject)
        connect_account(db, config, second_user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Segundo'})
        selected = replace(config, material_adk_pilot_user_ids=(str(first_user['id']),))
        service = ProductMaterials(selected, db, drive, cloud, Analyzer(), adk_analyzer=Analyzer())
        one = start(service, db, first_user)
        two = start(service, db, second_user, uuid4())
        with db.connect() as c:
            rows = c.execute('SELECT user_id,engine,project_id FROM product_material_jobs ORDER BY created_at').fetchall()
        assert {str(row['user_id']): row['engine'] for row in rows} == {
            str(first_user['id']): 'adk', str(second_user['id']): 'classic'}
        assert {row['project_id'] for row in rows} == {'project-fixture'}
        assert one['id'] != two['id']
        # An allowlisted account remains Classic while no adapter is installed.
        without_adapter = ProductMaterials(selected, db, drive, cloud, Analyzer())
        assert without_adapter.available_engines == ('classic',)


def test_project_change_stops_before_provider_call_and_cannot_resume(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        service = ProductMaterials(config, db, drive, cloud, analyzer)
        job = start(service, db, user)
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET project_id='other-project' WHERE user_id=%s",
                      (user['id'],))
        service.run(job['id'], user['id'])
        with db.connect() as c:
            saved = c.execute('SELECT status,result,project_id FROM product_material_jobs WHERE id=%s',
                              (job['id'],)).fetchone()
            calls = c.execute('SELECT count(*) n FROM product_material_calls WHERE job_id=%s',
                              (job['id'],)).fetchone()['n']
        assert saved['project_id'] == 'project-fixture'
        assert saved['status'] == 'error' and saved['result']['error']['code'] == 'google_changed'
        assert analyzer.calls == calls == 0 and drive.reads == []
        with db.connect() as c:
            assert service.get(c, user, 'PILOT', job['id'])['job']['canResume'] is False
        response = client.post(f"/api/products/PILOT/materials/jobs/{job['id']}/resume",
                               json={'requestId': str(uuid4()), 'revision': 1})
        assert response.status_code == 409 and response.json()['error'] == 'materials_project_changed'


def test_project_change_during_discovery_is_a_terminal_error_not_a_source_retry(environment):
    config, google, db = environment

    class ChangeProjectAfterListing(FolderDrive):
        def files(self, token, parent, page, search):
            listing = super().files(token, parent, page, search)
            if parent == 'nested' and page == 'page2':
                with db.connect() as c:
                    c.execute("UPDATE google_cloud_connections SET project_id='other-project'")
            return listing

    drive, cloud, analyzer = ChangeProjectAfterListing(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        service = ProductMaterials(config, db, drive, cloud, analyzer)
        job = start(service, db, user)
        service.run(job['id'], user['id'])
        with db.connect() as c:
            saved = c.execute('SELECT status,result FROM product_material_jobs WHERE id=%s',
                              (job['id'],)).fetchone()
            calls = c.execute('SELECT count(*) n FROM product_material_calls WHERE job_id=%s',
                              (job['id'],)).fetchone()['n']
        assert saved['status'] == 'error' and saved['result']['error']['code'] == 'google_changed'
        assert calls == analyzer.calls == 0


def test_project_change_between_fragments_blocks_second_post(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()

    class ChangeProjectAfterFirst(Analyzer):
        def analyze(self, token, project, product, sources):
            result = super().analyze(token, project, product, sources)
            if self.calls == 1:
                with db.connect() as c:
                    c.execute("UPDATE google_cloud_connections SET project_id='other-project'")
            return result

    analyzer = ChangeProjectAfterFirst()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        service = ProductMaterials(config, db, drive, cloud, analyzer)
        job = start(service, db, user)
        row = service.queue.claim('two-fragments', job['id'])
        fragment(service.queue, row, user, 'one')
        fragment(service.queue, row, user, 'two')
        parts = service.queue.fragments(row['id'], user['id'])
        credentials = lambda: identity(service, user['id'], row['google_subject'], row['project_id'])[1]
        for part in parts[:1]:
            process_fragment(service, row, user['id'], {'name': 'Torre'}, part,
                             credentials, lambda: None, lambda: None)
        with pytest.raises(CloudError) as stopped:
            process_fragment(service, row, user['id'], {'name': 'Torre'}, parts[1],
                             credentials, lambda: None, lambda: None)
        with db.connect() as c:
            calls = c.execute('SELECT count(*) n FROM product_material_calls WHERE job_id=%s',
                              (row['id'],)).fetchone()['n']
        assert stopped.value.code == 'google_changed'
        assert analyzer.calls == calls == 1


def test_project_change_after_reservation_releases_it_before_provider_post(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        service = ProductMaterials(config, db, drive, cloud, analyzer)
        job = start(service, db, user)
        row = service.queue.claim('reservation-race', job['id'])
        fragment(service.queue, row, user, 'one')
        part = service.queue.fragments(row['id'], user['id'])[0]
        original_reserve = service.queue.reserve_call

        def reserve_then_change_project(*args, **kwargs):
            call_id = original_reserve(*args, **kwargs)
            with db.connect() as c:
                c.execute("UPDATE google_cloud_connections SET project_id='other-project' WHERE user_id=%s",
                          (user['id'],))
            return call_id

        service.queue.reserve_call = reserve_then_change_project
        credentials = lambda: identity(service, user['id'], row['google_subject'], row['project_id'])[1]
        with pytest.raises(CloudError) as stopped:
            process_fragment(service, row, user['id'], {'name': 'Torre'}, part,
                             credentials, lambda: None, lambda: None)
        with db.connect() as c:
            calls = c.execute('SELECT count(*) n FROM product_material_calls WHERE job_id=%s',
                              (row['id'],)).fetchone()['n']
            state = c.execute('SELECT state FROM product_material_fragments WHERE id=%s',
                              (part['id'],)).fetchone()['state']
        assert stopped.value.code == 'google_changed'
        assert calls == analyzer.calls == 0 and state == 'pending'


def test_disabled_worker_never_falls_back_to_classic(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        selected = replace(config, material_adk_pilot_user_ids=(str(user['id']),))
        pilot = ProductMaterials(selected, db, drive, cloud, Analyzer(), adk_analyzer=Analyzer())
        job = start(pilot, db, user)
        claimed = pilot.queue.claim('pilot-owner', job['id'])
        classic = Analyzer()
        disabled = ProductMaterials(config, db, drive, cloud, classic)
        disabled.run(job['id'], user['id'], claimed['lease_token'])
        with db.connect() as c:
            saved = c.execute('SELECT status,result,engine FROM product_material_jobs WHERE id=%s',
                              (job['id'],)).fetchone()
            calls = c.execute('SELECT count(*) n FROM product_material_calls WHERE job_id=%s',
                              (job['id'],)).fetchone()['n']
        assert saved['engine'] == 'adk' and saved['status'] == 'paused'
        assert saved['result']['pauseReason'] == 'engine_unavailable'
        assert classic.calls == calls == 0 and drive.reads == []
        with db.connect() as c:
            assert disabled.get(c, user, 'PILOT', job['id'])['job']['canResume'] is False


def test_removing_account_gate_stops_existing_adk_job_with_adapter_present(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        selected = replace(config, material_adk_pilot_user_ids=(str(user['id']),))
        pilot = ProductMaterials(selected, db, drive, cloud, Analyzer(), adk_analyzer=Analyzer())
        job = start(pilot, db, user)
        claimed = pilot.queue.claim('pilot-owner', job['id'])
        classic, adk = Analyzer(), Analyzer()
        disabled = ProductMaterials(config, db, drive, cloud, classic, adk_analyzer=adk)
        disabled.run(job['id'], user['id'], claimed['lease_token'])
        with db.connect() as c:
            saved = c.execute('SELECT status,result,engine FROM product_material_jobs WHERE id=%s',
                              (job['id'],)).fetchone()
        assert saved['engine'] == 'adk' and saved['status'] == 'paused'
        assert saved['result']['pauseReason'] == 'engine_unavailable'
        assert classic.calls == adk.calls == 0 and drive.reads == []


def test_legacy_job_without_original_project_never_calls_a_provider(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        service = ProductMaterials(config, db, drive, cloud, analyzer)
        job = start(service, db, user)
        with db.connect() as c:
            c.execute('UPDATE product_material_jobs SET project_id=NULL WHERE id=%s', (job['id'],))
        service.run(job['id'], user['id'])
        with db.connect() as c:
            saved = c.execute('SELECT status,result FROM product_material_jobs WHERE id=%s',
                              (job['id'],)).fetchone()
        assert saved['status'] == 'paused' and saved['result']['pauseReason'] == 'project_unpinned'
        assert analyzer.calls == 0 and drive.reads == []
        with db.connect() as c:
            assert service.get(c, user, 'PILOT', job['id'])['job']['canResume'] is False


@pytest.mark.parametrize('action', ['upgrade_readers', 'repair_evidence', 'reconcile'])
@pytest.mark.parametrize('restriction,error', [
    ('legacy', 'materials_project_unpinned'),
    ('changed', 'materials_project_changed'),
    ('disabled', 'materials_engine_unavailable'),
])
def test_unavailable_job_cannot_be_requeued_or_mutated_by_other_controls(
        environment, action, restriction, error):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        user = current_user(db, google.subject)
        connect_account(db, config, user)
        client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'})
        service = ProductMaterials(config, db, drive, cloud, analyzer)
        job = start(service, db, user)
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET status='ready' WHERE id=%s", (job['id'],))
            if restriction == 'legacy':
                c.execute('UPDATE product_material_jobs SET project_id=NULL WHERE id=%s', (job['id'],))
            elif restriction == 'changed':
                c.execute("UPDATE google_cloud_connections SET project_id='other-project' WHERE user_id=%s",
                          (user['id'],))
            else:
                c.execute("UPDATE product_material_jobs SET engine='adk' WHERE id=%s", (job['id'],))
            before = c.execute('SELECT result FROM product_material_jobs WHERE id=%s',
                               (job['id'],)).fetchone()['result']
        with db.connect() as c:
            with pytest.raises(HTTPException) as blocked:
                copy = advertised_control_consent(action) if action != 'reconcile' else None
                kwargs = ({'consent_version': copy['version'], 'consent_text': copy['text'],
                           'consent_sha256': copy['sha256']} if copy else {})
                getattr(service, action)(c, user, 'PILOT', job['id'], 1, uuid4(), **kwargs)
        assert blocked.value.status_code == 409
        expected = 'materials_repair_consent_required' if action == 'repair_evidence' else error
        assert blocked.value.detail['error'] == expected
        with db.connect() as c:
            row = c.execute('SELECT status,result FROM product_material_jobs WHERE id=%s',
                            (job['id'],)).fetchone()
            controls = c.execute('SELECT count(*) n FROM product_material_controls WHERE job_id=%s',
                                 (job['id'],)).fetchone()['n']
        assert row['status'] == 'ready' and row['result'] == before
        assert controls == analyzer.calls == 0
