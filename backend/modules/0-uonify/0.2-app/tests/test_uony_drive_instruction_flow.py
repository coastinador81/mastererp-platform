"""Customer speech/text can authorize only its exact, bounded Drive action."""
from uuid import uuid4

from app.google_drive_provider import FOLDER
from app.google_cloud_provider import CloudError
from conftest import client_for
from test_google_cloud import Cloud
from test_product_materials import FolderDrive, connect_drive
from test_products import connect as connect_cloud
from test_uony import ready


class Drive(FolderDrive):
    def __init__(self):
        super().__init__()
        self.lookups = []
        self.probes = 0
        self.counts = 0

    def probe_access(self, token):
        self.probes += 1
        return True

    def count_folders(self, token):
        self.counts += 1
        return 3

    def files(self, token, parent='root', page=None, search=''):
        self.lookups.append((parent, search))
        if search:
            return {'files': [{'id': 'folder', 'name': 'Basic Mini Bricks',
                               'mimeType': FOLDER}], 'nextPageToken': None}
        if parent == 'root':
            return {'files': [], 'nextPageToken': None}
        return super().files(token, parent, page, search)

    def metadata(self, token, identifier):
        if identifier == 'folder':
            return {'id': 'folder', 'name': 'Basic Mini Bricks', 'mimeType': FOLDER}
        return super().metadata(token, identifier)


class NoModel:
    def __init__(self):
        self.calls = 0

    def generate(self, *args, **kwargs):
        self.calls += 1
        return 'No se usó Drive.', {'calls': 1, 'totalTokenCount': 10}


class FalseAccessClaim(NoModel):
    def generate(self, *args, **kwargs):
        self.calls += 1
        answer = ('Ya puedo consultar tu Drive. ¿Qué quieres que busque o analice?'
                  if self.calls == 1 else 'No he contado las carpetas.')
        return answer, {'calls': 1, 'totalTokenCount': 10}


def _message(client, text, *, request_id=None, thread_id='drive-orders'):
    return client.post('/api/uony/messages', json={
        'requestId': request_id or str(uuid4()), 'threadId': thread_id,
        'text': text, 'model': 'gemini-3.5-flash', 'effort': 'medium'})


def test_folder_count_follows_verified_access_in_same_thread_only(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        access = _message(client, '¿Tienes acceso a mi Drive?', thread_id='drive-count')
        assert access.status_code == 200 and 'Ya puedo consultar' in access.json()['reply']
        count = _message(client, 'Necesito que me digas cuántas carpetas hay',
                         thread_id='drive-count')
        assert count.status_code == 200 and '3 carpetas visibles' in count.json()['reply']
        assert drive.probes == 1 and drive.counts == 1
        assert drive.lookups == [] and drive.reads == [] and model.calls == 0
        unrelated = _message(client, 'Necesito que me digas cuántas carpetas hay',
                             thread_id='unrelated-count')
        assert unrelated.status_code == 200 and '3 carpetas' not in unrelated.json()['reply']
        assert drive.counts == 1
        topic_change = _message(client, 'Hablemos de otra cosa.', thread_id='drive-count')
        assert topic_change.status_code == 200
        after_change = _message(client, 'Necesito que me digas cuántas carpetas hay',
                                thread_id='drive-count')
        assert after_change.status_code == 200
        assert '3 carpetas visibles' not in after_change.json()['reply']
        assert drive.counts == 1


def test_user_drive_topic_allows_immediate_count_without_previous_probe(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        topic = _message(client, 'Hablemos de Drive.', thread_id='drive-topic')
        assert topic.status_code == 200 and topic.json()['reply'] == 'No se usó Drive.'
        count = _message(client, '¿Cuántas carpetas hay?', thread_id='drive-topic')
        assert count.status_code == 200 and '3 carpetas visibles' in count.json()['reply']
        assert drive.probes == 0 and drive.counts == 1 and model.calls == 1


def test_model_access_claim_does_not_supply_drive_context(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), FalseAccessClaim()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        claim = _message(client, 'Hola, dime algo breve.', thread_id='false-access')
        assert claim.status_code == 200
        assert claim.json()['reply'] == ('Ya puedo consultar tu Drive. '
                                         '¿Qué quieres que busque o analice?')
        count = _message(client, '¿Cuántas carpetas hay?', thread_id='false-access')
        assert count.status_code == 200
        assert count.json()['reply'] == 'No he contado las carpetas.'
        assert drive.probes == 0 and drive.counts == 0 and model.calls == 2


def test_written_count_order_uses_drive_worker_once_without_reading_documents(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        request_id = str(uuid4())
        text = 'Cuenta cuántas carpetas hay en mi Drive.'
        response = _message(client, text, request_id=request_id,
                            thread_id='written-drive-count')
        assert response.status_code == 200, response.text
        assert '3 carpetas visibles' in response.json()['reply']
        assert _message(client, text, request_id=request_id,
                        thread_id='written-drive-count').json()['reply'] == response.json()['reply']
        assert drive.counts == 1 and drive.probes == 0
        assert drive.lookups == [] and drive.reads == [] and model.calls == 0
        with db.connect() as c:
            saved = c.execute('''SELECT prompt,reply,status FROM uony_requests
                WHERE request_id=%s''', (request_id,)).fetchone()
            assert saved['prompt'] == text and saved['reply'] == response.json()['reply']
            assert saved['status'] == 'success'
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 0


def test_explicit_drive_count_reports_incomplete_result_without_guessing(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    def incomplete(_token):
        raise CloudError('incomplete_search')
    drive.count_folders = incomplete
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        response = _message(client, '¿Cuántas carpetas hay en mi Drive?',
                            thread_id='count-incomplete')
        assert response.status_code == 200
        assert 'No puedo confirmar un total exacto' in response.json()['reply']
        assert drive.reads == [] and drive.lookups == [] and model.calls == 0


def test_access_search_and_direct_analysis_without_product_or_second_click(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)

        access = _message(client, 'Ve a Drive y avísame cuando estés allí')
        assert access.status_code == 200, access.text
        assert 'Ya puedo consultar' in access.json()['reply']
        assert access.json().get('materialAnalysis') is None
        assert drive.probes == 1 and drive.lookups == []

        search = _message(client, 'Busca la carpeta Basic Mini Bricks en Drive')
        assert search.status_code == 200, search.text
        assert 'Encontré la carpeta' in search.json()['reply']
        assert search.json().get('materialAnalysis') is None

        request_id = str(uuid4())
        ordered = _message(client, 'Analiza la carpeta Basic Mini Bricks en Drive',
                           request_id=request_id)
        assert ordered.status_code == 200, ordered.text
        job_id = ordered.json()['materialAnalysis']['jobId']
        assert ordered.json()['materialAnalysis']['intakeId']
        assert ordered.json().get('conversationForm') is None
        assert 'analizando' not in ordered.json()['reply'].casefold() or 'curso' in ordered.json()['reply']
        assert model.calls == 0
        assert drive.reads == []  # The queued worker has not read documents yet.
        assert _message(client, 'Analiza la carpeta Basic Mini Bricks en Drive',
                        request_id=request_id).json()['materialAnalysis']['jobId'] == job_id
        saved = client.get(f'/api/uony/materials/jobs/{job_id}')
        assert saved.status_code == 200 and saved.json()['job']['sku'] is None
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 1
            receipt = c.execute('''SELECT source,conversation_thread_id,instruction_text
                FROM product_material_job_authorizations WHERE job_id=%s''', (job_id,)).fetchone()
            assert receipt == {'source': 'chat_instruction',
                               'conversation_thread_id': 'drive-orders',
                               'instruction_text': 'Analiza la carpeta Basic Mini Bricks en Drive'}


def test_natural_access_questions_probe_drive_root_without_starting_work(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        for index, text in enumerate((
            'Necesito saber si puedes tener acceso a mi Drive',
            '¿Puedes entrar en mi cuenta de Drive?',
            'Dime si tienes acceso a mi Drive',
        ), 1):
            response = _message(client, text)
            assert response.status_code == 200, response.text
            assert 'Ya puedo consultar tu Drive' in response.json()['reply']
            assert response.json().get('materialAnalysis') is None
            assert drive.probes == index and drive.lookups == []
        assert model.calls == 0 and drive.reads == []
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 0


def test_unspecified_folder_asks_in_chat_without_analysis(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        answer = _message(client, 'Analiza una carpeta de Drive')
        assert answer.status_code == 200, answer.text
        assert '¿Qué carpeta' in answer.json()['reply']
        assert answer.json().get('conversationForm') is None
        assert answer.json().get('materialAnalysis') is None
        assert drive.reads == [] and model.calls == 0
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 0


def test_question_and_deferred_order_never_start_analysis(environment):
    config, google, db = environment
    drive, cloud, model = Drive(), Cloud(), NoModel()
    with client_for(config, google, drive=drive, cloud=cloud, uony=model) as client:
        ready(client, google, db)
        connect_cloud(db, config)
        connect_drive(db, config)
        for text in (
            '¿Es posible analizar la carpeta Basic Mini Bricks en Drive?',
            'Analiza la carpeta Basic Mini Bricks en Drive mañana.',
            'Analiza la carpeta Basic Mini Bricks en Drive, pero primero dime el precio.',
        ):
            response = _message(client, text)
            assert response.status_code == 200, response.text
            assert response.json().get('materialAnalysis') is None
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) AS n FROM product_material_job_authorizations').fetchone()['n'] == 0
