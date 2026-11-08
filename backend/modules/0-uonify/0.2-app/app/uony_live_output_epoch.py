"""Keep a provider output ID until both its delimiter and the next input end."""
from uuid import uuid4


class LiveOutputEpoch:
    def __init__(self):
        self.generation_id = self.reply_to = None
        self.voice_open = self.cut = self.delimited = False

    def ensure(self, reply_to):
        if self.generation_id is None:
            self.generation_id, self.reply_to = str(uuid4()), reply_to
            self.cut = self.delimited = False
        return self.generation_id

    def voice_start(self, pending_reply=False, reply_to=None):
        self.voice_open = True
        # Text/tool output can precede the first PCM. Its later completion is
        # still an old response and cannot finalize the new spoken request.
        self.cut = bool(self.generation_id or pending_reply)
        if self.generation_id is None and pending_reply:
            self.reply_to = reply_to

    def voice_end(self, turn_id):
        self.voice_open = False
        return self._advance(turn_id)

    def delimiter(self, turn_id):
        self.cut = self.cut or bool(self.generation_id)
        self.delimited = True
        return self._advance(turn_id)

    def _advance(self, turn_id):
        if (self.delimited and not self.voice_open and turn_id
                and (self.generation_id is None or turn_id != self.reply_to)):
            self.reset()
            return True
        return False

    def complete(self):
        self.delimited = True
        if not self.voice_open:
            self.reset()

    def reset(self):
        self.generation_id = self.reply_to = None
        self.cut = self.delimited = False
