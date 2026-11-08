"""Conditional invalidation follows the effective instance, never predicate co-occurrence."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from app.product_reasoning_dependencies import dependency_closure
from app.product_reasoning_context import targets_for
from app.product_reasoning_continuity import independent_targets, apply_plan, CONTINUITY_VERSION, versions


def predicate(key, value):
    return {'required': [key], 'properties': {key: {'const': value}}}


def test_predicate_operands_are_not_mutual_dependencies():
    schema = {'properties': {k: {} for k in ('shipping', 'parent', 'offer', 'group', 'weight')}, 'allOf': [
        {'if': {'anyOf': [{'allOf': [predicate('shipping', 'self'), predicate('parent', False), predicate('offer', True)]}]},
         'then': {'required': ['group']}},
        {'if': predicate('parent', False), 'then': {'required': ['weight']}}]}
    affected = dependency_closure(schema, {'shipping'})
    assert affected == {'shipping', 'group'}
    assert dependency_closure(schema, {'shipping'}, {}, {'shipping': 'amazon'}) == {'shipping'}


def test_unchanged_effective_branch_preserves_reviewed_output():
    schema = {'properties': {'shipping': {}, 'weight': {}}, 'allOf': [
        {'if': {'anyOf': [predicate('shipping', 'amazon'), {'not': {'required': ['shipping']}}]},
         'then': {'required': ['weight']}}]}
    assert dependency_closure(schema, {'shipping'}, {}, {'shipping': 'amazon'}) == {'shipping'}
    assert dependency_closure(schema, {'shipping'}, {'shipping': 'self'}, {'shipping': 'amazon'}) == {'shipping', 'weight'}


@pytest.mark.parametrize('scope', ['root', 'object', 'item', 'reference'])
def test_changed_branch_is_evaluated_at_its_actual_scope(scope):
    rule = {'if': predicate('shipping', 'amazon'), 'then': {'properties': {'weight': {'maximum': 30}}}}
    old, new = {'shipping': 'self'}, {'shipping': 'amazon'}
    if scope == 'root':
        schema = {'properties': {'shipping': {}, 'weight': {}}, 'allOf': [rule]}
        changed, expected = {'shipping'}, {'shipping', 'weight'}
    elif scope == 'object':
        schema = {'properties': {'offer': {'type': 'object', **rule}, 'weight': {}}}
        old, new = {'offer': old}, {'offer': new}; changed = expected = {'offer'}
    elif scope == 'item':
        schema = {'properties': {'offer': {'type': 'array', 'items': rule}, 'shipping': {}, 'weight': {}}}
        old, new = {'offer': [old]}, {'offer': [new]}; changed = expected = {'offer'}
    else:
        schema = {'properties': {'shipping': {}, 'weight': {}}, '$defs': {'shippingRule': rule}, 'allOf': [{'$ref': '#/$defs/shippingRule'}]}
        changed, expected = {'shipping'}, {'shipping', 'weight'}
    assert dependency_closure(schema, changed, old, new) == expected


def test_local_property_reference_keeps_the_original_resolver():
    schema = {'properties': {'shipping': {'const': 'amazon'}, 'weight': {}}, 'allOf': [
        {'if': {'required': ['shipping'], 'properties': {'shipping': {'$ref': '#/properties/shipping'}}},
         'then': {'required': ['weight']}}]}
    assert dependency_closure(schema, {'shipping'}, {'shipping': 'self'}, {'shipping': 'amazon'}) == {'shipping', 'weight'}
    assert dependency_closure(schema, {'shipping'}, {'shipping': 'self'}, {'shipping': 'other'}) == {'shipping'}


@pytest.mark.parametrize('condition', [
    {'$ref': '#/$defs/missing'}, {'$ref': 'https://invalid.example/condition'},
    {'type': 'string', 'format': 'unknown-format'},
])
def test_unevaluable_conditions_fail_closed_without_network(condition):
    schema = {'properties': {'shipping': {}, 'weight': {}}, 'allOf': [
        {'if': condition, 'then': {'required': ['weight']}}]}
    assert dependency_closure(schema, {'shipping'}, {'shipping': 'self'}, {'shipping': 'amazon'}) == {'shipping', 'weight'}


def test_indirectly_changed_input_keeps_transitive_invalidation():
    schema = {'properties': {'shipping': {}, 'material': {}, 'weight': {}}, 'allOf': [
        {'if': predicate('shipping', 'amazon'), 'then': {'properties': {'material': {'enum': ['wood']}}}},
        {'if': predicate('material', 'wood'), 'then': {'required': ['weight']}}]}
    assert dependency_closure(schema, {'shipping'}, {'shipping': 'self'}, {'shipping': 'amazon'}) == {'shipping', 'material', 'weight'}


def test_conditional_same_path_with_different_enum_is_not_reused():
    schema = {'type': 'object', 'properties': {'condition_type': {'type': 'string'}, 'material': {'type': 'string'}},
        'required': ['material'], 'allOf': [
            {'if': predicate('condition_type', 'new'), 'then': {'properties': {'material': {'enum': ['wood']}}},
             'else': {'properties': {'material': {'enum': ['plastic']}}}}]}
    before = {'amazonAttributes': {'condition_type': 'used'}}; after = {'amazonAttributes': {'condition_type': 'new'}}
    old, _, _ = targets_for(schema, before['amazonAttributes'], 'A1RKKUPIHCS9HS')
    new, _, _ = targets_for(schema, after['amazonAttributes'], 'A1RKKUPIHCS9HS')
    assert old[0]['id'] == new[0]['id'] and old[0]['choices'] != new[0]['choices']
    assert not independent_targets(before, after, {'schema': schema, 'marketplace_id': 'A1RKKUPIHCS9HS'}, old, new)


def test_real_fba_answer_reuses_all_fifteen_without_changing_inputs():
    folder = Path('/audit/data12-continuidad-20261015')
    if not (folder / 'after-fulfillment-error.json').exists(): pytest.skip('Mount the read-only Basic Mini Bricks evidence corpus')
    before = json.loads((folder / 'browser-lifecycle-after.json').read_text())['product']
    captured = json.loads((folder / 'after-fulfillment-error.json').read_text())
    after = captured['product']
    snapshot = json.loads(Path('/audit/data12-deduccion-20261015/after-live.json').read_text())['snapshot']
    old, _, _ = targets_for(snapshot['schema'], before['amazonAttributes'], snapshot['marketplace_id'])
    new, _, _ = targets_for(snapshot['schema'], after['amazonAttributes'], snapshot['marketplace_id'])
    ids = independent_targets(before, after, snapshot, old, new)
    assert len(old) == 16 and len(new) == len(ids) == 15
    parent = next(job for job in captured['jobs'] if job['id'] == '6678f410-9015-4304-b23d-f01d37b73409')
    context = {'targets': new, 'fingerprint': 'offline', 'coverage': {}}
    plan = {'version': CONTINUITY_VERSION, 'sourceJobId': parent['id'], 'product': before,
            'targets': old, 'resolutions': parent['result']['resolutions'], **versions()}
    saved = deepcopy((before, after, context, plan))
    result = apply_plan(context, after, snapshot, plan)
    assert not result['targets'] and len(result['_continuity']['reusedTargetIds']) == 15
    assert (before, after, context, plan) == saved
