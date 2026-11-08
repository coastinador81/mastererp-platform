"""Narrow continuity after an audited, owner-authorized documentary correction."""
from copy import deepcopy
from .product_reasoning_continuity import (CORE_KEYS, OFFER_ATTRIBUTES, CONTINUITY_VERSION,
    dependency_closure, reviewed, scope_matches, versions, commercial_value)
from .product_requirements_mapping import scope_attributes
from .product_requirements_suggestions import quantity, normalized
from .product_materials_dimensions import dimension_key

DIMENSIONS = frozenset({'item_length_width', 'item_dimensions', 'item_package_dimensions'})


def independent_refreshed_targets(before, after, snapshot, previous, current, changes):
    """The audit permits exact field replacements, never unrelated identity changes."""
    if any(before.get(k) != after.get(k) for k in CORE_KEYS if k != 'customFields'):
        return set()
    old_fields, new_fields = before.get('customFields', []), after.get('customFields', [])
    if [f.get('id') for f in old_fields] != [f.get('id') for f in new_fields]: return set()
    for change in changes:
        prior, final = change.get('before', {}), change.get('after', {})
        label = normalized(final.get('name', ''))
        physical = dimension_key(final.get('name', '')) or label in {
            'pieza largo', 'pieza ancho', 'pieza alto', 'component length', 'component width', 'component height'}
        measure = quantity(str(final.get('value', '')), final.get('name', ''))
        if (not physical or not measure or measure[1] not in ('millimeters', 'centimeters', 'meters')
            or any(prior.get(k) != final.get(k) for k in set(prior) | set(final) if k not in ('name', 'value', 'isConfirmed'))):
            return set()
    permitted = {change['id']: change for change in changes}
    for old, new in zip(old_fields, new_fields):
        if old == new: continue
        change = permitted.get(old.get('id'))
        if not change or change.get('before') != old or change.get('after') != new: return set()
    market = snapshot['marketplace_id']
    old, new = (scope_attributes(p.get('amazonAttributes', {}), market) for p in (before, after))
    changed = {key for key in set(old) | set(new) if old.get(key) != new.get(key)}
    if changed - DIMENSIONS - OFFER_ATTRIBUTES: return set()
    # Never accept replacement of a previous Amazon value as a source refresh.
    def retains(a, b):
        if isinstance(a, dict): return isinstance(b, dict) and all(k in b and retains(v, b[k]) for k, v in a.items())
        if isinstance(a, list): return isinstance(b, list) and len(a) <= len(b) and all(retains(v, b[i]) for i, v in enumerate(a))
        return a == b
    if any(not retains(old[key], new.get(key)) for key in changed & DIMENSIONS if key in old): return set()
    changed |= DIMENSIONS
    if any(commercial_value(before.get(k)) != commercial_value(after.get(k)) for k in ('price', 'cost')): changed |= {'list_price', 'purchasable_offer'}
    if commercial_value(before.get('stock')) != commercial_value(after.get('stock')): changed.add('fulfillment_availability')
    affected = dependency_closure(snapshot['schema'], changed, old, new)
    previous = {t['id']: t for t in previous}
    keys = ('path', 'type', 'schema', 'constraints', 'choices')
    return {t['id'] for t in current if t['id'] in previous and t['path'][0] not in affected
            and all(t.get(k) == previous[t['id']].get(k) for k in keys)}


def select_refresh_plan(service, c, user, product, snapshot, job, context):
    """Verify the old paid context using its exact retained originals, not new versions."""
    from .product_reasoning import digest, material_signature, product_signature
    marker = job.get('sourceRefresh', {})
    if not marker.get('continuitySafe') or marker.get('version') != 1: return context
    row = c.execute('''SELECT * FROM product_material_refreshes WHERE user_id=%s AND product_id=%s
        AND job_id=%s AND request_id=%s AND google_subject=%s''',
        (user['id'], product['id'], job['id'], marker['requestId'], user['google_subject'])).fetchone()
    if not row: return context
    manifest = row['manifest']
    summary = row['summary']
    if (summary.get('currentMaterialSignature') != material_signature(job)
        or summary.get('previousMaterialSignature') != marker.get('previousMaterialSignature')
        or not summary.get('continuitySafe') or manifest.get('version') != 1): return context
    changes = manifest.get('productFieldChanges', [])
    if not changes or not manifest.get('sourcesBefore') or 'fragmentsBefore' not in manifest: return context
    previous_job = {**row['result_before'], 'id': job['id'], 'status': 'ready'}
    if material_signature(previous_job) != summary.get('previousMaterialSignature'): return context
    if manifest.get('selectiveSnapshots'):
        replaced = {s['id'] for s in manifest['sourcesBefore']}
        current_sources = [r['data'] for r in c.execute('SELECT data FROM product_material_sources WHERE job_id=%s', (job['id'],)).fetchall()]
        expected_sources = {s['id']: s for s in manifest.get('sourcesAfter', [])}
        if {s['id'] for s in current_sources if s['id'] in replaced} != replaced or set(expected_sources) != replaced: return context
        if any(expected_sources.get(s['id']) != s for s in current_sources if s['id'] in replaced): return context
        sources = [s for s in current_sources if s['id'] not in replaced] + manifest['sourcesBefore']
        previous_states = {str(f['id']): f for f in manifest['fragmentsBefore']}
        fragments, new_hashes = [], {}
        for fragment in c.execute('SELECT * FROM product_material_fragments WHERE job_id=%s', (job['id'],)).fetchall():
            old = previous_states.get(str(fragment['id']))
            if old:
                if old['version'] != fragment['version'] or old['source_id'] != fragment['source_id']: return context
                fragments.append({**fragment, 'state': old['state']})
            elif fragment['source_id'] not in replaced:
                fragments.append(fragment)
            elif fragment['state'] not in ('superseded', 'split'):
                new_hashes[str(fragment['id'])] = digest({k: fragment[k] for k in ('id', 'source_id', 'version', 'state', 'payload', 'result')})
        if set(previous_states) - {str(f['id']) for f in fragments}: return context
        if manifest.get('newFragmentHashes') != new_hashes: return context
    else:
        sources, fragments = manifest['sourcesBefore'], manifest['fragmentsBefore']
    sources = sorted(sources, key=lambda s: str(s['id']))
    fragments = sorted((f for f in fragments if f.get('state') not in ('split', 'superseded')), key=lambda f: str(f['id']))
    candidates = c.execute('''SELECT * FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s
        AND google_subject=%s AND schema_hash=%s AND status='completed' ORDER BY updated_at DESC''',
        (user['id'], product['id'], user['google_subject'], snapshot['metadata']['schemaHash'])).fetchall()
    for prior in candidates:
        prior_context = prior['context']
        if (not reviewed(prior) or not scope_matches(prior_context, snapshot)
            or prior_context.get('_policy') != context.get('_policy')
            or prior_context.get('_materialSignature') != summary['previousMaterialSignature']): continue
        revision = prior['applied_revision'] or prior['revision']
        stored = c.execute('SELECT data FROM product_revisions WHERE user_id=%s AND product_id=%s AND revision=%s',
            (user['id'], product['id'], revision)).fetchone()
        if not stored: continue
        before = {**stored['data'], 'id': product['id'], 'sku': product['sku'], 'revision': revision}
        if product_signature(before) != (prior['output_signature'] or prior['product_signature']): continue
        requested = None if prior['result'].get('outputContextFingerprint') else prior['result'].get('requestedEvidence')
        historical = service.context_from_records(before, snapshot, previous_job, sources, fragments, requested)
        expected = prior['result'].get('outputContextFingerprint', prior_context['fingerprint'])
        from .product_reasoning_continuity import apply_plan
        checked = apply_plan(historical, before, snapshot, prior_context['_continuity']) if prior_context.get('_continuity') else historical
        if checked['fingerprint'] != expected: continue
        allowed = independent_refreshed_targets(before, product, snapshot, historical['targets'], context['targets'], changes)
        resolutions = {key: deepcopy(value) for key, value in prior['result'].get('resolutions', {}).items()
            if key in allowed and key in prior['result'].get('reviewedTargetIds', [])
            and value.get('resolution') in ('unknown', 'conflict') and value.get('reason')}
        if not resolutions: continue
        full = deepcopy(context['targets']); context = deepcopy(context)
        context['_fullFingerprint'] = context['fingerprint']
        context['_continuity'] = {'version': CONTINUITY_VERSION, 'sourceJobId': str(prior['id']),
            'sourceRefreshId': marker['requestId'], 'product': before, 'targets': historical['targets'],
            'currentTargets': full, 'resolutions': resolutions, 'reusedTargetIds': sorted(resolutions), **versions()}
        context['targets'] = [t for t in full if t['id'] not in resolutions]
        context['coverage']['omittedTargets'] = [key for key in context['coverage'].get('omittedTargets', []) if key not in resolutions]
        context['fingerprint'] = digest({'full': context['_fullFingerprint'], 'refresh': marker['requestId'],
            'continuity': CONTINUITY_VERSION, 'parent': str(prior['id']), 'reused': sorted(resolutions)})
        return context
    return context
