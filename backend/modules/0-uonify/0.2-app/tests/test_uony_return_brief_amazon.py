"""AI-18 reads Amazon ledgers without submitting, checking or repeating work."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from test_amazon_publish_ledger import approve
from test_amazon_publish_snapshots import post, preview_env
from test_uony import ready


def _link(db, google, thread='basic-amazon-return', sku='BASIC'):
    with db.connect() as c:
        user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
        product = c.execute('SELECT * FROM products WHERE user_id=%s AND sku=%s',
                            (user['id'], sku)).fetchone()
        c.execute('INSERT INTO uony_threads(user_id,id,title) VALUES(%s,%s,%s)',
                  (user['id'], thread, 'Basic Mini Bricks'))
        c.execute('''INSERT INTO uony_thread_products
            (user_id,thread_id,product_id,google_subject,linked_revision,source)
            VALUES(%s,%s,%s,%s,%s,'conversation')''',
            (user['id'], thread, product['id'], google.subject, product['revision']))
    return user


def _brief(client, thread='basic-amazon-return'):
    response = client.get(f'/api/uony/threads/{thread}/return-brief')
    assert response.status_code == 200, response.text
    return response.json()['returnBrief']


def _count(c):
    return {table: c.execute('SELECT count(*) AS n FROM ' + table).fetchone()['n']
            for table in ('amazon_publish_snapshots', 'amazon_publish_approvals',
                          'amazon_publish_attempts', 'amazon_publish_followups',
                          'uony_return_followups', 'uony_requests')}


def test_basic_local_draft_approval_and_account_isolation(preview_env):
    client, db, google, product, network = preview_env
    fields = [{'id': 'weight', 'name': 'Peso confirmado', 'value': '500 g',
               'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}]
    edited = client.patch('/api/products/BASIC', json={
        'revision': product['revision'], 'customFields': fields})
    assert edited.status_code == 200, edited.text
    product = edited.json()['product']
    _link(db, google)
    empty = _brief(client)
    assert empty['status']['amazonPublication'] == 'not_started'
    assert 'vista previa local' in empty['summary']
    assert 'No consta ninguna publicación' not in empty['summary']
    assert any(fact['value'] == '500 g' for fact in empty['confirmedFacts'])

    snapshot = post(client, product['revision']).json()
    draft = _brief(client)
    assert draft['status']['amazonPublication'] == 'local_draft'
    assert draft['status']['amazonPublicationDetail']['snapshotId'] == snapshot['snapshotId']
    assert draft['status']['amazonPublicationDetail']['matchesProductRevision'] is True
    assert 'aún no ha recibido' in draft['summary']
    approval, _ = approve(client, snapshot)
    approved = _brief(client)
    assert approved['status']['amazonPublication'] == 'approved_not_sent'
    assert approved['status']['amazonPublicationDetail']['approvalId'] == approval['approvalId']
    assert approved['status']['amazonPublicationDetail']['retailLinkVerified'] is False
    assert 'no consta un intento de envío' in approved['summary']
    with db.connect() as c:
        before = _count(c)
    for _ in range(3):
        assert _brief(client) == approved
    with db.connect() as c:
        assert _count(c) == before
    assert network == {'put': 0, 'item': 0, 'schema': 0}

    google.subject, google.email = 'second-amazon-return', 'other-return@example.test'
    ready(client, google, db)
    assert client.get('/api/uony/threads/basic-amazon-return/return-brief').status_code == 404
    created = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Otro Basic'}).json()['product']
    assert created['revision'] == 1
    _link(db, google, 'other-amazon-return')
    other = _brief(client, 'other-amazon-return')
    assert other['status']['amazonPublication'] == 'not_started'
    assert other['status']['amazonPublicationDetail']['snapshotId'] is None
    assert network == {'put': 0, 'item': 0, 'schema': 0}


@pytest.mark.parametrize(('attempt_status', 'phase', 'word'), [
    ('reserved', 'reserved', 'todavía no conocemos'),
    ('invalid', 'rejected_initial', 'rechazó inicialmente'),
    ('unknown', 'outcome_unknown', 'incierto'),
    ('accepted_initial', 'awaiting_amazon', 'aceptó inicialmente'),
])
def test_saved_submission_outcomes_are_distinct(preview_env, attempt_status, phase, word):
    client, db, google, product, network = preview_env
    _link(db, google)
    snapshot = post(client, product['revision']).json()
    approval, _ = approve(client, snapshot)
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                         (google.subject,)).fetchone()
        c.execute('''INSERT INTO amazon_publish_attempts
            (id,user_id,approval_id,request_id,status,finished_at,submission_id)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (uuid4(), user['id'], approval['approvalId'], uuid4(), attempt_status,
             None if attempt_status == 'reserved' else datetime.now(timezone.utc),
             'fixture-submission' if attempt_status == 'accepted_initial' else None))
        before = _count(c)
    brief = _brief(client)
    assert brief['status']['amazonPublication'] == phase
    assert brief['status']['amazonPublicationDetail']['submissionStatus'] == attempt_status
    assert word in brief['summary']
    assert brief['status']['amazonPublicationDetail']['currentVisibilityVerified'] is False
    with db.connect() as c:
        assert _count(c) == before
    assert network == {'put': 0, 'item': 0, 'schema': 0}


def test_fresh_listing_observation_then_failed_read_is_not_publication(preview_env):
    client, db, google, product, network = preview_env
    _link(db, google)
    snapshot = post(client, product['revision']).json()
    approval, _ = approve(client, snapshot)
    attempt_id = uuid4()
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                         (google.subject,)).fetchone()['id']
        c.execute('''INSERT INTO amazon_publish_attempts
            (id,user_id,approval_id,request_id,status,finished_at,submission_id)
            VALUES(%s,%s,%s,%s,'accepted_initial',now(),'fixture-submission')''',
            (attempt_id, user, approval['approvalId'], uuid4()))
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,result,checked_at,asin,
             product_type_match,snapshot_match)
            VALUES(%s,%s,%s,%s,'done','visible_current',now(),'B012345678',true,true)''',
            (uuid4(), user, attempt_id, uuid4()))
    visible = _brief(client)
    assert visible['status']['amazonPublication'] == 'visible_current'
    detail = visible['status']['amazonPublicationDetail']
    assert detail['currentVisibilityVerified'] is True
    assert detail['retailLinkVerified'] is False
    assert detail['causedByThisSubmission'] is None
    assert 'No demuestra que nuestro envío la causara' in visible['summary']
    with db.connect() as c:
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,checked_at,error_code)
            VALUES(%s,%s,%s,%s,'read_error',now(),'amazon_read_unavailable')''',
            (uuid4(), user, attempt_id, uuid4()))
    failed = _brief(client)
    assert failed['status']['amazonPublication'] == 'check_failed'
    assert failed['status']['amazonPublicationDetail']['currentVisibilityVerified'] is False
    assert 'visibilidad actual no está comprobada' in failed['summary']
    changed = client.patch('/api/products/BASIC', json={
        'revision': product['revision'], 'customFields': [{
            'id': 'pack', 'name': 'Caja confirmada', 'value': 'Datos de caja guardados',
            'isConfirmed': True, 'source': 'Cliente', 'type': 'text', 'options': []}]})
    assert changed.status_code == 200, changed.text
    stale = _brief(client)
    assert stale['status']['amazonPublicationDetail']['matchesProductRevision'] is False
    assert 'revisión anterior' in stale['summary']
    new_snapshot = post(client, changed.json()['product']['revision']).json()
    new_approval, _ = approve(client, new_snapshot)
    latest = _brief(client)
    assert latest['status']['amazonPublicationDetail']['approvalId'] == approval['approvalId']
    assert latest['status']['amazonPublicationDetail']['approvalId'] != new_approval['approvalId']
    assert latest['status']['amazonPublicationDetail']['newerLocalDraft'] is True
    assert 'borrador local más reciente' in latest['summary']
    assert network == {'put': 0, 'item': 0, 'schema': 0}


def test_old_visible_read_is_not_current_visibility(preview_env):
    client, db, google, product, network = preview_env
    _link(db, google)
    snapshot = post(client, product['revision']).json()
    approval, _ = approve(client, snapshot)
    attempt_id = uuid4()
    with db.connect() as c:
        user = c.execute('SELECT id FROM users WHERE google_subject=%s',
                         (google.subject,)).fetchone()['id']
        c.execute('''INSERT INTO amazon_publish_attempts
            (id,user_id,approval_id,request_id,status,finished_at,submission_id)
            VALUES(%s,%s,%s,%s,'accepted_initial',now(),'fixture-submission')''',
            (attempt_id, user, approval['approvalId'], uuid4()))
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,result,started_at,checked_at,
             asin,product_type_match,snapshot_match)
            VALUES(%s,%s,%s,%s,'done','visible_current',
                now()-interval '2 hours',now()-interval '2 hours',
                'B012345678',true,true)''',
            (uuid4(), user, attempt_id, uuid4()))
    brief = _brief(client)
    assert brief['status']['amazonPublication'] == 'visibility_check_stale'
    assert brief['status']['amazonPublicationDetail']['currentVisibilityVerified'] is False
    assert 'ya no acredita su estado actual' in brief['summary']
    assert network == {'put': 0, 'item': 0, 'schema': 0}
