"""Conciliación autoritativa: nunca concede acceso por parámetros del navegador."""
from datetime import datetime, timezone
from uuid import uuid4
from .stripe_provider import PRICES, unavailable


def date(value):
    return datetime.fromtimestamp(value, timezone.utc) if value else None


def grant(connection, user_id, kind, start, end, reference):
    if not start or not end or end <= start:
        return
    # Un evento repetido no extiende ni vuelve a crear el periodo.
    connection.execute('''INSERT INTO access_periods(id,user_id,kind,starts_at,ends_at,source_reference)
        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(source_reference) DO NOTHING''',
                       (uuid4(), user_id, kind, date(start), date(end), reference))


def sync_subscription(connection, stripe, attempt, session):
    identity = session.get('subscription')
    if not identity or session.get('status') != 'complete':
        return
    sub = stripe.subscription(identity)
    items = sub.get('items', {}).get('data', [])
    if (sub.get('livemode') is not False or len(items) != 1 or items[0].get('quantity') != 1 or
            items[0].get('price', {}).get('id') != PRICES[attempt['interval']] or
            sub.get('metadata', {}).get('uonify_checkout') != str(attempt['id']) or
            session.get('customer') != sub.get('customer')):
        raise unavailable()
    start, end = sub.get('trial_start'), sub.get('trial_end')
    valid_trial = (attempt['trial_days'] > 0 and start and end and 0 < end - start <= attempt['trial_days'] * 86400)
    if sub['status'] == 'trialing' and (not valid_trial or not sub.get('default_payment_method')):
        raise unavailable()
    connection.execute('''INSERT INTO billing_subscriptions
        (stripe_id,user_id,checkout_id,customer_id,status,cancel_at_period_end,trial_start,trial_end,period_end)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(stripe_id) DO UPDATE SET
        status=EXCLUDED.status,cancel_at_period_end=EXCLUDED.cancel_at_period_end,
        period_end=EXCLUDED.period_end,updated_at=now()''',
        (identity, attempt['user_id'], attempt['id'], sub['customer'], sub['status'],
         sub.get('cancel_at_period_end', False), date(start), date(end), date(items[0].get('current_period_end'))))
    connection.execute("UPDATE billing_checkouts SET status='complete',stripe_subscription=%s WHERE id=%s", (identity, attempt['id']))
    if valid_trial and sub['status'] in ('trialing', 'active', 'past_due'):
        grant(connection, attempt['user_id'], 'trial', start, end, 'stripe:trial:' + identity)
        connection.execute('''INSERT INTO billing_reminders(subscription_id,due_at)
            VALUES(%s,%s - interval '3 days') ON CONFLICT DO NOTHING''', (identity, date(end)))
    if sub.get('cancel_at_period_end') or sub['status'] == 'canceled':
        connection.execute('UPDATE billing_reminders SET canceled_at=now() WHERE subscription_id=%s', (identity,))
    # «active» no prueba un cobro. Solo una factura pagada del precio contratado concede periodo pagado.
    for invoice in stripe.invoices(identity):
        parent = invoice.get('parent', {}).get('subscription_details') or {}
        if (invoice.get('livemode') is not False or invoice.get('status') != 'paid' or invoice.get('amount_paid', 0) <= 0 or
                parent.get('subscription', invoice.get('subscription')) != identity):
            continue
        for line in invoice.get('lines', {}).get('data', []):
            price_id = (line.get('pricing', {}).get('price_details') or {}).get('price')
            if price_id != PRICES[attempt['interval']] or line.get('amount', 0) <= 0:
                continue
            period = line.get('period', {})
            grant(connection, attempt['user_id'], 'paid', period.get('start'), period.get('end'), 'stripe:invoice:' + invoice['id'] + ':' + line['id'])


def sync_attempt(connection, stripe, attempt):
    if not attempt['stripe_session']:
        return
    session = stripe.checkout(attempt['stripe_session'])
    if (session.get('livemode') is not False or session.get('mode') != 'subscription' or
            session.get('client_reference_id') != str(attempt['user_id']) or
            session.get('metadata', {}).get('uonify_checkout') != str(attempt['id'])):
        raise unavailable()
    if session.get('status') == 'expired':
        connection.execute("UPDATE billing_checkouts SET status='expired' WHERE id=%s", (attempt['id'],))
    else:
        sync_subscription(connection, stripe, attempt, session)


def reconcile_user(connection, stripe, user):
    attempts = connection.execute("SELECT * FROM billing_checkouts WHERE user_id=%s AND status!='expired' ORDER BY created_at", (user['id'],)).fetchall()
    for attempt in attempts:
        sync_attempt(connection, stripe, attempt)


def subscription_payload(connection, user):
    sub = connection.execute('''SELECT s.*,c.interval FROM billing_subscriptions s JOIN billing_checkouts c ON c.id=s.checkout_id
        WHERE s.user_id=%s ORDER BY c.created_at DESC LIMIT 1''', (user['id'],)).fetchone()
    if not sub:
        return None
    return {'status': sub['status'], 'cancelAtPeriodEnd': sub['cancel_at_period_end'], 'interval': sub['interval'],
            'trialEndsAt': sub['trial_end'].isoformat() if sub['trial_end'] else None,
            'periodEndsAt': sub['period_end'].isoformat() if sub['period_end'] else None}
