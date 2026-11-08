"""Required single-choice PTD values: schema evidence, never model or human claims."""
from copy import deepcopy
import json
from .incident_fields import get_at
from .product_requirements_fields import controls, evaluate, fixed_schema_choice, missing_at


def schema_fixed_candidates(context):
    schema = context['validationSchema']
    attributes = context['protected']['amazonAttributes']
    marketplace = context['marketplaceId']
    plans, result = {}, []
    for target in context.get('targets', []):
        path = target['path']
        if get_at(attributes, path) is not None or not missing_at(attributes, path):
            continue
        attribute = path[0]
        if attribute not in plans:
            plan = evaluate(schema, attributes, marketplace, attribute, human=False)
            plans[attribute] = {field['id']: field for field in plan['fields']}
        if not plans[attribute].get(target['id'], {}).get('required'):
            continue
        raw = target['schema']
        fixed, value = fixed_schema_choice(raw, schema, controls(raw, schema, None), path)
        if not fixed:
            continue
        result.append({'targetId': target['id'], 'path': deepcopy(path), 'value': value,
            'origin': 'schema_fixed', 'humanConfirmed': False,
            'evidence': [{'id': 's_' + target['id'], 'sourceId': 'schema', 'sourceVersion': context['schemaHash'],
                          'schemaHash': context['schemaHash'], 'locator': json.dumps(path),
                          'kind': 'schema', 'text': 'Valor único obligatorio definido por el esquema de Amazon.'}],
            'rationale': 'Amazon exige este único valor; el campo no admite una elección del cliente.',
            'basis': 'schema_fixed', 'contextFingerprint': context['fingerprint']})
    return result
