"""Contrato de salida reanalizable sin repetir una llamada pagada al modelo."""
from copy import deepcopy
import json
import math
from .google_cloud_provider import CloudError

BASES = ('direct_document', 'visible_property', 'functional_reasoning', 'confirmed_value')
STATES = ('inferred', 'unknown', 'conflict', 'needs_evidence')
RESOLUTIONS = ('supported', 'unknown', 'conflict', 'needs_evidence')


def invalid(reason, **stats):
    error = CloudError('invalid_response')
    error.diagnostics = {'validationReason': reason, **stats}
    raise error


def collection(data, key):
    if not isinstance(data, dict): invalid('output_not_object')
    if key not in data: invalid('output_collection_missing')
    if not isinstance(data[key], list): invalid('output_collection_type')
    return data[key]


def scalar(value):
    return (isinstance(value, (str, int, float, bool)) and
            not (isinstance(value, float) and not math.isfinite(value)))


def decode_wire_response(data, verification):
    if verification: return deepcopy(data)
    collection(data, 'decisions')
    decoded = deepcopy(data)
    for index, item in enumerate(decoded['decisions']):
        if not isinstance(item, dict): invalid('item_not_object', itemIndex=index)
        if not isinstance(item.get('valueJson'), str): invalid('value_json_missing', itemIndex=index)
        try:
            value = json.loads(item.pop('valueJson'))
        except (ValueError, TypeError):
            invalid('value_json_invalid', itemIndex=index)
        if value is not None and not scalar(value): invalid('value_not_scalar', itemIndex=index)
        if item.get('state') == 'inferred':
            if value is None: invalid('value_null_inferred', itemIndex=index)
            item['value'] = value
        elif value is not None:
            invalid('value_present_not_inferred', itemIndex=index)
    return decoded


def references(item, key, allowed, stats, prefix):
    refs = item.get(key, [] if key == 'requestedEvidenceRefs' else None)
    if not isinstance(refs, list): invalid(prefix + '_refs_type', **stats)
    count = 'requestedRefCount' if key == 'requestedEvidenceRefs' else 'evidenceRefCount'
    if len(refs) > 12: invalid(prefix + '_refs_limit' if prefix == 'requested' else 'evidence_refs_limit', **stats, **{count: len(refs)})
    if any(not isinstance(ref, str) for ref in refs): invalid(prefix + '_ref_type', **stats)
    if any(ref not in allowed for ref in refs): invalid(prefix + '_ref_unknown', **stats)


def validate_shape(data, context, verification):
    key = 'verdicts' if verification else 'decisions'
    items = collection(data, key)
    targets = {target['id']: target for target in context['targets']}
    target_indexes = {target['id']: index for index, target in enumerate(context['targets'])}
    seen = set()
    counts = {'itemCount': len(items), 'expectedTargetCount': len(targets)}
    if len(items) > len(targets): invalid('too_many_items', **counts)
    evidence = {entry['id'] for entry in context.get('evidence', [])}
    omitted = {entry['id'] for entry in context.get('coverage', {}).get('omittedUnits', [])}
    for index, item in enumerate(items):
        stats = {**counts, 'itemIndex': index}
        if not isinstance(item, dict): invalid('item_not_object', **stats)
        target_id = item.get('targetId')
        if not isinstance(target_id, str): invalid('target_id_type', **stats)
        if target_id not in targets: invalid('target_id_unknown', **stats)
        stats['targetIndex'] = target_indexes[target_id]
        if target_id in seen: invalid('target_id_duplicate', **stats)
        seen.add(target_id)
        references(item, 'evidenceRefs', evidence, stats, 'evidence')
        needs_basis = item.get('accepted') is True if verification else item.get('state') == 'inferred'
        if not isinstance(item.get('basis'), str) or (needs_basis and item['basis'] not in BASES):
            invalid('basis_invalid', **stats)
        if not isinstance(item.get('reason'), str): invalid('reason_type', **stats)
        if len(item['reason']) > 3000: invalid('reason_limit', **stats)
        if verification:
            if any(not isinstance(item.get(k), bool) for k in ('accepted', 'productMatch', 'conflictsResolved', 'authorityConfirmed')):
                invalid('verification_boolean_type', **stats)
            if not isinstance(item.get('quote'), str): invalid('quote_type', **stats)
            if not isinstance(item.get('pixelTextVerified'), bool): invalid('pixel_verification_type', **stats)
            if item.get('resolution') not in RESOLUTIONS: invalid('resolution_invalid', **stats)
            references(item, 'requestedEvidenceRefs', omitted, stats, 'requested')
            supported = item['resolution'] == 'supported'
            if supported != item['accepted']: invalid('resolution_acceptance_mismatch', **stats)
            if supported and (not item['productMatch'] or not item['conflictsResolved'] or not item['evidenceRefs']):
                invalid('resolution_support_missing', **stats)
            requested = item.get('requestedEvidenceRefs', [])
            if (item['resolution'] == 'needs_evidence') != bool(requested):
                invalid('resolution_retrieval_mismatch', **stats)
        else:
            if item.get('state') not in STATES: invalid('state_invalid', **stats)
            references(item, 'requestedEvidenceRefs', omitted, stats, 'requested')
            if item['state'] == 'inferred':
                if 'value' not in item: invalid('value_missing', **stats)
                value = item['value']; kind = targets[target_id].get('type')
                valid_type = {'boolean': isinstance(value, bool), 'string': isinstance(value, str),
                    'integer': isinstance(value, int) and not isinstance(value, bool),
                    'number': isinstance(value, (int, float)) and not isinstance(value, bool)}
                if not scalar(value) or not valid_type.get(kind, True): invalid('value_type_invalid', **stats)
            elif 'value' in item:
                invalid('value_present_not_inferred', **stats)
    # La cola trata omisiones como incompletitud, nunca como dudas del cliente.
    return {key: items, 'unansweredTargetIds': sorted(set(targets) - seen)}


def validate_resolutions(result, proposal):
    decisions = {d['targetId']: d for d in proposal.get('decisions', [])}
    for index, verdict in enumerate(result['verdicts']):
        if verdict['resolution'] == 'supported' and decisions.get(verdict['targetId'], {}).get('state') != 'inferred':
            invalid('resolution_without_proposed_value', itemIndex=index)
