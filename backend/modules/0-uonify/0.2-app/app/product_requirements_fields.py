"""Preguntas PTD para borradores; JSON Schema completo es la autoridad de validación."""
from copy import deepcopy
import hashlib
import json
from .incident_fields import clean, dereference, get_at, put_at, apply_answers
from .incident_schema_validation import validator_for, validation_errors, error_detail
from .product_requirements_mapping import LANGUAGES, scope_attributes, merge_scope
from .products import fail
from .product_requirements_copy import (title_for, question_for, option_pairs, hint_for,
                                       error_message, answer_error, number_error)


def merge(a, b):
    result = {**a, **b}
    for key in ('properties', '$defs'):
        if key in a or key in b:
            result[key] = {**a.get(key, {}), **b.get(key, {})}
            for name in a.get(key, {}).keys() & b.get(key, {}).keys():
                result[key][name] = merge(a[key][name], b[key][name])
    if isinstance(a.get('items'), dict) and isinstance(b.get('items'), dict):
        result['items'] = merge(a['items'], b['items'])
    result['required'] = list(dict.fromkeys(a.get('required', []) + b.get('required', [])))
    for key in ('minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minUniqueItems', 'minUtf8ByteLength'):
        if key in a and key in b: result[key] = max(a[key], b[key])
    for key in ('maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxUniqueItems', 'maxUtf8ByteLength'):
        if key in a and key in b: result[key] = min(a[key], b[key])
    if 'enum' in a and 'enum' in b:
        result['enum'] = [value for value in a['enum'] if value in b['enum']]
        result.pop('enumNames', None)
    return result


def controls(raw, root, value):
    node = dereference(raw, root)
    result = dict(node)
    for branch in node.get('allOf', []):
        result = merge(result, controls(branch, root, value))
    if 'if' in node:
        condition = {**node['if'], '$defs': root.get('$defs', {})}
        branch = node.get('then' if validator_for(condition).is_valid(value) else 'else', {})
        result = merge(result, controls(branch, root, value))
    alternatives = node.get('anyOf') or node.get('oneOf')
    if alternatives:
        choices = [controls(item, root, value) for item in alternatives]
        free = next((item for item in choices if item.get('type') == 'string' and 'enum' not in item), None)
        enum_choices = [item for item in choices if 'enum' in item]
        if free:
            # Solo enum sugeridos; nunca examples ni marcas del producto de referencia.
            if enum_choices:
                result['suggestions'] = enum_choices[0]['enum']
                result['suggestionNames'] = enum_choices[0].get('enumNames', enum_choices[0]['enum'])
        elif enum_choices and len(enum_choices) == len(choices):
            options = list(dict.fromkeys(v for item in enum_choices for v in item['enum']))
            result = merge(result, {'enum': options})
        elif len(choices) == 1:
            result = merge(result, choices[0])
        elif result.get('type') not in ('string', 'integer', 'number', 'boolean'):
            valid = [item for item in choices if validator_for({**item, '$defs': root.get('$defs', {})}).is_valid(value)]
            if len(valid) == 1:
                result = merge(result, valid[0])
            else:
                result['_ambiguous'] = True
    return result


def flatten_errors(errors):
    for error in errors:
        yield error
        yield from flatten_errors(error.context)


def identifier(path):
    return 'p_' + hashlib.sha256(json.dumps(path, ensure_ascii=False).encode()).hexdigest()[:20]


def missing_at(data, path):
    """Missing differs from an explicitly stored null or a malformed ancestor."""
    for key in path:
        if isinstance(data, dict):
            if key not in data: return True
            data = data[key]
        elif isinstance(data, list) and isinstance(key, int):
            if key >= len(data): return True
            data = data[key]
        else:
            return False
    return False


def closed_schema_choices(raw, schema, depth=0):
    """Finite choices from unconditional bounds; a missing value cannot choose an if branch."""
    if not isinstance(raw, dict) or depth > 16: return None
    raw = dereference(raw, schema)
    bounds = []
    if isinstance(raw.get('enum'), list):
        bounds.append({json.dumps(value, sort_keys=True): value for value in raw['enum']})
    for branch in raw.get('allOf', []):
        choices = closed_schema_choices(branch, schema, depth + 1)
        if choices is not None: bounds.append(choices)
    for kind in ('anyOf', 'oneOf'):
        branches = raw.get(kind)
        if branches:
            choices = [closed_schema_choices(branch, schema, depth + 1) for branch in branches]
            if all(choice is not None for choice in choices):
                bounds.append({key: value for choice in choices for key, value in choice.items()})
    if not bounds: return None
    return {key: value for key, value in bounds[0].items() if all(key in bound for bound in bounds[1:])}


def fixed_schema_choice(raw, schema, node, path=()):
    choices = closed_schema_choices(raw, schema)
    options = list(choices.values()) if choices is not None else None
    dimension_unit = (len(path) == 4 and path[0] in ('item_dimensions', 'item_package_dimensions', 'item_length_width')
                      and path[-1] == 'unit' and path[2] in ('length', 'width', 'height', 'depth'))
    fixed = (node.get('type') in ('string', 'integer', 'number', 'boolean')
             and (dimension_unit or node.get('hidden') is True or node.get('editable') is False or node.get('readOnly') is True)
             and isinstance(options, list) and len(options) == 1)
    if fixed and validator_for({**raw, '$defs': schema.get('$defs', {}),
                                'definitions': schema.get('definitions', {})}).is_valid(options[0]):
        return True, deepcopy(options[0])
    return False, None


def evaluate(schema, attributes, marketplace, attribute=None, *, human=True):
    """Devuelve primer lote de un atributo y evaluación completa, sin dar validez remota."""
    attributes = scope_attributes(attributes, marketplace)
    errors = validation_errors(schema, attributes)
    root = controls(schema, schema, attributes)
    properties = root.get('properties', {})
    required = set(root.get('required', []))
    missing, invalid = set(), set()
    for error in flatten_errors(errors):
        path = list(error.absolute_path)
        if error.validator == 'required':
            if not path:
                absent = [key for key in error.validator_value if key not in error.instance]
                required.update(absent); missing.update(absent)
            else:
                missing.add(path[0])
        elif path:
            invalid.add(path[0])
    pending = missing | invalid
    if attribute is not None and attribute not in properties:
        fail('invalid_amazon_attribute', 'Este atributo no pertenece a los requisitos actuales de Amazon.')
    names = [attribute] if attribute else sorted(pending, key=lambda name: (name not in ('externally_assigned_product_identifier', 'item_name', 'brand'), name))
    candidate = deepcopy(attributes)
    fields, specs, blocked = [], {}, []
    selected = []

    def walk(raw, path, needed, parent='', depth=0):
        if depth > 16:
            raise ValueError('Demasiados niveles de estructura.')
        value = get_at(candidate, path)
        if isinstance(value, dict) and value.get('marketplace_id') not in (None, marketplace):
            return
        if isinstance(value, dict) and value.get('language_tag') not in (None, LANGUAGES[marketplace]):
            return
        node = controls(raw, schema, value)
        kind = node.get('type')
        if path[-1] == 'marketplace_id':
            if value is None: put_at(candidate, path, marketplace)
            return
        if path[-1] == 'language_tag':
            if value is None: put_at(candidate, path, LANGUAGES[marketplace])
            return
        if 'const' in node:
            if value is None: put_at(candidate, path, node['const'])
            return
        if human and needed and value is None and missing_at(attributes, path):
            fixed, fixed_value = fixed_schema_choice(raw, schema, node, path)
            if fixed:
                # This is a schema requirement, not a customer choice. Internal
                # reasoning retains its historical context and paid-call cache.
                put_at(candidate, path, fixed_value)
                return
        title = (title_for(path[-1], node.get('title')) if human else clean(node.get('title', path[-1]))) if not isinstance(path[-1], int) else parent
        if node.get('_ambiguous'):
            raise ValueError('Amazon admite varias estructuras; revisa esta alternativa antes de continuar.')
        if kind == 'array':
            if not isinstance(node.get('items'), dict): raise ValueError('Lista no representable.')
            count = max(len(value) if isinstance(value, list) else 0, node.get('minItems', 1), 1)
            if count > 100: raise ValueError('Esta lista requiere revisión por lotes.')
            for index in range(count):
                walk(node['items'], path + [index], needed, title if count == 1 else f'{title} {index + 1}', depth + 1)
            return
        if kind == 'object' or node.get('properties'):
            needed_keys = set(node.get('required', []))
            for key, prop in node.get('properties', {}).items():
                existing = isinstance(value, dict) and key in value
                if key in needed_keys or existing or key in ('marketplace_id', 'language_tag'):
                    walk(prop, path + [key], key in needed_keys, parent or title, depth + 1)
            return
        if kind not in ('string', 'integer', 'number', 'boolean'):
            raise ValueError('Estructura de atributo no representable.')
        if value is not None and not attribute and validator_for({**raw, '$defs': schema.get('$defs', {})}).is_valid(value):
            return
        if isinstance(value, str) and len(value) > 3000:
            raise ValueError('Contenido mayor de 3000 caracteres; se conserva completo para revisión.')
        key = identifier(path)
        label = question_for(path, node, parent) if human else clean(node.get('title', path[-1]))
        field = {'id': key, 'label': label, 'type': 'text', 'required': needed}
        spec = {'path': path, 'type': kind, 'schema': raw}
        options = node.get('enum', node.get('suggestions'))
        if kind == 'boolean': options = [value for value in (True, False) if options is None or value in options]
        if options and 'enum' not in node and kind != 'boolean':
            options = [option for option in options if validator_for({**raw, '$defs': schema.get('$defs', {})}).is_valid(option)] or None
        if options is not None:
            if not options or len(options) > 1000: raise ValueError('Este selector necesita revisión especializada.')
            labels = [('Sí' if value else 'No') for value in options] if kind == 'boolean' else node.get('enumNames', node.get('suggestionNames', options))
            if len(labels) != len(options): labels = options
            pairs = [(option, label_) for option, label_ in zip(options, labels)
                     if validator_for({**raw, '$defs': schema.get('$defs', {})}).is_valid(option)]
            if not pairs: raise ValueError('Ninguna de las opciones disponibles satisface las restricciones actuales; revisa el requisito.')
            options, labels = map(list, zip(*pairs))
            if human:
                options, labels = map(list, zip(*option_pairs(options, labels, value, path)))
            else:
                labels = [str(label_) for label_ in labels]
                labels = [f'{label_} ({option})' if labels.count(label_) > 1 else label_
                          for option, label_ in zip(options, labels)]
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
        field['hint'] = hint_for(node, kind, field, value if value is not None and not validator_for({**raw, '$defs': schema.get('$defs', {})}).is_valid(value) else None)
        fields.append(field); specs[key] = spec

    for name in names:
        if name not in properties:
            blocked.append({'path': name, 'rule': 'unavailable', 'message': 'El atributo no existe en este esquema.'}); continue
        before = len(fields)
        try:
            walk(properties[name], [name], name in required)
        except (ValueError, KeyError, TypeError) as error:
            blocked.append({'path': name, 'rule': 'manual_review', 'message': clean(str(error), 200)})
        if len(fields) > before and not selected:
            selected = fields[before:before + 8]
    if human:
        unit_names = {'centimeters': 'centímetros', 'millimeters': 'milímetros', 'meters': 'metros'}
        for field in selected:
            path = specs[field['id']]['path']
            if len(path) == 4 and path[-1] == 'value':
                unit = unit_names.get(get_at(candidate, path[:-1] + ['unit']))
                if unit: field['hint'] = f'Indica la medida en {unit}. ' + field.get('hint', '')
            if specs[field['id']]['type'] in ('number', 'integer') and separate_unit(candidate, specs, specs[field['id']]):
                field['hint'] += ' La unidad se elige aparte.'
    issues = [{**error_detail(error), 'message': error_message(error)} for error in errors[:40]] + blocked
    for issue in issues:
        name = issue['path'].split(' / ')[0]
        try: issue['label'] = title_for(name, properties.get(name, {}).get('title'))
        except ValueError: issue['label'] = 'Dato de Amazon pendiente de revisar'
        issue.pop('accepted', None)
    def catalogue_label(name, node):
        try: return title_for(name, node.get('title'))
        except ValueError: return 'Dato de Amazon pendiente de revisar'
    catalogue = [{'id': name, 'label': catalogue_label(name, node), 'required': name in required,
                  'present': name in attributes, 'valid': name in attributes and name not in pending}
                 for name, node in properties.items()]
    return {'candidate': candidate, 'fields': selected, 'specs': {f['id']: specs[f['id']] for f in selected},
            'issues': issues, 'counts': {'missing': len(missing), 'invalid': len(invalid), 'questions': len(fields)},
            'needsReview': bool(errors) and not fields or bool(blocked), 'valid': not errors,
            'attributes': catalogue}


def separate_unit(candidate, specs, spec):
    parent = get_at(candidate, spec['path'][:-1])
    return bool(isinstance(parent, dict) and 'unit' in parent or any(
        sibling['path'] == spec['path'][:-1] + ['unit'] for sibling in specs.values()))


def apply(schema, attributes, marketplace, answers, attribute=None):
    plan = evaluate(schema, attributes, marketplace, attribute)
    if not answers or set(answers) - set(plan['specs']):
        fail('invalid_requirement_answers', 'Responde a los campos actuales antes de guardar.', 422)
    fields = [field for field in plan['fields'] if field['id'] in answers]
    def numeric_message(field, spec, reason):
        return number_error(field, spec, reason, separate_unit(plan['candidate'], plan['specs'], spec))
    candidate = apply_answers(plan['candidate'], plan['specs'], fields, answers, number_error=numeric_message)
    touched = set()
    for field in fields:
        spec = plan['specs'][field['id']]
        value = get_at(candidate, spec['path'])
        errors = validation_errors({**spec['schema'], '$defs': schema.get('$defs', {})}, value)
        if errors:
            fail('invalid_requirement_answers', f'«{field["label"]}»: ' + answer_error(errors), 422)
        touched.add(spec['path'][0])
    result = merge_scope(attributes, {name: candidate[name] for name in touched}, marketplace)
    # Una respuesta puede activar restricciones sobre otra respuesta del mismo lote.
    # Se valida de nuevo contra el esquema completo; solo faltantes quedan pendientes.
    answered_paths = [plan['specs'][field['id']]['path'] for field in fields]
    for error in flatten_errors(validation_errors(schema, scope_attributes(result, marketplace))):
        path = list(error.absolute_path)
        if error.validator == 'required' or error.context:
            continue
        if any(path == given or path and given[:len(path)] == path for given in answered_paths):
            field = next(field for field in fields if path == plan['specs'][field['id']]['path'] or
                         path and plan['specs'][field['id']]['path'][:len(path)] == path)
            fail('invalid_requirement_answers', f'«{field["label"]}»: ' + error_message(error), 422)
    return result, touched
