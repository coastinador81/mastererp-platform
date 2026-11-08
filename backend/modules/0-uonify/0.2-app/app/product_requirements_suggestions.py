"""Sugerencias de datos confirmados: coincidencia conservadora, sin escribir atributos Amazon."""
from decimal import Decimal, InvalidOperation
import math
import re
import unicodedata
from .incident_schema_validation import validator_for

ALIASES = {
    'material': {'material', 'material principal', 'tipo de material'},
    'country_of_origin': {'pais de origen', 'pais de fabricacion'},
    'manufacturer_minimum_age': {'edad minima', 'edad minima recomendada', 'edad minima del fabricante'},
    'externally_assigned_product_identifier': {'ean', 'ean 13', 'codigo ean', 'gtin ean'},
    'item_weight': {'peso del producto', 'peso neto del producto'},
    'item_package_weight': {'peso del paquete', 'peso del producto embalado'},
}
UNITS = {
    'g': 'grams', 'gramo': 'grams', 'gramos': 'grams', 'grams': 'grams',
    'kg': 'kilograms', 'kilogramo': 'kilograms', 'kilogramos': 'kilograms', 'kilograms': 'kilograms',
    'mg': 'milligrams', 'miligramo': 'milligrams', 'miligramos': 'milligrams', 'milligrams': 'milligrams',
    'ano': 'years', 'anos': 'years', 'year': 'years', 'years': 'years',
    'mm': 'millimeters', 'milimetro': 'millimeters', 'milimetros': 'millimeters', 'millimeters': 'millimeters',
    'cm': 'centimeters', 'centimetro': 'centimeters', 'centimetros': 'centimeters', 'centimeters': 'centimeters',
    'm': 'meters', 'metro': 'meters', 'metros': 'meters', 'meters': 'meters',
    'mes': 'months', 'meses': 'months', 'month': 'months', 'months': 'months',
}
UNSAFE = re.compile(r'\b(nominal|diseno|borrador|propuest[oa]|pendiente|no verificad[oa]|por confirmar|certificad[oa]|conformidad|ensayo|fsc)\b')
GENERIC = {'value', 'valor', 'unit', 'unidad', 'unidad de medida', 'dimensiones de embalaje', 'unidad de medida de la edad'}


def normalized(value):
    text = unicodedata.normalize('NFKD', str(value)).casefold()
    text = ''.join(char for char in text if not unicodedata.combining(char))
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', text).split())


def named_unit(name):
    """Solo una unidad explícita al final del nombre, nunca la infiere del número."""
    match = re.search(r'\(([^()]+)\)\s*$', name)
    unit = UNITS.get(normalized(match.group(1))) if match else None
    return (name[:match.start()].strip(), unit) if unit else (name, None)


def quantity(value, name):
    label, label_unit = named_unit(name)
    match = re.fullmatch(r'\s*([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)?\s*', value)
    if not match:
        return None
    unit = UNITS.get(normalized(match.group(2))) if match.group(2) else label_unit
    if match.group(2) and (not unit or label_unit and unit != label_unit):
        return None
    try:
        number = Decimal(match.group(1).replace(',', '.'))
        return number, unit
    except InvalidOperation:
        return None


def choice(value, spec):
    matches = [(label, actual) for label, actual in spec.get('choices', {}).items()
               if normalized(value) in (normalized(label), normalized(actual))]
    unique = {(str(type(actual)), str(actual)) for _, actual in matches}
    if len(unique) == 1:
        return matches[0]
    return None


def ean_valid(value):
    return bool(re.fullmatch(r'\d{13}', value)) and sum(int(n) * (1 if i % 2 == 0 else 3) for i, n in enumerate(value)) % 10 == 0


def represented_quantity(pair, siblings, plan):
    """Convert an explicit length to a permitted unit, keeping a stored unit intact."""
    from .incident_fields import get_at
    if not pair or not pair[1] or not siblings:
        return pair
    number, unit = pair
    factors = {'millimeters': Decimal('0.001'), 'centimeters': Decimal('0.01'), 'meters': Decimal('1')}
    stored = [get_at(plan['candidate'], sibling['path']) for sibling in siblings]
    existing = {value for value in stored if value is not None}
    if len(existing) > 1:
        return None
    options = list(existing) if existing else [unit, 'centimeters', 'millimeters', 'meters']
    for target in options:
        if not all(choice(target, sibling) for sibling in siblings):
            continue
        if target == unit:
            return number, unit
        if target in factors and unit in factors:
            return number * factors[unit] / factors[target], target
    return None


def proposed_value(item, field, spec, plan, attribute):
    raw = str(item['value']).strip()
    path = spec['path']
    if attribute == 'externally_assigned_product_identifier':
        if not ean_valid(raw):
            return None
        raw = 'ean' if path[-1] == 'type' else raw
    pair = quantity(raw, str(item.get('name', '')))
    siblings = [s for s in plan['specs'].values() if s['path'][:-1] == path[:-1] and s['path'][-1] == 'unit']
    pair = represented_quantity(pair, siblings, plan)
    if path[-1] == 'unit':
        if not pair or not pair[1]:
            return None
        raw = pair[1]
    elif spec['type'] in ('number', 'integer'):
        if not pair:
            return None
        number, unit = pair
        if attribute == 'manufacturer_minimum_age':
            # Amazon suele pedir MESES sin un campo de unidad. No interpretar «3» como meses o años.
            target = normalized(spec['schema'].get('title', '') + ' ' + field['label'])
            if unit not in ('months', 'years') or not ('meses' in target or 'months' in target):
                return None
            number *= 12 if unit == 'years' else 1
        elif siblings:
            if not unit or not all(choice(unit, sibling) for sibling in siblings):
                return None
        elif unit:
            # Una magnitud sin unidad representable no debe perder su unidad al sugerir.
            return None
        if spec['type'] == 'integer' and (number != number.to_integral_value() or abs(number) > Decimal('9007199254740991')):
            return None
        value = int(number) if spec['type'] == 'integer' else float(number)
        if not math.isfinite(value) or Decimal(str(value)) != number:
            return None
        return str(value), value
    selected = choice(raw, spec)
    if selected:
        return selected
    if field.get('closed') or spec['type'] != 'string':
        return None
    return raw, raw


def add_suggestions(plan, product, schema):
    """Añade únicamente sugerencias inequívocas a controles vacíos; no altera ficha ni candidate."""
    candidates = [item for item in product.get('customFields', []) if isinstance(item, dict)
                  and item.get('isConfirmed') is True and isinstance(item.get('value'), (str, int, float))
                  and not isinstance(item.get('value'), bool)
                  and (str(item.get('source', '')).startswith('Drive') or item.get('id') == 'preparation_material')]
    for field in plan['fields']:
        if 'value' in field:
            continue
        spec = plan['specs'][field['id']]
        path, attribute = spec['path'], spec['path'][0]
        # No decidir cómo repartir un dato en estructuras o variantes compuestas.
        if len(path) not in (1, 3) or any(isinstance(part, int) and part != 0 for part in path):
            continue
        if len(path) == 3 and path[-1] not in ('value', 'unit', 'type'):
            continue
        if path[-1] == 'type' and attribute != 'externally_assigned_product_identifier':
            continue
        if re.search(r'(dimension|length|width|height|certification|compliance|safety|warning)', attribute):
            continue
        title = schema.get('properties', {}).get(attribute, {}).get('title', '')
        names = {normalized(attribute), normalized(title), normalized(field['label']),
                 normalized(spec['schema'].get('title', '')), *ALIASES.get(attribute, set())} - GENERIC - {''}
        if path[-1] == 'unit':
            # El nombre describe la magnitud, mientras que value contiene número y unidad explícitos.
            for sibling in plan['specs'].values():
                if sibling['path'][:-1] == path[:-1] and sibling['path'][-1] == 'value':
                    names.add(normalized(sibling['schema'].get('title', '')))
        matches = []
        for item in candidates:
            name = str(item.get('name', ''))
            base_name, _ = named_unit(name)
            if normalized(base_name) not in names and not (attribute == 'material' and item.get('id') == 'preparation_material'):
                continue
            # Un matiz documental no se elimina aunque el usuario haya confirmado su transcripción.
            if UNSAFE.search(normalized(name + ' ' + str(item['value']))):
                matches.append(None)
                continue
            proposed = proposed_value(item, field, spec, plan, attribute)
            if proposed is None or not validator_for({**spec['schema'], '$defs': schema.get('$defs', {})}).is_valid(proposed[1]):
                matches.append(None)
            else:
                matches.append((proposed[0], 'Material confirmado en la ficha técnica' if item.get('id') == 'preparation_material'
                                else 'Dato confirmado de Drive · ' + name[:100]))
        # Dos fuentes en desacuerdo no se reducen a la primera ni a la única que cumple enum.
        if matches and None not in matches and len({item[0] for item in matches}) == 1:
            field['suggestion'] = {'value': matches[0][0], 'source': matches[0][1]}
