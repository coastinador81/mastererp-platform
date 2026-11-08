"""Voice capability claims use server facts, never a model's assertion."""
from dataclasses import replace
from uuid import uuid4

import pytest

from app.uony_provider import request_payload
from app.uony_voice_truth import VOICE_FACT, accurate_voice_reply, mentions_voice_feature, voice_status
from app.google_cloud_provider import SCOPE
from conftest import client_for, login
from test_google_cloud import Cloud
from test_uony_engine_pinning import setup


@pytest.mark.parametrize(('reply', 'status', 'expected'), [
    ('Sí, Gemini Live ya está activo y puedo escucharte.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    ('Estamos usando Gemini Live ahora mismo.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    ('No necesitas instalar nada: ya estamos utilizando Gemini Live.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    ('La voz de Google ya está activada para ti.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    ('Sí, tengo Live instalado y puedo escucharte.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    ('La voz en tiempo real está disponible.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    ('Gemini Live ya está activo.', 'pilot_exhausted',
     'El piloto de Gemini Live de tu cuenta ya agotó su sesión autorizada.'),
    ('Te hablo con Gemini Live ahora mismo.', 'pilot_ready',
     'Gemini Live está disponible en el botón de voz, pero esta respuesta'),
    ('Estamos utilizando Live para esta respuesta.', 'pilot_ready',
     'Gemini Live está disponible en el botón de voz, pero esta respuesta'),
])
def test_unverified_voice_claim_is_replaced_without_another_model_call(reply, status, expected):
    assert accurate_voice_reply(reply, status).startswith(expected)


@pytest.mark.parametrize('reply', [
    'Gemini Live no está activo en tu cuenta.',
    'Gemini Live podría estar disponible más adelante.',
    'El producto está disponible para revisión.',
])
def test_accurate_or_unrelated_reply_is_untouched(reply):
    assert accurate_voice_reply(reply, 'not_integrated') == reply


def test_pilot_available_does_not_mean_text_reply_uses_live():
    reply = 'Gemini Live está disponible en el botón de voz.'
    assert accurate_voice_reply(reply, 'pilot_ready') == reply
    payload = request_payload([{'role': 'user', 'parts': [{'text': '¿Usas Live ahora?'}]}],
                              {'liveVoice': 'pilot_ready'})
    instruction = payload['systemInstruction']['parts'][0]['text']
    assert VOICE_FACT['pilot_ready'] in instruction
    assert 'no afirmes que ya existe una sesión Live activa' in instruction


def test_voice_reference_is_withheld_from_unchecked_stream():
    assert not mentions_voice_feature('Gemini ')
    assert mentions_voice_feature('Gemini Live ya está activo')
    assert mentions_voice_feature('Te respondo con voz de Google')


def test_voice_status_requires_account_scope_and_budget(monkeypatch):
    from types import SimpleNamespace
    user = {'id': uuid4(), 'onboarding_completed_at': 'fixture'}
    scope = 'https://www.googleapis.com/auth/cloud-platform'
    settings = SimpleNamespace(live_pilot_user_ids=(str(user['id']),),
                               live_pilot_session_limit=1)
    status = {'projectReady': True}
    calls = []
    monkeypatch.setattr('app.uony_voice_truth.pilot_budget_available',
                        lambda connection, user_id, limit: calls.append((user_id, limit)) or True)
    assert voice_status(None, user, {'scope': scope}, settings, status) == 'pilot_ready'
    assert calls == [(user['id'], 1)]
    assert voice_status(None, user, {'scope': ''}, settings, status) == 'not_integrated'
    assert voice_status(None, user, {'scope': scope}, settings,
                        {'projectReady': False}) == 'not_integrated'
    assert voice_status(None, user, {'scope': scope},
                        SimpleNamespace(live_pilot_user_ids=(),
                                        live_pilot_session_limit=1), status) == 'not_integrated'
    monkeypatch.setattr('app.uony_voice_truth.pilot_budget_available',
                        lambda connection, user_id, limit: False)
    assert voice_status(None, user, {'scope': scope}, settings, status) == 'pilot_exhausted'


class FalseVoiceEngine:
    def __init__(self, reply):
        self.reply = reply
        self.seen = []

    def generate(self, token, project, history, status, model=None, effort=None, **kwargs):
        self.seen.append(status['liveVoice'])
        return self.reply, {'attemptedCalls': 1, 'calls': 1}


class StreamingFalseVoiceEngine(FalseVoiceEngine):
    def __init__(self, database, request_id):
        super().__init__('Gemini Live ya está activo.')
        self.database = database
        self.request_id = request_id
        self.provisional = []

    def generate(self, token, project, history, status, model=None, effort=None, **kwargs):
        self.seen.append(status['liveVoice'])
        kwargs['on_clear']()
        kwargs['on_attempt'](1)
        for prefix in ('Gemini ', 'Gemini Live', self.reply):
            kwargs['on_text'](prefix)
            with self.database.connect() as connection:
                row = connection.execute('''SELECT provisional_text FROM uony_conversation_jobs
                    WHERE request_id=%s''', (self.request_id,)).fetchone()
                self.provisional.append(row['provisional_text'])
        usage = {'attemptedCalls': 1, 'calls': 1}
        kwargs['on_complete'](1, usage)
        return self.reply, usage


@pytest.mark.parametrize(('pilot', 'reply', 'expected_status', 'expected_reply'), [
    (False, 'Sí, Gemini Live ya está activo.', 'not_integrated',
     'Gemini Live no está habilitado para tu cuenta ahora mismo.'),
    (True, 'Te hablo con Gemini Live ahora mismo.', 'pilot_ready',
     'Gemini Live está disponible en el botón de voz, pero esta respuesta'),
])
def test_worker_persists_verified_voice_claim(environment, pilot, reply,
                                               expected_status, expected_reply):
    settings, google, database = environment
    engine = FalseVoiceEngine(reply)
    with client_for(settings, google, cloud=Cloud(), uony=engine, legacy_sync=False) as seed:
        user_id = setup(seed, google, database, settings)
    if pilot:
        with database.connect() as connection:
            connection.execute('UPDATE google_cloud_connections SET scope=%s WHERE user_id=%s',
                               (SCOPE, user_id))
        settings = replace(settings, live_pilot_user_ids=(str(user_id),),
                           live_pilot_session_limit=1)
    with client_for(settings, google, cloud=Cloud(), uony=engine, legacy_sync=False) as client:
        login(client, google)
        body = {'requestId': str(uuid4()), 'threadId': 'truthful-voice',
                'text': '¿Ya usas Gemini Live?'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('truthful-voice-test')
        assert job is not None
        worker.run(job)
        result = client.get('/api/uony/requests/' + body['requestId']).json()
        assert result['status'] == 'success'
        assert result['response']['reply'].startswith(expected_reply)
        assert engine.seen == [expected_status]


def test_stream_does_not_show_unverified_voice_claim(environment, monkeypatch):
    settings, google, database = environment
    request_id = str(uuid4())
    engine = StreamingFalseVoiceEngine(database, request_id)
    monkeypatch.setattr('app.uony_conversation_worker.supports_streaming',
                        lambda engine_name, provider, enabled: True)
    with client_for(settings, google, cloud=Cloud(), uony=engine,
                    legacy_sync=False) as client:
        setup(client, google, database, settings)
        body = {'requestId': request_id, 'threadId': 'voice-stream-truth',
                'text': '¿Usas Gemini Live?'}
        assert client.post('/api/uony/messages', json=body).status_code == 202
        worker = client.app.state.conversation_worker
        job = worker.queue.claim('voice-stream-truth')
        assert job is not None
        worker.run(job)
        assert engine.provisional == ['Gemini ', '', '']
        result = client.get('/api/uony/requests/' + request_id).json()
        assert result['response']['reply'].startswith(
            'Gemini Live no está habilitado para tu cuenta ahora mismo.')
