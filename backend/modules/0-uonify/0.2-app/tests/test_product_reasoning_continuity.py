"""Commercial answers continue the reviewed form without replaying paid analysis."""
from copy import deepcopy
from types import MethodType
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.product_reasoning import ProductReasoning, product_signature
from app.product_reasoning_continuity import dependency_closure
from app.google_cloud_provider import CloudError
from test_product_reasoning_jobs import reasoning_env, prepare, run
from test_product_requirements import answer, value, requirement_env


@pytest.fixture
def continuity_env(reasoning_env, monkeypatch):
    client, db, service, provider, *_ = reasoning_env
    monkeypatch.setattr(service, 'context', MethodType(ProductReasoning.context, service))
    with db.connect() as c:
        row = c.execute('SELECT * FROM product_requirement_schemas').fetchone()
        schema = row['schema']; schema['properties']['condition_type'] = value(enum=['new_new', 'used_like_new'])
        schema['required'].insert(2, 'condition_type')
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    provider.propose = lambda *args: (provider.calls.append(['propose', [t['path'][0] for t in args[-1]['targets']]])
        or {'candidates': [], 'usage': {'calls': 1, 'totalTokenCount': 100}})
    return reasoning_env


def condition(client, selected='new_new'):
    result = client.get('/api/products/BASIC/amazon-requirements?attribute=condition_type').json()
    field = result['evaluation']['fields'][0]
    # Choice spelling is presentation-specific; values remain closed by the schema.
    option = field['options'][0 if selected == 'new_new' else 1]
    response = answer(client, result, option, 'condition_type')
    assert response.status_code == 200, response.text
    return response.json()


def completed(env):
    prepare(env); return run(env)


def test_intermediate_answer_reuses_review_preserves_product_and_reentry(continuity_env):
    client, db, service, provider, *_ = continuity_env
    first = completed(continuity_env)
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    response = condition(client)
    assert response['evaluation']['state'] == 'needs_input'
    assert response['evaluation']['reasoning']['status'] == 'completed'
    assert response['product']['revision'] == before['revision'] + 1
    assert response['product']['amazonAttributes']['condition_type'][0]['value'] == 'new_new'
    for key, val in before['amazonAttributes'].items(): assert response['product']['amazonAttributes'][key] == val
    calls = deepcopy(provider.calls)
    for _ in range(3):
        result = prepare(continuity_env)
        assert result['evaluation']['state'] == 'needs_input'
        assert result['product'] == response['product']
    assert provider.calls == calls and service.queue.claim('restarted-worker') is None
    with db.connect() as c:
        rows = c.execute('SELECT * FROM product_reasoning_jobs ORDER BY created_at').fetchall()
        assert len(rows) == 2 and all(row['status'] == 'completed' for row in rows)
        assert rows[1]['result']['continuity']['sourceJobId'] == str(first['id'])
        assert len(rows[1]['result']['reviewedTargetIds']) == 2
        assert service.queue.usage(c, rows[1]['id'])['calls'] == 0
        assert rows[0]['result']['noProgress'] is True


def test_completed_parent_bypasses_newer_error_without_rewriting_history(continuity_env):
    client, db, service, provider, *_ = continuity_env
    first = completed(continuity_env)
    # Reproduce the old bug: an answer enqueued a second job with the full pending bundle.
    original = service.enqueue
    service.enqueue = lambda *args, **kwargs: None
    response = condition(client); service.enqueue = original
    with db.connect() as c:
        parent = c.execute('SELECT * FROM product_reasoning_jobs WHERE id=%s', (first['id'],)).fetchone()
        user = c.execute('SELECT * FROM users').fetchone()
        product = response['product']; snapshot = service.requirements._snapshot(c, user, product)
        from app.product_materials_amazon import latest_job
        context = service._context_raw(c, user, product, snapshot, latest_job(c, user, product))
        failed = uuid4()
        c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,material_job_id,google_subject,
            fingerprint,product_signature,schema_hash,status,revision,context,result)
            VALUES(%s,%s,%s,%s,%s,'legacy-failure',%s,%s,'error',%s,%s,%s)""",
            (failed, parent['user_id'], parent['product_id'], parent['material_job_id'], parent['google_subject'],
             product_signature(product), parent['schema_hash'], product['revision'], Jsonb(context), Jsonb({'error': 'invalid_response'})))
    calls = deepcopy(provider.calls)
    result = prepare(continuity_env, retry=True)
    assert result['evaluation']['reasoning']['status'] == 'completed'
    assert result['product'] == product and provider.calls == calls
    with db.connect() as c:
        assert c.execute('SELECT status,result FROM product_reasoning_jobs WHERE id=%s', (failed,)).fetchone() == {'status': 'error', 'result': {'error': 'invalid_response'}}
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_calls').fetchone()['n'] == 2


def test_new_conditional_requirement_only_sends_new_target(continuity_env):
    client, db, _, provider, *_ = continuity_env
    with db.connect() as c:
        schema = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        schema['properties']['condition_note'] = value()
        schema['allOf'].append({'if': {'required': ['condition_type'], 'properties': {
            'condition_type': {'contains': {'required': ['value'], 'properties': {'value': {'const': 'new_new'}}}}}},
            'then': {'required': ['condition_note']}})
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    completed(continuity_env)
    result = condition(client)
    assert result['evaluation']['reasoning']['status'] == 'queued'
    row = run(continuity_env)
    assert provider.calls[-2] == ['propose', ['condition_note']]
    assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['state'] == 'needs_input'
    with db.connect() as c:
        state = c.execute('SELECT result,status FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
        assert state['status'] == 'completed' and len(state['result']['reviewedTargetIds']) == 3
        assert state['result']['round'] == 1  # Parent noProgress/round never leaks into the new budget.


@pytest.mark.parametrize('change', ['brand', 'custom', 'material', 'source', 'fragment', 'policy', 'schema', 'google', 'legacy_version', 'requirements'])
def test_semantic_or_scope_change_never_reuses_unknown(continuity_env, monkeypatch, change):
    client, db, service, provider, *_ = continuity_env
    first = completed(continuity_env)
    with db.connect() as c:
        if change in ('brand', 'custom', 'material'):
            from app.products import present, save
            user = c.execute('SELECT * FROM users').fetchone(); product = present(c.execute('SELECT * FROM products').fetchone())
            if change == 'material':
                state = {'amazonAttributes': {**product['amazonAttributes'], 'material': [{'value': 'wood'}]}}
                save(c, user, {'revision': product['revision']}, 'BASIC', amazon_state=state)
            else:
                patch = {'brand': 'Different variant'} if change == 'brand' else {'customFields': [{'id': 'confirmed', 'name': 'Variante', 'value': 'Grande', 'isConfirmed': True}]}
                save(c, user, {'revision': product['revision'], **patch}, 'BASIC')
        elif change == 'source':
            c.execute("UPDATE product_material_jobs SET result=jsonb_set(result,'{sources,0,version}','\"v2\"')")
        elif change == 'fragment':
            c.execute("""INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,payload,state)
                VALUES(%s,'fragment-changed','source-one','v1:hash','p1',%s,'done')""", (continuity_env[-1], Jsonb({'text': 'Changed original', 'locator': 'p1'})))
        elif change == 'policy':
            from app.product_reasoning import policy
            current = policy(); monkeypatch.setattr('app.product_reasoning.policy', lambda: {**current, 'prompt': current['prompt'] + 1})
        elif change == 'schema':
            c.execute("UPDATE product_requirement_schemas SET metadata=jsonb_set(metadata,'{schemaHash}','\"different\"')")
        elif change == 'requirements':
            c.execute("UPDATE product_requirement_schemas SET metadata=jsonb_set(metadata,'{requirements}','\"LISTING_PRODUCT_ONLY\"')")
        elif change == 'google':
            c.execute("UPDATE product_reasoning_jobs SET google_subject='different' WHERE id=%s", (first['id'],))
        elif change == 'legacy_version':
            c.execute("UPDATE product_reasoning_jobs SET result=result - 'verificationContractVersion' WHERE id=%s", (first['id'],))
    result = condition(client)
    assert result['evaluation']['reasoning']['status'] == 'queued'
    with db.connect() as c:
        row = c.execute("SELECT * FROM product_reasoning_jobs WHERE status='queued'").fetchone()
        assert not row['result'].get('continuity')
    if change == 'custom':
        assert result['product']['customFields'][0]['isConfirmed'] is True


def test_disconnected_permission_blocks_continuation_without_external_calls(continuity_env):
    client, _, service, provider, *_ = continuity_env
    completed(continuity_env)
    before = deepcopy(provider.calls)
    service.materials.credentials = lambda *_args, **_kwargs: (_ for _ in ()).throw(CloudError('permission_denied'))
    result = client.get('/api/products/BASIC/amazon-requirements?attribute=condition_type').json()
    response = answer(client, result, result['evaluation']['fields'][0]['options'][0], 'condition_type')
    assert response.status_code == 200, response.text
    after = response.json()
    assert after['product']['revision'] == result['product']['revision'] + 1
    assert after['product']['amazonAttributes']['condition_type'][0]['value'] == 'new_new'
    assert after['evaluation']['reasoning']['status'] == 'error'
    assert provider.calls == before


def test_conditional_dependencies_are_transitive_and_same_target_changes_invalidate():
    schema = {'properties': {'condition_type': {}, 'material': {}, 'battery': {}}, 'allOf': [
        {'if': {'properties': {'condition_type': {'const': 'new_new'}}}, 'then': {'properties': {'material': {'enum': ['wood']}}}},
        {'if': {'properties': {'material': {'const': 'wood'}}}, 'then': {'required': ['battery']}}]}
    assert dependency_closure(schema, {'condition_type'}) == {'condition_type', 'material', 'battery'}


@pytest.mark.parametrize('version', ['VERIFY_VERSION', 'VALIDATION_RESOLUTION_VERSION'])
def test_continuation_never_launders_old_verification_version(continuity_env, monkeypatch, version):
    completed(continuity_env); condition(continuity_env[0])
    module = 'app.product_reasoning_provider' if version == 'VERIFY_VERSION' else 'app.product_reasoning_reconciliation'
    monkeypatch.setattr(module + '.' + version, 999)
    result = prepare(continuity_env)
    assert result['evaluation']['reasoning']['status'] == 'queued'
    with continuity_env[1].connect() as c:
        row = c.execute("SELECT context,result FROM product_reasoning_jobs WHERE status='queued'").fetchone()
        assert not row['context'].get('_continuity') and not row['result'].get('continuity')


def test_weight_answer_preserves_unrelated_reviewed_questions(continuity_env):
    client, db, service, provider, *_ = continuity_env
    with db.connect() as c:
        schema = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        schema['properties']['item_weight'] = value('number', minimum=0)
        schema['required'].append('item_weight')
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    completed(continuity_env); condition(client)
    reviewed = client.get('/api/products/BASIC/amazon-requirements?attribute=item_weight').json()
    count = len(provider.calls)
    result = answer(client, reviewed, '0.42', 'item_weight').json()
    assert result['evaluation']['state'] == 'needs_input'
    assert result['evaluation']['reasoning']['status'] == 'completed'
    assert result['product']['amazonAttributes']['item_weight'][0]['value'] == .42
    assert len(provider.calls) == count and service.queue.claim('worker-restarted') is None
    assert prepare(continuity_env)['product'] == result['product']


def test_changed_fragment_invalidates_existing_continuation_on_reentry(continuity_env):
    client, db, *_ = continuity_env
    completed(continuity_env); condition(client)
    with db.connect() as c:
        c.execute("""INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,payload,state)
            VALUES(%s,'fragment-new','source-one','v1:hash','p1',%s,'done')""",
            (continuity_env[-1], Jsonb({'segments': [{'locator': 'p1', 'text': 'Newly read original'}]})))
    result = prepare(continuity_env)
    assert result['evaluation']['reasoning']['status'] == 'queued'
    with db.connect() as c:
        assert not c.execute("SELECT result FROM product_reasoning_jobs WHERE status='queued'").fetchone()['result'].get('continuity')


def test_dependency_refs_are_not_consumed_by_another_schema_branch():
    schema = {'properties': {'condition_type': {}, 'weight': {}},
        '$defs': {'shared': {'properties': {'weight': {}}}},
        'anyOf': [{'$ref': '#/$defs/shared'}, {}],
        'dependentSchemas': {'condition_type': {'$ref': '#/$defs/shared'}}}
    assert dependency_closure(schema, {'condition_type'}) == {'condition_type', 'weight'}


@pytest.mark.parametrize('call_state', ['unknown', 'error'])
def test_unacknowledged_old_call_blocks_new_targets_but_not_local_continuation(continuity_env, call_state):
    client, db, service, provider, *_ = continuity_env
    first = completed(continuity_env)
    # Unknown cost can coexist with completed review; its state/usage must be retained.
    unknown = uuid4()
    with db.connect() as c:
        c.execute("""INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'historical-unknown',%s,100,%s)""",
            (unknown, first['id'], uuid4(), call_state, Jsonb({'calls': 1, 'unconfirmedCalls': 1})))
    result = condition(client)
    assert result['evaluation']['reasoning']['status'] == 'completed'
    # A new identity needs new analysis, which cannot bypass the old unknown charge.
    response = client.patch('/api/products/BASIC', json={'revision': result['product']['revision'], 'brand': 'New identity'})
    assert response.status_code == 200
    result = prepare(continuity_env)
    assert result['evaluation']['reasoning']['status'] == 'unknown'
    assert service.queue.claim('worker') is None and len(provider.calls) == 2
    result = prepare(continuity_env, retry=True, acknowledgeUnknown=True)
    assert result['evaluation']['reasoning']['status'] == 'queued'
    run(continuity_env)
    with db.connect() as c:
        call = c.execute('SELECT state,usage,acknowledged_at FROM product_reasoning_calls WHERE id=%s', (unknown,)).fetchone()
        assert call['state'] == call_state and call['usage']['unconfirmedCalls'] == 1
        assert call['acknowledged_at'] is not None
    assert len(provider.calls) == 4


def test_unrepairable_paid_output_blocks_retry_without_new_charge(continuity_env):
    client, db, service, provider, *_ = continuity_env
    def invalid(*_):
        provider.calls.append('propose')
        error = CloudError('invalid_response')
        error.usage = {'calls': 1, 'totalTokenCount': 321}
        error.diagnostics = {'stage': 'validation', 'httpStatus': 200, 'finishReason': 'STOP'}
        error.rejectedResponse = {'decisions': [{'targetId': 'invented', 'state': 'unknown'}]}
        raise error
    provider.propose = invalid
    prepare(continuity_env); run(continuity_env)
    result = client.get('/api/products/BASIC/amazon-requirements').json()
    assert result['evaluation']['reasoning']['canRetry'] is False
    assert result['evaluation']['fields'] == []
    denied = client.post('/api/products/BASIC/amazon-requirements/prepare',
        json={'revision': result['product']['revision'], 'retry': True})
    assert denied.status_code == 409 and denied.json()['error'] == 'reasoning_repair_required'
    assert provider.calls == ['propose'] and service.queue.claim('worker') is None
    with db.connect() as c:
        call = c.execute('SELECT total_tokens,result FROM product_reasoning_calls').fetchone()
        assert call['total_tokens'] == 321 and call['result']['rejectedResponse']['decisions'][0]['targetId'] == 'invented'
