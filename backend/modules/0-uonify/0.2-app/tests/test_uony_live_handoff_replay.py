"""A durable admission outlives an unavailable job; never replay its effects."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.uony_live_bridge import LiveStatus, LiveTranscript
from test_uony_live_bridge import FakeLive, bind, headers
from test_uony_live_handoff import prepared, tool


def test_missing_job_replay_is_blocked_without_closing_voice_or_reenqueuing(environment):
    settings, provider, database, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'replay-missing-job')
            text = 'Quiero crear un producto en Amazon.'
            fake.sessions[0].emit(LiveTranscript('user', str(uuid4()), text))
            assert ws.receive_json()['type'] == 'transcript'
            admitted = ws.receive_json()
            assert admitted['type'] == 'handoff'
            with database.connect() as connection:
                connection.execute('''DELETE FROM uony_conversation_jobs
                    WHERE user_id=%s AND request_id=%s''',
                    (account[0], admitted['requestId']))
            tool(fake.sessions[0], text, call_id='late-provider-call')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1] == (
                'late-provider-call', 'route_spoken_request',
                {'status': 'blocked', 'reason': 'request_not_found'})
            fake.sessions[0].emit(LiveStatus('listening'))
            assert ws.receive_json() == {'type': 'status', 'state': 'listening'}
            with database.connect() as connection:
                assert connection.execute('''SELECT count(*) AS n
                    FROM uony_live_handoffs WHERE user_id=%s''',
                    (account[0],)).fetchone()['n'] == 1
                assert connection.execute('''SELECT count(*) AS n
                    FROM uony_conversation_jobs WHERE user_id=%s''',
                    (account[0],)).fetchone()['n'] == 0
