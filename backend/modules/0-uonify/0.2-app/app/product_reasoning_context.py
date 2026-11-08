"""Contexto multimodal reproducible: originales conservados, nunca resúmenes como prueba."""
from copy import deepcopy
import hashlib
import json
import re
import unicodedata
from .incident_fields import get_at
from .product_requirements_fields import evaluate, controls
from .product_requirements_mapping import scope_attributes
from .product_materials_evidence import EvidenceIndex, REFERENCE_NAMES, evidence_metadata

VERSION = 3
MAX_TEXT = 24000
MAX_TEXT_UNITS = 100
MAX_IMAGES = 8
MAX_IMAGE_BYTES = 14000000
MAX_TARGETS = 80


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str,
                                     separators=(',', ':')).encode()).hexdigest()


def words(value):
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()
    return set(re.findall(r'[a-z]{3,}', value))


def text_units(index, source_map, fact_refs, target_words):
    """One original JSON record per unit, retaining every original citation internally."""
    grouped = {}
    for sid, entries in index.by_source.items():
        source = source_map[sid]
        for entry in entries:
            content = index.context(entry)
            # Only the marker identifies the selected leaf. The following lines
            # already contain all siblings, their locators and any reservations.
            body = content.split('\n', 1)[1] if content.startswith('__locator__:') else content
            kind = 'ocr' if entry.get('method') == 'ocr' else 'barcode' if entry.get('method') == 'barcode' else 'text'
            key = (source.get('sha256') or sid, body, kind, bool(entry.get('observational')), bool(entry.get('formulaUncertain')))
            citation = {k: entry[k] for k in ('sourceId', 'sourceVersion', 'fragmentId', 'locator')}
            priority = (10 * ((sid, entry['locator']) in fact_refs) + len(target_words & words(body))
                + 20 * bool(words(source.get('name', '')) & {'ficha', 'manual', 'guia', 'guide', 'technical', 'instructions', 'instrucciones'})
                - 100 * source.get('name', '').lower().endswith('.blend')
                - 20 * bool(words(source.get('name', '')) & {'parametros', 'parameters'}))
            existing = grouped.get(key)
            if existing:
                existing['_aliases'].append(citation)
                existing['_priority'] = max(existing['_priority'], priority)
                if entry['locator'].endswith('.value') and not existing['locator'].endswith('.value'):
                    existing.update(citation, sourceName=source.get('name', ''), contextEvidence=index.context_citations(entry))
                continue
            grouped[key] = {**entry, 'id': 'e_' + digest(key)[:20], 'kind': kind,
                'sourceName': source.get('name', ''), 'text': body,
                'contextEvidence': index.context_citations(entry), '_aliases': [citation], '_priority': priority}
    return list(grouped.values())


def targets_for(schema, attributes, market):
    overview = evaluate(schema, attributes, market, human=False)
    targets, candidates = [], deepcopy(overview['candidate'])
    for attribute in overview['attributes']:
        if attribute['valid'] or not (attribute['required'] or attribute['present']):
            continue
        plan = evaluate(schema, attributes, market, attribute['id'], human=False)
        if attribute['id'] in plan['candidate']:
            candidates[attribute['id']] = deepcopy(plan['candidate'][attribute['id']])
        for field in plan['fields']:
            spec = plan['specs'][field['id']]
            # Una corrección de un valor ya presente corresponde al dueño, nunca al modelo.
            if get_at(attributes, spec['path']) is not None:
                continue
            node = controls(spec['schema'], schema, None)
            targets.append({'id': field['id'], 'path': spec['path'], 'type': spec['type'],
                            'label': field['label'], 'attributeLabel': attribute['label'],
                            'schema': deepcopy(spec['schema']), 'constraints': node, 'choices': deepcopy(spec.get('choices', {})),
                            'attributeDescription': schema['properties'][attribute['id']].get('description', '')})
    return targets, candidates, overview


def build_context(product, snapshot, material_job, sources, fragments, *, requested_evidence=None):
    requested_evidence = set(requested_evidence or [])
    schema = snapshot['schema']
    market = snapshot.get('marketplace_id', snapshot.get('marketplaceId'))
    attributes = scope_attributes(product.get('amazonAttributes', {}), market)
    targets, candidate, overview = targets_for(schema, attributes, market)
    job = (material_job or {}).get('result', material_job or {})
    facts = job.get('facts', {}).get('proposals', [])
    source_map = {str(s['id']): s for s in sources}
    eligible, excluded = [], []
    for fragment in fragments:
        payload = fragment.get('payload', fragment)
        sid = str(fragment.get('source_id', fragment.get('sourceId', payload.get('id', ''))))
        source = source_map.get(sid)
        reason = None
        if not source: reason = 'source_missing'
        elif fragment.get('state') in ('superseded', 'split'): reason = 'superseded'
        elif source.get('status') in ('error', 'source_changed', 'unreadable'): reason = 'source_unavailable'
        elif fragment.get('version') and source.get('version') and fragment['version'] != source['version']:
            reason = 'source_version_changed'
        elif REFERENCE_NAMES.search(unicodedata.normalize('NFKD', source.get('name', '') + ' ' + source.get('path', '')).encode('ascii', 'ignore').decode().lower()):
            reason = 'reference_source'
        if reason:
            excluded.append({'fragmentId': str(fragment.get('id', '')), 'reason': reason})
        else:
            eligible.append({**fragment, 'source_id': sid})
    index = EvidenceIndex(sources, eligible)
    images, seen = [], set()
    fact_refs = {(str(e.get('sourceId')), e.get('locator')) for fact in facts
                 if fact.get('scope') == 'product' and fact.get('channel') in ('product', 'safety')
                 for e in fact.get('evidence', [])}
    target_words = words(' '.join(t['label'] + ' ' + t['attributeLabel'] + ' ' + str(t['path'][0]) for t in targets))
    evidence = text_units(index, source_map, fact_refs, target_words)
    for fragment in eligible:
        payload = fragment.get('payload', fragment)
        inline = payload.get('inline')
        if not isinstance(inline, dict) or not isinstance(inline.get('data'), str): continue
        if inline.get('mimeType') not in ('image/jpeg', 'image/png', 'image/webp'): continue
        sid = fragment['source_id']; source = source_map[sid]
        locator = payload.get('visualLocator', 'Imagen')
        version = fragment.get('version') or source.get('version', source.get('sha256', ''))
        data_hash = hashlib.sha256(inline['data'].encode()).hexdigest()
        if ('pixel', data_hash) in seen: continue
        seen.add(('pixel', data_hash))
        images.append({'id': 'e_' + digest([sid, version, locator, data_hash])[:20], 'kind': 'image',
            'sourceId': sid, 'sourceVersion': version, 'fragmentId': str(fragment.get('id', '')),
            'sourceName': source.get('name', ''), 'locator': locator, 'inline': deepcopy(inline),
            'image': deepcopy(payload.get('image', {})), 'visual': deepcopy(payload.get('visual', {})),
            **evidence_metadata(payload), '_digest': data_hash,
            '_priority': 10 * ((sid, locator) in fact_refs) + 5 * bool(words(source.get('name', '')) &
                {'packaging', 'pack', 'caja', 'manual', 'guia', 'guide', 'technical', 'instructions', 'instrucciones'})
                + 10 * bool(words(source.get('name', '')) & {'contenido', 'contents', 'completo', 'complete', 'conjunto'})
                + (3 if payload.get('visual', {}).get('kind') == 'overview' else 0)})
    requested_fragments = {e['fragmentId'] for e in evidence if e['id'] in requested_evidence}
    evidence.sort(key=lambda e: (e['id'] not in requested_evidence, e['fragmentId'] not in requested_fragments, -e['_priority'], e['sourceId'], e['locator']))
    selected, omitted, total = [], [], 0
    for entry in evidence:
        length = len(entry['text'])
        entry.pop('_priority', None)
        if len(selected) < MAX_TEXT_UNITS and total + length <= MAX_TEXT:
            selected.append(entry); total += length
        else: omitted.append({'id': entry['id'], 'sourceId': entry['sourceId'], 'locator': entry['locator'], 'kind': entry['kind'], 'sourceName': entry['sourceName'], 'preview': entry['text'][:240]})
    # Diversidad de fuentes/vistas: primero una imagen por archivo; luego sus detalles.
    images.sort(key=lambda e: (e['id'] not in requested_evidence, -e['_priority'], e['sourceId'], e['locator']))
    first, rest, represented = [], [], set()
    for image in images:
        (rest if image['sourceId'] in represented else first).append(image)
        represented.add(image['sourceId'])
    image_bytes = 0; image_count = 0
    buckets = {}
    for image in first + rest:
        name = words(image['sourceName'])
        family = ('identity' if name & {'logo', 'logotipo', 'wordmark', 'icon', 'icono'} else
                  'document' if name & {'manual', 'guia', 'guide', 'instrucciones', 'instructions'} else
                  'packaging' if name & {'caja', 'pack', 'packaging', 'box', 'envase'} else
                  'component' if name & {'pieza', 'piezas', 'component', 'componente', 'components', 'detalle', 'detail'} else 'product')
        buckets.setdefault(family, []).append(image)
    ordered_images = []
    for i in range(len(images)):
        for family in ('document', 'component', 'product', 'packaging'):
            if i < len(buckets.get(family, [])): ordered_images.append(buckets[family][i])
    ordered_images += buckets.get('identity', [])
    ordered_images.sort(key=lambda e: e['id'] not in requested_evidence)
    for image in ordered_images:
        image.pop('_priority', None)
        size = len(image['inline']['data']) * 3 // 4
        if image_count < MAX_IMAGES and image_bytes + size <= MAX_IMAGE_BYTES:
            selected.append(image); image_bytes += size; image_count += 1
        else: omitted.append({'id': image['id'], 'sourceId': image['sourceId'], 'locator': image['locator'], 'kind': 'image', 'sourceName': image['sourceName']})
    protected = {'amazonAttributes': deepcopy(attributes),
        'customFields': [deepcopy(f) for f in product.get('customFields', []) if f.get('isConfirmed') is True],
        'product': {k: deepcopy(product[k]) for k in ('id', 'sku', 'name', 'brand', 'category', 'description', 'bullets', 'keywords', 'price', 'cost', 'stock') if k in product}}
    declared = [{'id': 'product:' + key, 'name': key, 'value': product[key], '_kind': 'product_value'}
                for key in ('price', 'cost', 'stock', 'name', 'brand', 'description', 'bullets', 'keywords')
                if product.get(key) not in (None, '', [])]
    for field in protected['customFields'] + declared:
        selected.append({'id': 'c_' + digest(field)[:20], 'kind': field.get('_kind', 'user_confirmed'),
                         'sourceId': 'product', 'sourceVersion': digest(field),
                         'locator': str(field.get('id', '')), 'text': str(field.get('name')) + ': ' + str(field.get('value')),
                         'field': deepcopy(field)})
    # Los hechos extraídos ayudan a buscar/comparar, pero conservan decisión, alcance y reservas.
    kept_refs = {(alias['sourceId'], alias['locator']): e['id'] for e in selected
                 for alias in e.get('_aliases', [e])}
    compact_facts = []
    for fact in facts:
        if fact.get('channel') == 'reference': continue
        item = {k: deepcopy(fact[k]) for k in ('id', 'field', 'label', 'value', 'unit', 'canonicalField', 'status',
                 'confirmedValue', 'confirmedField', 'scope', 'channel', 'claimType', 'conflict', 'supportStatus',
                 'supportReasons', 'supportReason', 'reviewDecision') if k in fact}
        item['evidenceRefs'] = list(dict.fromkeys(kept_refs[(str(e.get('sourceId')), e.get('locator'))]
                 for e in fact.get('evidence', []) if (str(e.get('sourceId')), e.get('locator')) in kept_refs))
        compact_facts.append(item)
    coverage = {'textCharacters': total, 'textUnits': sum(e['kind'] in ('text', 'ocr', 'barcode') for e in selected),
                'images': image_count, 'imageBytes': image_bytes,
                'selectedUnits': len(selected), 'omittedUnits': omitted, 'excludedFragments': excluded,
                'omittedTargets': [t['id'] for t in targets[MAX_TARGETS:]],
                'sourceCount': len(sources), 'originalReadingComplete': bool(job.get('discoveryComplete', True))
                and all(s.get('readComplete', True) for s in sources),
                'unrepresentedIssues': deepcopy(overview['issues']) if overview['needsReview'] else []}
    coverage['complete'] = not omitted and not excluded and not coverage['omittedTargets'] and coverage['originalReadingComplete']
    result = {'version': VERSION, 'productRevision': product['revision'], 'marketplaceId': market,
        'schemaHash': snapshot.get('metadata', {}).get('schemaHash') or digest(schema),
        'productType': snapshot.get('product_type', ''), 'targets': targets[:MAX_TARGETS], 'facts': compact_facts,
        'evidence': selected, 'coverage': coverage, 'protected': protected, 'candidate': candidate,
        'validationSchema': deepcopy(schema)}
    # Todos los inputs cuentan para invalidar caché, incluso unidades omitidas y decisiones rechazadas.
    result['fingerprint'] = digest({'version': VERSION, 'product': protected, 'schema': result['schemaHash'],
        'market': market, 'facts': compact_facts, 'sources': sorted((str(s['id']), s.get('version', ''), s.get('sha256', '')) for s in sources),
        'fragments': sorted((str(f.get('id')), f.get('version'), digest(f.get('payload', f))) for f in fragments),
        'coverage': coverage, 'requestedEvidence': sorted(requested_evidence), 'promptVersion': VERSION})
    return result
