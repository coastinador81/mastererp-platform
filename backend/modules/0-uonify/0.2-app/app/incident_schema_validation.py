"""Validación local PTD: JSON Schema 2019-09 y vocabulario de Amazon, sin red."""
import json
from decimal import Decimal, InvalidOperation, localcontext
from jsonschema import Draft201909Validator, FormatChecker, ValidationError, validators
from referencing import Registry
from .products import fail


def unique_count(instance, schema):
    selectors = schema.get('selectors', [])
    if selectors:
        return len({json.dumps([item.get(key) for key in selectors], sort_keys=True)
                    for item in instance if isinstance(item, dict)})
    return len({json.dumps(item, sort_keys=True) for item in instance})


def _unique(validator, limit, instance, schema, minimum=False):
    if not isinstance(instance, list):
        return
    count = unique_count(instance, schema)
    if (count < limit if minimum else count > limit):
        yield ValidationError(f"Amazon admite {'al menos' if minimum else 'como máximo'} {limit} combinaciones de valores.")


def _bytes(validator, limit, instance, schema, minimum=False):
    if isinstance(instance, str) and (len(instance.encode('utf-8')) < limit if minimum else len(instance.encode('utf-8')) > limit):
        yield ValidationError(f"Amazon admite {'al menos' if minimum else 'como máximo'} {limit} bytes UTF-8.")


def _multiple(validator, divisor, instance, schema):
    if not isinstance(instance, (int, float, Decimal)) or isinstance(instance, bool): return
    try:
        number, factor = Decimal(str(instance)), Decimal(str(divisor))
        with localcontext() as context:
            context.prec = max(50, len(str(instance)) + len(str(divisor)) + 20)
            valid = number.is_finite() and factor.is_finite() and factor > 0 and number % factor == 0
    except (InvalidOperation, ValueError):
        valid = False
    if not valid:
        yield ValidationError('El número debe ser un múltiplo exacto del incremento admitido por Amazon.')


AmazonValidator = validators.extend(Draft201909Validator, {
    'multipleOf': _multiple,
    'minUniqueItems': lambda v, n, i, s: _unique(v, n, i, s, True),
    'maxUniqueItems': _unique,
    'minUtf8ByteLength': lambda v, n, i, s: _bytes(v, n, i, s, True),
    'maxUtf8ByteLength': _bytes,
    'uniqueItems': lambda v, enabled, i, s: iter([ValidationError('Hay elementos repetidos según los selectores de Amazon.')])
    if enabled and isinstance(i, list) and unique_count(i, s) < len(i) else iter([]),
})


FORMATS = FormatChecker()


def check_formats(schema):
    """Falla explícitamente si el runtime no sabe validar un formato declarado."""
    stack = [schema]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict): continue
        if isinstance(node.get('format'), str) and node['format'] not in FORMATS.checkers:
            raise ValueError('Unsupported schema format')
        for key in ('properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'):
            if isinstance(node.get(key), dict): stack.extend(node[key].values())
        for key in ('allOf', 'anyOf', 'oneOf'):
            if isinstance(node.get(key), list): stack.extend(node[key])
        for key in ('items', 'contains', 'if', 'then', 'else', 'not', 'additionalProperties', 'propertyNames'):
            if isinstance(node.get(key), dict): stack.append(node[key])


def validator_for(schema):
    # Registry sin retrieve: un $ref externo no puede disparar peticiones arbitrarias.
    if schema.get('$schema') not in (None, 'https://schemas.amazon.com/selling-partners/definitions/product-types/meta-schema/v1',
                                    'https://json-schema.org/draft/2019-09/schema'):
        raise ValueError('Unsupported schema dialect')
    check_formats(schema)
    return AmazonValidator(schema, registry=Registry(), format_checker=FORMATS)


def validation_errors(schema, attributes):
    try:
        return list(validator_for(schema).iter_errors(attributes))
    except Exception:
        fail('unsupported_amazon_schema', 'No podemos validar esta versión de requisitos de Amazon con seguridad. Conservamos tus datos; solicita revisión de estos requisitos.', 409)


def error_detail(error):
    path = ' / '.join(str(part) for part in error.absolute_path) or 'Ficha'
    labels = {'required': 'Falta un campo obligatorio', 'enum': 'Elige una opción admitida por Amazon',
              'type': 'El formato del valor no es correcto', 'pattern': 'El texto no coincide con el formato requerido',
              'anyOf': 'El valor no cumple las alternativas admitidas', 'oneOf': 'Selecciona una alternativa válida',
              'additionalProperties': 'Hay un campo que Amazon no admite', 'minimum': 'El valor es inferior al mínimo',
              'maximum': 'El valor supera el máximo', 'minLength': 'El texto es demasiado corto',
              'maxLength': 'El texto es demasiado largo', 'format': 'El formato no es válido',
              'multipleOf': 'Usa un múltiplo exacto del incremento admitido'}
    result = {'path': path, 'rule': str(error.validator), 'message': labels.get(error.validator, 'Revisa el valor según los requisitos de Amazon')}
    if isinstance(error.validator_value, (str, int, float, bool)):
        result['accepted'] = str(error.validator_value)[:200]
    if error.validator == 'required':
        missing = [key for key in error.validator_value if key not in error.instance]
        result['missing'] = missing
        result['message'] += ': ' + ', '.join(missing)
    return result


def validate_attributes(schema, attributes, changed_names):
    if not isinstance(attributes, dict) or not changed_names or any(name not in schema.get('properties', {}) for name in changed_names):
        fail('invalid_incident_attributes', 'Los atributos no corresponden a los requisitos actuales de Amazon.')
    errors = validation_errors(schema, attributes)
    if errors:
        details = [error_detail(error) for error in errors[:12]]
        fail('invalid_amazon_attributes', 'Revisa los campos indicados antes de preparar la corrección: ' + '; '.join(f"{item['path']}: {item['message']}" for item in details), 422)
