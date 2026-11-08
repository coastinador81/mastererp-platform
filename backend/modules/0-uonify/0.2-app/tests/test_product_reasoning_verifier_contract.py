"""Contrato puro del segundo pase, separado de las pruebas transaccionales de la cola."""
import pytest
from app.google_cloud_provider import CloudError
from app.product_reasoning_provider import ProductReasoner, PROMPT_VERSION, VERIFY_VERSION
from app.product_reasoning_output import validate_shape
from app.product_reasoning_validation import validated_candidates
from test_product_reasoning import context, responses, leaf, Reply


def test_verifier_resolves_pending_measurement_without_repeating_paid_proposal(monkeypatch):
    ctx = context(properties={'item_weight': leaf('number')}, texts=[
        {'locator': 'Ficha', 'text': 'Peso físico pendiente de medir por el fabricante.'}])
    proposal = {'decisions': [{'targetId': ctx['targets'][0]['id'], 'state': 'needs_evidence',
        'basis': 'not_applicable', 'reason': 'Falta el peso.', 'evidenceRefs': [], 'requestedEvidenceRefs': []}],
        'usage': {'totalTokenCount': 81925}}
    _, verdict = responses(ctx, 1.0)
    verdict['verdicts'][0].update(accepted=False, resolution='unknown', basis='not_applicable',
        authorityConfirmed=False, quote='', reason='La ficha indica que todavía debe medirse.')
    calls = []
    def post(url, **kwargs): calls.append(kwargs); return Reply(verdict)
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', post)
    result = ProductReasoner().verify('test', 'project', ctx, proposal)
    assert len(calls) == 1 and result['verdicts'][0]['resolution'] == 'unknown'
    assert proposal['usage']['totalTokenCount'] == 81925 and validated_candidates(ctx, proposal, result) == []
    assert PROMPT_VERSION == 4 and VERIFY_VERSION == 2


def test_verifier_supplies_original_proof_for_uncited_functional_deduction(monkeypatch):
    ctx = context(properties={'batteries_required': leaf('boolean')}, texts=[
        {'locator': 'Manual', 'text': 'Gira la manivela para accionar las muelas. Producto completamente manual.'}])
    proposal, verdict = responses(ctx, False); proposal['decisions'][0]['evidenceRefs'] = []
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **k: Reply(verdict))
    accepted = validated_candidates(ctx, proposal, ProductReasoner().verify('test', 'project', ctx, proposal))
    assert accepted[0]['value'] is False and accepted[0]['evidence'][0]['sourceId'] == 's1'


@pytest.mark.parametrize('attribute,kind,value,source', [
    ('item_length', 'number', 20, 'Ancho nominal: 20 cm, pendiente de medir físicamente.'),
    ('list_price', 'number', 0, 'Precio pendiente; cero es el valor inicial de la ficha.'),
    ('condition_type', 'string', 'new_new', 'Maqueta virtual. No se ha decidido la condición comercial.'),
])
def test_unsupported_values_rejected_by_independent_review(monkeypatch, attribute, kind, value, source):
    ctx = context(properties={attribute: leaf(kind)}, texts=[{'locator': 'Ficha', 'text': source}])
    proposal, verdict = responses(ctx, value)
    verdict['verdicts'][0].update(accepted=False, resolution='unknown', basis='not_applicable')
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **k: Reply(verdict))
    assert validated_candidates(ctx, proposal, ProductReasoner().verify('test', 'project', ctx, proposal)) == []


@pytest.mark.parametrize('changes,reason', [
    ({'resolution': 'unknown'}, 'resolution_acceptance_mismatch'),
    ({'resolution': 'supported', 'accepted': False}, 'resolution_acceptance_mismatch'),
    ({'resolution': 'supported', 'productMatch': False}, 'resolution_support_missing'),
    ({'resolution': 'supported', 'evidenceRefs': []}, 'resolution_support_missing'),
    ({'resolution': 'needs_evidence', 'accepted': False}, 'resolution_retrieval_mismatch'),
    ({'resolution': 'unknown', 'accepted': False, 'requestedEvidenceRefs': ['omitted']}, 'resolution_retrieval_mismatch'),
])
def test_resolution_cannot_weaken_evidence(changes, reason):
    ctx = context(); ctx['coverage']['omittedUnits'] = [{'id': 'omitted'}]
    _, verdict = responses(ctx, 'blue'); verdict['verdicts'][0].update(changes)
    with pytest.raises(CloudError) as caught: validate_shape(verdict, ctx, True)
    assert caught.value.diagnostics['validationReason'] == reason


def test_retrieval_resolution_requires_real_omitted_reference():
    ctx = context(); ctx['coverage']['omittedUnits'] = [{'id': 'real'}]
    _, verdict = responses(ctx, 'blue')
    verdict['verdicts'][0].update(accepted=False, resolution='needs_evidence', requestedEvidenceRefs=['real'])
    assert validate_shape(verdict, ctx, True)['verdicts'][0]['resolution'] == 'needs_evidence'
    verdict['verdicts'][0]['requestedEvidenceRefs'] = ['made-up']
    with pytest.raises(CloudError) as caught: validate_shape(verdict, ctx, True)
    assert caught.value.diagnostics['validationReason'] == 'requested_ref_unknown'


def test_verifier_cannot_accept_unproposed_value_and_paid_reply_survives(monkeypatch):
    ctx = context(); proposal, verdict = responses(ctx, 'blue')
    proposal['decisions'][0].update(state='unknown'); proposal['decisions'][0].pop('value')
    monkeypatch.setattr('app.product_reasoning_provider.requests.post', lambda *a, **k: Reply(verdict))
    with pytest.raises(CloudError) as caught: ProductReasoner().verify('test', 'project', ctx, proposal)
    assert caught.value.diagnostics['validationReason'] == 'resolution_without_proposed_value'
    assert caught.value.rejectedResponse['verdicts'] == verdict['verdicts']
    assert caught.value.usage['totalTokenCount'] == 123


def test_server_guard_rejects_inconsistent_supported_resolution():
    ctx = context(); proposal, verdict = responses(ctx, 'blue'); verdict['verdicts'][0]['resolution'] = 'unknown'
    assert validated_candidates(ctx, proposal, verdict) == []
