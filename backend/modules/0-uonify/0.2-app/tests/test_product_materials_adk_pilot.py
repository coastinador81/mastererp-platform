"""No-network contract checks for the optional ADK materials pilot."""
import json
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.google_cloud_provider import CloudError
from app.product_materials import ProductMaterials
from app.product_materials_adk import AdkMaterialsAnalyzer, pilot_adapter
from app.product_materials_analyzer import ANALYSIS_MODEL, analysis_parts
from app.settings import load_settings
from conftest import client_for
from test_google_cloud import Cloud
from test_product_material_engine_pinning import connect_account, current_user, start
from test_product_materials import Analyzer, FolderDrive
from test_uony import ready


SOURCE = {'id': 'file-one', 'name': 'Ficha.json', 'segments': [
    {'locator': '$.piezas', 'text': '54'}]}


class FakeAdkModel:
    def __init__(self, response):
        self.response = response
        self.requests = []
        self.closed = 0
        self.api_client = SimpleNamespace(aio=SimpleNamespace(aclose=self.close))

    async def close(self):
        self.closed += 1

    async def generate_content_async(self, request, stream=False):
        self.requests.append((request, stream))
        yield self.response


def response_for(data, *, tool=False, token_count=400):
    parts = [types.Part(text=json.dumps(data))]
    if tool:
        parts.append(types.Part(function_call=types.FunctionCall(name='create_product', args={})))
    return LlmResponse(
        content=types.Content(role='model', parts=parts),
        finish_reason=types.FinishReason.STOP,
        usage_metadata=types.GenerateContentResponseUsageMetadata(total_token_count=token_count),
    )


def test_pilot_adapter_is_absent_with_default_flags(environment):
    config, _, _ = environment
    assert config.material_adk_pilot_user_ids == ()
    assert pilot_adapter(config) is None
    selected = replace(config, material_adk_pilot_user_ids=(str(uuid4()),))
    assert isinstance(pilot_adapter(selected), AdkMaterialsAnalyzer)


def test_document_pilot_file_is_separate_account_allowlist(tmp_path, monkeypatch):
    pilot = str(uuid4())
    (tmp_path / 'google-oauth.json').write_text(json.dumps({'web': {}}))
    (tmp_path / 'postgres-password').write_text('test-only')
    (tmp_path / 'encryption-key').write_text('test-only')
    monkeypatch.setenv('UONIFY_SECRETS_DIR', str(tmp_path))
    monkeypatch.setenv('UONIFY_MATERIAL_ADK_PILOT_USERS', pilot)
    default = load_settings()
    assert default.material_adk_pilot_user_ids == ()
    assert default.adk_pilot_user_ids == ()
    assert pilot_adapter(default) is None

    file = tmp_path / 'material-adk-pilot-users.json'
    file.write_text(json.dumps({'userIds': [pilot]}))
    enabled = load_settings()
    assert enabled.material_adk_pilot_user_ids == (pilot,)
    assert enabled.adk_pilot_user_ids == ()
    assert enabled.live_pilot_user_ids == ()
    assert isinstance(pilot_adapter(enabled), AdkMaterialsAnalyzer)

    for invalid in ({'userIds': [pilot, pilot]}, {'userIds': ['invalid']},
                    {'userIds': [pilot], 'sessionLimit': 1}):
        file.write_text(json.dumps(invalid))
        with pytest.raises(RuntimeError, match='piloto material-adk-pilot-users.json'):
            load_settings()


def test_adk_adapter_is_one_bounded_tool_free_request_with_classic_source_payload(monkeypatch):
    model = FakeAdkModel(response_for({'observations': [
        {'sourceId': SOURCE['id'], 'summary': 'Ficha revisada.'}], 'proposals': []}))
    monkeypatch.setattr('app.product_materials_adk._model_for_request',
                        lambda token, project, name, genai_types: model)
    result = AdkMaterialsAnalyzer().analyze('fake-token', 'project-fixture', {'name': 'Torre'}, [SOURCE])
    assert result['observations'] == {'file-one': 'Ficha revisada.'}
    assert result['usage'] == {'calls': 1, 'totalTokenCount': 400}
    assert len(model.requests) == model.closed == 1
    request, stream = model.requests[0]
    assert not stream and request.model == ANALYSIS_MODEL and request.tools_dict == {}
    assert request.config.max_output_tokens == 8192
    assert request.config.automatic_function_calling.disable is True
    assert request.config.automatic_continuation is False
    assert request.config.response_mime_type == 'application/json'
    assert [part.model_dump(by_alias=True, exclude_none=True) for part in request.contents[0].parts]
    assert json.loads(request.contents[0].parts[0].text.split(': ', 1)[1]) == {'name': 'Torre'}
    assert len(analysis_parts({'name': 'Torre'}, [SOURCE])) == len(request.contents[0].parts)


def test_adk_adapter_rejects_model_tool_call_even_when_json_is_valid(monkeypatch):
    model = FakeAdkModel(response_for({'observations': [], 'proposals': []}, tool=True))
    monkeypatch.setattr('app.product_materials_adk._model_for_request',
                        lambda *_: model)
    with pytest.raises(CloudError) as rejected:
        AdkMaterialsAnalyzer().analyze('fake-token', 'project-fixture', {'name': 'Torre'}, [SOURCE])
    assert rejected.value.code == 'invalid_response'
    assert rejected.value.usage == {'calls': 1, 'totalTokenCount': 400}
    assert model.closed == 1


def test_adk_adapter_invalid_json_is_not_a_free_provider_call(monkeypatch):
    model = FakeAdkModel(LlmResponse(
        content=types.Content(role='model', parts=[types.Part(text='{')]),
        finish_reason=types.FinishReason.STOP,
    ))
    monkeypatch.setattr('app.product_materials_adk._model_for_request', lambda *_: model)
    with pytest.raises(CloudError) as rejected:
        AdkMaterialsAnalyzer().analyze('fake-token', 'project-fixture', {}, [SOURCE])
    assert rejected.value.code == 'invalid_response'
    assert rejected.value.usage == {'calls': 1, 'totalTokenCount': 0, 'unconfirmedCalls': 1}
    assert model.closed == 1


class RecordedAnalyzer(Analyzer):
    def __init__(self, arm, simulated_latency_ms, simulated_cost_usd):
        super().__init__()
        self.arm = arm
        self.simulated_latency_ms = simulated_latency_ms
        self.simulated_cost_usd = simulated_cost_usd
        self.projects = []

    def analyze(self, token, project, product, sources):
        self.projects.append(project)
        return super().analyze(token, project, product, sources)


def test_classic_and_adk_fake_arms_share_queue_contract_without_double_execution(environment):
    config, google, db = environment
    drive, cloud = FolderDrive(), Cloud()
    classic = RecordedAnalyzer('classic', 900, 0.003)
    adk = RecordedAnalyzer('adk', 950, 0.0032)
    with client_for(config, google, drive=drive, cloud=cloud) as client:
        ready(client, google, db)
        first_user = current_user(db, google.subject)
        connect_account(db, config, first_user)
        assert client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'}).status_code == 200
        google.subject, google.email = 'pilot-second', 'second@example.test'
        ready(client, google, db)
        second_user = current_user(db, google.subject)
        connect_account(db, config, second_user)
        assert client.post('/api/products', json={'sku': 'PILOT', 'name': 'Torre'}).status_code == 200

        selected = replace(config, material_adk_pilot_user_ids=(str(first_user['id']),))
        service = ProductMaterials(selected, db, drive, cloud, classic, adk_analyzer=adk)
        first = start(service, db, first_user, uuid4())
        second = start(service, db, second_user, uuid4())
        service.run(first['id'], first_user['id'])
        service.run(second['id'], second_user['id'])
        assert adk.calls == classic.calls == 1
        assert adk.projects == classic.projects == ['project-fixture']
        with db.connect() as c:
            rows = c.execute('''SELECT user_id,engine,status,result FROM product_material_jobs
                WHERE id IN (%s,%s)''', (first['id'], second['id'])).fetchall()
            calls = c.execute('''SELECT j.engine,count(*) AS calls FROM product_material_calls k
                JOIN product_material_jobs j ON j.id=k.job_id WHERE j.id IN (%s,%s)
                GROUP BY j.engine''', (first['id'], second['id'])).fetchall()
            products = c.execute('SELECT user_id,sku,revision FROM products ORDER BY user_id').fetchall()
        by_user = {row['user_id']: row for row in rows}
        assert by_user[first_user['id']]['engine'] == 'adk'
        assert by_user[second_user['id']]['engine'] == 'classic'
        assert all(row['status'] == 'ready' for row in rows)
        assert {row['engine']: row['calls'] for row in calls} == {'adk': 1, 'classic': 1}
        assert rows[0]['result']['proposals'] == rows[1]['result']['proposals']
        assert len(products) == 2 and all(row['revision'] == 1 for row in products)
        # These are invented measurements for harness shape only: they cannot
        # authorize a paid pilot or establish real p95, quality or cost.
        simulated = {arm.arm: (arm.simulated_latency_ms, arm.simulated_cost_usd)
                     for arm in (classic, adk)}
        assert simulated['adk'][0] / simulated['classic'][0] < 1.1
        assert simulated['adk'][1] / simulated['classic'][1] < 1.1
