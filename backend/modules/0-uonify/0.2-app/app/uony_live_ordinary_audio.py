"""Cancelable output lane for ordinary Live audio, scoped to its source generation.

The router keeps reading VAD while this lane drains held audio. A cut invalidates
the generation, including bytes that arrive later; status messages never reopen it.
"""
import asyncio
from collections import deque
from contextlib import suppress
from uuid import uuid4


class OrdinaryAudioStream:
    def __init__(self, sender, speech):
        self.sender, self.speech = sender, speech
        self.pending = deque()
        self.wakeup = asyncio.Event()
        self.task = None
        self.active = None
        self.invalid = set()
        self.seen = set()
        self.completed = set()
        self.latest_turn = None
        self.input_turns = set()
        self.fallback_id = None
        self.closed = False
        self.cutting = False
        self.error = None
        self.failed = asyncio.Event()
        self.owns_lane = False
        self.playback_pending = set()

    def enqueue(self, frames, reply_to_turn_id=None):
        if self.closed:
            return
        ids = []
        for frame in frames:
            generation = getattr(frame, 'generation_id', None)
            reply = getattr(frame, 'reply_to_turn_id', None) or reply_to_turn_id
            if not generation:
                self.fallback_id = self.fallback_id or str(uuid4())
                generation = self.fallback_id
            if generation in self.invalid or (reply and self.latest_turn and
                                               reply != self.latest_turn):
                continue
            self.seen.add(generation)
            pcm = getattr(frame, 'pcm', frame)
            self.pending.append(('audio', generation, reply, pcm))
            if generation not in ids:
                ids.append(generation)
        for generation in ids:
            if generation in self.completed:
                self.pending.append(('end', generation, None, None))
        if ids:
            # Set before yielding, so a verified result cannot start during
            # the gap between admission and the ordinary output task.
            self.speech.model_status('speaking')
            self._wake()

    @property
    def busy(self):
        return bool(self.active or self.playback_pending or
                    any(item[0] == 'audio' for item in self.pending))

    def acknowledge(self, generation_id, outcome):
        if (outcome not in ('played', 'interrupted') or
                generation_id not in self.playback_pending):
            return
        self.playback_pending.remove(generation_id)
        self.invalid.add(generation_id)
        if not self.busy:
            self.speech.model_status('listening')

    def previous_turn(self, turn_id):
        return turn_id in self.input_turns and turn_id != self.latest_turn

    async def observe_turn(self, turn_id):
        if turn_id in self.input_turns:
            return False
        await self.cut(turn_id)
        return True

    def event(self, payload):
        self.pending.append(('event', None, None, payload))
        self._wake()

    def finish(self, generation_id=None):
        generation = generation_id or self.fallback_id
        if generation:
            self.completed.add(generation)
            self.pending.append(('end', generation, None, None))
            self._wake()
        self.fallback_id = None

    def _wake(self):
        self.wakeup.set()
        # A cut owns the output lane until it emits its own boundary; a new task
        # spawned mid-cut would race it and duplicate an end on the wire.
        if self.cutting:
            return
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run())

    async def _end(self):
        try:
            if self.active:
                generation, reply = self.active
                await self._boundary('end', generation, reply)
        finally:
            if self.owns_lane and self.active is None:
                self.owns_lane = False
                self.sender.audio_lane.release()

    async def _open(self, generation, reply):
        await self._boundary('start', generation, reply)

    async def _boundary(self, phase, generation, reply):
        payload = {'type': 'ordinary_audio', 'phase': phase,
                   'generationId': generation, 'replyToTurnId': reply}
        # Cancellation before the message lock is acquired emitted nothing.
        # After send begins, resolve its commit before reusing this PCM lane.
        async with self.sender.lock:
            if self.sender.guard:
                self.sender.guard()
            if phase == 'start':
                self.playback_pending.add(generation)
            sending = asyncio.create_task(self.sender.websocket.send_json(payload))
            try:
                await asyncio.shield(sending)
            except asyncio.CancelledError:
                try:
                    await asyncio.wait_for(asyncio.shield(sending), timeout=0.25)
                except BaseException as error:
                    sending.cancel()
                    self.error = RuntimeError('ordinary audio boundary uncertain')
                    raise self.error from error
                self._committed(phase, generation, reply)
                raise
            self._committed(phase, generation, reply)

    def _committed(self, phase, generation, reply):
        self.active = (generation, reply) if phase == 'start' else None
        if phase == 'end':
            self.invalid.add(generation)

    async def _take_lane(self):
        while True:
            wait_verified = getattr(self.speech, 'wait_verified_playback', None)
            if wait_verified:
                await wait_verified()
            lane = getattr(self.sender, 'audio_lane', None)
            if lane is None:
                return
            await lane.acquire()
            # A verified result may have reserved playback while this task
            # was waiting for its wire envelope to finish. VAD can still
            # cancel this task; neither wait blocks the provider consumer.
            if getattr(self.speech, 'verified_playback_pending', False):
                lane.release()
                continue
            self.owns_lane = True
            return

    async def _run(self):
        try:
            while not self.closed:
                await self.wakeup.wait()
                while self.pending:
                    kind, generation, reply, value = self.pending.popleft()
                    if kind == 'event':
                        await self.sender.event(value)
                    elif kind == 'end':
                        if self.active and self.active[0] == generation:
                            await self._end()
                            if not self.busy:
                                self.speech.model_status('listening')
                    elif generation not in self.invalid:
                        if not self.active or self.active[0] != generation:
                            await self._end()
                            await self._take_lane()
                            if generation in self.invalid:
                                await self._end()
                                continue
                            self.speech.model_status('speaking')
                            await self._open(generation, reply)
                        # Re-check after the envelope's potentially blocked send.
                        if generation not in self.invalid:
                            await self.sender.audio(value)
                self.wakeup.clear()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.error = error
            self.failed.set()

    async def cut(self, turn_id=None):
        # Hold off any concurrent enqueue/finish/event: cancelling the running
        # task and awaiting it yields the loop, and a second task created in that
        # gap would open or end an envelope while this cut emits its own end.
        self.cutting = True
        try:
            self.invalid.update(self.seen)
            if turn_id and not self.previous_turn(turn_id):
                self.latest_turn = turn_id
                self.input_turns.add(turn_id)
            self.pending.clear()
            self.fallback_id = None
            task, self.task = self.task, None
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            if self.error:
                # If start may have reached the wire, terminate this voice socket
                # rather than allow another envelope on an indeterminate stream.
                if self.owns_lane:
                    self.owns_lane = False
                    self.sender.audio_lane.release()
                self.check()
            await self._end()
            self.playback_pending.clear()
            self.speech.model_status('listening')
        finally:
            self.cutting = False
        # Frames admitted during the cut (after the queue was cleared) still
        # belong to the live turn; drain them with a single fresh task so one
        # envelope opens and closes cleanly after this cut's boundary.
        if self.pending and not self.closed:
            self._wake()

    async def close(self):
        self.closed = True
        await self.cut()

    def check(self):
        if self.error:
            raise self.error

    async def wait_failure(self):
        await self.failed.wait()
        self.check()
