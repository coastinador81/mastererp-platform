"""A saved goal owns only material jobs started through its explicit action."""
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256

from psycopg.types.json import Jsonb

from app.product_materials_consent import (
    MATERIAL_START_CONSENT_TEXT, MATERIAL_START_CONSENT_VERSION, MATERIAL_START_CONSENT_SHA256,
)
from conftest import client_for, login
from test_google_cloud import Cloud
from test_product_materials import Analyzer, FolderDrive, connect_drive
from test_products import connect as connect_cloud
from test_uony import ready


def _thread(db, subject, *names):
    with db.connect() as c:
        user_id = c.execute('SELECT id FROM users WHERE google_subject=%s',
                            (subject,)).fetchone()['id']
        for name in names:
            c.execute('INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)',
                      (user_id, name, name))
        return user_id


def _goal(client, thread, label, *, request_id=None, **extra):
    result = client.post('/api/uony/assignments', json={
        'requestId': request_id or str(uuid4()), 'threadId': thread, 'label': label,
        'objective': 'Preparar ' + label, **extra})
    assert result.status_code == 200, result.text
    return result.json()['assignment']


def _start(client, assignment, *, request_id=None, sku='BASIC', revision=1,
           folder='folder', reanalysis_of=None,
           consent_version=MATERIAL_START_CONSENT_VERSION):
    body = {'requestId': request_id or str(uuid4()), 'sku': sku,
            'revision': revision, 'folderId': folder}
    if consent_version is not None:
        body['consentVersion'] = consent_version
        body['consentText'] = MATERIAL_START_CONSENT_TEXT
        body['consentSha256'] = MATERIAL_START_CONSENT_SHA256
    if reanalysis_of:
        body['reanalysisOf'] = reanalysis_of
    return client.post(f'/api/uony/assignments/{assignment}/materials/jobs', json=body), body


def test_causal_link_replay_and_semantic_dedupe_do_not_claim_another_goal(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        client.app.state.materials.analyzer = analyzer
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'goals')
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        basic = _goal(client, 'goals', 'Basic Mini Bricks', productId=product['id'])
        other = _goal(client, 'goals', 'Otro encargo de Basic', productId=product['id'])
        for _ in range(2):
            assert client.get('/api/uony/threads/goals/assignment-return').status_code == 200
        assert client.put('/api/uony/threads/goals/assignment-focus', json={
            'requestId': str(uuid4()), 'assignmentId': basic['id'],
            'expectedVersion': 0}).status_code == 200
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_assignment_material_jobs').fetchone()['n'] == 0
        missing, _ = _start(client, basic['id'], consent_version=None)
        stale, _ = _start(client, basic['id'], consent_version='outdated')
        assert missing.status_code == stale.status_code == 409
        assert missing.json()['error'] == stale.json()['error'] == 'materials_consent_version'
        # A fresh contextual action cannot rely on version alone or a digest
        # paired with text different from the one the customer saw.
        base = f'/api/uony/assignments/{basic["id"]}/materials/jobs'
        incomplete = {'requestId': str(uuid4()), 'sku': 'BASIC', 'revision': 1,
                      'folderId': 'folder', 'consentVersion': MATERIAL_START_CONSENT_VERSION,
                      'consentText': MATERIAL_START_CONSENT_TEXT}
        missing_hash = client.post(base, json=incomplete)
        assert missing_hash.status_code == 409
        wrong_text = client.post(base, json={**incomplete, 'requestId': str(uuid4()),
                                              'consentText': MATERIAL_START_CONSENT_TEXT + ' cambio',
                                              'consentSha256': MATERIAL_START_CONSENT_SHA256})
        assert wrong_text.status_code == 409
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_job_authorizations').fetchone()['n'] == 0
        first, body = _start(client, basic['id'])
        assert first.status_code == 200, first.text
        job_id = first.json()['job']['id']
        assert first.json()['assignmentWorkScope'] == 'started_for_assignment'
        assert first.json()['reused'] is False
        assert first.json()['job']['status'] == 'queued'
        assert first.json()['assignment']['status'] == 'in_progress'
        assert first.json()['assignment']['nextStep'] == 'check_work'
        assert analyzer.calls == 0 and drive.reads == []
        with db.connect() as c:
            receipt = c.execute('''SELECT * FROM product_material_job_authorizations
                WHERE user_id=%s AND job_id=%s''', (user_id, job_id)).fetchone()
            assert str(receipt['assignment_id']) == basic['id']
            assert receipt['source'] == 'versioned_ui_ack'
            assert receipt['consent_version'] == MATERIAL_START_CONSENT_VERSION
            assert receipt['consent_text'] == MATERIAL_START_CONSENT_TEXT
            assert receipt['consent_sha256'] == sha256(MATERIAL_START_CONSENT_TEXT.encode()).hexdigest()
            assert receipt['accepted_at'] and receipt['folder_id'] == 'folder'
            accepted_at = receipt['accepted_at']
        replay = client.post(f'/api/uony/assignments/{basic["id"]}/materials/jobs', json=body)
        assert replay.status_code == 200 and replay.json()['job']['id'] == job_id
        assert replay.json()['reused'] is True
        no_version = client.post(f'/api/uony/assignments/{basic["id"]}/materials/jobs',
                                 json={key: value for key, value in body.items()
                                       if key not in ('consentVersion', 'consentText', 'consentSha256')})
        stale_replay = client.post(f'/api/uony/assignments/{basic["id"]}/materials/jobs',
                                   json={**body, 'consentVersion': 'outdated',
                                         'consentSha256': '0' * 64})
        assert no_version.status_code == stale_replay.status_code == 409
        assert no_version.json()['error'] == stale_replay.json()['error'] == 'materials_consent_replay_conflict'
        crossed = client.post(f'/api/uony/assignments/{other["id"]}/materials/jobs', json=body)
        assert crossed.status_code == 409
        assert crossed.json()['error'] == 'assignment_material_request_conflict'
        semantic, _ = _start(client, other['id'])
        assert semantic.status_code == 409
        assert semantic.json()['error'] == 'assignment_material_existing'
        same_goal, _ = _start(client, basic['id'])
        assert same_goal.status_code == 200 and same_goal.json()['reused'] is True
        assert same_goal.json()['job']['id'] == job_id
        view = client.get('/api/uony/threads/goals/assignment-return').json()
        by_id = {item['assignment']['id']: item for item in view['assignments']}
        assert by_id[basic['id']]['assignmentWork']['id'] == job_id
        assert by_id[basic['id']]['assignmentWork']['scope'] == 'started_for_assignment'
        assert by_id[basic['id']]['relatedProductWork'] is None
        assert by_id[basic['id']]['workLabel'] == 'Análisis iniciado para este encargo'
        assert by_id[other['id']]['assignmentWork'] is None
        assert by_id[other['id']]['relatedProductWork']['id'] == job_id
        assert (by_id[other['id']]['assignment']['status'],
                by_id[other['id']]['assignment']['nextStep']) == ('pending', 'clarify_source')
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs WHERE user_id=%s',
                             (user_id,)).fetchone()['n'] == 1
            receipts = c.execute('''SELECT accepted_at,assignment_id,consent_version
                FROM product_material_job_authorizations WHERE user_id=%s''', (user_id,)).fetchall()
            assert len(receipts) == 1 and receipts[0]['accepted_at'] == accepted_at
            assert str(receipts[0]['assignment_id']) == basic['id']
            assert receipts[0]['consent_version'] == MATERIAL_START_CONSENT_VERSION
            link = c.execute('SELECT * FROM uony_assignment_material_jobs WHERE user_id=%s',
                             (user_id,)).fetchone()
            assert str(link['assignment_id']) == basic['id'] and str(link['material_job_id']) == job_id
        assert analyzer.calls == 0 and drive.reads == []


def test_causal_job_status_is_consistent_across_assignment_reads_without_completing_goal(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'state')
        product = client.post('/api/products', json={
            'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        goal = _goal(client, 'state', 'Basic', productId=product['id'])
        chosen = client.put('/api/uony/threads/state/assignment-focus', json={
            'requestId': str(uuid4()), 'assignmentId': goal['id'], 'expectedVersion': 0})
        assert chosen.status_code == 200, chosen.text
        started, _ = _start(client, goal['id'])
        assert started.status_code == 200, started.text
        job_id = started.json()['job']['id']

        def assert_views(expected_status, expected_next, job_status):
            sources = (
                client.get('/api/uony/assignments/' + goal['id']).json()['assignment'],
                client.get('/api/uony/assignments').json()['assignments'][0],
                client.get('/api/uony/threads/state/assignment-focus').json()['focus']['current'],
                client.get('/api/uony/threads/state/assignment-focus/previous').json()['assignment'],
                client.get('/api/uony/threads/state/assignment-return').json()['assignments'][0]['assignment'],
            )
            assert all((item['status'], item['nextStep']) ==
                       (expected_status, expected_next) for item in sources)
            returned = client.get('/api/uony/threads/state/assignment-return').json()['assignments'][0]
            assert returned['assignmentWork']['id'] == job_id
            assert returned['assignmentWork']['status'] == job_status

        assert_views('in_progress', 'check_work', 'queued')
        for job_status, goal_status, next_step in (
            ('running', 'in_progress', 'check_work'),
            ('ready', 'pending', 'review_result'),
            ('error', 'failed', 'check_work'),
            ('paused', 'pending', 'check_work'),
        ):
            with db.connect() as c:
                c.execute('''UPDATE product_material_jobs SET status=%s,updated_at=now()
                    WHERE user_id=%s AND id=%s''', (job_status, user_id, job_id))
            assert_views(goal_status, next_step, job_status)
        changed = client.patch('/api/products/BASIC', json={
            'revision': 1, 'name': 'Basic Mini Bricks revisado'})
        assert changed.status_code == 200 and changed.json()['product']['revision'] == 2
        assert_views('pending', 'select_folder', 'paused')
        historical = client.get('/api/uony/threads/state/assignment-return').json()['assignments'][0]
        assert historical['assignmentWork']['currentRevision'] is False
        with db.connect() as c:
            row = c.execute('''SELECT status,next_step FROM uony_assignments
                WHERE user_id=%s AND id=%s''', (user_id, goal['id'])).fetchone()
            assert (row['status'], row['next_step']) == ('pending', 'clarify_source')
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 1
            c.execute('''UPDATE uony_assignments
                SET status='waiting_authorization',next_step='await_authorization'
                WHERE user_id=%s AND id=%s''', (user_id, goal['id']))
        assert_views('waiting_authorization', 'await_authorization', 'paused')


def test_scope_origin_revision_and_legacy_job_cannot_be_retroactively_claimed(environment, monkeypatch):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), Cloud(), Analyzer()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        client.app.state.materials.analyzer = analyzer
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'scope')
        basic = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        lamp = client.post('/api/products', json={'sku': 'LAMP', 'name': 'Lámpara'}).json()['product']
        goal = _goal(client, 'scope', 'Basic', productId=basic['id'])
        base = f'/api/uony/assignments/{goal["id"]}/materials/jobs'
        body = {'requestId': str(uuid4()), 'sku': 'BASIC', 'revision': 1,
                'folderId': 'folder', 'consentVersion': MATERIAL_START_CONSENT_VERSION,
                'consentText': MATERIAL_START_CONSENT_TEXT,
                'consentSha256': MATERIAL_START_CONSENT_SHA256}
        assert client.post(base, json=body, headers={'Origin': 'null'}).status_code == 403
        assert client.post(base, json={**body, 'sku': 'LAMP'}).json()['error'] == 'assignment_product_conflict'
        assert client.post(base, json={**body, 'revision': 2}).json()['error'] == 'product_conflict'
        unknown = client.post(f'/api/uony/assignments/{uuid4()}/materials/jobs', json=body)
        assert unknown.status_code == 404
        legacy_request_id = str(uuid4())
        # Recreate a historical job; current endpoints must reject a fresh
        # unversioned decision rather than granting legacy consent today.
        with monkeypatch.context() as old:
            old.setattr('app.product_materials.start_consent', lambda *args, **kwargs: {
                'source': 'legacy_post_only', 'version': None, 'text': None, 'sha256': None})
            legacy = client.post('/api/products/BASIC/materials/jobs', json={
                'requestId': legacy_request_id, 'revision': 1, 'folderId': 'folder'})
        assert legacy.status_code == 200, legacy.text
        cannot_claim = client.post(base, json=body)
        assert cannot_claim.status_code == 409
        assert cannot_claim.json()['error'] == 'assignment_material_existing'
        same_request = client.post(base, json={**body, 'requestId': legacy_request_id})
        # A legacy request cannot be retroactively claimed as an assignment job.
        assert same_request.status_code == 409
        assert same_request.json()['error'] == 'assignment_material_request_conflict'
        historical = client.get('/api/uony/threads/scope/assignment-return').json()['assignments'][0]
        assert historical['assignmentWork'] is None
        assert historical['relatedProductWork']['id'] == legacy.json()['job']['id']
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_assignment_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 1
        google.subject, google.email = 'different-account', 'different@example.test'
        ready(client, google, db)
        assert client.post(base, json=body).status_code == 404
        assert analyzer.calls == 0 and drive.reads == []


def test_linked_intake_binding_survives_thread_erasure_and_product_deletion_clears_link(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'source', 'return')
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        intake_id = uuid4()
        with db.connect() as c:
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id,status,
                 folder_id,folder_metadata,product_id,confirmed_name)
                VALUES(%s,%s,'source',%s,%s,'linked','folder',%s,%s,'Basic Mini Bricks')''',
                (user_id, intake_id, google.subject, uuid4(),
                 Jsonb({'id': 'folder', 'name': 'Materiales Basic'}), product['id']))
        create_request_id = str(uuid4())
        create_body = {'requestId': create_request_id, 'threadId': 'source',
                       'label': 'Basic', 'objective': 'Preparar Basic',
                       'intakeId': str(intake_id)}
        goal = _goal(client, 'source', 'Basic', request_id=create_request_id,
                     intakeId=str(intake_id))
        wrong, _ = _start(client, goal['id'], folder='other-folder')
        assert wrong.status_code == 409 and wrong.json()['error'] == 'assignment_intake_conflict'
        first, start_body = _start(client, goal['id'])
        assert first.status_code == 200, first.text
        job_id = first.json()['job']['id']
        replay_before_delete = client.post('/api/uony/assignments', json=create_body)
        assert replay_before_delete.status_code == 200, replay_before_delete.text
        assert replay_before_delete.json()['replayed'] is True
        assert replay_before_delete.json()['assignment']['productId'] == product['id']
        assert client.delete('/api/uony/threads/source').status_code == 200
        replay_after_delete = client.post('/api/uony/assignments', json=create_body)
        assert replay_after_delete.status_code == 200, replay_after_delete.text
        assert replay_after_delete.json()['replayed'] is True
        assert replay_after_delete.json()['assignment']['id'] == goal['id']
        changed_creation = client.post('/api/uony/assignments', json={
            **create_body, 'productId': product['id']})
        assert changed_creation.status_code == 409
        assert changed_creation.json()['error'] == 'assignment_request_conflict'
        saved = client.get('/api/uony/assignments/' + goal['id']).json()['assignment']
        assert saved['productId'] == product['id'] and saved['intakeId'] is None
        view = client.get('/api/uony/threads/return/assignment-return').json()
        assert view['assignments'][0]['assignmentWork']['id'] == job_id
        changed = client.patch('/api/products/BASIC', json={
            'revision': 1, 'name': 'Basic Mini Bricks revisado'})
        assert changed.status_code == 200 and changed.json()['product']['revision'] == 2
        replay_old_job = client.post(
            f'/api/uony/assignments/{goal["id"]}/materials/jobs', json=start_body)
        assert replay_old_job.status_code == 200, replay_old_job.text
        assert replay_old_job.json()['job']['id'] == job_id
        assert (replay_old_job.json()['assignment']['status'],
                replay_old_job.json()['assignment']['nextStep']) == ('pending', 'select_folder')
        older = client.get('/api/uony/threads/return/assignment-return').json()['assignments'][0]
        assert older['assignmentWork']['id'] == job_id
        assert older['assignmentWork']['currentRevision'] is False
        assert older['workLabel'] == 'Análisis de este encargo en una revisión anterior'
        assert client.delete('/api/products/BASIC').status_code == 200
        assert client.get('/api/uony/assignments/' + goal['id']).status_code == 404
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_assignment_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 1


def test_linked_intake_product_survives_origin_deletion_before_any_job(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'source', 'return')
        product = client.post('/api/products', json={
            'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        intake_id = uuid4()
        with db.connect() as c:
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id,status,
                 folder_id,folder_metadata,product_id,confirmed_name)
                VALUES(%s,%s,'source',%s,%s,'linked','folder',%s,%s,'Basic Mini Bricks')''',
                (user_id, intake_id, google.subject, uuid4(),
                 Jsonb({'id': 'folder', 'name': 'Materiales Basic'}), product['id']))
        goal = _goal(client, 'source', 'Basic', intakeId=str(intake_id))
        assert client.delete('/api/uony/threads/source').status_code == 200
        saved = client.get('/api/uony/assignments/' + goal['id']).json()['assignment']
        assert saved['productId'] == product['id'] and saved['intakeId'] is None
        assert saved['version'] == goal['version'] + 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_product_intakes').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
        started, _ = _start(client, goal['id'])
        assert started.status_code == 200, started.text
        assert started.json()['assignment']['productId'] == product['id']
        assert started.json()['assignment']['status'] == 'in_progress'
        item = client.get('/api/uony/threads/return/assignment-return').json()['assignments'][0]
        assert item['assignmentWork']['id'] == started.json()['job']['id']


def test_explicit_reanalysis_keeps_two_causal_jobs_and_old_retry_is_blocked(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'reanalyze')
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        goal = _goal(client, 'reanalyze', 'Basic', productId=product['id'])
        first, _ = _start(client, goal['id'])
        assert first.status_code == 200
        first_id = first.json()['job']['id']
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET status='ready' WHERE id=%s AND user_id=%s",
                      (first_id, user_id))
        second, body = _start(client, goal['id'], reanalysis_of=first_id)
        assert second.status_code == 200, second.text
        second_id = second.json()['job']['id']
        assert second_id != first_id and second.json()['reused'] is False
        repeated = client.post(f'/api/uony/assignments/{goal["id"]}/materials/jobs', json=body)
        assert repeated.status_code == 200 and repeated.json()['job']['id'] == second_id
        assert repeated.json()['reused'] is True
        late, _ = _start(client, goal['id'], reanalysis_of=first_id)
        assert late.status_code == 409 and late.json()['error'] == 'materials_conflict'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 2
            assert c.execute('SELECT count(*) n FROM uony_assignment_material_jobs').fetchone()['n'] == 2
        view = client.get('/api/uony/threads/reanalyze/assignment-return').json()['assignments'][0]
        assert view['assignmentWork']['id'] == second_id


def test_simultaneous_goals_for_one_folder_create_one_job_and_one_owner(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    with client_for(config, google, drive=drive, cloud=cloud) as first:
        ready(first, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        user_id = _thread(db, google.subject, 'parallel')
        product = first.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        a = _goal(first, 'parallel', 'Primer encargo', productId=product['id'])
        b = _goal(first, 'parallel', 'Segundo encargo', productId=product['id'])
        with client_for(config, google, drive=drive, cloud=cloud) as second:
            login(second, google)
            with ThreadPoolExecutor(max_workers=2) as pool:
                one = pool.submit(_start, first, a['id'])
                two = pool.submit(_start, second, b['id'])
                responses = [one.result(timeout=10)[0], two.result(timeout=10)[0]]
        assert sorted(response.status_code for response in responses) == [200, 409]
        assert next(response for response in responses if response.status_code == 409).json()['error'] == 'assignment_material_existing'
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs WHERE user_id=%s',
                             (user_id,)).fetchone()['n'] == 1
            assert c.execute('SELECT count(*) n FROM uony_assignment_material_jobs WHERE user_id=%s',
                             (user_id,)).fetchone()['n'] == 1
