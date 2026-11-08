"""El máximo liga generación, infraestructura y receta sin abrir el gate."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json

import pytest

from app.creative_composite_quote import (COMPONENTS, CostCeiling,
    ExecutionBinding, RequestOperationBinding, composite_quote_readiness,
    execution_binding_sha256, canonical_json, canonical_sha256)


NOW = datetime(2026, 10, 18, 18, tzinfo=timezone.utc)
REQUEST = {'endpoint': 'https://europe.example.test/v1/models/video:generate',
           'model': 'video-model', 'body': {'prompt': 'City'},
           'inputManifest': []}
REQUEST_JSON = canonical_json(REQUEST)
REQUEST_SHA = canonical_sha256(REQUEST)


def operation(operation_id='22222222-2222-4222-8222-222222222222',
              ordinal=1, unit_id='shot-01'):
    return RequestOperationBinding(operation_id, ordinal, unit_id, 'video',
                                   REQUEST_SHA, REQUEST['model'],
                                   REQUEST['endpoint'], REQUEST_JSON)


def binding(**changes):
    value = ExecutionBinding(
        '11111111-1111-4111-8111-111111111111', 3, 'a' * 64,
        'b' * 64, 'c' * 64, 'd' * 64, '2' * 64,
        (operation(),),
        'filmcraft', '0.9.0', 'video_export', '1' * 64)
    return replace(value, **changes)


def cost(component, amount, payer='customer_google_project', *, execution=None,
         expires_at=None, index=0, service=None):
    exact = execution or binding()
    cost_id = f'{index + 10:08d}-0000-4000-8000-000000000000'
    return CostCeiling(cost_id, component, service or component, payer, Decimal(amount),
                       execution_binding_sha256(exact), '9' * 64,
                       NOW - timedelta(hours=1),
                       expires_at or NOW + timedelta(hours=1),
                       (exact.request_operations[0].operation_id
                        if component == 'generation' else None))


def test_incomplete_cost_names_missing_components_and_cannot_be_approved():
    result = composite_quote_readiness(
        binding(), (cost('generation', '1.25', index=0),
                    cost('storage', '0.03', index=1)),
        now=NOW)
    assert not result.complete and result.max_total_usd is None
    assert result.missing_components == ('processing', 'transfer')
    assert result.quote_sha256 is None
    assert not result.approval_ready and not result.execution_authorized


def test_complete_quote_separates_payers_and_binds_recipe_engine_and_limits():
    exact = binding()
    ceilings = tuple(cost(name, amount,
                          'uonify_platform' if name == 'processing' else
                          'customer_google_project', execution=exact,
                          expires_at=NOW + timedelta(minutes=30 + index), index=index)
                     for index, (name, amount) in enumerate(zip(
                         COMPONENTS, ('1.25', '0.03', '0.40', '0.02'))))
    result = composite_quote_readiness(exact, ceilings, now=NOW)
    assert result.complete and result.max_total_usd == '1.70'
    assert result.payer_totals_usd == {
        'customer_google_project': '1.30', 'uonify_platform': '0.40'}
    assert len(result.quote_sha256) == len(result.binding_sha256) == 64
    assert len(result.costs_snapshot_sha256) == 64
    persisted = json.loads(result.quote_snapshot_json)
    assert persisted['costsSnapshotSha256'] == result.costs_snapshot_sha256
    assert [item['component'] for item in persisted['costs']] == list(COMPONENTS)
    assert result.expires_at == (NOW + timedelta(minutes=30)).isoformat()
    changed_binding = binding(edit_recipe_sha256='8' * 64)
    changed_ceilings = tuple(replace(
        item, binding_sha256=execution_binding_sha256(changed_binding))
        for item in ceilings)
    changed = composite_quote_readiness(changed_binding, changed_ceilings, now=NOW)
    assert changed.binding_sha256 != result.binding_sha256
    assert changed.quote_sha256 != result.quote_sha256
    assert not result.approval_ready and not result.execution_authorized


@pytest.mark.parametrize('ceiling', [
    cost('processing', '-0.01', 'uonify_platform'),
    cost('processing', '0.001', 'uonify_platform'),
    replace(cost('processing', '0.40', 'uonify_platform'),
            expires_at=NOW - timedelta(seconds=1)),
])
def test_invalid_or_expired_ceiling_is_rejected(ceiling):
    with pytest.raises(ValueError, match='Techo'):
        composite_quote_readiness(binding(), (ceiling,), now=NOW)


def test_binding_rejects_a_plan_identifier_that_cannot_be_persisted_exactly():
    with pytest.raises(ValueError, match='binding'):
        composite_quote_readiness(binding(plan_id='plan-readable-name'), (), now=NOW)


def test_identical_request_hashes_are_distinct_operations_and_order_is_bound():
    operations = (
        operation(),
        operation('33333333-3333-4333-8333-333333333333', 2, 'shot-02'),
    )
    exact = binding(request_operations=operations)
    assert len(execution_binding_sha256(exact)) == 64
    changed = replace(exact, request_operations=(operations[0], replace(
        operations[1], operation_id='44444444-4444-4444-8444-444444444444')))
    assert execution_binding_sha256(changed) != execution_binding_sha256(exact)
    with pytest.raises(ValueError, match='ordenadas'):
        execution_binding_sha256(replace(exact, request_operations=(
            operations[0], replace(operations[1], ordinal=3))))


def test_cost_evidence_for_an_old_binding_is_rejected():
    original = binding()
    changed = binding(limits_sha256='7' * 64)
    with pytest.raises(ValueError, match='Techo'):
        composite_quote_readiness(changed, (cost('generation', '1.00',
                                                  execution=original),), now=NOW)


def test_operation_rejects_a_snapshot_that_does_not_rehash_to_request():
    changed = replace(operation(), request_snapshot_json=canonical_json(
        {**REQUEST, 'body': {'prompt': 'Other city'}}))
    with pytest.raises(ValueError, match='Operación'):
        execution_binding_sha256(binding(request_operations=(changed,)))


def test_one_component_can_have_two_services_and_two_payers():
    exact = binding()
    ceilings = (
        cost('generation', '1.00', execution=exact, index=0),
        cost('storage', '0.01', execution=exact, index=1),
        cost('processing', '0.02', 'customer_google_project', execution=exact,
             index=2, service='google_transcoder'),
        cost('processing', '0.05', 'uonify_platform', execution=exact,
             index=3, service='craft_render'),
        cost('transfer', '0.01', execution=exact, index=4),
    )
    result = composite_quote_readiness(exact, ceilings, now=NOW)
    assert result.complete and result.components_usd['processing'] == '0.07'
    assert result.payer_totals_usd == {
        'customer_google_project': '1.04', 'uonify_platform': '0.05'}


def test_duplicate_cost_identity_is_rejected_even_across_components():
    first = cost('generation', '1.00')
    duplicate = replace(cost('storage', '0.01'), cost_id=first.cost_id)
    with pytest.raises(ValueError, match='línea'):
        composite_quote_readiness(binding(), (first, duplicate), now=NOW)


def test_generation_cost_must_cover_every_operation_once():
    operations = (
        operation(),
        operation('33333333-3333-4333-8333-333333333333', 2, 'shot-02'),
    )
    exact = binding(request_operations=operations)
    one = cost('generation', '0.50', execution=exact)
    with pytest.raises(ValueError, match='cada operación'):
        composite_quote_readiness(exact, (one,), now=NOW)
    duplicate = replace(one, cost_id='44444444-4444-4444-8444-444444444444')
    with pytest.raises(ValueError, match='cada operación'):
        composite_quote_readiness(exact, (one, duplicate), now=NOW)
