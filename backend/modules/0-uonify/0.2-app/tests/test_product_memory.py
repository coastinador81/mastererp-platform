"""Explicit cross-thread product memory, with current facts and scoped provenance."""
from uuid import uuid4
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from app.blender_tools import BusinessTools
from app.product_materials_review import custom_id
from app.uony_context import ContextRequest, conversation_context
from app.uony_provider import request_payload
from conftest import client_for
from test_google_cloud import Cloud
from test_uony import ready


def message(thread, sku, revision, version=0, request_id=None):
    return {'requestId': request_id or str(uuid4()), 'threadId': thread,
            'text': 'Continuar el producto elegido',
            'productAction': {'action': 'link', 'sku': sku,
                              'revision': revision, 'expectedVersion': version}}


def _product(client, sku='BASIC', name='Basic Mini Bricks', fields=None):
    response = client.post('/api/products', json={'sku': sku, 'name': name,
        **({'customFields': fields} if fields is not None else {})})
    assert response.status_code == 200, response.text
    return response.json()['product']


def test_explicit_link_persists_across_threads_and_editor_context_does_not_bind(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        product = _product(client, fields=[
            {'id': 'weight', 'name': 'Peso confirmado', 'value': '500 g',
             'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []},
            {'id': 'pvpr', 'name': 'PVPR', 'value': '19,90 €',
             'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []},
            {'id': 'audience', 'name': 'Público', 'value': 'Adultos y familias',
             'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []},
            {'id': 'hazmat', 'name': 'Mercancías peligrosas', 'value': 'No aplicable',
             'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}])
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            # The editor may attach productContext to an unrelated new thread.
            body = ContextRequest(threadId='fresh', text='Hola',
                                  productContext={'sku': product['sku'], 'revision': 1})
            _, status, _ = conversation_context(c, user, body, db, {})
            assert status['productContext'] == {'sku': product['sku'], 'revision': 1}
            assert 'productMemory' not in status
            assert c.execute('SELECT count(*) n FROM uony_thread_products').fetchone()['n'] == 0
        mixed = message('invalid-mixed', product['sku'], 1)
        mixed['productContext'] = {'sku': product['sku'], 'revision': 1}
        assert client.post('/api/uony/messages', json=mixed).status_code == 422
        first = message('thread-a', product['sku'], 1)
        response = client.post('/api/uony/messages', json=first)
        assert response.status_code == 200, response.text
        assert response.json()['model'] == 'uonify-guide'
        assert client.post('/api/uony/messages', json=first).json() == response.json()
        memory = client.get('/api/uony/threads/thread-a/product-memory').json()['productMemory']
        assert memory['product'] == {'sku': 'BASIC', 'name': 'Basic Mini Bricks',
                                     'revision': 1, 'linkVersion': 1}
        assert {fact['value'] for fact in memory['confirmedFacts']} == {
            '500 g', '19,90 €', 'Adultos y familias', 'No aplicable'}
        assert all(fact['freshness'] == 'saved_product_revision'
                   for fact in memory['confirmedFacts'])
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            _, status, _ = conversation_context(c, user, ContextRequest(
                threadId='thread-a', text='Tengo otra carpeta de este producto'), db, {})
            refusal = status.call('show_product_intake', {})
            assert refusal['error'] == 'product_already_identified'
            assert 'show_product_materials' in refusal['message']
            assert c.execute('SELECT count(*) n FROM uony_product_intakes').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM products').fetchone()['n'] == 1
        _product(client, 'OTHER', 'Otra ficha')
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            _, status, _ = conversation_context(c, user, ContextRequest(
                threadId='thread-a', text='¿Qué peso tiene?',
                productContext={'sku': 'OTHER', 'revision': 1}), db, {})
            assert status['productContext'] == {'sku': 'BASIC', 'revision': 1}
            assert status['productMemory']['product']['sku'] == 'BASIC'
        assert client.delete('/api/products/OTHER').status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            _, status, _ = conversation_context(c, user, ContextRequest(
                threadId='thread-a', text='¿Qué peso tiene?',
                productContext={'sku': 'OTHER', 'revision': 1}), db, {})
            assert status['productContext'] == {'sku': 'BASIC', 'revision': 1}
            assert status['productMemory']['product']['sku'] == 'BASIC'
        assert client.post('/api/uony/messages', json=message('thread-b', 'BASIC', 1)).status_code == 200
        assert client.get('/api/uony/threads/thread-b/product-memory').json()['productMemory']['confirmedFacts'] == memory['confirmedFacts']
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM product_material_jobs').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_material_calls').fetchone()['n'] == 0
            assert c.execute("SELECT revision FROM products WHERE sku='BASIC'").fetchone()['revision'] == 1
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            _, status, _ = conversation_context(c, user, ContextRequest(threadId='thread-b'), db, {})
            assert status['productContext'] == {'sku': 'BASIC', 'revision': 1}
            assert status['productMemory']['confirmedFacts'][0]['value'] == '500 g'


def test_revision_conflict_switch_delete_and_account_isolation(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        first, second = _product(client), _product(client, 'OTHER', 'Otra ficha')
        assert client.post('/api/uony/messages', json=message('select', first['sku'], 9)).status_code == 409
        assert client.get('/api/uony/threads').json()['threads'] == []
        assert client.post('/api/uony/messages', json=message('select', first['sku'], 1)).status_code == 200
        assert client.post('/api/uony/messages', json=message('select', second['sku'], 1)).status_code == 409
        assert client.post('/api/uony/messages', json=message('select', second['sku'], 1, 1)).status_code == 200
        assert client.get('/api/uony/threads/select/product-memory').json()['productMemory']['product']['linkVersion'] == 2
        edited = client.patch('/api/products/OTHER', json={'revision': 1, 'name': 'Otra ficha actualizada'})
        assert edited.status_code == 200
        memory = client.get('/api/uony/threads/select/product-memory').json()['productMemory']
        assert memory['product']['name'] == 'Otra ficha actualizada' and memory['product']['revision'] == 2
        assert memory['product']['linkVersion'] == 2
        assert client.post('/api/uony/messages', json=message('select', 'OTHER', 1, 2)).status_code == 409
        assert client.delete('/api/products/OTHER').status_code == 200
        assert client.get('/api/uony/threads/select/product-memory').json()['productMemory'] is None
        assert client.post('/api/uony/messages', json=message('select', 'OTHER', 2)).status_code == 404
        google.subject = 'second'; google.email = 'second@example.test'
        ready(client, google, db)
        assert client.get('/api/uony/threads/select/product-memory').status_code == 404
        assert client.post('/api/uony/messages', json=message('other-thread', 'BASIC', 1)).status_code == 404


def test_switch_cuts_previous_product_facts_from_model_history(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _product(client, fields=[{'id': 'weight', 'name': 'Peso', 'value': '500 g',
            'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}])
        _product(client, 'OTHER', 'Otra ficha', fields=[{'id': 'weight', 'name': 'Peso',
            'value': '600 g', 'isConfirmed': True, 'source': 'Cliente',
            'type': 'text', 'options': []}])
        assert client.post('/api/uony/messages', json=message('changing', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            c.execute('''INSERT INTO uony_requests
                (user_id,request_id,thread_id,prompt,reply,status,model,project_id)
                VALUES(%s,%s,'changing','El Basic pesa 500 g','Confirmado: 500 g',
                       'success','test','fixture')''', (user['id'], uuid4()))
        assert client.post('/api/uony/messages', json=message('changing', 'OTHER', 1, 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            history, status, _ = conversation_context(c, user, ContextRequest(
                threadId='changing', text='¿Qué peso tiene?'), db, {})
            payload = request_payload(history, status)
            assert '500 g' not in str(payload)
            assert '600 g' in str(payload)
            assert status['productMemory']['product']['sku'] == 'OTHER'


def test_deleted_product_history_remains_visible_but_never_reenters_model(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _product(client, fields=[{'id': 'weight', 'name': 'Peso', 'value': '500 g',
            'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}])
        assert client.post('/api/uony/messages', json=message('deleted-facts', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO uony_requests
                (user_id,request_id,thread_id,prompt,reply,status,model,project_id)
                VALUES(%s,%s,'deleted-facts','El Basic pesa 500 g','Sí, 500 g',
                       'success','test','fixture')''', (user['id'], uuid4()))
        assert client.delete('/api/products/BASIC').status_code == 200
        visible = client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert any('500 g' in item['text'] for item in visible)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            history, status, _ = conversation_context(c, user, ContextRequest(
                threadId='deleted-facts', text='Hablemos de otra cosa'), db, {})
            assert 'productMemory' not in status
            assert '500 g' not in str(request_payload(history, status))


def test_subject_mismatch_and_thread_deletion_remove_memory(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _product(client)
        assert client.post('/api/uony/messages', json=message('subject', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            c.execute("UPDATE uony_thread_products SET google_subject='revoked' WHERE thread_id='subject'")
        assert client.get('/api/uony/threads/subject/product-memory').json()['productMemory'] is None
        assert client.post('/api/uony/messages', json=message('subject', 'BASIC', 1, 1)).status_code == 409
        with db.connect() as c:
            c.execute("UPDATE uony_thread_products SET google_subject='google-test-one' WHERE thread_id='subject'")
        assert client.delete('/api/uony/threads/subject').status_code == 200
        assert client.get('/api/uony/threads/subject/product-memory').status_code == 410
        with db.connect() as c:
            assert c.execute("SELECT count(*) n FROM uony_thread_products WHERE thread_id='subject'").fetchone()['n'] == 0


def test_pending_intake_does_not_promote_editor_or_old_product(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _product(client)
        _product(client, 'OTHER', 'Otra ficha')
        assert client.post('/api/uony/messages', json=message('intake-pending', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            c.execute('''INSERT INTO uony_product_intakes
                (user_id,id,thread_id,google_subject,origin_request_id)
                VALUES(%s,%s,'intake-pending',%s,%s)''',
                (user['id'], uuid4(), google.subject, uuid4()))
            _, status, _ = conversation_context(c, user, ContextRequest(
                threadId='intake-pending', text='Aquí están mis archivos',
                productContext={'sku': 'OTHER', 'revision': 1}), db, {})
            assert status['productContext'] is None
            assert 'productMemory' not in status
            assert status['productIntake']['status'] == 'selecting'
        assert client.get('/api/uony/threads/intake-pending/product-memory').json()['productMemory']['product']['sku'] == 'BASIC'


def test_explicit_product_choice_invalidates_old_intake_card(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _product(client)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'old-intake','Archivos')",
                      (user['id'],))
        tools = BusinessTools({}, db, user, None, uuid4(), thread_id='old-intake',
                              user_text='Tengo materiales en Drive')
        assert tools.call('show_product_intake', {})['prepared']
        with db.connect() as c:
            card = tools.intake.commit(c, user)
        assert card['id']
        assert client.post('/api/uony/messages', json=message('old-intake', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            history, status, _ = conversation_context(c, user, ContextRequest(
                threadId='old-intake', text='Continúa esta ficha'), db, {})
            assert status['productMemory']['product']['sku'] == 'BASIC'
            assert status['productContext'] == {'sku': 'BASIC', 'revision': 1}
            assert 'productIntake' not in status
            assert c.execute('SELECT count(*) n FROM uony_product_intakes').fetchone()['n'] == 0
        old = client.get('/api/uony/product-intakes/' + card['id'],
                         params={'threadId': 'old-intake'})
        assert old.status_code == 404
        assert client.post('/api/uony/product-intakes/' + card['id'] + '/folder', json={
            'threadId': 'old-intake', 'requestId': str(uuid4()), 'revision': 1,
            'folderId': 'new-folder'}).status_code == 404
        assert len(client.get('/api/products').json()['products']) == 1


def test_material_sources_are_versioned_and_revocation_does_not_erase_confirmed_value(environment):
    config, google, db = environment
    proposal = {'id': 'fact-weight', 'field': 'custom:peso_producto', 'canonicalField': 'custom:peso_producto',
        'label': 'Peso del producto', 'value': '500 g', 'confirmedValue': '500 g',
        'confirmedField': 'custom:peso_producto', 'scope': 'product', 'channel': 'product',
        'claimType': 'declared', 'status': 'confirmed', 'supportStatus': 'supported',
        'evidence': [{'sourceId': 'doc-weight', 'sourceVersion': 'v1', 'locator': '$.peso',
                      'excerpt': 'Peso 500 gramos'}]}
    field = {'id': custom_id(proposal), 'name': 'Peso del producto', 'value': '500 g',
        'isConfirmed': True, 'source': 'Drive · dato documental revisado',
        'type': 'text', 'options': []}
    with client_for(config, google) as client:
        ready(client, google, db)
        product = _product(client, fields=[field])
        assert client.post('/api/uony/messages', json=message('material', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            c.execute('''INSERT INTO google_drive_connections(user_id,google_subject,email,refresh_encrypted,scope)
                VALUES(%s,%s,%s,'test-only','drive.readonly')''', (user['id'], google.subject, google.email))
            job_id = uuid4()
            c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,
                revision,folder_id,status,result) VALUES(%s,%s,%s,%s,%s,1,'folder','ready',%s)''',
                (job_id, user['id'], product['id'], uuid4(), google.subject,
                 Jsonb({'facts': {'version': 1, 'stale': False, 'proposals': [proposal]}})))
            c.execute('''INSERT INTO product_material_sources(job_id,source_id,version,data)
                VALUES(%s,'doc-weight','v1',%s)''', (job_id, Jsonb({'id': 'doc-weight'})))
        memory = client.get('/api/uony/threads/material/product-memory').json()['productMemory']
        fact = memory['confirmedFacts'][0]
        assert memory['materialState'] == 'saved_sources'
        assert fact['value'] == '500 g' and fact['freshness'] == 'saved_source_version'
        assert fact['sourceRefs'] == [{'sourceId': 'doc-weight', 'version': 'v1', 'locator': '$.peso'}]
        assert 'excerpt' not in str(memory)
        with db.connect() as c:
            c.execute("UPDATE product_material_sources SET version='v2' WHERE job_id=%s", (job_id,))
        memory = client.get('/api/uony/threads/material/product-memory').json()['productMemory']
        assert memory['materialState'] == 'review_required'
        assert memory['confirmedFacts'][0]['value'] == '500 g'
        assert memory['confirmedFacts'][0]['sourceRefs'] == []
        with db.connect() as c:
            c.execute("DELETE FROM product_material_sources WHERE job_id=%s", (job_id,))
        memory = client.get('/api/uony/threads/material/product-memory').json()['productMemory']
        assert memory['materialState'] == 'review_required'
        assert memory['confirmedFacts'][0]['freshness'] == 'source_not_rechecked'
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET status='reauthorize' WHERE user_id=%s", (user['id'],))
        memory = client.get('/api/uony/threads/material/product-memory').json()['productMemory']
        assert memory['materialState'] == 'permission_required'
        assert memory['confirmedFacts'][0]['freshness'] == 'source_not_rechecked'
        changed = client.patch('/api/products/BASIC', json={'revision': 1, 'customFields': [
            {**field, 'value': '600 g'}]})
        assert changed.status_code == 200
        memory = client.get('/api/uony/threads/material/product-memory').json()['productMemory']
        assert memory['product']['revision'] == 2 and memory['confirmedFacts'][0]['value'] == '600 g'
        assert memory['confirmedFacts'][0]['sourceRefs'] == []


def test_natural_link_requires_explicit_intent_unique_search_and_current_read(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        _product(client)
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'natural','Continuar Basic')", (user['id'],))
        tools = BusinessTools({}, db, user, None, uuid4(), thread_id='natural',
                              user_text='continúa Basic Mini Bricks')
        assert tools.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['error'] == 'bounded_search_required'
        assert tools.call('list_products', {'query': 'Basic Mini Bricks'})['products'][0]['sku'] == 'BASIC'
        assert tools.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['error'] == 'read_required'
        assert tools.call('get_product', {'sku': 'BASIC'})['product']['revision'] == 1
        assert tools.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['prepared'] is True
        assert client.get('/api/uony/threads/natural/product-memory').json()['productMemory'] is None
        with db.connect() as c:
            linked = tools.product_link.commit(c, user)
        assert linked['sku'] == 'BASIC' and linked['version'] == 1
        assert client.get('/api/uony/threads/natural/product-memory').json()['productMemory']['product']['sku'] == 'BASIC'
        _product(client, 'OTHER', 'Otra ficha')
        twice = BusinessTools({}, db, user, None, uuid4(), thread_id='natural',
                              user_text='continúa Basic Mini Bricks y Otra ficha')
        twice.call('list_products', {'query': 'Basic Mini Bricks'})
        twice.call('get_product', {'sku': 'BASIC'})
        assert twice.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['prepared']
        twice.call('list_products', {'query': 'Otra ficha'})
        twice.call('get_product', {'sku': 'OTHER'})
        assert twice.call('link_product_to_thread', {'sku': 'OTHER', 'revision': 1})['error'] == 'one_selection'
        switch = BusinessTools({}, db, user, None, uuid4(), thread_id='natural',
                               user_text='continúa Otra ficha')
        assert len(switch.call('list_products', {'query': 'Otra ficha'})['products']) == 1
        switch.call('get_product', {'sku': 'OTHER'})
        assert switch.call('link_product_to_thread', {'sku': 'OTHER', 'revision': 1})['prepared']
        with db.connect() as c:
            changed = switch.product_link.commit(c, user)
        assert changed['sku'] == 'OTHER' and changed['version'] == 2
        assert client.get('/api/uony/threads/natural/product-memory').json()['productMemory']['product']['sku'] == 'OTHER'
        race = BusinessTools({}, db, user, None, uuid4(), thread_id='natural',
                             user_text='continúa Basic Mini Bricks')
        assert len(race.call('list_products', {'query': 'Basic Mini Bricks'})['products']) == 1
        race.call('get_product', {'sku': 'BASIC'})
        assert race.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['prepared']
        _product(client, 'THIRD', 'Tercera ficha')
        assert client.post('/api/uony/messages', json=message('natural', 'THIRD', 1, 2)).status_code == 200
        with pytest.raises(HTTPException) as conflict, db.connect() as c:
            race.product_link.commit(c, user)
        assert conflict.value.status_code == 409
        assert client.get('/api/uony/threads/natural/product-memory').json()['productMemory']['product']['sku'] == 'THIRD'
        _product(client, 'BASIC-BLUE', 'Basic Mini Bricks Azul')
        ambiguous = BusinessTools({}, db, user, None, uuid4(), thread_id='natural',
                                  user_text='continúa Basic Mini Bricks')
        assert len(ambiguous.call('list_products', {'query': 'Basic Mini Bricks'})['products']) == 2
        ambiguous.call('get_product', {'sku': 'BASIC'})
        assert ambiguous.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['error'] == 'product_ambiguous'
        assert ambiguous.product_link.prepared is None
        unasked = BusinessTools({}, db, user, None, uuid4(), thread_id='natural',
                                user_text='compara Basic Mini Bricks')
        unasked.call('list_products', {'query': 'Basic Mini Bricks'})
        unasked.call('get_product', {'sku': 'BASIC'})
        assert unasked.call('link_product_to_thread', {'sku': 'BASIC', 'revision': 1})['error'] == 'link_not_requested'


def test_provider_payload_only_includes_whitelisted_memory_not_document_text():
    memory = {'product': {'sku': 'BASIC', 'name': 'Basic Mini Bricks', 'revision': 2},
              'savedFields': {'price': '19,90', 'private': 'DO_NOT_LEAK'},
              'confirmedFacts': [{'id': 'weight', 'label': 'Peso', 'value': '500 g',
                  'sourceLabel': 'Cliente', 'freshness': 'saved_product_revision',
                  'sourceRefs': [], 'documentText': 'DO_NOT_LEAK'}],
              'materialState': 'none', 'documentText': 'DO_NOT_LEAK'}
    payload = request_payload([], {'productMemory': memory})
    system = payload['systemInstruction']['parts'][0]['text']
    assert 'Basic Mini Bricks' in system and '500 g' in system
    assert 'DO_NOT_LEAK' not in system


def test_queued_and_empty_material_result_never_promote_saved_brand(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        product = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks',
            'brand': 'Marca guardada'}).json()['product']
        assert client.post('/api/uony/messages', json=message('pending', 'BASIC', 1)).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO google_drive_connections(user_id,google_subject,email,refresh_encrypted,scope)
                VALUES(%s,%s,%s,'test-only','drive.readonly')''', (user['id'], google.subject, google.email))
            job_id = uuid4()
            c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,
                revision,folder_id,status,result) VALUES(%s,%s,%s,%s,%s,1,'folder','queued',%s)''',
                (job_id, user['id'], product['id'], uuid4(), google.subject, Jsonb({})))
        memory = client.get('/api/uony/threads/pending/product-memory').json()['productMemory']
        assert memory['materialState'] == 'analysis_pending'
        assert memory['savedFields']['brand'] == 'Marca guardada' and memory['confirmedFacts'] == []
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET status='ready',result=%s WHERE id=%s",
                      (Jsonb({'facts': None}), job_id))
        memory = client.get('/api/uony/threads/pending/product-memory').json()['productMemory']
        assert memory['materialState'] == 'review_required' and memory['confirmedFacts'] == []
        declared_brand = {'id': 'brand-confirmed', 'field': 'brand', 'canonicalField': 'brand',
            'label': 'Marca', 'value': 'Marca guardada', 'confirmedValue': 'Marca guardada',
            'status': 'confirmed', 'scope': 'product', 'channel': 'product',
            'confirmationOrigin': 'user_declared', 'evidence': []}
        with db.connect() as c:
            c.execute("UPDATE product_material_jobs SET result=%s WHERE id=%s",
                      (Jsonb({'facts': {'version': 1, 'stale': False,
                                          'proposals': [declared_brand]}}), job_id))
            c.execute('''INSERT INTO product_material_sources(job_id,source_id,version,data)
                VALUES(%s,'other-document','v1',%s)''', (job_id, Jsonb({})))
        memory = client.get('/api/uony/threads/pending/product-memory').json()['productMemory']
        assert memory['confirmedFacts'] == [{'id': 'brand-confirmed', 'label': 'Marca',
            'value': 'Marca guardada', 'sourceLabel': 'Cliente · dato confirmado',
            'sourceRefs': [], 'freshness': 'saved_product_revision'}]
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET status='reauthorize' WHERE user_id=%s",
                      (user['id'],))
        memory = client.get('/api/uony/threads/pending/product-memory').json()['productMemory']
        assert memory['materialState'] == 'permission_required'
        assert memory['confirmedFacts'][0]['sourceLabel'] == 'Cliente · dato confirmado'
        with db.connect() as c:
            c.execute("UPDATE google_drive_connections SET status='connected' WHERE user_id=%s",
                      (user['id'],))
            c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,
                google_subject,revision,folder_id,status,result)
                VALUES(%s,%s,%s,%s,%s,1,'new-folder','queued',%s)''',
                (uuid4(), user['id'], product['id'], uuid4(), google.subject, Jsonb({})))
        memory = client.get('/api/uony/threads/pending/product-memory').json()['productMemory']
        assert memory['materialState'] == 'analysis_pending'
        assert memory['confirmedFacts'][0]['value'] == 'Marca guardada'
        assert memory['confirmedFacts'][0]['sourceLabel'] == 'Cliente · dato confirmado'


def test_natural_conversation_commits_unique_link_then_recovers_on_next_turn(environment):
    config, google, db = environment

    class LinkAgent:
        def __init__(self):
            self.calls = 0

        def generate(self, token, project_id, history, status, model=None, effort=None):
            self.calls += 1
            if self.calls == 1:
                matches = status.call('list_products', {'query': 'Basic Mini Bricks'})
                assert len(matches['products']) == 1 and matches['hasMore'] is False
                saved = status.call('get_product', {'sku': matches['products'][0]['sku']})['product']
                assert status.call('link_product_to_thread',
                                   {'sku': saved['sku'], 'revision': saved['revision']})['prepared']
                return 'Preparando la ficha.', {'calls': 1, 'totalTokenCount': 1}
            assert status['productMemory']['product']['sku'] == 'BASIC'
            assert status['productMemory']['confirmedFacts'][0]['value'] == '500 g'
            return 'El peso guardado es 500 g.', {'calls': 1, 'totalTokenCount': 1}

    agent = LinkAgent()
    with client_for(config, google, cloud=Cloud(), uony=agent) as client:
        ready(client, google, db)
        _product(client, fields=[{'id': 'weight', 'name': 'Peso', 'value': '500 g',
            'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}])
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute('''INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,
                scope,project_id,project_check) VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)''',
                (user['id'], google.subject, google.email,
                 Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(), Jsonb({'ready': True})))
            c.execute('''INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort)
                VALUES(%s,'project-fixture',%s,'gemini-3.5-flash','medium')''', (user['id'], google.subject))
        first = client.post('/api/uony/messages', json={
            'requestId': str(uuid4()), 'threadId': 'natural-chat', 'text': 'continúa Basic Mini Bricks'})
        assert first.status_code == 200, first.text
        assert first.json()['reply'].startswith('Continuaremos con Basic Mini Bricks')
        assert client.get('/api/uony/threads/natural-chat/product-memory').json()['productMemory']['product']['sku'] == 'BASIC'
        second = client.post('/api/uony/messages', json={
            'requestId': str(uuid4()), 'threadId': 'natural-chat', 'text': '¿Qué peso tiene?'})
        assert second.status_code == 200, second.text
        assert second.json()['reply'] == 'El peso guardado es 500 g.'


