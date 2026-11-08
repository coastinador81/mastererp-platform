"""Contrato transportable a Google y diagnóstico sin texto del cliente ni consumo inventado."""
from copy import deepcopy
import json
import pytest
import requests
from app.google_cloud_provider import CloudError
from app.product_reasoning_provider import (ProductReasoner, response_schema, decode_wire_response,
                                            validate_shape, PROMPT_VERSION)
from app.product_reasoning_diagnostics import rejection_diagnostics, safe_reasoning_diagnostics
from test_product_reasoning import context, responses, Reply


def test_google_transport_avoids_combinatorial_schema_and_keeps_server_contract():
    ctx = context()
    for verification in (False, True):
        schema = response_schema(ctx, verification)
        encoded = json.dumps(schema)
        assert all(key not in encoded for key in ('anyOf', 'nullable', 'maxItems'))
        assert schema['propertyOrdering'] == ['verdicts' if verification else 'decisions']
        assert schema['properties'][schema['propertyOrdering'][0]]['items']['properties']['targetId']['enum'] == [t['id'] for t in ctx['targets']]
    assert PROMPT_VERSION >= 4


@pytest.mark.parametrize('value', [False, True, 12, 2.5, 'wood', 'texto con "comillas" y ñ'])
def test_wire_scalars_decode_without_loss_or_string_coercion(value):
    data = {'decisions': [{'state': 'inferred', 'valueJson': json.dumps(value)}]}
    before = deepcopy(data); decoded = decode_wire_response(data, False)
    assert decoded['decisions'][0]['value'] == value
    assert type(decoded['decisions'][0]['value']) is type(value)
    assert 'valueJson' not in decoded['decisions'][0] and data == before


@pytest.mark.parametrize('wire', ['[]', '{}', 'NaN', 'Infinity', '-Infinity', 'false trailing', '', 'null'])
def test_invalid_or_missing_inferred_scalar_is_rejected(wire):
    with pytest.raises(CloudError):
        decode_wire_response({'decisions': [{'state': 'inferred', 'valueJson': wire}]}, False)


def test_unknown_state_has_no_value_and_unknown_target_is_still_rejected():
    assert 'value' not in decode_wire_response({'decisions': [{'state': 'unknown', 'valueJson': 'null'}]}, False)['decisions'][0]
    ctx = context(); proposal, _ = responses(ctx, 'blue'); proposal['decisions'][0]['targetId'] = 'not-a-target'
    with pytest.raises(CloudError): validate_shape(proposal, ctx, False)


class ErrorReply:
    def __init__(self, status, message, metadata=None):
        self.status_code, self.message, self.metadata = status, message, metadata
    def json(self):
        body = {'error': {'code': self.status_code, 'status': 'INVALID_ARGUMENT', 'message': self.message}}
        if self.metadata is not None: body['usageMetadata'] = self.metadata
        return body


@pytest.mark.parametrize('status', [400, 401, 403, 404, 413, 422, 429])
def test_known_http_rejection_is_not_timeout_or_reported_zero_tokens(monkeypatch, status):
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **k: ErrorReply(status, 'Request contains an invalid argument.'))
    with pytest.raises(CloudError) as caught: ProductReasoner().propose('secret', 'project', context())
    assert caught.value.usage == {'calls': 1, 'rejectedCalls': 1, 'usageReported': False}
    assert caught.value.diagnostics['httpStatus'] == status
    assert 'providerReason' in caught.value.diagnostics


def test_explicit_provider_usage_on_rejection_is_preserved(monkeypatch):
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **k: ErrorReply(400, 'Invalid argument', {'totalTokenCount': 9}))
    with pytest.raises(CloudError) as caught: ProductReasoner().propose('fake', 'project', context())
    assert caught.value.usage['usageReported'] is True and caught.value.usage['totalTokenCount'] == 9


def test_timeout_retains_uncertain_usage(monkeypatch):
    def timeout(*args, **kwargs): raise requests.Timeout('secret request')
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', timeout)
    with pytest.raises(CloudError) as caught: ProductReasoner().propose('fake', 'project', context())
    assert caught.value.usage['unconfirmedCalls'] == 1
    assert not caught.value.usage.get('rejectedCalls')


@pytest.mark.parametrize('message,reason', [
    ('Schema has too many states for serving', 'schema_complexity'),
    ('Unknown name "nullable" in response_schema', 'schema_keyword'),
    ('Invalid thinkingLevel setting', 'thinking_configuration'),
    ('maxOutputTokens outside range', 'output_limit'),
    ('Input token limit exceeded', 'input_limit'),
    ('Invalid image data', 'image_payload'),
    ('Request contains an invalid argument.', 'invalid_argument'),
])
def test_diagnostics_are_classified_without_echoing_untrusted_remote_message(message, reason):
    message += ' secret=SK_CLIENT_PRIVATE customer@example.test /Users/private/document.json'
    diagnostic, _ = rejection_diagnostics(ErrorReply(400, message))
    safe = safe_reasoning_diagnostics(diagnostic)
    assert safe['providerReason'] == reason
    assert len(safe['providerErrorFingerprint']) == 64
    assert all(part not in json.dumps(safe) for part in ('SK_CLIENT_PRIVATE', 'customer@example.test', '/Users/private'))
    assert safe_reasoning_diagnostics({'providerReason': 'bad', 'providerMessage': message}) == {}
