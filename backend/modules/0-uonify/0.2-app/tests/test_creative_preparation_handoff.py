"""La lectura creativa se admite en el worker hablado sin otra vía de ejecución."""
from dataclasses import replace
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.main import create_app
from app.uony_live_bridge import LiveTranscript
from test_creative_preparation import _seed
from test_creative_preparation_integration import PreparationReader
from test_google_cloud import Cloud
from test_uony_live_bridge import FakeLive, bind, headers
from test_uony_live_handoff import prepared, tool
from test_uony_live_handoff_worker import claim_after_disconnect


@pytest.mark.parametrize('adk', [False, True])
def test_creative_handoff_reads_preparation_in_the_existing_worker(environment, adk):
    settings, google, database, account = prepared(environment)
    if not adk:
        settings = replace(settings, adk_pilot_user_ids=())
    with database.connect() as connection:
        connection.execute('UPDATE google_cloud_connections SET refresh_encrypted=%s WHERE user_id=%s',
            (Fernet(settings.encryption_key).encrypt(b'fixture-refresh-only').decode(), account[0]))
        _seed(connection, account[0], account[1], thread='creative-handoff-read')
    live, reader = FakeLive(), PreparationReader()
    with TestClient(create_app(settings, provider=google, cloud=Cloud(),
            uony=reader, live=live), base_url=settings.origin) as client:
        worker = client.app.state.conversation_worker
        if adk:
            worker.providers._providers['adk'] = reader
        with client.websocket_connect('/api/uony/live', headers=headers(settings, account[3])) as socket:
            bind(socket, 'creative-handoff-read')
            text = 'Quiero preparar un vídeo creativo. Consulta el estado del plan guardado.'
            live.sessions[0].emit(LiveTranscript('user', str(uuid4()), text))
            assert socket.receive_json()['type'] == 'transcript'
            tool(live.sessions[0], text, intent='creative_plan')
            handoff = socket.receive_json()
            assert handoff['type'] == 'handoff', handoff
        job = claim_after_disconnect(worker, 'creative-preparation-handoff-test')
        assert job and job['engine'] == ('adk' if adk else 'classic')
        worker.run(job)
        receipt = client.get('/api/uony/requests/' + handoff['requestId'],
                             headers=headers(settings, account[3])).json()
        assert receipt['status'] == 'success', receipt
        assert reader.calls == 1 and reader.read['creativePreparation']['state'] == 'stale'
        assert 'necesita revisarse' in receipt['response']['reply']
        with database.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM uony_conversation_jobs').fetchone()['n'] == 1
            assert connection.execute('SELECT count(*) AS n FROM creative_generation_attempts').fetchone()['n'] == 0
