"""Salidas pagadas reanalizables, diagnóstico exacto y tipos sin coerciones."""
from copy import deepcopy
import json
import pytest
from app.google_cloud_provider import CloudError
from app.product_reasoning_provider import ProductReasoner, decode_wire_response, validate_shape
from app.product_reasoning_diagnostics import safe_reasoning_diagnostics
from test_product_reasoning import context, responses, leaf


class RawReply:
    status_code = 200
    def __init__(self, text, finish='STOP'):
        self.text, self.finish = text, finish
    def json(self):
        return {'usageMetadata': {'totalTokenCount': 166987, 'promptTokenCount': 160000, 'candidatesTokenCount': 2000,
                                  'thoughtsTokenCount': 4987},
                'candidates': [{'finishReason': self.finish, 'content': {'parts': [
                    {'thought': True, 'text': 'PRIVATE_THOUGHT_NOT_TO_STORE'}, {'text': self.text}]}}]}


def wire(ctx):
    proposal, _ = responses(ctx, 'blue')
    item = proposal['decisions'][0]
    item['valueJson'] = json.dumps(item.pop('value')); item['requestedEvidenceRefs'] = []
    return proposal


@pytest.mark.parametrize('mutation,reason,decoded', [
    (lambda p: p['decisions'][0].update(valueJson='wood'), 'value_json_invalid', False),
    (lambda p: p['decisions'][0].update(valueJson='{}'), 'value_not_scalar', False),
    (lambda p: p['decisions'][0].update(valueJson='null'), 'value_null_inferred', False),
    (lambda p: p['decisions'][0].update(targetId='invented@example.com'), 'target_id_unknown', True),
    (lambda p: p['decisions'][0].update(basis='imagined'), 'basis_invalid', True),
    (lambda p: p['decisions'][0].update(evidenceRefs=['invented@example.com']), 'evidence_ref_unknown', True),
    (lambda p: p['decisions'][0].update(requestedEvidenceRefs=['missing']), 'requested_ref_unknown', True),
    (lambda p: p['decisions'][0].update(evidenceRefs=['r'] * 13), 'evidence_refs_limit', True),
    (lambda p: p['decisions'][0].update(valueJson='false'), 'value_type_invalid', True),
])
def test_paid_rejected_output_kept_without_thoughts_and_failure_is_precise(monkeypatch, mutation, reason, decoded):
    ctx = context(); payload = wire(ctx); mutation(payload)
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **kw: RawReply(json.dumps(payload)))
    with pytest.raises(CloudError) as caught: ProductReasoner().propose('SECRET_TOKEN', 'project', ctx)
    error = caught.value
    assert error.rejectedResponse == payload
    assert hasattr(error, 'decodedResponse') is decoded
    assert error.diagnostics['validationReason'] == reason
    assert error.diagnostics['itemIndex'] == 0 and error.diagnostics['outputCharacters'] > 0
    assert error.usage['totalTokenCount'] == 166987 and 'unconfirmedCalls' not in error.usage
    assert all(s not in json.dumps(error.diagnostics) for s in ('invented@example.com', 'SECRET_TOKEN', 'PRIVATE_THOUGHT'))
    assert 'PRIVATE_THOUGHT' not in json.dumps(error.rejectedResponse)


def test_non_json_final_output_is_retained_for_offline_recovery_without_thoughts(monkeypatch):
    text = '{"decisions":['
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **kw: RawReply(text, 'MAX_TOKENS'))
    with pytest.raises(CloudError) as caught: ProductReasoner().propose('secret', 'project', context())
    assert caught.value.rejectedResponse == text
    assert caught.value.diagnostics['validationReason'] == 'output_invalid_json'
    assert caught.value.diagnostics['finishReason'] == 'MAX_TOKENS'
    assert caught.value.usage['totalTokenCount'] == 166987


def test_paid_result_can_be_revalidated_locally_without_network(monkeypatch):
    ctx = context(); payload = wire(ctx); payload['decisions'][0]['basis'] = 'not_applicable'
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **kw: RawReply(json.dumps(payload)))
    with pytest.raises(CloudError) as caught: ProductReasoner().propose('secret', 'project', ctx)
    # Una corrección explícita revisada del contrato se comprueba sobre salida conservada.
    offline = deepcopy(caught.value.rejectedResponse)
    offline['decisions'][0]['basis'] = 'direct_document'
    def no_network(*a, **kw): raise AssertionError('No nueva llamada pagada')
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', no_network)
    parsed = validate_shape(decode_wire_response(offline, False), ctx, False)
    assert parsed['decisions'][0]['value'] == 'blue'


@pytest.mark.parametrize('state', ['unknown', 'conflict', 'needs_evidence'])
@pytest.mark.parametrize('basis', ['not_applicable', '', 'none'])
def test_non_inferred_basis_cannot_block_irresolvable_decision_or_save_a_value(state, basis):
    ctx = context(); payload = wire(ctx)
    payload['decisions'][0].update(state=state, basis=basis, valueJson='null', evidenceRefs=[])
    result = validate_shape(decode_wire_response(payload, False), ctx, False)
    assert 'value' not in result['decisions'][0]


@pytest.mark.parametrize('kind,value,valid', [('integer', True, False), ('number', True, False),
    ('boolean', 'false', False), ('string', False, False), ('integer', 2.5, False),
    ('boolean', False, True), ('integer', 2, True), ('number', 2.5, True), ('string', 'false', True)])
def test_inferred_values_keep_amazon_native_subtypes(kind, value, valid):
    ctx = context(properties={'sample_field': leaf(kind)}); proposal, _ = responses(ctx, value)
    if valid: assert validate_shape(proposal, ctx, False)['decisions'][0]['value'] == value
    else:
        with pytest.raises(CloudError) as caught: validate_shape(proposal, ctx, False)
        assert caught.value.diagnostics['validationReason'] == 'value_type_invalid'


def test_rejected_verdict_may_have_no_inference_basis_but_accepted_requires_one():
    ctx = context(); _, verdict = responses(ctx, 'blue')
    verdict['verdicts'][0].update(accepted=False, basis='not_applicable', resolution='unknown')
    assert validate_shape(verdict, ctx, True)['verdicts'][0]['accepted'] is False
    verdict['verdicts'][0]['accepted'] = True
    with pytest.raises(CloudError) as caught: validate_shape(verdict, ctx, True)
    assert caught.value.diagnostics['validationReason'] == 'basis_invalid'


def test_diagnostics_only_accept_closed_codes_and_numeric_stats():
    assert safe_reasoning_diagnostics({'validationReason': 'SECRET', 'itemIndex': -1, 'targetIndex': True}) == {}
    assert safe_reasoning_diagnostics({'validationReason': 'basis_invalid', 'itemIndex': 2, 'targetId': 'SECRET'}) == {
        'validationReason': 'basis_invalid', 'itemIndex': 2}
