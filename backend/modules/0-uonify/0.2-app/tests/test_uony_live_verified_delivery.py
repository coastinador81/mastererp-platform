"""One durable ADK result, one audio envelope, and a real client acknowledgement."""
import time
from uuid import uuid4
from dataclasses import replace
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from app.main import create_app
from app.uony_live_adk_narration import VerifiedLiveSpeech
from app.uony_live_bridge import LiveTranscript, LiveStatus
from test_google_cloud import Cloud
from test_uony_live_bridge import FakeLive, bind, headers
from test_uony_live_handoff import prepared, tool
from test_uony_live_handoff_worker import ProbeEngine


class NarratingLive(FakeLive):
    def __init__(self):
        super().__init__()
        self.narrations = []

    async def render_verified(self, identity, text):
        self.narrations.append(text)
        return VerifiedLiveSpeech((b'\1\0\2\0',), text,
            ({'totalTokenCount': 12},), 25)


def claim(worker):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        job = worker.queue.claim('delivery-fixture')
        if job:
            return job
        time.sleep(.02)
    raise AssertionError('No claimable job')


def test_adk_result_without_call_id_speaks_once_and_reconnect_only_recovers(environment):
    settings, provider, db, account = prepared(environment)
    live, model = NarratingLive(), ProbeEngine()
    project_id = uuid4()
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (account[0], project_id))
        c.execute('''UPDATE google_cloud_connections SET refresh_encrypted=%s
            WHERE user_id=%s''', (Fernet(settings.encryption_key).encrypt(
                b'fixture-refresh-only').decode(), account[0]))
    with TestClient(create_app(settings, provider=provider, cloud=Cloud(),
            uony=model, live=live), base_url=settings.origin) as client:
        worker = client.app.state.conversation_worker
        worker.providers._providers['adk'] = model
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'verified-result', project_id)
            turn = str(uuid4())
            spoken = 'Quiero crear un producto en Amazon.'
            live.sessions[0].emit(LiveTranscript('user', turn, spoken,
                finalized_by='provider_finished'))
            assert ws.receive_json()['type'] == 'transcript'
            queued = ws.receive_json()
            job = claim(worker)
            assert job['engine'] == 'adk'
            worker.run(job)
            terminal = ws.receive_json()
            assert terminal['status'] == 'success'
            start = ws.receive_json()
            assert start['type'] == 'speech_delivery' and start['phase'] == 'start'
            assert ws.receive_bytes() == b'\1\0\2\0'
            assert ws.receive_json() == {**start, 'phase': 'end'}
            persisted = client.get('/api/uony/requests/' + queued['requestId'],
                headers=headers(settings, account[3])).json()
            assert live.narrations == [persisted['response']['reply']]
            assert live.sessions[0].tool_responses == []
            ws.send_json({'type': 'speech_ack', 'eventId': start['eventId'], 'outcome': 'played'})
            live.sessions[0].emit(LiveStatus('listening'))
            assert ws.receive_json()['state'] == 'listening'
            with db.connect() as c:
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    receipt = c.execute('SELECT * FROM uony_live_deliveries WHERE event_id=%s',
                                        (start['eventId'],)).fetchone()
                    if receipt['state'] == 'acknowledged':
                        break
                    time.sleep(.02)
                assert receipt['state'] == 'acknowledged'
                assert receipt['usage']['totalTokenCount'] == 12
            # A late genuine function call gets the same result, no second job/audio.
            tool(live.sessions[0], spoken, intent='create_product', call_id='late')
            assert live.sessions[0].tool_response_event.wait(2)
            assert live.sessions[0].tool_responses[-1][2]['requestId'] == queued['requestId']
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'verified-result', project_id)
            recovered = ws.receive_json()
            assert recovered['requestId'] == queued['requestId']
            assert recovered['status'] == 'success'
            live.sessions[1].emit(LiveStatus('listening'))
            assert ws.receive_json()['state'] == 'listening'
        assert len(model.calls) == len(live.narrations) == 1
        with db.connect() as c:
            assert c.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 1
            assert c.execute('SELECT count(*) AS n FROM products').fetchone()['n'] == 0
        metrics = client.get('/api/uony/monitoring/queue', params={'projectId': str(project_id)},
                             headers=headers(settings, account[3]))
        assert metrics.status_code == 200
        assert metrics.json()['voiceDelivery'][0]['state'] == 'acknowledged'
        assert metrics.json()['timings']['providerMs']['samples'] == 1
        assert client.get('/api/uony/monitoring/queue', params={'projectId': str(uuid4())},
                          headers=headers(settings, account[3])).status_code == 404
        assert client.get('/api/uony/monitoring/queue').status_code == 401
