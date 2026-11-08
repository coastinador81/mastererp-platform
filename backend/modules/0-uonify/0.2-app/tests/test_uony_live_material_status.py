"""Live reads only the saved material work of this account and thread."""
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.main import create_app
from app.security import digest
from app.uony_live_bridge import LiveTranscript, _current_work
from app.uony_live_delivery import work_state
from test_uony_live_bridge import FakeLive, bind, headers
from test_uony_live_handoff import prepared, tool


def _job(c, user_id, subject, project, thread, folder, summary):
    intake_id, request_id, job_id = uuid4(), uuid4(), uuid4()
    c.execute('''INSERT INTO uony_product_intakes
        (user_id,id,thread_id,google_subject,origin_request_id,status,
         folder_id,folder_metadata)
        VALUES(%s,%s,%s,%s,%s,'identified',%s,%s)''',
        (user_id, intake_id, thread, subject, request_id, folder,
         Jsonb({'id': folder, 'name': 'Materiales ' + folder})))
    c.execute('''INSERT INTO product_material_jobs
        (id,user_id,product_id,intake_id,request_id,google_subject,revision,
         folder_id,project_id,status,result)
        VALUES(%s,%s,NULL,%s,%s,%s,1,%s,%s,'ready',%s)''',
        (job_id, user_id, intake_id, request_id, subject, folder, project,
         Jsonb({'protocolVersion': 2, 'total': 1,
            'sources': [{'name': 'Manual.txt', 'summary': summary}],
            'proposals': []})))
    return job_id


def _product_job(c, user_id, subject, project, request_id):
    product_id, job_id = uuid4(), uuid4()
    c.execute('''INSERT INTO products(user_id,id,sku,data,revision)
        VALUES(%s,%s,%s,%s,1)''',
        (user_id, product_id, 'BASIC-LIVE', Jsonb({'name': 'Basic Mini Bricks'})))
    c.execute('''INSERT INTO product_material_jobs
        (id,user_id,product_id,request_id,google_subject,revision,
         folder_id,project_id,status,result)
        VALUES(%s,%s,%s,%s,%s,1,'product-folder',%s,'ready',%s)''',
        (job_id, user_id, product_id, request_id, subject, project,
         Jsonb({'protocolVersion': 2, 'folderName': 'Materiales Basic', 'total': 1,
                'sources': [{'name': 'Ficha.txt', 'summary': '120 piezas verificadas.'}],
                'proposals': [{'label': 'Piezas', 'value': '120'}]})))
    return job_id, product_id


def test_live_work_reports_only_the_completed_job_of_this_voice_thread(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bound = bind(ws, 'materials-voice')
            turn_id = str(uuid4())
            spoken = 'Analiza la carpeta de Drive llamada Basic Mini Bricks.'
            fake.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], spoken, intent='use_drive_materials')
            handoff = ws.receive_json()
            assert handoff['type'] == 'handoff'
            with db.connect() as c:
                own = _job(c, account[0], account[1], account[2],
                           'materials-voice', 'own-folder', '120 piezas encontradas.')
                c.execute('''UPDATE uony_requests SET status='success',reply=%s,
                    material_analysis=%s WHERE user_id=%s AND request_id=%s''',
                    ('Estoy analizando la carpeta.', Jsonb({'jobId': str(own),
                        'intakeId': str(c.execute('''SELECT intake_id FROM product_material_jobs
                            WHERE id=%s''', (own,)).fetchone()['intake_id'])}),
                     account[0], handoff['requestId']))
                c.execute('''UPDATE uony_conversation_jobs SET status='success',
                    finished_at=now() WHERE user_id=%s AND request_id=%s''',
                    (account[0], handoff['requestId']))
                other = c.execute('''SELECT id,google_subject FROM users
                    WHERE google_subject='live-test-2' ''').fetchone()
                c.execute('INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)',
                          (other['id'], 'materials-voice', 'Otra cuenta'))
                foreign = _job(c, other['id'], other['google_subject'],
                               'live-project-2', 'materials-voice', 'other-folder',
                               'Información privada de otra cuenta.')
            with db.connect() as c:
                c.execute("UPDATE product_material_jobs SET status='queued' WHERE id=%s",
                          (own,))
            handoff_state = work_state(db, settings, fake.opened[0],
                bound['sessionId'], digest(account[3]), handoff['requestId'])
            assert handoff_state['status'] == 'success'
            assert handoff_state['statusScope'] == 'conversation_handoff'
            work = _current_work(db, fake.opened[0], settings,
                                 bound['sessionId'], digest(account[3]))
            assert work['materialAnalysis']['status'] == 'queued'
            assert 'observations' not in work['materialAnalysis']
            with db.connect() as c:
                c.execute("UPDATE product_material_jobs SET status='ready' WHERE id=%s",
                          (own,))
            work = _current_work(db, fake.opened[0], settings,
                                 bound['sessionId'], digest(account[3]))
            assert work['materialAnalysis']['turnId'] == turn_id
            assert work['materialAnalysis']['status'] == 'ready'
            assert work['materialAnalysis']['observations'][0]['summary'] == (
                '120 piezas encontradas.')
            assert 'Información privada' not in str(work)
            with db.connect() as c:
                c.execute('''UPDATE uony_requests SET material_analysis=%s
                    WHERE user_id=%s AND request_id=%s''',
                    (Jsonb({'jobId': str(foreign), 'intakeId': None}),
                     account[0], handoff['requestId']))
            work = _current_work(db, fake.opened[0], settings,
                                 bound['sessionId'], digest(account[3]))
            assert 'materialAnalysis' not in work
            assert 'Información privada' not in str(work)


def test_live_work_reads_saved_product_analysis_only_for_current_goal(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bound = bind(ws, 'product-material-voice')
            turn_id = str(uuid4())
            spoken = 'Analiza la carpeta de Drive llamada Basic Mini Bricks.'
            fake.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], spoken, intent='use_drive_materials')
            handoff = ws.receive_json()
            assert handoff['type'] == 'handoff'
            with db.connect() as c:
                job_id, product_id = _product_job(c, account[0], account[1],
                                                  account[2], handoff['requestId'])
                c.execute('''UPDATE uony_requests SET status='success',reply=%s,
                    material_analysis=%s WHERE user_id=%s AND request_id=%s''',
                    ('He iniciado el análisis.',
                     Jsonb({'jobId': str(job_id), 'intakeId': None}),
                     account[0], handoff['requestId']))
                c.execute('''UPDATE uony_conversation_jobs SET status='success',
                    finished_at=now() WHERE user_id=%s AND request_id=%s''',
                    (account[0], handoff['requestId']))
            def current():
                return _current_work(db, fake.opened[0], settings,
                                     bound['sessionId'], digest(account[3]))

            saved = current()['materialAnalysis']
            assert saved['turnId'] == turn_id
            assert saved['status'] == 'ready' and saved['currentRevision'] is True
            assert saved['folderName'] == 'Materiales Basic'
            assert saved['observations'] == [
                {'source': 'Ficha.txt', 'summary': '120 piezas verificadas.'}]
            assert saved['candidateFacts'] == [{'label': 'Piezas', 'value': '120'}]

            with db.connect() as c:
                c.execute('''UPDATE product_material_jobs SET project_id='otro-proyecto'
                    WHERE id=%s''', (job_id,))
            assert 'materialAnalysis' not in current()
            with db.connect() as c:
                c.execute('''UPDATE product_material_jobs SET project_id=%s,status='error'
                    WHERE id=%s''', (account[2], job_id))
            failure = current()['materialAnalysis']
            assert failure['status'] == 'error' and 'observations' not in failure
            with db.connect() as c:
                c.execute("UPDATE product_material_jobs SET status='ready' WHERE id=%s",
                          (job_id,))

            with db.connect() as c:
                own_goal, other_goal = uuid4(), uuid4()
                for goal_id, label in ((own_goal, 'Basic'), (other_goal, 'Otro')):
                    c.execute('''INSERT INTO uony_assignments
                        (user_id,id,google_subject,origin_request_id,origin_thread_id,
                         label,objective,product_id)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',
                        (account[0], goal_id, account[1], uuid4(),
                         'product-material-voice', label, 'Preparar ' + label,
                         product_id if goal_id == own_goal else None))
                c.execute('''INSERT INTO uony_assignment_focus
                    (user_id,thread_id,google_subject,assignment_id)
                    VALUES(%s,%s,%s,%s)''',
                    (account[0], 'product-material-voice', account[1], own_goal))
                c.execute('''INSERT INTO uony_assignment_material_jobs
                    (user_id,assignment_id,google_subject,product_id,intake_id,
                     material_job_id,origin_request_id)
                    VALUES(%s,%s,%s,%s,NULL,%s,%s)''',
                    (account[0], own_goal, account[1], product_id, job_id,
                     handoff['requestId']))
            assert current()['materialAnalysis']['status'] == 'ready'

            with db.connect() as c:
                c.execute('''UPDATE uony_assignment_focus SET assignment_id=%s,
                    previous_assignment_id=%s,version=version+1
                    WHERE user_id=%s AND thread_id=%s''',
                    (other_goal, own_goal, account[0], 'product-material-voice'))
            assert 'materialAnalysis' not in current()

            with db.connect() as c:
                c.execute('''UPDATE uony_assignment_focus SET assignment_id=%s,
                    previous_assignment_id=%s,version=version+1
                    WHERE user_id=%s AND thread_id=%s''',
                    (own_goal, other_goal, account[0], 'product-material-voice'))
                c.execute('''UPDATE products SET revision=2 WHERE user_id=%s AND id=%s''',
                          (account[0], product_id))
            stale = current()['materialAnalysis']
            assert stale['status'] == 'ready' and stale['currentRevision'] is False
            assert 'observations' not in stale

            with db.connect() as c:
                c.execute('''UPDATE products SET deleted_at=now()
                    WHERE user_id=%s AND id=%s''', (account[0], product_id))
            assert 'materialAnalysis' not in current()
