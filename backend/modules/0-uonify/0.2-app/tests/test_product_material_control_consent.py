"""No provider is called: additional analysis blocks retain the exact decision."""
from uuid import uuid4

import pytest
from psycopg.errors import RaiseException
from psycopg.types.json import Jsonb

from app.product_materials_control_consent import (
    CONTROL_COPY, advertised_control_consent, record_control_consent,
)
from material_control_copy import control_body
from conftest import client_for, login
from test_google_cloud import Cloud
from test_material_reader_upgrade import completed
from test_material_repair import legacy
from test_product_materials import FolderDrive


def prepared(action, client, google, db, config):
    if action == 'upgrade_readers':
        service, user, job, endpoint, _ = completed(client, google, db, config)
    else:
        service, user, job, endpoint, _, _ = legacy(client, google, db, config)
    return service, user, job, endpoint


def test_control_copy_owner_and_versioned_atomic_receipt(environment, monkeypatch):
    action, slug = 'upgrade_readers', 'upgrade-readers'
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        _, user, job, endpoint = prepared(action, client, google, db, config)
        copy = advertised_control_consent(action)
        advertised = client.get(endpoint.replace(slug, 'control-consent/' + slug))
        assert advertised.status_code == 200 and advertised.json() == copy
        assert advertised.headers['cache-control'] == 'no-store'
        assert drive.reads == []
        body = control_body(action)
        for changes in ({'consentVersion': 'older'}, {'consentText': copy['text'] + ' changed'},
                        {'consentSha256': '0' * 64}, {'consentSha256': None},
                        {'consentVersion': None, 'consentText': None, 'consentSha256': None}):
            rejected = client.post(endpoint, json={**body, **changes})
            assert rejected.status_code == 409 and rejected.json()['error'] == 'materials_consent_version'
            assert 'Actualiza la página' in rejected.json()['message']
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_controls').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_control_authorizations').fetchone()['n'] == 0
        first = client.post(endpoint, json=body)
        assert first.status_code == 200, first.text
        assert first.json()['job']['id'] == job['id'] and first.json()['job']['status'] == 'queued'
        with db.connect() as c:
            row = c.execute('''SELECT a.*,j.project_id AS job_project_id
                FROM product_material_control_authorizations a
                JOIN product_material_jobs j ON j.id=a.job_id AND j.user_id=a.user_id
                WHERE a.user_id=%s AND a.request_id=%s''', (user['id'], body['requestId'])).fetchone()
            assert row['action'] == action and str(row['job_id']) == job['id']
            assert row['source'] == 'versioned_ui_ack' and row['accepted_at']
            assert row['consent_version'] == copy['version'] and row['consent_text'] == copy['text']
            assert row['consent_sha256'] == copy['sha256']
            assert row['google_subject'] == user['google_subject']
            assert row['project_id'] == row['job_project_id']
            assert row['folder_id'] == job['folderId'] and row['revision'] == 1
            accepted_at = row['accepted_at']
        # A later copy revision must not make the exact original retry perform
        # a new action or lose access to the result it already accepted.
        monkeypatch.setitem(CONTROL_COPY, action,
                            (copy['version'] + '-later', copy['text'] + ' Cambio posterior.'))
        replay = client.post(endpoint, json=body)
        assert replay.status_code == 200 and replay.json()['job']['id'] == job['id']
        changed_replay = client.post(endpoint, json={**body, 'consentVersion': 'older'})
        assert changed_replay.status_code == 409
        assert changed_replay.json()['error'] == 'materials_consent_replay_conflict'
        with db.connect() as c:
            assert c.execute('''SELECT count(*) n FROM product_material_control_authorizations
                WHERE user_id=%s''', (user['id'],)).fetchone()['n'] == 1
            assert c.execute('''SELECT accepted_at FROM product_material_control_authorizations
                WHERE user_id=%s AND request_id=%s''',
                (user['id'], body['requestId'])).fetchone()['accepted_at'] == accepted_at
        with pytest.raises(RaiseException):
            with db.connect() as c:
                c.execute('''UPDATE product_material_control_authorizations SET consent_text='changed'
                    WHERE user_id=%s AND request_id=%s''', (user['id'], body['requestId']))
        with pytest.raises(RaiseException):
            with db.connect() as c:
                c.execute('''DELETE FROM product_material_control_authorizations
                    WHERE user_id=%s AND request_id=%s''', (user['id'], body['requestId']))
        google.subject, google.email = 'foreign', 'foreign@example.test'
        login(client, google)
        assert client.get(endpoint.replace(slug, 'control-consent/' + slug)).status_code in (403, 404)
        assert client.post(endpoint, json=body).status_code in (403, 404)
        assert drive.reads == []


@pytest.mark.parametrize('action', ['upgrade_readers', 'repair_evidence'])
def test_historical_control_replay_never_becomes_a_versioned_acceptance(environment, action):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, user, job, endpoint = prepared(action, client, google, db, config)
        body = {'requestId': str(uuid4()), 'revision': 1}
        with db.connect() as c:
            c.execute('''INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload)
                VALUES(%s,%s,%s,%s,%s)''',
                (user['id'], body['requestId'], job['id'], action,
                 Jsonb({'revision': 1, 'acknowledgeUnknownConsumption': False})))
        assert client.post(endpoint, json=body).status_code == 200
        changed = client.post(endpoint, json={**body, **{
            'consentVersion': advertised_control_consent(action)['version'],
            'consentText': advertised_control_consent(action)['text'],
            'consentSha256': advertised_control_consent(action)['sha256'],
        }})
        assert changed.status_code == 409
        assert changed.json()['error'] == 'materials_consent_replay_conflict'
        with db.connect() as c:
            assert c.execute('''SELECT count(*) n FROM product_material_control_authorizations
                WHERE user_id=%s AND request_id=%s''',
                (user['id'], body['requestId'])).fetchone()['n'] == 0
        receipt_request = str(uuid4())
        legacy = {**body, 'requestId': receipt_request}
        with db.connect() as c:
            c.execute('''INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload)
                VALUES(%s,%s,%s,%s,%s)''',
                (user['id'], receipt_request, job['id'], action,
                 Jsonb({'revision': 1, 'acknowledgeUnknownConsumption': False})))
            row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s', (job['id'],)).fetchone()
            record_control_consent(c, row, receipt_request, action, 1,
                                   {'source': 'legacy_post_only', 'version': None,
                                    'text': None, 'sha256': None})
        assert client.post(endpoint, json=legacy).status_code == 200
        assert client.post(endpoint, json={**legacy,
            'consentVersion': advertised_control_consent(action)['version']}).status_code == 409
        with db.connect() as c:
            old = c.execute('''SELECT source,accepted_at,consent_version
                FROM product_material_control_authorizations WHERE user_id=%s AND request_id=%s''',
                (user['id'], receipt_request)).fetchone()
            assert old == {'source': 'legacy_post_only', 'accepted_at': None,
                           'consent_version': None}


@pytest.mark.parametrize('action', ['upgrade_readers', 'repair_evidence'])
def test_new_legacy_post_is_rejected_before_mutation(environment, action):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, user, job, endpoint = prepared(action, client, google, db, config)
        blocked = client.post(endpoint, json={'requestId': str(uuid4()), 'revision': 1})
        assert blocked.status_code == 409
        assert blocked.json()['error'] == 'materials_consent_version'
        assert 'No se ha iniciado otro análisis' in blocked.json()['message']
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_controls').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_control_authorizations').fetchone()['n'] == 0
            assert c.execute('SELECT status FROM product_material_jobs WHERE id=%s',
                             (job['id'],)).fetchone()['status'] == 'ready'


def test_receipt_write_failure_rolls_back_control_and_budget(environment, monkeypatch):
    action, module = 'upgrade_readers', 'app.product_materials_upgrade'
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, _, job, endpoint = prepared(action, client, google, db, config)
        before = client.get('/api/products/DURABLE/materials').json()['job']['budget']
        def refuse(*args, **kwargs):
            raise RuntimeError('receipt write refused')
        monkeypatch.setattr(module + '.record_control_consent', refuse)
        with pytest.raises(RuntimeError, match='receipt write refused'):
            client.post(endpoint, json=control_body(action))
        after = client.get('/api/products/DURABLE/materials').json()['job']
        assert after['budget'] == before and after['status'] == 'ready'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_controls').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_control_authorizations').fetchone()['n'] == 0


def test_repair_copy_is_not_yet_sufficient_for_a_new_paid_block(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        _, user, job, endpoint = prepared('repair_evidence', client, google, db, config)
        before = client.get('/api/products/DURABLE/materials').json()['job']
        response = client.post(endpoint, json=control_body('repair_evidence'))
        assert response.status_code == 409
        assert response.json()['error'] == 'materials_repair_consent_required'
        assert client.get('/api/products/DURABLE/materials').json()['job'] == before
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_controls WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_control_authorizations WHERE job_id=%s',
                             (job['id'],)).fetchone()['n'] == 0
        assert drive.reads == []
