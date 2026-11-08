from dataclasses import replace
import hashlib
import hmac
import json
import time
import pytest
from fastapi import HTTPException
from app.stripe_provider import StripeProvider, flatten


def test_signed_webhook_rejects_bad_replayed_and_live_events(environment, tmp_path):
    config, _, _ = environment
    # Valor ficticio de fixture, nunca una credencial externa.
    secret = 'fixture-webhook-secret'
    (tmp_path / 'stripe-webhook-secret').write_text(secret)
    stripe = StripeProvider(replace(config, secrets_directory=str(tmp_path)))
    def signed(payload, timestamp):
        raw = json.dumps(payload).encode()
        signature = hmac.new(secret.encode(), str(timestamp).encode()+b'.'+raw, hashlib.sha256).hexdigest()
        return raw, f't={timestamp},v1={signature}'
    event = {'id':'evt_verified','livemode':False,'data':{'object':{'id':'cs_test_one'}}}
    raw, signature = signed(event, int(time.time()))
    assert stripe.verify_event(raw, signature)['id'] == 'evt_verified'
    for body, header in [(raw+b' ', signature),(raw, 'broken'), signed(event, int(time.time())-301),signed({**event,'livemode':True}, int(time.time()))]:
        with pytest.raises(HTTPException) as error:
            stripe.verify_event(body, header)
        assert error.value.status_code == 400


def test_checkout_contract_always_collects_card_and_uses_pinned_catalog(environment):
    config, _, _ = environment
    stripe = StripeProvider(config)
    calls = []
    stripe.verify_catalog = lambda *_: None
    def request(method, path, data=None, key=None):
        calls.append((method,path,data,key))
        return {'data': []} if method == 'GET' else {'id':'txr_test'} if path == '/tax_rates' else {'id':'cs_test_fixture'}
    stripe.request = request
    stripe.create_checkout({'id':'attempt','interval':'monthly','trial_days':14}, {'id':'user','email':'user@example.test'}, {})
    _, path, data, key = calls[-1]
    assert path == '/checkout/sessions' and data['payment_method_collection'] == 'always'
    assert data['subscription_data']['trial_period_days'] == 14
    assert data['payment_method_types'] == ['card']
    assert data['line_items'][0]['quantity'] == 1
    assert key == 'uonify-checkout-attempt'
    assert flatten(data)['line_items[0][tax_rates][0]'] == 'txr_test'
