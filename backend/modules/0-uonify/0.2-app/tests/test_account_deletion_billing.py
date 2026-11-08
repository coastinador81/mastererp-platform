"""No external provider: retries, ownership and ambiguous cleanup use fixtures."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import HTTPException
from app.account_deletion_billing import cleanup_billing
from app.stripe_provider import ACCOUNT, StripeProvider, unavailable


class Result:
    def __init__(self, rows): self.rows = rows
    def fetchall(self): return self.rows
    def fetchone(self): return self.rows[0] if self.rows else None


class Connection:
    def __init__(self, attempts=(), subscriptions=(), trial=False):
        self.attempts, self.subscriptions, self.trial = list(attempts), list(subscriptions), trial

    def execute(self, query, params):
        assert params and 'DELETE' not in query and 'UPDATE' not in query and 'INSERT' not in query
        if 'billing_checkouts' in query: return Result(self.attempts)
        if 'billing_subscriptions' in query: return Result(self.subscriptions)
        if 'access_periods' in query: return Result([{'exists': 1}] if self.trial else [])
        raise AssertionError(query)


class Stripe:
    ready = True

    def __init__(self, sessions=(), subscriptions=()):
        self.sessions = {row['id']: deepcopy(row) for row in sessions}
        self.subs = {row['id']: deepcopy(row) for row in subscriptions}
        self.calls, self.lose_expire, self.lose_cancel = [], False, False
        self.expire_failure, self.cancel_failure, self.complete_on_expire = False, False, None

    def verify_account(self): self.calls.append(('verify_account',))
    def checkout(self, identity): return deepcopy(self.sessions[identity])
    def subscription(self, identity): return deepcopy(self.subs[identity])

    def checkout_sessions(self, start, end, after=None):
        self.calls.append(('list_sessions', start, end, after))
        rows = list(self.sessions.values())
        if after: rows = rows[next(i for i, row in enumerate(rows) if row['id'] == after)+1:]
        return {'data': deepcopy(rows[:1]), 'has_more': len(rows) > 1}

    def customer_subscriptions(self, customer, after=None):
        self.calls.append(('list_subscriptions', customer, after))
        rows = [row for row in self.subs.values() if row['customer'] == customer]
        if after: rows = rows[next(i for i, row in enumerate(rows) if row['id'] == after)+1:]
        return {'data': deepcopy(rows[:1]), 'has_more': len(rows) > 1}

    def expire_checkout(self, identity, key):
        self.calls.append(('expire', identity, key))
        if self.complete_on_expire:
            self.sessions[identity].update(status='complete', customer='cus_owner', subscription=self.complete_on_expire)
            raise unavailable()
        if self.expire_failure: raise unavailable()
        self.sessions[identity]['status'] = 'expired'
        if self.lose_expire: raise unavailable()
        return deepcopy(self.sessions[identity])

    def cancel_immediately(self, identity):
        self.calls.append(('cancel', identity))
        if self.cancel_failure: raise unavailable()
        self.subs[identity]['status'] = 'canceled'
        if self.lose_cancel: raise unavailable()
        return deepcopy(self.subs[identity])

    def create_checkout(self, *_): raise AssertionError('Cleanup must never create another checkout')


def objects(status='open', subscription=False):
    user = {'id': uuid4(), 'email': 'owner@example.test'}
    attempt = {'id': uuid4(), 'user_id': user['id'], 'created_at': datetime.now(timezone.utc),
               'stripe_session': 'cs_test_owner', 'stripe_subscription': 'sub_owner' if subscription else None,
               'status': status, 'trial_days': 14, 'interval': 'monthly'}
    session = {'id': 'cs_test_owner', 'livemode': False, 'mode': 'subscription', 'status': status,
               'client_reference_id': str(user['id']), 'metadata': {'uonify_checkout': str(attempt['id'])},
               'customer': 'cus_owner' if subscription else None, 'subscription': 'sub_owner' if subscription else None}
    sub = {'id': 'sub_owner', 'livemode': False, 'customer': 'cus_owner', 'status': 'trialing',
           'metadata': {'uonify_checkout': str(attempt['id'])}, 'trial_start': 1700000000}
    stored = {'stripe_id': 'sub_owner', 'checkout_id': attempt['id'], 'customer_id': 'cus_owner',
              'trial_start': datetime.now(timezone.utc), 'user_id': user['id']}
    return user, attempt, session, sub, stored


def test_no_stripe_objects_needs_no_provider_or_secret():
    result = cleanup_billing(Connection(trial=True), SimpleNamespace(ready=False), {'id': uuid4()}, uuid4())
    assert result == {'trialUsed': True, 'checkouts': 0, 'subscriptions': 0,
                      'expiredSessions': [], 'canceledSubscriptions': []}


def test_missing_provider_when_objects_exist_is_unavailable_not_success():
    user, attempt, _, _, _ = objects()
    with pytest.raises(HTTPException) as error:
        cleanup_billing(Connection([attempt]), SimpleNamespace(ready=False), user, uuid4())
    assert error.value.status_code == 503


def test_expire_open_link_and_retries_have_no_second_mutation():
    user, attempt, session, _, _ = objects()
    stripe = Stripe([session]); connection = Connection([attempt]); deletion = uuid4()
    first = cleanup_billing(connection, stripe, user, deletion)
    assert cleanup_billing(connection, stripe, user, deletion) == first
    expires = [call for call in stripe.calls if call[0] == 'expire']
    assert expires == [('expire', session['id'], f'uonify-delete-expire-{deletion}-{attempt["id"]}')]
    assert first['expiredSessions'] == [session['id']] and first['trialUsed'] is False


def test_cancel_immediately_all_owned_subscriptions_including_paged_untracked_one():
    user, attempt, session, sub, stored = objects('complete', True)
    extra = {**sub, 'id': 'sub_untracked', 'status': 'active'}
    stripe = Stripe([session], [sub, extra]); connection = Connection([attempt], [stored])
    result = cleanup_billing(connection, stripe, user, uuid4())
    assert result['trialUsed'] is True and result['subscriptions'] == 2
    assert set(result['canceledSubscriptions']) == {'sub_owner', 'sub_untracked'}
    assert all(row['status'] == 'canceled' for row in stripe.subs.values())
    assert any(call[0] == 'list_subscriptions' and call[-1] == 'sub_owner' for call in stripe.calls)


def test_recover_old_creating_only_by_paged_list_never_replays_create():
    user, attempt, session, _, _ = objects()
    attempt.update(stripe_session=None, status='creating', created_at=datetime.now(timezone.utc)-timedelta(days=3))
    unrelated = {**session, 'id': 'cs_test_other', 'client_reference_id': 'another-user'}
    stripe = Stripe([unrelated, session])
    result = cleanup_billing(Connection([attempt]), stripe, user, uuid4())
    assert result['expiredSessions'] == ['cs_test_owner']
    assert stripe.sessions['cs_test_other']['status'] == 'open'
    assert any(call[0] == 'list_sessions' and call[-1] == 'cs_test_other' for call in stripe.calls)


@pytest.mark.parametrize('matching', [0, 2])
def test_ambiguous_creating_is_pending_and_never_expires_or_deletes(matching):
    user, attempt, session, _, _ = objects()
    attempt.update(stripe_session=None, status='creating')
    stripe = Stripe([{**session, 'id': f'cs_test_{i}'} for i in range(matching)])
    with pytest.raises(HTTPException) as error:
        cleanup_billing(Connection([attempt]), stripe, user, uuid4())
    assert error.value.status_code == 409
    assert not any(call[0] in ('expire', 'cancel') for call in stripe.calls)


@pytest.mark.parametrize('change', [
    {'livemode': True}, {'client_reference_id': 'another-user'}, {'mode': 'payment'},
    {'metadata': {'uonify_checkout': 'another-attempt'}}, {'id': 'cs_test_wrong'},
])
def test_foreign_or_unexpected_session_never_mutates(change):
    user, attempt, session, _, _ = objects()
    stripe = Stripe([session]); stripe.sessions[session['id']].update(change)
    with pytest.raises(HTTPException): cleanup_billing(Connection([attempt]), stripe, user, uuid4())
    assert not any(call[0] in ('expire', 'cancel') for call in stripe.calls)


def test_foreign_active_subscription_on_same_customer_blocks_without_cancellation():
    user, attempt, session, sub, stored = objects('complete', True)
    foreign = {**sub, 'id': 'sub_foreign', 'metadata': {'uonify_checkout': 'not-this-user'}}
    stripe = Stripe([session], [sub, foreign])
    with pytest.raises(HTTPException): cleanup_billing(Connection([attempt], [stored]), stripe, user, uuid4())
    assert not any(call[0] == 'cancel' for call in stripe.calls)


@pytest.mark.parametrize('change', [
    {'livemode': True}, {'customer': 'cus_other'}, {'metadata': None},
    {'metadata': {'uonify_checkout': 'another-attempt'}},
])
def test_known_subscription_ownership_and_sandbox_are_verified_before_cancel(change):
    user, attempt, session, sub, stored = objects('complete', True)
    stripe = Stripe([session], [{**sub, **change}])
    with pytest.raises(HTTPException): cleanup_billing(Connection([attempt], [stored]), stripe, user, uuid4())
    assert not any(call[0] == 'cancel' for call in stripe.calls)


def test_lost_expire_and_cancel_responses_are_verified_by_get():
    user, attempt, session, sub, stored = objects('open', True)
    stripe = Stripe([session], [sub]); stripe.lose_expire = stripe.lose_cancel = True
    result = cleanup_billing(Connection([attempt], [stored]), stripe, user, uuid4())
    assert result['expiredSessions'] == ['cs_test_owner']
    assert result['canceledSubscriptions'] == ['sub_owner']


@pytest.mark.parametrize('failure', ['expire_failure', 'cancel_failure'])
def test_unconfirmed_external_close_is_pending_not_success(failure):
    user, attempt, session, sub, stored = objects('open', True)
    stripe = Stripe([session], [sub]); setattr(stripe, failure, True)
    with pytest.raises(HTTPException) as error:
        cleanup_billing(Connection([attempt], [stored]), stripe, user, uuid4())
    assert error.value.status_code == 409


def test_checkout_completing_during_expire_cancels_its_resulting_subscription():
    user, attempt, session, sub, _ = objects()
    stripe = Stripe([session], [sub]); stripe.complete_on_expire = 'sub_owner'
    result = cleanup_billing(Connection([attempt]), stripe, user, uuid4())
    assert result['trialUsed'] is True
    assert result['canceledSubscriptions'] == ['sub_owner']


def test_open_checkout_customer_discovers_subscription_missing_from_local_records():
    user, attempt, session, sub, _ = objects()
    session['customer'] = 'cus_owner'
    stripe = Stripe([session], [sub])
    result = cleanup_billing(Connection([attempt]), stripe, user, uuid4())
    assert result['expiredSessions'] == ['cs_test_owner']
    assert result['canceledSubscriptions'] == ['sub_owner']
    mutations = [call[0] for call in stripe.calls if call[0] in ('expire', 'cancel')]
    assert mutations == ['expire', 'cancel']


def test_already_canceled_subscription_and_expired_checkout_require_no_mutation():
    user, attempt, session, sub, stored = objects('expired', True)
    sub['status'] = 'canceled'; stripe = Stripe([session], [sub])
    result = cleanup_billing(Connection([attempt], [stored]), stripe, user, uuid4())
    assert result['trialUsed'] is True
    assert not any(call[0] in ('expire', 'cancel') for call in stripe.calls)


def test_provider_wrappers_use_stable_expire_and_non_invoicing_delete(tmp_path):
    stripe = StripeProvider(SimpleNamespace(secrets_directory=str(tmp_path), origin='http://127.0.0.1:5173'))
    calls = []
    def request(method, path, data=None, key=None):
        calls.append((method, path, data, key))
        return {'id': ACCOUNT}
    stripe.request = request
    stripe.verify_account()
    stripe.checkout_sessions(10, 20, 'cs_test_previous')
    stripe.customer_subscriptions('cus_owner', 'sub_previous')
    stripe.expire_checkout('cs_test_owner', 'stable-key')
    stripe.cancel_immediately('sub_owner')
    assert calls[0] == ('GET', '/account', None, None)
    assert calls[1] == ('GET', '/checkout/sessions', {'created': {'gte': 10, 'lte': 20}, 'limit': 100, 'starting_after': 'cs_test_previous'}, None)
    assert calls[2] == ('GET', '/subscriptions', {'customer': 'cus_owner', 'status': 'all', 'limit': 100, 'starting_after': 'sub_previous'}, None)
    assert calls[3] == ('POST', '/checkout/sessions/cs_test_owner/expire', {}, 'stable-key')
    assert calls[4] == ('DELETE', '/subscriptions/sub_owner', {'invoice_now': False, 'prorate': False}, None)
