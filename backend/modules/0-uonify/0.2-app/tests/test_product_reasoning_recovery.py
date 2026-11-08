"""Salidas inválidas: recuperación local estricta y ningún cobro repetido."""
from copy import deepcopy
import pytest
from app.google_cloud_provider import CloudError
from app.product_materials_queue import BudgetPause
from app.product_reasoning_recovery import recover_paid_response
from app.product_reasoning_worker import phase
from test_product_reasoning import context, leaf
from test_product_reasoning_output import wire
from test_product_reasoning_jobs import reasoning_env, prepare  # noqa: F401
from test_product_requirements import requirement_env  # noqa: F401


def stored_response(payload):
    return {'diagnostics': {'httpStatus': 200, 'finishReason': 'STOP', 'stage': 'validation',
                            'validationReason': 'value_json_invalid'}, 'rejectedResponse': payload}


def test_exact_native_enum_can_be_quoted_without_changing_original_or_accepting_support():
    ctx = context(); payload = wire(ctx); payload['decisions'][0]['valueJson'] = 'blue'
    stored = stored_response(payload); before = deepcopy(stored)
    usage = {'calls': 1, 'totalTokenCount': 123}
    recovered = recover_paid_response(stored, usage, ctx)
    assert recovered['repairs'] == [{'itemIndex': 0, 'code': 'quoted_exact_string_enum'}]
    decision = recovered['result']['decisions'][0]
    assert decision['value'] == 'blue' and decision['state'] == 'inferred'
    assert 'accepted' not in decision and recovered['result']['usage'] == usage
    assert recovered['origin'] == 'server_transport_revalidation' and stored == before
    assert recovered['responseFingerprint'] != recovered['derivedFingerprint']


@pytest.mark.parametrize('value', ['Blue', ' blue', 'blue ', 'azul', 'requestedEvidenceRefs', '{}', 'null'])
def test_recovery_never_translates_normalizes_or_invents_enum_values(value):
    ctx = context(); payload = wire(ctx); payload['decisions'][0]['valueJson'] = value
    assert recover_paid_response(stored_response(payload), {'totalTokenCount': 123}, ctx) is None


@pytest.mark.parametrize('kind,value', [('number', 'centimeters'), ('integer', 'requestedEvidenceRefs'),
    ('boolean', 'no'), ('string', 'wood')])
def test_corrupt_numbers_booleans_or_free_strings_are_not_guessed(kind, value):
    ctx = context(properties={'sample': leaf(kind)})
    payload = wire(ctx); payload['decisions'][0]['valueJson'] = value
    assert recover_paid_response(stored_response(payload), {'totalTokenCount': 123}, ctx) is None


@pytest.mark.parametrize('mutation', [
    lambda p: p['decisions'][0].update(evidenceRefs=['unknown-evidence']),
    lambda p: p['decisions'][0].update(requestedEvidenceRefs=['unknown-unit']),
    lambda p: p['decisions'][0].update(targetId='unknown-target'),
    lambda p: p['decisions'].append(deepcopy(p['decisions'][0])),
    lambda p: p['decisions'][0].update(state='unknown'),
])
def test_quoting_enum_cannot_bypass_references_target_uniqueness_or_state(mutation):
    ctx = context(); payload = wire(ctx); payload['decisions'][0]['valueJson'] = 'blue'
    mutation(payload)
    assert recover_paid_response(stored_response(payload), {'totalTokenCount': 123}, ctx) is None


@pytest.mark.parametrize('diagnostic', [{'finishReason': 'MAX_TOKENS'}, {'httpStatus': 429}, {'stage': 'request'}])
def test_truncation_or_provider_rejection_is_not_recoverable(diagnostic):
    ctx = context(); stored = stored_response(wire(ctx)); stored['diagnostics'].update(diagnostic)
    assert recover_paid_response(stored, {'totalTokenCount': 123}, ctx) is None


def test_uncertain_usage_and_non_json_output_remain_internal_errors():
    ctx = context(); stored = stored_response(wire(ctx))
    assert recover_paid_response(stored, {'unconfirmedCalls': 1}, ctx) is None
    stored['rejectedResponse'] = '{"decisions":['
    assert recover_paid_response(stored, {'totalTokenCount': 123}, ctx) is None


def test_recovery_does_not_turn_nominal_dimension_into_confirmed_physical_measurement():
    ctx = context(properties={'item_dimensions': leaf('string', enum=['centimeters'])})
    payload = wire(ctx); payload['decisions'][0]['valueJson'] = 'centimeters'
    recovered = recover_paid_response(stored_response(payload), {'totalTokenCount': 123}, ctx)
    assert recovered['result']['decisions'][0]['value'] == 'centimeters'
    assert 'candidates' not in recovered['result'] and 'verdicts' not in recovered['result']
    # El resultado es exclusivamente una propuesta; falta el verificador y la
    # comprobación de documentos/reservas en validated_candidates para guardarlo.
    from app.product_reasoning_validation import validated_candidates
    assert validated_candidates(ctx, recovered['result'], {}) == []


def invalid_provider(ctx, *, recoverable):
    decisions = []
    for target in ctx['targets']:
        value = 'false' if target['type'] == 'boolean' else 'wood'
        if not recoverable and target['type'] == 'boolean': value = 'requestedEvidenceRefs'
        decisions.append({'targetId': target['id'], 'state': 'inferred', 'valueJson': value,
            'basis': 'functional_reasoning', 'reason': 'El manual describe el producto.',
            'evidenceRefs': ['e1'], 'requestedEvidenceRefs': []})
    error = CloudError('invalid_response'); error.usage = {'calls': 1, 'totalTokenCount': 123}
    stored = stored_response({'decisions': decisions})
    error.diagnostics, error.rejectedResponse = stored['diagnostics'], stored['rejectedResponse']
    return error


def test_paid_error_is_immutable_and_local_derived_result_is_cached_without_second_call(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    prepare(reasoning_env); row = service.queue.claim('recover-worker'); ctx = row['context']
    calls = []
    def fail(*_):
        calls.append('paid'); raise invalid_provider(ctx, recoverable=True)
    provider.propose = fail
    recovered = phase(service, row, 'propose', ctx, 'test', 'project')
    assert phase(service, row, 'propose', ctx, 'test', 'project') == recovered
    assert calls == ['paid'] and recovered['localRecoveryVersion'] == 1
    with db.connect() as c:
        rows = c.execute('SELECT * FROM product_reasoning_calls WHERE job_id=%s', (row['id'],)).fetchall()
        assert len(rows) == 1 and rows[0]['state'] == 'error'
        assert rows[0]['usage'] == {'calls': 1, 'totalTokenCount': 123}
        assert rows[0]['result']['rejectedResponse']['decisions'][1]['valueJson'] == 'wood'
        assert rows[0]['result']['localRecovery']['result'] == recovered
        assert service.queue.usage(c, row['id']) == {'calls': 1, 'tokens': 123, 'reserved': 0, 'unknown': 0}
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product'] == before


def test_unrecoverable_paid_output_never_repeats_on_phase_retry_or_creates_customer_unknown(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    prepare(reasoning_env); row = service.queue.claim('reject-worker'); ctx = row['context']; calls = []
    def fail(*_):
        calls.append('paid'); raise invalid_provider(ctx, recoverable=False)
    provider.propose = fail
    with pytest.raises(BudgetPause) as first:
        phase(service, row, 'propose', ctx, 'test', 'project')
    assert first.value.reason == 'response_repair_required'
    for _ in range(3):
        with pytest.raises(BudgetPause) as caught: phase(service, row, 'propose', ctx, 'test', 'project')
        assert caught.value.reason == 'response_repair_required'
    assert calls == ['paid']
    with db.connect() as c:
        stored = c.execute('SELECT result FROM product_reasoning_calls WHERE job_id=%s', (row['id'],)).fetchone()['result']
        assert 'localRecovery' not in stored and 'resolutions' not in stored
        assert service.queue.usage(c, row['id'])['calls'] == 1
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product'] == before
