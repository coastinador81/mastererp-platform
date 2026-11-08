"""Fixed hidden PTD choices are not customer questions or model-context changes."""
from copy import deepcopy
import pytest
from app.product_requirements_fields import apply, evaluate
from app.amazon_catalog import MARKETPLACE
from app.product_reasoning_context import build_context
from app.product_reasoning_fixed import schema_fixed_candidates
from app.incident_fields import get_at
from test_product_reasoning import fixture
from test_product_requirements_real_schema import tabletop


def price_schema(currency):
    return {'type': 'object', 'required': ['list_price'], 'properties': {'list_price': {
        'type': 'array', 'title': 'Precio de venta recomendado', 'minItems': 1,
        'items': {'type': 'object', 'required': ['value', 'currency'],
            'properties': {'value': {'type': 'number', 'minimum': 0, 'title': 'Precio de lista'},
                           'currency': {'type': 'string', 'title': 'Moneda PVPR', **currency},
                           'marketplace_id': {'type': 'string'}}}}}}


def paths(plan):
    return [spec['path'] for spec in plan['specs'].values()]


@pytest.mark.parametrize('flag', [{'hidden': True}, {'editable': False}, {'readOnly': True}])
def test_fixed_required_currency_is_filled_only_for_human_form_and_saved_with_price(flag):
    schema = price_schema({'enum': ['EUR'], **flag})
    internal_before = evaluate(schema, {}, MARKETPLACE, 'list_price', human=False)
    human = evaluate(schema, {}, MARKETPLACE, 'list_price')
    assert paths(human) == [['list_price', 0, 'value']]
    assert human['candidate']['list_price'][0]['currency'] == 'EUR'
    assert ['list_price', 0, 'currency'] in paths(internal_before)
    assert 'currency' not in internal_before['candidate']['list_price'][0]
    assert evaluate(schema, {}, MARKETPLACE, 'list_price', human=False) == internal_before
    price = human['fields'][0]
    saved, touched = apply(schema, {}, MARKETPLACE, {price['id']: '29.90'}, 'list_price')
    assert touched == {'list_price'}
    assert saved['list_price'][0]['currency'] == 'EUR' and saved['list_price'][0]['value'] == 29.9
    assert evaluate(schema, saved, MARKETPLACE)['valid']


@pytest.mark.parametrize('existing', ['USD', None])
def test_existing_invalid_currency_is_not_overwritten(existing):
    schema = price_schema({'enum': ['EUR'], 'hidden': True})
    attributes = {'list_price': [{'currency': existing, 'value': 29.9, 'marketplace_id': MARKETPLACE}]}
    before = deepcopy(attributes)
    plan = evaluate(schema, attributes, MARKETPLACE)
    assert plan['candidate']['list_price'][0]['currency'] == existing
    assert ['list_price', 0, 'currency'] in paths(plan)
    assert not plan['valid'] and attributes == before


@pytest.mark.parametrize('currency', [
    {'enum': ['EUR', 'USD'], 'hidden': True},
    {'default': 'EUR', 'examples': ['EUR'], 'hidden': True},
    {'enum': ['EUR']},
    {'anyOf': [{'enum': ['EUR']}, {'type': 'string'}], 'hidden': True},
])
def test_multiple_options_examples_and_open_alternatives_remain_customer_choices(currency):
    plan = evaluate(price_schema(currency), {}, MARKETPLACE, 'list_price')
    assert 'currency' not in plan['candidate']['list_price'][0]
    assert ['list_price', 0, 'currency'] in paths(plan)


def test_invalid_fixed_enum_is_not_silently_written():
    schema = price_schema({'enum': ['EUR'], 'hidden': True, 'pattern': '^USD$'})
    plan = evaluate(schema, {}, MARKETPLACE, 'list_price')
    assert get_at(plan['candidate'], ['list_price', 0, 'currency']) is None
    assert plan['needsReview'] and not plan['valid']


def test_malformed_existing_parent_is_preserved():
    schema = price_schema({'enum': ['EUR'], 'hidden': True})
    attributes = {'list_price': [None]}
    before = deepcopy(attributes)
    plan = evaluate(schema, attributes, MARKETPLACE, 'list_price')
    assert attributes == before
    assert 'currency' not in plan['candidate']['list_price'][0]


def reasoning_context(currency, attributes=None, required=True):
    schema = price_schema(currency)
    if not required:
        schema['properties']['list_price']['items']['required'].remove('currency')
    data = fixture(properties=schema['properties'], pictures=0)
    data[1]['schema'] = schema
    data[0]['amazonAttributes'] = attributes or {}
    return build_context(*data)


def test_fixed_schema_candidates_complete_currency_without_a_question_or_model_claim():
    context = reasoning_context({'enum': ['EUR'], 'hidden': True}, {
        'list_price': [{'value': 29.9, 'marketplace_id': MARKETPLACE}]})
    before = deepcopy(context)
    candidates = schema_fixed_candidates(context)
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate['path'] == ['list_price', 0, 'currency'] and candidate['value'] == 'EUR'
    assert candidate['origin'] == 'schema_fixed' and candidate['humanConfirmed'] is False
    assert candidate['evidence'][0]['sourceId'] == 'schema'
    assert candidate['evidence'][0]['schemaHash'] == context['schemaHash']
    assert context == before


@pytest.mark.parametrize('currency', [
    {'enum': ['EUR', 'USD'], 'hidden': True},
    {'default': 'EUR', 'examples': ['EUR'], 'hidden': True},
    {'enum': ['EUR']},
    {'enum': ['EUR'], 'hidden': True, 'pattern': '^USD$'},
    {'anyOf': [{'enum': ['EUR']}, {'type': 'string'}], 'hidden': True},
])
def test_fixed_candidates_never_use_open_optional_or_invalid_choices(currency):
    assert schema_fixed_candidates(reasoning_context(currency)) == []


@pytest.mark.parametrize('existing', ['EUR', 'USD', None])
def test_fixed_candidates_never_replace_stored_values(existing):
    context = reasoning_context({'enum': ['EUR'], 'hidden': True}, {
        'list_price': [{'value': 29.9, 'currency': existing, 'marketplace_id': MARKETPLACE}]})
    before = deepcopy(context)
    assert schema_fixed_candidates(context) == []
    assert context == before


def test_fixed_candidates_require_a_current_required_leaf():
    context = reasoning_context({'enum': ['EUR'], 'hidden': True}, {
        'list_price': [{'currency': None, 'marketplace_id': MARKETPLACE}]}, required=False)
    assert schema_fixed_candidates(context) == []


def test_missing_value_cannot_select_a_conditional_single_choice():
    currency = {'hidden': True, 'if': {'type': 'null'}, 'then': {'enum': ['EUR']},
                'else': {'type': 'string'}}
    plan = evaluate(price_schema(currency), {}, MARKETPLACE, 'list_price')
    assert get_at(plan['candidate'], ['list_price', 0, 'currency']) is None
    assert schema_fixed_candidates(reasoning_context(currency)) == []


def test_intersection_of_closed_enums_is_fixed_when_only_one_value_survives():
    currency = {'hidden': True, 'allOf': [{'enum': ['EUR', 'USD']}, {'enum': ['EUR', 'GBP']}]}
    candidates = schema_fixed_candidates(reasoning_context(currency))
    assert len(candidates) == 1 and candidates[0]['value'] == 'EUR'


def test_real_ptd_currency_has_schema_provenance_and_no_customer_choice(tabletop):
    attributes = {'list_price': [{'value': 29.9, 'marketplace_id': MARKETPLACE}]}
    before = deepcopy(attributes)
    internal = evaluate(tabletop, attributes, MARKETPLACE, 'list_price', human=False)
    human = evaluate(tabletop, attributes, MARKETPLACE, 'list_price')
    assert ['list_price', 0, 'currency'] in paths(internal)
    assert ['list_price', 0, 'currency'] not in paths(human)
    assert human['candidate']['list_price'][0]['currency'] == 'EUR'
    data = fixture(properties=tabletop['properties'], pictures=0)
    data[0]['amazonAttributes'] = attributes
    data[1]['schema'] = tabletop
    context = build_context(*data)
    fingerprint = context['fingerprint']
    found = [item for item in schema_fixed_candidates(context) if item['path'] == ['list_price', 0, 'currency']]
    assert len(found) == 1 and found[0]['value'] == 'EUR'
    assert found[0]['evidence'][0]['id'] == 's_' + found[0]['targetId']
    assert evaluate(tabletop, attributes, MARKETPLACE, 'list_price', human=False) == internal
    assert build_context(*data)['fingerprint'] == fingerprint and attributes == before
