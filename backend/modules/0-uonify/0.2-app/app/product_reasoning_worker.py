"""Bounded propose/verify reasoning; provider responses survive crashes before application."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
from psycopg.types.json import Jsonb
from fastapi import HTTPException
from .google_cloud_provider import CloudError
from .products import find, present, require_access, save
from .incident_fields import get_at, put_at
from .incident_schema_validation import validation_errors
from .product_requirements_fields import evaluate, flatten_errors
from .product_requirements_mapping import merge_scope, scope_attributes
from .product_materials_amazon import eligible_job, latest_job
from .product_materials_queue import LeaseLost, BudgetPause
from .product_reasoning import material_signature, product_signature


class StaleReasoning(Exception):
    def __init__(self, reason='inputs_changed'):
        self.reason = reason


def current(service, row, *, lock=False):
    with service.database.connect() as c:
        live = service.queue.assert_lease(c, row)
        user = c.execute('SELECT * FROM users WHERE id=%s', (row['user_id'],)).fetchone()
        if not user or user['google_subject'] != row['google_subject']:
            raise StaleReasoning()
        require_access(c, user)
        sql = 'SELECT * FROM products WHERE id=%s AND user_id=%s AND deleted_at IS NULL' + (' FOR UPDATE' if lock else '')
        found = c.execute(sql, (row['product_id'], row['user_id'])).fetchone()
        if not found:
            raise StaleReasoning()
        product = present(found)
        if product_signature(product) not in (live['product_signature'], live['output_signature']):
            raise StaleReasoning()
        if product['revision'] != (live['applied_revision'] or live['revision']):
            raise StaleReasoning()
        snapshot = service.requirements._snapshot(c, user, product)
        account = service.requirements._account(c, user)
        if (not snapshot or snapshot['metadata']['schemaHash'] != row['schema_hash'] or not account
            or account['seller_id'] != snapshot['seller_id'] or datetime.now(timezone.utc) - snapshot['fetched_at'] > timedelta(hours=24)):
            raise StaleReasoning()
        job = latest_job(c, user, product)
        if not eligible_job(job) or material_signature(job) != row['context'].get('_materialSignature'):
            raise StaleReasoning()
        # Credential identity/status check occurs before every reuse; no refresh under locks.
        credentials = service.materials.credentials(c, user, refresh=False)
        if live['context'].get('_billingProjectId') != credentials[1][0]['project_id']:
            raise StaleReasoning('project_changed')
        context = service.context(c, user, product, snapshot, job, requested_evidence=live['result'].get('requestedEvidence'))
        return user, product, snapshot, context, live


def credentials_and_sources(service, row, user, context):
    with service.database.connect() as c:
        service.queue.assert_lease(c, row)
        credentials = service.materials.credentials(c, user)
        if row['context'].get('_billingProjectId') != credentials[1][0]['project_id']:
            raise StaleReasoning('project_changed')
    drive_token = credentials[0][1]
    # Verify every cited/selected source before external use and application. Originals stay in Drive.
    selected = {item.get('sourceId') for item in context.get('evidence', [])}
    for source in context.get('_sourceMetadata', []):
        if selected and source['id'] not in selected:
            continue
        actual = service.materials.drive.metadata(drive_token, source['id'])
        if actual.get('capabilities', {}).get('canDownload') is False:
            raise CloudError('permission_denied')
        if any(source.get(k) is not None and actual.get(k) is not None and source[k] != actual[k]
               for k in ('modifiedTime', 'size', 'mimeType')):
            raise StaleReasoning('source_changed')
    return credentials[1][1], credentials[1][0]['project_id']


def phase(service, row, name, context, token, project, proposal=None):
    from .product_reasoning_provider import VERIFY_VERSION
    key = (name if name == 'propose' else f'verify-v{VERIFY_VERSION}') + ':' + context['fingerprint']
    cached = service.queue.completed(row, key)
    if cached is not None:
        return cached
    rejected = service.queue.rejected(row, key)
    if rejected is not None:
        recovered = recover_phase(service, row, rejected, context, name, proposal)
        if recovered is not None:
            return recovered
        # Una respuesta cobrada e inválida exige una reparación del contrato, no
        # otro cobro al pulsar reintentar. Nunca se transforma en pregunta al dueño.
        raise BudgetPause('response_repair_required')
    from .product_reasoning_provider import estimate_input_tokens
    estimate = estimate_input_tokens(context) + (len(json.dumps(proposal, default=str)) // 3 if proposal else 0)
    call_id = service.queue.reserve(row, key, estimate)
    try:
        result = (service.provider.propose(token, project, context) if name == 'propose'
                  else service.provider.verify(token, project, context, proposal))
    except Exception as error:
        usage = getattr(error, 'usage', {'calls': 1, 'unconfirmedCalls': 1})
        unknown = usage.get('unconfirmedCalls', 0) and getattr(error, 'code', None) in (None, 'analysis_timeout', 'google_unavailable')
        diagnostics = getattr(error, 'diagnostics', {})
        rejected = {'diagnostics': diagnostics} if diagnostics else {}
        for attribute, key in (('rejectedResponse', 'rejectedResponse'), ('decodedResponse', 'decodedResponse')):
            value = getattr(error, attribute, None)
            if isinstance(value, (dict, list, str)):
                rejected[key] = value
        service.queue.finish(row, call_id, usage, state='unknown' if unknown else 'error',
                             result=rejected or None)
        if unknown:
            raise BudgetPause('consumption_unknown') from None
        if getattr(error, 'code', None) == 'invalid_response' and rejected:
            recovered = recover_phase(service, row, {'id': call_id, 'result': rejected, 'usage': usage}, context, name, proposal)
            if recovered is not None:
                return recovered
            raise BudgetPause('response_repair_required') from None
        raise
    service.queue.finish(row, call_id, result.get('usage', {'calls': 1, 'unconfirmedCalls': 1}), result=result)
    return result


def recover_phase(service, row, rejected, context, name, proposal):
    from .product_reasoning_recovery import recover_paid_response
    recovery = recover_paid_response(rejected['result'], rejected['usage'], context,
                                     verification=name == 'verify', proposal=proposal)
    if recovery is None:
        return None
    service.queue.record_recovery(row, rejected['id'], recovery)
    return recovery['result']


def apply_candidates(service, row, context, candidates, expected_product, resolutions=None):
    from .product_reasoning_provider import VERIFY_VERSION
    from .product_reasoning_reconciliation import VALIDATION_RESOLUTION_VERSION
    with service.database.connect() as c:
        user = c.execute('SELECT * FROM users WHERE id=%s', (row['user_id'],)).fetchone()
        if not user or user['google_subject'] != row['google_subject']:
            raise StaleReasoning()
        require_access(c, user)
        stored = c.execute('SELECT * FROM products WHERE id=%s AND user_id=%s AND deleted_at IS NULL FOR UPDATE', (row['product_id'], row['user_id'])).fetchone()
        if not stored:
            raise StaleReasoning()
        # Same lock order as HTTP prepare/save: product, then its reasoning job.
        live = service.queue.assert_lease(c, row)
        product = present(stored)
        if product['revision'] != expected_product['revision'] or product_signature(product) != product_signature(expected_product):
            raise StaleReasoning()
        snapshot = service.requirements._snapshot(c, user, product)
        account = service.requirements._account(c, user)
        job = latest_job(c, user, product)
        service.materials.credentials(c, user, refresh=False)
        if (not snapshot or snapshot['metadata']['schemaHash'] != row['schema_hash'] or not account
            or snapshot['seller_id'] != account['seller_id'] or not eligible_job(job)
            or datetime.now(timezone.utc) - snapshot['fetched_at'] > timedelta(hours=24)
            or material_signature(job) != row['context'].get('_materialSignature')):
            raise StaleReasoning()
        attrs = deepcopy(product.get('amazonAttributes', {})); proof = deepcopy(product.get('amazonMaterialEvidence', {}))
        touched = set(); applied_ids = set(); allowed = {item['id']: item for item in context.get('targets', [])}
        grouped = {}
        for candidate in candidates:
            target = allowed.get(candidate.get('targetId'))
            if not target or candidate.get('path') != target['path'] or get_at(scope_attributes(attrs, snapshot['marketplace_id']), target['path']) is not None:
                continue
            grouped.setdefault(target['path'][0], []).append(candidate)
        for attribute, values in grouped.items():
            plan = evaluate(snapshot['schema'], attrs, snapshot['marketplace_id'], attribute, human=False)
            edited = deepcopy(plan['candidate'])
            for candidate in values:
                put_at(edited, candidate['path'], candidate['value'])
            merged = merge_scope(attrs, {attribute: edited[attribute]}, snapshot['marketplace_id'])
            def failure_keys(candidate):
                errors = flatten_errors(validation_errors(snapshot['schema'], scope_attributes(candidate, snapshot['marketplace_id'])))
                return {(json.dumps(list(error.absolute_path)), json.dumps(list(error.absolute_schema_path)), error.validator, error.message)
                        for error in errors if error.validator != 'required' and not error.context}
            if failure_keys(merged) - failure_keys(attrs):
                continue
            attrs = merged; touched.add(attribute)
            for candidate in values:
                applied_ids.add(candidate['targetId'])
                proof[json.dumps(candidate['path'])] = {'origin': candidate.get('origin', 'semantic_inferred'), 'humanConfirmed': False,
                    'active': True, 'value': candidate['value'], 'sources': candidate.get('evidence', []),
                    'rationale': candidate.get('rationale', ''), 'reasoningId': str(row['id']), 'contextFingerprint': context['fingerprint']}
        if touched:
            product = save(c, user, {'revision': product['revision']}, product['sku'], source='uony-reasoning',
                amazon_state={'amazonAttributes': attrs, 'amazonRequirementsContext': product['amazonRequirementsContext'], 'amazonMaterialEvidence': proof})
        result = {**live['result'], 'round': live['result'].get('round', 0) + 1, 'noProgress': not bool(touched),
                  'appliedAttributes': list(dict.fromkeys(live['result'].get('appliedAttributes', []) + sorted(touched)))}
        result['rejectedTargetIds'] = [item['targetId'] for item in candidates if item['targetId'] not in applied_ids]
        result['resolutions'] = {**live['result'].get('resolutions', {}), **(resolutions or {})}
        result['verificationContractVersion'] = VERIFY_VERSION
        result['validationResolutionVersion'] = VALIDATION_RESOLUTION_VERSION
        result['reviewedTargetIds'] = list(dict.fromkeys(live['result'].get('reviewedTargetIds', []) + [t['id'] for t in context['targets']]))
        result['outputContextFingerprint'] = service.context(c, user, product, snapshot, job)['fingerprint']
        c.execute('''UPDATE product_reasoning_jobs SET output_signature=%s,applied_revision=%s,result=%s,
            updated_at=now() WHERE id=%s''', (product_signature(product), product['revision'], Jsonb(result), row['id']))
        return result


def retrieve_evidence(service, row, context, response, *, verified=False):
    missing = [d for d in response.get('verdicts' if verified else 'decisions', [])
               if d.get('resolution' if verified else 'state') == 'needs_evidence']
    if not missing:
        return False
    available = {e['id'] for e in context.get('coverage', {}).get('omittedUnits', [])}
    requested = {ref for decision in missing for ref in decision.get('requestedEvidenceRefs', []) if ref in available}
    if not requested:
        # A proposer can mean a missing physical measurement, not an omitted file.
        # Only the independent verifier decides whether this is truly unknown.
        if verified:
            raise BudgetPause('evidence_incomplete')
        return False
    with service.database.connect() as c:
        live = service.queue.assert_lease(c, row)
        prior = live['result'].get('requestedEvidence', [])
        if requested.issubset(set(prior)):
            raise BudgetPause('evidence_incomplete')
        result = {**live['result'], 'requestedEvidence': list(dict.fromkeys(prior + sorted(requested))), 'needsEvidence': True}
        c.execute('UPDATE product_reasoning_jobs SET result=%s,updated_at=now() WHERE id=%s', (Jsonb(result), row['id']))
    return True


def verified_resolutions(context, verification):
    targets = {t['id'] for t in context.get('targets', [])}
    verdicts = verification.get('verdicts', [])
    if (len(verdicts) != len(targets) or {v.get('targetId') for v in verdicts} != targets
        or any(v.get('resolution') not in ('supported', 'unknown', 'conflict', 'needs_evidence') for v in verdicts)):
        raise BudgetPause('response_incomplete')
    return {v['targetId']: {'resolution': v['resolution'], 'reason': v.get('reason', ''),
            **({'reconciliation': deepcopy(v['reconciliation'])} if v.get('reconciliation') else {})} for v in verdicts}


def fixed_resolutions(candidates):
    return {item['targetId']: {'resolution': 'supported', 'origin': 'schema_fixed', 'reason': item['rationale']}
            for item in candidates}


def run(service, row):
    try:
        with service.queue.keeping_lease(row):
            for _ in range(3):
                user, product, snapshot, context, live = current(service, row)
                pending_ids = ({t['id'] for t in context.get('targets', [])}
                               | set(context.get('coverage', {}).get('omittedTargets', [])))
                if live['result'].get('round') and not pending_ids.difference(live['result'].get('reviewedTargetIds', [])):
                    break
                if live['result'].get('noProgress') or live['result'].get('round', 0) >= 3 or not context.get('targets'):
                    break
                from .product_reasoning_fixed import schema_fixed_candidates
                fixed = schema_fixed_candidates(context)
                fixed_ids = {item['targetId'] for item in fixed}
                if fixed_ids and fixed_ids == pending_ids:
                    # A fixed schema constant needs no model. For mixed targets defer
                    # saving until after cached phases, keeping their fingerprint intact.
                    result = apply_candidates(service, row, context, fixed, product, fixed_resolutions(fixed))
                    if result.get('rejectedTargetIds'):
                        raise BudgetPause('verification_rejected')
                    continue
                token, project = credentials_and_sources(service, row, user, context)
                proposal = phase(service, row, 'propose', context, token, project)
                if proposal.get('unansweredTargetIds'):
                    raise BudgetPause('response_incomplete')
                retrieval_proposal = {**proposal, 'decisions': [d for d in proposal.get('decisions', []) if d.get('targetId') not in fixed_ids]}
                if retrieve_evidence(service, row, context, retrieval_proposal):
                    continue
                verification = phase(service, row, 'verify', context, token, project, proposal)
                if verification.get('unansweredTargetIds'):
                    raise BudgetPause('response_incomplete')
                from .product_reasoning_reconciliation import reconcile_resolutions
                verification = reconcile_resolutions(context, proposal, verification)
                resolutions = verified_resolutions(context, verification)
                retrieval_verification = {**verification, 'verdicts': [v for v in verification.get('verdicts', []) if v.get('targetId') not in fixed_ids]}
                if retrieve_evidence(service, row, context, retrieval_verification, verified=True):
                    continue
                from .product_reasoning_validation import validated_candidates
                candidates = validated_candidates(context, proposal, verification)
                candidates = [item for item in candidates if item['targetId'] not in fixed_ids] + fixed
                resolutions.update(fixed_resolutions(fixed))
                supported = {key for key, value in resolutions.items() if value['resolution'] == 'supported'}
                if supported - {candidate['targetId'] for candidate in candidates}:
                    raise BudgetPause('verification_rejected')
                credentials_and_sources(service, row, user, context)
                result = apply_candidates(service, row, context, candidates, product, resolutions)
                if result.get('rejectedTargetIds'):
                    raise BudgetPause('verification_rejected')
            _, _, _, remaining, live = current(service, row)
            unseen = ({t['id'] for t in remaining.get('targets', [])} | set(remaining.get('coverage', {}).get('omittedTargets', []))) - set(live['result'].get('reviewedTargetIds', []))
            service.queue.terminal(row, 'error' if unseen else 'completed', {'error': 'reasoning_limit'} if unseen else {})
    except LeaseLost:
        return
    except StaleReasoning as error:
        service.queue.terminal(row, 'stale', {'error': error.reason})
    except BudgetPause as error:
        from .product_reasoning_provider import VERIFY_VERSION
        from .product_reasoning_reconciliation import VALIDATION_RESOLUTION_VERSION
        service.queue.terminal(row, 'unknown' if error.reason == 'consumption_unknown' else 'error',
            {'error': error.reason, 'verificationContractVersion': VERIFY_VERSION,
             'validationResolutionVersion': VALIDATION_RESOLUTION_VERSION})
    except Exception as error:
        code = error.code if isinstance(error, CloudError) else error.detail.get('error', 'reasoning_failed') if isinstance(error, HTTPException) and isinstance(error.detail, dict) else 'reasoning_failed'
        try:
            service.queue.terminal(row, 'error', {'error': code})
        except LeaseLost:
            pass
