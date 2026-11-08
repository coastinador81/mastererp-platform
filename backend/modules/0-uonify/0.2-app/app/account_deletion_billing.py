"""Cierre verificable de cobros antes del borrado; nunca crea otro checkout."""
from datetime import datetime, timezone
import re
from fastapi import HTTPException
from .stripe_provider import unavailable


def pending():
    return HTTPException(409, detail={'error': 'account_deletion_billing_pending',
        'message': 'Tenemos que comprobar un intento de suscripción antes de terminar de eliminar tu cuenta. Puedes volver a intentarlo.'})


def identity(value, prefix):
    if not isinstance(value, str) or not value.startswith(prefix) or not re.fullmatch(r'[A-Za-z0-9_]+', value):
        raise pending()
    return value


def checkout_reference(row):
    metadata = row.get('metadata')
    return metadata.get('uonify_checkout') if isinstance(metadata, dict) else None


def pages(fetch):
    after, seen = None, set()
    for _ in range(100):
        page = fetch(after)
        rows = page.get('data')
        if not isinstance(rows, list) or not isinstance(page.get('has_more'), bool):
            raise pending()
        for row in rows:
            if not isinstance(row, dict) or not row.get('id') or row['id'] in seen:
                raise pending()
            seen.add(row['id'])
            yield row
        if not page['has_more']:
            return
        if not rows:
            raise pending()
        after = rows[-1]['id']
    raise pending()


def checked_session(session, attempt, user):
    if not isinstance(session, dict):
        raise pending()
    identity(session.get('id'), 'cs_')
    if (session.get('livemode') is not False or session.get('mode') != 'subscription' or
            session.get('client_reference_id') != str(user['id']) or
            checkout_reference(session) != str(attempt['id']) or
            session.get('status') not in ('open', 'complete', 'expired')):
        raise pending()
    return session


def recover_session(stripe, attempt, user):
    if attempt['stripe_session']:
        session_id = identity(attempt['stripe_session'], 'cs_')
        session = checked_session(stripe.checkout(session_id), attempt, user)
        if session['id'] != session_id:
            raise pending()
        return session
    if attempt['status'] == 'expired' and not attempt['stripe_subscription']:
        return None
    # A persisted creating intent can outlive Stripe's 24-hour idempotency window.
    # Replaying create_checkout here could create a fresh object, so only list/read.
    created = attempt['created_at']
    if not isinstance(created, datetime) or created.tzinfo is None:
        raise pending()
    start, end = int(created.timestamp()) - 300, int(datetime.now(timezone.utc).timestamp())
    matches = [row for row in pages(lambda after: stripe.checkout_sessions(start, end, after))
               if checkout_reference(row) == str(attempt['id'])
               and row.get('client_reference_id') == str(user['id'])]
    if len(matches) != 1:
        raise pending()
    return checked_session(matches[0], attempt, user)


def checked_subscription(sub, attempt_id, customer):
    if not isinstance(sub, dict):
        raise pending()
    identity(sub.get('id'), 'sub_')
    if (sub.get('livemode') is not False or sub.get('customer') != customer or
            checkout_reference(sub) != attempt_id or
            not isinstance(sub.get('status'), str)):
        raise pending()
    return sub


def cleanup_billing(connection, stripe, user, deletion_id):
    """Owner freezes user writes first and persists the deletion request before calling.

    No local grants/reconciliation, customer deletion, refunds or invoice changes.
    Any uncertainty leaves the user/request available for a safe subsequent retry.
    """
    attempts = connection.execute('SELECT * FROM billing_checkouts WHERE user_id=%s ORDER BY created_at',
                                  (user['id'],)).fetchall()
    stored = connection.execute('SELECT * FROM billing_subscriptions WHERE user_id=%s',
                                (user['id'],)).fetchall()
    had_period = connection.execute("SELECT 1 FROM access_periods WHERE user_id=%s AND kind='trial' LIMIT 1",
                                    (user['id'],)).fetchone()
    trial_used = bool(had_period or any(row['trial_start'] is not None for row in stored))
    if not attempts and not stored:
        return {'trialUsed': trial_used, 'checkouts': 0, 'subscriptions': 0,
                'expiredSessions': [], 'canceledSubscriptions': []}
    if not stripe.ready:
        raise unavailable()
    stripe.verify_account()
    by_attempt = {str(row['id']): row for row in attempts}
    sessions, subscriptions, customers = {}, {}, {}
    for attempt in attempts:
        session = recover_session(stripe, attempt, user)
        if session:
            sessions[session['id']] = (session, attempt)
            if session.get('customer'):
                customer = identity(session['customer'], 'cus_')
                customers.setdefault(customer, set()).add(str(attempt['id']))
            if session.get('subscription'):
                sub_id = identity(session['subscription'], 'sub_')
                customer = identity(session.get('customer'), 'cus_')
                subscriptions[sub_id] = (str(attempt['id']), customer)
                customers.setdefault(customer, set()).add(str(attempt['id']))
            elif session['status'] == 'complete':
                raise pending()
        if attempt['stripe_subscription']:
            sub_id = identity(attempt['stripe_subscription'], 'sub_')
            if sub_id not in subscriptions:
                # Read authoritative ownership below even when the local checkout
                # record has not yet been reconciled after completion.
                sub = stripe.subscription(sub_id)
                customer = identity(sub.get('customer'), 'cus_')
                checked_subscription(sub, str(attempt['id']), customer)
                subscriptions[sub_id] = (str(attempt['id']), customer)
                customers.setdefault(customer, set()).add(str(attempt['id']))
    for row in stored:
        attempt_id, customer = str(row['checkout_id']), identity(row['customer_id'], 'cus_')
        if attempt_id not in by_attempt:
            raise pending()
        sub_id = identity(row['stripe_id'], 'sub_')
        if sub_id in subscriptions and subscriptions[sub_id] != (attempt_id, customer):
            raise pending()
        subscriptions[sub_id] = (attempt_id, customer)
        customers.setdefault(customer, set()).add(attempt_id)
    # Expire every payable link before canceling any subscription. A completion
    # racing the expire is read again and its resulting subscription is canceled.
    expired = []
    for session_id, (session, attempt) in sessions.items():
        if session['status'] == 'open':
            try:
                stripe.expire_checkout(session_id, f'uonify-delete-expire-{deletion_id}-{attempt["id"]}')
            except HTTPException:
                pass  # GET decides if expiry succeeded despite a network timeout.
            session = checked_session(stripe.checkout(session_id), attempt, user)
            if session['id'] != session_id:
                raise pending()
        if session['status'] == 'open':
            raise pending()
        if session['status'] == 'expired':
            expired.append(session_id)
        elif session.get('subscription'):
            customer = identity(session.get('customer'), 'cus_')
            customers.setdefault(customer, set()).add(str(attempt['id']))
            subscriptions[identity(session['subscription'], 'sub_')] = (str(attempt['id']), customer)
        else:
            raise pending()
    # All payable links are now closed. Discover subscriptions completed before
    # their webhook/local sync, including a completion racing the expiry call.
    for customer in customers:
        for sub in pages(lambda after: stripe.customer_subscriptions(customer, after)):
            attempt_id = checkout_reference(sub)
            if attempt_id not in by_attempt:
                # Never cancel another app's subscription merely by customer/email.
                if sub.get('status') not in ('canceled', 'incomplete_expired'):
                    raise pending()
                continue
            checked_subscription(sub, attempt_id, customer)
            subscriptions[identity(sub['id'], 'sub_')] = (attempt_id, customer)
    canceled = []
    for sub_id, (attempt_id, customer) in subscriptions.items():
        sub = checked_subscription(stripe.subscription(sub_id), attempt_id, customer)
        if sub['id'] != sub_id:
            raise pending()
        trial_used = trial_used or sub.get('trial_start') is not None
        if sub['status'] not in ('canceled', 'incomplete_expired'):
            try:
                stripe.cancel_immediately(sub_id)
            except HTTPException:
                pass  # A completed DELETE may have lost its response.
            sub = checked_subscription(stripe.subscription(sub_id), attempt_id, customer)
            if sub['id'] != sub_id:
                raise pending()
        if sub['status'] not in ('canceled', 'incomplete_expired'):
            raise pending()
        canceled.append(sub_id)
    return {'trialUsed': trial_used, 'checkouts': len(sessions), 'subscriptions': len(subscriptions),
            'expiredSessions': expired, 'canceledSubscriptions': canceled}
