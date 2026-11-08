"""El aviso de consumo incierto identifica su revisión sin inventar llamadas nuevas."""
from copy import deepcopy
from unittest.mock import Mock, patch
from uuid import uuid4
import pytest
from app.product_reasoning import ProductReasoning, MESSAGES, material_signature, product_signature, unknown_consumption_message


@pytest.mark.parametrize('calls,unknown,prior,no_new_calls', [(0, 0, True, True), (2, 0, True, False),
                                                          (1, 1, False, False), (3, 1, False, False)])
def test_unknown_copy_preserves_current_call_usage_and_distinguishes_previous_block(calls, unknown, prior, no_new_calls):
    usage = {'calls': calls, 'tokens': 123 if calls else 0, 'reserved': 100 if unknown else 0, 'unknown': unknown}
    before = deepcopy(usage)
    message = unknown_consumption_message(usage)
    assert ('Hay un intento anterior' in message) is prior
    assert ('Esta revisión no ha iniciado llamadas nuevas.' in message) is no_new_calls
    if not prior:
        assert message == MESSAGES['unknown']
    else:
        assert 'interrumpió' not in message and 'Tus datos están guardados.' in message
    assert usage == before


def test_missing_usage_never_claims_a_previous_block_or_zero_calls():
    assert unknown_consumption_message({}) == MESSAGES['unknown']
    assert 'no ha iniciado llamadas' not in unknown_consumption_message({'unknown': 0})


@pytest.mark.parametrize('calls,unknown', [(0, 0), (2, 0), (1, 1)])
def test_read_decoration_preserves_unknown_barrier_usage_and_result(calls, unknown):
    product = {'id': 'product', 'sku': 'BASIC', 'revision': 12, 'amazonAttributes': {}}
    user = {'id': 'owner', 'google_subject': 'google-owner'}
    material = {'id': 'materials', 'status': 'ready', 'facts': {'version': 1, 'proposals': []}, 'sources': []}
    snapshot = {'schema': {}, 'marketplace_id': 'A1RKKUPIHCS9HS', 'metadata': {'schemaHash': 'schema'}}
    row = {'id': uuid4(), 'status': 'unknown', 'google_subject': user['google_subject'], 'schema_hash': 'schema',
           'product_signature': product_signature(product), 'output_signature': None,
           'context': {'_materialSignature': material_signature(material)}, 'result': {'error': 'consumption_unknown'}}
    usage = {'calls': calls, 'tokens': 100 if calls else 0, 'reserved': 200 if unknown else 0, 'unknown': unknown}
    original = deepcopy((row, usage, product))
    service = ProductReasoning.__new__(ProductReasoning)
    service.queue = Mock(); service.queue.usage.return_value = usage
    connection = Mock(); connection.execute.return_value.fetchone.return_value = row
    evaluation = {'state': 'needs_input', 'fields': [{'id': 'pending'}]}
    with patch('app.product_reasoning.latest_job', return_value=material), \
         patch('app.product_reasoning_context.targets_for', return_value=([{'id': 'pending'}], {}, {})), \
         patch('app.product_reasoning_continuity.scope_matches', return_value=True):
        service.decorate(connection, user, product, snapshot, evaluation)
    reasoning = evaluation['reasoning']
    assert evaluation['state'] == 'reasoning' and evaluation['fields'] == []
    assert reasoning['status'] == 'unknown' and reasoning['canRetry'] is True
    assert reasoning['requiresConsumptionAcknowledgement'] is True
    assert reasoning['message'] == unknown_consumption_message(usage) == evaluation['message']
    assert reasoning['usage'] == usage
    assert (row, usage, product) == original
    assert connection.execute.call_count == 1
    assert connection.execute.call_args.args[0].lstrip().startswith('SELECT')
