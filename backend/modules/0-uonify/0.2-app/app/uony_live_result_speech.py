"""Narrate a persisted result through Live, never through a synthetic tool call."""
import asyncio
import inspect
import json
import logging
import math
import time
from uuid import UUID, uuid4
from .uony_live_delivery_store import LiveDeliveryStore, narration_budget_ms

logger = logging.getLogger(__name__)
NARRATION_MILESTONES = frozenset({'identity_checked', 'authenticated',
    'identity_rechecked', 'socket_opened', 'setup_completed', 'generation_requested',
    'first_pcm', 'first_transcript', 'first_release', 'last_pcm', 'generation_completed',
    'transcript_finished', 'turn_completed', 'socket_closed', 'verified'})
# A verified narration holds the output lane until the browser acknowledges it.
# If that acknowledgement is lost, release the lane once the audio's own length
# plus a margin has passed: never record it as heard, but never let one lost
# acknowledgement silence every later reply of the session either.
PLAYBACK_ACK_GRACE_SECONDS = 8.0
OUTPUT_BYTES_PER_SECOND = 24000 * 2
# Owner decision 20-10-2026: when a spoken request cannot be confirmed, Uony
# says so aloud with its verified voice and asks to repeat it.
REPEAT_NOTICE = 'No te he entendido bien, ¿me lo repites?'
# A fixed notice is rendered and verified once per process, then reused.
_NOTICE_AUDIO = {}


def _correlation_id(value):
    # Correlation fields must never become a side channel for message contents.
    try:
        return str(UUID(str(value))) if isinstance(value, (str, UUID)) else None
    except ValueError:
        return None


def _milestones(value):
    if not isinstance(value, dict):
        return {}
    clean = {}
    for key in NARRATION_MILESTONES:
        number = value.get(key)
        if not isinstance(number, (int, float)) or isinstance(number, bool):
            continue
        try:
            number = float(number)
        except OverflowError:
            continue
        if math.isfinite(number) and number >= 0:
            clean[key] = round(number, 3)
    return clean


def _elapsed(started):
    return round(max(0, time.monotonic() - started) * 1000, 3)


class LiveResultSpeech:
    def __init__(self, database, identity, session_id, renderer, sender,
                 continuity=None, lease=None, validate=None):
        self.identity, self.renderer, self.sender = identity, renderer, sender
        # A renderer that accepts on_audio speaks while it generates (owner
        # decision 20-10-2026); any other keeps the buffered, verified path.
        self.streaming = (renderer is not None and hasattr(sender, 'speech_stream')
                          and 'on_audio' in inspect.signature(renderer).parameters)
        self.session_id = session_id
        self.store = LiveDeliveryStore(database, identity, session_id)
        self.continuity, self.lease = continuity, lease
        self.validate = validate
        self.task = None
        self.runner = None
        self.pending = {}
        self.idle = asyncio.Event()
        self.idle.set()
        self.generation = 0
        self.speaking = False
        self.model_speaking = self.client_playing = self.closed = False
        self.verified_event = None
        self.verified_idle = asyncio.Event()
        self.verified_idle.set()
        self.ack_watchdog = None
        self.delivery_clocks = {}
        self.notice_events = set()

    def _trace(self, phase, request_id, turn_id, event_id, started, **measurements):
        payload = {'type': 'live_speech_timing', 'phase': phase,
            'sessionId': _correlation_id(self.session_id),
            'requestId': _correlation_id(request_id), 'turnId': _correlation_id(turn_id),
            'eventId': _correlation_id(event_id), 'elapsedMs': _elapsed(started),
            **measurements}
        logger.info('Live speech telemetry %s', json.dumps(payload, sort_keys=True))

    async def _wait_for_playback(self, request_id, turn_id, event_id, started):
        waiting = time.monotonic()
        self._trace('playback_wait_started', request_id, turn_id, event_id, started)
        await self.idle.wait()
        self._trace('playback_wait_completed', request_id, turn_id, event_id, started,
                    durationMs=_elapsed(waiting))

    @property
    def verified_playback_pending(self):
        return self.verified_event is not None

    async def wait_verified_playback(self):
        await self.verified_idle.wait()

    def _reserve_playback(self, event_id, expected_seconds=None):
        self.verified_event = event_id
        self.verified_idle.clear()
        self._update_idle()
        if expected_seconds is not None:
            self._stop_ack_watchdog()
            self.ack_watchdog = asyncio.create_task(self._expire_playback(
                event_id, expected_seconds + PLAYBACK_ACK_GRACE_SECONDS))

    def _stop_ack_watchdog(self):
        watchdog, self.ack_watchdog = self.ack_watchdog, None
        if (watchdog and not watchdog.done()
                and watchdog is not asyncio.current_task()):
            watchdog.cancel()

    async def _expire_playback(self, event_id, seconds):
        started = time.monotonic()
        await asyncio.sleep(seconds)
        if self.closed or self.verified_event != event_id:
            return
        # No played/interrupted acknowledgement arrived: the delivery keeps its
        # unacknowledged state; only the lane is released for later replies.
        self._trace('playback_ack_timeout', None, None, event_id, started,
                    waitedMs=round(seconds * 1000))
        self._release_playback(event_id)

    def _release_playback(self, event_id=None):
        if event_id is None or event_id == self.verified_event:
            self._stop_ack_watchdog()
            self.verified_event = None
            self.verified_idle.set()
            self._update_idle()

    def _update_idle(self):
        if (self.speaking or self.model_speaking or self.client_playing
                or self.verified_playback_pending):
            self.idle.clear()
        else:
            self.idle.set()

    def model_status(self, state):
        self.model_speaking = state == 'speaking'
        self._update_idle()

    def client_playback(self, state):
        self.client_playing = state == 'playing'
        self._update_idle()

    def speech_started(self):
        self.speaking = True
        self.idle.clear()
        self.generation += 1
        self._release_playback()
        if self.task and not self.task.done():
            self.task.cancel()

    def speech_ended(self):
        self.speaking = False
        self._update_idle()

    async def _checkpoint(self, event_id, request_id, turn_id, state):
        if self.continuity:
            await asyncio.to_thread(self.continuity.checkpoint, self.lease,
                event_id=event_id, request_id=request_id, turn_id=turn_id,
                delivery_state=state)

    async def _reconcile_checkpoint(self, event_id, request_id, turn_id, state):
        try:
            await self._checkpoint(event_id, request_id, turn_id, state)
        except Exception as error:
            # The delivery ledger remains authoritative for this attempt. A
            # stale lease or cache outage must not turn cancellation handling
            # into another voice failure.
            logger.warning('Live continuity reconciliation failed state=%s class=%s',
                           state, type(error).__name__)

    async def announce(self, request_id, turn_id, state):
        if self.closed or not self.renderer or not self.sender:
            return
        text = state.get('reply') if state['status'] == 'success' else state.get('error')
        if not text:
            return
        self.pending.setdefault(request_id, (turn_id, text))
        if self.runner is None or self.runner.done():
            self.runner = asyncio.create_task(self._run())

    async def say_notice(self, turn_id, text=REPEAT_NOTICE):
        """Say a fixed notice with Uony's verified voice. It is not a result:
        no job, receipt or delivery ledger exists for it, and a new utterance
        cancels it like any narration."""
        if self.closed or not self.renderer or not self.sender:
            return
        self.pending.setdefault(('notice', turn_id), (turn_id, text))
        if self.runner is None or self.runner.done():
            self.runner = asyncio.create_task(self._run())

    async def _run(self):
        while self.pending and not self.closed:
            await self.idle.wait()
            request_id = next(iter(self.pending))
            turn_id, text = self.pending.pop(request_id)
            speak = self._notice if isinstance(request_id, tuple) else self._render
            self.task = asyncio.create_task(speak(request_id, turn_id, text,
                                                  self.generation))
            try:
                await self.task
            except asyncio.CancelledError:
                # A user interruption cancels this narration, not later results.
                if self.runner.cancelling():
                    raise

    async def _progress(self, request_id, turn_id, phase, *, reason=None):
        # Scope UI-only state to the existing persisted request, never an action.
        if not self.identity or not getattr(self.identity, 'thread_id', None):
            return
        try:
            await self.sender.event({'type': 'speech_progress',
                'threadId': str(self.identity.thread_id), 'turnId': str(turn_id),
                'requestId': str(request_id), 'phase': phase,
                **({'reason': reason} if reason else {})})
        except Exception as error:
            logger.warning('Live speech progress unavailable phase=%s class=%s',
                           phase, type(error).__name__)

    async def _render(self, request_id, turn_id, text, generation):
        event_id = None
        usage = None
        preparing = False
        started = time.monotonic()
        try:
            if self.validate and not await asyncio.to_thread(self.validate):
                return
            if self.continuity and not await asyncio.to_thread(
                    self.continuity.is_current, self.lease):
                return
            self._trace('reservation_started', request_id, turn_id, None, started)
            reservation = asyncio.create_task(asyncio.to_thread(self.store.begin, request_id))
            try:
                event_id = await asyncio.shield(reservation)
            except asyncio.CancelledError:
                # A database thread cannot be cancelled: reconcile its receipt
                # before returning so no rendering attempt is left unowned.
                event_id = await reservation
                raise
            if not event_id:
                self._trace('reservation_unavailable', request_id, turn_id, None, started)
                return
            delivery_clock = {'started': started}
            self.delivery_clocks[event_id] = delivery_clock
            self._trace('reserved', request_id, turn_id, event_id, started)
            await self._checkpoint(event_id, request_id, turn_id, 'pending')
            if self.validate and not await asyncio.to_thread(self.validate):
                raise asyncio.CancelledError()
            preparing = True
            await self._progress(request_id, turn_id, 'preparing')
            if self.streaming:
                usage = await self._stream(request_id, turn_id, event_id, text, generation,
                                           started, delivery_clock)
                return
            rendering = time.monotonic()
            self._trace('preparation_started', request_id, turn_id, event_id, started)
            result = await self.renderer(self.identity, text)
            self._trace('preparation_completed', request_id, turn_id, event_id, started,
                durationMs=_elapsed(rendering),
                narrationMilestonesMs=_milestones(getattr(result, 'timings_ms', None)))
            usage = result.usages[-1] if result.usages else None
            if result.elapsed_ms > narration_budget_ms():
                logger.warning('Live latency alert phase=verified_narration elapsed_ms=%d budget_ms=%d',
                               result.elapsed_ms, narration_budget_ms())
            await self._wait_for_playback(request_id, turn_id, event_id, started)
            if self.speaking or generation != self.generation or self.closed:
                raise asyncio.CancelledError()
            if self.continuity and not await asyncio.to_thread(
                    self.continuity.is_current, self.lease):
                raise asyncio.CancelledError()
            if not await asyncio.to_thread(self.store.update, event_id, 'sending', usage=usage):
                self.delivery_clocks.pop(event_id, None)
                self._trace('delivery_unavailable', request_id, turn_id, event_id, started)
                return
            await self._checkpoint(event_id, request_id, turn_id, 'sent')
            audio_seconds = sum(len(frame) for frame in result.frames) / OUTPUT_BYTES_PER_SECOND
            while True:
                await self._wait_for_playback(request_id, turn_id, event_id, started)
                if self.speaking or generation != self.generation or self.closed:
                    raise asyncio.CancelledError()
                if self.validate and not await asyncio.to_thread(self.validate):
                    raise asyncio.CancelledError()
                if self.continuity and not await asyncio.to_thread(
                        self.continuity.is_current, self.lease):
                    raise asyncio.CancelledError()
                sending = time.monotonic()

                def playback_started():
                    self._reserve_playback(event_id, audio_seconds)
                    self._trace('send_started', request_id, turn_id, event_id, started)

                async def first_audio_sent():
                    delivery_clock['first_audio'] = time.monotonic()
                    self._trace('first_audio_sent', request_id, turn_id, event_id, started,
                                sendWaitMs=_elapsed(sending))
                    await asyncio.to_thread(self.store.mark_sent, event_id)

                sent = await self.sender.speech(event_id, request_id, result.frames,
                    valid=lambda: not self.closed and not self.speaking
                        and generation == self.generation,
                    can_start=lambda: not self.model_speaking and not self.client_playing,
                    on_start=playback_started, on_first_audio=first_audio_sent)
                if sent:
                    self._trace('send_completed', request_id, turn_id, event_id, started,
                                durationMs=_elapsed(sending))
                    break
                # Ordinary playback can start during a checkpoint or while
                # acquiring the lane. Keep these verified frames, then wait;
                # this is not a new render, tool call or customer instruction.
                self._update_idle()
        except asyncio.CancelledError:
            self.delivery_clocks.pop(event_id, None)
            self._trace('cancelled', request_id, turn_id, event_id, started)
            self._release_playback(event_id)
            if event_id:
                changed = await asyncio.to_thread(
                    self.store.update, event_id, 'interrupted', usage=usage)
                if changed:
                    await self._reconcile_checkpoint(
                        event_id, request_id, turn_id, 'interrupted')
            # Interruption only stops narration; the admitted job is untouched.
        except Exception as error:
            self.delivery_clocks.pop(event_id, None)
            self._trace('failed', request_id, turn_id, event_id, started,
                narrationMilestonesMs=_milestones(getattr(error, 'timings_ms', None)))
            self._release_playback(event_id)
            observed = getattr(error, 'usages', ())
            usage = observed[-1] if observed else usage
            if event_id:
                changed = await asyncio.to_thread(
                    self.store.update, event_id, 'unknown', usage=usage)
                if changed:
                    await self._reconcile_checkpoint(
                        event_id, request_id, turn_id, 'unknown')
                    await self._progress(request_id, turn_id, 'failed',
                                         reason='narration_unavailable')
            logger.warning('Live result narration failed: %s', type(error).__name__)
        finally:
            if preparing:
                await self._progress(request_id, turn_id, 'settled')

    async def _stream(self, request_id, turn_id, event_id, text, generation, started,
                      delivery_clock):
        """Speak a verified answer while it is generated.

        The lane is reserved before the provider is called; each chunk leaves
        only while the transcript so far is a prefix of the canonical text, and
        a divergence cuts the envelope at once. The answer stays in the chat.
        """
        while True:
            await self._wait_for_playback(request_id, turn_id, event_id, started)
            if self.speaking or generation != self.generation or self.closed:
                raise asyncio.CancelledError()
            if self.validate and not await asyncio.to_thread(self.validate):
                raise asyncio.CancelledError()
            if self.continuity and not await asyncio.to_thread(
                    self.continuity.is_current, self.lease):
                raise asyncio.CancelledError()
            if not await asyncio.to_thread(self.store.update, event_id, 'sending'):
                self.delivery_clocks.pop(event_id, None)
                self._trace('delivery_unavailable', request_id, turn_id, event_id, started)
                return None
            sending = time.monotonic()

            def playback_started():
                self._reserve_playback(event_id)
                self._trace('send_started', request_id, turn_id, event_id, started)

            async def first_audio_sent():
                delivery_clock['first_audio'] = time.monotonic()
                self._trace('first_audio_sent', request_id, turn_id, event_id, started,
                            sendWaitMs=_elapsed(sending))
                waited = _elapsed(started)
                if waited > narration_budget_ms():
                    logger.warning('Live latency alert phase=streamed_narration_first_audio '
                                   'elapsed_ms=%d budget_ms=%d', waited, narration_budget_ms())
                await asyncio.to_thread(self.store.mark_sent, event_id)

            async with self.sender.speech_stream(event_id, request_id,
                    valid=lambda: (not self.closed and not self.speaking
                                   and generation == self.generation),
                    can_start=lambda: not self.model_speaking and not self.client_playing,
                    on_start=playback_started, on_first_audio=first_audio_sent) as send:
                if send is None:
                    # Ordinary playback began first: this is not a new render.
                    self._update_idle()
                    continue
                await self._checkpoint(event_id, request_id, turn_id, 'sent')
                rendering = time.monotonic()
                self._trace('preparation_started', request_id, turn_id, event_id, started)
                result = await self.renderer(self.identity, text, on_audio=send)
                self._trace('preparation_completed', request_id, turn_id, event_id, started,
                    durationMs=_elapsed(rendering),
                    narrationMilestonesMs=_milestones(getattr(result, 'timings_ms', None)))
                usage = result.usages[-1] if result.usages else None
                await asyncio.to_thread(self.store.update, event_id, 'sending', usage=usage)
            if self.verified_event == event_id:
                # Re-arm with the real length: a lost acknowledgement holds the
                # lane at most for the audio actually sent plus the grace.
                self._reserve_playback(event_id, sum(len(frame) for frame in result.frames)
                                       / OUTPUT_BYTES_PER_SECOND)
            self._trace('send_completed', request_id, turn_id, event_id, started,
                        durationMs=_elapsed(sending))
            return usage

    async def _notice(self, _key, turn_id, text, generation):
        event_id, request_id = str(uuid4()), str(uuid4())
        started = time.monotonic()
        try:
            if self.validate and not await asyncio.to_thread(self.validate):
                return
            frames = _NOTICE_AUDIO.get(text)
            if frames is None:
                result = await self.renderer(self.identity, text)
                frames = _NOTICE_AUDIO[text] = tuple(result.frames)
                self._trace('notice_rendered', request_id, turn_id, event_id, started,
                            usage=result.usages[-1] if result.usages else None)
            seconds = sum(len(frame) for frame in frames) / OUTPUT_BYTES_PER_SECOND
            while True:
                await self._wait_for_playback(request_id, turn_id, event_id, started)
                if self.speaking or generation != self.generation or self.closed:
                    return
                self.notice_events.add(event_id)
                if await self.sender.speech(event_id, request_id, frames,
                        valid=lambda: (not self.closed and not self.speaking
                                       and generation == self.generation),
                        can_start=lambda: not self.model_speaking and not self.client_playing,
                        on_start=lambda: self._reserve_playback(event_id, seconds)):
                    self._trace('notice_sent', request_id, turn_id, event_id, started)
                    return
                self.notice_events.discard(event_id)
                self._update_idle()
        except asyncio.CancelledError:
            self._release_playback(event_id)
            raise
        except Exception as error:
            self.notice_events.discard(event_id)
            self._release_playback(event_id)
            logger.warning('Live spoken notice failed: %s', type(error).__name__)

    async def acknowledge(self, event_id, outcome):
        if event_id in self.notice_events:
            # A notice has no delivery ledger: its receipt only frees the lane.
            self.notice_events.discard(event_id)
            self._release_playback(event_id)
            return
        acknowledged = time.monotonic()
        receipt = await asyncio.to_thread(self.store.acknowledge, event_id, outcome)
        if receipt:
            timing = self.delivery_clocks.pop(event_id, {})
            started = timing.get('started', time.monotonic())
            first_audio = timing.get('first_audio')
            self._trace('playback_ack', receipt['requestId'], receipt['turnId'],
                event_id, started, outcome='played' if outcome == 'played' else 'interrupted',
                firstAudioToAckMs=round(max(0, acknowledged - first_audio) * 1000, 3)
                    if first_audio is not None else None,
                receiptDurationMs=_elapsed(acknowledged),
                localTimingAvailable=bool(timing))
            self._release_playback(event_id)
            await self._checkpoint(event_id, receipt['requestId'], receipt['turnId'],
                'acknowledged' if outcome == 'played' else 'interrupted')

    async def close(self):
        self.closed = True
        self._release_playback()
        self.pending.clear()
        if self.runner and not self.runner.done():
            self.runner.cancel()
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        if self.runner:
            try:
                await self.runner
            except asyncio.CancelledError:
                pass
        self.delivery_clocks.clear()
