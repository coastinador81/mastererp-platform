"""Offline post-ready failures: no Google calls, audio logs, or account details."""
import asyncio
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.uony_live_bridge import LiveAudio
from test_uony_live_bridge import account_setup, bind, headers


@pytest.mark.parametrize('provider_fails,expected_class,expected_bridge_code', (
    (False, 'none', 1000), (True, 'ValueError', 1011),
))
def test_postready_provider_end_has_only_safe_diagnostics(
        environment, caplog, provider_fails, expected_class, expected_bridge_code):
    config, provider, database = environment
    account = account_setup(config, provider, database)[0]
    enabled = replace(config, live_pilot_user_ids=(str(account[0]),),
                      live_pilot_session_limit=1)
    pcm = b'\x01\x00' * 32

    class Session:
        def __init__(self):
            self.queue = asyncio.Queue()
            self.websocket = SimpleNamespace(close_code=1007 if provider_fails else 1000)

        async def send_audio(self, data):
            await self.queue.put(data)

        async def events(self):
            yield LiveAudio(await self.queue.get())
            if provider_fails:
                raise ValueError('private provider reason and account information')

        async def close(self):
            pass

    class Provider:
        async def open(self, identity):
            return Session()

    with TestClient(create_app(enabled, provider=provider, live=Provider()),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, account[3])) as socket:
            bind(socket, 'diagnostics-thread')
            socket.send_bytes(pcm)
            with pytest.raises(WebSocketDisconnect) as closed:
                # A terminal upstream socket can cut queued PCM before its
                # output task sends it. It must still report the real cause.
                while True:
                    message = socket.receive()
                    socket._raise_on_close(message)
                    if message.get('bytes'):
                        assert message['bytes'] == pcm
            assert closed.value.code == expected_bridge_code

    expected = (f'Live post-ready ended reason=provider_stream class={expected_class} '
                f'browser_ws_code=none bridge_ws_code={expected_bridge_code} '
                f'upstream_ws_code={1007 if provider_fails else 1000} '
                f'input_bytes={len(pcm)} output_bytes={len(pcm)}')
    assert expected in caplog.text
    assert 'private provider reason' not in caplog.text
    assert account[1] not in caplog.text
    assert account[2] not in caplog.text
