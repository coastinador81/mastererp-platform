"""A material start records only the decision available for that fresh job."""
from hashlib import sha256
from uuid import uuid4

import pytest
from psycopg.errors import RaiseException

from app.product_materials_consent import (
    MATERIAL_START_CONSENT_TEXT, MATERIAL_START_CONSENT_VERSION,
    MATERIAL_START_CONSENT_SHA256,
)
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials import FolderDrive, connect_drive
from test_products import connect as connect_cloud
from test_uony import ready


def _ready(client, google, db, config):
    ready(client, google, db)
    connect_cloud(db, config)
    connect_drive(db, config)
    product = client.post('/api/products', json={'sku': 'CONSENT', 'name': 'Producto de prueba'})
    assert product.status_code == 200
    return '/api/products/CONSENT/materials/jobs'


def _body(*, request_id=None, consent_version=MATERIAL_START_CONSENT_VERSION,
          reanalysis_of=None):
    body = {'requestId': request_id or str(uuid4()), 'revision': 1, 'folderId': 'folder'}
    if consent_version is not None:
        body['consentVersion'] = consent_version
        body['consentText'] = MATERIAL_START_CONSENT_TEXT
        body['consentSha256'] = MATERIAL_START_CONSENT_SHA256
    if reanalysis_of:
        body['reanalysisOf'] = reanalysis_of
    return body


def test_versioned_receipt_replay_dedupe_and_reanalysis_are_atomic(environment):
    config, google, db = environment
    drive = FolderDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        endpoint = _ready(client, google, db, config)
        version = client.get(endpoint.replace('/jobs', '/start-consent'))
        assert version.status_code == 200
        assert version.json() == {'version': MATERIAL_START_CONSENT_VERSION,
                                  'text': MATERIAL_START_CONSENT_TEXT,
                                  'sha256': MATERIAL_START_CONSENT_SHA256}
        assert version.headers['cache-control'] == 'no-store'
        assert drive.reads == []
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
        stale = client.post(endpoint, json=_body(consent_version='outdated'))
        assert stale.status_code == 409
        assert stale.json()['error'] == 'materials_consent_version'
        for incomplete in (
            _body(consent_version=None),
            {key: value for key, value in _body().items() if key == 'consentVersion' or key in ('requestId', 'revision', 'folderId')},
            {**_body(), 'consentSha256': '0' * 64},
            {**_body(), 'consentText': MATERIAL_START_CONSENT_TEXT + ' cambio'},
        ):
            rejected = client.post(endpoint, json=incomplete)
            assert rejected.status_code == 409
            assert rejected.json()['error'] == 'materials_consent_version'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0

        body = _body()
        first = client.post(endpoint, json=body)
        assert first.status_code == 200, first.text
        job_id = first.json()['job']['id']
        with db.connect() as c:
            row = c.execute('''SELECT a.*,j.project_id AS job_project_id
                FROM product_material_job_authorizations AS a
                JOIN product_material_jobs AS j ON j.user_id=a.user_id AND j.id=a.job_id
                WHERE a.job_id=%s''', (job_id,)).fetchone()
            assert row['source'] == 'versioned_ui_ack'
            assert row['consent_version'] == MATERIAL_START_CONSENT_VERSION
            assert row['consent_text'] == MATERIAL_START_CONSENT_TEXT
            assert row['consent_sha256'] == sha256(MATERIAL_START_CONSENT_TEXT.encode()).hexdigest()
            assert row['folder_id'] == 'folder' and row['revision'] == 1
            assert row['project_id'] == row['job_project_id']
            assert row['accepted_at'] and row['recorded_at']
            assert row['action'] == 'start' and row['assignment_id'] is None
            accepted_at = row['accepted_at']
        same_request = client.post(endpoint, json=body)
        assert same_request.status_code == 200 and same_request.json()['job']['id'] == job_id
        stale_replay = client.post(endpoint, json={**body, 'consentVersion': 'outdated',
                                                   'consentSha256': '0' * 64})
        assert stale_replay.status_code == 409
        assert stale_replay.json()['error'] == 'materials_consent_replay_conflict'
        assert client.post(endpoint, json={k: v for k, v in body.items()
            if k not in ('consentVersion', 'consentText', 'consentSha256')}).status_code == 409
        same_work = client.post(endpoint, json=_body())
        assert same_work.status_code == 200 and same_work.json()['job']['id'] == job_id
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_job_authorizations').fetchone()['n'] == 1
            assert c.execute('''SELECT accepted_at FROM product_material_job_authorizations
                WHERE job_id=%s''', (job_id,)).fetchone()['accepted_at'] == accepted_at
            c.execute("UPDATE product_material_jobs SET status='ready' WHERE id=%s", (job_id,))
        unapproved_reanalysis = client.post(endpoint, json=_body(
            consent_version=None, reanalysis_of=job_id))
        assert unapproved_reanalysis.status_code == 409
        assert unapproved_reanalysis.json()['error'] == 'materials_consent_version'
        again = client.post(endpoint, json=_body(reanalysis_of=job_id))
        assert again.status_code == 200, again.text
        new_id = again.json()['job']['id']
        assert new_id != job_id
        with db.connect() as c:
            rows = c.execute('''SELECT job_id,action,reanalysis_of,source
                FROM product_material_job_authorizations ORDER BY recorded_at,job_id''').fetchall()
            assert len(rows) == 2
            newer = next(row for row in rows if str(row['job_id']) == new_id)
            assert newer['action'] == 'reanalysis'
            assert str(newer['reanalysis_of']) == job_id
            assert newer['source'] == 'versioned_ui_ack'


@pytest.mark.parametrize('with_receipt', [False, True])
def test_historical_replay_stays_historical_and_new_legacy_post_is_blocked(
        environment, monkeypatch, with_receipt):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        endpoint = _ready(client, google, db, config)
        body = _body(consent_version=None)
        blocked = client.post(endpoint, json=body)
        assert blocked.status_code == 409 and blocked.json()['error'] == 'materials_consent_version'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
        # Recreate the two historical shapes without admitting either for a
        # fresh request in current code: legacy receipt, or pre-ledger job.
        with monkeypatch.context() as old:
            old.setattr('app.product_materials.start_consent', lambda *args, **kwargs: {
                'source': 'legacy_post_only', 'version': None, 'text': None, 'sha256': None,
            })
            if not with_receipt:
                old.setattr('app.product_materials.record_start_consent', lambda *args, **kwargs: None)
            first = client.post(endpoint, json=body)
        assert first.status_code == 200, first.text
        job_id = first.json()['job']['id']
        replay = client.post(endpoint, json=body)
        assert replay.status_code == 200 and replay.json()['job']['id'] == job_id
        stale_replay = client.post(endpoint, json={**body, 'consentVersion': 'outdated'})
        assert stale_replay.status_code == 409
        assert stale_replay.json()['error'] == 'materials_consent_replay_conflict'
        semantic = client.post(endpoint, json={**body, 'requestId': str(uuid4())})
        assert semantic.status_code == 409
        assert semantic.json()['error'] == 'materials_consent_version'
        with db.connect() as c:
            rows = c.execute('SELECT * FROM product_material_job_authorizations').fetchall()
            assert len(rows) == int(with_receipt)
            if with_receipt:
                receipt = rows[0]
                assert receipt['source'] == 'legacy_post_only'
                assert receipt['consent_version'] is None
                assert receipt['consent_text'] is None
                assert receipt['consent_sha256'] is None
                assert receipt['accepted_at'] is None
        if with_receipt:
            with pytest.raises(RaiseException):
                with db.connect() as c:
                    c.execute('''UPDATE product_material_job_authorizations
                        SET consent_version=%s WHERE job_id=%s''',
                        (MATERIAL_START_CONSENT_VERSION, job_id))
            with pytest.raises(RaiseException):
                with db.connect() as c:
                    c.execute('DELETE FROM product_material_job_authorizations WHERE job_id=%s', (job_id,))


def test_receipt_failure_rolls_back_the_new_job(environment, monkeypatch):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        endpoint = _ready(client, google, db, config)
        def fail_record(*args, **kwargs):
            raise RuntimeError('synthetic receipt write failure')
        monkeypatch.setattr('app.product_materials.record_start_consent', fail_record)
        with pytest.raises(RuntimeError, match='synthetic receipt write failure'):
            client.post(endpoint, json=_body())
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_job_authorizations').fetchone()['n'] == 0
