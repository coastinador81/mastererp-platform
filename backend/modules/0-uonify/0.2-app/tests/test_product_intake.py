"""Metadata-only preparation with account/thread boundaries and replay protection."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.google_cloud_provider import CloudError
from app.google_drive_provider import FOLDER
from app.product_intake import IntakeTools, ProductIntake
from app.product_intake_routes import ProductRequest
from conftest import client_for, login
from test_google_drive import Drive, connect
from test_uony import ready

BASE = '/api/uony/product-intakes'


class MetadataDrive(Drive):
    def __init__(self):
        super().__init__()
        self.metadata_calls = []

    def metadata(self, token, identifier):
        self.metadata_calls.append(identifier)
        if identifier == 'denied':
            raise CloudError('permission_denied')
        if identifier == 'unavailable':
            raise CloudError('google_unavailable')
        if identifier == 'reauthorize':
            raise CloudError('reauthorize')
        return {'id': identifier, 'name': 'Basic Mini Bricks',
                'mimeType': 'text/plain' if identifier == 'file' else FOLDER,
                'trashed': identifier == 'trashed'}

    def files(self, *args, **kwargs):
        raise AssertionError('Intake must not enumerate or analyze a folder')

    def content(self, *args, **kwargs):
        raise AssertionError('Intake must not download documents')

    def upload(self, *args, **kwargs):
        raise AssertionError('Intake must not modify Drive')


def intake(db, thread_id='intake-thread', origin_id=None, subject='google-test-one'):
    with db.connect() as c:
        user = c.execute('SELECT * FROM users WHERE google_subject=%s', (subject,)).fetchone()
        c.execute('''INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,'Crear un producto')
            ON CONFLICT(user_id,id) DO NOTHING''', (user['id'], thread_id))
        tools = IntakeTools(db, user, thread_id, origin_id or uuid4())
        assert tools.prepare({})['prepared']
        reference = tools.commit(c, user)
        assert tools.present() == reference
        return reference


def folder(client, reference, identifier='folder', thread_id='intake-thread', request_id=None):
    return client.post(BASE + '/' + reference['id'] + '/folder', json={
        'threadId': thread_id, 'revision': reference['revision'], 'folderId': identifier,
        'requestId': request_id or str(uuid4())})


def product(client, reference, name='Basic Mini Bricks', thread_id='intake-thread', request_id=None):
    return client.post(BASE + '/' + reference['id'] + '/product', json={
        'threadId': thread_id, 'revision': reference['revision'], 'name': name,
        'requestId': request_id or str(uuid4())})


def state(client, reference, thread_id='intake-thread'):
    return client.get(BASE + '/' + reference['id'], params={'threadId': thread_id})


def test_intake_prepares_without_name_sku_ai_or_product_and_recovers(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        initial = state(client, reference)
        assert initial.status_code == 200, initial.text
        assert initial.json()['status'] == 'selecting'
        assert client.get('/api/products').json() == {'products': []}
        assert drive.metadata_calls == []
        selected = folder(client, reference)
        assert selected.status_code == 200, selected.text
        result = selected.json()
        assert result['status'] == 'identified' and result['revision'] == 2
        assert result['folder'] == {'id': 'folder', 'name': 'Basic Mini Bricks'}
        assert result['confirmationForm']['fields'][0]['value'] == 'Basic Mini Bricks'
        assert result['suggestedName'] == 'Basic Mini Bricks'
        assert state(client, reference).json() == result
        assert drive.metadata_calls == ['folder']
        assert client.get('/api/products').json() == {'products': []}
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_calls').fetchone()['n'] == 0


def test_tool_prepare_is_strict_and_commit_reuses_only_active_intake(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        first = intake(db)
        assert intake(db) == first
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            tools = IntakeTools(db, user, 'intake-thread', uuid4())
            assert tools.prepare({'sku': 'NOT-NEEDED'})['error'] == 'invalid_tool'
            assert tools.prepare([])['error'] == 'invalid_tool'
            assert tools.commit(c, user) is None
        identified = folder(client, first).json()
        linked = product(client, identified).json()
        second = intake(db)
        assert second['id'] != first['id']
        assert state(client, second).json()['status'] == 'selecting'
        assert linked['product']['sku'].startswith('UON-')


def test_get_recovers_saved_intake_without_drive_and_mutations_require_connection(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        reference = intake(db)
        assert state(client, reference).status_code == 200
        missing = folder(client, reference)
        assert missing.status_code == 409 and missing.json()['error'] == 'not_connected'
        assert missing.json()['connectionActions'] == [{'provider': 'drive', 'action': 'manage'}]
        connect(client, drive)
        identified = folder(client, reference).json()
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET status='reauthorize'")
        assert state(client, reference).json() == identified
        assert product(client, identified).json()['error'] == 'reauthorize'
        connect(client, drive)
        assert product(client, identified).json()['status'] == 'linked'
        assert drive.metadata_calls == ['folder']


def test_provider_revocation_persists_reconnection_state_without_losing_intake(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        response = folder(client, reference, identifier='reauthorize')
        assert response.status_code == 409
        assert response.json()['connectionActions'] == [{'provider': 'drive', 'action': 'manage'}]
        assert client.get('/api/connections/google-drive').json()['connection']['status'] == 'reauthorize'
        assert state(client, reference).json()['status'] == 'selecting'
        connect(client, drive)
        assert folder(client, reference).json()['status'] == 'identified'


def test_old_provider_error_does_not_revoke_a_replaced_connection(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        original = drive.metadata

        def replaced(token, identifier):
            with db.connect() as c:
                c.execute("UPDATE google_drive_connections SET refresh_encrypted='new-fixture-credential',status='connected'")
            raise CloudError('reauthorize')

        drive.metadata = replaced
        assert folder(client, reference).status_code == 409
        assert client.get('/api/connections/google-drive').json()['connection']['status'] == 'connected'
        assert state(client, reference).json()['status'] == 'selecting'
        drive.metadata = original


def test_confirm_creates_one_product_and_replay_does_not_repeat_or_analyze(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        folder_id = str(uuid4())
        selected = folder(client, reference, request_id=folder_id)
        assert folder(client, reference, request_id=folder_id).json() == selected.json()
        assert drive.metadata_calls == ['folder']
        assert folder(client, reference, identifier='other', request_id=folder_id).status_code == 409
        request_id = str(uuid4())
        result = product(client, selected.json(), request_id=request_id)
        assert result.status_code == 200, result.text
        data = result.json()
        assert data['status'] == 'linked' and data['revision'] == 3
        assert data['productChanges'][0]['previousSku'] is None
        saved = client.get('/api/products').json()['products']
        assert len(saved) == 1 and saved[0]['name'] == 'Basic Mini Bricks'
        assert data['product'] == {'sku': saved[0]['sku'], 'revision': 1}
        memory = client.get('/api/uony/threads/intake-thread/product-memory').json()['productMemory']
        assert memory['product']['sku'] == saved[0]['sku'] and memory['product']['linkVersion'] == 1
        repeated = product(client, selected.json(), request_id=request_id)
        assert repeated.status_code == 200
        assert repeated.json() == data
        assert product(client, selected.json(), name='Different', request_id=request_id).status_code == 409
        assert product(client, selected.json()).status_code == 409
        assert client.get('/api/products').json()['products'] == saved
        assert drive.metadata_calls == ['folder']
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_revisions').fetchone()['n'] == 1


def test_folder_selection_reuses_existing_product_and_job_without_changing_it(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        saved = client.post('/api/products', json={'name': 'Confirmed Basic', 'sku': 'BMB-EXISTING',
            'customFields': [{'id': 'weight', 'name': 'Peso', 'value': '500 g', 'isConfirmed': True}]}).json()['product']
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'folder','ready',%s)''',
                (uuid4(), user['id'], saved['id'], uuid4(), user['google_subject'],
                 Jsonb({'sources': [{'id': 'evidence', 'status': 'analyzed'}], 'usage': {'calls': 95}})))
        selected = folder(client, intake(db)).json()
        assert selected['status'] == 'linked'
        assert selected['product'] == {'sku': 'BMB-EXISTING', 'revision': 1}
        assert client.get('/api/uony/threads/intake-thread/product-memory').json()['productMemory']['product']['sku'] == 'BMB-EXISTING'
        assert client.get('/api/products').json()['products'] == [saved]
        assert drive.metadata_calls == ['folder']
        with db.connect() as c:
            jobs = c.execute('SELECT result FROM product_material_jobs').fetchall()
            assert len(jobs) == 1 and jobs[0]['result']['usage']['calls'] == 95


def test_linked_folder_is_reused_across_threads_without_duplicate(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        first = folder(client, intake(db)).json()
        original = product(client, first).json()
        second = folder(client, intake(db, 'second'), thread_id='second').json()
        assert second['status'] == 'linked' and second['product'] == original['product']
        assert len(client.get('/api/products').json()['products']) == 1


def test_concurrent_confirmation_of_same_folder_creates_one_product(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        references = [folder(client, intake(db, name), thread_id=name).json() for name in ('one', 'two')]
        service = ProductIntake(config, db, drive)

        def confirm(reference):
            with db.connect() as c:
                user = c.execute('SELECT * FROM users').fetchone()
                body = ProductRequest(threadId=reference['threadId'], revision=2, requestId=uuid4(), name='Basic')
                return service.create_product(c, user, reference['id'], body)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(confirm, references))
        assert results[0]['product'] == results[1]['product']
        assert len(client.get('/api/products').json()['products']) == 1
        assert drive.metadata_calls == ['folder', 'folder']


@pytest.mark.parametrize('identifier,code', [('file', 'invalid_folder'), ('trashed', 'invalid_folder'),
    ('denied', 'permission_denied'), ('unavailable', 'google_unavailable'), ('reauthorize', 'reauthorize')])
def test_failed_metadata_does_not_change_selection_or_create_product(environment, identifier, code):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        response = folder(client, reference, identifier)
        assert response.status_code in (409, 503) and response.json()['error'] == code
        assert state(client, reference).json()['status'] == 'selecting'
        assert client.get('/api/products').json() == {'products': []}


def test_session_origin_thread_revision_access_and_identity_boundaries(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        assert client.get(BASE + '/' + str(uuid4()), params={'threadId': 'own'}).status_code == 401
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        body = {'threadId': 'intake-thread', 'revision': 1, 'requestId': str(uuid4()), 'folderId': 'folder'}
        assert client.post(BASE + '/' + reference['id'] + '/folder', json=body, headers={'Origin': 'null'}).status_code == 403
        intake(db, 'other-thread')
        assert state(client, reference, 'other-thread').status_code == 404
        assert folder(client, {**reference, 'revision': 4}).status_code == 409
        assert client.get(BASE + '/' + reference['id']).status_code == 400
        assert product(client, reference).json()['error'] == 'intake_folder_required'
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET status='reauthorize'")
        assert folder(client, reference).json()['error'] == 'reauthorize'
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET status='connected',google_subject='foreign'")
        assert folder(client, reference).status_code == 409
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET google_subject='google-test-one'")
        google.subject = 'other-user'
        google.email = 'other@example.test'
        login(client, google)
        assert state(client, reference).status_code == 403
        google.subject = 'google-test-one'
        google.email = 'one@example.test'
        login(client, google)
        with db.connect() as c:
            c.execute('UPDATE access_periods SET ends_at=now()')
        assert folder(client, reference).status_code == 403
        assert drive.metadata_calls == []


def test_deleted_thread_scrubs_intakes_and_requests_without_removing_product(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = intake(db)
        product(client, folder(client, reference).json())
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,reply,status,model,project_id,product_intake)
                VALUES(%s,%s,'intake-thread','request','reply','success','fixture','fixture',%s)''',
                (user['id'], uuid4(), Jsonb(reference)))
        assert client.delete('/api/uony/threads/intake-thread').status_code == 200
        assert state(client, reference).status_code == 410
        assert len(client.get('/api/products').json()['products']) == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_product_intakes').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_product_intake_requests').fetchone()['n'] == 0
            assert c.execute('SELECT product_intake FROM uony_requests').fetchone()['product_intake'] is None


def test_deleted_product_cannot_be_resurrected_by_intake_replay(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        reference = folder(client, intake(db)).json()
        request_id = str(uuid4())
        linked = product(client, reference, request_id=request_id).json()
        assert client.delete('/api/products/' + linked['product']['sku']).status_code == 200
        assert state(client, reference).status_code == 410
        assert product(client, reference, request_id=request_id).status_code == 410
        assert client.get('/api/products').json() == {'products': []}


def test_account_purge_removes_private_intake_graph(environment):
    config, google, db = environment
    drive = MetadataDrive()
    from app.account_deletion_data import purge
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        product(client, folder(client, intake(db)).json())
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            purge(c, user, None)
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_product_intakes').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM uony_product_intake_requests').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM users').fetchone()['n'] == 0


def test_two_entitled_accounts_with_same_folder_identifier_do_not_share_products_or_intakes(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        owned = intake(db)
        first = product(client, folder(client, owned).json()).json()
        google.subject, google.email = 'second-account', 'second@example.test'
        drive.subject = google.subject
        ready(client, google, db)
        connect(client, drive)
        # Both accounts own a thread with the same identifier; ownership of
        # that local identifier never grants access to the other intake UUID.
        other = intake(db, subject=google.subject)
        assert state(client, owned).status_code == 404
        assert folder(client, owned).status_code == 404
        assert product(client, owned).status_code == 404
        identified = folder(client, other).json()
        assert identified['status'] == 'identified' and 'product' not in identified
        second = product(client, identified).json()
        assert second['product']['sku'] != first['product']['sku']
        own_products = client.get('/api/products').json()['products']
        assert len(own_products) == 1 and own_products[0]['sku'] == second['product']['sku']


def test_ambiguous_existing_folder_requires_identification_and_does_not_guess(environment):
    config, google, db = environment
    drive = MetadataDrive()
    with client_for(config, google, drive=drive) as client:
        ready(client, google, db)
        connect(client, drive)
        for index in (1, 2):
            saved = client.post('/api/products', json={'name': 'Variant ' + str(index), 'sku': 'BMB-' + str(index)}).json()['product']
            with db.connect() as c:
                user = c.execute('SELECT * FROM users').fetchone()
                c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,revision,folder_id,status)
                    VALUES(%s,%s,%s,%s,%s,1,'folder','ready')''',
                    (uuid4(), user['id'], saved['id'], uuid4(), user['google_subject']))
        reference = intake(db)
        response = folder(client, reference)
        assert response.status_code == 409 and response.json()['error'] == 'intake_product_ambiguous'
        assert len(response.json()['productChoices']) == 2
        assert state(client, reference).json()['status'] == 'selecting'
        assert len(client.get('/api/products').json()['products']) == 2
