"""Datos documentales al JSON Amazon: sin revisar atributos ajenos ni simular confirmaciones."""
from copy import deepcopy
import json
import re
from .incident_fields import get_at, put_at
from .incident_schema_validation import validation_errors, validator_for
from .product_materials_fields import canonical_attribute, canonical_label
from .product_materials_values import normalize_value
from .product_requirements_fields import evaluate, flatten_errors, fixed_schema_choice, controls
from .product_requirements_mapping import MAPPING, merge_scope, scope_attributes
from .product_requirements_suggestions import (ALIASES, GENERIC, named_unit,
                                               normalized, proposed_value, choice)
from .product_materials_dimensions import matches_dimension

# Equivalencias de significado, no valores particulares del producto piloto.
CANONICAL = {
    'externally_assigned_product_identifier': 'custom:ean_gtin_13',
    'manufacturer_minimum_age': 'custom:edad_minima',
    'country_of_origin': 'custom:pais_fabricacion', 'material': 'custom:material',
    'manufacturer': 'custom:fabricante', 'model_name': 'custom:modelo', 'model_number': 'custom:modelo',
    'age_range_description': 'custom:edad_minima', 'language': 'custom:idioma_de_las_frases',
    'eu_toys_safety_directive_warning': 'custom:advertencia_seguridad',
    'eu_toys_safety_directive_age_warning': 'custom:advertencia_seguridad',
    'eu_toys_safety_directive_language': 'custom:idiomas_del_envase',
    'gpsr_manufacturer_reference': 'custom:fabricante_correo',
    'dsa_responsible_party_address': 'custom:responsable_ue_correo',
    'number_of_pieces': 'custom:numero_piezas', 'safety_warning': 'custom:advertencia_seguridad',
    'included_components': 'custom:contenido_representado', 'item_weight': 'custom:peso_producto',
    'item_package_weight': 'custom:peso_del_paquete',
    **{remote: local for local, remote in MAPPING.items()},
}
NOMINAL_CONTENT = {'custom:numero_piezas', 'custom:contenido_representado', 'custom:contenido_del_set',
                   'custom:idioma_de_las_frases', 'custom:idiomas_del_envase', 'custom:modelo', 'name', 'brand', 'description'}


def eligible_job(job):
    return bool(job and job.get('status') == 'ready' and job.get('facts', {}).get('version') == 1
                and not job['facts'].get('stale') and not job.get('resolution', {}).get('technicalPendingCount')
                and (job.get('error') or {}).get('code') not in ('permission_denied', 'reauthorize') and job.get('pauseReason') != 'source_changed'
                and job.get('operation') not in ('reconcile', 'repair_evidence', 'upgrade_readers')
                and job.get('reconciliation', {}).get('status') not in ('queued', 'running'))


_PRODUCT_SCOPE = '''j.user_id=%s AND j.google_subject=%s AND
    (j.product_id=%s OR EXISTS (SELECT 1 FROM uony_product_intakes AS i
        WHERE i.user_id=j.user_id AND i.id=j.intake_id
          AND i.google_subject=j.google_subject AND i.product_id=%s
          AND i.status='linked' AND i.folder_id=j.folder_id))'''


def belongs_to_product(c, user, product, job_id):
    """Only an explicit intake-to-product link may reuse pre-product evidence."""
    return bool(c.execute('''SELECT 1 FROM product_material_jobs AS j
        WHERE j.id=%s AND ''' + _PRODUCT_SCOPE,
        (job_id, user['id'], user['google_subject'],
         product['id'], product['id'])).fetchone())


def latest_job(c, user, product):
    row = c.execute('''SELECT j.id,j.status,j.result FROM product_material_jobs AS j
        WHERE ''' + _PRODUCT_SCOPE + '''
        ORDER BY j.created_at DESC,j.id DESC LIMIT 1''',
        (user['id'], user['google_subject'], product['id'], product['id'])).fetchone()
    return {**row['result'], 'id': str(row['id']), 'status': row['status']} if row else None


def candidates(product, job):
    """Las decisiones vigentes prevalecen; no convertir una observación visual en hecho."""
    result = []
    for field, remote in MAPPING.items():
        value = product.get(field)
        # Bullets se manejan por el mapeo de ficha, no se aplana una lista en una cadena.
        if isinstance(value, str) and value.strip():
            result.append({'field': field, 'name': canonical_label(field, field), 'value': value,
                           'origin': 'product', 'evidence': [], 'priority': 2})
    for item in product.get('customFields', []):
        if not isinstance(item, dict) or item.get('isConfirmed') is not True:
            continue
        if not isinstance(item.get('value'), (str, int, float)) or isinstance(item.get('value'), bool):
            continue
        label = str(item.get('name', ''))
        base = re.sub(r' · diseño nominal$', '', label)
        field = canonical_attribute('', named_unit(base)[0])
        if field in NOMINAL_CONTENT:
            label = base
        result.append({'field': field, 'name': label, 'value': str(item['value']),
                       'origin': 'confirmed_product', 'id': item.get('id'), 'evidence': [], 'priority': 2})
    if eligible_job(job):
        for item in job['facts'].get('proposals', []):
            if item.get('status') == 'rejected' or item.get('observationIssue') or item.get('supersededByRefresh'):
                continue
            field = item.get('confirmedField') or item.get('canonicalField') or canonical_attribute(item.get('field', ''), item.get('label', ''))
            confirmed = item.get('status') == 'confirmed'
            if item.get('historicalEvidence') and not confirmed:
                continue
            if item.get('scope') != 'product' or item.get('channel') not in ('product', 'safety'):
                continue
            if not confirmed and (item.get('supportStatus') != 'supported' or item.get('claimType') not in ('declared', 'nominal')
                                  or item.get('channel') not in ('product', 'safety') or item.get('scope') != 'product'
                                  or not item.get('evidence')):
                continue
            # Incluso confirmado, un diseño nominal no demuestra medidas físicas ni ensayos.
            if item.get('claimType') in ('certified_claim', 'visual_observation'):
                continue
            if item.get('claimType') == 'nominal' and field not in NOMINAL_CONTENT:
                continue
            result.append({'field': field, 'name': item.get('label', ''),
                'value': item.get('confirmedValue', item['value']) if confirmed else item['value'],
                'id': item['id'], 'analysisId': job['id'], 'evidence': deepcopy(item.get('evidence', [])),
                'origin': 'confirmed_material' if confirmed else 'documentary_inferred',
                'priority': 1 if confirmed else 0})
    return result


def matches_attribute(item, attribute, field, spec, schema, plan):
    if len(spec['path']) == 4:
        if matches_dimension(item, attribute, spec['path']):
            return True
        axis = spec['path'][2]
        aliases = {'length': {'largo', 'longitud'}, 'width': {'ancho', 'anchura'},
                   'height': {'alto', 'altura'}, 'depth': {'profundidad'}}.get(axis, set())
        scope = 'paquete' if attribute == 'item_package_dimensions' else 'producto'
        titles = {normalized(spec['schema'].get('title', ''))}
        for sibling in plan['specs'].values():
            if sibling['path'][:-1] == spec['path'][:-1] and sibling['path'][-1] == 'value':
                titles.add(normalized(sibling['schema'].get('title', '')))
        titles |= {f'{name} {scope}' for name in aliases} | {f'{name} del {scope}' for name in aliases}
        return normalized(named_unit(item['name'])[0]) in titles - {''}
    canonical = CANONICAL.get(attribute)
    if canonical and item['field'] == canonical:
        return True
    title = schema.get('properties', {}).get(attribute, {}).get('title', '')
    names = {normalized(attribute), normalized(title), normalized(field['label']),
             normalized(spec['schema'].get('title', '')), *ALIASES.get(attribute, set())} - GENERIC - {''}
    return normalized(named_unit(item['name'])[0]) in names


def suggested(item, field, spec, plan, attribute):
    item = dict(item)
    value = item['value']
    if item['field'] in CANONICAL.values():
        _, value, _ = normalize_value(item['field'], value)
    if attribute == 'age_range_description':
        number = re.fullmatch(r'(\d+) meses', value)
        if number:
            months = int(number[1])
            value = f'A partir de {months // 12} años' if months % 12 == 0 else f'A partir de {months} meses'
    if attribute == 'language':
        # El idioma impreso del propio juego no equivale a los idiomas del manual.
        languages = {'espanol': 'spanish', 'ingles': 'english', 'frances': 'french',
                     'aleman': 'german', 'italiano': 'italian', 'portugues': 'portuguese'}
        code = languages.get(normalized(value))
        if not code:
            return None
        value = 'original' if spec['path'][-1] == 'type' else code
    text = normalized(value)
    if attribute == 'eu_toys_safety_directive_warning':
        if 'piezas pequenas' in text and 'asfixia' in text and not re.search(r'\b(?:sin|no contiene|no incluye|no hay|no existe|no presenta) (?:piezas pequenas|riesgo|peligro)', text):
            value = 'choking_hazard_small_parts'
    if attribute == 'eu_toys_safety_directive_age_warning':
        if (re.search(r'\b0 3\b', text) or 'no apto para menores de 3' in text) and 'asfixia' in text:
            value = 'not_suitable_under_3_years'
    item['value'] = value
    # Normalizar edad conserva su unidad explícita; no interpretar números desnudos como meses.
    return proposed_value(item, field, spec, plan, attribute)


def compatible_existing(item, spec, plan, attribute, attributes):
    for key, sibling in plan['specs'].items():
        if sibling['path'][:-1] != spec['path'][:-1] or sibling['path'] == spec['path']:
            continue
        current = get_at(attributes, sibling['path'])
        if current is None:
            continue
        field = next(field for field in plan['fields'] if field['id'] == key)
        proposed = suggested(item, field, sibling, plan, attribute)
        if proposed is None or proposed[1] != current:
            return False
    return True


def uncertain(item):
    label, value = normalized(item['name']), normalized(item['value'])
    if 'diseno nominal' in label or 'medida nominal' in label:
        return True
    # Las reservas del documento importan; una palabra normal de un nombre (por
    # ejemplo «Mesa de diseño» o «Ensayo LLC») no es una reserva documental.
    if re.search(r'\b(?:pendiente de|por confirmar|por verificar|no verificad[oa]|no medid[oa])\b', value):
        return True
    if item['field'] not in {'name', 'brand', 'custom:modelo', 'custom:fabricante', 'custom:persona_responsable'}:
        return bool(re.search(r'\b(?:propuest[oa]|borrador|provisional)\s*$', value))
    return False


def languages_value(item, spec):
    # Idiomas de las advertencias impresas, no del manual ni del juego hablado.
    languages = {'ES': 'spanish', 'EN': 'english', 'FR': 'french', 'DE': 'german', 'IT': 'italian', 'PT': 'portuguese'}
    from .product_materials_values import language_set
    codes = language_set(str(item['value']))
    if not codes or any(code not in languages for code in codes):
        return None
    values = [choice(languages[code], spec) for code in codes]
    return [item[1] for item in values] if all(values) else None


def inference_plan(schema, attributes, market, attribute):
    if attribute == 'gpsr_manufacturer_reference':
        # El contenedor puede ser obligatorio sin marcar su email como required.
        # Explorar esa hoja conocida solo para inferencia no la convierte en pregunta.
        editable = deepcopy(schema)
        item = editable.get('properties', {}).get(attribute, {}).get('items', {})
        if 'gpsr_manufacturer_email_address' in item.get('properties', {}):
            item['required'] = list(dict.fromkeys(item.get('required', []) + ['gpsr_manufacturer_email_address']))
            return evaluate(editable, attributes, market, attribute, human=False)
    return evaluate(schema, attributes, market, attribute, human=False)


def infer_attributes(product, schema, market, job=None, *, schema_hash=None):
    """Solo rellena hojas ausentes que el esquema necesita. Reevaluación tras cada cambio.

    No sustituye valores existentes, aunque sean inválidos. Las fuentes en conflicto
    no se resuelven por mayoría ni escogiendo únicamente la alternativa que valide.
    """
    attrs = deepcopy(product.get('amazonAttributes', {}))
    evidence = deepcopy(product.get('amazonMaterialEvidence', {}))
    items = candidates(product, job)
    applied = set()
    for _ in range(max(1, len(schema.get('properties', {})) * 2)):
        plan = evaluate(schema, attrs, market, human=False)
        targets = [a['id'] for a in plan['attributes'] if not a['valid'] and
                   (a['required'] or a['present'])]
        changed = False
        for attribute in targets:
            current = inference_plan(schema, attrs, market, attribute)
            candidate = deepcopy(current['candidate'])
            provenance, paths = {}, []
            for field in current['fields']:
                spec = current['specs'][field['id']]
                path = spec['path']
                # No adivinar estructuras de variantes, dimensiones o entidades compuestas.
                if len(path) not in (1, 3, 4) or any(isinstance(p, int) and p != 0 for p in path):
                    continue
                if len(path) >= 3 and path[-1] not in ('value', 'unit', 'type', 'gpsr_manufacturer_email_address'):
                    continue
                if len(path) == 4 and (attribute not in ('item_dimensions', 'item_package_dimensions', 'item_length_width')
                    or path[2] not in ('length', 'width', 'height', 'depth')):
                    continue
                if get_at(scope_attributes(attrs, market), path) is not None:
                    continue
                relevant = [item for item in items if matches_attribute(item, attribute, field, spec, schema, current)]
                if not relevant:
                    fixed, fixed_value = fixed_schema_choice(spec['schema'], schema,
                        controls(spec['schema'], schema, None), path)
                    if fixed and len(path) == 4 and path[-1] == 'unit':
                        from .product_reasoning import digest
                        fingerprint = schema_hash or digest(schema)
                        put_at(candidate, path, fixed_value); paths.append(path)
                        provenance[json.dumps(path)] = {'origin': 'schema_fixed', 'humanConfirmed': False,
                            'active': True, 'value': fixed_value, 'sources': [{'sourceId': 'schema',
                            'sourceVersion': fingerprint, 'schemaHash': fingerprint, 'locator': json.dumps(path)}]}
                    continue
                priority = max(item['priority'] for item in relevant)
                relevant = [item for item in relevant if item['priority'] == priority]
                if attribute == 'eu_toys_safety_directive_language' and path[-1] == 'value':
                    lists = [languages_value(item, spec) for item in relevant]
                    if lists and None not in lists and len({json.dumps(v) for v in lists}) == 1:
                        template = deepcopy(candidate.get(attribute, [{}])[0])
                        candidate[attribute] = [{**template, 'value': value} for value in lists[0]]
                        for index, value in enumerate(lists[0]):
                            leaf = [attribute, index, 'value']; paths.append(leaf)
                            provenance[json.dumps(leaf)] = {'origin': 'documentary_inferred', 'humanConfirmed': False,
                                'active': True, 'value': value, 'sources': deepcopy(relevant)}
                    continue
                values = []
                for item in relevant:
                    if uncertain(item) or not compatible_existing(item, spec, current, attribute, scope_attributes(attrs, market)):
                        values.append(None); continue
                    value = suggested(item, field, spec, current, attribute)
                    values.append(value if value and validator_for({**spec['schema'], '$defs': schema.get('$defs', {})}).is_valid(value[1]) else None)
                if not values or None in values or len({json.dumps(v[1], sort_keys=True) for v in values}) != 1:
                    continue
                put_at(candidate, path, values[0][1]); paths.append(path)
                provenance[json.dumps(path)] = {'origin': 'documentary_inferred', 'humanConfirmed': False, 'active': True,
                    'value': values[0][1], 'sources': deepcopy(relevant)}
            if not paths:
                continue
            merged = merge_scope(attrs, {attribute: candidate[attribute]}, market)
            errors = flatten_errors(validation_errors(schema, scope_attributes(merged, market)))
            # Rechazar restricciones de valor activadas por otras hojas/condiciones; los
            # campos aún faltantes no invalidan la evidencia de una hoja ya conocida.
            if any(error.validator != 'required' and not error.context and
                   any(list(error.absolute_path) == path or list(error.absolute_path) and
                       path[:len(error.absolute_path)] == list(error.absolute_path) for path in paths)
                   for error in errors):
                continue
            attrs = merged
            evidence.update(provenance)
            changed = True; applied.add(attribute)
        if not changed:
            break
    return attrs, evidence, applied
