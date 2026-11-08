"""Controles conversacionales derivados del PTD, nunca del texto libre del modelo."""
from copy import deepcopy
import math
from decimal import Decimal, InvalidOperation, DecimalException
import re
from .products import fail
from .incident_schema_validation import validator_for, validation_errors


def clean(value, limit=100):
    return re.sub(r'[<>\x00-\x1f]', '', str(value)).strip()[:limit]


def dereference(node, root):
    seen = set()
    while isinstance(node, dict) and '$ref' in node:
        ref = node['$ref']
        if not ref.startswith('#/') or ref in seen:
            fail('unsupported_amazon_schema', 'Este atributo necesita una revisión de su estructura antes de editarlo.', 409)
        seen.add(ref)
        target = root
        for part in ref[2:].split('/'):
            target = target[part.replace('~1', '/').replace('~0', '~')]
        node = {**target, **{key: value for key, value in node.items() if key != '$ref'}}
    return node


def merge_schema(a, b):
    result = {**a, **b}
    result['properties'] = {**a.get('properties', {}), **b.get('properties', {})}
    for name in a.get('properties', {}).keys() & b.get('properties', {}).keys():
        result['properties'][name] = merge_schema(a['properties'][name], b['properties'][name])
    result['required'] = list(dict.fromkeys(a.get('required', []) + b.get('required', [])))
    return result


def effective(node, root, value):
    node = dereference(node, root)
    result = dict(node)
    for branch in node.get('allOf', []):
        result = merge_schema(result, effective(branch, root, value))
    if 'if' in node:
        condition = {**node['if'], '$defs': root.get('$defs', {})}
        branch = node.get('then' if validator_for(condition).is_valid(value) else 'else', {})
        result = merge_schema(result, effective(branch, root, value))
    alternatives = node.get('anyOf') or node.get('oneOf')
    if alternatives:
        choices = [effective(item, root, value) for item in alternatives]
        # Prefer a free string alternative when Amazon explicitly allows it.
        free = next((item for item in choices if item.get('type') == 'string' and 'enum' not in item), None)
        selected = free or next((item for item in choices if validator_for({**item, '$defs': root.get('$defs', {})}).is_valid(value)), choices[0])
        result = merge_schema(result, selected)
        suggestions = next((item for item in choices if item.get('enum')), None)
        if free and suggestions:
            result['suggestions'] = suggestions['enum']
            result['suggestionNames'] = suggestions.get('enumNames', suggestions['enum'])
            result.pop('enum', None)
    return result


def get_at(data, path):
    current = data
    for key in path:
        if isinstance(current, dict): current = current.get(key)
        elif isinstance(current, list) and isinstance(key, int) and key < len(current): current = current[key]
        else: return None
    return current


def put_at(data, path, value):
    current = data
    for index, key in enumerate(path[:-1]):
        following = path[index + 1]
        if isinstance(current, list):
            while len(current) <= key: current.append({} if not isinstance(following, int) else [])
            if current[key] is None: current[key] = [] if isinstance(following, int) else {}
        elif key not in current or current[key] is None:
            current[key] = [] if isinstance(following, int) else {}
        current = current[key]
    key = path[-1]
    if isinstance(current, list):
        while len(current) <= key: current.append(None)
    current[key] = value


def plan_fields(schema, attributes, names, marketplace):
    candidate = deepcopy(attributes)
    root_effective = effective(schema, schema, candidate)
    fields, specs = [], {}
    expanded = set(names)
    for error in validation_errors(schema, candidate):
        if error.validator == 'required':
            if not error.absolute_path:
                expanded.update(key for key in error.validator_value if key not in error.instance)
            elif error.absolute_path:
                expanded.add(next(iter(error.absolute_path)))

    def walk(raw, path, required, parent_label='', depth=0):
        if depth > 12 or len(fields) > 160:
            fail('incident_needs_review', 'Este atributo tiene demasiados niveles para un formulario seguro. Uony conserva la incidencia para su revisión.', 409)
        value = get_at(candidate, path)
        if isinstance(value, dict) and value.get('marketplace_id') not in (None, marketplace):
            return  # Un atributo puede contener otros mercados; se conservan exactamente.
        node = effective(raw, schema, value)
        kind = node.get('type')
        label = clean(node.get('title') or path[-1])
        if 'const' in node:
            if value is None: put_at(candidate, path, node['const'])
            return
        if path[-1] == 'marketplace_id':
            put_at(candidate, path, marketplace)
            return
        if kind == 'array':
            if not isinstance(node.get('items'), dict):
                fail('incident_needs_review', 'Amazon pide una estructura de lista que necesita revisión antes de corregirla.', 409)
            count = max(len(value) if isinstance(value, list) else 0, node.get('minItems', 1), 1)
            if count > 30: fail('incident_needs_review', 'Esta lista necesita una revisión por lotes antes de enviar cambios.', 409)
            for index in range(count): walk(node['items'], path + [index], required, label if count == 1 else f'{label} {index + 1}', depth + 1)
            return
        if kind == 'object' or node.get('properties'):
            required_keys = set(node.get('required', []))
            for key, prop in node.get('properties', {}).items():
                existing = isinstance(value, dict) and key in value
                if key in required_keys or existing or prop.get('enum') or key in ('value', 'unit', 'language_tag', 'marketplace_id'):
                    walk(prop, path + [key], key in required_keys, parent_label or label, depth + 1)
            return
        if kind not in ('string', 'integer', 'number', 'boolean'):
            fail('incident_needs_review', 'No podemos representar este atributo con seguridad; se necesita revisar el requisito de Amazon.', 409)
        if node.get('editable') is False:
            if value is None: fail('incident_support_required', f'Amazon no permite editar directamente «{label}». Se necesita revisar el catálogo o contactar con soporte.', 409)
            return
        identifier = f'field{len(fields)}'
        if isinstance(value, str) and len(value) > 3000:
            fail('incident_needs_review', 'El contenido de este atributo supera el tamaño del formulario. Se conserva completo y necesita una revisión especializada.', 409)
        label = clean(f'{parent_label} · {label}' if parent_label and label != parent_label else label)
        field = {'id': identifier, 'label': label, 'type': 'text', 'required': required}
        spec = {'path': path, 'type': kind, 'schema': raw}
        options = node.get('enum', node.get('suggestions'))
        if kind == 'boolean': options = [True, False]
        if options:
            names_ = ['Sí', 'No'] if kind == 'boolean' else node.get('enumNames', node.get('suggestionNames', options))
            if len(options) > 500: fail('incident_needs_review', 'Este campo necesita un selector especializado por su número de opciones.', 409)
            if len(names_) != len(options): names_ = options
            labels = [clean(name, 160) or str(option) for name, option in zip(names_, options)]
            if len(set(labels)) != len(labels): labels = [clean(option, 160) for option in options]
            if any(not label for label in labels) or len(set(labels)) != len(labels):
                fail('incident_needs_review', 'Las opciones de este atributo necesitan una revisión para mostrarlas sin ambigüedad.', 409)
            field.update(type='select', options=labels, closed='enum' in node or kind == 'boolean')
            spec['choices'] = dict(zip(labels, options))
            if value in options: field['value'] = labels[options.index(value)]
            elif value is not None and not field['closed']: field['value'] = str(value)
        elif value is not None:
            field['value'] = str(value)
        if field['type'] == 'text' and kind == 'string' and (node.get('maxLength', 0) > 200 or len(str(value or '')) > 120):
            field['type'] = 'textarea'
        limits = {key: node[key] for key in ('minimum', 'maximum', 'minLength', 'maxLength', 'pattern') if key in node}
        if kind in ('number', 'integer'): limits['number'] = kind
        if limits: field['validation'] = limits
        hints = []
        if value is not None: hints.append('Valor actual de tu catálogo; revísalo antes de confirmar.')
        if value is not None and field.get('closed') and 'value' not in field:
            hints[0] = f'Valor actual: {clean(value, 160)}. No coincide con una opción admitida; elige su sustitución.'
        if kind in ('number', 'integer'): hints.append('Introduce solo el número' + (' entero.' if kind == 'integer' else '; la unidad se elige por separado.'))
        if field.get('closed'): hints.append('Solo se admiten las opciones de Amazon.')
        if options and not field.get('closed'): hints.append('Amazon también admite una respuesta propia.')
        for key, description in [('minimum', 'Mínimo'), ('maximum', 'Máximo'), ('maxLength', 'Máximo de caracteres')]:
            if key in node: hints.append(f'{description}: {node[key]}.')
        if node.get('format'): hints.append(f'Formato admitido por Amazon: {clean(node["format"], 120)}.')
        if node.get('pattern'): hints.append(f'Patrón requerido por Amazon: {clean(node["pattern"], 220)}.')
        if hints: field['hint'] = ' '.join(hints)[:600]
        fields.append(field); specs[identifier] = spec

    for name in sorted(expanded):
        if name not in root_effective.get('properties', {}):
            fail('incident_support_required', 'El campo señalado no está disponible en los requisitos actuales. Se necesita revisar el tipo de producto o soporte de Amazon.', 409)
        walk(root_effective['properties'][name], [name], True)
    return candidate, fields, specs, sorted(expanded)


def apply_answers(candidate, specs, fields, answers, *, number_error=None):
    if set(answers) - {field['id'] for field in fields}:
        fail('invalid_incident_answers', 'Responde únicamente a los campos de este formulario.')
    candidate = deepcopy(candidate)
    for field in fields:
        text = answers.get(field['id'], '').strip()
        if not text:
            if field['required']: fail('invalid_incident_answers', f'Completa «{field["label"]}».')
            continue
        if len(text) > 3000: fail('invalid_incident_answers', 'La respuesta es demasiado larga.')
        spec = specs[field['id']]
        if text in spec.get('choices', {}): value = spec['choices'][text]
        elif field.get('closed'): fail('invalid_incident_answers', f'Elige una opción admitida en «{field["label"]}».')
        elif spec['type'] in ('number', 'integer'):
            reason = 'format'
            try:
                numeric = text.replace(',', '.')
                if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', numeric): raise ValueError()
                number = Decimal(numeric)
                if not number.is_finite(): raise ValueError()
                reason = 'integer'
                if spec['type'] == 'integer' and number != number.to_integral_value(): raise ValueError()
                reason = 'precision'
                if spec['type'] == 'integer' and number.copy_abs() > Decimal('9007199254740991'): raise ValueError()
                value = int(number) if spec['type'] == 'integer' else float(number)
                if spec['type'] != 'integer' and (not math.isfinite(value) or Decimal(str(value)) != number): raise ValueError()
            except (ValueError, DecimalException, OverflowError):
                message = (number_error(field, spec, reason) if number_error else
                           f'Introduce un número válido en «{field["label"]}», sin perder precisión.')
                fail('invalid_incident_answers', message)
        else: value = text
        put_at(candidate, spec['path'], value)
    return candidate


def display_value(value):
    if isinstance(value, list): return '; '.join(display_value(item) for item in value)
    if isinstance(value, dict):
        labels = {'value': 'Valor', 'unit': 'Unidad', 'language_tag': 'Idioma'}
        return ', '.join(f'{labels.get(key, key)}: {display_value(item)}' for key, item in value.items() if key != 'marketplace_id')
    if isinstance(value, bool): return 'Sí' if value else 'No'
    return str(value) if value is not None else 'Sin dato'


def review_rows(before, replacements, schema):
    if any(len(display_value(value)) > 6000 or len(display_value(before.get(name))) > 6000 for name, value in replacements.items()):
        fail('incident_needs_review', 'Esta corrección necesita una revisión ampliada para mostrar todos los valores antes del envío.', 409)
    return [{'label': clean(schema.get('properties', {}).get(name, {}).get('title', name)),
             'before': display_value(before.get(name)), 'after': display_value(value)}
            for name, value in replacements.items()]
