"""Checkout integrado: intención durable y acceso confirmado solo por el servidor."""
import re
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from typing import Literal
from pydantic import Field, field_validator
from .onboarding import StrictBody, require_user, onboarding_state
from .security import require_origin
from .subscription import current_offer
from .billing_sync import reconcile_user, subscription_payload
from .account_deletion_identity import trial_was_used
from .stripe_provider import unavailable
from .access import workspace_access
from .billing_diagnostics import CheckoutDiagnostic, record_diagnostic


class ConfirmBody(StrictBody):
    acceptRenewal: Literal[True]
    interval: Literal['monthly', 'annual']
    offerVersion: str = Field(min_length=1, max_length=80)

    @field_validator('acceptRenewal', mode='before')
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError('Confirma expresamente las renovaciones.')
        return value


def conflict(message, code='billing_state'):
    return HTTPException(409, detail={'error': code, 'message': message})


def billing_summary(offer, interval, trial_days):
    base = offer['monthly_cents'] if interval == 'monthly' else offer['annual_cents']
    tax = (base * 21 + 50) // 100
    return {'currency': 'EUR', 'interval': interval, 'baseCents': base, 'taxCents': tax,
            'totalCents': base + tax, 'dueTodayCents': 0 if trial_days else base + tax,
            'trialDays': trial_days, 'reminderDays': offer['reminder_days'], 'taxScope': 'sandbox_fixed_21'}


def checked_identity(session, attempt):
    identifier = session.get('id')
    if (session.get('livemode') is not False or session.get('mode') != 'subscription'
            or session.get('ui_mode') != 'embedded'
            or session.get('client_reference_id') != str(attempt['user_id'])
            or session.get('metadata', {}).get('uonify_checkout') != str(attempt['id'])
            or not isinstance(identifier, str) or not re.fullmatch(r'cs_test_[A-Za-z0-9_-]{1,240}', identifier)
            or (attempt['stripe_session'] and session.get('id') != attempt['stripe_session'])):
        raise unavailable()


def checked_session(session, attempt):
    checked_identity(session, attempt)
    if session.get('status') != 'open':
        raise conflict('Este pago ya no está abierto. Actualiza el estado para continuar.')
    # Stripe documenta un string opaco: ni sus separadores ni longitud son contrato.
    secret = session.get('client_secret')
    if (not isinstance(secret, str) or not secret or len(secret) > 8192
            or any(ord(char) < 32 or ord(char) == 127 for char in secret)):
        raise unavailable()
    return secret


def routes(settings, database, stripe):
    router = APIRouter()

    @router.post('/checkout-embedded')
    def checkout(body: ConfirmBody, request: Request):
        require_origin(request, settings.origin)
        if not getattr(stripe, 'embedded_ready', False):
            raise HTTPException(503, detail={'error': 'checkout_not_configured',
                'message': 'El pago integrado no está disponible todavía. Tu preparación está guardada.'})
        # La intención se confirma antes de Stripe. Dos aperturas comparten ID e idempotencia.
        with database.connect() as connection:
            user = require_user(connection, request)
            connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
            if onboarding_state(connection, user)['onboarding']['step'] != 'pending':
                raise conflict('Completa primero tus datos.')
            reconcile_user(connection, stripe, user)
            if connection.execute("SELECT 1 FROM billing_subscriptions WHERE user_id=%s AND status NOT IN ('canceled','incomplete_expired')", (user['id'],)).fetchone():
                raise conflict('Ya tienes una suscripción. Actualiza su estado para continuar.')
            attempt = connection.execute("SELECT * FROM billing_checkouts WHERE user_id=%s AND status IN ('creating','open')", (user['id'],)).fetchone()
            selection = connection.execute('SELECT * FROM subscription_selections WHERE user_id=%s', (user['id'],)).fetchone()
            offer = current_offer(connection)
            if not selection or selection['offer_version'] != offer['version']:
                raise conflict('Revisa y guarda la modalidad del plan vigente.')
            if body.interval != selection['interval'] or body.offerVersion != offer['version']:
                raise conflict('La modalidad o el precio han cambiado. Revisa el resumen antes de continuar.', 'offer_changed')
            if attempt and (attempt['ui_mode'] != 'embedded' or attempt['interval'] != selection['interval'] or attempt['offer_version'] != offer['version']):
                raise conflict('Hay un pago anterior abierto. Ciérralo antes de preparar el pago integrado.', 'checkout_open')
            if not attempt:
                from .onboarding_setup import require_setup_ready
                require_setup_ready(connection, user)
                attempt = connection.execute('''INSERT INTO billing_checkouts(id,user_id,offer_version,interval,trial_days,ui_mode,renewal_accepted_at)
                    VALUES(%s,%s,%s,%s,%s,'embedded',now()) RETURNING *''',
                    (uuid4(), user['id'], offer['version'], selection['interval'], 0 if trial_was_used(connection, settings, user) else offer['trial_days'])).fetchone()
        with database.connect() as connection:
            user = require_user(connection, request)
            attempt = connection.execute('SELECT * FROM billing_checkouts WHERE id=%s AND user_id=%s FOR UPDATE', (attempt['id'], user['id'])).fetchone()
            if not attempt or attempt['status'] not in ('creating', 'open'):
                raise conflict('El pago ya terminó. Actualiza el estado de tu suscripción.')
            old = connection.execute("SELECT created_at<now()-interval '23 hours' AS old FROM billing_checkouts WHERE id=%s", (attempt['id'],)).fetchone()['old']
            if old and not attempt['stripe_session']:
                raise conflict('Tenemos que comprobar el intento anterior antes de abrir otro pago.')
            session = stripe.checkout(attempt['stripe_session']) if attempt['stripe_session'] else stripe.create_checkout(attempt, user, offer)
            checked_identity(session, attempt)
            connection.execute("UPDATE billing_checkouts SET stripe_session=%s,status='open' WHERE id=%s", (session['id'], attempt['id']))
            # Conservar la referencia externa aun si Stripe no entrega el secreto:
            # un reintento/abandono debe poder consultar esta misma sesión.
            connection.commit()
            attempt = {**attempt, 'stripe_session': session.get('id')}
            secret = checked_session(session, attempt)
            return JSONResponse({'checkoutAttemptId': str(attempt['id']),
                'clientSecret': secret, 'publishableKey': stripe.publishable_key,
                'summary': billing_summary(offer, attempt['interval'], attempt['trial_days'])},
                headers={'Cache-Control': 'no-store'})

    @router.post('/checkout-status')
    def status(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            reconcile_user(connection, stripe, user)
            attempt = connection.execute('''SELECT status FROM billing_checkouts WHERE user_id=%s
                ORDER BY created_at DESC LIMIT 1''', (user['id'],)).fetchone()
            return {'subscription': subscription_payload(connection, user), 'access': workspace_access(connection, user),
                    'checkoutStatus': attempt['status'] if attempt else None}

    @router.post('/checkout-diagnostics')
    def diagnostics(body: CheckoutDiagnostic, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            record_diagnostic(connection, user, body)
        return JSONResponse({'recorded': True}, headers={'Cache-Control': 'no-store'})

    return router
