"""Oferta y elección persistidas. Elegir periodicidad no contrata ni inicia la prueba."""
from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from .onboarding import StrictBody, require_user, onboarding_state
from .security import require_origin
from .billing_sync import subscription_payload
from .account_deletion_identity import trial_was_used
from .access import workspace_access


class SelectionBody(StrictBody):
    interval: Literal['monthly', 'annual']
    offerVersion: str = Field(min_length=1, max_length=80)


def current_offer(connection):
    return connection.execute('SELECT * FROM subscription_offers WHERE effective_at<=now() ORDER BY effective_at DESC, version DESC LIMIT 1').fetchone()


def offer_payload(connection, user, stripe, settings):
    offer = current_offer(connection)
    if not offer:
        raise HTTPException(503, detail={'error': 'offer_unavailable', 'message': 'El plan no está disponible ahora. Inténtalo de nuevo.'})
    chosen = connection.execute('SELECT interval, offer_version FROM subscription_selections WHERE user_id=%s', (user['id'],)).fetchone()
    pending = connection.execute("SELECT interval,ui_mode FROM billing_checkouts WHERE user_id=%s AND status IN ('creating','open')", (user['id'],)).fetchone()
    return {'offer': {'version': offer['version'], 'currency': offer['currency'], 'monthlyCents': offer['monthly_cents'],
                     'annualCents': offer['annual_cents'], 'trialDays': offer['trial_days'], 'reminderDays': offer['reminder_days'],
                     'taxIncluded': False, 'cardRequired': True},
            'selection': {'interval': chosen['interval'], 'offerVersion': chosen['offer_version']} if chosen else None,
            'checkoutReady': bool(stripe and stripe.ready),
            'embeddedReady': bool(stripe and getattr(stripe, 'embedded_ready', False)),
            'taxRatePercent': 21,
            'taxScope': 'sandbox_fixed_21',
            'access': workspace_access(connection, user),
            'subscription': subscription_payload(connection, user),
            'trialUsed': trial_was_used(connection, settings, user),
            'checkoutMode': pending['ui_mode'] if pending else None,
            'checkoutInterval': pending['interval'] if pending else None}


def routes(settings, database, stripe=None):
    router = APIRouter(prefix='/api/billing')

    @router.get('/onboarding-offer')
    def offer(request: Request):
        with database.connect() as connection:
            return offer_payload(connection, require_user(connection, request), stripe, settings)

    @router.put('/onboarding-selection')
    def select(body: SelectionBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            if onboarding_state(connection, user)['onboarding']['step'] != 'pending':
                raise HTTPException(409, detail={'error': 'profile_required', 'message': 'Completa tus datos antes de elegir la suscripción.'})
            pending = connection.execute("SELECT interval FROM billing_checkouts WHERE user_id=%s AND status IN ('creating','open')", (user['id'],)).fetchone()
            if pending and pending['interval'] != body.interval:
                raise HTTPException(409, detail={'error': 'checkout_open', 'message': 'Ya tienes un checkout abierto. Retoma esa modalidad antes de cambiarla.'})
            offer = current_offer(connection)
            if not offer or offer['version'] != body.offerVersion:
                raise HTTPException(409, detail={'error': 'offer_changed', 'message': 'El plan se ha actualizado. Recarga para revisar los importes.'})
            connection.execute('''INSERT INTO subscription_selections(user_id, offer_version, interval) VALUES (%s,%s,%s)
                ON CONFLICT(user_id) DO UPDATE SET offer_version=EXCLUDED.offer_version, interval=EXCLUDED.interval, updated_at=now()''',
                               (user['id'], body.offerVersion, body.interval))
            return offer_payload(connection, user, stripe, settings)

    return router
