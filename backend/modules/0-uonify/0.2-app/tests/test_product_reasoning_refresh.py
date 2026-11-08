"""An audited dimension-only source refresh reuses unrelated paid resolutions."""
from copy import deepcopy
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.products import present, save
from app.product_reasoning import material_signature
from app.product_reasoning_refresh import independent_refreshed_targets
from app.product_materials_refresh import digest as refresh_digest
from test_product_reasoning_continuity import continuity_env, completed
from test_product_reasoning_jobs import reasoning_env, prepare
from test_product_requirements import requirement_env, value
from test_product_materials_dimensions import dimensions, custom


def test_weight_answer_after_documentary_refresh_reuses_other_reviewed_requirements(continuity_env):
    client, db, service, provider, *_ = continuity_env
    with db.connect() as c:
        schema = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        schema['properties']['item_package_weight'] = value('number', exclusiveMinimum=0)
        schema['required'].append('item_package_weight')
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    original, _, _ = install_refresh(continuity_env)
    prepare(continuity_env)
    with db.connect() as c:
        c.execute('''INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'old-rejected-request','error',100,%s)''',
            (uuid4(), original['id'], uuid4(), Jsonb({'calls': 1, 'unconfirmedCalls': 1})))
        ledger = c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall()
    calls = deepcopy(provider.calls)
    current = client.get('/api/products/BASIC/amazon-requirements?attribute=item_package_weight').json()
    from test_product_requirements import answer
    response = answer(client, current, '0,42', 'item_package_weight')
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['evaluation']['state'] == 'needs_input', result['evaluation']
    assert result['evaluation']['reasoning']['status'] == 'completed'
    assert result['product']['amazonAttributes']['item_package_weight'][0]['value'] == .42
    assert result['product']['customFields'] == current['product']['customFields']
    assert provider.calls == calls and service.queue.claim('must-not-repeat-after-refresh') is None
    assert prepare(continuity_env)['product'] == result['product']
    from test_product_reasoning_continuity import condition
    second = condition(client)
    assert second['evaluation']['reasoning']['status'] == 'completed'
    assert second['product']['amazonAttributes']['item_package_weight'][0]['value'] == .42
    assert prepare(continuity_env)['product'] == second['product']
    assert provider.calls == calls and service.queue.claim('must-not-repeat-second-answer') is None
    with db.connect() as c:
        assert c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall() == ledger


@pytest.mark.parametrize('change', ['audit', 'canonical_source', 'canonical_fragment'])
def test_answer_cannot_reuse_completed_refresh_when_its_audit_or_originals_change(continuity_env, change):
    client, db, _, provider, *_ = continuity_env
    with db.connect() as c:
        schema = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        schema['properties']['item_package_weight'] = value('number', exclusiveMinimum=0)
        schema['required'].append('item_package_weight')
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    install_refresh(continuity_env)
    prepare(continuity_env)
    calls = deepcopy(provider.calls)
    with db.connect() as c:
        if change == 'audit':
            c.execute('UPDATE product_material_refreshes SET summary=summary || %s', (Jsonb({'continuitySafe': False}),))
        elif change == 'canonical_source':
            c.execute('UPDATE product_material_sources SET data=data || %s', (Jsonb({'sha256': 'changed-again'}),))
        else:
            c.execute("UPDATE product_material_fragments SET payload=payload || %s WHERE id='refreshed-fragment'",
                (Jsonb({'newFact': 'Información añadida después de la revisión'}),))
    from test_product_requirements import answer
    current = client.get('/api/products/BASIC/amazon-requirements?attribute=item_package_weight').json()
    response = answer(client, current, '.42', 'item_package_weight')
    assert response.status_code == 200, response.text
    assert response.json()['evaluation']['reasoning']['status'] == 'queued'
    assert provider.calls == calls
    with db.connect() as c:
        latest = c.execute('SELECT context FROM product_reasoning_jobs ORDER BY created_at DESC LIMIT 1').fetchone()
        assert not latest['context'].get('_continuity')


def install_refresh(env, *, deferred=False, current_fields=None, preserve_schema=False):
    client, db, service, provider, *_ = env
    from app.product_materials_dimensions import dimension_key
    new_field = (next(f for f in current_fields if dimension_key(f['name']) == ('product', 'width'))
                 if current_fields else custom('Producto completo · ancho', '75 mm'))
    old_field = {**new_field, 'name': new_field['name'] + ' · diseño nominal'}
    old_fields = [old_field if f['id'] == new_field['id'] else f for f in (current_fields or [new_field])]
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        product = present(c.execute('SELECT * FROM products').fetchone())
        save(c, user, {'revision': product['revision'], 'customFields': old_fields}, product['sku'],
            amazon_state={k: deepcopy(product.get(k, {})) for k in ('amazonAttributes', 'amazonRequirementsContext', 'amazonMaterialEvidence')})
        schema = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        if not preserve_schema:
            schema['properties']['item_length_width'] = dimensions(axes=('width',))
            schema['required'].append('item_length_width')
        if deferred:
            schema['properties']['list_price'] = value('number')
            schema['required'].append('list_price')
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    original = completed(env)
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        product = present(c.execute('SELECT * FROM products').fetchone())
        if deferred:
            assert all(product.get(key) is None for key in ('price', 'cost', 'stock'))
            product = save(c, user, {'revision': product['revision'], 'price': '', 'cost': '', 'stock': ''}, product['sku'],
                source='uony', amazon_state={k: deepcopy(product[k]) for k in ('amazonAttributes', 'amazonRequirementsContext', 'amazonMaterialEvidence')})
        material = c.execute('SELECT * FROM product_material_jobs').fetchone()
        previous = deepcopy(material['result'])
        sources = [r['data'] for r in c.execute('SELECT data FROM product_material_sources ORDER BY source_id').fetchall()]
        # This fixture models the authenticated importer, without running a provider.
        current = deepcopy(previous); current['sources'][0].update(version='v2:hash2', sha256='hash2', modifiedTime='v2')
        request = str(uuid4())
        summary = {'continuitySafe': True,
            'previousMaterialSignature': material_signature({**previous, 'id': str(material['id']), 'status': 'ready'}),
            'currentMaterialSignature': material_signature({**current, 'id': str(material['id']), 'status': 'ready'})}
        old_field = next(f for f in product['customFields'] if f['id'] == old_field['id'])
        changes = [{'id': old_field['id'], 'before': old_field, 'after': {**old_field, 'name': new_field['name']}}]
        fragment = {'id': 'refreshed-fragment', 'source_id': 'source-one', 'version': 'v2:hash2',
            'state': 'partial', 'payload': {'id': 'source-one', 'segments': [{'locator': 'p1',
                'text': 'Dimensión definitiva de la caja: 7,5 centímetros.'}]}, 'result': {'extractionOnly': True}}
        c.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload,result)
            VALUES(%s,%s,%s,%s,'p1',%s,%s,%s)''', (material['id'], fragment['id'], fragment['source_id'],
            fragment['version'], fragment['state'], Jsonb(fragment['payload']), Jsonb(fragment['result'])))
        manifest = {'version': 1, 'selectiveSnapshots': True, 'sourcesBefore': sources,
                    'sourcesAfter': current['sources'], 'fragmentsBefore': [], 'productFieldChanges': changes,
                    'newFragmentHashes': {fragment['id']: refresh_digest(fragment)}}
        current['sourceRefresh'] = {'version': 1, 'requestId': request, **summary}
        c.execute('''INSERT INTO product_material_refreshes(user_id,request_id,job_id,product_id,revision,
            google_subject,payload_hash,owner_authorization,result_before,manifest,summary)
            VALUES(%s,%s,%s,%s,%s,%s,'test',%s,%s,%s,%s)''',
            (user['id'], request, material['id'], product['id'], product['revision'], user['google_subject'],
             Jsonb({'statement': 'Medidas definitivas'}), Jsonb(previous), Jsonb(manifest), Jsonb(summary)))
        c.execute('UPDATE product_material_jobs SET result=%s WHERE id=%s', (Jsonb(current), material['id']))
        c.execute('UPDATE product_material_sources SET version=%s,data=%s WHERE job_id=%s', ('v2:hash2', Jsonb(current['sources'][0]), material['id']))
        fields = [changes[0]['after'] if f['id'] == old_field['id'] else f for f in product['customFields']]
        after = save(c, user, {'revision': product['revision'], 'customFields': fields}, product['sku'],
            source='documentary-source-refresh', amazon_state={k: deepcopy(product[k]) for k in
                ('amazonAttributes', 'amazonRequirementsContext', 'amazonMaterialEvidence')})
    return original, after, request


def test_deferring_empty_commercial_fields_before_refresh_does_not_repeat_the_price_review(continuity_env):
    _, _, service, provider, *_ = continuity_env
    _, _, _ = install_refresh(continuity_env, deferred=True)
    calls = deepcopy(provider.calls)
    result = prepare(continuity_env)
    assert result['evaluation']['reasoning']['status'] == 'completed'
    assert all(result['product'][key] == '' for key in ('price', 'cost', 'stock'))
    assert provider.calls == calls and service.queue.claim('must-not-recheck-empty-price') is None


def test_refresh_completes_dimensions_without_repeating_unknown_questions_or_paid_calls(continuity_env):
    client, db, service, provider, *_ = continuity_env
    original, after, _ = install_refresh(continuity_env)
    with db.connect() as c:
        c.execute('''INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'old-rejected-request','error',100,%s)''',
            (uuid4(), original['id'], uuid4(), Jsonb({'calls': 1, 'unconfirmedCalls': 1})))
        ledger = c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall()
    calls = deepcopy(provider.calls)
    result = prepare(continuity_env)
    assert result['evaluation']['reasoning']['status'] == 'completed', result['evaluation']
    assert result['product']['amazonAttributes']['item_length_width'][0]['width']['value'] == 7.5
    assert result['product']['customFields'] == after['customFields']
    for key, value in after['amazonAttributes'].items():
        if key != 'item_length_width': assert result['product']['amazonAttributes'][key] == value
    assert provider.calls == calls and service.queue.claim('never-repeat') is None
    with db.connect() as c:
        row = c.execute('SELECT * FROM product_reasoning_jobs ORDER BY created_at DESC LIMIT 1').fetchone()
        assert row['context']['_continuity']['sourceJobId'] == str(original['id'])
        assert not row['context']['targets']
        assert service.queue.usage(c, row['id'])['calls'] == 0
        assert c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall() == ledger
    for _ in range(2):
        assert prepare(continuity_env)['product'] == result['product']
    assert provider.calls == calls


@pytest.mark.parametrize('change', ['source', 'canonical_source', 'missing_source', 'canonical_fragment', 'custom', 'audit', 'schema', 'google'])
def test_changed_refresh_scope_or_audit_does_not_bypass_reanalysis(continuity_env, change):
    client, db, service, _, *_ = continuity_env
    _, after, request = install_refresh(continuity_env)
    with db.connect() as c:
        if change == 'audit': c.execute("UPDATE product_material_refreshes SET summary=summary || %s", (Jsonb({'continuitySafe': False}),))
        elif change == 'google': c.execute("UPDATE product_material_refreshes SET google_subject='other-google'")
        elif change == 'schema': c.execute("UPDATE product_reasoning_jobs SET schema_hash='other-schema'")
        elif change == 'source':
            row = c.execute('SELECT result FROM product_material_jobs').fetchone()['result']; row['sources'][0]['sha256'] = 'changed-again'
            c.execute('UPDATE product_material_jobs SET result=%s', (Jsonb(row),))
        elif change == 'canonical_source':
            c.execute("UPDATE product_material_sources SET data=data || %s", (Jsonb({'sha256': 'another-version'}),))
        elif change == 'missing_source':
            c.execute('DELETE FROM product_material_sources')
        elif change == 'canonical_fragment':
            job = c.execute('SELECT id FROM product_material_jobs').fetchone()
            c.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,state,payload,result)
                VALUES(%s,'new-unaudited','source-one','v2:hash2','p1','done',%s,%s)''',
                (job['id'], Jsonb({'text': 'New information'}), Jsonb({})))
        else:
            user = c.execute('SELECT * FROM users').fetchone()
            save(c, user, {'revision': after['revision'], 'brand': 'Different physical product'}, after['sku'])
    result = prepare(continuity_env)
    assert result['evaluation']['reasoning']['status'] == 'queued'
