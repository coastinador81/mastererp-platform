"""AMZ-04: isolated owner/snapshot ledger, no real Amazon or live send route."""
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import sleep
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.amazon_catalog import AmazonReadError
from app.amazon_publish_ledger import expire_abandoned_reservations, submit_once
from app.amazon_publish_snapshots import digest
from app.products import save
from conftest import login
from test_amazon_publish_snapshots import SCHEMA, preview_env, post
from test_uony import ready


def approval_body(snapshot, request_id=None):
    return {'requestId': str(request_id or uuid4()), 'snapshotId': snapshot['snapshotId'],
            'productRevision': snapshot['productRevision'], 'payloadHash': snapshot['payloadHash'],
            'snapshotHash': snapshot['snapshotHash'], 'acknowledgeExactSnapshot': True}


def approve(client, snapshot, request_id=None):
    body = approval_body(snapshot, request_id)
    response = client.post('/api/products/BASIC/amazon-publish-approvals', json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def ready_media(preview_env):
    client, db, _, product, _ = preview_env
    with db.connect() as c:
        user = c.execute('SELECT * FROM users LIMIT 1').fetchone()
        attrs = product['amazonAttributes'] | {'main_product_image_locator': [
            {'media_location': 'https://images.example.test/basic.jpg',
             'marketplace_id': 'A1RKKUPIHCS9HS'}]}
        product = save(c, user, {'revision': product['revision']}, 'BASIC',
            source='fixture-approved-media', amazon_state={'amazonAttributes': attrs,
                'amazonRequirementsContext': product['amazonRequirementsContext']})
    snapshot = post(client, product['revision']).json()
    assert snapshot['preview']['mediaReadiness'] == 'unverified'
    approved, _ = approve(client, snapshot)
    with db.connect() as c:
        row = c.execute('''SELECT media_refs FROM amazon_publish_snapshots WHERE id=%s''',
                        (snapshot['snapshotId'],)).fetchone()
        c.execute('''INSERT INTO amazon_publish_media_verifications
            (user_id,snapshot_id,media_refs_hash,verification_method)
            VALUES(%s,%s,%s,'asset_service')''',
            (user['id'], snapshot['snapshotId'], digest(row['media_refs'])))
    return db, user, snapshot, approved


class FakeListings:
    def __init__(self, status='ACCEPTED', error=None):
        self.status, self.error = status, error
        self.calls = []
        self.lock = Lock()

    def put(self, seller, market, sku, payload):
        with self.lock:
            self.calls.append((seller, market, sku, payload))
        sleep(.03)
        if self.error:
            raise self.error
        return {'status': self.status, 'submissionId': 'fake-submission',
                'requestReceipt': 'fake-request',
                'issues': [{'code': 'MISSING', 'message': 'Dato pendiente'}] if self.status == 'INVALID' else []}


def test_exact_acknowledgment_is_durable_idempotent_and_never_sends(preview_env):
    client, db, _, product, network = preview_env
    snapshot = post(client, product['revision']).json()
    body = approval_body(snapshot)
    denied = client.post('/api/products/BASIC/amazon-publish-approvals',
                         json={**body, 'acknowledgeExactSnapshot': False})
    assert denied.status_code == 422
    mismatched = client.post('/api/products/BASIC/amazon-publish-approvals',
                             json={**body, 'payloadHash': 'a' * 64})
    assert mismatched.status_code == 409
    first = client.post('/api/products/BASIC/amazon-publish-approvals', json=body)
    assert first.status_code == 200, first.text
    approval = first.json()
    assert approval['payloadHash'] == snapshot['payloadHash']
    assert approval['snapshotHash'] == snapshot['snapshotHash']
    assert approval['productRevision'] == snapshot['productRevision']
    assert approval['sourceCurrent'] is True
    assert approval['submissionReady'] is False
    assert client.post('/api/products/BASIC/amazon-publish-approvals', json=body).json() == approval
    assert client.get('/api/products/BASIC/amazon-publish-approvals/' + approval['approvalId']).json() == approval
    changed_request = client.post('/api/products/BASIC/amazon-publish-approvals',
                                  json={**body, 'requestId': str(uuid4())})
    assert changed_request.status_code == 409
    conflicting_replay = client.post('/api/products/BASIC/amazon-publish-approvals',
                                     json={**body, 'snapshotHash': 'b' * 64})
    assert conflicting_replay.status_code == 409
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_approvals').fetchone()['n'] == 1
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 0
        with pytest.raises(Exception, match='immutable'):
            c.execute('UPDATE amazon_publish_approvals SET sku=sku WHERE id=%s',
                      (approval['approvalId'],))
        c.rollback()
    assert network == {'put': 0, 'item': 0, 'schema': 0}


def test_edit_schema_or_seller_invalidates_approval(preview_env):
    client, db, _, product, _ = preview_env
    snapshot = post(client, product['revision']).json()
    approval, body = approve(client, snapshot)
    edited = client.patch('/api/products/BASIC', json={'revision': product['revision'],
        'name': 'Basic Mini Bricks nueva'}).json()['product']
    old = client.get('/api/products/BASIC/amazon-publish-approvals/' + approval['approvalId']).json()
    assert old['sourceCurrent'] is False
    replay = client.post('/api/products/BASIC/amazon-publish-approvals', json=body).json()
    assert replay['approvalId'] == approval['approvalId'] and replay['sourceCurrent'] is False
    assert client.post('/api/products/BASIC/amazon-publish-approvals',
                       json={**body, 'requestId': str(uuid4())}).status_code == 409
    newest = post(client, edited['revision']).json()
    with db.connect() as c:
        c.execute("""UPDATE product_requirement_schemas SET metadata=jsonb_set(metadata,
            '{schemaHash}',to_jsonb(%s::text))""", ('e' * 64,))
    assert client.post('/api/products/BASIC/amazon-publish-approvals',
                       json=approval_body(newest)).status_code == 409
    with db.connect() as c:
        c.execute("UPDATE amazon_connections SET seller_id='DIFFERENT' WHERE user_id=%s",
                  (c.execute('SELECT id FROM users LIMIT 1').fetchone()['id'],))
    assert client.post('/api/products/BASIC/amazon-publish-approvals',
                       json=approval_body(newest)).status_code == 409


def test_request_replays_remain_read_only_after_sku_edit_and_gate_close(preview_env):
    client, db, _, _, _ = preview_env
    db, user, snapshot, approval = ready_media(preview_env)
    provider = FakeListings()
    request_id = uuid4()
    sent = submit_once(db, user, UUID(approval['approvalId']), request_id,
                       provider, gate_open=True)
    assert sent['status'] == 'accepted_initial'
    changed = client.patch('/api/products/BASIC', json={
        'revision': snapshot['productRevision'], 'sku': 'RENAMED'}).json()['product']
    assert changed['sku'] == 'RENAMED'
    approval_replay = client.post('/api/products/BASIC/amazon-publish-approvals',
        json={'requestId': approval['requestId'], 'snapshotId': approval['snapshotId'],
              'productRevision': approval['productRevision'],
              'payloadHash': approval['payloadHash'],
              'snapshotHash': approval['snapshotHash'],
              'acknowledgeExactSnapshot': True})
    assert approval_replay.status_code == 200
    assert approval_replay.json()['sourceCurrent'] is False
    attempt_replay = submit_once(db, user, UUID(approval['approvalId']), request_id,
                                 provider, gate_open=False)
    assert attempt_replay == sent
    assert len(provider.calls) == 1


def test_gate_and_unverified_media_prevent_any_attempt(preview_env):
    client, db, _, product, _ = preview_env
    snapshot = post(client, product['revision']).json()
    approval, _ = approve(client, snapshot)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users LIMIT 1').fetchone()
    provider = FakeListings()
    with pytest.raises(HTTPException) as disabled:
        submit_once(db, user, UUID(approval['approvalId']), uuid4(), provider)
    assert disabled.value.detail['error'] == 'amazon_publish_disabled'
    with pytest.raises(HTTPException) as missing:
        submit_once(db, user, UUID(approval['approvalId']), uuid4(), provider, gate_open=True)
    assert missing.value.detail['error'] == 'amazon_media_not_verified'
    assert provider.calls == []
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 0


def test_one_put_two_workers_idempotent_and_initial_acceptance(preview_env):
    db, user, snapshot, approval = ready_media(preview_env)
    provider = FakeListings()
    request_id = uuid4()

    def send():
        return submit_once(db, user, UUID(approval['approvalId']), request_id,
                           provider, gate_open=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert len(provider.calls) == 1
    assert provider.calls[0][:3] == (snapshot['sellerId'], snapshot['marketplaceId'], snapshot['sku'])
    assert provider.calls[0][3] == snapshot['payload']
    assert all(row['attemptId'] == results[0]['attemptId'] for row in results)
    assert {row['status'] for row in results} <= {'reserved', 'accepted_initial'}
    final = send()
    assert final['status'] == 'accepted_initial' and final['published'] is False
    assert final['submissionId'] == 'fake-submission'
    with pytest.raises(HTTPException) as duplicate:
        submit_once(db, user, UUID(approval['approvalId']), uuid4(), provider, gate_open=True)
    assert duplicate.value.detail['error'] == 'amazon_approval_already_submitted'
    assert len(provider.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 1


def test_two_workers_with_distinct_request_ids_still_reserve_one_put(preview_env):
    db, user, _, approval = ready_media(preview_env)
    provider = FakeListings()

    def send(_):
        try:
            return submit_once(db, user, UUID(approval['approvalId']), uuid4(),
                               provider, gate_open=True)['status']
        except HTTPException as error:
            return error.detail['error']

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(send, range(2)))
    assert len(provider.calls) == 1
    assert 'accepted_initial' in outcomes
    assert 'amazon_approval_already_submitted' in outcomes
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 1


def test_exact_revision_is_locked_during_the_one_put(preview_env):
    db, user, _, approval = ready_media(preview_env)

    class LockProbe(FakeListings):
        def put(self, seller, market, sku, payload):
            with db.connect() as observer:
                with pytest.raises(Exception, match='could not obtain lock'):
                    observer.execute('''SELECT id FROM products WHERE user_id=%s
                        AND lower(sku)=lower(%s) FOR UPDATE NOWAIT''', (user['id'], sku))
                observer.rollback()
            return super().put(seller, market, sku, payload)

    provider = LockProbe()
    result = submit_once(db, user, UUID(approval['approvalId']), uuid4(),
                         provider, gate_open=True)
    assert result['status'] == 'accepted_initial'
    assert len(provider.calls) == 1


@pytest.mark.parametrize('mutation', ['product', 'seller', 'schema', 'access'])
def test_revalidates_current_owner_seller_ptd_and_revision_before_put(preview_env, mutation):
    client, db, _, _, _ = preview_env
    db, user, snapshot, approval = ready_media(preview_env)
    if mutation == 'product':
        client.patch('/api/products/BASIC', json={'revision': snapshot['productRevision'],
                                                  'name': 'Editado después de aprobar'})
    else:
        with db.connect() as c:
            if mutation == 'seller':
                c.execute("UPDATE amazon_connections SET seller_id='SELLER_CHANGED' WHERE user_id=%s",
                          (user['id'],))
            elif mutation == 'schema':
                c.execute("""UPDATE product_requirement_schemas
                    SET metadata=jsonb_set(metadata,'{schemaHash}',to_jsonb(%s::text))
                    WHERE user_id=%s""", ('f' * 64, user['id']))
            else:
                c.execute("UPDATE users SET onboarding_completed_at=NULL WHERE id=%s", (user['id'],))
    provider = FakeListings()
    with pytest.raises(HTTPException) as refused:
        submit_once(db, user, UUID(approval['approvalId']), uuid4(), provider,
                    gate_open=True)
    assert refused.value.status_code in (403, 409)
    assert provider.calls == []
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 0


@pytest.mark.parametrize('provider,expected', [
    (FakeListings(status='INVALID'), 'invalid'),
    (FakeListings(error=AmazonReadError('submission_http_error', 503)), 'unknown'),
    (FakeListings(error=TimeoutError('fake timeout')), 'unknown'),
])
def test_invalid_and_ambiguous_results_are_durable_without_retry(preview_env, provider, expected):
    db, user, _, approval = ready_media(preview_env)
    request_id = uuid4()
    first = submit_once(db, user, UUID(approval['approvalId']), request_id,
                        provider, gate_open=True)
    assert first['status'] == expected and first['published'] is False
    again = submit_once(db, user, UUID(approval['approvalId']), request_id,
                        provider, gate_open=True)
    assert again == first and len(provider.calls) == 1
    assert (first['issues'][0]['code'] == 'MISSING') if expected == 'invalid' else (
        first['errorCode'] == 'submission_outcome_unknown')


def test_two_accounts_isolated_and_product_erasure_cascades(preview_env):
    client, db, google, product, _ = preview_env
    snapshot = post(client, product['revision']).json()
    approval, _ = approve(client, snapshot)
    with db.connect() as c:
        owner = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
    google.subject, google.email = 'second-subject', 'second@example.test'
    ready(client, google, db)
    assert client.get('/api/products/BASIC/amazon-publish-approvals/' + approval['approvalId']).status_code == 404
    assert client.post('/api/products/BASIC/amazon-publish-approvals',
                       json=approval_body(snapshot)).status_code == 404
    with db.connect() as c:
        other = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
    with pytest.raises(HTTPException) as isolated:
        submit_once(db, other, UUID(approval['approvalId']), uuid4(), FakeListings(), gate_open=True)
    assert isolated.value.detail['error'] == 'amazon_approval_not_found'
    # Owner's product deletion also erases immutable approvals and their attempts.
    google.subject, google.email = 'google-test-one', 'one@example.test'
    login(client, google)
    assert client.delete('/api/products/BASIC').status_code == 200
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_snapshots').fetchone()['n'] == 0
        assert c.execute('SELECT count(*) n FROM amazon_publish_approvals').fetchone()['n'] == 0
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 0


def test_two_active_accounts_can_use_same_request_id_without_crossing(preview_env):
    client, db, google, _, _ = preview_env
    db, first_user, first_snapshot, first_approval = ready_media(preview_env)
    google.subject, google.email = 'seller-two', 'seller-two@example.test'
    ready(client, google, db)
    second_product = client.post('/api/products',
        json={'sku': 'BASIC', 'name': 'Otro producto'}).json()['product']
    with db.connect() as c:
        second_user = c.execute('SELECT * FROM users WHERE google_subject=%s',
                                (google.subject,)).fetchone()
        c.execute('''INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted)
            VALUES(%s,'SELLER_TWO','fixture-not-a-credential')''', (second_user['id'],))
        c.execute('''INSERT INTO product_requirement_schemas
            (user_id,product_id,seller_id,marketplace_id,product_type,schema,metadata)
            VALUES(%s,%s,'SELLER_TWO','A1RKKUPIHCS9HS','TABLETOP_GAME',%s,%s)''',
            (second_user['id'], second_product['id'], Jsonb(SCHEMA), Jsonb({
                'schemaHash': digest(SCHEMA), 'requirements': 'LISTING',
                'requirementsEnforced': 'ENFORCED'})))
        context = {'sellerId': 'SELLER_TWO', 'marketplaceId': 'A1RKKUPIHCS9HS',
                   'productType': 'TABLETOP_GAME'}
        attrs = {'item_name': [{'value': 'Otro producto', 'marketplace_id': 'A1RKKUPIHCS9HS'}],
                 'brand': [{'value': 'Otra marca', 'marketplace_id': 'A1RKKUPIHCS9HS'}],
                 'main_product_image_locator': [{'media_location': 'https://images.example.test/other.jpg',
                                                 'marketplace_id': 'A1RKKUPIHCS9HS'}]}
        second_product = save(c, second_user, {'revision': second_product['revision']}, 'BASIC',
            source='fixture-second-seller', amazon_state={'amazonAttributes': attrs,
                                                            'amazonRequirementsContext': context})
    second_snapshot = post(client, second_product['revision']).json()
    second_approval, _ = approve(client, second_snapshot)
    assert client.get('/api/products/BASIC/amazon-publish-approvals/' +
                      first_approval['approvalId']).status_code == 404
    with db.connect() as c:
        refs = c.execute('SELECT media_refs FROM amazon_publish_snapshots WHERE id=%s',
                         (second_snapshot['snapshotId'],)).fetchone()['media_refs']
        c.execute('''INSERT INTO amazon_publish_media_verifications
            (user_id,snapshot_id,media_refs_hash,verification_method)
            VALUES(%s,%s,%s,'asset_service')''',
            (second_user['id'], second_snapshot['snapshotId'], digest(refs)))
    provider = FakeListings()
    same_request_id = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(submit_once, db, first_user, UUID(first_approval['approvalId']),
                        same_request_id, provider, gate_open=True)
        b = pool.submit(submit_once, db, second_user, UUID(second_approval['approvalId']),
                        same_request_id, provider, gate_open=True)
        first_result, second_result = a.result(), b.result()
    assert first_result['status'] == second_result['status'] == 'accepted_initial'
    assert first_result['attemptId'] != second_result['attemptId']
    assert {call[0] for call in provider.calls} == {'SELLER_TEST', 'SELLER_TWO'}
    assert {call[3]['attributes']['item_name'][0]['value'] for call in provider.calls} == {
        'Basic Mini Bricks', 'Otro producto'}
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_attempts').fetchone()['n'] == 2


def test_abandoned_reservation_becomes_unknown_without_put(preview_env):
    db, user, _, approval = ready_media(preview_env)
    request_id = uuid4()
    with db.connect() as c:
        from app.amazon_publish_ledger import reserve_once
        reserved, fresh = reserve_once(c, user, UUID(approval['approvalId']), request_id,
                                       gate_open=True)
        assert fresh and reserved['status'] == 'reserved'
        c.execute("""UPDATE amazon_publish_attempts SET reserved_at=now()-interval '5 minutes'
            WHERE id=%s""", (reserved['attemptId'],))
    with db.connect() as c:
        assert expire_abandoned_reservations(c) == 1
    provider = FakeListings()
    again = submit_once(db, user, UUID(approval['approvalId']), request_id, provider, gate_open=True)
    assert again['status'] == 'unknown' and again['published'] is False
    assert provider.calls == []


def test_recent_reservation_blocks_account_erasure_until_unknown(preview_env):
    from app.account_deletion_data import blockers
    from app.amazon_publish_ledger import reserve_once

    db, user, _, approval = ready_media(preview_env)
    with db.connect() as c:
        reserved, fresh = reserve_once(c, user, UUID(approval['approvalId']), uuid4(),
                                       gate_open=True)
        assert fresh and reserved['status'] == 'reserved'
    with db.connect() as c:
        assert any(row['code'] == 'amazon_publish' for row in blockers(c, user['id']))
        c.execute("""UPDATE amazon_publish_attempts SET reserved_at=now()-interval '5 minutes'
            WHERE id=%s""", (reserved['attemptId'],))
        assert expire_abandoned_reservations(c) == 1
    with db.connect() as c:
        assert not any(row['code'] == 'amazon_publish' for row in blockers(c, user['id']))
