"""A fixed continuity policy can recover locally without rewriting old cost records."""
from copy import deepcopy
from uuid import uuid4
from psycopg.types.json import Jsonb
from test_product_reasoning_continuity import continuity_env, completed, condition
from test_product_reasoning_jobs import reasoning_env, prepare
from test_product_requirements import requirement_env, answer


def test_v2_ignores_v1_frozen_subset_and_falls_back_to_original_completed(continuity_env, monkeypatch):
    client, db, service, provider, *_ = continuity_env
    import app.product_reasoning_continuity as continuity
    current_version = continuity.CONTINUITY_VERSION
    current_dependencies = continuity.dependency_closure
    monkeypatch.setattr(continuity, 'CONTINUITY_VERSION', 1)
    with db.connect() as c:
        schema = c.execute('SELECT schema FROM product_requirement_schemas').fetchone()['schema']
        schema['properties']['fulfillment_availability'] = {'type': 'array', 'title': 'Envío de pedidos', 'minItems': 1,
            'items': {'type': 'object', 'required': ['fulfillment_channel_code'], 'properties': {
                'fulfillment_channel_code': {'type': 'string', 'title': 'Quién envía', 'enum': ['DEFAULT', 'AMAZON_EU']}}}}
        schema['required'].append('fulfillment_availability')
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    original = completed(continuity_env)
    condition(client)
    with db.connect() as c:
        v1_complete = c.execute("SELECT * FROM product_reasoning_jobs WHERE status='completed' AND id!=%s", (original['id'],)).fetchone()
        assert v1_complete['context']['_continuity']['version'] == 1
        unknown_call = uuid4()
        c.execute("""INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'historical-request','error',100,%s)""",
            (unknown_call, original['id'], uuid4(), Jsonb({'calls': 1, 'unconfirmedCalls': 1})))
    # Reproduce the previous over-invalidation; only material is inherited.
    monkeypatch.setattr(continuity, 'dependency_closure', lambda schema, changed, *args:
        changed | {'battery'} if 'fulfillment_availability' in changed else current_dependencies(schema, changed, *args))
    pending = client.get('/api/products/BASIC/amazon-requirements?attribute=fulfillment_availability').json()
    assert pending['evaluation']['fields'], pending['evaluation']
    choice = next(option for option in pending['evaluation']['fields'][0]['options'] if 'Europa' in option)
    response = answer(client, pending, choice, 'fulfillment_availability')
    assert response.status_code == 200, response.text
    after = response.json()
    assert after['evaluation']['reasoning']['status'] == 'unknown'
    with db.connect() as c:
        legacy = c.execute("SELECT * FROM product_reasoning_jobs WHERE status='unknown'").fetchone()
        assert legacy['result']['continuity']['reusedTargetIds'] == [
            t['id'] for t in legacy['context']['_continuity']['currentTargets'] if t['path'][0] == 'material']
        previous_jobs = c.execute('SELECT id,status,result,context FROM product_reasoning_jobs ORDER BY created_at').fetchall()
        previous_calls = c.execute('SELECT * FROM product_reasoning_calls ORDER BY created_at').fetchall()
    paid_calls = deepcopy(provider.calls)
    monkeypatch.setattr(continuity, 'dependency_closure', current_dependencies)
    monkeypatch.setattr(continuity, 'CONTINUITY_VERSION', current_version)
    recovered = prepare(continuity_env)
    assert recovered['evaluation']['state'] == 'needs_input'
    assert recovered['evaluation']['reasoning']['status'] == 'completed'
    assert recovered['product'] == after['product'] and provider.calls == paid_calls
    assert service.queue.claim('must-not-analyze-again') is None
    with db.connect() as c:
        fresh = c.execute('SELECT * FROM product_reasoning_jobs ORDER BY created_at DESC LIMIT 1').fetchone()
        assert fresh['result']['continuity']['sourceJobId'] == str(original['id'])
        assert fresh['context']['_continuity']['version'] == current_version
        assert len(fresh['result']['continuity']['reusedTargetIds']) == 2
        assert not fresh['context']['targets'] and service.queue.usage(c, fresh['id'])['calls'] == 0
        assert c.execute('SELECT * FROM product_reasoning_calls ORDER BY created_at').fetchall() == previous_calls
        assert c.execute('SELECT id,status,result,context FROM product_reasoning_jobs WHERE id!=%s ORDER BY created_at', (fresh['id'],)).fetchall() == previous_jobs
        assert c.execute('SELECT acknowledged_at FROM product_reasoning_calls WHERE id=%s', (unknown_call,)).fetchone()['acknowledged_at'] is None
    for _ in range(2):
        assert prepare(continuity_env)['product'] == after['product']
    assert provider.calls == paid_calls
