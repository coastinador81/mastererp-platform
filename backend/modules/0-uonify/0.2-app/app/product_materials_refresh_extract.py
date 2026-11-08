"""Local, deterministic extraction of an explicitly replaced structured product sheet."""
from copy import deepcopy
from hashlib import sha256
import json
import re
from .drive_segments import EXTRACTOR_VERSION
from .drive_extract import ExtractionError
from .drive_extract_process import extract_isolated
from .product_materials_pipeline import source_version
from .product_materials_fields import canonical_attribute
from .product_materials_evidence import stable_id

VERSION = 'structured-source-refresh-v1'
FIELD_PATH = re.compile(r'^\$\.fields\[(\d+)\]\.([a-z_]+)$')
RECORD_KEYS = ('id', 'label', 'value', 'unit', 'status', 'note', 'section')


def segment_map(fragments):
    result = {}
    for fragment in fragments:
        if fragment.get('state') in ('superseded', 'split'):
            continue
        for segment in fragment.get('payload', fragment).get('segments', []):
            if segment.get('locator', '').startswith('$'):
                key = segment['locator']
                if key in result and result[key] != segment['text']:
                    raise ExtractionError('La fuente conserva dos valores distintos para una misma ruta.')
                result[key] = segment['text']
    return result


def records(segments):
    indexed = {}
    for path, text in segments.items():
        match = FIELD_PATH.fullmatch(path)
        if not match or match[2] not in RECORD_KEYS:
            continue
        try:
            value = json.loads(text)
        except ValueError as error:
            raise ExtractionError('Un campo estructurado está dividido o no es válido.') from error
        indexed.setdefault(int(match[1]), {'index': int(match[1])})[match[2]] = value
    result = {}
    for record in indexed.values():
        identifier = record.get('id')
        if not isinstance(identifier, str) or not identifier or identifier in result:
            raise ExtractionError('Cada campo de la ficha debe conservar un identificador único.')
        result[identifier] = record
    return result


def changes(old, new):
    return [{'path': path, 'before': old.get(path), 'after': new.get(path)}
            for path in sorted(set(old) | set(new)) if old.get(path) != new.get(path)]


def prepare_replacement(source, previous, replacement, authorization, *, extract=extract_isolated):
    """Read bytes, compare every JSON leaf, and extract only authorized field records.

    Non-structured derivatives are read completely but never labelled AI-reviewed.
    Their human-declared relationship is separate from the actual extraction.
    """
    extraction = extract(replacement['content'], replacement['mimeType'], replacement['name'])
    if extraction.get('sha256') != sha256(replacement['content']).hexdigest() or extraction.get('bytes') != len(replacement['content']):
        raise ExtractionError('La extracción no corresponde a los bytes de la nueva fuente.')
    if extraction.get('truncated') or not extraction.get('coverage', {}).get('complete'):
        raise ExtractionError('La fuente nueva no pudo leerse completa; se conserva la versión anterior.')
    metadata = replacement['metadata']
    version = source_version(metadata) + ':' + extraction['sha256']
    new_source = {**source, **{k: metadata[k] for k in ('id', 'name', 'mimeType', 'modifiedTime', 'size') if k in metadata},
        'version': version, 'sha256': extraction['sha256'], 'bytes': extraction['bytes'],
        'readComplete': True, 'status': 'read', 'truncated': False, 'readerVersion': EXTRACTOR_VERSION,
        'readingCoverage': extraction['coverage'], 'warnings': extraction.get('warnings', []),
        'semanticStatus': 'extraction_only', 'refreshMethod': VERSION}
    for key in ('reason', 'changed', 'pendingReaderUpgrade', 'repairEvidence'):
        new_source.pop(key, None)
    if 'readerMetadata' in extraction:
        new_source['readerMetadata'] = extraction['readerMetadata']
    new_parts = []
    for part in extraction['fragments']:
        identifier = sha256((source['id'] + ':' + version + ':' + VERSION + ':' + part['key']).encode()).hexdigest()
        new_parts.append({'id': identifier, 'source_id': source['id'], 'version': version,
            'locator': part.get('visualLocator') or (part.get('segments') or [{}])[0].get('locator', 'Archivo'),
            'state': 'partial', 'payload': {**part, 'id': source['id'], 'name': new_source['name'], 'readerVersion': EXTRACTOR_VERSION},
            'result': {'extractionOnly': True, 'analysisMethod': VERSION, 'observations': {
                source['id']: 'Versión nueva leída localmente. Solo se extraen los campos estructurados autorizados; no se ha realizado otro análisis semántico.'}}})
    old_map, new_map = segment_map(previous), segment_map(new_parts)
    old_records, new_records = records(old_map), records(new_map)
    delta = changes(old_map, new_map)
    authorized = set(authorization['fieldIds'])
    changed_ids = {key for key in set(old_records) | set(new_records)
                   if {k: old_records.get(key, {}).get(k) for k in RECORD_KEYS} !=
                      {k: new_records.get(key, {}).get(k) for k in RECORD_KEYS}}
    unsupported = changed_ids - authorized
    if unsupported:
        raise ExtractionError('La ficha cambia campos que no pertenecen a esta corrección autorizada.')
    if any(key not in old_records or key not in new_records for key in changed_ids):
        raise ExtractionError('La sustitución debe conservar los identificadores de los campos existentes.')
    prefixes = tuple(replacement.get('allowedMetadataPaths', []))
    indices = {row['index'] for key, row in old_records.items() if key in authorized} | {
        row['index'] for key, row in new_records.items() if key in authorized}
    def allowed(path):
        match = re.match(r'^\$\.fields\[(\d+)\](?:\.|$)', path)
        return bool(match and int(match[1]) in indices) or any(
            path == prefix or path.startswith(prefix + '.') or path.startswith(prefix + '[') for prefix in prefixes)
    unscoped = [item['path'] for item in delta if not allowed(item['path'])]
    structured = bool(old_records and new_records)
    candidates = []
    for field_id in sorted(changed_ids):
        record = new_records[field_id]
        value, label = record.get('value'), record.get('label')
        if isinstance(value, bool) or not isinstance(value, (str, int, float)) or not isinstance(label, str) or not label.strip():
            continue
        locator = f"$.fields[{record['index']}].value"
        value_text = str(value).strip()
        if not value_text:
            continue
        unit = record.get('unit')
        if isinstance(unit, str) and unit.strip():
            value_text += ' ' + unit.strip()
        candidates.append({'id': stable_id('refresh_', source['id'], version, field_id),
            'field': canonical_attribute('', label), 'label': label, 'value': value_text,
            'status': 'proposed', 'origin': 'documentary_refresh', 'structuredFieldId': field_id,
            'evidence': [{'sourceId': source['id'], 'sourceVersion': version,
                          'locator': locator, 'excerpt': new_map[locator]}]})
    if structured:
        new_source['semanticStatus'] = 'structured_fields_refreshed'
        for fragment in new_parts:
            locators = {s['locator'] for s in fragment['payload'].get('segments', [])}
            selected = [deepcopy(p) for p in candidates if p['evidence'][0]['locator'] in locators]
            fragment['result'].update(candidates=selected, proposals=selected)
    canonical = sorted({canonical_attribute('', row['label']) for key in changed_ids
                        for row in (old_records[key], new_records[key]) if isinstance(row.get('label'), str)})
    primary_equivalence = replacement.get('equivalence') or {}
    new_source['declaredEquivalence'] = deepcopy(primary_equivalence)
    return {'source': new_source, 'fragments': new_parts, 'candidates': candidates,
        'changedFieldIds': sorted(changed_ids), 'changedCanonicalFields': canonical,
        'changedPaths': delta, 'unscopedPaths': unscoped,
        'previousRecords': {key: old_records[key] for key in changed_ids},
        'changedRecordPrefixes': [f"$.fields[{old_records[key]['index']}]" for key in changed_ids],
        'structured': structured, 'continuitySafe': bool(not unscoped and (structured or primary_equivalence))}
