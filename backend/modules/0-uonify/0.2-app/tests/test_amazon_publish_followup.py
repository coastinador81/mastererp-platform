"""AMZ-05: isolated PostgreSQL + fake provider; no Amazon requests or PUTs."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from threading import Lock
from time import sleep
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.amazon_catalog import AmazonReadError
from app import amazon_publish_followup as followup
from app.amazon_publish_followup import load_status, reconcile_once
from app.amazon_publish_ledger import submit_once
from test_amazon_publish_ledger import FakeListings, ready_media
from test_amazon_publish_snapshots import preview_env
from test_uony import ready
from conftest import login


class FakeRead:
    def __init__(self, response=None, error=None, delay=0):
        self.response, self.error, self.delay = response, error, delay
        self.calls, self.lock = [], Lock()

    def item(self, seller, market, sku):
        with self.lock:
            self.calls.append((seller, market, sku))
        if self.delay:
            sleep(self.delay)
        if self.error:
            raise self.error
        return deepcopy(self.response)


@pytest.fixture
def followup_env(preview_env):
    client, db, google, _, network = preview_env
    db, user, snapshot, approval = ready_media(preview_env)
    writer = FakeListings()
    attempt = submit_once(db, user, UUID(approval['approvalId']), uuid4(),
                          writer, gate_open=True)
    assert attempt['status'] == 'accepted_initial' and len(writer.calls) == 1
    yield client, db, google, user, snapshot, attempt, writer, network


def listing(snapshot, *, status=None, issues=None, asin='B012345678', title=None):
    attributes = deepcopy(snapshot['payload']['attributes'])
    if title is not None:
        attributes['item_name'][0]['value'] = title
    return {'sku': snapshot['sku'], 'issues': issues or [], 'attributes': attributes,
            'summaries': [{'marketplaceId': snapshot['marketplaceId'], 'asin': asin,
                'status': status or [], 'lastUpdatedDate': '2026-10-16T12:00:00Z'}],
            'productTypes': [{'marketplaceId': snapshot['marketplaceId'],
                              'productType': snapshot['productType']}]}


def poll(env, reader, request_id=None):
    _, db, _, user, _, attempt, _, _ = env
    return reconcile_once(db, user, UUID(attempt['attemptId']), request_id or uuid4(),
                          reader, gate_open=True)


def test_accepted_404_issue_processing_and_visible_are_distinct(followup_env, monkeypatch):
    monkeypatch.setattr(followup, 'FOLLOWUP_COOLDOWN', timedelta(0))
    _, db, _, user, snapshot, attempt, writer, network = followup_env
    reader = FakeRead(error=AmazonReadError('get_listing_http_error', 404))
    first = poll(followup_env, reader)
    assert first['submissionStatus'] == 'accepted_initial'
    assert first['phase'] == 'not_found' and not first['currentVisibilityVerified']
    assert not first['published'] and first['causedByThisSubmission'] is None
    reader.error = None
    reader.response = listing(snapshot, issues=[{
        'code': 'ATTRIBUTE_MISSING', 'message': 'Falta un dato', 'severity': 'ERROR'}])
    second = poll(followup_env, reader)
    assert second['phase'] == 'issues'
    assert second['lastAuthoritativeObservation']['issues'][0]['code'] == 'ATTRIBUTE_MISSING'
    assert second['submissionStatus'] == 'accepted_initial'
    reader.response = listing(snapshot)
    third = poll(followup_env, reader)
    assert third['phase'] == 'listing_present' and not third['currentVisibilityVerified']
    reader.response = listing(snapshot, status=['DISCOVERABLE'])
    fourth = poll(followup_env, reader)
    assert fourth['phase'] == 'visible_current'
    assert fourth['currentVisibilityVerified'] is True
    assert fourth['retailLinkVerified'] is False and fourth['published'] is False
    assert fourth['lastAuthoritativeObservation']['snapshotMatch'] is True
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 4
    assert len(writer.calls) == 1 and network == {'put': 0, 'item': 0, 'schema': 0}


def test_failure_keeps_prior_evidence_but_does_not_claim_current_visibility(followup_env, monkeypatch):
    monkeypatch.setattr(followup, 'FOLLOWUP_COOLDOWN', timedelta(0))
    _, db, _, user, snapshot, attempt, _, _ = followup_env
    reader = FakeRead(response=listing(snapshot, status=['BUYABLE']))
    assert poll(followup_env, reader)['currentVisibilityVerified'] is True
    reader.response = {'sku': snapshot['sku'], 'issues': []}
    failed = poll(followup_env, reader)
    assert failed['phase'] == 'check_failed'
    assert failed['latestCheck']['errorCode'] == 'amazon_response_incomplete'
    assert failed['lastAuthoritativeObservation']['result'] == 'visible_current'
    assert failed['currentVisibilityVerified'] is False
    reader.response = listing(snapshot, title='Otra ficha', status=['DISCOVERABLE'])
    mismatch = poll(followup_env, reader)
    assert mismatch['phase'] == 'unmatched'
    assert mismatch['lastAuthoritativeObservation']['snapshotMatch'] is False
    assert not mismatch['currentVisibilityVerified']
    reader.error = AmazonReadError('get_listing_http_error', 404)
    absent = poll(followup_env, reader)
    assert absent['phase'] == 'not_found' and not absent['currentVisibilityVerified']
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 4


def test_rate_limit_is_read_error_and_does_not_repeat_the_put(followup_env):
    _, db, _, _, snapshot, attempt, writer, _ = followup_env
    reader = FakeRead(error=AmazonReadError('get_listing_http_error', 429))
    result = poll(followup_env, reader)
    assert result['phase'] == 'check_failed'
    assert result['latestCheck']['errorCode'] == 'amazon_read_unavailable'
    assert result['lastAuthoritativeObservation'] is None
    assert result['submissionStatus'] == 'accepted_initial'
    assert len(reader.calls) == 1 and len(writer.calls) == 1
    during_cooldown = poll(followup_env, reader)
    assert during_cooldown['latestCheck']['checkId'] == result['latestCheck']['checkId']
    assert during_cooldown['latestCheck']['errorCode'] == 'amazon_read_unavailable'
    assert len(reader.calls) == 1 and len(writer.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 1


def test_new_request_id_reuses_recent_check_then_one_get_after_cooldown(followup_env, monkeypatch):
    _, db, _, _, snapshot, _, writer, _ = followup_env
    reader = FakeRead(response=listing(snapshot))
    first_id = uuid4()
    first = poll(followup_env, reader, first_id)
    assert first['phase'] == 'listing_present' and len(reader.calls) == 1
    second = poll(followup_env, reader, uuid4())
    assert second['latestCheck']['checkId'] == first['latestCheck']['checkId']
    assert second['latestCheck']['requestId'] == str(first_id)
    assert len(reader.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 1
    # Expire the policy interval without rewriting immutable observation rows.
    monkeypatch.setattr(followup, 'FOLLOWUP_COOLDOWN', timedelta(0))
    replay = poll(followup_env, reader, first_id)
    assert replay['latestCheck']['checkId'] == first['latestCheck']['checkId']
    assert len(reader.calls) == 1
    third = poll(followup_env, reader, uuid4())
    assert third['latestCheck']['checkId'] != first['latestCheck']['checkId']
    assert len(reader.calls) == 2 and len(writer.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 2


def test_persisted_check_older_than_interval_allows_one_new_get(followup_env):
    _, db, _, user, snapshot, attempt, writer, _ = followup_env
    with db.connect() as c:
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,result,started_at,checked_at)
            VALUES(%s,%s,%s,%s,'done','not_found',
                   statement_timestamp()-interval '2 minutes',
                   statement_timestamp()-interval '2 minutes')''',
            (uuid4(), user['id'], attempt['attemptId'], uuid4()))
    reader = FakeRead(response=listing(snapshot))
    result = poll(followup_env, reader)
    assert result['phase'] == 'listing_present'
    assert len(reader.calls) == 1 and len(writer.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 2


def test_distinct_concurrent_request_ids_reserve_only_one_get(followup_env):
    _, db, _, _, snapshot, _, writer, _ = followup_env
    reader = FakeRead(response=listing(snapshot), delay=.05)
    with ThreadPoolExecutor(max_workers=2) as pool:
        outputs = list(pool.map(lambda _: poll(followup_env, reader, uuid4()), range(2)))
    assert len(reader.calls) == 1 and len(writer.calls) == 1
    assert {out['phase'] for out in outputs} <= {'checking', 'listing_present'}
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 1


def test_old_visible_observation_is_not_a_current_visibility_claim(followup_env):
    _, db, _, user, snapshot, attempt, _, _ = followup_env
    with db.connect() as c:
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,result,started_at,checked_at,
             asin,product_type_match,snapshot_match)
            VALUES(%s,%s,%s,%s,'done','visible_current',
                   now()-interval '2 hours',now()-interval '2 hours',
                   'B012345678',true,true)''',
            (uuid4(), user['id'], attempt['attemptId'], uuid4()))
        state = load_status(c, user, UUID(attempt['attemptId']))
    assert state['phase'] == 'visibility_check_stale'
    assert state['lastAuthoritativeObservation']['result'] == 'visible_current'
    assert state['currentVisibilityVerified'] is False


def test_abandoned_read_is_closed_before_a_new_safe_check(followup_env):
    _, db, _, user, snapshot, attempt, _, _ = followup_env
    abandoned_id = uuid4()
    with db.connect() as c:
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,started_at)
            VALUES(%s,%s,%s,%s,'checking',now()-interval '4 minutes')''',
            (abandoned_id, user['id'], attempt['attemptId'], uuid4()))
    reader = FakeRead(response=listing(snapshot))
    result = poll(followup_env, reader)
    assert result['phase'] == 'listing_present' and len(reader.calls) == 1
    with db.connect() as c:
        old = c.execute('SELECT status,error_code FROM amazon_publish_followups WHERE id=%s',
                        (abandoned_id,)).fetchone()
        assert old == {'status': 'read_error', 'error_code': 'check_interrupted'}
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 2


@pytest.mark.parametrize('age_seconds', [121, 151])
def test_slow_live_read_is_not_abandoned_before_provider_bound(followup_env, age_seconds):
    _, db, _, user, snapshot, attempt, writer, _ = followup_env
    reserved_id = uuid4()
    with db.connect() as c:
        c.execute('''INSERT INTO amazon_publish_followups
            (id,user_id,attempt_id,request_id,status,started_at)
            VALUES(%s,%s,%s,%s,'checking',
                   statement_timestamp()-(%s * interval '1 second'))''',
            (reserved_id, user['id'], attempt['attemptId'], uuid4(), age_seconds))
    reader = FakeRead(response=listing(snapshot))
    result = poll(followup_env, reader)
    assert result['phase'] == 'checking'
    assert result['latestCheck']['checkId'] == str(reserved_id)
    assert reader.calls == [] and len(writer.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 1


def test_idempotent_request_and_concurrent_checks_have_one_active_get(followup_env):
    _, db, _, user, snapshot, attempt, _, _ = followup_env
    reader = FakeRead(response=listing(snapshot), delay=.05)
    request_id = uuid4()
    def check(_):
        return poll(followup_env, reader, request_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        outputs = list(pool.map(check, range(2)))
    assert len(reader.calls) == 1
    assert {out['phase'] for out in outputs} <= {'checking', 'listing_present'}
    again = poll(followup_env, reader, request_id)
    assert again['phase'] == 'listing_present' and len(reader.calls) == 1
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 1


def test_cross_account_and_unaccepted_attempt_cannot_reconcile(followup_env):
    client, db, google, user, snapshot, attempt, _, network = followup_env
    path = '/api/products/BASIC/amazon-publish-attempts/' + attempt['attemptId']
    assert client.get(path).json()['phase'] == 'awaiting_amazon'
    assert client.get(path.replace('/BASIC/', '/OTHER/')).status_code == 404
    reader = FakeRead(response=listing(snapshot))
    with pytest.raises(HTTPException) as closed:
        reconcile_once(db, user, UUID(attempt['attemptId']), uuid4(), reader)
    assert closed.value.detail['error'] == 'amazon_followup_disabled'
    google.subject, google.email = 'other-amazon-account', 'other@example.test'
    login(client, google)
    ready(client, google, db)
    assert client.get(path).status_code == 404
    with db.connect() as c:
        other = c.execute('SELECT * FROM users WHERE google_subject=%s',
                          (google.subject,)).fetchone()
        with pytest.raises(HTTPException) as hidden:
            load_status(c, other, UUID(attempt['attemptId']))
        assert hidden.value.status_code == 404
    with pytest.raises(HTTPException) as hidden:
        reconcile_once(db, other, UUID(attempt['attemptId']), uuid4(), reader,
                       gate_open=True)
    assert hidden.value.status_code == 404
    with db.connect() as c:
        c.execute('''UPDATE amazon_publish_attempts SET status='invalid'
            WHERE id=%s''', (attempt['attemptId'],))
    with pytest.raises(HTTPException) as invalid:
        poll(followup_env, reader)
    assert invalid.value.detail['error'] == 'amazon_followup_not_eligible'
    assert reader.calls == [] and network == {'put': 0, 'item': 0, 'schema': 0}


def test_observation_is_immutable_and_product_deletion_cascades(followup_env):
    client, db, _, user, snapshot, attempt, _, _ = followup_env
    poll(followup_env, FakeRead(response=listing(snapshot)))
    with db.connect() as c:
        row = c.execute('SELECT * FROM amazon_publish_followups').fetchone()
        with pytest.raises(Exception, match='immutable'):
            c.execute('UPDATE amazon_publish_followups SET asin=asin WHERE id=%s',
                      (row['id'],))
        c.rollback()
    assert client.delete('/api/products/BASIC').status_code == 200
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_followups').fetchone()['n'] == 0
