"""Preguntas canónicas de Drive: una decisión por atributo, sin elegir por mayoría."""
from hashlib import sha256
from decimal import Decimal
import json
import re
from .product_materials_fields import canonical_field, canonical_attribute
from .product_materials_values import normalize_value
from .product_materials_decisions import suppress_redundant_observations
from .product_materials_observations import observation_options, mark_observation_issues
from .product_requirements_suggestions import ean_valid
from .products import fail

STANDARD = {'name', 'brand', 'category', 'description', 'bullets', 'keywords'}
QUALIFIERS = {'nominal': 'diseño nominal', 'certified_claim': 'conformidad declarada',
              'visual_observation': 'observación visual'}


def field_of(proposal):
    return proposal.get('canonicalField') or canonical_field(proposal['field'], proposal['label'])


def key_of(proposal):
    return (field_of(proposal), proposal.get('scope', 'product'), proposal.get('claimType', 'declared'))


def scope_label(scope, sources=None):
    """El ámbito interno conserva sus IDs; el cliente ve el recurso o variante legible."""
    kind, _, rest = scope.partition(':')
    source_id, _, selector = rest.partition(':')
    source = (sources or {}).get(source_id)
    position = re.search(r'\[(\d+)\]', selector)
    number = f' {int(position[1]) + 1}' if position else ''
    if kind == 'variant':
        return f'variante{number} · {source}' if source else f'variante{number} del producto'
    if kind == 'asset':
        return f'recurso{number} · {source}' if source else f'recurso{number} de origen'
    return 'producto de origen'


def label_of(proposal, sources=None):
    label = proposal['label']
    qualifier = QUALIFIERS.get(proposal.get('claimType'))
    if qualifier:
        label += ' · ' + qualifier
    if proposal.get('scope', 'product') != 'product':
        label += ' · ' + scope_label(proposal['scope'], sources)
    return label[:100]


def custom_id(proposal):
    key = key_of(proposal)
    if key == ('custom:material', 'product', 'declared'):
        return 'preparation_material'
    return 'drive_' + sha256('|'.join(key).encode()).hexdigest()[:20]


def standard_target(proposal):
    return field_of(proposal) in STANDARD and key_of(proposal)[1:] == ('product', 'declared')


def current_value(product, proposal, confirmed_only=False):
    if standard_target(proposal) or (key_of(proposal) == ('name', 'product', 'visual_observation')):
        value = product.get(field_of(proposal), '')
        return '\n'.join(value) if isinstance(value, list) else str(value)
    identifier = custom_id(proposal)
    for item in product.get('customFields', []):
        if confirmed_only and item.get('isConfirmed') is not True:
            continue
        name = item.get('name', '')
        saved_claim = 'declared'
        for claim, qualifier in QUALIFIERS.items():
            if name.endswith(' · ' + qualifier):
                name, saved_claim = name.removesuffix(' · ' + qualifier), claim
                break
        compatible = (proposal.get('scope', 'product') == 'product' and
                      (proposal.get('claimType', 'declared') == saved_claim or
                       proposal.get('claimType') == 'visual_observation'))
        if item.get('id') == identifier or (compatible and canonical_attribute('', name) == field_of(proposal)):
            return str(item.get('value', ''))
    return ''


def equivalent(left, right):
    # Case/spacing changes do not fabricate a new value. Numbers/units remain distinct.
    return ' '.join(str(left).casefold().split()) == ' '.join(str(right).casefold().split())


def groups_of(proposals):
    groups = {}
    for proposal in proposals:
        if proposal.get('status') != 'proposed' or proposal.get('reviewable') is False:
            continue
        if proposal.get('channel') in ('production', 'reference') or proposal.get('supportStatus') == 'unsupported':
            continue
        # Dos lecturas distintas del mismo atributo son decisiones de recurso
        # independientes; la decisión de una imagen no resuelve otra.
        group_key = ('observation', proposal['id']) if proposal.get('observationIssue') else key_of(proposal)
        groups.setdefault(group_key, []).append(proposal)
    return list(groups.values())


def already_current(proposals, product):
    """Un valor inequívoco ya persistido no necesita otra pregunta ni otra escritura."""
    before = [(item.get('reviewable'), item.get('observationIssue')) for item in proposals]
    suppress_redundant_observations(proposals)
    mark_observation_issues(proposals)
    changed = before != [(item.get('reviewable'), item.get('observationIssue')) for item in proposals]
    for group in groups_of(proposals):
        current = current_value(product, group[0], confirmed_only=True)
        def same(item):
            left = normalize_value(field_of(item), current)
            right = normalize_value(field_of(item), item['value'])
            return left[0] == right[0] and left[2] == right[2]
        if not current or not all(same(item) for item in group):
            continue
        for item in group:
            item.update(status='confirmed', confirmedValue=current, confirmedField=field_of(item),
                        confirmationOrigin='existing_product', supportedValue=item.get('supportStatus') == 'supported',
                        reviewedRevision=product['revision'])
            changed = True
    return changed


def fingerprint(groups):
    content = [[{key: item.get(key) for key in ('id', 'value', 'canonicalField', 'scope', 'claimType',
                  'supportStatus', 'evidence', 'sourceProposalIds', 'observationIssue', 'resolution')} for item in group] for group in groups]
    return sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def evidence_text(proposal, sources, limit=260):
    evidence = proposal.get('evidence', [])
    if not evidence:
        return 'Sin cita documental verificable.'
    item = evidence[0]
    source = sources.get(item.get('sourceId'), item.get('sourceId', 'Fuente'))
    version = item.get('sourceVersion')
    where = f"{source} · {item.get('locator', '')}"
    if version:
        where += ' · versión ' + str(version)[:14]
    return f"{where}. «{item.get('excerpt', '')}»"[:limit]


def question_for(group, index, sources, product):
    proposal = group[0]
    if issue := proposal.get('observationIssue'):
        expected, observed = issue['expectedValue'], issue['observedValue']
        evidence = {(item.get('sourceId'), item.get('locator'), item.get('excerpt')): item
                    for member in group for item in member.get('evidence', [])}
        resources = [{'sourceName': str(sources.get(item.get('sourceId'), item.get('sourceId', 'Fuente')))[:500],
                      'locator': str(item.get('locator', ''))[:500], 'excerpt': str(item.get('excerpt', ''))[:300]}
                     for item in evidence.values()]
        return {'id': f'p{index}', 'label': ('Comprueba el recurso · ' + proposal['label'])[:100],
                'type': 'select', 'required': True, 'closed': True, 'options': observation_options(issue),
                'resourceEvidence': resources,
                'hint': (f'Referencia: {expected}. Lectura del recurso: {observed}. '
                         'Esta respuesta revisa todos los recursos enumerados y no cambia el dato de la ficha.')[:600]}
    values = list(dict.fromkeys(item['value'] for item in group))
    conflict = len(values) > 1
    verified = all(item.get('supportStatus', 'supported' if item.get('evidence') else 'needs_review') == 'supported'
                   and item.get('claimType') != 'visual_observation' for item in group)
    before = current_value(product, proposal)
    hint = (f'Valor actual: {before[:100]}. ' if before else '')
    qualifier = QUALIFIERS.get(proposal.get('claimType'))
    if conflict:
        hint += 'Las fuentes discrepan. Elige o declara el valor correcto; ninguna alternativa se elige por mayoría. '
        remaining = max(100, (560 - len(hint)) // min(len(group), 2))
        hint += ' | '.join(f"{item['value'][:55]}: {evidence_text(item, sources, remaining - 60)}" for item in group[:2])
        if len(group) > 2:
            hint += ' Consulta todas las fuentes en la tarjeta.'
    else:
        if not verified:
            hint += 'La fuente no verifica este dato. Si lo completas, se guardará como declarado por ti. '
        elif qualifier:
            hint += f'Es {qualifier}; confirmarlo no acredita una medición física ni conformidad. '
        original = next((item for item in proposal.get('originalValues', []) if re.search(
            r'pendiente|no verificad|por confirmar|sin confirmar|provisional|especie|acabado', item, re.I)), None)
        if original:
            hint += 'Matiz original: ' + original[:150] + '. '
        hint += evidence_text(proposal, sources, max(80, 510 - len(hint)))
    hint += ' Vacío: descartar sin cambiar la ficha.'
    field = {'id': f'p{index}', 'label': label_of(proposal, sources), 'type': 'textarea', 'required': False,
             'hint': hint[:600], 'validation': {'maxLength': answer_limit(proposal)}}
    if conflict and len(values) <= 20 and all(len(value) <= 160 for value in values):
        field.update(type='select', options=values, closed=False)
    elif conflict:
        # Los textos largos conservan su contenido en las fuentes; no se truncan como opciones.
        field['hint'] = ('Las fuentes discrepan. Revisa las alternativas completas en la tarjeta y escribe el valor correcto. ' + hint)[:600]
    elif verified:
        field['value'] = proposal['value']
        field['suggestion'] = {'value': proposal['value'], 'source': evidence_text(proposal, sources, 200)}
    return field


def answer_limit(proposal):
    return {'name': 500, 'brand': 200, 'category': 200, 'keywords': 2000,
            'description': 3000, 'bullets': 3000}.get(field_of(proposal), 2000)


def validate_answer(proposal, value):
    if len(value) > answer_limit(proposal):
        fail('invalid_material_answer', f'«{proposal["label"]}» admite hasta {answer_limit(proposal)} caracteres.')
    if any(ord(character) < 32 and character not in '\n\r\t' for character in value):
        fail('invalid_material_answer', 'El dato contiene caracteres no admitidos.')
    field = field_of(proposal)
    if field == 'custom:ean_gtin_13' and not ean_valid(value):
        fail('invalid_material_answer', 'El EAN / GTIN-13 debe tener 13 dígitos y un dígito de control válido; no se comprueba aquí su titularidad.')
    if field == 'custom:edad_minima' and not re.fullmatch(r'(?:a partir de\s+)?\d+(?:[.,]\d+)?\s*(?:\+|años?|mes(?:es)?|years?|months?)(?:\s*(?:años?|mes(?:es)?))?', value, re.I):
        fail('invalid_material_answer', 'Indica la edad con su unidad, por ejemplo «3 años» o «36 meses».')
    if field == 'custom:numero_piezas' and not re.fullmatch(r'[1-9]\d{0,6}(?:\s+(?:piezas?|bloques?))?', value, re.I):
        fail('invalid_material_answer', 'Indica un número entero positivo de piezas, por ejemplo «54 piezas».')
    if field in ('custom:peso_producto', 'custom:dimensiones_producto', 'custom:dimensiones_pieza'):
        units = r'mg|g|kg|gramos?|kilogramos?' if field == 'custom:peso_producto' else r'mm|cm|m|milímetros?|centímetros?|metros?'
        count = 0 if field == 'custom:peso_producto' else 2
        match = re.fullmatch(r'([0-9]+(?:[.,][0-9]+)?(?:\s*[x×]\s*[0-9]+(?:[.,][0-9]+)?){0,' + str(count) + r'})\s*(' + units + r')', value, re.I)
        if not match or any(Decimal(item.strip().replace(',', '.')) <= 0 for item in re.split('[x×]', match[1])):
            fail('invalid_material_answer', 'Indica medidas positivas con su unidad explícita, por ejemplo «250 g» o «7,5 × 2,5 × 1,5 cm».')
