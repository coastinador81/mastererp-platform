"""Optional transcription recovery beside the existing Vertex Live voice.

The primary Live socket remains the only source that can authorize tools. The
caption model normally supplies transient text. It may recover the chat text for
one explicitly closed, unambiguous VAD turn when the primary socket never emits
its final transcription. That recovery can order chat and audio, but it cannot
authorize a tool, handoff, ADK job, Drive read, or mutation.
"""
import asyncio
from collections import deque
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import re
import unicodedata

from .uony_live_bridge import (
    LiveIdentity, LiveSpeechStarted, LiveSpeechEnded, LiveTranscript,
    LiveTranscriptPreview, LiveUnconfirmedTurn,
)
from .uony_live_transcribe import TranscribeFinal, TranscribeInterim, TranscribeUsage


logger = logging.getLogger(__name__)
MAX_CAPTION_BACKLOG_BYTES = 32_000  # At most one second of mono PCM16/16 kHz.
MAX_CAPTION_BACKLOG_FRAMES = 64
CAPTION_SEND_TIMEOUT = 2
CAPTION_SETUP_TIMEOUT = 1.5
CAPTION_RECOVERY_GRACE_SECONDS = .2


def _words(text):
    """The spoken words only: case, accents and punctuation are recognizer style."""
    value = unicodedata.normalize('NFKD', text.casefold())
    value = ''.join(char for char in value if not unicodedata.combining(char))
    return tuple(re.findall(r'[-+]?\d+(?:[.,]\d+)*|[^\W\d_]+', value))


@dataclass(frozen=True)
class LiveCaptionStatus:
    """Presentation state only; never authorizes work or changes primary voice."""
    state: str  # ready | unavailable


@dataclass(frozen=True)
class LiveCaptionUsage:
    """Caption-model usage is separate from the primary Live usage receipt."""
    counts: dict


@dataclass(frozen=True)
class LiveCaptionRecovery:
    """Unambiguous chat-text fallback; never an action-authority signal."""
    turn_id: str
    text: str
    occurred_at: datetime


@dataclass
class _Turn:
    turn_id: str
    occurred_at: datetime
    needs_resync: bool = False
    closed: bool = False
    ended: bool = False
    sidecar_done: bool = False
    caption_shown: bool = False
    primary_done: bool = False
    recovered: bool = False
    abandoned: bool = False
    caption_text: str = ''
    held_primary: LiveTranscript | None = None
    recovery_task: object | None = None


async def open_captioned_session(primary, identity: LiveIdentity, access_token: str,
                                 caption_provider):
    """Open captions after the primary provider's OAuth and identity recheck.

    The caller must pass the same freshly refreshed server-side token used for
    primary Live, and must keep its existing pilot admission and revocation
    checks. A caption setup failure is represented explicitly but fails open.
    """
    try:
        # Never make the existing voice wait through the caption provider's
        # full socket/setup timeout. A slow caption startup is a normal
        # fail-open outcome, reported to the browser as unavailable.
        caption = await asyncio.wait_for(caption_provider.open(identity, access_token),
                                         timeout=CAPTION_SETUP_TIMEOUT)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        logger.warning('Optional Live caption unavailable class=%s',
                       type(error).__name__)
        caption = None
    return LiveCaptionSession(primary, caption)


class LiveCaptionSession:
    """The existing LiveSession protocol plus two typed caption-only events."""

    def __init__(self, primary, caption):
        self.primary = primary
        self.caption = caption
        self.websocket = getattr(primary, 'websocket', None)
        self.closed = False
        self._caption_available = caption is not None
        self._audio_queue = asyncio.Queue(maxsize=MAX_CAPTION_BACKLOG_FRAMES)
        self._queued_bytes = 0
        self._status_queue = asyncio.Queue(maxsize=2)
        self._status_queue.put_nowait(LiveCaptionStatus(
            'ready' if self._caption_available else 'unavailable'))
        self._recovery_queue = asyncio.Queue()
        self._turns = deque()
        self._by_id = {}
        self._untracked_primary_finals = set()
        self._active_turn = None
        self._resync_after_recovery = False
        self._pump_task = (asyncio.create_task(self._pump_caption_audio())
                           if self._caption_available else None)
        self._caption_reader = None
        self._caption_close_task = None

    async def send_audio(self, pcm: bytes):
        # Voice has priority. Caption failure or backpressure cannot delay it.
        await self.primary.send_audio(pcm)
        if not self._caption_available:
            return
        if self._queued_bytes + len(pcm) > MAX_CAPTION_BACKLOG_BYTES:
            self._disable_caption('backpressure')
            return
        try:
            self._audio_queue.put_nowait(pcm)
        except asyncio.QueueFull:
            self._disable_caption('backpressure')
        else:
            self._queued_bytes += len(pcm)

    async def interrupt(self):
        await self.primary.interrupt()
        await self.close()

    @property
    def tool_owner(self):
        # ADK route: the provider session, not the router, executes tools.
        return getattr(self.primary, 'tool_owner', None)

    def bind_tools(self, dispatch):
        self.primary.bind_tools(dispatch)

    def turn_for_call(self, call_id):
        return self.primary.turn_for_call(call_id)

    async def respond_tool(self, call_id, name, response, scheduling=None):
        # The caption model never sees tools, their arguments, or results.
        if scheduling is None:
            await self.primary.respond_tool(call_id, name, response)
        else:
            await self.primary.respond_tool(call_id, name, response, scheduling=scheduling)

    async def send_system_context(self, text):
        # A persisted backend update belongs only to the primary Live model.
        await self.primary.send_system_context(text)

    async def _pump_caption_audio(self):
        try:
            while self._caption_available:
                pcm = await self._audio_queue.get()
                self._queued_bytes -= len(pcm)
                await asyncio.wait_for(self.caption.send_audio(pcm),
                                       timeout=CAPTION_SEND_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self._disable_caption(type(error).__name__)

    def _disable_caption(self, reason):
        if not self._caption_available or self.closed:
            return
        self._caption_available = False
        logger.warning('Optional Live caption stopped reason=%s', reason)
        self._status_queue.put_nowait(LiveCaptionStatus('unavailable'))
        if self._pump_task and self._pump_task is not asyncio.current_task():
            self._pump_task.cancel()
        if self._caption_reader and self._caption_reader is not asyncio.current_task():
            self._caption_reader.cancel()
        self._caption_close_task = asyncio.create_task(self.caption.close())

    def _next_caption_turn(self):
        # Transcribe carries no Uonify turn ID or reliable speech offset. If
        # two VAD turns await a caption final, even FIFO is unsafe: one caption
        # final might span both utterances. Disable preview in that case.
        unresolved = [turn for turn in self._turns if not turn.sidecar_done]
        if len(unresolved) > 1:
            self._disable_caption('ambiguous_turns')
            return None
        return unresolved[0] if unresolved else None

    def _recover(self, turn):
        text = (turn.caption_text if turn.sidecar_done and turn.caption_text else
                turn.held_primary.text if turn.needs_resync and turn.held_primary else '')
        if (turn.primary_done or turn.recovered or turn.abandoned or not turn.ended
                or not text):
            return []
        mark = getattr(self.primary, 'mark_caption_recovered', None)
        if not callable(mark) or not mark(turn.turn_id):
            logger.warning('Live caption recovery rejected turn_id=%s', turn.turn_id)
            if turn.held_primary is None:
                # Sin primaria propia suele ser un turno partido cuya frase ya
                # llegó por otro turno: avisar aquí pediría repetir algo atendido.
                return []
            # Voz real, 20-10-2026: primaria y subtítulo discrepaban y la frase se perdía
            # en silencio. El router pide que se repita (decisión del dueño) y el turno
            # queda cerrado: una primaria tardía ya no lo reabre.
            turn.abandoned = True
            return [LiveUnconfirmedTurn(turn.turn_id, text)]
        turn.recovered = True
        self._resync_after_recovery = True
        return [LiveCaptionRecovery(turn.turn_id, text,
                                    turn.occurred_at)]

    def _schedule_recovery(self, turn):
        recoverable = (turn.ended and not turn.primary_done and not turn.recovered and
            ((turn.sidecar_done and bool(turn.caption_text)) or
             (turn.needs_resync and turn.held_primary is not None)))
        if not recoverable or turn.recovery_task is not None:
            return

        async def delayed():
            await asyncio.sleep(CAPTION_RECOVERY_GRACE_SECONDS)
            self._recovery_queue.put_nowait(turn)

        turn.recovery_task = asyncio.create_task(delayed())

    @staticmethod
    def _same_text(first, second):
        # Two recognizers of the same audio differ in punctuation, case and
        # accents. Only a different word sequence is a conflict: on 20-10-2026
        # «Dime mis carpetas de Drive.» against the same words without the
        # period dropped two spoken requests and every turn after them.
        return _words(first) == _words(second)

    def _resolve_closed_turn(self, turn):
        if not turn.ended:
            return []
        if not turn.needs_resync:
            self._schedule_recovery(turn)
            return []
        if turn.held_primary is None or not turn.sidecar_done:
            self._schedule_recovery(turn)
            return []
        primary, turn.held_primary = turn.held_primary, None
        if self._same_text(primary.text, turn.caption_text):
            turn.primary_done = True
            self._resync_after_recovery = False
            return [primary]
        logger.warning('Live caption resync conflict turn_id=%s', turn.turn_id)
        turn.held_primary = primary
        self._schedule_recovery(turn)
        return []

    def _primary_event(self, event):
        if isinstance(event, LiveSpeechStarted) and event.turn_id:
            if event.turn_id in self._by_id:
                return [event]
            if self._active_turn is not None:
                self._active_turn.closed = True
            turn = _Turn(event.turn_id, datetime.now(timezone.utc),
                         needs_resync=self._resync_after_recovery)
            self._turns.append(turn)
            self._by_id[event.turn_id] = turn
            self._active_turn = turn
            if self._caption_available:
                self._next_caption_turn()
            return [event]
        if isinstance(event, LiveSpeechEnded):
            turn = self._by_id.get(event.turn_id)
            if turn:
                turn.closed = True
                turn.ended = True
                if self._active_turn is turn:
                    self._active_turn = None
                return [event, *self._resolve_closed_turn(turn)]
            return [event]
        if isinstance(event, LiveTranscript) and event.role == 'user':
            turn = self._by_id.get(event.turn_id)
            if turn is None:
                # Existing non-VAD path remains supported, without forwarding
                # two conflicting provider finals for the same turn ID.
                if event.turn_id in self._untracked_primary_finals:
                    return []
                self._untracked_primary_finals.add(event.turn_id)
                return [event]
            if turn.abandoned:
                return []
            if turn.recovered:
                turn.primary_done = True
                recovered_text = turn.caption_text or (
                    turn.held_primary.text if turn.held_primary else '')
                if self._same_text(event.text, recovered_text):
                    # Same words corroborate the recovered turn, so the next turn
                    # needs no resync. Only an identical text is forwarded: the
                    # saved turn cannot hold two texts (20-10-2026, voice cut 1011).
                    self._resync_after_recovery = False
                    return [event] if event.text.strip() == recovered_text.strip() else []
                else:
                    # Never log either transcript: customer speech can contain
                    # personal or commercial data. The turn stays recovered and
                    # non-authoritative; the socket remains usable.
                    logger.warning('Live caption recovery conflict turn_id=%s',
                                   turn.turn_id)
                return []
            if turn.needs_resync:
                # The provider does not label delayed input transcription with
                # its source VAD. After a recovery, hold one primary final until
                # the independent sidecar confirms whether it belongs here.
                turn.held_primary = event
                updates = self._resolve_closed_turn(turn)
                self._schedule_recovery(turn)
                return updates
            if turn.primary_done:
                return []
            turn.primary_done = True
            return [event]
        if isinstance(event, LiveTranscriptPreview) and event.role == 'user':
            turn = self._by_id.get(event.turn_id)
            if turn and (turn.primary_done or
                         (turn.caption_shown and self._caption_available)):
                return []
        return [event]

    def _caption_event(self, event):
        if isinstance(event, TranscribeUsage):
            return [LiveCaptionUsage(event.counts)]
        if not self._caption_available:
            return []
        turn = self._next_caption_turn()
        if turn is None:
            return []
        if isinstance(event, TranscribeInterim):
            if turn is not self._active_turn or turn.primary_done:
                return []
            turn.caption_shown = True
            return [LiveTranscriptPreview('user', turn.turn_id, event.text)]
        if isinstance(event, TranscribeFinal):
            text = event.text.strip()
            if not text or len(text) > 3000:
                self._disable_caption('invalid_final')
                self._schedule_recovery(turn)
                return []
            turn.sidecar_done = True
            if turn.primary_done:
                return []
            turn.caption_text = text
            turn.caption_shown = True
            return [LiveTranscriptPreview('user', turn.turn_id, text),
                    *self._resolve_closed_turn(turn)]
        return []

    async def events(self):
        primary = self.primary.events().__aiter__()
        primary_next = asyncio.create_task(anext(primary))
        caption_next = None
        if self._caption_available:
            caption = self.caption.events().__aiter__()
            caption_next = asyncio.create_task(anext(caption))
            self._caption_reader = caption_next
        status_next = asyncio.create_task(self._status_queue.get())
        recovery_next = asyncio.create_task(self._recovery_queue.get())
        try:
            while True:
                tasks = {primary_next, status_next, recovery_next}
                if caption_next is not None:
                    tasks.add(caption_next)
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                # Primary VAD has priority if it arrives in the same tick as
                # caption text. This avoids attributing an interim to silence.
                if primary_next in done:
                    try:
                        event = primary_next.result()
                    except StopAsyncIteration:
                        break
                    primary_next = asyncio.create_task(anext(primary))
                    for update in self._primary_event(event):
                        yield update
                if caption_next is not None and caption_next in done:
                    try:
                        event = caption_next.result()
                    except StopAsyncIteration:
                        self._disable_caption('CleanClose')
                        caption_next = None
                    except asyncio.CancelledError:
                        caption_next = None
                    except Exception as error:
                        self._disable_caption(type(error).__name__)
                        caption_next = None
                    else:
                        caption_next = (asyncio.create_task(anext(caption))
                                        if self._caption_available else None)
                        self._caption_reader = caption_next
                        for update in self._caption_event(event):
                            yield update
                if status_next in done:
                    status = status_next.result()
                    yield status
                    if status.state == 'unavailable':
                        for turn in self._turns:
                            if turn.caption_shown and not turn.primary_done:
                                turn.caption_shown = False
                                yield LiveTranscriptPreview('user', turn.turn_id, '')
                            self._schedule_recovery(turn)
                    status_next = asyncio.create_task(self._status_queue.get())
                if recovery_next in done:
                    turn = recovery_next.result()
                    for update in self._recover(turn):
                        yield update
                    recovery_next = asyncio.create_task(self._recovery_queue.get())
        finally:
            for task in (primary_next, caption_next, status_next, recovery_next):
                if task is not None:
                    task.cancel()
                    with suppress(asyncio.CancelledError, StopAsyncIteration):
                        await task

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if self._pump_task:
            self._pump_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self._pump_task
        if self._caption_close_task:
            with suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(self._caption_close_task, timeout=2)
        elif self.caption is not None:
            with suppress(Exception):
                await asyncio.wait_for(self.caption.close(), timeout=2)
        for turn in self._turns:
            if turn.recovery_task is not None:
                turn.recovery_task.cancel()
        await self.primary.close()
