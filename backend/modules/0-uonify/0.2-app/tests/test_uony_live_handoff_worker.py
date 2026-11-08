"""Live worker preparation and fenced action checks with fake providers."""
from dataclasses import replace
from uuid import uuid4
import time

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.main import create_app
from app.uony_live_bridge import LiveTranscript
from test_google_cloud import Cloud
from test_uony_live_bridge import FakeLive, bind, headers
from test_uony_live_handoff import prepared, tool


def claim_after_disconnect(worker, name):
    # A closing voice session may still hold the owner's row while persisting
    # its checkpoint. SKIP LOCKED correctly leaves that account for next poll.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        job = worker.queue.claim(name)
        if job:
            return job
        time.sleep(.02)
    return None


class ProbeEngine:
    def __init__(self):
        self.calls = []

    def generate(self, token, project, history, context, model=None,
                 effort=None, **kwargs):
        usage = {'attemptedCalls': 1, 'calls': 1, 'totalTokenCount': 5}
        if kwargs.get('on_attempt'):
            kwargs['on_attempt'](1)
        if kwargs.get('on_complete'):
            kwargs['on_complete'](1, usage)
        names = {item['name'] for item in context.declarations}
        denied = {name: context.call(name, {}) for name in (
            'create_product', 'render_blender_preview',
            'start_incident_resolution')}
        card = context.call('show_product_intake', {})
        self.calls.append({'names': names, 'denied': denied, 'card': card})
        return 'Te muestro la selección de materiales.', usage


class CreativeProbeEngine:
    def generate(self, token, project, history, context, model=None,
                 effort=None, **kwargs):
        usage = {'attemptedCalls': 1, 'calls': 1, 'totalTokenCount': 5}
        if kwargs.get('on_attempt'):
            kwargs['on_attempt'](1)
        if kwargs.get('on_complete'):
            kwargs['on_complete'](1, usage)
        names = {item['name'] for item in context.declarations}
        assert 'prepare_creative_plan' in names
        assert 'get_creative_plan' in names
        assert 'create_product' not in names
        prepared = context.call('prepare_creative_plan', {
            'recipe': 'cinematic_video',
            'objective': 'Una ciudad futurista bajo la lluvia nocturna',
            'sourceMode': 'uony_concept',
        })
        assert prepared['prepared'] is True
        assert context.call('create_product', {})['error'] == 'tool_requires_fenced_work'
        return 'He preparado el borrador; elige después el modelo de vídeo.', usage


@pytest.mark.parametrize('model_tool', (True, False))
def test_creative_voice_handoff_can_save_draft_without_media_spend(environment, model_tool):
    settings, provider, db, account = prepared(environment)
    settings = replace(settings, adk_pilot_user_ids=())
    fake_live, engine, cloud = FakeLive(), CreativeProbeEngine(), Cloud()
    with db.connect() as c:
        c.execute('''UPDATE google_cloud_connections SET refresh_encrypted=%s
            WHERE user_id=%s''',
            (Fernet(settings.encryption_key).encrypt(
                b'fixture-refresh-only').decode(), account[0]))
    with TestClient(create_app(settings, provider=provider, cloud=cloud,
            uony=engine, live=fake_live), base_url=settings.origin) as client:
        worker = client.app.state.conversation_worker
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'voice-creative')
            spoken = (('Quiero hacer un video cinematográfico de una ciudad futurista '
                       'bajo la lluvia. No tengo materiales; hazlo de cero.') if model_tool else
                      'Diseña desde cero un video corto de una ciudad futurista bajo la lluvia. '
                      'Prepara el plan, pero no generes medios.')
            turn_id = str(uuid4())
            fake_live.sessions[0].emit(LiveTranscript('user', turn_id, spoken,
                finalized_by='provider_finished' if model_tool else 'model_turn_complete'))
            assert ws.receive_json()['type'] == 'transcript'
            if model_tool:
                tool(fake_live.sessions[0], spoken, intent='creative_plan')
            handoff = ws.receive_json()
            assert handoff['type'] == 'handoff'
            assert handoff['status'] == 'queued'
            request_id = handoff['requestId']
        job = claim_after_disconnect(worker, 'offline-creative-worker')
        assert job
        worker.run(job)
        receipt = client.get('/api/uony/requests/' + request_id,
                             headers=headers(settings, account[3])).json()
        assert receipt['status'] == 'success'
        with db.connect() as c:
            plan = c.execute('''SELECT plan,spend_limit_usd FROM uony_creative_plans
                WHERE user_id=%s AND thread_id=%s''',
                (account[0], 'voice-creative')).fetchone()
            assert plan['plan']['sourceMode'] == 'uony_concept'
            assert plan['spend_limit_usd'] == 0


@pytest.mark.parametrize('adk', (False, True))
def test_live_worker_prepares_card_but_denies_execution_tools(environment, adk):
    settings, provider, db, account = prepared(environment)
    if not adk:
        settings = replace(settings, adk_pilot_user_ids=())
    fake_live, fake_engine, cloud = FakeLive(), ProbeEngine(), Cloud()
    with db.connect() as c:
        c.execute('''UPDATE google_cloud_connections SET refresh_encrypted=%s
            WHERE user_id=%s''',
            (Fernet(settings.encryption_key).encrypt(
                b'fixture-refresh-only').decode(), account[0]))
    with TestClient(create_app(settings, provider=provider, cloud=cloud,
            uony=fake_engine, live=fake_live), base_url=settings.origin) as client:
        worker = client.app.state.conversation_worker
        if adk:
            worker.providers._providers['adk'] = fake_engine
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'worker-card')
            spoken = 'Quiero crear un producto en Amazon con documentos de Drive.'
            turn_id = str(uuid4())
            fake_live.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake_live.sessions[0], spoken, intent='use_drive_materials')
            request_id = ws.receive_json()['requestId']
        job = claim_after_disconnect(worker, 'offline-live-worker')
        assert job and job['engine'] == ('adk' if adk else 'classic')
        worker.run(job)
        receipt = client.get('/api/uony/requests/' + request_id,
                             headers=headers(settings, account[3])).json()
        assert receipt['status'] == 'success'
        assert receipt['response']['productIntake']['id']
        assert len(fake_engine.calls) == 1
        probe = fake_engine.calls[0]
        assert 'show_product_intake' in probe['names']
        assert 'create_product' not in probe['names']
        assert all(result['error'] == 'tool_requires_fenced_work'
                   for result in probe['denied'].values())
        assert probe['card']['prepared'] is True
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM products
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            assert c.execute('''SELECT count(*) AS n FROM product_material_jobs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
        # Ordinary written turns retain their existing tool declarations.
        # Reuse this thread after its intake exists: context history must honor
        # that real boundary even with the Live handoff JOIN.
        written = client.post('/api/uony/messages',
            json={'requestId': str(uuid4()), 'threadId': 'worker-card',
                  'text': 'Prepara otro producto en Amazon.'},
            headers=headers(settings, account[3]))
        assert written.status_code == 202
        next_job = worker.queue.claim('offline-written-worker')
        assert next_job
        worker.run(next_job)
        assert len(fake_engine.calls) == 2
        assert 'create_product' in fake_engine.calls[1]['names']
