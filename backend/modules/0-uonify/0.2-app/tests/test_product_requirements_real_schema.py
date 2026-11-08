"""PTD real y casos adversos: no publica ni consulta cuentas externas."""
from copy import deepcopy
import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from app.product_requirements_fields import apply, evaluate
from app.product_requirements_mapping import from_amazon, to_amazon
from test_product_requirements import requirement_env, configure, value

MARKET = 'A1RKKUPIHCS9HS'


@pytest.fixture(params=('listing', 'listing_product_only'))
def tabletop(request):
    default = Path(__file__).resolve().parents[2] / 'artifacts/amazon-spapi/amazon-B07NPPMZM8-20261012/listing_product_only.schema.json'
    path = Path(os.environ.get('UONIFY_PTD_FIXTURE_PATH', str(default))).with_name(request.param + '.schema.json')
    if not path.is_file():
        pytest.skip('El runner necesita montar el PTD real o indicar UONIFY_PTD_FIXTURE_PATH.')
    return json.loads(path.read_text())


def field_at(plan, *path):
    return next(field for field in plan['fields'] if plan['specs'][field['id']]['path'] == list(path))


def attribute_node(plan, name):
    return next(item for item in plan['attributes'] if item['id'] == name)


def test_real_empty_draft_requires_evaluated_conditions_not_only_seven_base(tabletop):
    plan = evaluate(tabletop, {}, MARKET)
    assert plan['counts']['missing'] > len(tabletop['required'])
    assert not plan['valid']
    assert attribute_node(plan, 'item_package_dimensions')['required']
    assert attribute_node(plan, 'safety_warning')['required']
    assert attribute_node(plan, 'externally_assigned_product_identifier')['required']


def test_real_identifier_answer_removes_unnecessary_asin_question(tabletop):
    initial = evaluate(tabletop, {}, MARKET, 'externally_assigned_product_identifier')
    kind = field_at(initial, 'externally_assigned_product_identifier', 0, 'type')
    value = field_at(initial, 'externally_assigned_product_identifier', 0, 'value')
    updated, touched = apply(tabletop, {}, MARKET, {kind['id']: 'EAN', value['id']: '8435833200006'},
                             'externally_assigned_product_identifier')
    assert touched == {'externally_assigned_product_identifier'}
    assert updated['externally_assigned_product_identifier'] == [
        {'type': 'ean', 'value': '8435833200006', 'marketplace_id': MARKET}]
    after = evaluate(tabletop, updated, MARKET)
    assert not attribute_node(after, 'merchant_suggested_asin')['required']
    assert not after['valid']  # This answers identification, not the entire listing.
    assert 'merchant_suggested_asin' not in updated


def test_real_creation_accepts_noneditable_brand_and_does_not_autofill_examples(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'brand')
    field = field_at(plan, 'brand', 0, 'value')
    assert not field['closed']
    assert 'value' not in field
    updated, _ = apply(tabletop, {}, MARKET, {field['id']: 'Uonify'}, 'brand')
    assert updated['brand'][0]['value'] == 'Uonify'
    assert updated['brand'][0]['language_tag'] == 'es_ES'
    assert attribute_node(evaluate(tabletop, updated, MARKET), 'brand')['required']
    assert attribute_node(evaluate(tabletop, updated, MARKET), 'brand')['valid']


def test_real_country_labels_map_to_enum_and_reject_arbitrary_values(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'country_of_origin')
    field = field_at(plan, 'country_of_origin', 0, 'value')
    assert field['closed'] and 'China' in field['options']
    with pytest.raises(HTTPException):
        apply(tabletop, {}, MARKET, {field['id']: 'Fabricado en China'}, 'country_of_origin')
    updated, _ = apply(tabletop, {}, MARKET, {field['id']: 'China'}, 'country_of_origin')
    assert updated['country_of_origin'][0]['value'] == 'CN'


def test_real_battery_answer_activates_then_removes_dependent_question(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'batteries_required')
    field = field_at(plan, 'batteries_required', 0, 'value')
    yes, _ = apply(tabletop, {}, MARKET, {field['id']: 'Sí'}, 'batteries_required')
    assert attribute_node(evaluate(tabletop, yes, MARKET), 'batteries_included')['required']
    no, _ = apply(tabletop, yes, MARKET, {field['id']: 'No'}, 'batteries_required')
    assert not attribute_node(evaluate(tabletop, no, MARKET), 'batteries_included')['required']


def test_real_dimensions_keep_structure_translate_units_and_reject_unit_in_number(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'item_length_width')
    length = field_at(plan, 'item_length_width', 0, 'length', 'value')
    assert length['validation']['number'] == 'number'
    assert plan['candidate']['item_length_width'][0]['length']['unit'] == 'centimeters'
    assert not any(spec['path'][-1] == 'unit' for spec in plan['specs'].values())
    assert 'centímetros' in length['hint']
    with pytest.raises(HTTPException):
        apply(tabletop, {}, MARKET, {length['id']: '7 cm'}, 'item_length_width')
    updated, _ = apply(tabletop, {}, MARKET, {length['id']: '7,5'}, 'item_length_width')
    assert updated['item_length_width'][0]['length'] == {'value': 7.5, 'unit': 'centimeters'}
    after = evaluate(tabletop, updated, MARKET, 'item_length_width')
    assert field_at(after, 'item_length_width', 0, 'width', 'value')
    assert not after['valid']


def test_nested_required_added_by_condition_keeps_array_item_properties():
    schema = {'type': 'object', 'required': ['powered'], 'properties': {
        'powered': {'type': 'boolean'},
        'battery': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'chemistry': {'type': 'string', 'enum': ['alkaline', 'lithium']},
            'serial': {'type': 'string'}}}}},
        'if': {'required': ['powered'], 'properties': {'powered': {'const': True}}},
        'then': {'required': ['battery'], 'properties': {'battery': {'items': {'required': ['chemistry']}}}}}
    initial = {'powered': True}
    plan = evaluate(schema, initial, MARKET)
    field = field_at(plan, 'battery', 0, 'chemistry')
    assert field['required'] and field['options'] == ['Alcalina', 'Litio']
    result, _ = apply(schema, initial, MARKET, {field['id']: 'Alcalina'})
    assert evaluate(schema, result, MARKET)['valid']
    assert result == {'powered': True, 'battery': [{'chemistry': 'alkaline'}]}


def test_ambiguous_object_alternatives_are_not_silently_selected_or_marked_valid():
    schema = {'type': 'object', 'required': ['identity'], 'properties': {
        'identity': {'oneOf': [
            {'type': 'object', 'required': ['ean'], 'properties': {'ean': {'type': 'string'}}},
            {'type': 'object', 'required': ['asin'], 'properties': {'asin': {'type': 'string'}}}]}}}
    plan = evaluate(schema, {}, MARKET)
    assert not plan['valid'] and plan['needsReview']
    assert not plan['fields']
    assert any(issue['rule'] == 'manual_review' for issue in plan['issues'])


def test_intersected_limits_reject_an_answer_allowed_only_by_last_branch():
    schema = {'type': 'object', 'required': ['height'], 'properties': {
        'height': {'type': 'number', 'allOf': [{'minimum': 4, 'maximum': 7}, {'minimum': 2, 'maximum': 10}]}}}
    plan = evaluate(schema, {}, MARKET)
    field = field_at(plan, 'height')
    assert field['validation']['minimum'] == 4 and field['validation']['maximum'] == 7
    for invalid in ['3', '8', 'NaN', 'Infinity', '5 cm']:
        with pytest.raises(HTTPException):
            apply(schema, {}, MARKET, {field['id']: invalid})
    updated, _ = apply(schema, {}, MARKET, {field['id']: '5,5'})
    assert updated['height'] == 5.5 and evaluate(schema, updated, MARKET)['valid']


def test_boolean_options_obey_a_restricted_enum():
    schema = {'type': 'object', 'required': ['battery'], 'properties': {
        'battery': {'type': 'boolean', 'enum': [False]}}}
    field = evaluate(schema, {}, MARKET)['fields'][0]
    assert field['options'] == ['No']
    with pytest.raises(HTTPException):
        apply(schema, {}, MARKET, {field['id']: 'Sí'})
    updated, _ = apply(schema, {}, MARKET, {field['id']: 'No'})
    assert updated == {'battery': False}


def test_utf8_limit_is_enforced_without_confusing_character_count():
    schema = {'type': 'object', 'required': ['name'], 'properties': {
        'name': {'type': 'string', 'maxUtf8ByteLength': 4}}}
    field = evaluate(schema, {}, MARKET)['fields'][0]
    with pytest.raises(HTTPException):
        apply(schema, {}, MARKET, {field['id']: '€€'})
    updated, _ = apply(schema, {}, MARKET, {field['id']: '€a'})
    assert evaluate(schema, updated, MARKET)['valid']


def test_valid_existing_facts_are_not_asked_again_and_unrelated_answers_rejected():
    schema = {'type': 'object', 'required': ['name', 'age'], 'properties': {
        'name': {'type': 'string', 'minLength': 1}, 'age': {'type': 'integer', 'minimum': 0}}}
    existing = {'name': 'Dato confirmado'}
    plan = evaluate(schema, existing, MARKET)
    assert [plan['specs'][f['id']]['path'] for f in plan['fields']] == [['age']]
    with pytest.raises(HTTPException):
        apply(schema, existing, MARKET, {'invented-field': '3'})
    assert existing == {'name': 'Dato confirmado'}


def test_mapping_preserves_foreign_market_language_and_unmapped_attribute():
    schema = {'properties': {'item_name': {}, 'brand': {}}}
    attributes = {'item_name': [
        {'value': 'French', 'marketplace_id': 'A13V1IB3VIYZZH', 'language_tag': 'fr_FR'},
        {'value': 'English ES', 'marketplace_id': MARKET, 'language_tag': 'en_GB'},
        {'value': 'Antes', 'marketplace_id': MARKET, 'language_tag': 'es_ES'}],
        'custom': [{'value': 'Conservar'}]}
    original = deepcopy(attributes)
    updated = to_amazon({'name': 'Después'}, schema, attributes, MARKET, {'name'})
    assert updated['item_name'][:2] == attributes['item_name'][:2]
    assert updated['item_name'][2]['value'] == 'Después'
    assert updated['custom'] == attributes['custom']
    assert attributes == original
    assert from_amazon({}, updated, MARKET, {'item_name'}) == {'name': 'Después'}


def test_mapping_does_not_truncate_seven_or_more_amazon_bullets():
    attributes = {'bullet_point': [{'value': f'Viñeta {i}', 'marketplace_id': MARKET, 'language_tag': 'es_ES'} for i in range(10)]}
    original = deepcopy(attributes)
    assert from_amazon({'bullets': ['Anterior']}, attributes, MARKET, {'bullet_point'}) == {}
    assert attributes == original


def test_other_market_does_not_satisfy_local_requirement_or_get_overwritten():
    schema = {'type': 'object', 'required': ['item_name'], 'properties': {
        'item_name': {'type': 'array', 'minItems': 1, 'items': {
            'type': 'object', 'required': ['value', 'marketplace_id', 'language_tag'],
            'properties': {'value': {'type': 'string', 'minLength': 1},
                           'marketplace_id': {'const': MARKET}, 'language_tag': {'const': 'es_ES'}}}}}}
    french = {'value': 'Français', 'marketplace_id': 'A13V1IB3VIYZZH', 'language_tag': 'fr_FR'}
    other_language = {'value': 'English', 'marketplace_id': MARKET, 'language_tag': 'en_GB'}
    attrs = {'item_name': [deepcopy(french), deepcopy(other_language)]}
    plan = evaluate(schema, attrs, MARKET)
    assert not plan['valid'] and plan['counts']['missing'] == 1
    field = field_at(plan, 'item_name', 0, 'value')
    updated, _ = apply(schema, attrs, MARKET, {field['id']: 'Español'})
    assert updated['item_name'][:2] == [french, other_language]
    assert updated['item_name'][2] == {'value': 'Español', 'marketplace_id': MARKET, 'language_tag': 'es_ES'}
    assert evaluate(schema, updated, MARKET)['valid']
    assert attrs['item_name'] == [french, other_language]


def test_real_date_alternatives_explain_formats_and_validate_actual_calendar_dates(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'product_site_launch_date')
    field = field_at(plan, 'product_site_launch_date', 0, 'value')
    assert 'año-mes-día' in field['hint'] and 'hora' in field['hint']
    assert 'date-time' not in field['hint']
    for invalid in ['mañana', '2026-02-31', '14/10/2026']:
        with pytest.raises(HTTPException):
            apply(tabletop, {}, MARKET, {field['id']: invalid}, 'product_site_launch_date')
    for valid in ['2026-10-14', '2026-10-14T12:00:00Z']:
        result, _ = apply(tabletop, {}, MARKET, {field['id']: valid}, 'product_site_launch_date')
        assert result['product_site_launch_date'][0]['value'] == valid


def test_real_image_uri_format_rejects_plain_text_spaces_and_relative_paths(tabletop):
    plan = evaluate(tabletop, {}, MARKET, 'main_product_image_locator')
    field = field_at(plan, 'main_product_image_locator', 0, 'media_location')
    assert 'enlace completo' in field['hint'] and 'uri' not in field['hint']
    for invalid in ['Aquí está la imagen', 'https://example.test/image 1.png', '/image.png']:
        with pytest.raises(HTTPException):
            apply(tabletop, {}, MARKET, {field['id']: invalid}, 'main_product_image_locator')
    result, _ = apply(tabletop, {}, MARKET, {field['id']: 'https://example.test/image.png'}, 'main_product_image_locator')
    assert result['main_product_image_locator'][0]['media_location'] == 'https://example.test/image.png'


def test_switching_market_and_back_keeps_both_markets_confirmed_values(requirement_env):
    client, _, _, _, product, _ = requirement_env
    configured = configure(client, product)
    es = client.patch('/api/products/BASIC', json={'revision': configured['product']['revision'], 'brand': 'Marca española'}).json()['product']
    fr = client.post('/api/products/BASIC/amazon-requirements', json={
        'revision': es['revision'], 'productType': 'TOY', 'marketplaceId': 'A13V1IB3VIYZZH'}).json()['product']
    fr = client.patch('/api/products/BASIC', json={'revision': fr['revision'], 'brand': 'Marque française'}).json()['product']
    restored = client.post('/api/products/BASIC/amazon-requirements', json={
        'revision': fr['revision'], 'productType': 'TOY', 'marketplaceId': MARKET})
    assert restored.status_code == 200, restored.text
    brands = restored.json()['product']['amazonAttributes']['brand']
    assert next(item['value'] for item in brands if item['marketplace_id'] == MARKET) == 'Marca española'
    assert next(item['value'] for item in brands if item['marketplace_id'] == 'A13V1IB3VIYZZH') == 'Marque française'


def test_full_editor_payload_does_not_reduce_ten_amazon_bullets_on_price_edit(requirement_env):
    client, db, _, amazon, product, _ = requirement_env
    amazon.schema_data['properties']['bullet_point'] = value()
    configured = configure(client, product)
    attributes = deepcopy(configured['product']['amazonAttributes'])
    attributes['bullet_point'] = [{'value': f'Viñeta {i}', 'marketplace_id': MARKET, 'language_tag': 'es_ES'} for i in range(10)]
    # Simula un catálogo importado cuyo array Amazon es mayor que el editor genérico.
    with db.connect() as c:
        row = c.execute('SELECT id,data FROM products WHERE sku=%s', ('BASIC',)).fetchone()
        c.execute('UPDATE products SET data=%s,revision=revision+1 WHERE id=%s',
                  (Jsonb({**row['data'], 'bullets': ['Vista previa anterior'], 'amazonAttributes': attributes}), row['id']))
    current = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    saved = client.patch('/api/products/BASIC', json={**current, 'price': '19.99'})
    assert saved.status_code == 200, saved.text
    assert saved.json()['product']['amazonAttributes']['bullet_point'] == attributes['bullet_point']


@pytest.mark.parametrize('confirmed', [True, False, 'false'])
def test_confirmed_required_material_is_reused_without_asking_again(requirement_env, confirmed):
    client, _, _, _, product, _ = requirement_env
    custom = {'id': 'preparation_material', 'name': 'Material', 'value': 'Madera', 'isConfirmed': confirmed, 'type': 'text'}
    updated = client.patch('/api/products/BASIC', json={'revision': product['revision'], 'customFields': [custom]})
    assert updated.status_code == 200, updated.text
    configured = configure(client, updated.json()['product'])
    selected = client.get('/api/products/BASIC/amazon-requirements?attribute=material').json()
    field = selected['evaluation']['fields'][0]
    if confirmed is True:
        assert field['value'] == 'Madera'  # Manual editor retains the stored value.
        assert configured['product']['amazonAttributes']['material'][0]['value'] == 'wood'
        assert selected['product']['amazonAttributes']['material'][0]['value'] == 'wood'
        automatic = client.get('/api/products/BASIC/amazon-requirements').json()
        assert all('material' not in item['label'].lower() for item in automatic['evaluation']['fields'])
    else:
        assert 'suggestion' not in field
        assert 'material' not in configured['product']['amazonAttributes']
        assert 'material' not in selected['product']['amazonAttributes']
    assert selected['product']['customFields'] == updated.json()['product']['customFields']


def test_confirmed_material_suggestion_must_also_meet_current_schema_format(requirement_env):
    client, _, _, amazon, product, _ = requirement_env
    amazon.schema_data['properties']['material'] = value(pattern='^Corcho$')
    custom = {'id': 'preparation_material', 'name': 'Material', 'value': 'Madera', 'isConfirmed': True, 'type': 'text'}
    updated = client.patch('/api/products/BASIC', json={'revision': product['revision'], 'customFields': [custom]})
    configure(client, updated.json()['product'])
    selected = client.get('/api/products/BASIC/amazon-requirements?attribute=material').json()
    assert 'suggestion' not in selected['evaluation']['fields'][0]


@pytest.mark.parametrize(('step', 'accepted', 'rejected'), [(0.01, '19.99', '19.991'), (0.001, '0.007', '0.0071'), (0.00001, '0.00007', '0.000071')])
def test_decimal_steps_accept_exact_decimal_multiples(step, accepted, rejected):
    schema = {'type': 'object', 'required': ['weight'], 'properties': {'weight': {'type': 'number', 'multipleOf': step}}}
    field = evaluate(schema, {}, MARKET)['fields'][0]
    result, _ = apply(schema, {}, MARKET, {field['id']: accepted})
    assert evaluate(schema, result, MARKET)['valid']
    with pytest.raises(HTTPException):
        apply(schema, {}, MARKET, {field['id']: rejected})


def test_integer_answer_never_rounds_silently_beyond_transport_precision():
    schema = {'type': 'object', 'required': ['count'], 'properties': {'count': {'type': 'integer'}}}
    field = evaluate(schema, {}, MARKET)['fields'][0]
    for unsafe in ['9007199254740993', '1e9999999']:
        with pytest.raises(HTTPException):
            apply(schema, {}, MARKET, {field['id']: unsafe})


@pytest.mark.parametrize('attribute', ['language', 'eu_toys_safety_directive_language'])
def test_real_required_language_selectors_allow_spanish_without_manual_review(tabletop, attribute):
    plan = evaluate(tabletop, {}, MARKET, attribute)
    assert not plan['needsReview']
    field = field_at(plan, attribute, 0, 'value')
    assert field['closed'] and 'Español' in field['options']
    assert len(field['options']) == 539  # Cinco alias de idioma, sin repetirlos ni mostrar códigos internos.
    assert not any('_' in option for option in field['options'])
    result, _ = apply(tabletop, {}, MARKET, {field['id']: 'Español'}, attribute)
    assert result[attribute][0]['value'] == 'spanish'


def test_unknown_format_does_not_create_a_successful_schema_snapshot(requirement_env):
    client, db, _, amazon, product, _ = requirement_env
    amazon.schema_data['properties']['unsupported'] = value(format='unknown-amazon-format')
    result = client.post('/api/products/BASIC/amazon-requirements', json={
        'revision': product['revision'], 'productType': 'TOY'})
    assert result.status_code == 409, result.text
    current = client.get('/api/products/BASIC/amazon-requirements').json()
    assert current['evaluation']['state'] == 'unconfigured'
    assert current['product']['revision'] == product['revision']
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_requirement_schemas').fetchone()['n'] == 0
