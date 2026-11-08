"""Deferring commercial fields is not new evidence and must not replay paid work."""
from copy import deepcopy
import pytest
from app.product_reasoning_continuity import independent_targets
from app.product_reasoning_refresh import independent_refreshed_targets


def reusable(before, after, refresh):
    names = ('list_price', 'purchasable_offer', 'fulfillment_availability', 'material')
    snapshot = {'marketplace_id': 'ES', 'schema': {'type': 'object', 'properties': {
        name: {'type': 'number'} for name in names}}}
    targets = [{'id': name, 'path': [name], 'type': 'number', 'schema': {'type': 'number'}} for name in names]
    if refresh:
        return independent_refreshed_targets(before, after, snapshot, targets, targets, [])
    return independent_targets(before, after, snapshot, targets, targets)


@pytest.mark.parametrize('refresh', [False, True])
@pytest.mark.parametrize('old,new', [(None, ''), ('', None), (None, '  '), ('\t', None)])
def test_null_and_empty_form_answers_keep_all_reviewed_outcomes(refresh, old, new):
    before = {'price': old, 'cost': old, 'stock': old, 'customFields': []}
    after = {**before, 'price': new, 'cost': new, 'stock': new}
    assert reusable(before, after, refresh) == {'list_price', 'purchasable_offer', 'fulfillment_availability', 'material'}
    assert before['price'] == old and after['price'] == new  # comparisons never rewrite stored signatures


@pytest.mark.parametrize('refresh', [False, True])
@pytest.mark.parametrize('key', ['price', 'cost', 'stock'])
@pytest.mark.parametrize('value', [0, '0', 12.5, '12.5'])
def test_real_commercial_values_invalidate_only_relevant_controls(refresh, key, value):
    before = {'price': None, 'cost': None, 'stock': None, 'customFields': []}
    after = {**before, key: value}
    found = reusable(before, after, refresh)
    assert 'material' in found
    if key == 'stock':
        assert found == {'material', 'list_price', 'purchasable_offer'}
    else:
        assert found == {'material', 'fulfillment_availability'}


@pytest.mark.parametrize('refresh', [False, True])
def test_empty_commercial_answer_never_masks_a_changed_product_identity(refresh):
    before = {'brand': 'Original', 'price': None, 'customFields': []}
    after = {**before, 'brand': 'Other', 'price': ''}
    assert reusable(before, after, refresh) == set()
