"""Documented product/package dimensions retain their scope and explicit units."""
from copy import deepcopy
import pytest
from app.amazon_catalog import MARKETPLACE
from app.product_materials_amazon import infer_attributes
from app.product_requirements_fields import evaluate


def dimensions(units=('centimeters',), axes=('length', 'width', 'height')):
    return {'type': 'array', 'minItems': 1, 'items': {'type': 'object', 'required': list(axes),
        'properties': {axis: {'type': 'object', 'required': ['value', 'unit'], 'properties': {
            'value': {'type': 'number', 'minimum': 0.01},
            'unit': {'type': 'string', 'enum': list(units), 'editable': True, 'hidden': False}}} for axis in axes}}}


def rules(**properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties)}


def custom(name, value, **extra):
    return {'id': name, 'name': name, 'value': value, 'isConfirmed': True, **extra}


def test_complete_product_and_package_differ_from_components_with_conversion():
    schema = rules(item_dimensions=dimensions(), item_package_dimensions=dimensions(('millimeters', 'centimeters')))
    product = {'customFields': [custom(f'{scope} · {axis}', f'{value} {unit}')
        for scope, values, unit in [('Pieza', (75, 25, 15), 'mm'),
            ('Producto completo (torre montada)', (75, 75, 270), 'mm'), ('Caja cerrada', (24.6, 17.4, 5.4), 'cm')]
        for axis, value in zip(('largo', 'ancho', 'alto'), values)]}
    before = deepcopy(product)
    attrs, proof, applied = infer_attributes(product, schema, MARKETPLACE)
    assert applied == {'item_dimensions', 'item_package_dimensions'}
    assert [attrs['item_dimensions'][0][axis]['value'] for axis in ('length', 'width', 'height')] == [7.5, 7.5, 27]
    assert [attrs['item_package_dimensions'][0][axis]['value'] for axis in ('length', 'width', 'height')] == [24.6, 17.4, 5.4]
    assert all(attrs[name][0][axis]['unit'] == 'centimeters' for name in attrs for axis in ('length', 'width', 'height'))
    assert all(p['humanConfirmed'] is False for p in proof.values())
    assert product == before and evaluate(schema, attrs, MARKETPLACE)['valid']


@pytest.mark.parametrize('name', ['Pieza · ancho', 'Torre montada · ancho', 'Base caja · ancho',
    'Producto completo · ancho · diseño nominal', 'Producto completo · ancho · variante azul'])
def test_component_ambiguous_or_nominal_scope_never_fills_product(name):
    schema = rules(item_length_width=dimensions(axes=('width',)))
    attrs, _, _ = infer_attributes({'customFields': [custom(name, '75 mm')]}, schema, MARKETPLACE)
    assert attrs.get('item_length_width', [{}])[0].get('width', {}).get('value') is None


def test_existing_unit_converts_value_existing_value_is_never_replaced():
    schema = rules(item_length_width=dimensions(('millimeters', 'centimeters'), ('width',)))
    product = {'customFields': [custom('Producto completo · ancho', '75 mm')],
               'amazonAttributes': {'item_length_width': [{'width': {'unit': 'centimeters'}}]}}
    attrs, _, _ = infer_attributes(product, schema, MARKETPLACE)
    assert attrs['item_length_width'][0]['width'] == {'unit': 'centimeters', 'value': 7.5}
    product['amazonAttributes']['item_length_width'][0]['width']['value'] = 9
    attrs, _, _ = infer_attributes(product, schema, MARKETPLACE)
    assert attrs == product['amazonAttributes']


def test_missing_unit_is_fixed_by_schema_without_inventing_a_measurement():
    schema = rules(item_length_width=dimensions(axes=('width',)))
    attrs, proof, _ = infer_attributes({}, schema, MARKETPLACE, schema_hash='schema-1')
    assert attrs['item_length_width'][0]['width'] == {'unit': 'centimeters'}
    assert all(p['origin'] == 'schema_fixed' and not p['humanConfirmed'] for p in proof.values())
    assert next(iter(proof.values()))['sources'][0]['sourceVersion'] == 'schema-1'
    remaining = evaluate(schema, attrs, MARKETPLACE)['fields']
    assert len(remaining) == 1 and 'ancho' in remaining[0]['label']


def test_uncertain_or_conflicting_measurements_stay_unresolved():
    schema = rules(item_length_width=dimensions(axes=('width',)))
    product = {'customFields': [custom('Producto completo · ancho', '75 mm'), custom('Ancho del producto', '8 cm')]}
    attrs, _, _ = infer_attributes(product, schema, MARKETPLACE)
    assert 'value' not in attrs.get('item_length_width', [{}])[0].get('width', {})
