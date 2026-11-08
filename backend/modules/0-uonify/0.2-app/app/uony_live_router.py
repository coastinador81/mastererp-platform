"""Single owner of Live turns, tool admission and provisional output."""
import asyncio
import logging
from contextlib import suppress
from uuid import UUID
from .uony_live_handoff import INTENTS, route_final_turn
from .uony_live_audio_gate import flush_ordinary_reply
from .uony_live_ordinary_audio import OrdinaryAudioStream
from .uony_live_caption_receipts import finalize_caption_state, record_caption_usage
from .uony_live_drive_context import metadata_turn_allowed, contextual_intent
from .uony_live_caption_session import (LiveCaptionRecovery, LiveCaptionStatus,
                                        LiveCaptionUsage)
from .uony_live_semantic import SemanticEventStream, SemanticResolution
from .uony_semantic_failure import (CURRENT_BUDGET, SemanticDeadlineExceeded,
    SemanticFailure, bounded, PERSIST_RESERVE_SECONDS, consume_task)
from .uony_semantic_work_status import (deliver_semantic_failure,
    admit_semantic_turn, observe_handoff, deliver_admission_unknown, start_semantic_handler,
    corroborate_late_primary)
from .uony_live_provenance import PRIMARY_ACTION_SOURCES, voice_action_allowed
from .uony_live_adk_dispatch import AdkToolDispatcher
from .uony_live_bridge import (MAX_FRAME_BYTES, MAX_OUTPUT_BYTES, LiveAudio,
    LiveInterrupted, LiveSpeechStarted, LiveSpeechEnded, LiveStatus, LiveSubtitle,
    LiveToolCall, LiveTranscript, LiveTranscriptPreview, LiveUnconfirmedTurn, LiveUsage,
    LiveUserFinal, _save_transcript, _current_work, _record_usage)
from .uony_live_persist import LivePersistTurn, handle_gateway_io

logger = logging.getLogger(__name__)


class LiveTurnRouter:
    def __init__(self, database, settings, identity, session_id, session_hash,
                 session, delivery, sender, audio_gate, continuity=None, lease=None,
                 interpreter=None):
        self.database, self.settings, self.identity = database, settings, identity
        self.session_id, self.session_hash, self.session = session_id, session_hash, session
        self.delivery, self.sender, self.audio_gate = delivery, sender, audio_gate
        self.continuity, self.lease = continuity, lease
        self.output_bytes = self.tool_calls = self.consecutive_tool_calls = 0
        self.interruptions_sent = 0
        self.handoff_timeout_task = None
        self.semantic_handlers = set()
        self.ordinary = OrdinaryAudioStream(sender, delivery.speech)
        self.semantic = (SemanticEventStream(interpreter, sender, identity.thread_id)
                         if interpreter is not None else None)

    async def run(self):
        consumer = asyncio.create_task(self._consume())
        failed = asyncio.create_task(self.ordinary.wait_failure())
        try:
            done, _ = await asyncio.wait((consumer, failed),
                                        return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                await task
        finally:
            for task in (consumer, failed):
                task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await task
            for task in self.semantic_handlers:
                task.cancel()
                task.add_done_callback(consume_task)
            if self.semantic_handlers:
                await asyncio.wait(self.semantic_handlers, timeout=PERSIST_RESERVE_SECONDS)
            await self.ordinary.close()

    # PIEZA 3 paso 0 (refactor MECÁNICO, behavior-preserving): el estado por-turno pasa a atributos
    # self._* (inicializados al inicio de _consume, placement idéntico), las closures pasan a métodos,
    # y el cuerpo del despacho pasa a _dispatch(event). CERO cambio de condición. El gateway sigue NO
    # agéntico; el cableado de autorización agéntica es el paso 2 (veredicto aparte).
    def _final_allowed(self, turn_id, intent):
        return (self._latest_authoritative_turn == turn_id or
                intent == 'creative_plan' and self._latest_creative_final_turn == turn_id)

    async def _answer_handoff(self, call_id, turn_id, intent, spoken_text, decision=None,
                              *, historical=False, drive=None):
        audio_gate = self.audio_gate
        outcome = await admit_semantic_turn(self, turn_id, intent, spoken_text,
            decision, route_final_turn, drive=drive)
        if outcome is None:
            return
        historical = historical or turn_id != audio_gate.turn_id or self.ordinary.previous_turn(turn_id)
        if outcome.get('requestId'):
            self._routed_turns.add(turn_id)
            if not historical:
                self._last_routed_turn = turn_id
                self._last_routed_intent = intent
                if call_id:
                    self._last_routed_call_id = call_id
                if self.continuity:
                    try:
                        await bounded(asyncio.to_thread(self.continuity.checkpoint, self.lease,
                            turn_id=turn_id, request_id=outcome['requestId']), PERSIST_RESERVE_SECONDS)
                    except Exception as error:
                        logger.warning('Live continuity checkpoint failed: %s', type(error).__name__)
        await observe_handoff(self, outcome, turn_id, call_id, decision, historical)
        return outcome

    async def _expire_handoff(self, item):
        session = self.session
        # Caption finalization can lag behind Gemini's function call.
        await asyncio.sleep(12)
        if self._pending_handoff is item:
            self._pending_handoff = None
            await session.respond_tool(item['callId'], 'route_spoken_request',
                {'status': 'blocked', 'reason': 'final_transcript_required'})

    async def _resolve_semantic(self, event):
        database, identity = self.database, self.identity
        session_id, sender, audio_gate = self.session_id, self.sender, self.audio_gate
        delivery = self.delivery
        turn = event.event
        current = turn.turn_id == audio_gate.turn_id and not self.ordinary.previous_turn(turn.turn_id)
        context = CURRENT_BUDGET.set(event.budget)
        try:
            try:
                await bounded(self.semantic.progress(turn.turn_id, 'settled'),
                              PERSIST_RESERVE_SECONDS)
            except Exception as error:
                logger.warning('Live semantic progress send failed: %s', type(error).__name__)
            failure, decision = event.error, event.decision
            if not failure and event.budget:
                try:
                    event.budget.require()
                except SemanticDeadlineExceeded as error:
                    event.budget.invalidate()
                    failure = SemanticFailure.from_error(error, 'admission')
            if failure:
                await deliver_semantic_failure(self, event, failure)
                suppress = True
            elif decision.action == 'conversation':
                suppress = False
            else:
                suppress = True
                allowed = voice_action_allowed(decision.action, turn.finalized_by)
                if allowed and turn.turn_id not in self._routed_turns:
                    try:
                        await self._answer_handoff(None, turn.turn_id, 'semantic_request',
                            turn.text.strip(), decision, historical=not current)
                    except SemanticDeadlineExceeded as error:
                        if turn.turn_id in self._routed_turns:
                            raise
                        event.budget.invalidate()
                        await deliver_semantic_failure(self, event,
                            SemanticFailure.from_error(error, 'admission'))
                elif not allowed:
                    logger.warning('Live semantic action unconfirmed reason=provenance '
                                   'source=%s action=%s turn_id=%s',
                                   turn.finalized_by, decision.action, turn.turn_id)
                    # Uony asks to repeat it (owner, 20-10-2026): the turn is closed,
                    # so a late primary can no longer start that work as well.
                    self._late_recovered_turns.add(turn.turn_id)
                    await delivery.unconfirmed(turn.turn_id, turn.text, intent='semantic_request')
            if (turn.turn_id == audio_gate.turn_id and
                    not self.ordinary.previous_turn(turn.turn_id)):
                frames, replies = audio_gate.finalize(turn.turn_id, suppress=suppress)
                await flush_ordinary_reply(frames, replies, database, identity,
                    session_id, sender, self.ordinary, turn.turn_id)
        except Exception as error:
            logger.warning('Live semantic resolution failed: %s', type(error).__name__)
            await deliver_admission_unknown(self, turn)
        finally:
            CURRENT_BUDGET.reset(context)
            # Persistence and delivery are fallible; neither may leave
            # the next final turn permanently waiting for admission.
            if event.handled:
                event.handled.set()

    async def _consume(self):
        session, sender = self.session, self.sender
        self._latest_speech_turn = None
        self._latest_final_user_turn = None
        self._latest_authoritative_turn = None
        self._latest_creative_final_turn = None
        self._last_known_user_turn = None
        self._last_routed_turn = None
        self._last_routed_call_id = None
        self._last_routed_intent = self._pending_handoff = None
        self._routed_turns = set()
        self._late_recovered_turns = set()
        if getattr(session, 'tool_owner', None) == 'adk':  # ADK-FLUJOS §3: sole server side.
            session.bind_tools(AdkToolDispatcher(self, session,
                lambda turn, intent, text, drive=None: self._answer_handoff(None, turn, intent, text, drive=drive),
                lambda turn: turn in self._late_recovered_turns))
        stream = self.semantic.events(session) if self.semantic else session.events()
        async for event in stream:
            self.ordinary.check()
            if sender.guard:
                sender.guard()
            await self._dispatch(event)

    async def _dispatch(self, event):
        database, settings, identity = self.database, self.settings, self.identity
        session_id, session_hash, session = self.session_id, self.session_hash, self.session
        delivery, sender, audio_gate = self.delivery, self.sender, self.audio_gate
        if isinstance(event, SemanticResolution):
            start_semantic_handler(self, self._resolve_semantic(event))
        elif isinstance(event, LiveAudio):
            self.consecutive_tool_calls = 0
            pcm = event.pcm
            if not isinstance(pcm, bytes) or not pcm or len(pcm) > MAX_FRAME_BYTES or len(pcm) % 2:
                raise ValueError('invalid provider audio')
            self.output_bytes += len(pcm)
            if self.output_bytes > MAX_OUTPUT_BYTES:
                raise ValueError('provider audio limit')
            if self.ordinary.previous_turn(event.reply_to_turn_id):
                return
            if event.generation_id:
                if event.generation_id in self.ordinary.invalid:
                    return
            self.ordinary.enqueue(audio_gate.capture(event), audio_gate.turn_id)
        elif isinstance(event, LiveStatus) and event.state in ('listening', 'speaking'):
            if event.state == 'listening':
                self.ordinary.finish(event.generation_id)
            if event.state != 'speaking' or not audio_gate.audio_blocked:
                if event.state == 'speaking' or not self.ordinary.busy:
                    delivery.speech.model_status(event.state)
                await sender.event({'type': 'status', 'state': event.state})
        elif isinstance(event, LiveInterrupted):
            delivery.speech.speech_started()
            # Retained generations have not entered the output lane yet.
            # Invalidate them only on a real cut, not first-turn admission.
            self.ordinary.invalid.update(audio_gate.held_generations)
            await self.ordinary.cut()
            audio_gate.discard_invalid_audio(self.ordinary.invalid)
            # Keep the pending customer's turn and admission state. An
            # interruption must not reopen passthrough for late old PCM.
            await sender.event({'type': 'interrupted'})
            self.interruptions_sent += 1
        elif isinstance(event, LiveSpeechStarted):
            if self.semantic and event.turn_id:
                await self.semantic.advance(event.turn_id)
            delivery.speech.speech_started()
            if event.turn_id != audio_gate.turn_id:
                self.ordinary.invalid.update(audio_gate.held_generations)
            await self.ordinary.cut(event.turn_id or None)
            if event.turn_id:
                UUID(event.turn_id)
                audio_gate.start(event.turn_id)
                if (self._pending_handoff is not None and
                        self._pending_handoff['turnId'] != event.turn_id):
                    item, self._pending_handoff = self._pending_handoff, None
                    if self.handoff_timeout_task:
                        self.handoff_timeout_task.cancel()
                    await session.respond_tool(item['callId'], 'route_spoken_request',
                        {'status': 'blocked', 'reason': 'turn_changed'})
                self._latest_speech_turn = event.turn_id
                self._latest_final_user_turn = None
                self._latest_authoritative_turn = None
                self._latest_creative_final_turn = None
                self.consecutive_tool_calls = 0
            else:
                audio_gate.start(None)
            await sender.event({'type': 'speech_started',
                **({'turnId': event.turn_id} if event.turn_id else {})})
        elif isinstance(event, LiveSpeechEnded):
            UUID(event.turn_id)
            if await self.ordinary.observe_turn(event.turn_id):
                audio_gate.start(event.turn_id)
            delivery.speech.speech_ended()
            await sender.event({'type': 'speech_ended', 'turnId': event.turn_id})
        elif isinstance(event, (LiveSubtitle, LivePersistTurn)):   # gateway: vista (subtítulo) + persistencia L1
            await handle_gateway_io(event, self)
        elif isinstance(event, LiveUserFinal):
            # PIEZA 3 paso 2 — feed de autorización del gateway: fija el MISMO estado del gate que la rama
            # LiveTranscript-user (espejo EXACTO), SIN persistir/semantic/handoff/finalize. En 3.x el final
            # del gateway es siempre provider_finished (equivale a la condición ADK). persist≠autoriza.
            self._last_known_user_turn = event.turn_id
            self._latest_final_user_turn = event.turn_id
            self._latest_authoritative_turn = (event.turn_id
                if event.finalized_by == 'provider_finished' else None)
            self._latest_creative_final_turn = (event.turn_id
                if event.finalized_by in PRIMARY_ACTION_SOURCES else None)
            self._latest_speech_turn = None
            self.consecutive_tool_calls = 0
        elif isinstance(event, LiveTranscriptPreview):
            if (event.role not in ('user', 'assistant') or not isinstance(event.text, str)
                    or len(event.text) > 3000):
                raise ValueError('invalid Live transcript preview')
            try:
                UUID(event.turn_id)
                if event.reply_to_turn_id is not None:
                    UUID(event.reply_to_turn_id)
            except (TypeError, ValueError, AttributeError) as error:
                raise ValueError('invalid Live preview turn') from error
            if event.role == 'user' and self.ordinary.previous_turn(event.turn_id):
                return
            if event.role == 'user' and event.turn_id != self._latest_final_user_turn:
                audio_gate.preview(event.turn_id, event.text)
            if event.role == 'assistant' and (event.reply_to_turn_id in self._routed_turns
                    or audio_gate.blocks_assistant(event.reply_to_turn_id)):
                if event.reply_to_turn_id not in self._routed_turns:
                    audio_gate.defer_assistant(event)
                return
            if event.role == 'user' and event.turn_id != self._latest_final_user_turn:
                self._latest_speech_turn = event.turn_id
                self._latest_final_user_turn = None
                self._latest_authoritative_turn = None
                self._latest_creative_final_turn = None
            await sender.event({'type': 'transcript_preview', 'role': event.role,
                'turnId': event.turn_id, 'text': event.text,
                **({'replyToTurnId': event.reply_to_turn_id}
                   if event.role == 'assistant' else {})})
        elif isinstance(event, LiveCaptionRecovery):
            # Caption recovery restores chat order and can release an
            # ordinary conversational answer. It is deliberately separate
            # from LiveTranscript so it can never authorize a tool, Drive
            # read, handoff, ADK job, creative action, or mutation.
            try:
                UUID(event.turn_id)
            except (TypeError, ValueError, AttributeError) as error:
                raise ValueError('invalid caption recovery turn') from error
            if (not isinstance(event.text, str)
                    or not 1 <= len(event.text.strip()) <= 3000):
                raise ValueError('invalid caption recovery text')
            recovered = LiveTranscript('user', event.turn_id,
                event.text.strip(), event.occurred_at,
                finalized_by='caption_recovery')
            if self.ordinary.previous_turn(event.turn_id):
                if _save_transcript(database, identity, session_id, recovered):
                    await sender.event({'type': 'transcript', 'role': 'user',
                        'turnId': event.turn_id, 'text': recovered.text,
                        'final': True})
                return
            await self.ordinary.observe_turn(event.turn_id)
            delivery.speech.speech_ended()
            if audio_gate.turn_id != event.turn_id:
                audio_gate.start(event.turn_id)
            self._last_known_user_turn = event.turn_id
            inserted = _save_transcript(database, identity, session_id, recovered)
            self._latest_final_user_turn = event.turn_id
            self._latest_authoritative_turn = None
            self._latest_creative_final_turn = None
            self._latest_speech_turn = None
            self.consecutive_tool_calls = 0
            if inserted:
                await sender.event({'type': 'transcript', 'role': 'user',
                    'turnId': event.turn_id, 'text': recovered.text, 'final': True})
            if self.semantic:
                await self.semantic.start(recovered)
                return
            blocked_action = contextual_intent(database, identity, recovered.text,
                creative_follow_up=self._last_routed_intent == 'creative_plan',
                turn_id=event.turn_id)
            if (self._pending_handoff is not None
                    and self._pending_handoff['turnId'] == event.turn_id):
                item, self._pending_handoff = self._pending_handoff, None
                if self.handoff_timeout_task:
                    self.handoff_timeout_task.cancel()
                await session.respond_tool(item['callId'], 'route_spoken_request',
                    {'status': 'blocked', 'reason': 'final_transcript_required'})
                blocked_action = blocked_action or item['intent']
            if blocked_action and inserted:
                await delivery.unconfirmed(event.turn_id, recovered.text,
                                           intent=blocked_action)
            frames, replies = audio_gate.finalize(event.turn_id,
                suppress=bool(blocked_action))
            await flush_ordinary_reply(frames, replies, database, identity,
                session_id, sender, self.ordinary, event.turn_id)
            notice = audio_gate.take_voice_notice(event.turn_id)
            if notice:
                await sender.event(notice)
        elif isinstance(event, LiveTranscript):
            UUID(event.turn_id)
            if event.reply_to_turn_id is not None:
                UUID(event.reply_to_turn_id)
            if event.role == 'user' and self.ordinary.previous_turn(event.turn_id):
                # Primary evidence can finish an exact read that a caption
                # already classified, without stealing the newer audio turn.
                if _save_transcript(database, identity, session_id, event):
                    await sender.event({'type': 'transcript', 'role': 'user',
                        'turnId': event.turn_id, 'text': event.text.strip(), 'final': True})
                if self.semantic and event.finalized_by in PRIMARY_ACTION_SOURCES:
                    task = self.semantic.tasks.get(event.turn_id)
                    if task is not None and not task.done():
                        # This only replaces the event carried by the
                        # existing inference; it cannot start another call.
                        await self.semantic.start(event)
                    else:
                        await corroborate_late_primary(self, event, self._routed_turns,
                            self._late_recovered_turns, self._answer_handoff)
                return
            if (event.role == 'assistant' and
                    audio_gate.blocks_assistant(event.reply_to_turn_id)):
                audio_gate.defer_assistant(event)
                return
            if event.role == 'user':
                await self.ordinary.observe_turn(event.turn_id)
                delivery.speech.speech_ended()
                if audio_gate.turn_id != event.turn_id:
                    audio_gate.start(event.turn_id)
                self._last_known_user_turn = event.turn_id
            inserted = _save_transcript(database, identity, session_id, event)
            if event.role == 'user':
                self._latest_final_user_turn = event.turn_id
                self._latest_authoritative_turn = (event.turn_id if
                    event.finalized_by == 'provider_finished' or
                    metadata_turn_allowed(database, identity, event) else None)
                self._latest_creative_final_turn = (event.turn_id if
                    event.finalized_by in PRIMARY_ACTION_SOURCES else None)
                self._latest_speech_turn = None
                self.consecutive_tool_calls = 0
            if inserted:
                await sender.event({'type': 'transcript', 'role': event.role,
                    'turnId': event.turn_id, 'text': event.text.strip(), 'final': True,
                    **({'replyToTurnId': event.reply_to_turn_id}
                       if event.role == 'assistant' else {})})
            if self.semantic and event.role == 'user':
                task = self.semantic.tasks.get(event.turn_id)
                if task is not None and task.done():
                    # The caption already resolved this current turn.
                    await corroborate_late_primary(self, event, self._routed_turns,
                        self._late_recovered_turns, self._answer_handoff)
                else:
                    await self.semantic.start(event)
                return
            if (event.role == 'user' and self._pending_handoff is not None
                    and self._pending_handoff['turnId'] == event.turn_id
                    and event.turn_id != self._last_routed_turn):
                item, self._pending_handoff = self._pending_handoff, None
                if self.handoff_timeout_task:
                    self.handoff_timeout_task.cancel()
                if self._final_allowed(event.turn_id, item['intent']):
                    await self._answer_handoff(item['callId'], event.turn_id,
                                         item['intent'], item['spokenText'])
                else:
                    await session.respond_tool(item['callId'], 'route_spoken_request',
                        {'status': 'blocked', 'reason': 'final_transcript_required'})
            intent = None
            if event.role == 'user' and self._last_routed_turn != event.turn_id:
                intent = contextual_intent(database, identity, event.text,
                    creative_follow_up=self._last_routed_intent == 'creative_plan', turn_id=event.turn_id)
                if intent and self._final_allowed(event.turn_id, intent):
                    await self._answer_handoff(None, event.turn_id, intent, event.text)
                elif inserted:
                    await delivery.unconfirmed(event.turn_id, event.text)
            if event.role == 'user':
                frames, replies = audio_gate.finalize(event.turn_id,
                    suppress=self._last_routed_turn == event.turn_id or intent is not None)
                await flush_ordinary_reply(frames, replies, database, identity,
                    session_id, sender, self.ordinary, event.turn_id)
                notice = audio_gate.take_voice_notice(event.turn_id)
                if notice:
                    await sender.event(notice)
        elif isinstance(event, LiveUnconfirmedTurn):
            UUID(event.turn_id)
            if not isinstance(event.text, str) or not 1 <= len(event.text) <= 3000:
                raise ValueError('invalid unconfirmed Live turn')
            if event.turn_id != self._last_routed_turn:
                await delivery.unconfirmed(event.turn_id, event.text)
        elif isinstance(event, LiveToolCall) and getattr(session, 'tool_owner', None) == 'adk':
            self.tool_calls += 1  # Observed only: ADK runs it via the dispatcher.
        elif isinstance(event, LiveToolCall):
            self.tool_calls += 1
            self.consecutive_tool_calls += 1
            # FIX combined4 (bug 2): NUNCA raise en el camino de tool — una entrada que el MODELO puede
            # provocar (args espurios, tool desconocida) no debe matar la voz (_consume no tiene try/except →
            # un raise cierra el WS). call_id inservible → descarta en silencio; get_current_work casa por
            # NOMBRE e ignora args (no toma args); tool desconocida / route_spoken_request mal formado → rechazo.
            if not isinstance(event.call_id, str) or not 1 <= len(event.call_id) <= 128:
                return
            valid_status = event.name == 'get_current_work'   # sin params: ignora args espurios del modelo.
            valid_handoff = (event.name == 'route_spoken_request'
                and isinstance(event.args, dict)
                and set(event.args) == {'intent', 'spokenText'}
                and event.args['intent'] in INTENTS
                and isinstance(event.args['spokenText'], str)
                and 1 <= len(event.args['spokenText']) <= 3000)
            if not (valid_status or valid_handoff):
                await session.respond_tool(event.call_id, event.name,
                    {'status': 'rejected', 'reason': 'unsupported_tool_request'})
                return
            if self.tool_calls > 16 or self.consecutive_tool_calls > 2:
                await session.respond_tool(event.call_id, event.name,
                    {'status': 'blocked', 'reason': 'tool_call_limit'})
                return
            if self.semantic:
                # Live may call before its optional final transcript marker.
                # Acknowledge that call without executing it or waiting for a
                # model completion which itself waits for this response.
                await session.respond_tool(event.call_id, event.name,
                    {'status': 'awaiting_server_interpretation',
                     'executed': False, 'message': 'El servidor valida el turno; no anuncies una ejecución.'})
                return
            if valid_status:
                await session.respond_tool(event.call_id, event.name,
                    _current_work(database, identity, settings,
                                  session_id, session_hash))
            else:
                # A second tool call after a routed turn cannot silently
                # reuse old words. Only a repeated call ID is a replay;
                # otherwise wait for a fresh final transcript.
                turn_id = self._latest_speech_turn or self._latest_final_user_turn
                if (not turn_id or self._latest_final_user_turn == turn_id and
                        not self._final_allowed(turn_id, event.args['intent'])):
                    await session.respond_tool(event.call_id, event.name,
                        {'status': 'blocked', 'reason': 'final_transcript_required'})
                elif self._pending_handoff is not None:
                    await session.respond_tool(event.call_id, event.name,
                        {'status': 'blocked', 'reason': 'turn_pending'})
                elif (turn_id == self._last_routed_turn and self._last_routed_call_id is not None
                      and event.call_id != self._last_routed_call_id):
                    await session.respond_tool(event.call_id, event.name,
                        {'status': 'blocked', 'reason': 'already_routed'})
                elif (turn_id and self._latest_final_user_turn != turn_id
                      and self._last_known_user_turn):
                    # Without a causal turn ID in Google's function
                    # call, a late call from A and an early call from B
                    # are indistinguishable while B is still speaking.
                    await session.respond_tool(event.call_id, event.name,
                        {'status': 'blocked', 'reason': 'ambiguous_turn'})
                elif (turn_id and self._final_allowed(turn_id, event.args['intent']) and
                      (turn_id != self._last_routed_turn or
                       self._last_routed_call_id is None or
                       event.call_id == self._last_routed_call_id)):
                    await self._answer_handoff(event.call_id, turn_id,
                                         event.args['intent'],
                                         event.args['spokenText'])
                else:
                    self._pending_handoff = {'callId': event.call_id,
                        'turnId': turn_id,
                        'intent': event.args['intent'],
                        'spokenText': event.args['spokenText']}
                    self.handoff_timeout_task = asyncio.create_task(
                        self._expire_handoff(self._pending_handoff))
        elif isinstance(event, LiveUsage):
            _record_usage(database, identity, session_id, event)
        elif isinstance(event, LiveCaptionUsage):
            record_caption_usage(database, identity, session_id, event)
        elif isinstance(event, LiveCaptionStatus) and event.state in ('ready', 'unavailable'):
            if event.state == 'unavailable':
                finalize_caption_state(database, identity, session_id)
            await sender.event({'type': 'caption_status', 'state': event.state})
        else:
            raise ValueError('invalid provider event')
