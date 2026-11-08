"""Reuse reviewed outcomes across independent answers, without modifying source facts."""
from copy import deepcopy
from .product_requirements_mapping import scope_attributes
from .product_reasoning_dependencies import dependency_closure

CONTINUITY_VERSION = 2
# Offer data does not redefine the physical product. Any other changed attribute
# invalidates semantic reasoning conservatively; PTD dependencies still apply here.
OFFER_ATTRIBUTES = frozenset({'condition_type', 'condition_note', 'list_price', 'purchasable_offer',
    'fulfillment_availability', 'merchant_shipping_group', 'merchant_release_date',
    'maximum_order_quantity', 'minimum_order_quantity', 'handling_time', 'restock_date'})
# A customer's regulatory declaration does not determine the marketing audience
# or reference price. Other unresolved facts stay conservative; actual PTD branch
# changes can still invalidate either of these two independently reviewed fields.
ANSWER_DECLARATIONS = frozenset({'supplier_declared_dg_hz_regulation'})
DECLARATION_INDEPENDENT = frozenset({'list_price', 'target_audience_keyword'})
CORE_KEYS = ('id', 'sku', 'name', 'brand', 'category', 'description', 'bullets', 'keywords',
             'customFields', 'amazonRequirementsContext')


def commercial_value(value):
    """Empty form answers and database null both mean no commercial datum supplied."""
    return None if value is None or isinstance(value, str) and not value.strip() else value


def versions():
    from .product_reasoning_provider import VERIFY_VERSION
    from .product_reasoning_reconciliation import VALIDATION_RESOLUTION_VERSION
    return {'verificationContractVersion': VERIFY_VERSION,
            'validationResolutionVersion': VALIDATION_RESOLUTION_VERSION}


def requirements_scope(snapshot):
    return {'seller': snapshot['seller_id'], 'market': snapshot['marketplace_id'], 'type': snapshot['product_type'],
        **{key: snapshot['metadata'].get(key) for key in ('requirements', 'requirementsEnforced', 'locale')}}


def scope_matches(context, snapshot):
    current = requirements_scope(snapshot)
    if context.get('_requirementsScope') is not None:
        return context['_requirementsScope'] == current
    # Historical jobs predate this marker. The configuring route supported only
    # this fixed request; seller/market/type are also checked against saved product context.
    return all(current[key] == value for key, value in
               {'requirements': 'LISTING', 'requirementsEnforced': 'ENFORCED', 'locale': 'es_ES'}.items())


def reviewed(row):
    result = row['result']
    return (row['status'] == 'completed' and not result.get('error') and not result.get('rejectedTargetIds')
            and all(result.get(key) == value for key, value in versions().items()))


def measurement_family(attribute):
    # Physical quantity answers can affect related quantities (e.g. weight units,
    # shipping weight or dimensional weight), but not unrelated product facts.
    if any(part in attribute.split('_') for part in ('weight', 'dimensions', 'length', 'width', 'height', 'depth', 'diameter')):
        return 'measurement'
    return None


def answered_independent_attributes(c, user, product, before, result, targets):
    rows = c.execute("""SELECT revision,data,source FROM product_revisions WHERE user_id=%s AND product_id=%s
        AND revision>%s AND revision<=%s ORDER BY revision""",
        (user['id'], product['id'], before['revision'], product['revision'])).fetchall()
    allowed = set(); previous = before
    reviewed_attributes = {t['path'][0] for t in targets
        if result.get('resolutions', {}).get(t['id'], {}).get('resolution') in ('unknown', 'conflict')}
    for row in rows:
        old, new = previous.get('amazonAttributes', {}), row['data'].get('amazonAttributes', {})
        changed = {key for key in set(old) | set(new) if old.get(key) != new.get(key)}
        for key in changed - OFFER_ATTRIBUTES:
            if (row['source'] != 'amazon-requirements-answer' or key not in reviewed_attributes
                or not (measurement_family(key) or key in ANSWER_DECLARATIONS)):
                return set()
            allowed.add(key)
        previous = row['data']
    return allowed


def independent_targets(before, after, snapshot, previous_targets, current_targets, answer_attributes=()):
    if any(before.get(key) != after.get(key) for key in CORE_KEYS): return set()
    market = snapshot['marketplace_id']
    old = scope_attributes(before.get('amazonAttributes', {}), market)
    new = scope_attributes(after.get('amazonAttributes', {}), market)
    changed = {key for key in set(old) | set(new) if old.get(key) != new.get(key)}
    if changed - OFFER_ATTRIBUTES - set(answer_attributes): return set()
    related = set()
    for key in changed & set(answer_attributes):
        family = measurement_family(key)
        if family:
            related.update(name for name in snapshot['schema'].get('properties', {}) if measurement_family(name) == family)
        elif key in ANSWER_DECLARATIONS:
            related.update(set(snapshot['schema'].get('properties', {})) - DECLARATION_INDEPENDENT)
    changed |= related
    if any(commercial_value(before.get(key)) != commercial_value(after.get(key)) for key in ('price', 'cost')):
        changed |= {'list_price', 'purchasable_offer'}
    if commercial_value(before.get('stock')) != commercial_value(after.get('stock')): changed.add('fulfillment_availability')
    affected = dependency_closure(snapshot['schema'], changed, old, new)
    previous = {target['id']: target for target in previous_targets}
    keys = ('path', 'type', 'schema', 'constraints', 'choices')
    return {target['id'] for target in current_targets if target['id'] in previous
            and target['path'][0] not in affected
            and all(target.get(key) == previous[target['id']].get(key) for key in keys)}


def apply_plan(context, product, snapshot, plan):
    from .product_reasoning import digest
    if plan.get('version') != CONTINUITY_VERSION or any(plan.get(k) != v for k, v in versions().items()): return context
    allowed = independent_targets(plan['product'], product, snapshot, plan['targets'], context['targets'], plan.get('answerAttributes', []))
    inherited = {key: value for key, value in plan['resolutions'].items() if key in allowed}
    if not inherited: return context
    full_targets = deepcopy(context['targets'])
    context = deepcopy(context)
    context['_continuity'] = deepcopy(plan)
    context['_continuity']['resolutions'] = inherited
    context['_continuity']['reusedTargetIds'] = sorted(inherited)
    context['_continuity']['currentTargets'] = full_targets
    context['_fullFingerprint'] = context['fingerprint']
    context['targets'] = [target for target in full_targets if target['id'] not in inherited]
    context['coverage']['omittedTargets'] = [key for key in context['coverage'].get('omittedTargets', []) if key not in inherited]
    context['fingerprint'] = digest({'full': context['_fullFingerprint'], 'continuity': CONTINUITY_VERSION,
                                   'parent': plan['sourceJobId'], 'reused': sorted(inherited)})
    return context


def restore_plan(c, user, product, snapshot, context, rebuild):
    """Freeze a continuation's lineage on re-entry and while its worker saves."""
    from .product_reasoning import product_signature
    signature = product_signature(product)
    rows = c.execute("""SELECT * FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s
        AND context ? '_continuity' AND (product_signature=%s OR output_signature=%s OR status='running')
        ORDER BY (product_signature=%s OR output_signature=%s) DESC NULLS LAST,updated_at DESC""",
        (user['id'], product['id'], signature, signature, signature, signature)).fetchall()
    for row in rows:
        if (row['google_subject'] != user['google_subject'] or row['schema_hash'] != snapshot['metadata']['schemaHash']
            or not scope_matches(row['context'], snapshot)
            or row['context'].get('_policy') != context.get('_policy')
            or row['context'].get('_materialSignature') != context.get('_materialSignature')): continue
        plan = row['context']['_continuity']
        if plan.get('version') != CONTINUITY_VERSION: continue
        if any(row['result'].get(k) != v for k, v in versions().items()): continue
        if rebuild(plan['product'], plan.get('requestedEvidence'))['fingerprint'] != plan.get('sourceFingerprint'): continue
        return apply_plan(context, product, snapshot, plan)
    return context


def select_plan(c, user, product, snapshot, context, rebuild, rebuild_refreshed=None):
    """Find the last completed compatible review, even behind a newer failed job."""
    from .product_reasoning import product_signature
    if context.get('_continuity'): return context
    rows = c.execute("""SELECT * FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s
        AND status='completed' AND google_subject=%s AND schema_hash=%s ORDER BY updated_at DESC,created_at DESC""",
        (user['id'], product['id'], user['google_subject'], snapshot['metadata']['schemaHash'])).fetchall()
    for row in rows:
        if not reviewed(row): continue
        prior_context = row['context']
        if (not scope_matches(prior_context, snapshot) or prior_context.get('_policy') != context.get('_policy')
            or prior_context.get('_materialSignature') != context.get('_materialSignature')
            or prior_context.get('marketplaceId') != context.get('marketplaceId')
            or prior_context.get('productType') != context.get('productType')): continue
        revision = row['applied_revision'] or row['revision']
        stored = c.execute('SELECT data FROM product_revisions WHERE user_id=%s AND product_id=%s AND revision=%s',
                           (user['id'], product['id'], revision)).fetchone()
        if not stored: continue
        before = {**stored['data'], 'id': product['id'], 'sku': stored['data'].get('sku', product['sku']), 'revision': revision}
        if product_signature(before) != (row['output_signature'] or row['product_signature']): continue
        # Rebuild the historical context against CURRENT originals. Matching its
        # stored output fingerprint checks even unselected fragments and fact decisions.
        requested = None if row['result'].get('outputContextFingerprint') else row['result'].get('requestedEvidence')
        historical = rebuild(before, requested)
        expected = row['result'].get('outputContextFingerprint', prior_context['fingerprint'])
        plan = prior_context.get('_continuity')
        # A documentary refresh has its own audited lineage and fingerprint. Its
        # pre-refresh product is intentionally different from the completed one.
        # Revalidate that audit against current originals before anchoring later
        # answers on the already-refreshed revision. Never trust a marker alone.
        if plan and plan.get('sourceRefreshId'):
            if rebuild_refreshed is None: continue
            checked = rebuild_refreshed(before, requested)
        else:
            checked = apply_plan(historical, before, snapshot, plan) if plan else historical
        if checked['fingerprint'] != expected: continue
        if product_signature(before) == product_signature(product): return context
        answer_attributes = answered_independent_attributes(c, user, product, before, row['result'], historical['targets'])
        ids = independent_targets(before, product, snapshot, historical['targets'], context['targets'], answer_attributes)
        resolutions = {key: deepcopy(value) for key, value in row['result'].get('resolutions', {}).items()
                       if key in ids and key in row['result'].get('reviewedTargetIds', [])
                       and value.get('resolution') in ('unknown', 'conflict') and value.get('reason')}
        if not resolutions: continue
        plan = {'version': CONTINUITY_VERSION, 'sourceJobId': str(row['id']), 'product': before,
                'targets': historical['targets'], 'resolutions': resolutions, 'answerAttributes': sorted(answer_attributes),
                'sourceFingerprint': historical['fingerprint'], 'requestedEvidence': requested, **versions()}
        return apply_plan(context, product, snapshot, plan)
    return context


def initial_result(context):
    plan = context.get('_continuity')
    if not plan: return {}
    return {'continuity': {'version': CONTINUITY_VERSION, 'sourceJobId': plan['sourceJobId'],
                          'reusedTargetIds': plan['reusedTargetIds']},
            'reviewedTargetIds': plan['reusedTargetIds'], 'resolutions': plan['resolutions'], **versions()}
