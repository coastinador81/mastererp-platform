"""Conciliador local: Stripe consultado desde la Mac, sin exponer un túnel público."""
import logging
import smtplib
import time
from datetime import timezone
from email.message import EmailMessage
from .database import Database
from .settings import load_settings
from .stripe_provider import StripeProvider
from .billing_sync import reconcile_user

log = logging.getLogger('uonify.billing')


def deliver_reminders(connection, stripe, user, send):
    rows = connection.execute('''SELECT r.*,s.trial_end,c.interval FROM billing_reminders r
        JOIN billing_subscriptions s ON s.stripe_id=r.subscription_id
        JOIN billing_checkouts c ON c.id=s.checkout_id
        WHERE s.user_id=%s AND s.status='trialing' AND NOT s.cancel_at_period_end
        AND r.delivered_at IS NULL AND r.canceled_at IS NULL AND r.due_at<=now() AND s.trial_end>now()
        FOR UPDATE OF r''', (user['id'],)).fetchall()
    for row in rows:
        invoice = stripe.preview(row['subscription_id'])
        if invoice.get('livemode') is not False or invoice.get('currency') != 'eur':
            continue
        amount = f"{invoice['total']/100:.2f}".replace('.', ',') + ' €'
        when = row['trial_end'].astimezone(timezone.utc).strftime('%d/%m/%Y a las %H:%M UTC')
        message = EmailMessage()
        message['From'] = 'Uonify <avisos@uonify.test>'
        message['To'] = user['email']
        message['Subject'] = 'Tu prueba de Uonify está a punto de terminar'
        message['Message-ID'] = '<uonify-trial-' + row['subscription_id'] + '@uonify.test>'
        period = 'mes' if row['interval'] == 'monthly' else 'año'
        message.set_content(f'Tu prueba termina el {when}. El primer cobro previsto es {amount}, impuestos incluidos, por {period}.\n\nPuedes cancelar antes de esa fecha sin coste de suscripción desde tu cuenta: {stripe.origin}/?billing=manage\n\nCancelar Uonify no cancela tus servicios externos de Google.\n')
        send(message)
        connection.execute('UPDATE billing_reminders SET delivered_at=now() WHERE subscription_id=%s', (row['subscription_id'],))


def send_local(message):
    # Buzón de pruebas sin salida a Internet; nunca afirma una entrega al correo real.
    with smtplib.SMTP('mailpit', 1025, timeout=10) as smtp:
        smtp.send_message(message)


def tick(database, stripe, send=send_local):
    if not stripe.ready:
        return
    with database.connect() as connection:
        users = connection.execute("SELECT DISTINCT user_id FROM billing_checkouts WHERE status!='expired'").fetchall()
    for row in users:
        try:
            with database.connect() as connection:
                user = connection.execute('SELECT * FROM users WHERE id=%s FOR UPDATE', (row['user_id'],)).fetchone()
                if not user or user.get('deletion_requested_at'):
                    continue
                reconcile_user(connection, stripe, user)
                deliver_reminders(connection, stripe, user, send)
        except Exception:
            # No registrar respuestas del proveedor ni datos del cliente.
            log.warning('Conciliación de pruebas pendiente; se reintentará en el siguiente ciclo.')


def main():
    settings = load_settings()
    database = Database(settings.database)
    database.migrate()
    stripe = StripeProvider(settings)
    while True:
        tick(database, stripe)
        time.sleep(30)


if __name__ == '__main__':
    main()
