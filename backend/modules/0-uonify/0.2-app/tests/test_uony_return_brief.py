"""AI-18: only saved facts, explicit follow-up and zero paid work on read."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import uuid4
import pytest
from psycopg.errors import LockNotAvailable
from psycopg.types.json import Jsonb
from app import uony_return_brief
from app.products import save
from app.uony_return_brief import FollowUp
from conftest import client_for
from test_uony import Agent, ready


def _product(client, sku='BASIC', name='Basic Mini Bricks', weight='500 g'):
    fields = [
        ('weight', 'Peso confirmado', weight),
        ('pvpr', 'PVPR', '19,90 €'),
        ('audience', 'Público', 'Adultos y familias'),
        ('hazmat', 'Mercancías peligrosas', 'No aplicable'),
    ]
    response = client.post('/api/products', json={'sku': sku, 'name': name,
        'customFields': [{'id': key, 'name': label, 'value': value,
            'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}
            for key, label, value in fields]})
    assert response.status_code == 200, response.text
    return response.json()['product']


def _link(client, thread, sku='BASIC'):
    response = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
        'threadId': thread, 'text': 'Continuar la ficha guardada',
        'productAction': {'action': 'link', 'sku': sku, 'revision': 1, 'expectedVersion': 0}})
    assert response.status_code == 200, response.text


def _counts(c):
    names = ('products', 'product_revisions', 'product_material_jobs',
        'product_material_calls', 'product_reasoning_jobs', 'product_reasoning_calls',
        'uony_requests', 'uony_conversation_jobs', 'uony_return_followups')
    return {name: c.execute('SELECT count(*) n FROM ' + name).fetchone()['n'] for name in names}


def test_basic_return_brief_is_bounded_read_only_and_account_scoped(environment):
    config, google, db = environment
    agent = Agent()
    with client_for(config, google, uony=agent) as client:
        ready(client, google, db)
        _product(client)
        _link(client, 'basic-return')
        with db.connect() as c:
            before = _counts(c)
        for _ in range(3):
            response = client.get('/api/uony/threads/basic-return/return-brief')
            assert response.status_code == 200, response.text
            brief = response.json()['returnBrief']
            assert brief['product']['sku'] == 'BASIC'
            assert brief['product']['revision'] == 1
            assert {fact['value'] for fact in brief['confirmedFacts']} == {
                '500 g', '19,90 €', 'Adultos y familias', 'No aplicable'}
            assert brief['status']['amazonPublication'] == 'not_started'
            assert brief['status']['amazonPublicationDetail']['currentVisibilityVerified'] is False
            assert brief['pending'] == []
            assert brief['nextAction'] == 'review_amazon_requirements'
            assert brief['trackingVersion'] == 0
        with db.connect() as c:
            assert _counts(c) == before
        assert agent.calls == 0
        with db.connect() as c:
            user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()['id']
            product_id = c.execute("SELECT id FROM products WHERE user_id=%s AND sku='BASIC'",
                                   (user,)).fetchone()['id']
            c.execute('''INSERT INTO product_material_jobs
                (id,user_id,product_id,request_id,google_subject,revision,folder_id,status)
                VALUES(%s,%s,%s,%s,%s,1,'fixture-folder','ready')''',
                (uuid4(), user, product_id, uuid4(), google.subject))
            before = _counts(c)
        needs_drive = client.get('/api/uony/threads/basic-return/return-brief').json()['returnBrief']
        assert needs_drive['status']['material'] == 'permission_required'
        assert needs_drive['nextAction'] == 'reconnect_drive'
        assert needs_drive['pending'][0]['kind'] == 'materials'
        with db.connect() as c:
            assert _counts(c) == before
        google.subject, google.email = 'second-return-user', 'second-return@example.test'
        ready(client, google, db)
        assert client.get('/api/uony/threads/basic-return/return-brief').status_code == 404
        own = _product(client, 'SECOND', 'Otro producto', '700 g')
        assert own['sku'] == 'SECOND'
        _link(client, 'second-return', 'SECOND')
        values = {f['value'] for f in client.get('/api/uony/threads/second-return/return-brief').json()['returnBrief']['confirmedFacts']}
        assert values == {'700 g', '19,90 €', 'Adultos y familias', 'No aplicable'}
        assert agent.calls == 0


@pytest.mark.parametrize('failed_status,error_code,can_retry,needs_ack', [
    ('error', 'budget_exhausted', False, False),
    ('unknown', 'consumption_unknown', False, True),
])
def test_failed_reasoning_from_previous_revision_is_stale_without_restarting_work(
        environment, failed_status, error_code, can_retry, needs_ack):
    config, google, db = environment
    agent = Agent()
    with client_for(config, google, uony=agent) as client:
        ready(client, google, db)
        product = _product(client)
        _link(client, 'stale-reasoning')
        job_id = uuid4()
        with db.connect() as c:
            user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()['id']
            c.execute('''INSERT INTO product_reasoning_jobs
                (id,user_id,product_id,google_subject,fingerprint,product_signature,
                 schema_hash,status,revision,context,result)
                VALUES(%s,%s,%s,%s,%s,'product-signature','schema',%s,1,'{}'::jsonb,%s)''',
                (job_id, user, product['id'], google.subject, str(job_id), failed_status,
                 Jsonb({'error': error_code, 'connectionMessage': 'Detalle privado del proveedor'})))
        before = client.get('/api/uony/threads/stale-reasoning/return-brief')
        assert before.status_code == 200, before.text
        initial = before.json()['returnBrief']
        assert initial['status']['reasoning'] == failed_status
        assert initial['status']['reasoningDetail'] == {
            'id': str(job_id), 'status': failed_status,
            'message': initial['status']['reasoningDetail']['message'],
            'canRetry': can_retry, 'connectionRequired': True,
            'previousConnectionFailure': True,
            'requiresConsumptionAcknowledgement': needs_ack,
            'revision': 1}
        assert 'Detalle privado del proveedor' not in initial['status']['reasoningDetail']['message']
        assert initial['pending'][0]['id'] == f'reasoning:{job_id}'
        defer = {'requestId': str(uuid4()), 'action': 'defer',
                 'pendingId': initial['pending'][0]['id'],
                 'expectedVersion': initial['trackingVersion'],
                 'productRevision': initial['product']['revision'],
                 'sourceFingerprint': initial['sourceFingerprint']}
        assert client.post('/api/uony/threads/stale-reasoning/return-brief/follow-up',
                           json=defer).status_code == 200
        changed_fields = [{**field, 'value': '600 g'} if field['id'] == 'weight' else field
                          for field in product['customFields']]
        edited = client.patch('/api/products/BASIC', json={
            'revision': 1, 'customFields': changed_fields})
        assert edited.status_code == 200, edited.text
        with db.connect() as c:
            counts = _counts(c)
        for _ in range(2):
            response = client.get('/api/uony/threads/stale-reasoning/return-brief')
            assert response.status_code == 200, response.text
            brief = response.json()['returnBrief']
            assert brief['status']['reasoning'] == 'stale'
            assert brief['status']['reasoningDetail'] is None
            assert brief['product']['revision'] == 2
            assert {fact['value'] for fact in brief['confirmedFacts']} == {
                '600 g', '19,90 €', 'Adultos y familias', 'No aplicable'}
            assert brief['pending'][0]['id'] == f'reasoning:{job_id}'
            assert brief['pending'][0]['followUp'] == 'open'
            assert brief['nextAction'] == 'review_ai'
            assert brief['trackingVersion'] == 1
            assert [event['action'] for event in brief['followUpHistory']] == ['defer']
            assert brief['sourceFingerprint'] != initial['sourceFingerprint']
        with db.connect() as c:
            assert _counts(c) == counts
            assert c.execute('SELECT status,revision FROM product_reasoning_jobs WHERE id=%s',
                             (job_id,)).fetchone() == {
                                 'status': failed_status, 'revision': 1}
        assert agent.calls == 0


def test_return_brief_source_fingerprint_changes_after_link_away_and_back(environment):
    config, google, db = environment
    agent = Agent()
    with client_for(config, google, uony=agent) as client:
        ready(client, google, db)
        _product(client)
        _product(client, 'OTHER', 'Otra ficha')
        _link(client, 'relink-fingerprint')
        first = client.get('/api/uony/threads/relink-fingerprint/return-brief').json()['returnBrief']
        assert first['product']['sku'] == 'BASIC'
        assert first['product']['linkVersion'] == 1
        for sku, expected_version in [('OTHER', 1), ('BASIC', 2)]:
            response = client.post('/api/uony/messages', json={
                'requestId': str(uuid4()), 'threadId': 'relink-fingerprint',
                'text': 'Continuar la ficha guardada',
                'productAction': {'action': 'link', 'sku': sku, 'revision': 1,
                                  'expectedVersion': expected_version}})
            assert response.status_code == 200, response.text
        again = client.get('/api/uony/threads/relink-fingerprint/return-brief').json()['returnBrief']
        assert again['product']['sku'] == first['product']['sku'] == 'BASIC'
        assert again['product']['revision'] == first['product']['revision'] == 1
        assert again['confirmedFacts'] == first['confirmedFacts']
        assert again['product']['linkVersion'] == 3
        assert again['sourceFingerprint'] != first['sourceFingerprint']
        assert agent.calls == 0


def test_followup_defer_resolve_cas_history_and_current_source(environment):
    config, google, db = environment
    with client_for(config, google, uony=Agent()) as client:
        ready(client, google, db)
        _product(client)
        _link(client, 'follow-up')
        patch = client.patch('/api/products/BASIC/preparation', json={'revision': 1,
            'mode': 'guided', 'section': 'auditoria',
            'answers': {'customer': 'Adultos y familias'}, 'reviewed': False})
        assert patch.status_code == 200, patch.text
        brief = client.get('/api/uony/threads/follow-up/return-brief').json()['returnBrief']
        assert brief['product']['revision'] == 2
        assert len(brief['pending']) == 1
        pending = brief['pending'][0]
        assert pending['kind'] == 'preparation'
        body = {'requestId': str(uuid4()), 'action': 'defer', 'pendingId': pending['id'],
                'expectedVersion': brief['trackingVersion'],
                'productRevision': brief['product']['revision'],
                'sourceFingerprint': brief['sourceFingerprint']}
        wrong = client.post('/api/uony/threads/follow-up/return-brief/follow-up',
                            json=body, headers={'Origin': 'null'})
        assert wrong.status_code == 403
        deferred = client.post('/api/uony/threads/follow-up/return-brief/follow-up', json=body)
        assert deferred.status_code == 200, deferred.text
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up', json=body).json() == deferred.json()
        changed_id = {**body, 'pendingId': 'preparation:imagenes'}
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up', json=changed_id).status_code == 409
        after_defer = client.get('/api/uony/threads/follow-up/return-brief').json()['returnBrief']
        assert after_defer['trackingVersion'] == 1
        assert after_defer['pending'][0]['followUp'] == 'deferred'
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up',
            json={**body, 'requestId': str(uuid4()), 'action': 'resolve', 'expectedVersion': 1}).json()['error'] == 'pending_still_current'
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up',
            json={**body, 'requestId': str(uuid4()), 'expectedVersion': 0}).status_code == 409
        reviewed = client.patch('/api/products/BASIC/preparation', json={'revision': 2,
            'section': 'auditoria', 'reviewed': True})
        assert reviewed.status_code == 200, reviewed.text
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up',
            json={**body, 'requestId': str(uuid4()), 'expectedVersion': 1}).status_code == 409
        resolved_brief = client.get('/api/uony/threads/follow-up/return-brief').json()['returnBrief']
        assert resolved_brief['pending'] == []
        assert resolved_brief['completedFollowUps'][0]['id'] == pending['id']
        resolve = {**body, 'requestId': str(uuid4()), 'action': 'resolve',
            'expectedVersion': 1, 'productRevision': 3,
            'sourceFingerprint': resolved_brief['sourceFingerprint']}
        closed = client.post('/api/uony/threads/follow-up/return-brief/follow-up', json=resolve)
        assert closed.status_code == 200, closed.text
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up', json=resolve).json() == closed.json()
        final = client.get('/api/uony/threads/follow-up/return-brief').json()['returnBrief']
        assert final['trackingVersion'] == 2 and final['completedFollowUps'] == []
        with db.connect() as c:
            rows = c.execute('''SELECT action,version,product_revision FROM uony_return_followups
                ORDER BY version''').fetchall()
            assert rows == [{'action': 'defer', 'version': 1, 'product_revision': 2},
                            {'action': 'resolve', 'version': 2, 'product_revision': 3}]
            assert c.execute('SELECT count(*) n FROM product_material_calls').fetchone()['n'] == 0
            assert c.execute('SELECT count(*) n FROM product_reasoning_calls').fetchone()['n'] == 0
            c.execute("UPDATE uony_return_followups SET google_subject='revoked' WHERE request_id=%s",
                      (resolve['requestId'],))
        assert client.post('/api/uony/threads/follow-up/return-brief/follow-up', json=resolve).json()['error'] == 'account_changed'


def test_switch_product_hides_old_followup_and_deleted_thread_is_closed(environment):
    config, google, db = environment
    with client_for(config, google, uony=Agent()) as client:
        ready(client, google, db)
        _product(client)
        _product(client, 'OTHER', 'Otra ficha')
        _link(client, 'switch-return')
        edited = client.patch('/api/products/BASIC/preparation', json={'revision': 1,
            'section': 'auditoria', 'answers': {'customer': 'Adultos'}, 'reviewed': False})
        assert edited.status_code == 200
        brief = client.get('/api/uony/threads/switch-return/return-brief').json()['returnBrief']
        pending = brief['pending'][0]
        body = {'requestId': str(uuid4()), 'action': 'defer', 'pendingId': pending['id'],
            'expectedVersion': 0, 'productRevision': 2,
            'sourceFingerprint': brief['sourceFingerprint']}
        assert client.post('/api/uony/threads/switch-return/return-brief/follow-up', json=body).status_code == 200
        switch = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
            'threadId': 'switch-return', 'text': 'Ahora continúa la otra ficha',
            'productAction': {'action': 'link', 'sku': 'OTHER', 'revision': 1,
                              'expectedVersion': 1}})
        assert switch.status_code == 200, switch.text
        other = client.get('/api/uony/threads/switch-return/return-brief').json()['returnBrief']
        assert other['product']['sku'] == 'OTHER' and other['trackingVersion'] == 0
        assert other['pending'] == [] and other['completedFollowUps'] == []
        assert client.post('/api/uony/threads/switch-return/return-brief/follow-up', json=body).status_code == 200
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_return_followups').fetchone()['n'] == 1
        assert client.delete('/api/uony/threads/switch-return').status_code == 200
        assert client.get('/api/uony/threads/switch-return/return-brief').status_code == 410
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_return_followups').fetchone()['n'] == 0


def test_changed_pending_source_reopens_old_deferral_without_false_resolution(environment):
    config, google, db = environment
    with client_for(config, google, uony=Agent()) as client:
        ready(client, google, db)
        _product(client)
        _link(client, 'refresh-return')
        assert client.patch('/api/products/BASIC/preparation', json={'revision': 1,
            'section': 'auditoria', 'answers': {'customer': 'Adultos'}, 'reviewed': False}).status_code == 200
        brief = client.get('/api/uony/threads/refresh-return/return-brief').json()['returnBrief']
        pending_id = brief['pending'][0]['id']
        action = {'requestId': str(uuid4()), 'action': 'defer', 'pendingId': pending_id,
            'expectedVersion': 0, 'productRevision': 2,
            'sourceFingerprint': brief['sourceFingerprint']}
        assert client.post('/api/uony/threads/refresh-return/return-brief/follow-up', json=action).status_code == 200
        changed = client.patch('/api/products/BASIC/preparation', json={'revision': 2,
            'section': 'auditoria', 'answers': {'customer': 'Familias'}, 'reviewed': False})
        assert changed.status_code == 200, changed.text
        current = client.get('/api/uony/threads/refresh-return/return-brief').json()['returnBrief']
        assert current['pending'][0]['id'] == pending_id
        assert current['pending'][0]['followUp'] == 'open'
        assert current['completedFollowUps'] == []
        assert client.post('/api/uony/threads/refresh-return/return-brief/follow-up', json={
            **action, 'requestId': str(uuid4()), 'action': 'resolve',
            'expectedVersion': 1, 'productRevision': 3,
            'sourceFingerprint': current['sourceFingerprint']}).json()['error'] == 'pending_still_current'
        assert client.post('/api/uony/threads/refresh-return/return-brief/follow-up', json={
            **action, 'requestId': str(uuid4()), 'expectedVersion': 1,
            'productRevision': 3, 'sourceFingerprint': current['sourceFingerprint']}).status_code == 200
        latest = client.get('/api/uony/threads/refresh-return/return-brief').json()['returnBrief']
        assert latest['trackingVersion'] == 2
        assert latest['pending'][0]['followUp'] == 'deferred'
        assert [event['action'] for event in latest['followUpHistory']] == ['defer', 'defer']


def test_concurrent_same_request_replays_one_followup(environment, monkeypatch):
    config, google, db = environment
    with client_for(config, google, uony=Agent()) as client:
        ready(client, google, db)
        _product(client)
        _link(client, 'concurrent-return')
        changed = client.patch('/api/products/BASIC/preparation', json={'revision': 1,
            'section': 'auditoria', 'answers': {'customer': 'Adultos'}, 'reviewed': False})
        assert changed.status_code == 200, changed.text
        brief = client.get('/api/uony/threads/concurrent-return/return-brief').json()['returnBrief']
        body = FollowUp.model_validate({'requestId': str(uuid4()), 'action': 'defer',
            'pendingId': brief['pending'][0]['id'], 'expectedVersion': brief['trackingVersion'],
            'productRevision': brief['product']['revision'],
            'sourceFingerprint': brief['sourceFingerprint']})
        with db.connect() as c:
            user = c.execute('SELECT id,google_subject FROM users WHERE google_subject=%s',
                             (google.subject,)).fetchone()
        original = uony_return_brief._binding
        rendezvous = Barrier(2)

        def after_initial_lookup(c, owner, thread_id, lock=False):
            if lock:
                rendezvous.wait(timeout=10)
            return original(c, owner, thread_id, lock)

        monkeypatch.setattr(uony_return_brief, '_binding', after_initial_lookup)

        def act(_):
            with db.connect() as c:
                return uony_return_brief.update(c, user, 'concurrent-return', body)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(act, range(2)))
        assert results[0] == results[1]
        assert results[0]['event']['trackingVersion'] == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) n FROM uony_return_followups').fetchone()['n'] == 1


def test_return_brief_keeps_one_product_revision_during_background_edit(environment, monkeypatch):
    config, google, db = environment
    bound, release = Event(), Event()
    with client_for(config, google, uony=Agent()) as client:
        ready(client, google, db)
        product = _product(client)
        _link(client, 'revision-return')
        fields = product['customFields']

        def with_weight(value):
            return [{**field, 'value': value} if field['id'] == 'weight' else field for field in fields]

        first = client.patch('/api/products/BASIC', json={'revision': 1,
            'customFields': with_weight('600 g')})
        assert first.status_code == 200, first.text
        assert client.get('/api/uony/threads/revision-return/return-brief').json()['returnBrief']['confirmedFacts'][0]['value'] == '600 g'

        original = uony_return_brief._binding

        def pause_after_binding(c, user, thread_id, lock=False):
            row = original(c, user, thread_id, lock)
            if thread_id == 'revision-return' and not lock and not bound.is_set():
                assert row['revision'] == 2
                bound.set()
                assert release.wait(10)
            return row

        monkeypatch.setattr(uony_return_brief, '_binding', pause_after_binding)

        def background_edit():
            with db.connect() as c:
                c.execute("SET LOCAL lock_timeout='300ms'")
                owner = c.execute('SELECT * FROM users').fetchone()
                return save(c, owner, {'revision': 2,
                    'customFields': with_weight('700 g')}, 'BASIC')

        with ThreadPoolExecutor(max_workers=2) as pool:
            brief_future = pool.submit(client.get, '/api/uony/threads/revision-return/return-brief')
            try:
                assert bound.wait(10)
                edit_future = pool.submit(background_edit)
                with pytest.raises(LockNotAvailable):
                    edit_future.result(timeout=5)
            finally:
                release.set()
            response = brief_future.result(timeout=10)
        assert response.status_code == 200, response.text
        brief = response.json()['returnBrief']
        assert brief['product']['revision'] == 2
        assert brief['confirmedFacts'][0]['value'] == '600 g'

        second = client.patch('/api/products/BASIC', json={'revision': 2,
            'customFields': with_weight('700 g')})
        assert second.status_code == 200, second.text
        current = client.get('/api/uony/threads/revision-return/return-brief').json()['returnBrief']
        assert current['product']['revision'] == 3
        assert current['confirmedFacts'][0]['value'] == '700 g'
        assert current['sourceFingerprint'] != brief['sourceFingerprint']
