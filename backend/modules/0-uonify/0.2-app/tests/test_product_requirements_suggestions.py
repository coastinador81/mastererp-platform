"""Datos confirmados de Drive propuestos con el esquema, sin inferencias ni guardado automático."""
from copy import deepcopy
import pytest
from app.product_requirements_fields import evaluate
from app.product_requirements_suggestions import add_suggestions
from test_product_requirements import requirement_env, configure, value

MARKET = 'A1RKKUPIHCS9HS'


def custom(name, text, confirmed=True, **extra):
    return {'id': 'drive_' + name, 'name': name, 'value': text, 'isConfirmed': confirmed,
            'source': 'Drive · confirmado por el usuario', **extra}


def suggest(attribute, node, fields, existing=None):
    schema = {'type': 'object', 'required': [attribute], 'properties': {attribute: node}}
    product = {'customFields': fields, 'amazonAttributes': existing or {}}
    original = deepcopy(product)
    plan = evaluate(schema, product['amazonAttributes'], MARKET, attribute)
    before = deepcopy(plan['candidate'])
    add_suggestions(plan, product, schema)
    assert product == original and plan['candidate'] == before
    return {plan['specs'][field['id']]['path'][-1]: field.get('suggestion') for field in plan['fields']}


def test_exact_normalized_label_country_enum_and_conservative_alias():
    country = value(enum=['CN', 'ES'], enumNames=['China', 'España'])
    country['title'] = 'País de origen'
    result = suggest('country_of_origin', country, [custom('País de fabricación', 'china')])
    assert result['value']['value'] == 'China'
    assert 'Drive' in result['value']['source']
    assert suggest('country_of_origin', country, [custom('  PAÍS_DE_ORIGEN  ', 'CN')])['value']['value'] == 'China'
    assert suggest('country_of_origin', country, [custom('País del responsable', 'China')])['value'] is None


@pytest.mark.parametrize('confirmed', [False, 'true', None])
def test_unconfirmed_fields_are_not_suggested(confirmed):
    assert suggest('material', value(), [custom('Material', 'Madera', confirmed)])['value'] is None


def test_non_drive_fields_only_keep_existing_explicit_material_contract():
    assert suggest('brand', value(), [custom('Brand', 'Uonify', source='Importación')])['value'] is None
    field = custom('Material', 'Madera', id='preparation_material', source='editor')
    assert suggest('material', value(enum=['wood'], enumNames=['Madera']), [field])['value'] == {
        'value': 'Madera', 'source': 'Material confirmado en la ficha técnica'}


def test_conflicting_values_are_not_resolved_by_first_valid_or_first_source():
    node = value(enum=['wood', 'plastic'], enumNames=['Madera', 'Plástico'])
    assert suggest('material', node, [custom('Material', 'Madera'), custom('Material principal', 'Plástico')])['value'] is None
    assert suggest('material', node, [custom('Material', 'Madera'), custom('Material principal', 'Valor inválido')])['value'] is None
    assert suggest('material', node, [custom('Material', 'Madera'), custom('Material principal', 'wood')])['value']['value'] == 'Madera'


def test_invalid_enum_format_and_existing_value_get_no_suggestion():
    assert suggest('material', value(enum=['wood'], enumNames=['Madera']), [custom('Material', 'Corcho')])['value'] is None
    assert suggest('material', value(pattern='^Corcho$'), [custom('Material', 'Madera')])['value'] is None
    existing = {'material': [{'value': 'Corcho', 'marketplace_id': MARKET}]}
    assert suggest('material', value(), [custom('Material', 'Madera')], existing)['value'] is None


def test_integer_limits_and_decimal_conversion_are_schema_validated():
    node = value('integer', minimum=1, maximum=80)
    node['title'] = 'Número de piezas'
    assert suggest('number_of_pieces', node, [custom('Número de piezas', '54')])['value']['value'] == '54'
    for text in ('0', '81', '2,5', '54 unidades', '1e2'):
        assert suggest('number_of_pieces', node, [custom('Número de piezas', text)])['value'] is None


def weight_node():
    return {'type': 'array', 'items': {'type': 'object', 'required': ['value', 'unit'], 'properties': {
        'value': {'type': 'number', 'title': 'Peso del producto', 'minimum': 0, 'maximum': 20},
        'unit': {'type': 'string', 'enum': ['kilograms', 'grams'], 'enumNames': ['Kilogramos', 'Gramos']}}}}


def test_quantity_and_unit_remain_paired_and_require_explicit_unit():
    result = suggest('item_weight', weight_node(), [custom('Peso del producto', '1,25 kg')])
    assert result['value']['value'] == '1.25' and result['unit']['value'] == 'Kilogramos'
    assert suggest('item_weight', weight_node(), [custom('Peso del producto', '1,25')]) == {'value': None, 'unit': None}
    assert suggest('item_weight', weight_node(), [custom('Peso del producto', '1,25 mg')]) == {'value': None, 'unit': None}
    assert suggest('item_weight', weight_node(), [custom('Peso del producto', '21 kg')])['value'] is None
    assert suggest('item_weight', weight_node(), [custom('Peso del producto (kg)', '1,25')])['value']['value'] == '1.25'


def test_minimum_age_only_converts_explicit_years_to_schema_months():
    node = value('number', minimum=0, maximum=180)
    node['items']['properties']['value']['title'] = 'Edad mínima según el fabricante (MESES)'
    assert suggest('manufacturer_minimum_age', node, [custom('Edad mínima', '3 años')])['value']['value'] == '36.0'
    assert suggest('manufacturer_minimum_age', node, [custom('Edad mínima (años)', '3')])['value']['value'] == '36.0'
    assert suggest('manufacturer_minimum_age', node, [custom('Edad mínima', '36 meses')])['value']['value'] == '36.0'
    assert suggest('manufacturer_minimum_age', node, [custom('Edad mínima', '3')])['value'] is None
    assert suggest('manufacturer_minimum_age', node, [custom('Edad mínima', '20 años')])['value'] is None


def test_ean_requires_explicit_source_and_valid_check_digit():
    node = {'type': 'array', 'items': {'type': 'object', 'required': ['type', 'value'], 'properties': {
        'type': {'type': 'string', 'enum': ['ean', 'upc'], 'enumNames': ['EAN', 'UPC']}, 'value': {'type': 'string'}}}}
    result = suggest('externally_assigned_product_identifier', node, [custom('EAN', '8435833200006')])
    assert result['type']['value'] == 'EAN' and result['value']['value'] == '8435833200006'
    for name, text in [('EAN', '8435833200007'), ('Código desconocido', '8435833200006')]:
        assert suggest('externally_assigned_product_identifier', node, [custom(name, text)]) == {'type': None, 'value': None}


@pytest.mark.parametrize(('name', 'text'), [('Material', 'Madera propuesta'), ('Material', 'Madera · diseño 3D'),
                                          ('Material', 'Pendiente'), ('Material', 'Madera no verificada')])
def test_documentary_qualifiers_do_not_become_factual_suggestions(name, text):
    assert suggest('material', value(), [custom(name, text)])['value'] is None


def test_dimensions_and_certifications_not_inferred_or_composite_mapped():
    assert suggest('item_length', value('number'), [custom('Item length', '75')])['value'] is None
    assert suggest('compliance', value(), [custom('Compliance', 'CE')])['value'] is None
    nested = {'type': 'array', 'items': {'type': 'object', 'required': ['length'], 'properties': {
        'length': {'type': 'object', 'required': ['value'], 'properties': {'value': {'type': 'number'}}}}}}
    assert suggest('item_dimensions', nested, [custom('Item dimensions', '75 × 25 × 15')])['value'] is None


def test_api_reuses_confirmed_drive_suggestion_without_updating_amazon(requirement_env):
    client, _, _, amazon, product, _ = requirement_env
    amazon.schema_data['properties']['country_of_origin'] = value(enum=['CN', 'ES'], enumNames=['China', 'España'])
    current = client.patch('/api/products/BASIC', json={'revision': product['revision'],
        'customFields': [custom('País de origen', 'China')]}).json()['product']
    configured = configure(client, current)
    response = client.get('/api/products/BASIC/amazon-requirements?attribute=country_of_origin').json()
    assert response['evaluation']['fields'][0]['suggestion']['value'] == 'China'
    assert response['product']['revision'] == configured['product']['revision']
    assert 'country_of_origin' not in response['product']['amazonAttributes']
