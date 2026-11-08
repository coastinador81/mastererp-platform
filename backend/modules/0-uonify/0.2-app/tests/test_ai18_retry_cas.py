"""AI-18: el botón de retorno solo puede repetir el mismo trabajo vigente."""
from uuid import uuid4
import pytest
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from app import uony_return_brief
from app.products import save
from test_product_requirements import requirement_env
from test_product_reasoning_jobs import reasoning_env, prepare


def _setup(env, status='error'):
    client, db, _, provider, *_ = env
    prepare(env)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        c.execute('''INSERT INTO google_drive_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status)
            VALUES(%s,%s,%s,'fixture-only','drive','connected')
            ON CONFLICT(user_id) DO UPDATE SET google_subject=excluded.google_subject,
              status='connected' ''', (user['id'], user['google_subject'], user['email']))
        c.execute('''INSERT INTO google_cloud_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status,project_id,project_check)
            VALUES(%s,%s,%s,'fixture-only','cloud','connected','test-project',%s)
            ON CONFLICT(user_id) DO UPDATE SET google_subject=excluded.google_subject,
              status='connected',project_id='test-project',project_check=excluded.project_check''',
            (user['id'], user['google_subject'], user['email'], Jsonb({'ready': True})))
        c.execute('UPDATE product_reasoning_jobs SET status=%s,updated_at=now()', (status,))
    revision = client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision']
    linked = client.post('/api/uony/messages', json={
        'requestId': str(uuid4()), 'threadId': 'ai18-retry', 'text': 'Continuar Basic Mini Bricks',
        'productAction': {'action': 'link', 'sku': 'BASIC', 'revision': revision, 'expectedVersion': 0}})
    assert linked.status_code == 200, linked.text
    brief = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    detail = brief['status']['reasoningDetail']
    assert detail['status'] == status and detail['canRetry'] is True
    assert provider.calls == []
    body = {'requestId': str(uuid4()), 'threadId': 'ai18-retry',
            'text': 'Reintentar la comprobación de Basic Mini Bricks con Uony.',
            'requirementsAction': {'action': 'prepare', 'sku': 'BASIC', 'retry': True,
                'acknowledgeUnknown': status == 'unknown',
                'expectedRevision': revision, 'expectedLinkVersion': brief['product']['linkVersion'],
                'expectedReasoningId': detail['id'], 'expectedReasoningStatus': status,
                'expectedSourceFingerprint': brief['sourceFingerprint']}}
    return body


def _counts(db):
    with db.connect() as c:
        return tuple(c.execute('SELECT count(*) n FROM ' + table).fetchone()['n'] for table in
                     ('product_reasoning_jobs', 'product_reasoning_calls', 'uony_requests'))


@pytest.mark.parametrize('status', ['error', 'unknown'])
def test_ai18_explicit_retry_reuses_same_job_and_same_request_id(reasoning_env, status):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env, status)
    before = _counts(db)
    sent = client.post('/api/uony/messages', json=body)
    assert sent.status_code == 200, sent.text
    receipt = client.get('/api/uony/threads/ai18-retry/requests/'
                         + body['requestId'] + '/receipt')
    assert receipt.status_code == 200 and receipt.headers['cache-control'] == 'no-store'
    assert receipt.json() == {'requestId': body['requestId'], 'threadId': 'ai18-retry',
        'status': 'success', 'action': {'kind': 'requirements_prepare',
            **body['requirementsAction']}}
    assert 'reply' not in receipt.text and 'usage' not in receipt.text
    assert client.get('/api/uony/threads/other-thread/requests/'
                      + body['requestId'] + '/receipt').status_code == 404
    assert client.get('/api/uony/threads/ai18-retry/requests/'
                      + str(uuid4()) + '/receipt').status_code == 404
    assert client.post('/api/uony/messages', json=body).json() == sent.json()
    after = _counts(db)
    assert after == (before[0], before[1], before[2] + 1)
    assert provider.calls == []
    with db.connect() as c:
        row = c.execute('SELECT id,status FROM product_reasoning_jobs').fetchone()
    assert str(row['id']) == body['requirementsAction']['expectedReasoningId']
    assert row['status'] == 'queued'


@pytest.mark.parametrize('field,value', [
    ('expectedRevision', 999), ('expectedLinkVersion', 999),
    ('expectedReasoningId', str(uuid4())), ('expectedReasoningStatus', 'unknown'),
    ('expectedSourceFingerprint', '0' * 64),
])
def test_ai18_retry_rejects_stale_card_without_mutation(reasoning_env, field, value):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    body['requirementsAction'][field] = value
    before = _counts(db)
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 409, response.text
    assert _counts(db) == before and provider.calls == []


def test_ai18_retry_rejects_product_edit_and_finished_job(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        revision = body['requirementsAction']['expectedRevision']
        save(c, user, {'revision': revision, 'name': 'Basic Mini Bricks actualizado'}, 'BASIC')
    before = _counts(db)
    assert client.post('/api/uony/messages', json=body).status_code == 409
    assert _counts(db) == before
    with db.connect() as c:
        c.execute("UPDATE product_reasoning_jobs SET status='completed',updated_at=now()")
    assert client.post('/api/uony/messages', json=body).status_code == 409
    assert _counts(db) == before and provider.calls == []


def test_ai18_retry_cannot_move_card_to_another_thread_for_same_product(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    linked = client.post('/api/uony/messages', json={
        'requestId': str(uuid4()), 'threadId': 'other-basic-thread',
        'text': 'Continuar Basic Mini Bricks',
        'productAction': {'action': 'link', 'sku': 'BASIC',
                          'revision': body['requirementsAction']['expectedRevision'],
                          'expectedVersion': 0}})
    assert linked.status_code == 200, linked.text
    other = client.get('/api/uony/threads/other-basic-thread/return-brief').json()['returnBrief']
    assert other['product']['linkVersion'] == body['requirementsAction']['expectedLinkVersion']
    assert other['sourceFingerprint'] != body['requirementsAction']['expectedSourceFingerprint']
    before = _counts(db)
    response = client.post('/api/uony/messages', json={**body, 'requestId': str(uuid4()),
        'threadId': 'other-basic-thread'})
    assert response.status_code == 409, response.text
    assert _counts(db) == before and provider.calls == []


def test_ai18_google_project_change_invalidates_retry_card(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        c.execute("UPDATE google_cloud_connections SET project_id='other-ready-project'")
    changed = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    assert changed['sourceFingerprint'] != body['requirementsAction']['expectedSourceFingerprint']
    before = _counts(db)
    assert client.post('/api/uony/messages', json=body).status_code == 409
    assert _counts(db) == before and provider.calls == []


@pytest.mark.parametrize('switch', ['before_claim', 'after_first_check'])
def test_ai18_google_project_change_before_provider_stales_same_job(reasoning_env, switch):
    client, db, service, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    assert client.post('/api/uony/messages', json=body).status_code == 200

    def credentials(c, user, refresh=True):
        current = c.execute('SELECT project_id FROM google_cloud_connections WHERE user_id=%s',
                            (user['id'],)).fetchone()['project_id']
        if switch == 'after_first_check' and refresh:
            current = 'other-ready-project'
        return [({}, 'drive-token'), ({'project_id': current}, 'cloud-token')]

    service.materials.credentials = credentials
    if switch == 'before_claim':
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET project_id='other-ready-project'")
    row = service.queue.claim('test-worker')
    assert row and row['context']['_billingProjectId'] == 'test-project'
    if switch == 'after_first_check':
        from app.product_reasoning_worker import StaleReasoning, credentials_and_sources
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
        with pytest.raises(StaleReasoning) as stopped:
            credentials_and_sources(service, row, user, row['context'])
        assert stopped.value.reason == 'project_changed' and provider.calls == []
        return
    service.run(row)
    with db.connect() as c:
        jobs = c.execute('SELECT id,status,result FROM product_reasoning_jobs').fetchall()
    assert len(jobs) == 1 and jobs[0]['id'] == row['id']
    assert jobs[0]['status'] == 'stale' and jobs[0]['result']['error'] == 'project_changed'
    assert provider.calls == []


def test_ai18_previous_google_error_does_not_block_after_connections_are_ready(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        c.execute('''UPDATE product_reasoning_jobs SET
            result=result || '{"connectionMessage":"detalle interno del proveedor"}'::jsonb,
            updated_at=now()''')
    brief = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    detail = brief['status']['reasoningDetail']
    assert detail['previousConnectionFailure'] is True
    assert detail['connectionRequired'] is False and detail['canRetry'] is True
    assert 'detalle interno del proveedor' not in detail['message']
    assert 'permisos de Google' in detail['message']
    body['requirementsAction']['expectedSourceFingerprint'] = brief['sourceFingerprint']
    before = _counts(db)
    assert client.post('/api/uony/messages', json=body).status_code == 200
    assert _counts(db) == (before[0], before[1], before[2] + 1) and provider.calls == []


def test_ai18_real_connection_failure_recovers_same_job_and_clears_old_diagnosis(reasoning_env):
    client, db, service, provider, *_ = reasoning_env

    def disconnected(*_args, **_kwargs):
        raise HTTPException(409, detail={'error': 'drive_reconnect',
            'message': 'Revisa el acceso a tus archivos.',
            'connectionActions': [{'provider': 'google_drive', 'action': 'manage'}]})

    service.materials.credentials = disconnected
    prepare(reasoning_env)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        original = c.execute('SELECT id,status,context,result FROM product_reasoning_jobs').fetchone()
        assert original['status'] == 'error' and original['result']['connectionMessage']
        c.execute('''INSERT INTO google_drive_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status)
            VALUES(%s,%s,%s,'fixture-only','drive','connected')''',
            (user['id'], user['google_subject'], user['email']))
        c.execute('''INSERT INTO google_cloud_connections
            (user_id,google_subject,email,refresh_encrypted,scope,status,project_id,project_check)
            VALUES(%s,%s,%s,'fixture-only','cloud','connected','fixture-project',%s)''',
            (user['id'], user['google_subject'], user['email'], Jsonb({'ready': True})))
    service.materials.credentials = lambda *_args, **_kwargs: [({}, 'drive-token'),
        ({'project_id': 'fixture-project'}, 'cloud-token')]
    revision = client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision']
    linked = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
        'threadId': 'ai18-reconnected', 'text': 'Continuar Basic Mini Bricks',
        'productAction': {'action': 'link', 'sku': 'BASIC', 'revision': revision, 'expectedVersion': 0}})
    assert linked.status_code == 200, linked.text
    brief = client.get('/api/uony/threads/ai18-reconnected/return-brief').json()['returnBrief']
    detail = brief['status']['reasoningDetail']
    assert detail['id'] == str(original['id']) and detail['canRetry'] is True
    assert detail['previousConnectionFailure'] is True and detail['connectionRequired'] is False
    body = {'requestId': str(uuid4()), 'threadId': 'ai18-reconnected',
        'text': 'Reintentar la comprobación de Basic Mini Bricks con Uony.',
        'requirementsAction': {'action': 'prepare', 'sku': 'BASIC', 'retry': True,
            'acknowledgeUnknown': False, 'expectedRevision': revision,
            'expectedLinkVersion': brief['product']['linkVersion'],
            'expectedReasoningId': detail['id'], 'expectedReasoningStatus': 'error',
            'expectedSourceFingerprint': brief['sourceFingerprint']}}
    before = _counts(db)
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 200, response.text
    with db.connect() as c:
        queued = c.execute('SELECT id,status,context,result FROM product_reasoning_jobs').fetchone()
        assert queued['id'] == original['id'] and queued['status'] == 'queued'
        assert queued['context']['fingerprint'] != original['context']['fingerprint']
        assert 'connectionMessage' not in queued['result']
        c.execute('''UPDATE product_reasoning_jobs SET status='error',
            result=result || '{"error":"provider_unavailable"}'::jsonb,updated_at=now()
            WHERE id=%s''', (queued['id'],))
    changed = client.get('/api/uony/threads/ai18-reconnected/return-brief').json()['returnBrief']
    assert changed['status']['reasoningDetail']['previousConnectionFailure'] is False
    assert 'permisos de Google' not in changed['status']['reasoningDetail']['message']
    body['requestId'] = str(uuid4())
    body['requirementsAction']['expectedSourceFingerprint'] = changed['sourceFingerprint']
    assert client.post('/api/uony/messages', json=body).status_code == 200
    assert _counts(db) == (before[0], before[1], before[2] + 2)
    with db.connect() as c:
        final = c.execute('SELECT id,status FROM product_reasoning_jobs').fetchone()
    assert final['id'] == original['id'] and final['status'] == 'queued'
    assert provider.calls == []


@pytest.mark.parametrize('connection', ['drive', 'cloud'])
def test_ai18_connection_lost_after_card_guides_reconnection(reasoning_env, connection):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        if connection == 'drive':
            c.execute("UPDATE google_drive_connections SET status='reauthorize'")
        else:
            c.execute("UPDATE google_cloud_connections SET project_id=NULL")
    brief = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    detail = brief['status']['reasoningDetail']
    assert detail['connectionRequired'] is True and detail['canRetry'] is False
    assert brief['sourceFingerprint'] != body['requirementsAction']['expectedSourceFingerprint']
    before = _counts(db)
    assert client.post('/api/uony/messages', json=body).status_code == 409
    body['requestId'] = str(uuid4())
    body['requirementsAction']['expectedSourceFingerprint'] = brief['sourceFingerprint']
    assert client.post('/api/uony/messages', json=body).status_code == 409
    assert _counts(db) == before and provider.calls == []


def test_ai18_error_with_unconfirmed_consumption_requires_explicit_ack(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        c.execute('''INSERT INTO product_reasoning_calls
            (id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'previous-attempt','unknown',128,'{"unconfirmedCalls":1}'::jsonb)''',
            (uuid4(), body['requirementsAction']['expectedReasoningId'], uuid4()))
    brief = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    assert brief['status']['reasoning'] == 'error'
    assert brief['status']['reasoningDetail']['canRetry'] is True
    assert brief['status']['reasoningDetail']['requiresConsumptionAcknowledgement'] is True
    body['requirementsAction']['expectedSourceFingerprint'] = brief['sourceFingerprint']
    before = _counts(db)
    assert client.post('/api/uony/messages', json=body).status_code == 409
    assert _counts(db) == before
    body['requestId'] = str(uuid4())
    body['requirementsAction']['acknowledgeUnknown'] = True
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 200, response.text
    with db.connect() as c:
        call = c.execute('SELECT acknowledged_at FROM product_reasoning_calls').fetchone()
    assert call['acknowledged_at'] is not None
    assert provider.calls == []


def test_ai18_error_requires_ack_for_uncertain_call_from_previous_google_identity(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        product = c.execute("SELECT id FROM products WHERE user_id=%s AND sku='BASIC'",
                            (user['id'],)).fetchone()
        previous_id = uuid4()
        c.execute('''INSERT INTO product_reasoning_jobs
            (id,user_id,product_id,google_subject,fingerprint,product_signature,
             schema_hash,status,revision,context,created_at,updated_at)
            VALUES(%s,%s,%s,'previous-google-identity',%s,'old-signature',
                   'old-schema','unknown',1,'{}'::jsonb,
                   now()-interval '2 days',now()-interval '1 day')''',
            (previous_id, user['id'], product['id'], str(uuid4())))
        c.execute('''INSERT INTO product_reasoning_calls
            (id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'previous-identity','unknown',128,
                   '{"unconfirmedCalls":1}'::jsonb)''',
            (uuid4(), previous_id, uuid4()))
    brief = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    assert brief['status']['reasoning'] == 'error'
    assert brief['status']['reasoningDetail']['requiresConsumptionAcknowledgement'] is True
    body['requirementsAction']['expectedSourceFingerprint'] = brief['sourceFingerprint']
    before = _counts(db)
    assert client.post('/api/uony/messages', json=body).status_code == 409
    assert _counts(db) == before and provider.calls == []
    body['requestId'] = str(uuid4())
    body['requirementsAction']['acknowledgeUnknown'] = True
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 200, response.text
    with db.connect() as c:
        call = c.execute('SELECT acknowledged_at FROM product_reasoning_calls WHERE job_id=%s',
                         (previous_id,)).fetchone()
    assert call['acknowledged_at'] is not None and provider.calls == []


def test_ai18_current_revision_wins_over_late_update_to_older_job(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        product = c.execute("SELECT id FROM products WHERE user_id=%s AND sku='BASIC'",
                            (user['id'],)).fetchone()
        c.execute('''INSERT INTO product_reasoning_jobs
            (id,user_id,product_id,google_subject,fingerprint,product_signature,
             schema_hash,status,revision,context,created_at,updated_at)
            VALUES(%s,%s,%s,%s,%s,'old-signature','old-schema','error',1,'{}'::jsonb,
                   now()-interval '2 days',now()+interval '1 minute')''',
            (uuid4(), user['id'], product['id'], user['google_subject'], str(uuid4())))
    brief = client.get('/api/uony/threads/ai18-retry/return-brief').json()['returnBrief']
    assert brief['status']['reasoningDetail']['id'] == body['requirementsAction']['expectedReasoningId']
    body['requirementsAction']['expectedSourceFingerprint'] = brief['sourceFingerprint']
    before = _counts(db)
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 200, response.text
    assert _counts(db) == (before[0], before[1], before[2] + 1)
    assert provider.calls == []


def test_ai18_worker_finishing_after_first_read_rejects_retry_without_side_effects(
        reasoning_env, monkeypatch):
    client, db, _, provider, *_ = reasoning_env
    body = _setup(reasoning_env)
    before = _counts(db)
    real_build = uony_return_brief.build
    changed = False

    def finish_after_read(c, user, thread_id):
        nonlocal changed
        result = real_build(c, user, thread_id)
        if not changed:
            changed = True
            c.execute("UPDATE product_reasoning_jobs SET status='completed',updated_at=now() "
                      'WHERE id=%s', (body['requirementsAction']['expectedReasoningId'],))
        return result

    monkeypatch.setattr(uony_return_brief, 'build', finish_after_read)
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 409, response.text
    assert changed and _counts(db) == before and provider.calls == []
    with db.connect() as c:
        row = c.execute('SELECT status FROM product_reasoning_jobs WHERE id=%s',
                        (body['requirementsAction']['expectedReasoningId'],)).fetchone()
    assert row['status'] == 'error'
