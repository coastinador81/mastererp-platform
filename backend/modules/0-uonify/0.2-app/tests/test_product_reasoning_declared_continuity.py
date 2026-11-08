"""Regulatory answers reuse only independent, previously reviewed information."""
from copy import deepcopy
from types import SimpleNamespace
from app.product_reasoning_continuity import independent_targets, answered_independent_attributes
from app.product_reasoning_context import targets_for
from test_product_requirements import value

MARKET = 'A1RKKUPIHCS9HS'
DECLARATION = 'supplier_declared_dg_hz_regulation'


def setup():
    schema = {'type': 'object', 'properties': {DECLARATION: value(enum=['not_applicable', 'transportation']),
        'target_audience_keyword': value(), 'list_price': value('number'),
        'item_weight': value('number'), 'batteries_required': value('boolean'), 'material': value()},
        'required': [DECLARATION, 'target_audience_keyword', 'list_price', 'item_weight', 'batteries_required', 'material']}
    before = {'id': 'same', 'sku': 'same', 'revision': 1, 'amazonAttributes': {}}
    after = {**before, 'revision': 2, 'amazonAttributes': {DECLARATION: [{'value': 'not_applicable'}]}}
    return schema, before, after


def allowed(schema, before, after):
    previous = targets_for(schema, before['amazonAttributes'], MARKET)[0]
    current = targets_for(schema, after['amazonAttributes'], MARKET)[0]
    ids = independent_targets(before, after, {'schema': schema, 'marketplace_id': MARKET}, previous, current, [DECLARATION])
    return {target['path'][0] for target in current if target['id'] in ids}


def test_declaration_never_reuses_physical_or_safety_facts_as_independent():
    schema, before, after = setup()
    assert allowed(schema, before, after) == {'list_price', 'target_audience_keyword'}
    for key in ('batteries_required', 'material'):
        altered = deepcopy(after)
        altered['amazonAttributes'][key] = [{'value': False if key == 'batteries_required' else 'Different material'}]
        assert allowed(schema, before, altered) == set()


def test_declaration_still_invalidates_changed_constraints_and_new_requirements():
    schema, before, after = setup()
    schema['properties']['new_evidence'] = value()
    schema['allOf'] = [{'if': {'required': [DECLARATION], 'properties': {
        DECLARATION: {'contains': {'required': ['value'], 'properties': {'value': {'const': 'not_applicable'}}}}}},
        'then': {'required': ['new_evidence'], 'properties': {'target_audience_keyword': {
            'items': {'properties': {'value': {'maxLength': 2}}}}}}}]
    assert allowed(schema, before, after) == {'list_price'}


def test_declaration_requires_an_explicit_answer_to_previously_unresolved_question():
    schema, before, after = setup()
    targets = targets_for(schema, before['amazonAttributes'], MARKET)[0]
    result = {'resolutions': {t['id']: {'resolution': 'unknown'} for t in targets}}
    def connection(source):
        return SimpleNamespace(execute=lambda *_: SimpleNamespace(fetchall=lambda: [
            {'source': source, 'data': after, 'revision': 2}]))
    assert answered_independent_attributes(connection('amazon-requirements-answer'), {'id': 'owner'}, after,
        before, result, targets) == {DECLARATION}
    assert answered_independent_attributes(connection('editor'), {'id': 'owner'}, after,
        before, result, targets) == set()
    assert answered_independent_attributes(connection('amazon-requirements-answer'), {'id': 'owner'}, after,
        before, {'resolutions': {}}, targets) == set()
