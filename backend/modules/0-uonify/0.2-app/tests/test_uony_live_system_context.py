"""Mid-session backend context is not a synthetic customer instruction."""
import asyncio
import json
from uuid import uuid4

import pytest

from app.uony_live_vertex import VertexLiveSession
from app.uony_live_delivery import status_instruction


class Socket:
    def __init__(self):
        self.sent = []

    async def send(self, message):
        self.sent.append(json.loads(message))


def test_backend_result_uses_documented_system_context_envelope():
    socket = Socket()
    session = VertexLiveSession(socket)
    asyncio.run(session.send_system_context('El trabajo 123 terminó.'))
    assert socket.sent == [{'clientContent': {
        'turns': [{'role': 'system', 'parts': [
            {'text': 'El trabajo 123 terminó.'}]}],
        'turnComplete': False}}]


def test_full_policy_and_history_fit_in_server_system_update():
    socket = Socket()
    session = VertexLiveSession(socket)
    history = 'user: conservar este encargo. ' * 220
    text = status_instruction(str(uuid4()), {'status': 'success'}, history)
    assert 2000 < len(text) <= 12000
    asyncio.run(session.send_system_context(text))
    assert socket.sent[0]['clientContent']['turns'][0]['parts'][0]['text'] == text
    assert history[:500] in text


@pytest.mark.parametrize('value', ['', ' texto', 'texto ', None, 123, 'x' * 12001])
def test_backend_context_rejects_invalid_or_oversized_values(value):
    socket = Socket()
    session = VertexLiveSession(socket)
    with pytest.raises(ValueError, match='invalid Live system context'):
        asyncio.run(session.send_system_context(value))
    assert socket.sent == []


def test_backend_context_rejects_closed_session():
    socket = Socket()
    session = VertexLiveSession(socket)
    session.closed = True
    with pytest.raises(ValueError, match='invalid Live system context'):
        asyncio.run(session.send_system_context('Trabajo terminado.'))
    assert socket.sent == []


def test_delayed_tool_response_schedules_only_the_original_call():
    socket = Socket()
    session = VertexLiveSession(socket)
    asyncio.run(session.respond_tool('original-call', 'get_current_work',
                                     {'status': 'complete'}, scheduling='WHEN_IDLE'))
    assert socket.sent == [{'toolResponse': {'functionResponses': [{
        'id': 'original-call', 'name': 'get_current_work',
        'response': {'status': 'complete'}, 'scheduling': 'WHEN_IDLE'}]}}]
    with pytest.raises(ValueError, match='invalid Live tool response'):
        asyncio.run(session.respond_tool('original-call', 'get_current_work',
                                         {}, scheduling='INTERRUPT'))
    assert len(socket.sent) == 1
