"""Reconciliación objetiva de carencias, sin reclasificar errores técnicos o pruebas reales."""
from copy import deepcopy
import pytest
from app.product_reasoning_reconciliation import reconcile_resolutions
from app.product_reasoning_validation import validated_candidates
from test_product_reasoning import context, responses, leaf


def nominal():
    ctx = context(properties={'item_length': leaf('number')}, texts=[
        {'locator': 'Diseño', 'text': 'Longitud nominal del diseño: 20 cm. Pendiente de validación física.'}])
    proposal, verdict = responses(ctx, 20, basis='direct_document', authority=True, quote='20 cm')
    return ctx, proposal, verdict


def test_nominal_only_dimension_becomes_unknown_with_original_verdict_and_real_trace():
    ctx, proposal, verdict = nominal(); before = deepcopy(verdict)
    reconciled = reconcile_resolutions(ctx, proposal, verdict)
    item = reconciled['verdicts'][0]
    assert item['resolution'] == 'unknown' and item['accepted'] is False
    assert item['reconciliation']['code'] == 'physical_measurement_not_documented'
    assert item['reconciliation']['originalVerdict'] == before['verdicts'][0]
    assert item['reconciliation']['evidenceRefs']
    assert verdict == before and validated_candidates(ctx, proposal, reconciled) == []


@pytest.mark.parametrize('name,text', [
    ('Estantería', 'Peso nominal del modelo: 2.5 kg, pendiente de medición.'),
    ('Lámpara', 'Peso de diseño: 2.5 kg. Dato nominal del render.'),
])
def test_rule_applies_to_different_products_without_name_exceptions(name, text):
    ctx = context(properties={'item_weight': leaf('number')}, texts=[{'locator': 'Ficha', 'text': text}],
        product={'id': 'p', 'sku': 'sku', 'name': name, 'revision': 1, 'amazonAttributes': {}, 'customFields': []})
    proposal, verdict = responses(ctx, 2.5, basis='direct_document', authority=True, quote='2.5 kg')
    assert reconcile_resolutions(ctx, proposal, verdict)['verdicts'][0]['resolution'] == 'unknown'


@pytest.mark.parametrize('text', ['Longitud física medida: 20 cm', 'Dimensiones: 20 x 10 x 5 cm',
    'Medida real: 20 cm; el plano nominal anterior era de 19 cm.'])
def test_real_alternative_measurement_in_context_prevents_customer_question(text):
    ctx, proposal, verdict = nominal()
    ctx['evidence'].append({'id': 'physical', 'kind': 'text', 'sourceId': 'lab', 'text': text})
    assert reconcile_resolutions(ctx, proposal, verdict) == verdict


def test_retrievable_measurement_document_stays_an_internal_pending_check():
    ctx, proposal, verdict = nominal()
    ctx['coverage']['omittedUnits'] = [{'id': 'retrieve', 'kind': 'text', 'sourceId': 'lab',
        'sourceName': 'medicion-fisica.pdf', 'preview': 'Longitud medida: 20 cm'}]
    assert reconcile_resolutions(ctx, proposal, verdict) == verdict


def test_measurement_and_nominal_comparison_in_same_source_does_not_prove_missing_real_measurement():
    ctx, proposal, verdict = nominal()
    ctx['evidence'][0]['text'] += ' Medida real: 21 cm.'
    assert reconcile_resolutions(ctx, proposal, verdict) == verdict


@pytest.mark.parametrize('fault', ['quote', 'type', 'schema', 'reference', 'ocr', 'protected', 'reading'])
def test_technical_or_protected_failures_are_not_converted_to_user_questions(fault):
    ctx, proposal, verdict = nominal()
    if fault == 'quote': verdict['verdicts'][0]['quote'] = 'Un texto que no existe'
    if fault == 'type': proposal['decisions'][0]['value'] = '20'
    if fault == 'schema': ctx['targets'][0]['schema']['maximum'] = 10
    if fault == 'reference': verdict['verdicts'][0]['evidenceRefs'] = ['nonexistent']
    if fault == 'ocr': ctx['evidence'][0]['kind'] = 'ocr'
    if fault == 'protected': ctx['protected']['amazonAttributes'] = {'item_length': [{'value': 30}]}
    if fault == 'reading': ctx['coverage']['originalReadingComplete'] = False
    assert reconcile_resolutions(ctx, proposal, verdict) == verdict


def legal():
    ctx = context(properties={'supplier_declared_dg_hz_regulation': leaf()}, texts=[
        {'locator': 'Material', 'text': 'Material: madera de haya.'}])
    proposal, verdict = responses(ctx, 'not_applicable', basis='direct_document', authority=True, quote='madera de haya')
    # El validador comprueba una cita literal, pero no basta cualquier material para una declaración legal.
    return ctx, proposal, verdict


def test_material_alone_does_not_turn_into_a_legal_declaration():
    ctx, proposal, verdict = legal()
    reconciled = reconcile_resolutions(ctx, proposal, verdict)
    assert reconciled['verdicts'][0]['resolution'] == 'unknown'
    assert reconciled['verdicts'][0]['reconciliation']['code'] == 'legal_declaration_not_documented'


@pytest.mark.parametrize('omitted', [True, False])
def test_relevant_safety_document_is_retrieved_or_reviewed_internally_before_asking(omitted):
    ctx, proposal, verdict = legal()
    entry = {'id': 'safety', 'kind': 'text', 'sourceId': 'producer', 'sourceName': 'SDS.pdf',
             'text': 'Transporte: mercancías peligrosas, clasificación ADR.', 'preview': 'SDS del fabricante'}
    if omitted: ctx['coverage']['omittedUnits'] = [entry]
    else: ctx['evidence'].append(entry)
    assert reconcile_resolutions(ctx, proposal, verdict) == verdict


def test_worker_minimal_or_missing_bound_response_is_unchanged():
    assert reconcile_resolutions({}, {'candidates': []}, {'verdicts': []}) == {'verdicts': []}
    ctx, proposal, verdict = nominal(); verdict.pop('proposalFingerprint')
    assert reconcile_resolutions(ctx, proposal, verdict) == verdict
