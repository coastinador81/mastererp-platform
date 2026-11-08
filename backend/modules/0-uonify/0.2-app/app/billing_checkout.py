"""Checkout autenticado, reintentos persistidos y cancelación desde la propia cuenta."""
from uuid import uuid4
from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException, Request
from .security import require_origin
from .onboarding import require_user, onboarding_state
from .subscription import current_offer
from .billing_sync import reconcile_user, subscription_payload, sync_attempt
from .stripe_provider import unavailable
from .account_deletion_identity import trial_was_used


def conflict(message):
    return HTTPException(409, detail={'error': 'billing_state', 'message': message})


def routes(settings, database, stripe):
    router = APIRouter(prefix='/api/billing')

    @router.post('/checkout')
    def checkout(request: Request):
        require_origin(request, settings.origin)
        if not stripe.ready:
            raise unavailable()
        # La intención se confirma ANTES de hablar con Stripe. Si la red falla, se reutiliza su clave de idempotencia.
        with database.connect() as connection:
            user = require_user(connection, request)
            connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
            if onboarding_state(connection, user)['onboarding']['step'] != 'pending':
                raise conflict('Completa primero tus datos.')
            selection = connection.execute('SELECT * FROM subscription_selections WHERE user_id=%s', (user['id'],)).fetchone()
            offer = current_offer(connection)
            if not selection or selection['offer_version'] != offer['version']:
                raise conflict('Guarda la modalidad del plan vigente antes de continuar.')
            reconcile_user(connection, stripe, user)
            existing = connection.execute("SELECT 1 FROM billing_subscriptions WHERE user_id=%s AND status NOT IN ('canceled','incomplete_expired')", (user['id'],)).fetchone()
            if existing:
                raise conflict('Ya tienes una suscripción. Puedes gestionarla desde tu cuenta.')
            attempt = connection.execute("SELECT * FROM billing_checkouts WHERE user_id=%s AND status IN ('creating','open')", (user['id'],)).fetchone()
            if attempt and (attempt['interval'] != selection['interval'] or attempt['offer_version'] != offer['version']):
                raise conflict('Tienes un checkout abierto. Retómalo o espera a que caduque antes de cambiar de modalidad.')
            if not attempt:
                from .onboarding_setup import require_setup_ready
                require_setup_ready(connection, user)
                used = trial_was_used(connection, settings, user)
                attempt = connection.execute('''INSERT INTO billing_checkouts(id,user_id,offer_version,interval,trial_days)
                    VALUES(%s,%s,%s,%s,%s) RETURNING *''', (uuid4(),user['id'],offer['version'],selection['interval'],0 if used else offer['trial_days'])).fetchone()
        with database.connect() as connection:
            user = require_user(connection, request)
            attempt = connection.execute('SELECT * FROM billing_checkouts WHERE id=%s AND user_id=%s FOR UPDATE', (attempt['id'],user['id'])).fetchone()
            if not attempt or attempt['status'] not in ('creating', 'open'):
                raise conflict('El checkout ya ha terminado. Actualiza el estado de tu suscripción.')
            if attempt.get('ui_mode', 'hosted') != 'hosted':
                raise conflict('Retoma el pago integrado desde esta conversación.')
            # Después de 23 horas, un intento sin ID exige conciliación; nunca recrear con idempotencia caducada.
            old = connection.execute("SELECT created_at < now()-interval '23 hours' AS old FROM billing_checkouts WHERE id=%s", (attempt['id'],)).fetchone()['old']
            if old and not attempt['stripe_session']:
                raise conflict('Tenemos que comprobar el intento anterior antes de abrir otro checkout.')
            session = stripe.checkout(attempt['stripe_session']) if attempt['stripe_session'] else stripe.create_checkout(attempt,user,offer)
            url = session.get('url', '')
            parsed = urlparse(url)
            if session.get('livemode') is not False or session.get('status') != 'open' or parsed.scheme != 'https' or parsed.netloc != 'checkout.stripe.com':
                raise unavailable()
            connection.execute("UPDATE billing_checkouts SET stripe_session=%s,status='open' WHERE id=%s", (session['id'],attempt['id']))
            return {'url': url}

    @router.post('/checkout/abandon')
    def abandon(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            reconcile_user(connection, stripe, user)
            attempt = connection.execute("SELECT * FROM billing_checkouts WHERE user_id=%s AND status IN ('creating','open')", (user['id'],)).fetchone()
            if attempt:
                if not attempt['stripe_session']:
                    raise conflict('Retoma primero el intento anterior para comprobar su estado.')
                session = stripe.request('POST', '/checkout/sessions/' + attempt['stripe_session'] + '/expire', {}, 'uonify-expire-' + str(attempt['id']))
                if session.get('status') != 'expired' or session.get('livemode') is not False:
                    raise unavailable()
                connection.execute("UPDATE billing_checkouts SET status='expired' WHERE id=%s", (attempt['id'],))
            return {'ok': True}

    @router.post('/subscription/refresh')
    def refresh(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            if stripe.ready:
                reconcile_user(connection, stripe, user)
            return {'subscription': subscription_payload(connection, user)}

    @router.post('/subscription/cancel')
    def cancel(request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            sub = connection.execute("SELECT * FROM billing_subscriptions WHERE user_id=%s AND status NOT IN ('canceled','incomplete_expired') ORDER BY updated_at DESC LIMIT 1", (user['id'],)).fetchone()
            if not sub:
                raise conflict('No tienes una suscripción activa que cancelar.')
            stripe.cancel(sub['stripe_id'])
            reconcile_user(connection, stripe, user)
            return {'subscription': subscription_payload(connection, user)}

    @router.post('/stripe/webhook')
    async def webhook(request: Request):
        raw = await request.body()
        if len(raw) > 131072:
            raise HTTPException(413)
        event = stripe.verify_event(raw, request.headers.get('stripe-signature', ''))
        obj = event.get('data', {}).get('object', {})
        with database.connect() as connection:
            if not connection.execute('INSERT INTO billing_events(id) VALUES(%s) ON CONFLICT DO NOTHING RETURNING id', (event['id'],)).fetchone():
                return {'received': True}
            attempt = connection.execute('''SELECT c.* FROM billing_checkouts c WHERE
                c.stripe_session=%s OR c.stripe_subscription=%s''', (obj.get('id'), obj.get('id') if obj.get('object') != 'invoice' else (obj.get('parent', {}).get('subscription_details') or {}).get('subscription', obj.get('subscription')))).fetchone()
            if attempt:
                # El evento solo despierta la conciliación; se consulta el estado actual para resistir eventos tardíos.
                user = connection.execute('SELECT id,deletion_requested_at FROM users WHERE id=%s FOR UPDATE',
                                          (attempt['user_id'],)).fetchone()
                if not user or user['deletion_requested_at']:
                    return {'received': True}
                sync_attempt(connection, stripe, attempt)
        return {'received': True}

    from .billing_embedded import routes as embedded_routes
    # Comparte autenticación, conciliación y el prefijo de facturación.
    router.include_router(embedded_routes(settings, database, stripe), prefix='')
    return router
