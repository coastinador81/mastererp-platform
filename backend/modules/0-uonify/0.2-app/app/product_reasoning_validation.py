"""Aceptación determinista: referencias cerradas, contraste, tipos PTD y no sobrescritura."""
from copy import deepcopy
import json
import math
import re
from .incident_fields import get_at, put_at
from .incident_schema_validation import validator_for, validation_errors
from .product_requirements_fields import flatten_errors
from .product_reasoning_context import digest, words
from .product_materials_amazon import CANONICAL
from .product_materials_fields import canonical_attribute
from .product_materials_values import normalize_value
from .product_requirements_suggestions import normalized, quantity, choice

MEASURE = re.compile(r'(?:weight|dimensions?|length|width|height|depth|diameter|thickness|volume|capacity|peso|dimensi|longitud|anchura|altura|profundidad)')
AUTHORITY = re.compile(r'(?:certif|compliance|conform|attestation|supplier_declared_dg_hz_regulation|test_report|safety_standard|ensayo|fsc|cpsia|astm)')
COMMERCIAL = re.compile(r'(?:price|fulfillment_availability|inventory|stock|condition_type|precio)')
RESERVATIONS = {'nominal', 'nominales', 'render', 'blender', 'provisional', 'pendiente', 'borrador', 'propuesta'}
LEGAL_SUPPORT = re.compile(r'certif|compliance|conform|attestation|test.report|safety.standard|ensayo|declaracion|declaration|'
    r'cpsia|astm|en[ -]?71|gpsr|\bce\b|ficha.de.seguridad', re.I)
DG_SUPPORT = re.compile(r'dangerous.goods|hazardous|hazmat|mercancias.peligrosas|materiales.peligrosos|'
    r'\badr\b|\biata\b|\bimdg\b|\bsds\b|\bfds\b|safety.data.sheet|datos.de.seguridad|supplier.declared.dg|dg.hz.regulation', re.I)


def sensitive(target):
    name = str(target['path'][0]).lower()
    return bool(MEASURE.search(name) or AUTHORITY.search(name) or COMMERCIAL.search(name))


def authority_topic(target):
    name = str(target['path'][0]).lower()
    return DG_SUPPORT if re.search(r'dg_hz|dangerous|hazardous|hazmat', name) else LEGAL_SUPPORT


def real_native(value):
    return isinstance(value, (str, int, float, bool)) and (not isinstance(value, float) or math.isfinite(value))


def same_value(left, right):
    return type(left) is type(right) and left == right


def same_fact_value(fact, target, value, candidate):
    raw = str(fact.get('value', '')).strip()
    if normalized(raw) == normalized(value): return True
    canonical = fact.get('canonicalField') or canonical_attribute(fact.get('field', ''), fact.get('label', ''))
    if normalize_value(canonical, raw)[0] == normalize_value(canonical, str(value))[0]: return True
    options = target.get('choices') or dict(zip(target.get('constraints', {}).get('enumNames', []),
                                               target.get('constraints', {}).get('enum', [])))
    selected = choice(raw, {'choices': options})
    if selected and same_value(selected[1], value): return True
    pair = quantity(raw, str(fact.get('label', '')))
    if pair and isinstance(value, (int, float)) and not isinstance(value, bool):
        number, unit = pair
        target_unit = get_at(candidate, target['path'][:-1] + ['unit'])
        scales = {'grams': ('mass', 1), 'kilograms': ('mass', 1000), 'milligrams': ('mass', .001),
                  'meters': ('length', 1), 'centimeters': ('length', .01), 'millimeters': ('length', .001),
                  'months': ('age', 1), 'years': ('age', 12)}
        if unit in scales and target_unit in scales and scales[unit][0] == scales[target_unit][0]:
            return math.isclose(float(number) * scales[unit][1], value * scales[target_unit][1], rel_tol=1e-12)
        return float(number) == value
    return False


def validated_candidates(context, proposal, verification, *, rejections=None):
    """No publica: devuelve solo hojas inferidas verificadas para el guardado transaccional."""
    if not isinstance(proposal, dict) or not isinstance(verification, dict): return []
    if verification.get('proposalFingerprint') != digest(proposal.get('decisions', [])): return []
    targets = {t['id']: t for t in context['targets']}
    catalog = {e['id']: e for e in context['evidence']}
    verdicts = {}; duplicate_verdicts = set()
    for verdict in verification.get('verdicts', []):
        if not isinstance(verdict, dict): continue
        key = verdict.get('targetId')
        if key in verdicts: duplicate_verdicts.add(key)
        verdicts[key] = verdict
    decisions = proposal.get('decisions', [])
    if not isinstance(decisions, list): return []
    ids = [d.get('targetId') for d in decisions if isinstance(d, dict)]
    accepted = []; current = context['protected']['amazonAttributes']
    candidate = deepcopy(context.get('candidate', current)); schema = context['validationSchema']
    def reject(key, reason):
        if rejections is not None: rejections[key] = reason
    for decision in decisions:
        if not isinstance(decision, dict): continue
        key = decision.get('targetId'); target = targets.get(key); verdict = verdicts.get(key, {})
        if not target or ids.count(key) != 1 or key in duplicate_verdicts: continue
        if decision.get('state') != 'inferred' or not real_native(decision.get('value')): continue
        if verdict.get('resolution') != 'supported': continue
        if any(verdict.get(flag) is not True for flag in ('accepted', 'productMatch', 'conflictsResolved')): continue
        if get_at(current, target['path']) is not None:
            reject(key, 'existing_value'); continue
        if target['type'] == 'boolean' and not isinstance(decision['value'], bool): continue
        refs = decision.get('evidenceRefs', []) + verdict.get('evidenceRefs', [])
        if not refs or any(not isinstance(ref, str) or ref not in catalog for ref in refs):
            reject(key, 'reference_invalid'); continue
        evidence = [catalog[ref] for ref in dict.fromkeys(refs)]
        if any(e.get('formulaUncertain') for e in evidence):
            reject(key, 'formula_uncertain'); continue
        # Confirmaciones/decisiones previas se conservan y no pueden resucitarse desde otra copia.
        blocked = False
        for fact in context.get('facts', []):
            field_words = words(str(fact.get('canonicalField', fact.get('field', ''))).replace('custom:', ''))
            canonical = fact.get('canonicalField') or canonical_attribute(fact.get('field', ''), fact.get('label', ''))
            relevant = canonical == CANONICAL.get(target['path'][0]) or bool(field_words & words(str(target['path'][0])))
            equivalent = same_fact_value(fact, target, decision['value'], candidate)
            # El rechazo se aplica al dato en cualquier copia; no solo a la cita utilizada.
            scope = fact.get('scope', 'product')
            decision_applies = scope in (None, 'product') or str(scope).startswith('asset')
            if relevant and decision_applies and fact.get('status') == 'rejected' and equivalent:
                blocked = True; break
            if not set(fact.get('evidenceRefs', [])) & set(refs): continue
            scope = fact.get('scope', 'product')
            # Una observación tiene alcance asset por su procedencia, no necesariamente otro producto.
            asset = str(scope).startswith('asset') and verdict.get('basis') in ('visible_property', 'functional_reasoning')
            if relevant and (scope not in (None, 'product') and not asset or fact.get('channel') == 'reference'):
                blocked = True; break
        if blocked:
            reject(key, 'protected_decision_or_scope'); continue
        if sensitive(target):
            if verdict.get('basis') not in ('direct_document', 'confirmed_value') or verdict.get('authorityConfirmed') is not True:
                reject(key, 'documentary_basis_missing'); continue
            documents = [e for e in evidence if e['kind'] in ('text', 'user_confirmed', 'product_value') and not e.get('observational')]
            if verdict.get('pixelTextVerified') is True:
                documents += [e for e in evidence if e['kind'] == 'ocr' and any(
                    p['kind'] == 'image' and p.get('sourceId') == e.get('sourceId')
                    and p.get('fragmentId') == e.get('fragmentId') for p in evidence)]
            quote = verdict.get('quote', '')
            # La cita debe estar en la unidad original, incluyendo reservas del mismo registro.
            supporting = [e for e in documents if isinstance(quote, str) and quote.strip() and quote in e.get('text', '')]
            if not supporting:
                reject(key, 'documentary_quote_missing'); continue
            if any(RESERVATIONS & words(e.get('text', '')) for e in supporting):
                reject(key, 'documentary_reservation'); continue
            if AUTHORITY.search(str(target['path'][0]).lower()) and not any(
                    authority_topic(target).search(normalized(e.get('text', ''))) for e in supporting):
                reject(key, 'authority_claim_missing'); continue
        leaf = {**target['schema'], '$defs': schema.get('$defs', {}), 'definitions': schema.get('definitions', {})}
        try:
            if not validator_for(leaf).is_valid(decision['value']):
                reject(key, 'type_or_schema_invalid'); continue
        except (TypeError, ValueError):
            reject(key, 'type_or_schema_invalid'); continue
        put_at(candidate, target['path'], decision['value'])
        accepted.append({'targetId': key, 'path': deepcopy(target['path']), 'value': decision['value'],
            'origin': 'semantic_inferred', 'humanConfirmed': False,
            'evidence': [{k: deepcopy(v) for k, v in e.items() if k not in ('inline', '_digest', 'image', 'visual')}
                         for e in evidence],
            'rationale': str(verdict.get('reason') or decision.get('reason', ''))[:3000],
            'basis': verdict.get('basis'), 'contextFingerprint': context['fingerprint']})
    # Rechazar valores que activan restricciones incompatibles, pero permitir otros campos faltantes.
    errors = list(flatten_errors(validation_errors(schema, candidate)))
    rejected = set()
    for item in accepted:
        for error in errors:
            path = list(error.absolute_path)
            if error.validator != 'required' and not error.context and (
                not path or path[:len(item['path'])] == item['path'] or item['path'][:len(path)] == path):
                rejected.add(item['targetId'])
                reject(item['targetId'], 'schema_condition_invalid')
    return [item for item in accepted if item['targetId'] not in rejected]
