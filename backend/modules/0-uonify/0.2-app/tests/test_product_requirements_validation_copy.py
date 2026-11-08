"""Los errores explican la regla incumplida sin cambiar las restricciones de Amazon."""
from copy import deepcopy
import pytest
from fastapi import HTTPException
from app.incident_fields import apply_answers
from app.incident_schema_validation import validation_errors
from app.product_requirements_copy import answer_error
from app.product_requirements_fields import apply, evaluate

MARKET = 'A1RKKUPIHCS9HS'


def weight_schema(**constraints):
    return {'type': 'object', 'required': ['item_package_weight'], 'properties': {
        'item_package_weight': {'type': 'array', 'minItems': 1, 'items': {'type': 'object',
            'required': ['unit', 'value'], 'properties': {
                'unit': {'type': 'string', 'enum': ['grams', 'kilograms']},
                'value': {'type': 'number', **constraints}}}}}}


def weight_answers(plan, value):
    return {field['id']: 'Gramos' if plan['specs'][field['id']]['path'][-1] == 'unit' else value
            for field in plan['fields']}


@pytest.mark.parametrize('value', ['-1', '0'])
def test_weight_error_explains_only_the_strongest_failed_lower_bound(value):
    schema = weight_schema(minimum=0, exclusiveMinimum=0, maximum=1000000000.0)
    before, attributes = deepcopy(schema), {}
    plan = evaluate(schema, attributes, MARKET)
    with pytest.raises(HTTPException) as caught:
        apply(schema, attributes, MARKET, weight_answers(plan, value))
    assert caught.value.status_code == 422
    assert caught.value.detail['message'] == '«¿Cuánto pesa el producto con su caja?»: El valor debe ser mayor que 0.'
    assert attributes == {} and schema == before


@pytest.mark.parametrize('value', ['abc', '1 kg'])
def test_weight_format_error_explains_number_and_separate_unit(value):
    schema = weight_schema(minimum=0, exclusiveMinimum=0)
    plan = evaluate(schema, {}, MARKET)
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKET, weight_answers(plan, value))
    assert caught.value.status_code == 400
    message = caught.value.detail['message']
    assert 'Escribe solo el número, sin letras ni unidades.' in message
    assert 'Puedes usar coma para los decimales.' in message
    assert 'La unidad se elige aparte.' in message
    assert 'precisión' not in message and '..' not in message


def test_default_help_explains_format_without_technical_bounds_and_valid_comma_roundtrips():
    schema = weight_schema(minimum=0, exclusiveMinimum=0, maximum=1000000000.0)
    plan = evaluate(schema, {}, MARKET)
    field = next(field for field in plan['fields'] if field['type'] == 'text')
    assert field['hint'] == 'Escribe solo el número; puedes usar coma para los decimales. La unidad se elige aparte.'
    assert field['validation']['maximum'] == 1000000000.0
    result, _ = apply(schema, {}, MARKET, weight_answers(plan, '1,25'))
    assert result['item_package_weight'][0] == {'unit': 'grams', 'value': 1.25}
    assert evaluate(schema, result, MARKET)['valid']


def test_large_maximum_is_explained_only_when_exceeded_with_readable_number():
    schema = weight_schema(maximum=1000000000.0)
    plan = evaluate(schema, {}, MARKET)
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKET, weight_answers(plan, '1000000001'))
    assert caught.value.detail['message'] == '«¿Cuánto pesa el producto con su caja?»: El valor debe ser 1.000.000.000 o menor.'


def test_invalid_unit_keeps_the_choice_error_and_never_becomes_a_number_error():
    schema = weight_schema(minimum=0)
    plan = evaluate(schema, {}, MARKET)
    answers = weight_answers(plan, '1')
    unit = next(field for field in plan['fields'] if field['type'] == 'select')
    answers[unit['id']] = 'inventada'
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKET, answers)
    assert caught.value.status_code == 400
    assert caught.value.detail['message'] == f'Elige una opción admitida en «{unit["label"]}».'


@pytest.mark.parametrize('node,value,message', [
    ({'minimum': 10, 'exclusiveMinimum': 0}, -1, 'El valor debe ser 10 o mayor.'),
    ({'maximum': 10, 'exclusiveMaximum': 12}, 20, 'El valor debe ser 10 o menor.'),
    ({'maximum': 10, 'exclusiveMaximum': 10}, 20, 'El valor debe ser menor que 10.'),
    ({'exclusiveMinimum': 0.25}, 0, 'El valor debe ser mayor que 0,25.'),
])
def test_consolidation_preserves_the_strictest_actual_rule(node, value, message):
    assert answer_error(validation_errors({'type': 'number', **node}, value)) == message


def test_integer_and_precision_errors_explain_the_actual_format_problem():
    schema = {'type': 'object', 'required': ['number_of_pieces'], 'properties': {
        'number_of_pieces': {'type': 'integer', 'minimum': 1}}}
    field = evaluate(schema, {}, MARKET)['fields'][0]
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKET, {field['id']: '1,5'})
    assert caught.value.detail['message'].endswith('Escribe un número entero, sin decimales.')
    schema = weight_schema()
    plan = evaluate(schema, {}, MARKET)
    with pytest.raises(HTTPException) as caught:
        apply(schema, {}, MARKET, weight_answers(plan, '0.12345678901234567890123456789'))
    assert 'más cifras de las que podemos guardar' in caught.value.detail['message']


def test_shared_incident_parser_keeps_its_existing_default_message():
    field = {'id': 'amount', 'label': 'Cantidad', 'required': True}
    with pytest.raises(HTTPException) as caught:
        apply_answers({}, {'amount': {'type': 'number', 'path': ['amount']}}, [field], {'amount': 'abc'})
    assert caught.value.detail['message'] == 'Introduce un número válido en «Cantidad», sin perder precisión.'
