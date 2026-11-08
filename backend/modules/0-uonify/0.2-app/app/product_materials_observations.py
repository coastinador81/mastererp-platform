"""Una discrepancia en una imagen se revisa como recurso, sin reescribir la ficha."""
from collections import defaultdict
from .product_materials_values import normalize_value

READING_INCORRECT = 'La lectura es incorrecta; el dato de referencia es correcto'
RESOURCE_INCORRECT = 'El recurso contiene un dato erróneo'
UNABLE_TO_CHECK = 'No puedo comprobarlo todavía'
ALTERNATIVE_WORDING = 'Es una redacción alternativa; conservar el dato guardado'
OBSERVATION_OPTIONS = [READING_INCORRECT, RESOURCE_INCORRECT, UNABLE_TO_CHECK]
ATOMIC_FIELDS = {'name', 'brand', 'custom:modelo', 'custom:fabricante', 'custom:persona_responsable',
                 'custom:ean_gtin_13', 'custom:pais_fabricacion', 'custom:lote', 'custom:edad_minima',
                 'custom:numero_piezas', 'custom:material'}


def observation_options(issue):
    return [ALTERNATIVE_WORDING, RESOURCE_INCORRECT, UNABLE_TO_CHECK] if issue.get('reason') == 'confirmed_text_variant' else OBSERVATION_OPTIONS


def mark_observation_issues(proposals):
    references = defaultdict(list)
    for fact in proposals:
        if (fact.get('claimType') != 'visual_observation' and fact.get('scope') == 'product'
                and fact.get('channel') in ('product', 'safety') and
                (fact.get('status') == 'confirmed' or fact.get('supportStatus') == 'supported')):
            references[fact['canonicalField']].append(fact)
    for fact in proposals:
        if fact.get('claimType') != 'visual_observation' or not fact.get('reviewable'):
            continue
        matches = references.get(fact['canonicalField'], []) if fact.get('scope') == 'product' else []
        confirmed = [ref for ref in matches if ref.get('status') == 'confirmed']
        matches = confirmed or matches
        if not confirmed and fact['canonicalField'] not in ATOMIC_FIELDS:
            continue  # Dos redacciones no demuestran por sí mismas un error.
        expected = {ref.get('confirmedValue', ref['value']) for ref in matches}
        # Varios documentos discrepantes requieren primero una decisión sobre el dato.
        if len(expected) != 1:
            continue
        value = expected.pop()
        if normalize_value(fact['canonicalField'], value)[0::2] == normalize_value(fact['canonicalField'], fact['value'])[0::2]:
            continue
        sources = sorted({e['sourceId'] for e in fact.get('evidence', [])})
        reason = ('confirmed_text_variant' if confirmed and fact['canonicalField'] not in ATOMIC_FIELDS else
                  'confirmed_value_discrepancy' if confirmed else 'documented_value_discrepancy')
        fact['observationIssue'] = {'reason': reason,
            'expectedValue': value, 'observedValue': fact['value'], 'expectedFactIds': sorted(ref['id'] for ref in matches),
            'sourceIds': sources, 'sourceId': sources[0] if len(sources) == 1 else None,
            'evidenceIds': [e.get('citationId') for e in fact.get('evidence', []) if e.get('citationId')]}


def decide_observation(group, answer, discard=False):
    """Retorna False para respuesta inválida. No recibe ni modifica el producto."""
    if not discard and answer not in observation_options(group[0]['observationIssue']):
        return False
    for fact in group:
        if discard or answer in (READING_INCORRECT, ALTERNATIVE_WORDING):
            fact.update(status='rejected', reviewDecision='observation_dismissed' if discard else
                        'alternative_wording' if answer == ALTERNATIVE_WORDING else 'reading_incorrect',
                        resolution={'status': 'resolved', 'reason': 'user_discarded_observation' if discard else
                                    'alternative_wording' if answer == ALTERNATIVE_WORDING else 'reading_incorrect',
                                    'origin': 'user_review', 'productChanged': False})
        else:
            replacement = answer == RESOURCE_INCORRECT
            fact.update(status='proposed', reviewDecision='resource_incorrect' if replacement else 'unable_to_check',
                        resolution={'status': 'awaiting_source' if replacement else 'awaiting_client',
                                    'reason': 'resource_incorrect' if replacement else 'unable_to_check',
                                    'requiredAction': 'replace_source' if replacement else 'review_resource',
                                    'origin': 'user_review', 'productChanged': False})
    return True
