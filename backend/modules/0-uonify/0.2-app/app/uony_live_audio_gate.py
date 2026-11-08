"""Hold provisional Live audio for a possible Drive access or folder-count turn.

The preview only controls playback. It never authorizes a tool or a Drive read.
"""
import re
import time
import unicodedata

from .uony_live_bridge import LiveTranscriptPreview, _save_transcript


MAX_HELD_PCM_BYTES = 1_440_000  # Thirty seconds of 24 kHz mono PCM16.
MAX_HOLD_SECONDS = 45


def _drive_preview(text):
    plain = ''.join(char for char in unicodedata.normalize('NFD', text.casefold())
                    if unicodedata.category(char) != 'Mn')
    # An early Drive mention or an elliptical folder count is enough to pause
    # playback, but only the final server-validated turn can start a request.
    return bool(re.search(r'\bdrive\b|\bcarpetas\b', plain))


class LiveActionAudioGate:
    def __init__(self, *, hold_until_final=False):
        self.hold_until_final = hold_until_final
        self.turn_id = None
        self.pending = False
        self.suppressed = False
        self.audio_limited = False
        self.admission_finalized = False
        self.limit_notice_sent = False
        self.held = []
        self.held_bytes = 0
        self.assistant_preview = None
        self.assistant_final = None
        self.armed_at = 0.0
        self.held_since = None
        self.first_pcm_seen = False
        self.armed_before_first_pcm = 0
        self.armed_after_first_pcm = 0
        self.dropped_over_limit = 0

    def start(self, turn_id):
        if turn_id is not None and turn_id == self.turn_id:
            # Vertex can send transcription before its VAD start notice.
            return
        self.turn_id = turn_id
        self.pending = self.hold_until_final and turn_id is not None
        self.suppressed = False
        self.audio_limited = False
        self.admission_finalized = False
        self.limit_notice_sent = False
        self.held.clear()
        self.held_bytes = 0
        self.assistant_preview = None
        self.assistant_final = None
        self.armed_at = time.monotonic() if self.pending else 0.0
        self.held_since = None
        self.first_pcm_seen = False
        if self.pending:
            self.armed_before_first_pcm += 1

    def preview(self, turn_id, text):
        if turn_id != self.turn_id:
            self.start(turn_id)
        if self.admission_finalized:
            return
        if not self.audio_blocked and _drive_preview(text):
            self.pending = True
            self.armed_at = time.monotonic()
            if self.first_pcm_seen:
                self.armed_after_first_pcm += 1
            else:
                self.armed_before_first_pcm += 1

    def capture(self, pcm):
        self.first_pcm_seen = True
        if self.suppressed or self.audio_limited:
            return ()
        if not self.pending:
            return (pcm,)
        # Bound the time audio is retained, not how long the customer speaks.
        # No provider audio exists yet during a long spoken instruction.
        if self.held_since is None:
            self.held_since = time.monotonic()
        size = len(getattr(pcm, 'pcm', pcm))
        if (self.held_bytes + size > MAX_HELD_PCM_BYTES or
                time.monotonic() - self.held_since > MAX_HOLD_SECONDS):
            self._limit_audio()
            return ()
        self.held.append(pcm)
        self.held_bytes += size
        return ()

    @property
    def audio_blocked(self):
        return self.pending or self.suppressed or self.audio_limited

    def _limit_audio(self):
        self.held.clear()
        self.held_bytes = 0
        if not self.audio_limited:
            self.dropped_over_limit += 1
        self.audio_limited = True
        self.pending = False

    def discard_invalid_audio(self, generation_ids):
        self.held = [frame for frame in self.held
                     if getattr(frame, 'generation_id', None) not in generation_ids]
        self.held_bytes = sum(len(getattr(frame, 'pcm', frame)) for frame in self.held)
        if not self.held:
            self.held_since = None

    @property
    def held_generations(self):
        return {frame.generation_id for frame in self.held
                if getattr(frame, 'generation_id', None)}

    def blocks_assistant(self, reply_to_turn_id):
        return ((self.pending or self.suppressed or
                 self.audio_limited and not self.admission_finalized) and
                (reply_to_turn_id is None or reply_to_turn_id == self.turn_id))

    def defer_assistant(self, event):
        # A model may complete before its input caption. Keep only the latest
        # preview and one final turn, each already bounded by the route.
        if isinstance(event, LiveTranscriptPreview):
            self.assistant_preview = event
        else:
            self.assistant_final = event

    def finalize(self, turn_id, *, suppress):
        if turn_id != self.turn_id or self.admission_finalized or not self.audio_blocked:
            return (), ()
        # A final may arrive after the last PCM frame. Never release a buffer
        # that has already expired merely because no later frame checked it.
        if self.held_since is not None and time.monotonic() - self.held_since > MAX_HOLD_SECONDS:
            self._limit_audio()
        frames = () if suppress or self.suppressed or self.audio_limited else tuple(self.held)
        replies = () if suppress else tuple(item for item in
            (self.assistant_preview, self.assistant_final) if item is not None)
        self.held.clear()
        self.held_bytes = 0
        self.assistant_preview = None
        self.assistant_final = None
        self.pending = False
        self.suppressed = suppress
        self.admission_finalized = True
        return frames, replies

    def take_voice_notice(self, turn_id):
        if (turn_id != self.turn_id or not self.audio_limited or
                not self.admission_finalized or self.suppressed or self.limit_notice_sent):
            return None
        self.limit_notice_sent = True
        return {'type': 'voice_notice', 'turnId': turn_id,
                'reason': 'response_audio_limit'}


async def flush_ordinary_reply(frames, replies, database, identity, session_id, sender,
                               audio_stream=None, reply_to_turn_id=None):
    """Restore a false-positive gate after the final turn proves non-action."""
    for event in replies:
        if isinstance(event, LiveTranscriptPreview):
            await sender.event({'type': 'transcript_preview', 'role': 'assistant',
                'turnId': event.turn_id, 'text': event.text,
                **({'replyToTurnId': event.reply_to_turn_id}
                   if event.reply_to_turn_id else {})})
    if frames:
        if audio_stream:
            audio_stream.event({'type': 'status', 'state': 'speaking'})
            audio_stream.enqueue(frames, reply_to_turn_id)
        else:
            await sender.event({'type': 'status', 'state': 'speaking'})
            for frame in frames:
                await sender.audio(getattr(frame, 'pcm', frame))
    for event in replies:
        if not isinstance(event, LiveTranscriptPreview):
            if sender.guard:
                sender.guard()
            inserted = _save_transcript(database, identity, session_id, event)
            if inserted:
                payload = {'type': 'transcript', 'role': 'assistant',
                    'turnId': event.turn_id, 'text': event.text.strip(), 'final': True,
                    **({'replyToTurnId': event.reply_to_turn_id}
                       if event.reply_to_turn_id else {})}
                if audio_stream and frames:
                    audio_stream.event(payload)
                else:
                    await sender.event(payload)
