"""Basic's real PTD journey, with fictional answers only in an isolated test schema."""
from copy import deepcopy
import json
import os
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
import pytest
from psycopg.types.json import Jsonb
from app.products import present, save
from app.product_requirements_fields import evaluate
from test_product_reasoning_continuity import continuity_env  # noqa: F401
from test_product_reasoning_jobs import reasoning_env, prepare  # noqa: F401
from test_product_requirements import requirement_env  # noqa: F401
from test_product_reasoning_refresh import install_refresh


def fixture_json(env, relative):
    path = Path(os.environ.get(env, str(Path(__file__).resolve().parents[2] / relative)))
    if not path.is_file(): pytest.skip(f'El runner necesita montar {relative} o indicar {env}.')
    return json.loads(path.read_text())


@pytest.fixture
def basic_review(continuity_env):
    client, db, service, provider, *_ = continuity_env
    schema = fixture_json('UONIFY_PTD_FIXTURE_PATH', 'artifacts/amazon-spapi/amazon-B07NPPMZM8-20261012/listing.schema.json')
    baseline = fixture_json('UONIFY_BASIC_SNAPSHOT_PATH', 'artifacts/data12-medidas-definitivas-20261015/after-chat.json')['product']
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        current = present(c.execute('SELECT * FROM products').fetchone())
        attributes = deepcopy(baseline['amazonAttributes'])
        del attributes['item_length_width'][0]['width']['value']
        save(c, user, {'revision': current['revision'], **{key: deepcopy(baseline[key])
            for key in ('name', 'brand', 'category', 'price', 'cost', 'stock', 'preparation')}}, 'BASIC',
            amazon_state={'amazonAttributes': attributes, 'amazonRequirementsContext': current['amazonRequirementsContext'],
                'amazonMaterialEvidence': {}})
        c.execute('UPDATE product_requirement_schemas SET schema=%s', (Jsonb(schema),))
    parent, _, _ = install_refresh(continuity_env, current_fields=baseline['customFields'], preserve_schema=True)
    prepared = prepare(continuity_env)
    assert prepared['evaluation']['counts'] == {'missing': 4, 'invalid': 0, 'questions': 5}
    assert prepared['evaluation']['reasoning']['status'] == 'completed'
    with db.connect() as c:
        c.execute('''INSERT INTO product_reasoning_calls(id,job_id,lease_token,phase,state,reserved_tokens,usage)
            VALUES(%s,%s,%s,'historical-unconfirmed','error',100,%s)''',
            (uuid4(), parent['id'], uuid4(), Jsonb({'calls': 1, 'unconfirmedCalls': 1})))
        ledger = c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall()
    return continuity_env, schema, prepared['product'], ledger


def start(client):
    response = client.post('/api/uony/messages', json={'requestId': str(uuid4()), 'threadId': 'basic-test-only',
        'text': 'Continúa la ficha de Basic.', 'requirementsAction': {'action': 'prepare', 'sku': 'BASIC'}})
    assert response.status_code == 200, response.text
    return response.json()


def answer(client, form, answers):
    body = {'requestId': str(uuid4()), 'threadId': 'basic-test-only', 'text': 'Respuesta ficticia de la prueba aislada.',
        'formResponse': {'formId': form['id'], 'answers': answers}}
    response = client.post('/api/uony/messages', json=body)
    assert response.status_code == 200, response.text
    assert client.post('/api/uony/messages', json=body).json() == response.json()
    return response.json()


def group(schema, product):
    plan = evaluate(schema, product['amazonAttributes'], 'A1RKKUPIHCS9HS')
    return {spec['path'][0] for spec in plan['specs'].values()}


def test_basic_weight_then_price_then_defer_and_resume_preserve_unresolved_review(basic_review):
    env, schema, before, ledger = basic_review
    client, db, service, provider, *_ = env
    calls = deepcopy(provider.calls)
    with patch('app.uony_provider.requests.post') as chat_model:
        result = start(client)
        form = result['conversationForm']
        assert len(form['fields']) == 2 and group(schema, before) == {'item_package_weight'}
        values = {f['id']: 'Kilogramos' if f['type'] == 'select' else '0,42' for f in form['fields']}
        result = answer(client, form, values)
        weight = result['productChanges'][0]['product']
        assert weight['amazonAttributes']['item_package_weight'][0]['value'] == .42
        assert weight['amazonAttributes']['item_package_weight'][0]['unit'] == 'kilograms'
        assert result['conversationForm']['reasoning']['status'] == 'completed', result
        assert group(schema, weight) == {'list_price'}
        assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['counts']['questions'] == 3
        for _ in range(2):
            assert prepare(env)['product'] == weight
        result = answer(client, result['conversationForm'], {f['id']: '19,99' for f in result['conversationForm']['fields']})
        priced = result['productChanges'][0]['product']
        assert priced['amazonAttributes']['list_price'][0]['value_with_tax'] == 19.99
        assert result['conversationForm']['reasoning']['status'] == 'completed', result
        assert group(schema, priced) == {'supplier_declared_dg_hz_regulation'}
        result = answer(client, result['conversationForm'], {'requirements_action': 'later'})
        paused = result['productChanges'][0]['product']
        assert result['conversationForm'] is None
        assert not paused['preparation']['sections']['atributos']['reviewed']
        assert paused['amazonAttributes'] == priced['amazonAttributes']
        assert paused['customFields'] == before['customFields'] and len(paused['customFields']) == 38
        resumed = start(client)
        assert resumed['conversationForm']['reasoning']['status'] == 'completed'
        assert group(schema, resumed['productChanges'][0]['product']) == {'supplier_declared_dg_hz_regulation'}
        assert client.get('/api/products/BASIC/amazon-requirements').json()['evaluation']['counts']['questions'] == 2
        assert paused['status'] == 'draft' and not paused['channels']['amazon']
        chat_model.assert_not_called()
    assert provider.calls == calls and service.queue.claim('no-new-analysis') is None
    with db.connect() as c:
        assert c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall() == ledger
    for key, value in before['amazonAttributes'].items():
        if key != 'list_price': assert paused['amazonAttributes'][key] == value


def test_basic_declared_hazard_answer_keeps_unrelated_audience_review(basic_review):
    env, schema, _, ledger = basic_review
    client, db, service, provider, *_ = env
    calls = deepcopy(provider.calls)
    with patch('app.uony_provider.requests.post') as chat_model:
        result = start(client)
        for attribute, selected in [('item_package_weight', '0,42'), ('list_price', '19,99'),
                                    ('supplier_declared_dg_hz_regulation', 'No aplicable')]:
            form = result['conversationForm']
            assert group(schema, result['productChanges'][0]['product']) == {attribute}
            result = answer(client, form, {f['id']: 'Kilogramos' if attribute == 'item_package_weight'
                and f['type'] == 'select' else selected for f in form['fields']})
            assert result['conversationForm']['reasoning']['status'] == 'completed', result
        assert group(schema, result['productChanges'][0]['product']) == {'target_audience_keyword'}
        result = answer(client, result['conversationForm'], {f['id']: 'Familias' for f in result['conversationForm']['fields']})
        final = result['productChanges'][0]['product']
        assert result['conversationForm'] is None
        current = client.get('/api/products/BASIC/amazon-requirements').json()
        assert current['evaluation']['state'] == 'locally_valid'
        assert current['evaluation']['counts'] == {'missing': 0, 'invalid': 0, 'questions': 0}
        assert current['product'] == final and final['preparation']['sections']['atributos']['reviewed']
        assert final['amazonAttributes']['target_audience_keyword'][0]['value'] == 'Familias'
        assert final['amazonAttributes']['supplier_declared_dg_hz_regulation'][0]['value'] == 'not_applicable'
        assert final['status'] == 'draft' and final['channels']['amazon'] is False
        assert prepare(env)['product'] == final
        assert start(client)['conversationForm'] is None
        assert provider.calls == calls and service.queue.claim('must-not-reask-audience') is None
        chat_model.assert_not_called()
    with db.connect() as c:
        assert c.execute('SELECT * FROM product_reasoning_calls ORDER BY id').fetchall() == ledger
