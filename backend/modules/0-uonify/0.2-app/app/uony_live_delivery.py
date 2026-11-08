"""Durable Live handoff notices; never turn backend data into a user utterance."""
import asyncio
from contextlib import asynccontextmanager
import logging
import re
import unicodedata
from uuid import UUID

from .uony_conversation_queue import ConversationQueue
from .uony_drive_instruction import parse_drive_instruction
from .uony_live_bridge import MAX_FRAME_BYTES, _session_allowed
from .uony_live_result_speech import LiveResultSpeech


TERMINAL = frozenset({'success', 'error', 'unknown', 'cancelled'})
logger = logging.getLogger(__name__)


class LockedLiveSender:
    def __init__(self, websocket):
        self.websocket = websocket
        self.lock = asyncio.Lock()
        # PCM has no metadata of its own: ordinary and verified envelopes
        # must share one lane. Controls retain the independent message lock.
        self.audio_lane = asyncio.Lock()
        self.guard = None
        self.failure = None

    def set_guard(self, guard):
        self.guard = guard

    def _check(self):
        if self.failure:
            raise self.failure
        if self.guard:
            self.guard()

    async def event(self, payload):
        async with self.lock:
            self._check()
            await self.websocket.send_json(payload)

    async def audio(self, pcm):
        async with self.lock:
            self._check()
            await self.websocket.send_bytes(pcm)

    async def _speech_boundary(self, packet):
        """Reconcile a cancelled boundary before another audio envelope can open."""
        sending = asyncio.create_task(self.websocket.send_json(packet))
        try:
            await asyncio.shield(sending)
            return False
        except asyncio.CancelledError:
            try:
                await asyncio.wait_for(asyncio.shield(sending), .25)
            except BaseException as error:
                sending.cancel()
                self.failure = RuntimeError('verified audio boundary uncertain')
                close = getattr(self.websocket, 'close', None)
                if close:
                    try:
                        await asyncio.wait_for(close(code=1011,
                            reason='voice_delivery_uncertain'), .25)
                    except Exception:
                        pass
                raise self.failure from error
            return True

    async def speech(self, event_id, request_id, frames, *, valid, on_first_audio=None,
                     can_start=None, on_start=None):
        # An envelope cannot interleave with ordinary Live PCM. The client still
        # stops its scheduled audio immediately on the next VAD start event.
        async with self.audio_lane, self.lock:
            def check():
                self._check()
                if not valid():
                    raise asyncio.CancelledError()
            check()
            if can_start is not None and not can_start():
                return False
            if on_start:
                on_start()
            packet = {'type': 'speech_delivery', 'eventId': event_id,
                      'requestId': request_id}
            started = False
            try:
                cancelled = await self._speech_boundary({**packet, 'phase': 'start'})
                started = True
                if cancelled:
                    raise asyncio.CancelledError()
                for index, frame in enumerate(frames):
                    check()
                    await self.websocket.send_bytes(frame)
                    if index == 0 and on_first_audio:
                        await on_first_audio()
            except BaseException:
                # End alone would look like a complete, shorter utterance.
                # Mark interruption inside the envelope before ending it.
                if started:
                    self._check()
                    await self.websocket.send_json({'type': 'interrupted'})
                raise
            finally:
                if started:
                    self._check()
                    if await self._speech_boundary({**packet, 'phase': 'end'}):
                        raise asyncio.CancelledError()
            return True

    @asynccontextmanager
    async def speech_stream(self, event_id, request_id, *, valid, on_first_audio=None,
                            can_start=None, on_start=None):
        """One verified envelope whose PCM is produced while it is being sent.

        Like ordinary audio, the lane is held for the whole envelope and the
        message lock only per send, so VAD, transcripts and progress keep
        flowing between frames. Yields None when playback cannot start yet.
        """
        async with self.audio_lane:
            def check():
                self._check()
                if not valid():
                    raise asyncio.CancelledError()
            packet = {'type': 'speech_delivery', 'eventId': event_id,
                      'requestId': request_id}
            async with self.lock:
                check()
                ready = can_start is None or can_start()
                if ready and on_start:
                    on_start()
                # A start delivered while this task was cancelled still opened
                # the envelope: it is closed below like any interruption.
                cancelled = ready and await self._speech_boundary({**packet, 'phase': 'start'})
            if not ready:
                yield None
                return
            sent = 0

            async def send(pcm):
                nonlocal sent
                for offset in range(0, len(pcm), MAX_FRAME_BYTES):
                    async with self.lock:
                        check()
                        await self.websocket.send_bytes(pcm[offset:offset + MAX_FRAME_BYTES])
                    sent += 1
                    if sent == 1 and on_first_audio:
                        await on_first_audio()

            try:
                if cancelled:
                    raise asyncio.CancelledError()
                yield send
            except BaseException:
                # End alone would look like a complete, shorter utterance.
                async with self.lock:
                    self._check()
                    await self.websocket.send_json({'type': 'interrupted'})
                raise
            finally:
                async with self.lock:
                    self._check()
                    if await self._speech_boundary({**packet, 'phase': 'end'}):
                        raise asyncio.CancelledError()


def explicit_intent(text, *, creative_follow_up=False):
    """Only a final customer instruction may bypass a missing model tool call.

    Creating a product goes to the conversational worker, which decides the
    next question. It does not itself create, publish or read Drive content.
    """
    if creative_follow_up:
        direct = explicit_intent(text)
        if direct:
            return direct
        if not isinstance(text, str):
            return None
        follow_up = ''.join(char for char in unicodedata.normalize('NFD', text.casefold())
                            if unicodedata.category(char) != 'Mn').strip()
        if re.fullmatch(r'(?:he guardado(?: (?:el|un) borrador)?|gracias|vale|ok|'
                        r'perfecto|bien|de acuerdo|entendido|listo)[.!?]*', follow_up):
            return None
        if follow_up and not re.match(
                r'^(?:detente|cancela|para\b|no\s+(?:quiero|hagas|continues)\b|'
                r'si\b|cuando\b|hablemos\s+de\s+otra\s+cosa\b)', follow_up):
            return 'creative_plan'
        return None
    if parse_drive_instruction(text) is not None:
        return 'use_drive_materials'
    if not isinstance(text, str):
        return None
    plain = ''.join(char for char in unicodedata.normalize('NFD', text.casefold())
                    if unicodedata.category(char) != 'Mn').strip()
    if (not plain or plain[0] in '«"“' or
            re.match(r'^(?:no|nunca|si|cuando|luego|despues|mas tarde|hipotetic[oa])\b', plain)
            or re.search(r'\b(?:si|cuando|hipotetic[oa])\b', plain[:100])
            or re.search(r'\b(?:no todavia|mas tarde)\b', plain[:120])
            or re.search(r'\b(?:luego|despues)\s*[.!?]*$', plain)):
        return None
    if re.match(r'^(?:oye[,\s]+|uony[,\s]+|wony[,\s]+|por favor[,\s]+)*'
                r'(?:quiero|necesito|vamos a)\s+(?:que\s+(?:crees|hagas)|crear|hacer)\s+'
                r'(?:(?:un|una|el|la)\s+)?(?:producto|ficha)\b', plain):
        return 'create_product'
    if re.match(r'^(?:oye[,\s]+|uony[,\s]+|wony[,\s]+|por favor[,\s]+)*'
                r'(?:(?:quiero|necesito|me gustaria|vamos a)\s+'
                r'(?:(?:que\s+(?:crees|hagas|prepares)|crear|hacer|preparar|generar)\s+'
                r'|(?:(?:un|una)\s+))'
                r'|(?:un|una)\s+)'
                r'(?:(?:un|una|el|la)\s+)?'
                r'(?:video|imagen|anuncio|creatividad)\b', plain):
        return 'creative_plan'
    if re.match(r'^(?:oye[,\s]+|uony[,\s]+|wony[,\s]+|por favor[,\s]+)*'
                r'(?:disena|prepara|planifica|crea|haz)\b.{0,120}'
                r'\b(?:video|imagen|anuncio|creatividad)\b', plain):
        return 'creative_plan'
    return None


def work_state(database, settings, identity, session_id, session_hash, request_id):
    """Read one exact handoff under owner, thread, Cloud-project and session fences."""
    try:
        request_id = UUID(str(request_id))
    except (TypeError, ValueError, AttributeError):
        return None
    if (identity.user_id not in settings.live_pilot_user_ids or
            not _session_allowed(database, identity, session_id, session_hash)):
        return None
    with database.connect() as c:
        row = c.execute('''SELECT h.request_id FROM uony_live_handoffs h
            JOIN uony_threads t ON t.user_id=h.user_id AND t.id=h.thread_id
            WHERE h.user_id=%s AND h.thread_id=%s
              AND h.request_id=%s AND h.google_subject=%s
              AND h.google_project_id=%s AND t.deleted_at IS NULL''',
            (identity.user_id, identity.thread_id, request_id,
             identity.google_subject, identity.project_id)).fetchone()
        if not row:
            return None
        queue = ConversationQueue(database, (), 1)
        state = queue.inspect(c, {'id': identity.user_id,
                                  'google_subject': identity.google_subject}, request_id)
        result = {'status': state['status'], 'requestId': str(request_id),
                  'statusScope': 'conversation_handoff'}
        if state.get('semanticRecovery'):
            result['semanticRecovery'] = state['semanticRecovery']
        if state['status'] == 'success':
            result['reply'] = (state.get('response') or {}).get('reply', '')
        elif state['status'] in TERMINAL:
            result['error'] = (state.get('error') or {}).get('message', '')[:500]
        return result


def live_projection(state):
    """What the conversational model may learn about a request: its status.

    Audit F0.3 (20-10-2026): never the reply, an error text or any Drive
    content; the server shows the result in the chat and narrates it.
    """
    return {'status': state['status'], 'requestId': state['requestId'],
            'message': ('El resultado está en el chat y Uony lo lee en voz alta; '
                        'no lo repitas ni lo inventes.' if state['status'] in TERMINAL
                        else 'El encargo sigue en curso; espera su resultado.')}


class LiveDeliveryTracker:
    """Watch persisted jobs without blocking audio; report each terminal once."""

    def __init__(self, database, settings, identity, session_id, session_hash,
                 session, send_event, *, renderer=None, sender=None, send_audio=None,
                 continuity=None, lease=None):
        self.database, self.settings, self.identity = database, settings, identity
        self.session_id, self.session_hash = session_id, session_hash
        self.session, self.send_event = session, send_event
        self.pending = {}
        self.delivered = set()
        self.unconfirmed_turns = set()
        self.task = None
        self.speech = LiveResultSpeech(database, identity, session_id, renderer,
            sender, continuity, lease, validate=lambda: _session_allowed(
                database, identity, session_id, session_hash))

    async def restore(self, snapshot):
        # Reconnect restores the existing job in the UI. An uncertain playback
        # is never repeated automatically, even if its acknowledgement was lost.
        await asyncio.to_thread(self.speech.store.reconcile_previous_session)
        for item in (snapshot or {}).get('work', []):
            self.pending[item['requestId']] = {'turnId': item['turnId'],
                'callId': None, 'restored': True}
        if self.pending:
            self.task = asyncio.create_task(self._run())

    async def acknowledge(self, event_id, outcome):
        await self.speech.acknowledge(event_id, outcome)

    async def unconfirmed(self, turn_id, text, *, intent=None, speak=True):
        # A contextual Drive follow-up can be classified from durable thread
        # context even when its words are elliptical. The caller supplies that
        # server-side classification only to show this warning; it never
        # authorizes or routes the action.
        if turn_id in self.unconfirmed_turns or not (intent or explicit_intent(text)):
            return
        self.unconfirmed_turns.add(turn_id)
        await self.send_event({'type': 'action_unconfirmed',
            'threadId': self.identity.thread_id, 'turnId': turn_id,
            'reason': 'transcript_not_verified'})
        # Owner decision 20-10-2026: when Uony is unsure what it heard, it also
        # says so aloud and asks to repeat. Other blocks (busy...) never do.
        if speak:
            await self.speech.say_notice(turn_id)

    async def watch(self, outcome, turn_id, call_id=None, *, announce=True):
        request_id = outcome.get('requestId')
        if not request_id:
            if call_id:
                await self.session.respond_tool(call_id, 'route_spoken_request', outcome)
            return
        if request_id in self.delivered:
            if call_id:
                state = work_state(self.database, self.settings, self.identity,
                    self.session_id, self.session_hash, request_id)
                if state:
                    await self.session.respond_tool(call_id, 'route_spoken_request',
                        live_projection(state),
                        scheduling='SILENT' if self.speech.renderer else 'WHEN_IDLE')
            return
        item = self.pending.setdefault(request_id, {'turnId': turn_id,
            'callId': None, 'announce': announce})
        if call_id:
            if item['callId'] is None:
                item['callId'] = call_id
            elif item['callId'] != call_id:
                await self.session.respond_tool(call_id, 'route_spoken_request',
                    {'status': 'blocked', 'reason': 'turn_pending'})
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run())

    async def _run(self):
        while self.pending:
            await asyncio.sleep(0.4)
            if getattr(self.session, 'closed', False):
                return
            for request_id, item in tuple(self.pending.items()):
                try:
                    state = await asyncio.to_thread(work_state, self.database,
                        self.settings, self.identity, self.session_id,
                        self.session_hash, request_id)
                except Exception as error:
                    # A temporary database read failure must not kill the voice
                    # socket or turn a pending job into a second execution.
                    logger.warning('Live delivery read failed: %s', type(error).__name__)
                    continue
                if state is None:
                    self.pending.pop(request_id, None)
                    continue
                if state['status'] not in TERMINAL:
                    continue
                if getattr(self.session, 'closed', False):
                    return
                # The same backend result reaches the UI even when Gemini
                # never issued a function call. This never re-enqueues work.
                try:
                    await self.send_event({'type': 'handoff', 'turnId': item['turnId'],
                        'requestId': request_id, 'threadId': self.identity.thread_id,
                        'status': state['status'], **({'semanticRecovery': state['semanticRecovery']}
                        if state.get('semanticRecovery') else {})})
                    if item['callId']:
                        # Only a genuine call ID permits an asynchronous
                        # function response at the next natural pause.
                        await self.session.respond_tool(item['callId'],
                            'route_spoken_request', live_projection(state),
                            scheduling='SILENT' if self.speech.renderer else 'WHEN_IDLE')
                    # The reply never enters the Live session (audit F0.3).
                    if not item.get('restored') and item.get('announce', True):
                        await self.speech.announce(request_id, item['turnId'], state)
                except Exception as error:
                    # A send of uncertain outcome is never repeated; the
                    # persisted request remains readable from the chat.
                    logger.warning('Live delivery send failed: %s', type(error).__name__)
                finally:
                    self.pending.pop(request_id, None)
                    self.delivered.add(request_id)

    async def close(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            except Exception as error:
                logger.warning('Live delivery stopped: %s', type(error).__name__)
        await self.speech.close()
