"""Uony's reply as it is written (F1-S, lote 8).

«Consultor google», revisiones/20261022-VEREDICTO-LOTE8-1B-F1S.md, and the
owner's mockup «A · Va apareciendo» (22-10-2026): the text starts within 1-2 s
and grows while Uony writes; if the call fails half way, the half text goes
and capa 2's notice comes, never a visible restart.

LiveText is the agent's side: it reads the text of a streamed attempt and
decides what to show. ProvisionalText is the job's side: the provisional text
of AI-17 (provisional_text, read by the browser while the job runs).

- Only text that will stay: nothing while a card, form, proposal, order or
  plan this turn prepared replaces the model's words (`allowed`), and a text
  that promises a form the server would repair is taken back.
- A function call clears what is shown. In a call that may still call a
  tool, the text waits for 60 characters or 600 ms, so a sentence a tool
  then erases does not flash; the last call (text only) shows at once.
- One write each 300 ms and 40 more characters at most; past 16 000
  characters nothing more is written, and that is not a failure.
"""
import time

from .uony_form_guard import requests_missing_form
from .uony_stream_transport import MAX_VISIBLE_CHARS
from .uony_voice_truth import mentions_voice_feature

HOLD_CHARS = 60
HOLD_SECONDS = 0.6
STEP_CHARS = 40
STEP_SECONDS = 0.3


def text_only(request):
    """The call may only write (the last call's NONE, lote 7)."""
    config = getattr(getattr(request.config, 'tool_config', None), 'function_calling_config', None)
    mode = getattr(config, 'mode', None)
    return getattr(mode, 'value', mode) == 'NONE'


class LiveText:
    def __init__(self, on_text, on_clear, allowed):
        self.on_text, self.on_clear, self.allowed = on_text, on_clear, allowed
        self.visible = self.stopped = self.held = False
        self.text, self.shown = '', ''
        self.first_at = self.written_at = None
        self.writes = 0

    def start(self, request):
        """A new attempt: nothing of an earlier one stays on screen."""
        if self.visible:
            self.on_clear()
        self.visible = self.stopped = False
        self.held = not text_only(request)
        self.text, self.shown = '', ''
        self.first_at = self.written_at = None
        self.writes = 0

    def feed(self, response):
        """One streamed chunk (an ADK partial response)."""
        if self.stopped:
            return
        for part in (response.content.parts if response.content else None) or []:
            if part.function_call:
                self.stop()
                return
            if isinstance(part.text, str) and not part.thought:
                self.text += part.text
        self._write()

    def _write(self):
        if not self.text.strip():
            return
        now = time.monotonic()
        self.first_at = self.first_at or now
        if len(self.text) > MAX_VISIBLE_CHARS:  # H: no more writes, not a failure.
            self.stopped = True
            return
        if requests_missing_form(self.text):  # The server would put a form in its place.
            self.stop()
            return
        if not self.shown:
            if self.held and len(self.text) < HOLD_CHARS and now - self.first_at < HOLD_SECONDS:
                return
        elif len(self.text) - len(self.shown) < STEP_CHARS or now - self.written_at < STEP_SECONDS:
            return
        self.on_text(self.text)
        self.shown, self.written_at, self.visible = self.text, now, True
        self.writes += 1

    def stop(self):
        """Nothing more this attempt, and what it showed goes."""
        self.stopped = True
        if self.visible:
            self.on_clear()
            self.visible = False

    def drop(self):
        """The attempt failed: True when it had text on screen, now cleared
        (D: such an attempt is never sent again)."""
        shown = self.visible
        self.stop()
        return shown


class ProvisionalText:
    """The job's side, for both engines. A reply that names a voice feature is
    checked against server facts before it is saved, so it is never shown
    unchecked: cleared, and held until the next clear."""

    def __init__(self, queue, job):
        self.queue, self.job, self.blocked = queue, job, False

    def text(self, prefix):
        if self.blocked or len(prefix) > MAX_VISIBLE_CHARS:  # Never LeaseLost by length (H).
            return
        if mentions_voice_feature(prefix):
            self.blocked = True
            self.queue.stream_clear(self.job)
        else:
            self.queue.stream_partial(self.job, prefix)

    def clear(self):
        self.blocked = False
        self.queue.stream_clear(self.job)
