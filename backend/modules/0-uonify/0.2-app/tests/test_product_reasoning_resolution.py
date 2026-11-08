"""Resolution contracts reuse paid proposals and distinguish missing files from unknown data."""
from copy import deepcopy
from psycopg.types.json import Jsonb
from test_product_reasoning_jobs import reasoning_env, prepare, run
from test_product_requirements import requirement_env


def test_old_evidence_error_reuses_proposal_and_verifies_external_unknown(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('old-worker')
    proposal = provider.propose('token', 'project', row['context'])
    proposal['candidates'] = [c for c in proposal['candidates'] if c['path'][0] == 'battery']
    missing = next(t for t in row['context']['targets'] if t['path'][0] == 'material')
    proposal['decisions'] = [{'targetId': missing['id'], 'state': 'needs_evidence',
                              'requestedEvidenceRefs': [], 'reason': 'Falta un dato físico del fabricante'}]
    call = service.queue.reserve(row, 'propose:' + row['context']['fingerprint'], 100)
    service.queue.finish(row, call, proposal['usage'], proposal)
    service.queue.terminal(row, 'error', {'error': 'evidence_incomplete'})
    provider.calls.clear()
    provider.propose = lambda *_: (_ for _ in ()).throw(AssertionError('No repetir propuesta pagada'))
    before = client.get('/api/products/BASIC/amazon-requirements').json()
    assert before['evaluation']['reasoning']['canRetry'] is True
    prepare(reasoning_env, retry=True); resumed = run(reasoning_env)
    assert resumed['id'] == row['id']
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['product']['amazonAttributes']['battery'][0]['value'] is False
    assert after['evaluation']['state'] == 'needs_input'
    assert provider.calls == ['verify']
    with db.connect() as c:
        saved = c.execute('SELECT * FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
        calls = c.execute('SELECT phase FROM product_reasoning_calls WHERE job_id=%s', (row['id'],)).fetchall()
    assert saved['status'] == 'completed'
    assert saved['result']['resolutions'][missing['id']]['resolution'] == 'unknown'
    assert sorted(item['phase'].split(':')[0] for item in calls) == ['propose', 'verify-v2']


def test_old_verifier_output_does_not_satisfy_new_contract(reasoning_env):
    _, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('old-worker')
    proposal = provider.propose('token', 'project', row['context'])
    for name, result in [('propose', proposal), ('verify', {'verdicts': []})]:
        call = service.queue.reserve(row, name + ':' + row['context']['fingerprint'], 100)
        service.queue.finish(row, call, {'calls': 1, 'totalTokenCount': 100}, result)
    service.queue.terminal(row, 'error', {'error': 'evidence_incomplete'})
    provider.calls.clear()
    prepare(reasoning_env, retry=True); run(reasoning_env)
    assert provider.calls == ['verify']
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_calls WHERE job_id=%s', (row['id'],)).fetchone()['n'] == 3


def test_incomplete_verification_never_becomes_a_customer_question(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    original = provider.verify
    def incomplete(*args):
        result = original(*args); result['verdicts'] = result['verdicts'][:-1]; return result
    provider.verify = incomplete
    prepare(reasoning_env); row = run(reasoning_env)
    result = client.get('/api/products/BASIC/amazon-requirements').json()
    assert result['evaluation']['state'] == 'reasoning' and result['evaluation']['fields'] == []
    assert result['evaluation']['reasoning']['canRetry'] is False
    with db.connect() as c:
        job = c.execute('SELECT result FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
    assert job['result']['error'] == 'response_incomplete'


def test_verifier_missing_evidence_without_retrievable_refs_remains_blocked(reasoning_env):
    client, db, _, provider, *_ = reasoning_env
    original = provider.verify
    def needs_evidence(*args):
        result = original(*args)
        result['verdicts'][0].update(resolution='needs_evidence', accepted=False, requestedEvidenceRefs=[])
        return result
    provider.verify = needs_evidence
    prepare(reasoning_env); row = run(reasoning_env)
    result = client.get('/api/products/BASIC/amazon-requirements').json()
    assert result['evaluation']['state'] == 'reasoning' and result['evaluation']['fields'] == []
    assert result['evaluation']['reasoning']['canRetry'] is False
    denied = client.post('/api/products/BASIC/amazon-requirements/prepare',
                         json={'revision': result['product']['revision'], 'retry': True})
    assert denied.status_code == 409
    with db.connect() as c:
        job = c.execute('SELECT result FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
    assert job['result']['verificationContractVersion'] == 2 and job['result']['error'] == 'evidence_incomplete'


def test_verifier_recovers_concrete_omitted_file_before_questions(reasoning_env):
    client, db, service, provider, *_ = reasoning_env
    original_context = service.context; original_verify = provider.verify
    def context(*args, **kwargs):
        value = original_context(*args, **kwargs)
        requested = kwargs.get('requested_evidence') or []
        if 'e2' in requested:
            value['fingerprint'] += '-retrieved'; value['evidence'].append({'id': 'e2', 'sourceId': 'source-one'})
        else:
            value['coverage'] = {'omittedUnits': [{'id': 'e2', 'sourceId': 'source-one'}]}
        return value
    def verify(token, project, context, proposal):
        result = original_verify(token, project, context, proposal)
        if not any(e['id'] == 'e2' for e in context['evidence']):
            result['verdicts'][0].update(resolution='needs_evidence', accepted=False, requestedEvidenceRefs=['e2'])
        return result
    service.context = context; provider.verify = verify
    prepare(reasoning_env); row = run(reasoning_env)
    result = client.get('/api/products/BASIC/amazon-requirements').json()
    assert result['evaluation']['state'] == 'locally_valid'
    assert provider.calls == ['propose', 'verify', 'propose', 'verify']
    with db.connect() as c:
        job = c.execute('SELECT result FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
    assert job['result']['requestedEvidence'] == ['e2']


def test_supported_inference_rejected_by_validation_is_not_called_unknown(reasoning_env, monkeypatch):
    client, db, _, _, *_ = reasoning_env
    monkeypatch.setattr('app.product_reasoning_validation.validated_candidates', lambda *_: [])
    prepare(reasoning_env); row = run(reasoning_env)
    result = client.get('/api/products/BASIC/amazon-requirements').json()
    assert result['evaluation']['state'] == 'reasoning' and result['evaluation']['fields'] == []
    assert result['evaluation']['reasoning']['canRetry'] is False
    with db.connect() as c:
        job = c.execute('SELECT result FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
    assert job['result']['error'] == 'verification_rejected'


def test_reconciliation_reuses_both_paid_phases_and_preserves_verifier_history(reasoning_env, monkeypatch):
    client, db, service, provider, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('old-worker')
    proposal = provider.propose('token', 'project', row['context'])
    verification = provider.verify('token', 'project', row['context'], proposal)
    for phase, result in [('propose', proposal), ('verify-v2', verification)]:
        call = service.queue.reserve(row, phase + ':' + row['context']['fingerprint'], 100)
        service.queue.finish(row, call, result['usage'], result)
    service.queue.terminal(row, 'error', {'error': 'verification_rejected', 'verificationContractVersion': 2})
    provider.calls.clear()
    provider.propose = provider.verify = lambda *_: (_ for _ in ()).throw(AssertionError('No repetir IA pagada'))
    unresolved = next(t['id'] for t in row['context']['targets'] if t['path'][0] == 'material')
    def reconcile(context, proposal, paid_verification):
        result = deepcopy(paid_verification)
        verdict = next(v for v in result['verdicts'] if v['targetId'] == unresolved)
        verdict.update(resolution='unknown', accepted=False, reason='Falta declaración del fabricante',
                       reconciliation={'code': 'authority_evidence_missing', 'origin': 'server_evidence_rule',
                                       'evidenceRefs': [], 'reason': 'Falta declaración del fabricante'})
        return result
    monkeypatch.setattr('app.product_reasoning_reconciliation.reconcile_resolutions', reconcile)
    monkeypatch.setattr('app.product_reasoning_validation.validated_candidates', lambda context, proposal, verification:
        [candidate for candidate in proposal['candidates'] if any(v['targetId'] == candidate['targetId']
         and v['resolution'] == 'supported' for v in verification['verdicts'])])
    before = client.get('/api/products/BASIC/amazon-requirements').json()
    assert before['evaluation']['reasoning']['canRetry'] is True
    prepare(reasoning_env, retry=True); resumed = run(reasoning_env)
    assert resumed['id'] == row['id'] and provider.calls == []
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'needs_input'
    assert after['product']['amazonAttributes']['battery'][0]['value'] is False
    assert 'material' not in after['product']['amazonAttributes']
    with db.connect() as c:
        saved = c.execute('SELECT * FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
        calls = c.execute('SELECT * FROM product_reasoning_calls WHERE job_id=%s', (row['id'],)).fetchall()
    assert len(calls) == 2 and sum(c['total_tokens'] for c in calls) == 200
    assert next(c['result'] for c in calls if c['phase'].startswith('verify-v2:')) == verification
    assert saved['status'] == 'completed' and saved['result']['validationResolutionVersion'] == 1
    assert saved['result']['resolutions'][unresolved]['reconciliation']['origin'] == 'server_evidence_rule'


def test_current_rejection_or_old_partial_application_cannot_blindly_replay(reasoning_env):
    client, db, service, _, *_ = reasoning_env
    prepare(reasoning_env); row = service.queue.claim('worker')
    for details in ({'validationResolutionVersion': 1}, {'rejectedTargetIds': ['protected']}):
        with db.connect() as c:
            c.execute("UPDATE product_reasoning_jobs SET status='error',result=%s WHERE id=%s",
                      (Jsonb({'error': 'verification_rejected', **details}), row['id']))
        before = client.get('/api/products/BASIC/amazon-requirements').json()
        assert before['evaluation']['reasoning']['canRetry'] is False
        response = client.post('/api/products/BASIC/amazon-requirements/prepare',
                               json={'revision': before['product']['revision'], 'retry': True})
        assert response.status_code == 409


def test_only_schema_fixed_requirement_is_saved_without_any_model_call(reasoning_env):
    from types import MethodType
    from app.product_reasoning import ProductReasoning
    client, db, service, provider, *_ = reasoning_env
    service.context = MethodType(ProductReasoning.context, service)
    with db.connect() as c:
        snapshot = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        snapshot['required'] = ['item_name', 'brand', 'battery']
        snapshot['properties']['battery']['items']['properties']['value'].update(enum=[False], hidden=True, editable=False)
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(snapshot),))
    before = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    prepare(reasoning_env); row = run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'locally_valid' and provider.calls == []
    proof = next(iter(after['product']['amazonMaterialEvidence'].values()))
    assert proof['origin'] == 'schema_fixed' and proof['humanConfirmed'] is False
    assert proof['sources'][0]['sourceId'] == 'schema'
    assert after['product'].get('customFields', []) == before.get('customFields', [])
    assert after['product']['name'] == before['name'] and after['product']['brand'] == before['brand']
    with db.connect() as c:
        job = c.execute('SELECT * FROM product_reasoning_jobs WHERE id=%s', (row['id'],)).fetchone()
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_calls').fetchone()['n'] == 0
    assert job['status'] == 'completed'
    assert all(r['origin'] == 'schema_fixed' for r in job['result']['resolutions'].values())


def test_mixed_fixed_and_semantic_targets_reuse_paid_context_and_keep_origins(reasoning_env):
    from types import MethodType
    from app.product_reasoning import ProductReasoning
    client, db, service, provider, *_ = reasoning_env
    service.context = MethodType(ProductReasoning.context, service)
    with db.connect() as c:
        snapshot = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        snapshot['properties']['material']['items']['properties']['value'].update(enum=['wood'], hidden=True, editable=False)
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(snapshot),))
    prepare(reasoning_env); row = service.queue.claim('old-worker')
    proposal = provider.propose('token', 'project', row['context'])
    proposal['candidates'] = [v for v in proposal['candidates'] if v['path'][0] == 'battery']
    verification = provider.verify('token', 'project', row['context'], proposal)
    for phase, result in [('propose', proposal), ('verify-v2', verification)]:
        call = service.queue.reserve(row, phase + ':' + row['context']['fingerprint'], 100)
        service.queue.finish(row, call, result['usage'], result)
    service.queue.terminal(row, 'error', {'error': 'verification_rejected', 'verificationContractVersion': 2})
    provider.calls.clear()
    provider.propose = provider.verify = lambda *_: (_ for _ in ()).throw(AssertionError('No repetir IA'))
    prepare(reasoning_env, retry=True); run(reasoning_env)
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'locally_valid' and provider.calls == []
    proofs = after['product']['amazonMaterialEvidence']
    assert proofs['["material", 0, "value"]']['origin'] == 'schema_fixed'
    assert proofs['["battery", 0, "value"]']['origin'] == 'semantic_inferred'
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_calls').fetchone()['n'] == 2


def test_original_source_reservations_do_not_change_paid_fingerprint_or_model_input(reasoning_env):
    from types import MethodType
    from app.product_reasoning import ProductReasoning, digest, policy
    from app.product_reasoning_context import build_context
    from app.product_reasoning_provider import model_parts
    from app.product_materials_amazon import latest_job
    client, db, service, provider, _, _, material_id = reasoning_env
    service.context = MethodType(ProductReasoning.context, service)
    product = client.get('/api/products/BASIC/amazon-requirements').json()['product']
    with db.connect() as c:
        c.execute("""INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload)
            VALUES(%s,'original-one','source-one','v1:hash','Página 1','done',%s)""", (material_id,
            Jsonb({'id': 'source-one', 'name': 'manual.txt', 'segments': [
                {'locator': 'Página 1', 'text': 'Medidas nominales del diseño: 10 cm. Pendiente muestra física.'},
                {'locator': 'Página 1 · OCR · detalle', 'text': 'Medidas 10 cm', 'method': 'ocr'}]})))
        user = c.execute('SELECT * FROM users').fetchone()
        snapshot = service.requirements._snapshot(c, user, product)
        job = latest_job(c, user, product)
        sources = [r['data'] for r in c.execute('SELECT data FROM product_material_sources WHERE job_id=%s ORDER BY source_id', (material_id,)).fetchall()]
        fragments = c.execute('SELECT * FROM product_material_fragments WHERE job_id=%s ORDER BY id', (material_id,)).fetchall()
        original = build_context(product, snapshot, job, sources, fragments)
        enriched = service.context(c, user, product, snapshot, job)
    assert enriched['_reconciliationSourceStates']
    assert all(v['state'] == 'nominal' for v in enriched['_reconciliationSourceStates'].values())
    assert enriched['fingerprint'] == digest({'context': original['fingerprint'], 'policy': policy()})
    assert model_parts(enriched) == model_parts(original)
    assert provider.calls == []
