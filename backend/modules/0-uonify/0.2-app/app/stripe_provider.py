"""Adaptador exclusivo del sandbox autorizado; los secretos no salen del proceso."""
from pathlib import Path
import hashlib
import hmac
import json
import re
import time
import httpx
from fastapi import HTTPException

ACCOUNT = 'acct_1U8PiI8xfhaXW2oz'
PRICES = {'monthly': 'price_1UOg0x8xfhaXW2ozh42GYomG', 'annual': 'price_1UOg1i8xfhaXW2ozGhCVzlHJ'}
API_VERSION = '2025-06-30.basil'


def unavailable():
    return HTTPException(503, detail={'error': 'stripe_unavailable', 'message': 'No podemos conectar con Stripe ahora. Tu elección sigue guardada. Inténtalo de nuevo.'})


def flatten(data, prefix=''):
    result = {}
    for key, value in (enumerate(data) if isinstance(data, list) else data.items()):
        name = f'{prefix}[{key}]' if prefix else str(key)
        if isinstance(value, (list, dict)):
            result.update(flatten(value, name))
        elif value is not None:
            result[name] = str(value).lower() if isinstance(value, bool) else str(value)
    return result


class StripeProvider:
    def __init__(self, settings):
        self.directory = Path(settings.secrets_directory)
        self.origin = settings.origin

    @property
    def ready(self):
        return (self.directory / 'stripe-test-key').is_file() and (self.directory / 'stripe-test-vat21').is_file()

    @property
    def publishable_key(self):
        try:
            value = (self.directory / 'stripe-test-publishable-key').read_text().strip()
            return value if re.fullmatch(r'pk_test_[A-Za-z0-9]{16,240}', value) else None
        except OSError:
            return None

    @property
    def embedded_ready(self):
        return self.ready and self.publishable_key is not None

    def request(self, method, path, data=None, key=None):
        if not (self.directory / 'stripe-test-key').is_file() or not re.fullmatch(r'/[a-zA-Z0-9_/-]+', path):
            raise unavailable()
        try:
            secret = (self.directory / 'stripe-test-key').read_text().strip()
            if not secret.startswith(('sk_test_', 'rk_test_')):
                raise ValueError()
            headers = {'Authorization': 'Bearer ' + secret, 'Stripe-Version': API_VERSION}
            if key:
                headers['Idempotency-Key'] = key
            with httpx.Client(timeout=15, follow_redirects=False) as client:
                response = client.request(method, 'https://api.stripe.com/v1' + path, headers=headers,
                                          params=flatten(data or {}) if method == 'GET' else None,
                                          data=flatten(data or {}) if method != 'GET' else None)
            response.raise_for_status()
            payload = response.json()
            if payload.get('livemode') is True:
                raise ValueError()
            return payload
        except (OSError, ValueError, httpx.HTTPError):
            raise unavailable() from None

    def verify_catalog(self, offer, interval):
        account = self.request('GET', '/account')
        price = self.request('GET', '/prices/' + PRICES[interval])
        amount = offer['monthly_cents'] if interval == 'monthly' else offer['annual_cents']
        if (account['id'] != ACCOUNT or price.get('livemode') is not False or not price.get('active') or
                price.get('unit_amount') != amount or price.get('currency') != 'eur' or
                price.get('tax_behavior') != 'exclusive' or
                price.get('recurring', {}).get('interval') != ('month' if interval == 'monthly' else 'year') or
                price.get('recurring', {}).get('interval_count') != 1):
            raise unavailable()

    def create_checkout(self, attempt, user, offer):
        self.verify_catalog(offer, attempt['interval'])
        description = 'IVA de ejemplo para pruebas locales de Uonify'
        rates = self.request('GET', '/tax_rates', {'active': True, 'limit': 100})['data']
        tax = next((rate for rate in rates if rate.get('description') == description and rate.get('percentage') == 21 and not rate.get('inclusive') and rate.get('livemode') is False), None)
        if tax is None:
            tax = self.request('POST', '/tax_rates', {'display_name': 'IVA', 'description': description,
                               'percentage': 21, 'inclusive': False, 'country': 'ES'}, 'uonify-test-vat21-v1')
        data = {'mode': 'subscription', 'locale': 'es', 'client_reference_id': str(user['id']),
                'customer_email': user['email'], 'payment_method_types': ['card'], 'payment_method_collection': 'always',
                'billing_address_collection': 'required',
                'line_items': [{'price': PRICES[attempt['interval']], 'quantity': 1, 'tax_rates': [tax['id']]}],
                'metadata': {'uonify_checkout': str(attempt['id'])},
                'subscription_data': {'metadata': {'uonify_checkout': str(attempt['id'])},
                                      'trial_settings': {'end_behavior': {'missing_payment_method': 'cancel'}}},
                'success_url': self.origin + '/?billing=return', 'cancel_url': self.origin + '/?billing=cancel',
                'custom_text': {'submit': {'message': 'Tu tarjeta autoriza las renovaciones de Uonify. Puedes cancelar desde tu cuenta. El consumo de Google se factura por separado.'}}}
        if attempt['trial_days']:
            data['subscription_data']['trial_period_days'] = attempt['trial_days']
        if attempt.get('ui_mode') == 'embedded':
            if not self.embedded_ready:
                raise unavailable()
            data.pop('success_url'); data.pop('cancel_url')
            # Basil admite embedded; tarjeta/3DS se completan sin redirigir Uonify.
            data.update(ui_mode='embedded', redirect_on_completion='never')
        return self.request('POST', '/checkout/sessions', data, 'uonify-checkout-' + str(attempt['id']))

    def checkout(self, identity):
        return self.request('GET', '/checkout/sessions/' + identity)

    def verify_account(self):
        if self.request('GET', '/account').get('id') != ACCOUNT:
            raise unavailable()

    def checkout_sessions(self, start, end, after=None):
        return self.request('GET', '/checkout/sessions',
                            {'created': {'gte': start, 'lte': end}, 'limit': 100, 'starting_after': after})

    def customer_subscriptions(self, customer, after=None):
        return self.request('GET', '/subscriptions',
                            {'customer': customer, 'status': 'all', 'limit': 100, 'starting_after': after})

    def expire_checkout(self, identity, key):
        return self.request('POST', '/checkout/sessions/' + identity + '/expire', {}, key)

    def subscription(self, identity):
        return self.request('GET', '/subscriptions/' + identity)

    def invoices(self, identity):
        return self.request('GET', '/invoices', {'subscription': identity, 'status': 'paid', 'limit': 10})['data']

    def cancel(self, identity):
        return self.request('POST', '/subscriptions/' + identity, {'cancel_at_period_end': True}, 'uonify-cancel-' + identity)

    def cancel_immediately(self, identity):
        # DELETE is idempotent in Stripe; it does not use a POST idempotency key.
        return self.request('DELETE', '/subscriptions/' + identity, {'invoice_now': False, 'prorate': False})

    def preview(self, identity):
        return self.request('POST', '/invoices/create_preview', {'subscription': identity})

    def verify_event(self, raw, signature):
        try:
            secret = (self.directory / 'stripe-webhook-secret').read_text().strip()
            parts = [part.split('=', 1) for part in signature.split(',')]
            timestamp = next(value for key, value in parts if key == 't')
            expected = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
            if abs(time.time() - int(timestamp)) > 300 or not any(key == 'v1' and hmac.compare_digest(value, expected) for key, value in parts):
                raise ValueError()
            event = json.loads(raw)
            if event.get('livemode') is not False or not str(event.get('id', '')).startswith('evt_'):
                raise ValueError()
            return event
        except (OSError, ValueError, StopIteration, TypeError):
            raise HTTPException(400, detail={'error': 'invalid_signature', 'message': 'Firma no válida.'}) from None
