"""Hechos con fuentes, alias y conflictos explícitos; nunca confirma datos por mayoría."""
from collections import Counter, defaultdict
from copy import deepcopy
import re
from .product_materials_fields import canonical_attribute, canonical_label
from .product_materials_values import normalize_value, valid_gtin, value_supported
from .product_materials_decisions import suppress_redundant_observations
from .product_materials_evidence import (EvidenceIndex, REASONS, classify, citation_record,
                                         stable_id, support_reason, formula_operand_only)

VERSION = 1
SUPPORT_RANK = {'unsupported': 0, 'needs_review': 1, 'supported': 2}


def _reason(code):
    return {'code': code, 'message': REASONS[code]}


def _rejection(proposal, citation, code, recovered=False):
    evidence = [{key: citation[key] for key in ('sourceId', 'locator', 'excerpt') if key in citation}] if citation else []
    return {'id': stable_id('rejection_', proposal.get('id'), evidence, code),
            'proposalId': proposal.get('id'), 'label': proposal.get('label', ''),
            'value': proposal.get('value', ''), 'code': code, 'reason': REASONS[code],
            'evidence': evidence, 'recovered': recovered}


def _fact(proposal, field, value_key, display, unit, channel, claim, scope, citations, support, reasons):
    identifier = stable_id('fact_', field, scope, channel, claim, value_key, unit)
    result = {'id': identifier, 'field': field, 'canonicalField': field,
              'label': canonical_label(field, proposal['label']), 'value': display,
              'normalizedValue': value_key, 'unit': unit, 'channel': channel, 'claimType': claim,
              'scope': scope, 'supportStatus': support, 'supportReasons': reasons,
              'supportReason': ' '.join(reason['message'] for reason in reasons),
              'originalValues': sorted(set(proposal.get('originalValues', []) + [proposal['value']])),
              'sourceProposalIds': proposal.get('sourceProposalIds', [proposal.get('id', identifier)]),
              'evidence': citations, 'status': proposal.get('status', 'proposed'), 'conflict': False,
              'reviewable': channel in ('product', 'safety') and support != 'unsupported'}
    for key in ('confirmedValue', 'confirmedField', 'reviewedRevision', 'confirmationOrigin'):
        if key in proposal:
            result[key] = deepcopy(proposal[key])
    return result


def _merge(target, new):
    for key in ('originalValues', 'sourceProposalIds'):
        target[key] = sorted(set(target[key] + new[key]))
    target['evidence'] = list({e['citationId']: e for e in target['evidence'] + new['evidence']}.values())
    target['supportReasons'] = list({r['code']: r for r in target['supportReasons'] + new['supportReasons']}.values())
    if SUPPORT_RANK[new['supportStatus']] > SUPPORT_RANK[target['supportStatus']]:
        target['supportStatus'] = new['supportStatus']
    target['supportReason'] = ' '.join(reason['message'] for reason in target['supportReasons'])
    target['reviewable'] = target['channel'] in ('product', 'safety') and target['supportStatus'] != 'unsupported'
    # Una propuesta nueva no resucita decisiones revisadas. Decisiones distintas no se borran.
    if target['status'] != new['status']:
        states = {target['status'], new['status']}
        target['reviewHistory'] = sorted(set(target.get('reviewHistory', []) + list(states)))
        target['status'] = 'confirmed' if 'confirmed' in states else 'rejected' if 'rejected' in states else 'proposed'
        for key in ('confirmedValue', 'confirmedField', 'reviewedRevision', 'confirmationOrigin'):
            if key in new and key not in target:
                target[key] = deepcopy(new[key])


def _evaluate(proposal, field, citation, index):
    entry, error = index.verify(citation)
    if error:
        return None, error
    source = index.sources[entry['sourceId']]
    context = '' if entry.get('visual') else index.context(entry)
    channel, claim, scope = classify(field, proposal['label'], proposal['value'], entry, source, context, index.product)
    if channel == 'reference':
        return (entry, channel, claim, scope, 'unsupported', 'reference_source'), None
    if entry.get('visual'):
        # La descripción del modelo se conserva como observación, nunca se verifica contra píxeles aquí.
        observed_text = entry['excerpt'].removeprefix('Caché de gráfico sin recalcular: ') if entry.get('method') == 'chart_cache' else entry['excerpt']
        if not value_supported(field, proposal['value'], observed_text):
            return None, 'value_not_supported'
        reason = {'ocr': 'ocr_pending', 'barcode': 'barcode_observed', 'chart_cache': 'chart_cache_pending'}.get(entry.get('method'), 'visual_pending')
        return (entry, channel, claim, scope, 'needs_review', reason), None
    if formula_operand_only(entry, field, proposal['value']) or any(item.get('cacheStatus') == 'cached_error' and str(item.get('cachedValue')) == proposal['value'] for item in entry.get('formulaEvidence', [])):
        return None, 'missing_value'
    error = support_reason(field, proposal['label'], proposal['value'], entry['excerpt'], context)
    if error:
        return None, error
    entry['contextEvidence'] = index.context_citations(entry)
    if entry.get('formulaUncertain') or ('fórmula:' in entry.get('text', '').lower() and
            any(token in entry['text'].lower() for token in ('no recalculad', 'vigencia desconocida', 'frescura desconocida', 'sin valor guardado'))):
        return (entry, channel, claim, scope, 'needs_review', 'formula_uncertain'), None
    if claim == 'certified_claim':
        return (entry, channel, claim, scope, 'needs_review', 'certification_unverified'), None
    return (entry, channel, claim, scope, 'supported', None), None


def _symbol_set(value):
    """Lista cerrada de símbolos observados; no interpreta certificación ni ausencia implícita."""
    normalized = normalize_value('custom:symbols', value)[0]
    markers = {symbol for symbol in ('ce', 'fsc', 'ukca', 'mobius', 'triman', 'punto verde')
               if re.search(r'(?<!\w)' + symbol + r'(?!\w)', normalized)}
    if re.search(r'(?<!\d)3\s*\+', value):
        markers.add('3+')
    if re.search(r'(?<!\d)0\s*[-–—]\s*3(?!\d)', value):
        markers.add('0-3')
    return markers


def _compatible_symbol_details(left, right):
    first, second = left['normalizedValue'], right['normalizedValue']
    # Sólo extensiones de detalle de la misma lista; no asumir que omitir FSC significa ausencia.
    symbols = _symbol_set(left['value'])
    if not symbols or symbols != _symbol_set(right['value']):
        return False
    if re.search(r'\b(?:no|sin|ausente|retirado|excluido|excepto|only|not|without)\b', first + ' ' + second):
        return False
    return first == second or first.startswith(second + ' ') or second.startswith(first + ' ')


def _merge_symbol_details(facts):
    groups = defaultdict(list)
    for fact in facts:
        if (fact['canonicalField'] == 'custom:simbolos_presentes_en_el_arte'
                and fact['supportStatus'] == 'supported'):
            groups[(fact['scope'], fact['claimType'], fact['channel'])].append(fact)
    replacements, removed = {}, set()
    for values in groups.values():
        if len(values) < 2 or any(not _compatible_symbol_details(a, b)
                                  for i, a in enumerate(values) for b in values[i + 1:]):
            continue
        base = min(values, key=lambda f: (len(f['normalizedValue']), f['normalizedValue'], f['id']))
        # El valor común más breve está respaldado por TODAS las citas; el detalle extra no se inventa.
        if any(not value_supported(base['canonicalField'], base['value'], citation['excerpt'])
               for fact in values for citation in fact['evidence']):
            continue
        for fact in values:
            if fact is not base:
                _merge(base, fact)
        base['supportReason'] = ('Las fuentes describen los mismos símbolos. Los detalles adicionales '
                                 'de las instrucciones se conservan en los valores originales y las citas.')
        replacements[values[0]['id']] = base
        removed.update(fact['id'] for fact in values)
    return [replacements[fact['id']] if fact['id'] in replacements else fact
            for fact in facts if fact['id'] not in removed or fact['id'] in replacements]


def consolidate_proposals(proposals, sources, fragments, product=None):
    """API pura para análisis nuevos y reconciliación histórica sin otra llamada al modelo.

    Cada cita documental se recupera del fragmento original. Se conservan los rechazos,
    incluso cuando la recuperación dirigida encuentra una cita mejor en la misma fuente.
    `supported` acredita una declaración documentada, no verdad física ni conformidad legal.
    """
    index = EvidenceIndex(sources, fragments)
    index.product = product or {}
    facts, rejections = {}, []
    recovered_ids = set()
    faces = defaultdict(set)
    for proposal in proposals:
        field = canonical_attribute(proposal.get('field', ''), proposal.get('label', ''))
        if field in ('custom:frase_superior', 'custom:frase_inferior'):
            for citation in proposal.get('evidence', []):
                faces[(citation.get('sourceId'), normalize_value(field, proposal['value'])[0])].add(field)
    for proposal in proposals:
        if not isinstance(proposal, dict) or not all(isinstance(proposal.get(k), str) and proposal[k].strip()
                                                    for k in ('field', 'label', 'value')):
            continue
        field = canonical_attribute(proposal['field'], proposal['label'])
        if field == 'custom:texto_impreso':
            possible = set().union(*(faces[(c.get('sourceId'), normalize_value(field, proposal['value'])[0])]
                                     for c in proposal.get('evidence', [])))
            if len(possible) == 1:
                field = possible.pop()
        value_key, display, unit = normalize_value(field, proposal['value'])
        groups = defaultdict(list)
        recovery_sources = set()
        proposal_errors = set()
        for citation in proposal.get('evidence', []):
            if not isinstance(citation, dict):
                continue
            evaluated, error = _evaluate(proposal, field, citation, index)
            if error:
                proposal_errors.add(error)
                source_id = citation.get('sourceId')
                recovered = None
                if source_id not in recovery_sources and error not in ('source_missing', 'source_version_changed', 'missing_value', 'input_context'):
                    recovery_sources.add(source_id)
                    recovered = index.recover(source_id, field, proposal['label'], proposal['value'], citation.get('locator'))
                rejections.append(_rejection(proposal, citation, error, bool(recovered)))
                if recovered:
                    evaluated, recovery_error = _evaluate(proposal, field, recovered, index)
                    if evaluated and not recovery_error:
                        evaluated[0]['recovered'] = True
                if not evaluated:
                    continue
            entry, channel, claim, scope, support, reason = evaluated
            # Un GTIN escrito en una fuente no acredita que su codificación sea válida.
            if field == 'custom:ean_gtin_13' and not valid_gtin(value_key):
                support, reason = 'needs_review', 'invalid_gtin'
            record = citation_record(entry, support, reason)
            if record.get('recovered'):
                recovered_ids.add(record['citationId'])
            groups[(channel, claim, scope)].append((record, support, reason))
        if not groups:
            # No se pierde la propuesta original; se aísla y se impide prefijarla en preguntas.
            channel, claim, scope = 'product', 'declared', 'product'
            for citation in proposal.get('evidence', []):
                entry, error = index.verify(citation)
                if not error:
                    context = '' if entry.get('visual') else index.context(entry)
                    channel, claim, scope = classify(field, proposal['label'], proposal['value'], entry,
                                                     index.sources[entry['sourceId']], context, index.product)
                    break
            groups[(channel, claim, scope)] = []
        for (channel, claim, scope), entries in groups.items():
            support = max((e[1] for e in entries), key=SUPPORT_RANK.get, default='unsupported')
            reasons = list({e[2]: _reason(e[2]) for e in entries if e[2]}.values())
            if not entries:
                reasons = [_reason(code) for code in sorted(proposal_errors)] or [_reason('value_not_supported')]
            fact = _fact(proposal, field, value_key, display, unit, channel, claim, scope,
                         list({e[0]['citationId']: e[0] for e in entries}.values()), support, reasons)
            if fact['id'] in facts:
                _merge(facts[fact['id']], fact)
            else:
                facts[fact['id']] = fact
    result = _merge_symbol_details(list(facts.values()))
    suppress_redundant_observations(result)
    # Una observación visual duplicada no genera otra pregunta cuando ya existe el dato documental.
    supported = {(f['canonicalField'], f['normalizedValue'], f['scope']) for f in result
                 if f['supportStatus'] == 'supported' and f['channel'] == 'product' and f['claimType'] == 'declared'}
    for fact in result:
        if (fact['claimType'] == 'visual_observation' or
                (fact['claimType'] == 'nominal' and fact['canonicalField'] in {
                    'name', 'brand', 'custom:modelo', 'custom:material', 'custom:edad_minima',
                    'custom:ean_gtin_13', 'custom:fabricante', 'custom:persona_responsable',
                    'custom:pais_fabricacion', 'custom:lote'})) and (fact['canonicalField'], fact['normalizedValue'], fact['scope']) in supported:
            fact['reviewable'] = False
            fact['supportReason'] += ' El mismo valor ya dispone de evidencia documental; no se repite la pregunta.'
        if (fact['canonicalField'] == 'name' and fact['scope'] == 'product'
                and fact['claimType'] == 'visual_observation' and (product or {}).get('name')
                and fact['normalizedValue'] == normalize_value('name', product['name'])[0]):
            fact['reviewable'] = False
            fact['supportReason'] += ' Coincide con el nombre ya guardado; se conserva la observación sin repetir la decisión.'
        fact['evidence'].sort(key=lambda e: (e['sourceId'], e['locator'], e['citationId']))
    # Conservar diferencias históricas sin reabrir preguntas ya resueltas por el cliente.
    groups = defaultdict(list)
    for fact in result:
        if fact['supportStatus'] != 'unsupported':
            groups[(fact['canonicalField'], fact['scope'], fact['claimType'], fact['channel'])].append(fact)
    conflict_groups = 0
    for key, values in groups.items():
        resolved_visual = key[2] == 'visual_observation' and not any(f['reviewable'] for f in values)
        if len({(f['normalizedValue'], f['unit']) for f in values}) > 1 and not resolved_visual:
            conflict_groups += 1
            group_id = stable_id('conflict_', *key)
            for fact in values:
                fact.update(conflict=True, conflictGroup=group_id)
    unique_rejections = list({r['id']: r for r in rejections}.values())
    summary = {'rawProposalCount': len(proposals), 'factCount': len(result),
               'supportedCount': sum(f['supportStatus'] == 'supported' for f in result),
               'needsReviewCount': sum(f['supportStatus'] == 'needs_review' for f in result),
               'unsupportedCount': sum(f['supportStatus'] == 'unsupported' for f in result),
               'reviewableCount': sum(f['reviewable'] for f in result), 'conflictCount': conflict_groups,
               'rejectionCount': len(unique_rejections), 'recoveredCitationCount': len(recovered_ids),
               'mergedProposalCount': sum(max(0, len(f['sourceProposalIds']) - 1) for f in result),
               'channels': dict(Counter(f['channel'] for f in result))}
    return {'version': VERSION, 'proposals': result, 'rejections': unique_rejections, 'summary': summary}
