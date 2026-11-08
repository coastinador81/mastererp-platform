"""Distingue insuficiencia factual objetiva de errores internos sin otra llamada IA."""
from copy import deepcopy
import re
import unicodedata
from .incident_fields import put_at
from .incident_schema_validation import validator_for, validation_errors
from .product_requirements_fields import flatten_errors
from .product_reasoning_context import digest, words
from .product_reasoning_validation import (validated_candidates, MEASURE, AUTHORITY,
                                            RESERVATIONS, real_native, authority_topic)
from .product_materials_evidence import NOMINAL, PRODUCTION
from .product_reasoning_source_context import real_measurement, NUMBER_WITH_UNIT, RESERVED_DESIGN

VALIDATION_RESOLUTION_VERSION = 1
MEASUREMENT = re.compile(r'weight|dimension|length|width|height|depth|diameter|thickness|volume|capacity|'
    r'peso|medid|medicion|longitud|ancho|alto|altura|anchura|profundidad|diametro|grosor|volumen|capacidad|'
    r'\d\s*[x×]\s*\d|\d[\d.,]*\s*(?:mm|cm|kg|mg|inches|grams|kilograms)\b', re.I)
DOCUMENT_KINDS = {'text', 'ocr', 'user_confirmed', 'product_value'}
GRAPHIC_SCOPE = re.compile(r'barcode|codigo.de.barras|bar.pattern|bar.height|guard.height|glyph|quiet.zone|'
    r'rgba|png|pixel|raster|render|camera|camara', re.I)
REASONS = {
    'physical_measurement_not_documented': 'Los originales solo aportan medidas de diseño. Falta confirmar la medida física del producto.',
    'legal_declaration_not_documented': 'Los materiales o la apariencia no acreditan esta declaración. Falta la declaración o documentación pertinente del responsable.',
}


def text_of(entry):
    value = entry.get('text', entry.get('preview', ''))
    return unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()


def design_original(entry):
    name = str(entry.get('sourceName', '')).lower()
    locator = str(entry.get('locator', '')).lower()
    return name.endswith(('.blend', '.glb', '.gltf', '.obj', '.stl', '.fbx')) or locator.startswith(('$.objects[', '$.materials['))


def has_reservation(entry):
    text = text_of(entry)
    return bool(RESERVATIONS & words(text)) or bool(NOMINAL.search(text)) or bool(RESERVED_DESIGN.search(text.replace('_', ' ')))


def legal_pattern(target):
    return authority_topic(target)


def pertinent(entry, target, legal=False):
    if design_original(entry): return False
    text = text_of(entry)
    pattern = legal_pattern(target) if legal else MEASUREMENT
    if has_reservation(entry) and (legal or not real_measurement(text)): return False
    if entry.get('kind') in DOCUMENT_KINDS and pattern.search(text):
        if legal: return True
        graphic = GRAPHIC_SCOPE.search(text) or PRODUCTION.search(text.replace('_', ' '))
        if graphic and not real_measurement(text): return False
        quantified = NUMBER_WITH_UNIT.search(text) or re.search(
            r'\.(?:value|valor):\s*["\']?\d|\b[b-z]\s*:\s*\d|'
            r'(?:length|width|height|weight|peso|ancho|alto|longitud)[_a-z]*_(?:mm|cm|kg|g):\s*\d', text)
        if quantified: return True
    # Una página/archivo explícitamente de medición o conformidad puede ser recuperable.
    # Una fotografía corriente no acredita medidas ni una declaración por su apariencia.
    name = unicodedata.normalize('NFKD', str(entry.get('sourceName', ''))).encode('ascii', 'ignore').decode().lower()
    if legal:
        return bool(pattern.search(name))
    return bool(re.search(r'medicion|measurement|pesaje|weighing|informe.medidas', name))


def alternative_evidence(context, target, *, legal=False, exclude=()):
    excluded = set(exclude)
    states = context.get('_reconciliationSourceStates', {})
    selected = [entry['id'] for entry in context.get('evidence', [])
                if entry['id'] not in excluded and entry['id'] not in states and pertinent(entry, target, legal)]
    omitted = [entry['id'] for entry in context.get('coverage', {}).get('omittedUnits', [])
               if entry['id'] not in excluded and entry['id'] not in states and pertinent(entry, target, legal)]
    return selected, omitted


def schema_valid(context, target, value):
    schema = context['validationSchema']
    leaf = {**target['schema'], '$defs': schema.get('$defs', {}), 'definitions': schema.get('definitions', {})}
    try:
        if not validator_for(leaf).is_valid(value): return False
        before = deepcopy(context.get('candidate', context['protected']['amazonAttributes']))
        after = deepcopy(before); put_at(after, target['path'], value)
        def errors(candidate):
            return {(tuple(e.absolute_path), tuple(e.absolute_schema_path), e.validator, e.message)
                    for e in flatten_errors(validation_errors(schema, candidate)) if e.validator != 'required' and not e.context}
        return not (errors(after) - errors(before))
    except (ValueError, TypeError, KeyError):
        return False


def factual_rejection(context, target, decision, verdict, rejection):
    """Devuelve solo carencias demostrables; cualquier duda técnica permanece interna."""
    if rejection not in ('documentary_reservation', 'documentary_basis_missing', 'documentary_quote_missing', 'authority_claim_missing'):
        return None
    if not schema_valid(context, target, decision.get('value')): return None
    catalog = {entry['id']: entry for entry in context['evidence']}
    refs = list(dict.fromkeys(decision.get('evidenceRefs', []) + verdict.get('evidenceRefs', [])))
    if not refs or any(ref not in catalog for ref in refs): return None
    evidence = [catalog[ref] for ref in refs]
    quote = verdict.get('quote')
    supporting = [entry for entry in evidence if entry.get('kind') in DOCUMENT_KINDS
                  and isinstance(quote, str) and quote.strip() and quote in entry.get('text', '')]
    name = str(target['path'][0]).lower()
    if MEASURE.search(name):
        # No convertir una cita inexistente, un OCR dudoso o una foto en falta de medición.
        if rejection != 'documentary_reservation' or not supporting: return None
        if not all(has_reservation(entry) for entry in supporting): return None
        if any(real_measurement(text_of(entry)) for entry in supporting): return None
        if any(entry.get('kind') == 'ocr' or entry.get('observational') for entry in supporting): return None
        selected, omitted = alternative_evidence(context, target, exclude=[e['id'] for e in supporting])
        if selected or omitted: return None
        return 'physical_measurement_not_documented', refs
    if AUTHORITY.search(name):
        # La falta de una cita válida es técnica si existe un documento pertinente al que acudir.
        selected, omitted = alternative_evidence(context, target, legal=True)
        if selected or omitted: return None
        if not supporting and rejection == 'documentary_quote_missing': return None
        # Clasificar solo inferencias de apariencia/material/función; nunca inventar una declaración.
        material_or_appearance = all(entry.get('kind') == 'image' or design_original(entry) or
            re.search(r'material|madera|wood|metal|plastic|vidrio|glass|ceramic|textil|cotton|algodon|composicion', text_of(entry))
            for entry in evidence)
        if not material_or_appearance: return None
        return 'legal_declaration_not_documented', refs
    return None


def reconcile_resolutions(context, proposal, verification):
    """Copia auditada del veredicto; las respuestas pagadas originales permanecen intactas."""
    result = deepcopy(verification)
    if not isinstance(proposal, dict) or not isinstance(result, dict) or not proposal.get('decisions'):
        return result
    if result.get('proposalFingerprint') != digest(proposal['decisions']): return result
    if 'validationSchema' not in context or context.get('coverage', {}).get('originalReadingComplete') is False:
        return result
    rejections = {}
    validated_candidates(context, proposal, verification, rejections=rejections)
    targets = {target['id']: target for target in context.get('targets', [])}
    decisions = {d['targetId']: d for d in proposal['decisions']}
    for verdict in result.get('verdicts', []):
        key = verdict.get('targetId'); target = targets.get(key); decision = decisions.get(key)
        if not target or not decision or key not in rejections: continue
        if verdict.get('resolution') != 'supported' or verdict.get('accepted') is not True: continue
        if decision.get('state') != 'inferred' or not real_native(decision.get('value')): continue
        finding = factual_rejection(context, target, decision, verdict, rejections[key])
        if finding is None: continue
        code, refs = finding
        original = deepcopy(verdict)
        verdict.update(accepted=False, resolution='unknown', authorityConfirmed=False,
            requestedEvidenceRefs=[], reason=REASONS[code], reconciliation={
                'version': VALIDATION_RESOLUTION_VERSION, 'code': code,
                'origin': 'server_evidence_rule', 'evidenceRefs': refs, 'reason': REASONS[code],
                'originalVerdict': original})
    return result
