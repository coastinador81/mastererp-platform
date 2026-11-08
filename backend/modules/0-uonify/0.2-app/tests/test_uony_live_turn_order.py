"""Causal speech boundaries with delayed, provider-owned transcription."""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.uony_live_bridge import (LiveSpeechEnded, LiveSpeechStarted,
                                  LiveIdentity, LiveTranscript, LiveTranscriptPreview,
                                  LiveUnconfirmedTurn,
                                  _bind, _save_transcript)
from app.uony_live_vertex import VertexLiveSession
from test_uony_live_bridge import account_setup, headers
from test_uony_live_signal_diagnostics import Frames


START = {'voiceActivity': {'voiceActivityType': 'ACTIVITY_START'}}
END = {'voiceActivity': {'voiceActivityType': 'ACTIVITY_END'}}


def test_unfinished_order_at_model_boundary_emits_warning_only():
    events = collect([START, END,
        {'inputTranscription': {'text': 'Analiza la carpeta de Drive llamada Mini Bricks',
                                'finished': False}},
        {'serverContent': {'turnComplete': True}}])
    starts = [event for event in events if isinstance(event, LiveSpeechStarted)]
    warnings = [event for event in events if isinstance(event, LiveUnconfirmedTurn)]
    assert len(starts) == len(warnings) == 1
    assert warnings[0].turn_id == starts[0].turn_id
    assert not any(isinstance(event, LiveTranscript) for event in events)


def collect(frames, voiced=False):
    class AudioFrames(Frames):
        async def send(self, _message):
            pass

    async def run():
        session = VertexLiveSession(AudioFrames(frames))
        if voiced:
            pcm = ((1200).to_bytes(2, 'little', signed=True) * 8
                   + (-1200).to_bytes(2, 'little', signed=True) * 8) * 32
            await session.send_audio(pcm)
            await session.send_audio(pcm)
        events = [event async for event in session.events()]
        await session.close()
        return events
    return asyncio.run(run())


def test_silence_reserves_position_and_reply_start_commits_available_input_first():
    events = collect([
        START,
        {'inputTranscription': {'text': 'Quiero'}},
        END,
        {'inputTranscription': {'text': 'Quiero una lámpara'}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Claro'}]}}},
        {'serverContent': {'turnComplete': True}},
    ])
    started, first_preview, ended, second_preview = events[:4]
    assert isinstance(started, LiveSpeechStarted)
    assert isinstance(ended, LiveSpeechEnded)
    assert UUID(started.turn_id) and started.turn_id == ended.turn_id
    assert [first_preview.text, second_preview.text] == ['Quiero', 'Quiero una lámpara']
    assert first_preview.turn_id == ended.turn_id == second_preview.turn_id
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert [(event.role, event.text) for event in finals] == [
        ('user', 'Quiero una lámpara'), ('assistant', 'Claro')]
    assert events.index(finals[0]) < events.index(finals[1])
    assert finals[0].occurred_at < finals[1].occurred_at


def test_no_input_at_silence_keeps_placeholder_until_late_final():
    events = collect([
        START, END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Te escucho'}]}}},
        {'serverContent': {'turnComplete': True}},
        {'inputTranscription': {'text': 'Necesito un producto', 'finished': True}},
    ])
    ended = next(event for event in events if isinstance(event, LiveSpeechEnded))
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert [(event.role, event.text) for event in finals] == [
        ('assistant', 'Te escucho'), ('user', 'Necesito un producto')]
    # Delivery can be late, but canonical history sorts the user's utterance
    # before the assistant using its VAD start timestamp rather than DB write.
    assert finals[1].turn_id == ended.turn_id
    assert finals[1].occurred_at < finals[0].occurred_at


def test_no_provider_vad_or_interim_reserves_causal_slot_before_reply():
    events = collect([
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Te ayudo'}]},
                           'turnComplete': True}},
        {'inputTranscription': {'text': 'Quiero crear un producto',
                                'finished': True}},
    ], voiced=True)
    ended = next(event for event in events if isinstance(event, LiveSpeechEnded))
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert events.index(ended) < events.index(finals[0])
    assert [(event.role, event.text) for event in finals] == [
        ('assistant', 'Te ayudo'), ('user', 'Quiero crear un producto')]
    assert finals[0].reply_to_turn_id == ended.turn_id == finals[1].turn_id
    assert finals[1].occurred_at < finals[0].occurred_at


def test_no_provider_vad_with_early_final_does_not_create_phantom_user_turn():
    events = collect([
        {'inputTranscription': {'text': 'Quiero un producto', 'finished': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Claro'}]},
                           'turnComplete': True}},
    ], voiced=True)
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert not any(isinstance(event, LiveSpeechEnded) for event in events)
    assert finals[1].reply_to_turn_id == finals[0].turn_id


def test_repeated_no_vad_finals_before_replies_keep_distinct_pairs():
    events = collect([
        {'inputTranscription': {'text': 'Primer producto', 'finished': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Primera respuesta'}]},
                           'turnComplete': True}},
        {'inputTranscription': {'text': 'Segundo producto', 'finished': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Segunda respuesta'}]},
                           'turnComplete': True}},
    ], voiced=True)
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert [(event.role, event.text) for event in finals] == [
        ('user', 'Primer producto'), ('assistant', 'Primera respuesta'),
        ('user', 'Segundo producto'), ('assistant', 'Segunda respuesta')]
    assert finals[1].reply_to_turn_id == finals[0].turn_id
    assert finals[3].reply_to_turn_id == finals[2].turn_id
    assert finals[0].turn_id != finals[2].turn_id
    assert not any(isinstance(event, LiveSpeechEnded) for event in events)


def test_no_provider_vad_drops_unattributable_final_after_another_reply():
    events = collect([
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Primera'}]},
                           'turnComplete': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Segunda'}]},
                           'turnComplete': True}},
        {'inputTranscription': {'text': 'Texto sin turno seguro',
                                'finished': True}},
    ], voiced=True)
    ended = [event for event in events if isinstance(event, LiveSpeechEnded)]
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert len(ended) == 1
    assert [(event.role, event.text) for event in finals] == [
        ('assistant', 'Primera'), ('assistant', 'Segunda')]
    assert finals[0].reply_to_turn_id == ended[0].turn_id
    assert finals[1].reply_to_turn_id is None


def test_continuous_audio_after_inferred_boundary_keeps_late_final():
    from app.uony_live_transcription import LiveTranscriptionState

    state = LiveTranscriptionState()
    pcm = ((1200).to_bytes(2, 'little', signed=True) * 8
           + (-1200).to_bytes(2, 'little', signed=True) * 8) * 32
    state._note_audio_input(pcm)
    state._note_audio_input(pcm)
    boundary = state._reply_begins()
    assert isinstance(boundary, LiveSpeechEnded)
    for _ in range(5):
        state._note_audio_input(pcm)
    assert not state.ambiguous_user_input
    updates = state._user_transcription({'text': 'Frase tardía', 'finished': True})
    assert isinstance(updates[-1], LiveTranscriptPreview)
    final = state._complete_user_turn()
    assert isinstance(final, LiveTranscript)
    assert final.turn_id == boundary.turn_id
    assert final.finalized_by != 'provider_finished'


def test_inferred_turn_becomes_ambiguous_only_after_quiet_then_new_burst():
    from app.uony_live_transcription import LiveTranscriptionState

    state = LiveTranscriptionState()
    pcm = ((1200).to_bytes(2, 'little', signed=True) * 8
           + (-1200).to_bytes(2, 'little', signed=True) * 8) * 32
    state._note_audio_input(pcm)
    state._note_audio_input(pcm)
    boundary = state._reply_begins()
    assert isinstance(boundary, LiveSpeechEnded)
    for _ in range(7):
        state._note_audio_input(bytes(1024))
    assert not state.ambiguous_user_input
    state._note_audio_input(pcm)
    assert not state.ambiguous_user_input
    state._note_audio_input(pcm)
    assert state.ambiguous_user_input
    assert state._user_transcription({'text': 'No atribuible', 'finished': True}) == ()


def test_silence_or_dc_offset_does_not_infer_an_unprompted_user_turn():
    class AudioFrames(Frames):
        async def send(self, _message):
            pass

    async def run():
        session = VertexLiveSession(AudioFrames([
            {'serverContent': {'modelTurn': {'parts': [{'text': 'Hola'}]},
                               'turnComplete': True}},
        ]))
        await session.send_audio(bytes(1024))
        await session.send_audio(bytes(1024))
        dc_offset = (1200).to_bytes(2, 'little', signed=True) * 512
        await session.send_audio(dc_offset)
        await session.send_audio(dc_offset)
        events = [event async for event in session.events()]
        await session.close()
        return events

    events = asyncio.run(run())
    assert not any(isinstance(event, LiveSpeechEnded) for event in events)
    assert [event.reply_to_turn_id for event in events
            if isinstance(event, LiveTranscript)] == [None]


def test_unfinished_chunks_after_silence_are_never_committed_prematurely():
    events = collect([
        START, END,
        {'inputTranscription': {'text': 'Quiero', 'finished': False}},
        {'inputTranscription': {'text': 'crear', 'finished': False}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Cuéntame más'}]}}},
        {'inputTranscription': {'text': 'un producto', 'finished': True}},
        {'serverContent': {'turnComplete': True}},
    ])
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert [(event.role, event.text) for event in finals] == [
        ('user', 'Quiero crear un producto'), ('assistant', 'Cuéntame más')]
    assert not any(isinstance(event, LiveTranscript) and event.text in
                   ('Quiero', 'Quiero crear') for event in events)


def test_provider_revision_of_full_phrase_replaces_old_words_before_final():
    events = collect([
        START,
        {'inputTranscription': {'text': 'Quiero una mesa'}},
        {'inputTranscription': {'text': 'Quiero una lámpara'}},
        END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Claro'}]},
                           'turnComplete': True}},
    ])
    assert [(event.role, event.text) for event in events
            if isinstance(event, LiveTranscript)] == [
        ('user', 'Quiero una lámpara'), ('assistant', 'Claro')]


def test_input_final_before_vad_end_uses_one_turn_id_without_phantom_placeholder():
    events = collect([
        START,
        {'inputTranscription': {'text': 'Hola', 'finished': True}},
        END,
        {'serverContent': {'outputTranscription': {'text': 'Te escucho',
                                                   'finished': True},
                           'turnComplete': True}},
    ])
    started = next(event for event in events if isinstance(event, LiveSpeechStarted))
    ended = next(event for event in events if isinstance(event, LiveSpeechEnded))
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    user = next(event for event in finals if event.role == 'user')
    assistant = next(event for event in finals if event.role == 'assistant')
    assert started.turn_id == ended.turn_id == user.turn_id
    assert user.finalized_by == 'model_turn_complete'
    assert assistant.reply_to_turn_id == started.turn_id
    assert not any(event.role == 'user' and event.turn_id != started.turn_id
                   for event in events if isinstance(event, LiveTranscriptPreview))


def test_pre_end_finished_segment_then_negative_continuation_is_not_authoritative():
    events = collect([
        START,
        {'inputTranscription': {'text': 'Analiza la carpeta de Drive llamada Mini Bricks',
                                'finished': True}},
        {'inputTranscription': {'text': 'pero no todavía', 'finished': True}},
        END,
        {'serverContent': {'turnComplete': True}},
    ])
    started = next(event for event in events if isinstance(event, LiveSpeechStarted))
    user = [event for event in events if isinstance(event, LiveTranscript)
            and event.role == 'user']
    assert len(user) == 1
    assert user[0].turn_id == started.turn_id
    assert user[0].text.endswith('pero no todavía')
    assert user[0].finalized_by != 'provider_finished'


def test_one_post_end_finished_segment_and_model_complete_is_authoritative():
    events = collect([
        START, END,
        {'inputTranscription': {'text': 'Analiza la carpeta de Drive llamada Mini Bricks',
                                'finished': True}},
        {'serverContent': {'turnComplete': True}},
    ])
    started = next(event for event in events if isinstance(event, LiveSpeechStarted))
    user = [event for event in events if isinstance(event, LiveTranscript)
            and event.role == 'user']
    assert len(user) == 1
    assert user[0].turn_id == started.turn_id
    assert user[0].finalized_by == 'provider_finished'


def test_two_post_end_finished_segments_cannot_authorize_first_segment():
    events = collect([
        START, END,
        {'inputTranscription': {'text': 'Analiza la carpeta de Drive llamada Mini Bricks',
                                'finished': True}},
        {'inputTranscription': {'text': 'pero no todavía', 'finished': True}},
        {'serverContent': {'turnComplete': True}},
    ])
    user = [event for event in events if isinstance(event, LiveTranscript)
            and event.role == 'user']
    assert len(user) == 1
    assert user[0].text.endswith('pero no todavía')
    assert user[0].finalized_by != 'provider_finished'


def test_duplicate_activity_end_keeps_existing_preview_until_reply_boundary():
    events = collect([
        START,
        {'inputTranscription': {'text': 'Mi producto'}},
        END, END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Cuéntame'}]},
                           'turnComplete': True}},
    ])
    previews = [event for event in events if isinstance(event, LiveTranscriptPreview)
                and event.role == 'user']
    assert [event.text for event in previews] == ['Mi producto']
    assert [event.text for event in events if isinstance(event, LiveTranscript)
            and event.role == 'user'] == ['Mi producto']


def test_interrupted_assistant_preview_remains_linked_to_first_user_turn():
    events = collect([
        START, {'inputTranscription': {'text': 'Primero', 'finished': True}}, END,
        {'outputTranscription': {'text': 'Respuesta parcial', 'finished': False}},
        START,
        {'outputTranscription': {'text': 'Respuesta tardía', 'finished': True}},
        {'inputTranscription': {'text': 'Segundo', 'finished': True}}, END,
        {'serverContent': {'turnComplete': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Nueva respuesta'}]},
                           'turnComplete': True}},
    ])
    starts = [event for event in events if isinstance(event, LiveSpeechStarted)]
    first_reply = next(event for event in events
                       if isinstance(event, LiveTranscriptPreview)
                       and event.role == 'assistant')
    assert first_reply.reply_to_turn_id == starts[0].turn_id
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert all(event.text != 'Respuesta tardía' for event in finals)
    second_reply = next(event for event in finals if event.role == 'assistant')
    assert second_reply.reply_to_turn_id == starts[1].turn_id


def test_silence_without_provider_text_never_invents_a_user_transcript():
    events = collect([START, END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Aquí estoy'}]},
                           'turnComplete': True}}])
    assert len([event for event in events if isinstance(event, LiveSpeechEnded)]) == 1
    assert [(event.role, event.text) for event in events
            if isinstance(event, LiveTranscript)] == [('assistant', 'Aquí estoy')]
    assert not any(isinstance(event, LiveTranscriptPreview) and event.role == 'user'
                   for event in events)


def test_second_vad_without_first_final_quarantines_unattributable_late_text():
    events = collect([
        START, END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Primera respuesta'}]},
                           'turnComplete': True}},
        START, END,
        # No offsets identify whether either provider chunk belongs to the
        # first or second utterance. Neither can become canonical user text.
        {'inputTranscription': {'text': 'Primera frase', 'finished': True}},
        {'inputTranscription': {'text': 'Segunda frase', 'finished': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Otra respuesta'}]},
                           'turnComplete': True}},
    ])
    starts = [event for event in events if isinstance(event, LiveSpeechStarted)]
    ends = [event for event in events if isinstance(event, LiveSpeechEnded)]
    assert len(starts) == len(ends) == 2
    assert starts[0].turn_id == ends[0].turn_id
    assert starts[1].turn_id == ends[1].turn_id
    assert starts[0].turn_id != starts[1].turn_id
    assert not any(event.role == 'user' and event.text for event in events
                   if isinstance(event, (LiveTranscript, LiveTranscriptPreview)))
    assert [(event.role, event.text) for event in events
            if isinstance(event, LiveTranscript)] == [
        ('assistant', 'Primera respuesta'), ('assistant', 'Otra respuesta')]


def test_ambiguous_window_drains_two_final_markers_then_third_turn_is_valid():
    events = collect([
        START, END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Primera respuesta'}]},
                           'turnComplete': True}},
        START, END,
        {'inputTranscription': {'text': 'No atribuible uno', 'finished': True}},
        {'inputTranscription': {'text': 'No atribuible dos', 'finished': True}},
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Segunda respuesta'}]},
                           'turnComplete': True}},
        START,
        {'inputTranscription': {'text': 'Tercera frase', 'finished': True}},
        END,
        {'serverContent': {'modelTurn': {'parts': [{'text': 'Ahora sí'}]},
                           'outputTranscription': {'text': 'Ahora sí',
                                                   'finished': True},
                           'turnComplete': True}},
    ])
    starts = [event for event in events if isinstance(event, LiveSpeechStarted)]
    ends = [event for event in events if isinstance(event, LiveSpeechEnded)]
    assert len(starts) == len(ends) == 3
    finals = [event for event in events if isinstance(event, LiveTranscript)]
    assert [(event.role, event.text) for event in finals] == [
        ('assistant', 'Primera respuesta'), ('assistant', 'Segunda respuesta'),
        ('user', 'Tercera frase'), ('assistant', 'Ahora sí')]
    assert finals[2].turn_id == starts[2].turn_id == ends[2].turn_id
    assert finals[3].reply_to_turn_id == starts[2].turn_id


def test_history_uses_voice_onset_when_user_final_is_persisted_after_reply(environment):
    settings, provider, database = environment
    account = account_setup(settings, provider, database)[0]
    identity = _bind(database, LiveIdentity(str(account[0]), account[1], account[2]),
                     'ordered-live-thread', None)
    assert identity is not None
    earlier = datetime.now(timezone.utc) - timedelta(seconds=2)
    later = earlier + timedelta(seconds=1)
    session_id = str(uuid4())
    assert _save_transcript(database, identity, session_id,
        LiveTranscript('assistant', str(uuid4()), 'Respuesta', later))
    assert _save_transcript(database, identity, session_id,
        LiveTranscript('user', str(uuid4()), 'Mi pregunta', earlier))
    with TestClient(create_app(settings, provider=provider),
                    base_url=settings.origin) as client:
        history = client.get('/api/uony/threads', headers=headers(settings, account[3]))
    assert history.status_code == 200
    saved = next(item for item in history.json()['threads']
                 if item['id'] == 'ordered-live-thread')
    assert [(item['role'], item['text']) for item in saved['messages']] == [
        ('user', 'Mi pregunta'), ('assistant', 'Respuesta')]
