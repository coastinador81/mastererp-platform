"""El cliente ve preguntas y ayuda; las reglas y claves siguen validándose internamente."""
import json
import re
import pytest
from fastapi import HTTPException
from app.product_requirements_copy import option_pairs
from app.product_requirements_fields import apply, evaluate
from app.product_requirements_guide import reference_asin
from test_product_requirements import value
from test_product_requirements_real_schema import tabletop, MARKET, field_at


def visible(field):
    return ' '.join([field['label'], field.get('hint', ''), *field.get('options', [])])


def test_raw_patterns_are_explained_and_still_reject_invalid_answers():
    schema = {'type': 'object', 'required': ['externally_assigned_product_identifier'], 'properties': {
        'externally_assigned_product_identifier': value(pattern='^[0-9]{13}$')}}
    plan = evaluate(schema, {}, MARKET)
    field = plan['fields'][0]
    assert field['label'] == '¿Cuál es el número del código de barras?'
    assert '13 dígitos' in field['hint'] and '^[0-9]' not in visible(field)
    assert field['validation']['pattern'] == '^[0-9]{13}$'
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKET, {field['id']: 'ABC'})
    assert '13 dígitos' in caught.value.detail['message']
    assert 'externally_assigned' not in caught.value.detail['message']
    result, _ = apply(schema, {}, MARKET, {field['id']: '8435833200006'})
    assert evaluate(schema, result, MARKET)['valid']


def test_unknown_technical_label_never_creates_an_incomprehensible_question():
    schema = {'type': 'object', 'required': ['opaque_code_x19'], 'properties': {
        'opaque_code_x19': {'type': 'string'}}}
    plan = evaluate(schema, {}, MARKET)
    assert plan['needsReview'] and not plan['fields'] and not plan['valid']
    assert all('opaque_code' not in issue['message'] for issue in plan['issues'])
    assert plan['issues'][-1]['label'] == 'Dato de Amazon pendiente de revisar'


def test_unknown_enum_is_not_presented_as_raw_code_or_silently_mapped():
    schema = {'type': 'object', 'required': ['material'], 'properties': {
        'material': value(enum=['internal_option_one', 'internal_option_two'])}}
    plan = evaluate(schema, {}, MARKET)
    assert plan['needsReview'] and not plan['fields'] and not plan['valid']
    assert 'internal_option' not in str([issue['message'] for issue in plan['issues']])


def test_duplicate_language_alias_preserves_existing_code_without_displaying_it():
    assert option_pairs(['scots_gaelic', 'gaelic_scots'], ['Gaélico escocés'] * 2, 'gaelic_scots') == [
        ('gaelic_scots', 'Gaélico escocés')]
    with pytest.raises(ValueError):
        option_pairs(['two_different_things', 'same_label'], ['Ambiguo', 'Ambiguo'])


def test_human_choices_round_trip_to_original_amazon_values():
    schema = {'type': 'object', 'required': ['material'], 'properties': {
        'material': value(enum=['wood', 'plastic'])}}
    plan = evaluate(schema, {}, MARKET)
    field = plan['fields'][0]
    assert field['options'] == ['Madera', 'Plástico']
    assert plan['specs'][field['id']]['choices']['Madera'] == 'wood'
    result, _ = apply(schema, {}, MARKET, {field['id']: 'Madera'})
    assert result['material'][0]['value'] == 'wood'


def test_real_required_questions_have_human_text_and_no_schema_syntax(tabletop):
    plan = evaluate(tabletop, {}, MARKET)
    for attribute in [item for item in plan['attributes'] if item['required']]:
        selected = evaluate(tabletop, {}, MARKET, attribute['id'])
        for field in selected['fields']:
            assert field['label'].startswith('¿'), field
            assert len(field['label']) <= 100
            assert not re.search(r'\$\.|fields\[|version|versión|[a-f0-9]{24,}|UTF-8|date-time|[_{}\\]', visible(field)), field
    # This is a safety declaration about missing warnings, not a claim of certification.
    field = evaluate(tabletop, {}, MARKET, 'gpsr_safety_attestation')['fields'][0]
    assert field['label'] == '¿Puede usarse con seguridad sin advertencias ni instrucciones de seguridad?'
    assert field['options'] == ['Sí', 'No']


def test_actual_package_dimensions_distinguish_measurements_and_units(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'item_package_dimensions')
    assert field_at(plan, 'item_package_dimensions', 0, 'width', 'value')['label'] == '¿Cuánto mide el ancho de la caja?'
    assert field_at(plan, 'item_package_dimensions', 0, 'height', 'unit')['label'] == '¿En qué unidad está la altura de la caja?'
    field = evaluate(tabletop, {}, MARKET, 'item_package_weight')['fields'][0]
    assert field['label'] == '¿Cuánto pesa el producto con su caja?'


@pytest.mark.parametrize('value', ['https://www.amazon.es/Nene-Toys/dp/B07NPPMZM8/?th=1',
                                  'https://amazon.de/gp/aw/d/B07NPPMZM8', 'b07nppmzm8'])
def test_reference_can_be_an_ordinary_product_link(value):
    assert reference_asin(value) == 'B07NPPMZM8'


@pytest.mark.parametrize('value', ['https://amazon.es.example.org/dp/B07NPPMZM8', 'file:///dp/B07NPPMZM8', 'Juguetes'])
def test_reference_never_extracts_an_identifier_from_an_untrusted_site(value):
    with pytest.raises(HTTPException): reference_asin(value)


def test_known_category_needing_technical_review_does_not_ask_the_category_again():
    from app.product_requirements_guide import form_for
    result = {'product': {'sku': 'BASIC', 'revision': 3}, 'evaluation': {
        'state': 'needs_review', 'productType': 'TABLETOP_GAME', 'fields': [],
        'message': 'Hay un requisito que aún no podemos comprobar.'}}
    assert form_for(result, 'request') is None
    assert result['evaluation']['state'] == 'needs_review'


def test_internal_evaluation_can_map_known_data_without_requiring_customer_copy():
    schema = {'type': 'object', 'required': ['internal_field_code'], 'properties': {
        'internal_field_code': value(enum=['internal_option_one', 'internal_option_two'])}}
    customer = evaluate(schema, {}, MARKET)
    internal = evaluate(schema, {}, MARKET, human=False)
    assert not customer['fields'] and customer['needsReview']
    field = internal['fields'][0]
    spec = internal['specs'][field['id']]
    assert spec['path'] == ['internal_field_code', 0, 'value']
    assert spec['choices']['internal_option_one'] == 'internal_option_one'
    assert not internal['valid'] and internal['counts']['missing'] == customer['counts']['missing']
    accepted = {'internal_field_code': [{'value': 'internal_option_one', 'marketplace_id': MARKET}]}
    assert evaluate(schema, accepted, MARKET, human=False)['valid']
    rejected = {'internal_field_code': [{'value': 'unlisted', 'marketplace_id': MARKET}]}
    assert not evaluate(schema, rejected, MARKET, human=False)['valid']


def test_piece_count_uses_plain_copy_without_changing_internal_path():
    schema = {'type': 'object', 'required': ['number_of_pieces'], 'properties': {
        'number_of_pieces': value('integer', minimum=1)}}
    plan = evaluate(schema, {}, MARKET)
    field = plan['fields'][0]
    assert field['label'] == '¿Cuántas piezas incluye el producto?'
    assert plan['specs'][field['id']]['path'] == ['number_of_pieces', 0, 'value']


def test_real_audience_and_recommended_price_questions_are_plain(tabletop):
    for attribute, leaf, question in [
        ('target_audience_keyword', 'value', '¿Para quién está pensado el producto?'),
        ('list_price', 'value_with_tax', '¿Qué precio de venta recomienda el fabricante?'),
    ]:
        if attribute not in tabletop['properties']:
            continue
        plan = evaluate(tabletop, {}, MARKET, attribute)
        field = field_at(plan, attribute, 0, leaf)
        internal = evaluate(tabletop, {}, MARKET, attribute, human=False)
        original = field_at(internal, attribute, 0, leaf)
        assert field['label'] == question
        assert field['id'] == original['id']
        assert plan['specs'][field['id']] == internal['specs'][original['id']]
        assert field.get('validation') == original.get('validation')


def test_fulfillment_question_keeps_both_choices_and_original_codes(tabletop):
    attribute = 'fulfillment_availability'
    if attribute not in tabletop['properties']:
        return  # Product-only schemas do not request an offer's shipping method.
    plan = evaluate(tabletop, {}, MARKET, attribute)
    field = field_at(plan, attribute, 0, 'fulfillment_channel_code')
    internal = evaluate(tabletop, {}, MARKET, attribute, human=False)
    original = field_at(internal, attribute, 0, 'fulfillment_channel_code')
    assert field['label'] == '¿Cómo vas a enviar los pedidos?'
    assert field['options'] == ['Amazon enviará los pedidos (Europa)', 'Yo enviaré los pedidos']
    assert 'value' not in field
    assert field['id'] == original['id']
    assert plan['specs'][field['id']]['type'] == internal['specs'][original['id']]['type'] == 'string'
    assert plan['specs'][field['id']]['schema'] == internal['specs'][original['id']]['schema']
    original_schema = tabletop['properties'][attribute]['items']['properties']['fulfillment_channel_code']
    assert original['label'] == original_schema['title']
    assert original['options'] == original_schema['enumNames']
    assert 'AMAZON_EU' not in visible(field) and 'DEFAULT' not in visible(field)
    for label, code in [('Amazon enviará los pedidos (Europa)', 'AMAZON_EU'), ('Yo enviaré los pedidos', 'DEFAULT')]:
        updated, _ = apply(tabletop, {}, MARKET, {field['id']: label}, attribute)
        assert updated[attribute][0]['fulfillment_channel_code'] == code
    assert option_pairs(['DEFAULT'], ['Opción predeterminada']) == [('DEFAULT', 'Opción predeterminada')]
