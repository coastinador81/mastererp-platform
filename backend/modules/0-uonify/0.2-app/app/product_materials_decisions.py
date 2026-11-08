"""Conserva decisiones y evita preguntas duplicadas sin promover observaciones a hechos."""
from copy import deepcopy
from collections import defaultdict
from .product_materials_fields import canonical_attribute
from .product_materials_values import normalize_value
from .product_materials_observations import mark_observation_issues

DECISION_KEYS = ('status', 'confirmedValue', 'confirmedField', 'confirmationOrigin',
                 'supportedValue', 'reviewedRevision', 'resolution', 'reviewDecision')


def has_decision(fact):
    return fact.get('status') in ('confirmed', 'rejected') or fact.get('resolution', {}).get('status') in ('awaiting_source', 'awaiting_client')


def decision_signature(fact):
    pending = fact.get('resolution', {}) if fact['status'] == 'proposed' else {}
    return fact['status'], fact.get('confirmedValue'), pending.get('status'), pending.get('requiredAction')


def decision_key(fact):
    field = canonical_attribute(fact['field'], fact['label'])
    value, _, unit = normalize_value(field, fact['value'])
    return (field, fact.get('scope', 'product'), fact.get('channel', 'product'),
            fact.get('claimType', 'declared'), value, unit)


def restore_decisions(facts, previous, product=None):
    """Muta sólo el resultado nuevo. Misma afirmación/ámbito, aun si cambió su ID por alias.

    No cambia la ficha, el respaldo ni la afirmación original. Las decisiones
    incompatibles se conservan como historia, nunca se elige una por mayoría.
    """
    by_id = {item['id']: item for item in previous}
    by_key = defaultdict(list)
    for item in previous:
        if has_decision(item):
            by_key[decision_key(item)].append(item)
    for fact in facts['proposals']:
        direct = by_id.get(fact['id'])
        matches = [direct] if direct and has_decision(direct) else by_key[decision_key(fact)]
        if not matches:
            # Una inscripción genérica puede haberse unido a su cara explícita.
            matches = [old for old in previous if has_decision(old)
                       and set(old.get('sourceProposalIds', [])) & set(fact.get('sourceProposalIds', []))
                       and decision_key(old)[1:] == decision_key(fact)[1:]]
        decisions = {decision_signature(old) for old in matches}
        if fact.get('claimType') == 'visual_observation' and fact.get('evidence'):
            current_versions = {(e['sourceId'], e.get('sourceVersion')) for e in fact['evidence']}
            matches = [old for old in matches if not old.get('evidence') or
                       {(e['sourceId'], e.get('sourceVersion')) for e in old['evidence']} == current_versions]
            decisions = {decision_signature(old) for old in matches}
        if len(decisions) == 1:
            old = max(matches, key=lambda item: item.get('reviewedRevision', 0))
            for key in DECISION_KEYS:
                if key in old:
                    fact[key] = deepcopy(old[key])
            fact['confirmedField'] = fact['canonicalField'] if fact.get('status') == 'confirmed' else fact.get('confirmedField')
            fact['previousFactIds'] = sorted({old['id'] for old in matches if old['id'] != fact['id']})
        elif matches:
            fact['previousDecisions'] = [{key: old[key] for key in ('id', *DECISION_KEYS) if key in old} for old in matches]
    suppress_redundant_observations(facts['proposals'])
    chosen_name = next((item for item in facts['proposals'] if item.get('status') == 'confirmed' and
                       item.get('canonicalField') == 'name' and item.get('scope') == 'product' and
                       item.get('confirmationOrigin') == 'user_declared' and
                       item.get('confirmedValue') == (product or {}).get('name')), None)
    if chosen_name:
        for fact in facts['proposals']:
            if fact['canonicalField'] == 'name' and fact.get('scope') == 'product':
                fact['reviewable'] = False
                fact['coveredByDecisionId'] = chosen_name['id']
                fact['supportReason'] = (fact.get('supportReason', '') +
                    ' Se conserva el nombre elegido por el cliente; las denominaciones documentales siguen en el historial.').strip()
    mark_observation_issues(facts['proposals'])
    conflicts = defaultdict(list)
    for fact in facts['proposals']:
        if fact.get('conflictGroup'):
            conflicts[fact['conflictGroup']].append(fact)
    for group in conflicts.values():
        if not any(fact.get('reviewable') and fact.get('status') == 'proposed' for fact in group):
            for fact in group:
                fact['conflict'] = False
                fact.pop('conflictGroup', None)
    facts.setdefault('summary', {})['conflictCount'] = len({fact['conflictGroup'] for fact in facts['proposals'] if fact.get('conflictGroup')})
    facts.setdefault('summary', {})['reviewableCount'] = sum(item.get('reviewable', False) for item in facts['proposals'])
    return facts


def suppress_redundant_observations(proposals):
    """Un documento/decisión equivalente cubre la pregunta; la imagen sigue siendo imagen."""
    covered = defaultdict(list)
    for fact in proposals:
        if fact.get('claimType') == 'visual_observation' or fact.get('channel') not in ('product', 'safety'):
            continue
        if fact.get('supportStatus') == 'supported' or fact.get('status') == 'confirmed':
            field = fact['canonicalField']
            values = [fact['value']]
            if fact.get('status') == 'confirmed' and fact.get('confirmedValue'):
                values.append(fact['confirmedValue'])
            for value in values:
                key, _, unit = normalize_value(field, value)
                covered[(field, fact.get('scope', 'product'), key, unit)].append(fact['id'])
    for fact in proposals:
        if fact.get('claimType') != 'visual_observation':
            continue
        field = fact['canonicalField']
        key, _, unit = normalize_value(field, fact['value'])
        matches = covered.get((field, fact.get('scope', 'product'), key, unit), [])
        if field == 'custom:contacto_correo' and fact.get('scope') == 'product':
            # Evita volver a pedir el mismo email, sin atribuirle otro papel legal.
            matches += covered.get(('custom:fabricante_correo', 'product', key, unit), [])
        if matches:
            fact['reviewable'] = False
            fact['coveredByFactIds'] = sorted(set(matches))
            sentence = 'El mismo valor ya está documentado o revisado; la observación se conserva sin repetir la pregunta.'
            if sentence not in fact.get('supportReason', ''):
                fact['supportReason'] = (fact.get('supportReason', '') + ' ' + sentence).strip()
