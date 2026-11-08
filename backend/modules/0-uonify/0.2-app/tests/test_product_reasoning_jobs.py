"""PostgreSQL reasoning queue: durable paid responses, isolation and no stale writes."""
from copy import deepcopy
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.product_reasoning import digest, material_signature, product_signature
from app.product_materials_queue import LeaseLost
from app.google_cloud_provider import CloudError
from test_product_requirements import requirement_env, configure


class Reasoner:
    def __init__(self):
        self.calls = []; self.failure = False; self.before_verify = None
    def propose(self, token, project, context):
        self.calls.append('propose')
        if self.failure:
            error = CloudError('analysis_timeout'); error.usage = {'calls': 1, 'unconfirmedCalls': 1}; raise error
        candidates = [{'targetId': t['id'], 'path': t['path'], 'value': False if t['path'][0] == 'battery' else 'wood',
            'evidence': [{'sourceId': 'source-one', 'locator': 'p1', 'excerpt': 'Producto manual de madera'}], 'rationale': 'Funcionamiento manual documentado'}
            for t in context['targets'] if t['path'][0] in ('battery', 'material')]
        return {'candidates': candidates, 'usage': {'calls': 1, 'totalTokenCount': 100}}
    def verify(self, token, project, context, proposal):
        self.calls.append('verify')
        if self.before_verify: self.before_verify()
        supported = {c['targetId'] for c in proposal.get('candidates', [])}
        return {'verdicts': [{'targetId': t['id'], 'resolution': 'supported' if t['id'] in supported else 'unknown',
                             'accepted': t['id'] in supported, 'reason': 'Resultado de comprobación'}
                            for t in context['targets']], 'usage': {'calls': 1, 'totalTokenCount': 100}}


@pytest.fixture
def reasoning_env(requirement_env, monkeypatch):
    client, db, requirements, _, product, google = requirement_env
    configured = configure(client, product)
    service = requirements.reasoning
    provider = Reasoner(); service.provider = provider
    service.materials.credentials = lambda *args, **kwargs: [({}, 'drive-token'), ({'project_id': 'test-project'}, 'cloud-token')]
    metadata = {'id': 'source-one', 'modifiedTime': 'v1', 'mimeType': 'text/plain', 'size': '25', 'capabilities': {'canDownload': True}}
    service.materials.drive.metadata = lambda *_: deepcopy(metadata)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone(); material_id = uuid4()
        source = {**metadata, 'name': 'manual.txt', 'version': 'v1:hash', 'sha256': 'hash', 'readComplete': True}
        result = {'facts': {'version': 1, 'proposals': []}, 'sources': [source]}
        c.execute("""INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,revision,folder_id,status,result)
            VALUES(%s,%s,%s,%s,%s,%s,'folder','ready',%s)""", (material_id, user['id'], product['id'], uuid4(), user['google_subject'], configured['product']['revision'], Jsonb(result)))
        c.execute('INSERT INTO product_material_sources(job_id,source_id,version,data) VALUES(%s,%s,%s,%s)', (material_id, 'source-one', 'v1:hash', Jsonb(source)))
    def context(c, user, product, snapshot, job, **kwargs):
        from app.product_reasoning_context import targets_for
        targets, _, _ = targets_for(snapshot['schema'], product.get('amazonAttributes', {}), snapshot['marketplace_id'])
        return {'version': 1, 'fingerprint': digest({'product': product_signature(product), 'schema': snapshot['metadata']['schemaHash']}),
            'targets': targets, 'evidence': [{'id': 'e1', 'sourceId': 'source-one'}],
            'validationSchema': snapshot['schema'], 'marketplaceId': snapshot['marketplace_id'],
            'schemaHash': snapshot['metadata']['schemaHash'],
            'protected': {'amazonAttributes': product.get('amazonAttributes', {}), 'customFields': []}, 'facts': [], 'coverage': {},
            '_materialSignature': material_signature(job), '_sourceMetadata': [source]}
    monkeypatch.setattr(service, 'context', context)
    monkeypatch.setattr('app.product_reasoning_validation.validated_candidates', lambda context, proposal, verification: proposal['candidates'])
    return client, db, service, provider, configured, metadata, material_id


def prepare(env, **extra):
    client = env[0]
    revision = client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision']
    response = client.post('/api/products/BASIC/amazon-requirements/prepare', json={'revision': revision, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def run(env):
    service = env[2]; row = service.queue.claim('test-worker')
    assert row
    service.run(row)
    return row


def test_prepare_queues_get_is_pure_worker_fills_and_second_prepare_reuses(reasoning_env):
    client, db, service, provider, before, _, material_id = reasoning_env
    with db.connect() as c:
        original_material = c.execute('SELECT result FROM product_material_jobs WHERE id=%s', (material_id,)).fetchone()['result']
    result = prepare(reasoning_env)
    assert result['evaluation']['state'] == 'reasoning' and result['evaluation']['fields'] == []
    for _ in range(3):
        assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['reasoning']['status'] == 'queued'
    assert provider.calls == []
    row = run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'locally_valid'
    assert after['product']['amazonAttributes']['battery'][0]['value'] is False
    assert after['product']['amazonAttributes']['material'][0]['value'] == 'wood'
    assert all(not p['humanConfirmed'] and p['origin'] == 'semantic_inferred' for p in after['product']['amazonMaterialEvidence'].values())
    assert provider.calls == ['propose', 'verify']
    prepare(reasoning_env)
    assert provider.calls == ['propose', 'verify']
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_jobs').fetchone()['n'] == 1
        assert c.execute('SELECT result FROM product_material_jobs WHERE id=%s', (material_id,)).fetchone()['result'] == original_material
        assert service.queue.usage(c, row['id'])['tokens'] == 200
        assert c.execute('SELECT count(*) AS n FROM product_material_calls').fetchone()['n'] == 0


def test_timeout_stays_unknown_until_explicit_consumption_ack(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); provider.failure = True; row = run(reasoning_env)
    state = client.get('/api/products/BASIC/amazon-requirements').json()
    assert state['evaluation']['state'] == 'reasoning' and state['evaluation']['reasoning']['status'] == 'unknown'
    denied = client.post('/api/products/BASIC/amazon-requirements/prepare', json={'revision': state['product']['revision'], 'retry': True})
    assert denied.status_code == 409
    assert service.queue.claim('worker') is None
    provider.failure = False
    prepare(reasoning_env, retry=True, acknowledgeUnknown=True); run(reasoning_env)
    assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['state'] == 'locally_valid'
    with db.connect() as c: usage = service.queue.usage(c, row['id'])
    assert usage['unknown'] == 1 and usage['reserved'] > 0 and usage['calls'] == 3


def test_rejected_paid_output_is_retained_without_applying_data(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    def reject(*_):
        error = CloudError('invalid_response')
        error.usage = {'calls': 1, 'totalTokenCount': 123}
        error.diagnostics = {'stage': 'validation', 'validationReason': 'unknown_target'}
        error.rejectedResponse = {'decisions': [{'targetId': 'unknown', 'valueJson': 'false'}]}
        raise error
    provider.propose = reject
    prepare(reasoning_env); row = run(reasoning_env)
    with db.connect() as c:
        call = c.execute('SELECT * FROM product_reasoning_calls WHERE job_id=%s', (row['id'],)).fetchone()
    assert call['state'] == 'error' and call['total_tokens'] == 123
    assert call['result']['rejectedResponse']['decisions'][0]['targetId'] == 'unknown'
    assert call['result']['diagnostics']['validationReason'] == 'unknown_target'
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product'] == before


def test_resolved_and_unresolved_targets_do_not_repeat_the_same_paid_review(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    original = provider.propose
    def partial(*args):
        result = original(*args)
        result['candidates'] = [candidate for candidate in result['candidates'] if candidate['path'][0] == 'battery']
        return result
    provider.propose = partial
    prepare(reasoning_env); row = run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['product']['amazonAttributes']['battery'][0]['value'] is False
    assert after['evaluation']['state'] == 'needs_input'
    assert provider.calls == ['propose', 'verify']
    with db.connect() as c:
        assert c.execute('SELECT status FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()['status'] == 'completed'


def test_paid_proposal_reused_after_worker_crash_and_old_worker_fenced(reasoning_env):
    _, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('first')
    phase = 'propose:' + row['context']['fingerprint']
    call = service.queue.reserve(row, phase, 10)
    proposal = provider.propose('test', 'test', row['context'])
    service.queue.finish(row, call, proposal['usage'], proposal)
    with db.connect() as c:
        c.execute("UPDATE product_reasoning_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (row['id'],))
    newer = service.queue.claim('second')
    assert newer and newer['lease_token'] != row['lease_token']
    with pytest.raises(LeaseLost): service.queue.reserve(row, 'verify', 10)
    service.run(newer)
    assert provider.calls == ['propose', 'verify']


def test_concurrent_user_edit_survives_semantic_response(reasoning_env):
    client, _, _, provider, *_ = reasoning_env
    prepare(reasoning_env)
    def manual():
        current = client.get('/api/products/BASIC/amazon-requirements').json()['product']
        response = client.patch('/api/products/BASIC', json={'revision': current['revision'], 'brand': 'Mi nueva marca'})
        assert response.status_code == 200
    provider.before_verify = manual; run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['product']['brand'] == 'Mi nueva marca' and 'battery' not in after['product']['amazonAttributes']
    assert after['evaluation']['reasoning']['status'] == 'stale'


def test_source_changed_after_proposal_prevents_apply(reasoning_env):
    client, _, _, provider, _, metadata, _ = reasoning_env
    prepare(reasoning_env)
    provider.before_verify = lambda: metadata.update(modifiedTime='v2')
    run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert 'battery' not in after['product']['amazonAttributes']
    assert after['evaluation']['reasoning']['status'] == 'stale'


def test_server_rejects_invalid_values_even_if_verifier_accepts(reasoning_env):
    client, _, _, provider, *_ = reasoning_env
    original = provider.propose
    def invalid(*args):
        result = original(*args)
        for candidate in result['candidates']: candidate['value'] = 'not-a-boolean-or-valid-material'
        return result
    provider.propose = invalid
    prepare(reasoning_env); run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'reasoning' and after['evaluation']['fields'] == []
    assert after['evaluation']['reasoning']['canRetry'] is False
    assert 'battery' not in after['product']['amazonAttributes'] and 'material' not in after['product']['amazonAttributes']
    prepare(reasoning_env)
    assert provider.calls == ['propose', 'verify']

def test_conditional_targets_are_reasoned_before_questions(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    original = provider.propose
    def electrical(*args):
        result = original(*args)
        for item in result['candidates']:
            if item['path'][0] == 'battery': item['value'] = True
        for target in args[-1]['targets']:
            if target['path'][0] == 'battery_count':
                result['candidates'].append({'targetId': target['id'], 'path': target['path'], 'value': 2, 'evidence': [], 'rationale': 'Dos pilas documentadas'})
        return result
    provider.propose = electrical
    prepare(reasoning_env); row = run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'locally_valid'
    assert after['product']['amazonAttributes']['battery_count'][0]['value'] == 2
    assert provider.calls == ['propose', 'verify', 'propose', 'verify']
    with db.connect() as c:
        assert service.queue.usage(c, row['id'])['calls'] == 4


def test_incomplete_model_output_is_not_converted_into_customer_questions(reasoning_env):
    client, _, _, provider, *_ = reasoning_env
    original = provider.propose
    def incomplete(*args):
        return {**original(*args), 'unansweredTargetIds': [args[-1]['targets'][0]['id']]}
    provider.propose = incomplete
    prepare(reasoning_env); run(reasoning_env)
    evaluation = client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']
    assert evaluation['state'] == 'reasoning' and evaluation['fields'] == []
    assert evaluation['reasoning']['canRetry'] is False
    assert provider.calls == ['propose']


def test_existing_incomplete_analysis_blocks_questions_without_new_cost(reasoning_env):
    client, db, _, provider, _, _, material_id = reasoning_env
    with db.connect() as c:
        c.execute("UPDATE product_material_jobs SET status='paused' WHERE id=%s", (material_id,))
    evaluation = client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']
    assert evaluation['state'] == 'reasoning' and evaluation['reasoning']['materialsPending']
    assert evaluation['fields'] == [] and provider.calls == []


def test_preparation_does_not_accept_another_owner_identity(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('first')
    with db.connect() as c:
        c.execute("UPDATE users SET google_subject='new-account-identity' WHERE id=%s", (row['user_id'],))
    service.run(row)
    assert provider.calls == []
    with db.connect() as c:
        assert c.execute('SELECT status FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()['status'] == 'stale'


def test_new_fact_decision_invalidates_cached_unknown_and_keeps_history(reasoning_env):
    client, db, service, provider, _, _, material_id = reasoning_env
    original = provider.propose
    provider.propose = lambda *args: {'candidates': [], 'usage': {'calls': 1, 'totalTokenCount': 100}}
    prepare(reasoning_env); first = run(reasoning_env)
    assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['reasoning']['status'] == 'completed'
    with db.connect() as c:
        c.execute("UPDATE product_material_jobs SET result=jsonb_set(result,'{facts,proposals}',%s) WHERE id=%s",
                  (Jsonb([{'id': 'new', 'field': 'custom:funcion', 'label': 'Función', 'value': 'Juego manual', 'status': 'confirmed'}]), material_id))
    provider.propose = original
    prepare(reasoning_env); second = run(reasoning_env)
    assert first['id'] != second['id']
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_jobs').fetchone()['n'] == 2


def test_real_context_and_validator_persist_only_verified_documentary_inferences(reasoning_env, monkeypatch):
    from types import MethodType
    from importlib import reload
    from app.product_reasoning import ProductReasoning
    from app import product_reasoning_validation
    from app.product_reasoning_context import digest as context_digest
    client, db, service, provider, _, _, material_id = reasoning_env
    service.context = MethodType(ProductReasoning.context, service)
    # Restore the production acceptance layer for this integration case.
    original_validation = reload(product_reasoning_validation).validated_candidates
    monkeypatch.setattr(product_reasoning_validation, 'validated_candidates', original_validation)
    monkeypatch.setattr('app.product_reasoning_reconciliation.validated_candidates', original_validation)
    with db.connect() as c:
        c.execute("""INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload)
            VALUES(%s,'fragment-one','source-one','v1:hash','p1','done',%s)""",
            (material_id, Jsonb({'id': 'source-one', 'name': 'manual.txt', 'segments': [{'locator': 'p1',
                'text': 'Material: madera. Juego manual de apilar bloques. Contenido: bloques de madera y manual, sin componentes electrónicos.'}]})))
    def propose(token, project, context):
        provider.calls.append('propose')
        citation = next(e['id'] for e in context['evidence'] if e['sourceId'] == 'source-one')
        return {'decisions': [{'targetId': t['id'], 'state': 'inferred', 'value': False if t['path'][0] == 'battery' else 'wood',
            'evidenceRefs': [citation], 'basis': 'functional_reasoning', 'reason': 'Función y material documentados'} for t in context['targets']],
            'usage': {'calls': 1, 'totalTokenCount': 100}}
    def verify(token, project, context, proposal):
        provider.calls.append('verify')
        return {'proposalFingerprint': context_digest(proposal['decisions']), 'verdicts': [
            {'targetId': d['targetId'], 'resolution': 'supported', 'accepted': True, 'productMatch': True, 'conflictsResolved': True,
             'authorityConfirmed': False, 'basis': 'functional_reasoning', 'quote': '', 'reason': 'El manual describe funcionamiento manual y material.',
             'evidenceRefs': d['evidenceRefs']} for d in proposal['decisions']], 'usage': {'calls': 1, 'totalTokenCount': 100}}
    provider.propose, provider.verify = propose, verify
    prepare(reasoning_env); run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'locally_valid'
    assert all(item['sources'][0]['sourceId'] == 'source-one' for item in after['product']['amazonMaterialEvidence'].values())
    assert provider.calls == ['propose', 'verify']


def test_exhausted_budget_stays_visible_without_question_or_retry_loop(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env)
    with db.connect() as c: c.execute('UPDATE product_reasoning_jobs SET max_calls=1')
    run(reasoning_env)
    result = client.get('/api/products/BASIC/amazon-requirements').json()
    assert result['evaluation']['fields'] == [] and result['evaluation']['state'] == 'reasoning'
    assert result['evaluation']['reasoning']['canRetry'] is False and provider.calls == ['propose']
    denied = client.post('/api/products/BASIC/amazon-requirements/prepare', json={'revision': result['product']['revision'], 'retry': True})
    assert denied.status_code == 409 and service.queue.claim('test') is None


def test_expired_inflight_request_is_unknown_and_not_automatically_repeated(reasoning_env):
    _, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('first')
    service.queue.reserve(row, 'propose:' + row['context']['fingerprint'], 10)
    with db.connect() as c:
        c.execute("UPDATE product_reasoning_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (row['id'],))
    assert service.queue.claim('recovery') is None
    with db.connect() as c:
        assert c.execute('SELECT status FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()['status'] == 'unknown'
        assert service.queue.usage(c, row['id'])['unknown'] == 1
    assert provider.calls == []


def test_final_user_answer_closes_requirements_despite_older_reasoning_cache(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    original = provider.propose
    def partially_known(*args):
        result = original(*args)
        result['candidates'] = [c for c in result['candidates'] if c['path'][0] == 'battery']
        return result
    provider.propose = partially_known
    prepare(reasoning_env); row = run(reasoning_env)
    pending = client.get('/api/products/BASIC/amazon-requirements').json()
    assert pending['evaluation']['reasoning']['status'] == 'completed'
    assert pending['evaluation']['state'] == 'needs_input'
    field = pending['evaluation']['fields'][0]
    assert field['options'] == ['Madera', 'Plástico']
    reply = client.patch('/api/products/BASIC/amazon-requirements', json={
        'revision': pending['product']['revision'], 'evaluationId': pending['evaluation']['evaluationId'],
        'answers': {field['id']: 'Madera'}})
    assert reply.status_code == 200, reply.text
    completed = reply.json()
    assert completed['evaluation']['state'] == 'locally_valid'
    assert completed['evaluation']['counts'] == {'missing': 0, 'invalid': 0, 'questions': 0}
    assert 'reasoning' not in completed['evaluation']
    paid_calls = list(provider.calls)
    for _ in range(2):
        again = prepare(reasoning_env)
        assert again['evaluation']['state'] == 'locally_valid'
        assert 'reasoning' not in again['evaluation']
    assert provider.calls == paid_calls and service.queue.claim('test') is None
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_jobs').fetchone()['n'] == 1
        historical = c.execute('SELECT * FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
        assert historical['status'] == 'completed'
        assert historical['output_signature'] != product_signature(completed['product'])


def test_existing_invalid_user_value_has_no_inference_target_and_remains_editable(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); run(reasoning_env)
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    edited = client.patch('/api/products/BASIC', json={'revision': before['revision'], 'name': 'a' * 201})
    assert edited.status_code == 200
    result = prepare(reasoning_env)
    assert result['evaluation']['state'] == 'needs_input' and result['evaluation']['fields']
    assert 'reasoning' not in result['evaluation']
    assert result['product']['name'] == 'a' * 201
    assert provider.calls == ['propose', 'verify'] and service.queue.claim('test') is None
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_jobs').fetchone()['n'] == 1
