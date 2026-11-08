"""Evaluation, human review and CAS release for quarantined candidates."""

from uuid import UUID

from psycopg.types.json import Jsonb

from .creative_candidate_contract import (validate_evaluation_receipt,
    validate_inspection_receipt, validate_review_receipt)
from .creative_candidate_evaluator import (EVALUATOR, POLICY, POLICY_ID,
    POLICY_SHA256, POLICY_VERSION, build_evaluation_receipt,
    derive_evaluation_result, evaluation_id, evaluator_implementation_sha256,
    register_evaluation_policy)
from .creative_candidate_lifecycle import (CandidateLifecycleReceipt, _candidate,
    _owner, _quarantine_items, _uuid)
from .creative_composite_quote import canonical_sha256
from .creative_execution_admission import revalidate_admission_claims
from .creative_review_contract import decide_candidate_review


def evaluate_candidate(c, user: dict, candidate_id: object
                                 ) -> CandidateLifecycleReceipt:
    owner = _owner(c, user, lock=False)
    candidate_key = _uuid(candidate_id, 'candidateId')
    c.execute('''SELECT creative_lock_candidate_owner_authority(
        %s,%s,'uonify_creative_evaluator')''',
        (owner['id'], candidate_key)).fetchone()
    candidate, _ = _candidate(c, owner, candidate_id, lock=True)
    policy = register_evaluation_policy(c)
    items = _quarantine_items(c, owner['id'], candidate['id'])
    inspection = c.execute('''SELECT * FROM creative_candidate_inspections
        WHERE user_id=%s AND candidate_id=%s AND quarantine_set_sha256=%s
        ''', (owner['id'], candidate['id'],
                       candidate['quarantine_set_sha256'])).fetchone()
    if not inspection:
        raise ValueError('Falta la inspección técnica exacta del candidato.')
    technical_receipt = validate_inspection_receipt(inspection['receipt'])
    from .creative_candidate_inspection import inspection_implementation_sha256
    if (inspection['implementation_sha256']
            != inspection_implementation_sha256()):
        raise ValueError('La implementación de inspección técnica cambió.')
    implementation_sha256 = evaluator_implementation_sha256()
    identity = evaluation_id(
        str(candidate['id']), candidate['quarantine_set_sha256'])
    prior = c.execute('''SELECT evaluation_sha256,authority,policy_id,
        policy_version,implementation_sha256,receipt
        FROM creative_candidate_evaluations
        WHERE user_id=%s AND id=%s''',
        (owner['id'], identity)).fetchone()
    if prior:
        receipt = prior['receipt']
        if (prior['authority'] != 'server_registered'
                or prior['policy_id'] != POLICY_ID
                or prior['policy_version'] != POLICY_VERSION
                or prior['implementation_sha256'] != implementation_sha256
                or receipt.get('evaluationSha256') != prior['evaluation_sha256']
                or receipt.get('evaluationId') != identity
                or receipt.get('evaluator') != EVALUATOR
                or receipt.get('policySha256') != POLICY_SHA256
                or receipt.get('inspectionSha256')
                != inspection['inspection_sha256']
                or receipt.get('inspectionId') != str(inspection['id'])
                or receipt.get('results') != [derive_evaluation_result(
                    item, technical_receipt['results'][index])
                    for index, item in enumerate(items)]):
            raise ValueError('evaluationId ya liga otra evaluación.')
        return CandidateLifecycleReceipt(
            str(candidate['id']), candidate['state'], candidate['version'],
            receipt['evaluationSha256'], False)
    if candidate['state'] != 'quarantined' or not items:
        raise ValueError('La evaluación no corresponde a la cuarentena vigente.')
    received_at = c.execute('SELECT clock_timestamp() value').fetchone()['value']
    receipt = build_evaluation_receipt(
        str(candidate['id']), candidate['quarantine_set_sha256'],
        items, technical_receipt, received_at)
    c.execute('''INSERT INTO creative_candidate_evaluations
        (user_id,id,candidate_id,quarantine_set_sha256,evaluator,policy_sha256,
         evaluation_sha256,automatic_passed,ready_for_human_review,receipt,
         authority,policy_id,policy_version,implementation_sha256,inspection_id,
         inspection_sha256,received_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], receipt['evaluationId'], candidate['id'],
         receipt['quarantineSetSha256'], receipt['evaluator'],
         POLICY_SHA256, receipt['evaluationSha256'],
         receipt['automaticPassed'], receipt['readyForHumanReview'], Jsonb(receipt),
         'server_registered', POLICY_ID, POLICY_VERSION,
         policy['implementation_sha256'], inspection['id'],
         inspection['inspection_sha256'],
         received_at))
    state = 'review_pending' if receipt['readyForHumanReview'] else 'blocked'
    updated = c.execute('''UPDATE creative_candidate_states SET state=%s,
        version=version+1,updated_at=now() WHERE user_id=%s AND candidate_id=%s
          AND state='quarantined' AND version=%s RETURNING version''',
        (state, owner['id'], candidate['id'], candidate['version'])).fetchone()
    if not updated:
        raise ValueError('El estado cambió durante la evaluación.')
    return CandidateLifecycleReceipt(
        str(candidate['id']), state, updated['version'],
        receipt['evaluationSha256'], True)


# Compatibility name: it accepts only a candidate identity, never a receipt.
persist_candidate_evaluation = evaluate_candidate


def _registered_evaluation(c, owner_id, candidate: dict,
                           evaluation_id: object) -> dict:
    row = c.execute('''SELECT e.*,p.policy,p.evaluator policy_evaluator,
        p.implementation_sha256 registered_implementation,
        i.receipt inspection_receipt,
        i.implementation_sha256 inspection_implementation,
        i.technical_passed
        FROM creative_candidate_evaluations e
        JOIN creative_evaluation_policies p
          ON p.policy_id=e.policy_id AND p.policy_version=e.policy_version
         AND p.policy_sha256=e.policy_sha256
        JOIN creative_candidate_inspections i
          ON i.user_id=e.user_id AND i.candidate_id=e.candidate_id
         AND i.quarantine_set_sha256=e.quarantine_set_sha256
         AND i.id=e.inspection_id
         AND i.inspection_sha256=e.inspection_sha256
        WHERE e.user_id=%s AND e.id=%s AND e.candidate_id=%s''',
        (owner_id, evaluation_id, candidate['id'])).fetchone()
    if not row:
        raise ValueError('La evaluación no procede de autoridad registrada.')
    receipt = validate_evaluation_receipt(row['receipt'])
    items = _quarantine_items(c, owner_id, candidate['id'])
    inspection_receipt = validate_inspection_receipt(row['inspection_receipt'])
    technical = inspection_receipt['results']
    expected_results = ([derive_evaluation_result(item, technical[index])
                         for index, item in enumerate(items)]
                        if isinstance(technical, list)
                        and len(technical) == len(items) else None)
    implementation = evaluator_implementation_sha256()
    from .creative_candidate_inspection import inspection_implementation_sha256
    if (row['authority'] != 'server_registered'
            or row['policy_id'] != POLICY_ID
            or row['policy_version'] != POLICY_VERSION
            or row['policy_sha256'] != POLICY_SHA256 or row['policy'] != POLICY
            or row['evaluator'] != EVALUATOR
            or row['policy_evaluator'] != EVALUATOR
            or row['implementation_sha256'] != implementation
            or row['registered_implementation'] != implementation
            or receipt['inspectionSha256'] != row['inspection_sha256']
            or receipt['inspectionId'] != str(row['inspection_id'])
            or receipt['inspectionImplementationSha256']
            != row['inspection_implementation']
            or row['inspection_implementation']
            != inspection_implementation_sha256()
            or receipt['results'] != expected_results
            or receipt['evaluationSha256'] != row['evaluation_sha256']
            or receipt['automaticPassed'] != row['automatic_passed']
            or receipt['readyForHumanReview'] != row['ready_for_human_review']
            or not row['technical_passed']):
        raise ValueError('La evaluación no procede de autoridad registrada.')
    return row


def persist_candidate_review(c, user: dict, value: dict
                             ) -> CandidateLifecycleReceipt:
    receipt = validate_review_receipt(value)
    owner = _owner(c, user, lock=False)
    c.execute('''SELECT creative_lock_candidate_owner_authority(
        %s,%s,'uonify_creative_reviewer')''',
        (owner['id'], receipt['candidateId'])).fetchone()
    candidate, _ = _candidate(c, owner, receipt['candidateId'], lock=True)
    prior = c.execute('''SELECT review_sha256 FROM creative_candidate_reviews
        WHERE user_id=%s AND id=%s''',
        (owner['id'], receipt['reviewId'])).fetchone()
    if prior:
        if prior['review_sha256'] != receipt['reviewSha256']:
            raise ValueError('reviewId ya liga otra revisión.')
        return CandidateLifecycleReceipt(
            str(candidate['id']), candidate['state'], candidate['version'],
            receipt['reviewSha256'], False)
    evaluation = _registered_evaluation(
        c, owner['id'], candidate, receipt['evaluationId'])
    if (candidate['state'] != 'review_pending'
            or not evaluation['automatic_passed']
            or not evaluation['ready_for_human_review']):
        raise ValueError('La revisión no corresponde a una evaluación revisable.')
    items = _quarantine_items(c, owner['id'], candidate['id'])
    expected = [{'assetId': str(item['asset_id']), 'revision': item['revision'],
                 'snapshotSha256': item['snapshot_sha256']} for item in items]
    if (receipt['artifactRefs'] != expected
            or any(not isinstance(item, dict) or set(item) != {
                'assetId', 'revision', 'snapshotSha256'}
                for item in receipt['artifactRefs'])
            or receipt['reviewer'] != str(owner['id'])):
        raise ValueError('La revisión no acredita exactamente los artefactos.')
    decision = decide_candidate_review(
        tuple(expected), tuple(item['kind'] for item in items),
        tuple(item['media'].get('durationSeconds') for item in items),
        receipt['coverage'], tuple(receipt['verdicts']), receipt['reviewer'])
    if (receipt['blockers'] != list(decision.blockers)
            or (receipt['decision'] == 'approved_for_use'
                and not decision.reviewed_for_test)
            or (receipt['decision'] != 'approved_for_use'
                and decision.reviewed_for_test)):
        raise ValueError('La decisión no coincide con los gates canónicos.')
    c.execute('''INSERT INTO creative_candidate_reviews
        (user_id,id,candidate_id,evaluation_id,reviewer,decision,review_sha256,receipt)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], receipt['reviewId'], candidate['id'],
         receipt['evaluationId'], receipt['reviewer'], receipt['decision'],
         receipt['reviewSha256'], Jsonb(receipt)))
    updated = c.execute('''UPDATE creative_candidate_states SET state=%s,
        version=version+1,accepted_for_use=%s,updated_at=now()
        WHERE user_id=%s AND candidate_id=%s AND state='review_pending'
          AND version=%s RETURNING version''',
        (receipt['decision'], receipt['decision'] == 'approved_for_use',
         owner['id'], candidate['id'], candidate['version'])).fetchone()
    if not updated:
        raise ValueError('El estado cambió durante la revisión.')
    return CandidateLifecycleReceipt(
        str(candidate['id']), receipt['decision'], updated['version'],
        receipt['reviewSha256'], True)


def release_candidate_assets(c, user: dict, candidate_id: UUID,
                             release_id: UUID, *, expected_version: int
                             ) -> CandidateLifecycleReceipt:
    owner = _owner(c, user, lock=False)
    candidate_key = _uuid(candidate_id, 'candidateId')
    c.execute('SELECT creative_lock_candidate_release_authority(%s,%s)',
              (owner['id'], candidate_key)).fetchone()
    candidate, candidate_receipt = _candidate(
        c, owner, candidate_id, lock=True)
    rid = _uuid(release_id, 'releaseId')
    prior = c.execute('''SELECT id,release_sha256 FROM creative_candidate_releases
        WHERE user_id=%s AND candidate_id=%s''',
        (owner['id'], candidate['id'])).fetchone()
    if prior:
        if str(prior['id']) != rid:
            raise ValueError('El candidato ya liga otra liberación.')
        return CandidateLifecycleReceipt(
            str(candidate['id']), candidate['state'], candidate['version'],
            prior['release_sha256'], False)
    if (not isinstance(expected_version, int) or isinstance(expected_version, bool)
            or candidate['version'] != expected_version
            or candidate['state'] != 'approved_for_use'
            or not candidate['accepted_for_use']
            or candidate['state_publication']):
        raise ValueError('El candidato ya no está aprobado para esta liberación.')
    if candidate['uonify_project_id']:
        project = c.execute('''SELECT deleted_at FROM uony_projects
            WHERE user_id=%s AND id=%s''',
            (owner['id'], candidate['uonify_project_id'])).fetchone()
        if not project or project['deleted_at']:
            raise ValueError('El proyecto del candidato ya no está vigente.')
    revalidate_admission_claims(
        c, owner, UUID(str(candidate['job_id'])), require_unexpired=False,
        lock_reads=False)
    review = c.execute('''SELECT r.id AS review_id,r.evaluation_id
        FROM creative_candidate_reviews r
        WHERE r.user_id=%s AND r.candidate_id=%s
          AND r.decision='approved_for_use'
        ORDER BY r.created_at DESC,r.id DESC LIMIT 1''',
        (owner['id'], candidate['id'])).fetchone()
    if not review:
        raise ValueError('Falta una revisión humana aprobada.')
    _registered_evaluation(c, owner['id'], candidate, review['evaluation_id'])
    items = _quarantine_items(c, owner['id'], candidate['id'])
    locked_assets = c.execute('''SELECT * FROM creative_assets
        WHERE user_id=%s AND id=ANY(%s::uuid[]) ORDER BY id FOR UPDATE''',
        (owner['id'], [str(item['asset_id']) for item in items])).fetchall()
    locked_by_id = {row['id']: row for row in locked_assets}
    assets = []
    for item in items:
        row = locked_by_id.get(item['asset_id'])
        if (not row or row['authorization_state'] != 'quarantined'
                or row['current_revision'] != item['revision']
                or row['state_reason'] != 'pending_creative_review'):
            raise ValueError('Un asset ya no coincide con la cuarentena aprobada.')
        assets.append({'assetId': str(item['asset_id']),
                       'revision': item['revision'],
                       'snapshotSha256': item['snapshot_sha256']})
    native_rows = c.execute('''SELECT l.project_id,l.revision,l.snapshot_sha256,
        p.authorization_state,p.state_reason
        FROM creative_candidate_native_projects l
        JOIN creative_native_projects p
          ON p.user_id=l.user_id AND p.id=l.project_id
        WHERE l.user_id=%s AND l.candidate_id=%s ORDER BY l.project_id
        FOR UPDATE OF p''',
        (owner['id'], candidate['id'])).fetchall()
    native_required = candidate_receipt['engine']['name'] in (
        'filmcraft', 'photocraft')
    if len(native_rows) != (1 if native_required else 0):
        raise ValueError('La cardinalidad del proyecto nativo no coincide.')
    native_projects = []
    for row in native_rows:
        if (row['authorization_state'] != 'quarantined'
                or row['state_reason'] != 'pending_creative_review'):
            raise ValueError('El proyecto nativo ya no coincide con la cuarentena.')
        native_projects.append({'projectId': str(row['project_id']),
                                'revision': row['revision'],
                                'snapshotSha256': row['snapshot_sha256']})
    asset_set_sha = canonical_sha256(assets)
    body = {'schemaVersion': 2 if native_required else 1, 'releaseId': rid,
            'candidateId': str(candidate['id']),
            'actorId': str(owner['id']),
            'evaluationId': str(review['evaluation_id']),
            'reviewId': str(review['review_id']),
            'quarantineSetSha256': candidate['quarantine_set_sha256'],
            'assets': assets, 'assetSetSha256': asset_set_sha,
            'publicationAuthorized': False}
    if native_required:
        body['nativeProjects'] = native_projects
        body['releaseSetSha256'] = canonical_sha256(
            {'assets': assets, 'nativeProjects': native_projects})
    release_sha = canonical_sha256(body)
    c.execute('''INSERT INTO creative_candidate_releases
        (user_id,id,candidate_id,evaluation_id,review_id,actor_id,
         quarantine_set_sha256,asset_set_sha256,release_sha256,receipt)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
        (owner['id'], rid, candidate['id'], review['evaluation_id'],
         review['review_id'], owner['id'], candidate['quarantine_set_sha256'],
         asset_set_sha, release_sha, Jsonb(body)))
    for item in assets:
        updated = c.execute('''UPDATE creative_assets
            SET authorization_state='allowed',state_reason=NULL,updated_at=now()
            WHERE user_id=%s AND id=%s AND current_revision=%s
              AND authorization_state='quarantined'
              AND state_reason='pending_creative_review' RETURNING id''',
            (owner['id'], item['assetId'], item['revision'])).fetchone()
        if not updated:
            raise ValueError('Un asset cambió durante la liberación.')
    for item in native_projects:
        updated = c.execute('''UPDATE creative_native_projects
            SET authorization_state='allowed',state_reason=NULL,updated_at=now()
            WHERE user_id=%s AND id=%s AND current_revision=%s
              AND authorization_state='quarantined'
              AND state_reason='pending_creative_review' RETURNING id''',
            (owner['id'], item['projectId'], item['revision'])).fetchone()
        if not updated:
            raise ValueError('Un proyecto nativo cambió durante la liberación.')
    updated = c.execute('''UPDATE creative_candidate_states SET state='released',
        version=version+1,updated_at=now() WHERE user_id=%s AND candidate_id=%s
          AND state='approved_for_use' AND version=%s RETURNING version''',
        (owner['id'], candidate['id'], expected_version)).fetchone()
    if not updated:
        raise ValueError('El candidato cambió durante la liberación.')
    return CandidateLifecycleReceipt(
        str(candidate['id']), 'released', updated['version'], release_sha, True)
