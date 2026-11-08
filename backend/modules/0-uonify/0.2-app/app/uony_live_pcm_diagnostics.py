"""Bounded, content-free counters before and after Live audio suppression."""
import base64
import binascii
import json
from collections import OrderedDict
from uuid import UUID


class LivePcmDiagnostics:
    """Never retain PCM, transcriptions, provider payloads or credentials."""
    def __init__(self, logger):
        self.logger = logger
        self.turns = OrderedDict()
        self.segments = 0

    @staticmethod
    def _turn(session):
        candidate = session.active_voice_turn_id or session.assistant_reply_to
        try:
            return str(UUID(candidate))
        except (TypeError, ValueError, AttributeError):
            return 'unbound'

    def _row(self, session):
        turn = self._turn(session)
        if turn not in self.turns:
            if len(self.turns) >= 8:
                self._flush_one(next(iter(self.turns)), 'capacity')
            self.turns[turn] = {
                'parts': 0, 'encoded_chars': 0, 'decoded_bytes': 0,
                'invalid_blobs': 0, 'tiny_blobs': 0, 'nonzero_bytes': 0,
                'min_blob_bytes': None, 'max_blob_bytes': 0,
                'suppressed_parts': 0, 'suppressed_bytes': 0,
                'suppressed_stale_bytes': 0, 'suppressed_interrupted_bytes': 0,
                'emitted_frames': 0, 'emitted_bytes': 0,
                'transition_count': 0, 'transitions': [],
            }
        return self.turns[turn]

    def observe_content(self, content, session):
        turn = content.get('modelTurn')
        parts = turn.get('parts') if isinstance(turn, dict) else None
        if isinstance(parts, list):
            reason = ('interrupted' if content.get('interrupted') is True
                      else 'stale' if session.suppress_stale_audio else None)
            for part in parts:
                self.observe(part, session, reason)

    def observe(self, part, session, suppression_reason=None):
        if not isinstance(part, dict) or 'inlineData' not in part:
            return
        row = self._row(session)
        row['parts'] += 1
        blob = part['inlineData']
        encoded = blob.get('data') if isinstance(blob, dict) else None
        if not isinstance(encoded, str) or len(encoded) > 6 * 1024 * 1024:
            row['invalid_blobs'] += 1
            return
        row['encoded_chars'] += len(encoded)
        try:
            pcm = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            row['invalid_blobs'] += 1
            return
        size = len(pcm)
        row['decoded_bytes'] += size
        row['nonzero_bytes'] += size - pcm.count(0)
        row['tiny_blobs'] += int(size <= 2)
        row['min_blob_bytes'] = size if row['min_blob_bytes'] is None else min(row['min_blob_bytes'], size)
        row['max_blob_bytes'] = max(row['max_blob_bytes'], size)
        if suppression_reason is not None:
            row['suppressed_parts'] += 1
            row['suppressed_bytes'] += size
            row[f'suppressed_{suppression_reason}_bytes'] += size

    def emitted(self, pcm, session):
        row = self._row(session)
        row['emitted_frames'] += 1
        row['emitted_bytes'] += len(pcm)

    @staticmethod
    def snapshot(phase, session):
        if phase not in ('vad_start', 'vad_end', 'interrupted', 'turn_complete'):
            raise ValueError('invalid PCM diagnostic phase')
        epoch = session.output_epoch
        return {
            'phase': phase, 'suppressed': bool(session.suppress_stale_audio),
            'speaking': bool(session.speaking),
            'model_text_pending': bool(session.model_text),
            'assistant_text_pending': bool(session.pending_transcript['assistant']),
            'assistant_preview_pending': bool(session.preview_text['assistant']),
            'epoch_active': bool(epoch.generation_id),
            'voice_open': bool(epoch.voice_open), 'cut': bool(epoch.cut),
            'delimited': bool(epoch.delimited),
        }

    def transition(self, phase, session, snapshot=None):
        row = self._row(session)
        row['transition_count'] += 1
        item = snapshot if snapshot is not None else self.snapshot(phase, session)
        row['transitions'].append(item)
        if len(row['transitions']) > 16:
            row['transitions'].pop(0)

    def complete(self, session):
        self.transition('turn_complete', session)
        self._flush_one(self._turn(session), 'turn_complete')

    def close(self):
        for turn in tuple(self.turns):
            self._flush_one(turn, 'close')

    def _flush_one(self, turn, reason):
        row = self.turns.pop(turn)
        self.segments += 1
        self.logger.warning('Live PCM turn=%s segment=%d reason=%s counters=%s',
                            turn, self.segments, reason,
                            json.dumps(row, separators=(',', ':'), sort_keys=True))
