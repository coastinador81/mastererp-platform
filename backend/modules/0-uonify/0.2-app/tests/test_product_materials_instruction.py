"""A scoped customer message starts analysis without creating a product."""
from uuid import uuid4
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from psycopg.errors import CheckViolation
from psycopg.types.json import Jsonb

from conftest import client_for
from app.product_materials_amazon import belongs_to_product, latest_job
from test_product_materials import Analyzer, FolderDrive, connect_drive
from test_products import connect as connect_cloud
from test_uony import ready


def _request(c, user, request_id, text):
    c.execute('''INSERT INTO uony_requests
        (user_id,request_id,thread_id,prompt,status,model,project_id)
        VALUES(%s,%s,'main',%s,'running','fixture','project-fixture')''',
        (user['id'], request_id, text))


def test_explicit_folder_instruction_uses_existing_queue_without_sku(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), FolderDrive(), Analyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), \
            client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        instruction = 'Analiza los documentos de la carpeta folder en Drive.'
        request_id = uuid4()
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'main','main')",
                      (user['id'],))
            _request(c, user, request_id, instruction)
            materials = client.app.state.materials
            started = materials.start_for_instruction(c, user, 'main', 'folder',
                request_id, instruction)
            assert started['job']['status'] == 'queued'
            assert started['job']['sku'] is None
            assert started['job']['intakeId'] == started['intakeId']
            assert not started['reused']
            receipt = c.execute('''SELECT source,conversation_request_id,
                conversation_thread_id,instruction_text,folder_id,intake_id,product_id
                FROM product_material_job_authorizations WHERE job_id=%s''',
                (started['job']['id'],)).fetchone()
            assert receipt['source'] == 'chat_instruction'
            assert receipt['conversation_request_id'] == request_id
            assert receipt['conversation_thread_id'] == 'main'
            assert receipt['instruction_text'] == instruction
            assert receipt['folder_id'] == 'folder'
            assert receipt['product_id'] is None
            assert str(receipt['intake_id']) == started['intakeId']
            assert materials.start_for_instruction(c, user, 'main', 'folder',
                request_id, instruction)['reused'] is True
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0
        job_id = started['job']['id']
        response = client.get('/api/uony/materials/jobs/' + job_id)
        assert response.status_code == 200, response.text
        assert response.json()['job']['status'] == 'queued'
        assert response.json()['job']['folderName'] == 'Carpeta del producto'
        with db.connect() as c:
            c.execute('''UPDATE uony_requests SET material_analysis=%s
                WHERE user_id=%s AND request_id=%s''',
                (Jsonb({'jobId': job_id, 'intakeId': started['intakeId']}),
                 user['id'], request_id))
            c.execute('''UPDATE uony_requests SET material_analysis=%s
                WHERE user_id=%s AND request_id=%s''',
                (Jsonb({'jobId': job_id, 'intakeId': None,
                        'assignmentId': str(uuid4())}), user['id'], request_id))
        with pytest.raises(CheckViolation):
            with db.connect() as c:
                c.execute('''UPDATE uony_requests SET material_analysis=%s
                    WHERE user_id=%s AND request_id=%s''',
                    (Jsonb({'jobId': job_id, 'intakeId': started['intakeId'],
                            'modelSelectedAction': 'publish'}), user['id'], request_id))
        materials.run(job_id, user['id'])
        response = client.get('/api/uony/materials/jobs/' + job_id)
        assert response.status_code == 200, response.text
        assert response.json()['job']['status'] == 'ready'
        assert analyzer.calls > 0
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 1
            second_request = uuid4()
            _request(c, user, second_request, 'Analiza también la carpeta nested.')
            second = materials.start_for_instruction(c, user, 'main', 'nested',
                second_request, 'Analiza también la carpeta nested.')
            assert second['job']['id'] != job_id
            assert second['intakeId'] != started['intakeId']
            assert second['job']['sku'] is None
            assert c.execute('''SELECT folder_id FROM uony_product_intakes WHERE id=%s''',
                             (started['intakeId'],)).fetchone()['folder_id'] == 'folder'
            assert c.execute('''SELECT folder_id FROM uony_product_intakes WHERE id=%s''',
                             (second['intakeId'],)).fetchone()['folder_id'] == 'nested'
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 2
            assert materials.start_for_instruction(c, user, 'main', 'nested',
                second_request, 'Analiza también la carpeta nested.')['job']['id'] == second['job']['id']
        intake = client.get('/api/uony/product-intakes/' + started['intakeId'],
                            params={'threadId': 'main'}).json()
        created = client.post('/api/uony/product-intakes/' + started['intakeId'] + '/product', json={
            'requestId': str(uuid4()), 'threadId': 'main',
            'revision': intake['revision'], 'name': 'Basic Mini Bricks'})
        assert created.status_code == 200, created.text
        sku = created.json()['product']['sku']
        dossier = client.get(f'/api/products/{sku}/materials')
        assert dossier.status_code == 200, dossier.text
        assert dossier.json()['job']['id'] == job_id
        assert dossier.json()['job']['analysisScope'] == 'linked_intake'
        assert dossier.json()['job']['canResume'] is False
        assert dossier.json()['job']['status'] == 'ready'
        assert client.get(f'/api/products/{sku}/materials/jobs/{job_id}').json()['job']['id'] == job_id
        memory = client.get('/api/uony/threads/main/product-memory')
        assert memory.status_code == 200, memory.text
        assert memory.json()['productMemory']['product']['sku'] == sku
        assert memory.json()['productMemory']['materialState'] != 'none'
        with db.connect() as c:
            saved = c.execute('''SELECT product_id,intake_id FROM product_material_jobs
                WHERE id=%s''', (job_id,)).fetchone()
            assert saved['product_id'] is None
            assert str(saved['intake_id']) == started['intakeId']
            assert c.execute('''SELECT count(*) n FROM product_material_job_authorizations
                WHERE job_id=%s AND source='chat_instruction' ''', (job_id,)).fetchone()['n'] == 1
            assert c.execute('''SELECT count(*) n FROM product_material_job_authorizations
                WHERE job_id=%s AND source='chat_instruction' ''',
                (second['job']['id'],)).fetchone()['n'] == 1
            linked_product = c.execute('''SELECT id FROM products WHERE user_id=%s
                AND sku=%s''', (user['id'], sku)).fetchone()
            assert belongs_to_product(c, user, linked_product, job_id)
            assert latest_job(c, user, linked_product)['id'] == job_id


def test_same_folder_in_another_product_does_not_choose_that_product(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), FolderDrive()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        other = client.post('/api/products', json={
            'sku': 'OTHER-GOAL', 'name': 'Otro encargo'}).json()['product']
        request_id = uuid4()
        instruction = 'Analiza los documentos de folder para un producto nuevo.'
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'main','main')",
                      (user['id'],))
            # A completed goal already used this folder. Sharing a folder is
            # not authority to attach a new command to its product.
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id,
                 status,folder_id,folder_metadata,product_id)
                VALUES(%s,%s,'main',%s,%s,'linked','folder',%s,%s)''',
                (user['id'], uuid4(), user['google_subject'], uuid4(),
                 Jsonb({'id': 'folder', 'name': 'Carpeta del producto'}), other['id']))
            _request(c, user, request_id, instruction)
            started = client.app.state.materials.start_for_instruction(
                c, user, 'main', 'folder', request_id, instruction)
            row = c.execute('''SELECT product_id,intake_id FROM product_material_jobs
                WHERE id=%s''', (started['job']['id'],)).fetchone()
            assert row['product_id'] is None
            assert row['intake_id'] is not None
            assert started['job']['sku'] is None
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 1
            assert not belongs_to_product(c, user, other, started['job']['id'])
            assert latest_job(c, user, other) is None
        assert client.get('/api/products/OTHER-GOAL/materials').json()['job'] is None


def test_new_instruction_does_not_reuse_material_job_from_previous_cloud_project(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), FolderDrive(), Analyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), \
            client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'main','main')",
                      (user['id'],))
            first_request = uuid4()
            first_text = 'Analiza la carpeta folder en Drive.'
            _request(c, user, first_request, first_text)
            materials = client.app.state.materials
            first = materials.start_for_instruction(c, user, 'main', 'folder',
                first_request, first_text)
        materials.run(first['job']['id'], user['id'])
        with db.connect() as c:
            c.execute('''UPDATE google_cloud_connections SET project_id='project-new'
                WHERE user_id=%s''', (user['id'],))
            second_request = uuid4()
            second_text = 'Analiza de nuevo la carpeta folder en Drive.'
            _request(c, user, second_request, second_text)
            second = materials.start_for_instruction(c, user, 'main', 'folder',
                second_request, second_text)
            assert not second['reused']
            assert second['job']['id'] != first['job']['id']
            assert second['intakeId'] == first['intakeId']
            assert c.execute('''SELECT project_id FROM product_material_jobs
                WHERE id=%s''', (second['job']['id'],)).fetchone()['project_id'] == 'project-new'
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0


def test_unfocused_instruction_does_not_reuse_another_assignments_intake(environment):
    config, google, db = environment
    drive, cloud, analyzer = FolderDrive(), FolderDrive(), Analyzer()
    with patch('app.product_materials.MaterialsAnalyzer', return_value=analyzer), \
            client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'main','main')",
                      (user['id'],))
            first_request = uuid4()
            first_text = 'Analiza la carpeta folder en Drive.'
            _request(c, user, first_request, first_text)
            materials = client.app.state.materials
            first = materials.start_for_instruction(c, user, 'main', 'folder',
                first_request, first_text)
            assignment_id = uuid4()
            c.execute('''INSERT INTO uony_assignments
                (user_id,id,google_subject,origin_request_id,origin_thread_id,
                 label,objective,intake_id)
                VALUES(%s,%s,%s,%s,'main','Primer producto','Preparar el primero',%s)''',
                (user['id'], assignment_id, user['google_subject'], first_request,
                 first['intakeId']))
        materials.run(first['job']['id'], user['id'])
        with db.connect() as c:
            second_request = uuid4()
            second_text = 'Analiza la carpeta folder para otro producto.'
            _request(c, user, second_request, second_text)
            second = materials.start_for_instruction(c, user, 'main', 'folder',
                second_request, second_text)
            assert second['job']['id'] != first['job']['id']
            assert second['intakeId'] != first['intakeId']
            assert str(c.execute('''SELECT intake_id FROM uony_assignments
                WHERE user_id=%s AND id=%s''',
                (user['id'], assignment_id)).fetchone()['intake_id']) == first['intakeId']
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0


def test_instruction_must_match_persisted_customer_turn(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), FolderDrive()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        request_id = uuid4()
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'main','main')",
                      (user['id'],))
            _request(c, user, request_id, 'Ve a Drive y avísame cuando estés allí.')
            with pytest.raises(HTTPException) as error:
                client.app.state.materials.start_for_instruction(c, user, 'main',
                    'folder', request_id, 'Analiza la carpeta folder.')
            assert error.value.detail['error'] == 'instruction_not_confirmed'
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0


def test_preproduct_assignment_recovers_causal_progress_without_creating_product(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), FolderDrive()
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        instruction, request_id = 'Analiza la carpeta folder para este encargo.', uuid4()
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'main','main')",
                      (user['id'],))
            _request(c, user, request_id, instruction)
        assignment = client.post('/api/uony/assignments', json={
            'requestId': str(uuid4()), 'threadId': 'main',
            'label': 'Basic Mini Bricks', 'objective': 'Preparar producto'}).json()['assignment']
        selected = client.put('/api/uony/threads/main/assignment-focus', json={
            'requestId': str(uuid4()), 'assignmentId': assignment['id'],
            'expectedVersion': 0})
        assert selected.status_code == 200, selected.text
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
            job = client.app.state.materials.start_for_instruction(c, user,
                'main', 'folder', request_id, instruction,
                assignment_id=assignment['id'])['job']
        saved = client.get('/api/uony/threads/main/assignment-return')
        assert saved.status_code == 200, saved.text
        first = saved.json()['assignments'][0]
        assert first['assignment']['id'] == assignment['id']
        assert first['assignmentWork']['id'] == job['id']
        assert first['assignmentWork']['productId'] is None
        assert first['assignmentWork']['intakeId'] == job['intakeId']
        assert first['assignmentWork']['currentRevision'] is True
        assert first['assignment']['status'] == 'in_progress'
        assert first['product'] is None
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 0
