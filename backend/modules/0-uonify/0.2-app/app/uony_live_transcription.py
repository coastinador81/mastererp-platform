"""Assemble provisional Live speech text without treating it as an action."""
from datetime import datetime, timezone
from uuid import uuid4

from .uony_live_bridge import (LiveSpeechEnded, LiveTranscript,
                               LiveTranscriptPreview, LiveUnconfirmedTurn)
from .uony_drive_instruction import parse_drive_instruction


QUIET_FRAMES_FOR_NEW_ONSET = 7  # 224 ms at the browser's 32 ms PCM frame size.


class LiveTranscriptionState:
    def __init__(self):
        self.pending_transcript = {'user': '', 'assistant': ''}
        self.pending_unspecified = {'user': False, 'assistant': False}
        self.pending_turn_id = {'user': None, 'assistant': None}
        self.turn_started_at = {'user': None, 'assistant': None}
        self.preview_text = {'user': '', 'assistant': ''}
        self.user_voice_closed = False
        self.active_voice_turn_id = None
        self.user_final_in_active_voice = False
        self.user_finished_before_end = False
        self.user_finished_after_end = 0
        self.user_explicitly_unfinished = False
        self.unconfirmed_user_turn_id = None
        self.completed_user_turn_id = None
        self.last_replied_user_turn_id = None
        self.inferred_user_turn_id = None
        self.input_voice_evidence = False
        self.loud_audio_frames = 0
        self.inferred_quiet_frames = 0
        self.inferred_new_onset_armed = False
        self.reply_started = False
        self.assistant_reply_to = None
        # Without provider offsets, text arriving after a second VAD start
        # cannot be assigned safely to either overlapping utterance.
        self.ambiguous_user_input = False
        self.ambiguous_finishes_remaining = 0
        self.ambiguous_input_drops = 0
        self.caption_recovered_turn_id = None
        self.model_text = ''
        self.assistant_transcribed_in_turn = False
        self.assistant_provider_finished = False
        self.suppress_late_output_transcription = False
        self.input_after_turn_complete = False
        self.transcription_counts = {'interimInputTranscription': 0,
                                     'previews_emitted': 0, 'finals_emitted': 0}
        self.input_finalization_counts = {'provider_finished': 0,
                                          'reply_boundary': 0,
                                          'model_turn_complete': 0,
                                          'read_only_boundary': 0,
                                          'primary_vad_closed': 0,
                                          'provider_after_reply': 0}
        self.input_marker_counts = {'pre_end': 0, 'post_end': 0,
                                    'no_vad': 0, 'unfinished': 0, 'unspecified': 0}

    def _turn_id(self, role):
        if self.pending_turn_id[role] is None:
            self.pending_turn_id[role] = str(uuid4())
            self.turn_started_at[role] = datetime.now(timezone.utc)
        return self.pending_turn_id[role]

    def _voice_start(self):
        self.user_voice_closed = False
        self.reply_started = False
        self.user_final_in_active_voice = False
        self.user_finished_before_end = False
        self.user_finished_after_end = 0
        self.user_explicitly_unfinished = False
        self.inferred_user_turn_id = None
        self.inferred_quiet_frames = 0
        self.inferred_new_onset_armed = False
        self.active_voice_turn_id = self._turn_id('user')
        return self.active_voice_turn_id

    def _voice_end(self):
        self.user_voice_closed = True
        return self.active_voice_turn_id or self._turn_id('user')

    def _turn_complete_precedes_current_input(self):
        """Identify a completion that still belongs to interrupted old output.

        Gemini can deliver that completion after the next VAD start, including
        after the new VAD end but before its transcription. It must not erase
        the new turn. Once the new text exists, or its reply is explicitly
        linked, the boundary can close the current input normally.
        """
        output = getattr(self, 'output_epoch', None)
        if (output is not None and output.cut
                and output.reply_to != self.active_voice_turn_id):
            # A cut response can complete after the next user's VAD end and
            # first transcription fragment. That old completion cannot certify
            # the new request before a delayed qualifier such as "not yet".
            return True
        turn_id = self.pending_turn_id['user']
        return bool(turn_id and turn_id == self.active_voice_turn_id
                    and not self.user_final_in_active_voice
                    and self.assistant_reply_to != turn_id
                    and not self.pending_transcript['user'])

    def _reply_begins(self):
        """Consolidate available input before the first assistant text or audio.

        A VAD end alone is not a transcript boundary: the provider may still
        revise its text. Explicitly unfinished fragments stay provisional.
        """
        if self.reply_started:
            return None
        self.reply_started = True
        known_turn = self.active_voice_turn_id or self.pending_turn_id['user']
        if (known_turn == self.inferred_user_turn_id
                and self.input_after_turn_complete):
            # Another model response began before the inferred turn received
            # its final. A future unlabelled transcription is not attributable.
            self._mark_ambiguous_input()
            self.assistant_reply_to = None
            self.input_voice_evidence = False
            return None
        if (not known_turn and self.completed_user_turn_id
                and not self.input_after_turn_complete):
            known_turn = self.completed_user_turn_id
        if not known_turn and self.input_voice_evidence and not self.ambiguous_user_input:
            # No provider VAD/interim arrived, but local PCM contained speech-
            # like activity before the model answered. Reserve ordering only;
            # never invent words or make this a tool/action authorization.
            known_turn = self._turn_id('user')
            self.inferred_user_turn_id = known_turn
            self.user_voice_closed = True
            self.assistant_reply_to = known_turn
            self.last_replied_user_turn_id = known_turn
            self.input_voice_evidence = False
            self.loud_audio_frames = 0
            self.inferred_quiet_frames = 0
            self.inferred_new_onset_armed = False
            return LiveSpeechEnded(known_turn)
        self.assistant_reply_to = known_turn
        if known_turn:
            self.last_replied_user_turn_id = known_turn
        self.input_voice_evidence = False
        self.loud_audio_frames = 0
        # A provider `finished` may close only one transcription segment.
        # Preserve all user segments until the model turn boundary; no reply
        # onset can authorize or persist a partial spoken instruction.
        return None

    def _note_audio_input(self, pcm):
        """Detect only a sustained local acoustic burst; no text or PCM is kept."""
        positive = negative = 0
        for i in range(0, len(pcm) - 1, 16):
            sample = int.from_bytes(pcm[i:i + 2], 'little', signed=True)
            positive += sample >= 600
            negative += sample <= -600
        # Both signs reject silence and a microphone's constant DC offset.
        voiced = positive >= 2 and negative >= 2
        if (self.inferred_user_turn_id
                and self.pending_turn_id['user'] == self.inferred_user_turn_id):
            if not voiced:
                self.inferred_quiet_frames += 1
                if self.inferred_quiet_frames >= QUIET_FRAMES_FOR_NEW_ONSET:
                    self.inferred_new_onset_armed = True
                self.loud_audio_frames = 0
            elif self.inferred_new_onset_armed:
                self.loud_audio_frames += 1
                if self.loud_audio_frames >= 2:
                    # Only a new onset after clear silence is ambiguous.
                    self._mark_ambiguous_input()
            else:
                # Continuous sound after the reply boundary may still be the
                # original utterance; never call it a second turn by itself.
                self.inferred_quiet_frames = 0
            return
        self.loud_audio_frames = self.loud_audio_frames + 1 if voiced else 0
        if self.loud_audio_frames < 2:
            return
        self.input_voice_evidence = True

    def _mark_ambiguous_input(self):
        if not self.ambiguous_user_input:
            self.ambiguous_user_input = True
            self.ambiguous_finishes_remaining = 2

    def mark_caption_recovered(self, turn_id):
        """Mark one closed primary placeholder after safe sidecar recovery.

        The caption wrapper has already proved that exactly one explicit VAD
        turn owns the text. The state stays intact until the next VAD so a late
        primary final keeps the old turn ID and can be deduplicated safely.
        """
        if (not isinstance(turn_id, str) or not self.user_voice_closed
                or self.pending_turn_id['user'] != turn_id
                or self.active_voice_turn_id != turn_id
                or self.ambiguous_user_input):
            return False
        self.caption_recovered_turn_id = turn_id
        self.user_final_in_active_voice = True
        self.completed_user_turn_id = turn_id
        self.input_after_turn_complete = False
        return True

    def _retire_caption_recovered_before_voice_start(self):
        """Drop only the known recovered placeholder before the next VAD."""
        turn_id = self.caption_recovered_turn_id
        if turn_id is None:
            return False
        if self.pending_turn_id['user'] == turn_id:
            self._drop_transcription('user')
        if self.active_voice_turn_id == turn_id:
            self.active_voice_turn_id = None
        self.caption_recovered_turn_id = None
        self.user_voice_closed = False
        self.input_after_turn_complete = False
        self.user_final_in_active_voice = False
        self.user_finished_before_end = False
        self.user_finished_after_end = 0
        self.user_explicitly_unfinished = False
        return True

    def _preview(self, role, text):
        if text == self.preview_text[role]:
            return None
        self.preview_text[role] = text
        self.transcription_counts['previews_emitted'] += 1
        return LiveTranscriptPreview(role, self._turn_id(role), text,
                                     self.assistant_reply_to if role == 'assistant' else None)

    def _drop_transcription(self, role):
        self.pending_transcript[role] = ''
        self.pending_unspecified[role] = False
        self.pending_turn_id[role] = None
        self.turn_started_at[role] = None
        self.preview_text[role] = ''
        if role == 'user':
            self.user_finished_before_end = False
            self.user_finished_after_end = 0
            self.user_explicitly_unfinished = False
        else:
            self.assistant_provider_finished = False

    def _withdraw_preview(self, role):
        preview = self._preview(role, '') if self.preview_text[role] else None
        self._drop_transcription(role)
        return preview

    def _final(self, role, text, finalized_by=''):
        turn_id = self._turn_id(role)
        event = LiveTranscript(role, turn_id, text, self.turn_started_at[role],
                               self.assistant_reply_to if role == 'assistant' else None,
                               finalized_by=finalized_by)
        if role == 'user':
            if finalized_by in self.input_finalization_counts:
                self.input_finalization_counts[finalized_by] += 1
            if finalized_by == 'provider_finished' and self.reply_started:
                self.input_finalization_counts['provider_after_reply'] += 1
            self.user_final_in_active_voice = True
            if not self.reply_started and turn_id != self.last_replied_user_turn_id:
                self.completed_user_turn_id = turn_id
            if turn_id == self.inferred_user_turn_id:
                self.inferred_user_turn_id = None
                self.inferred_quiet_frames = 0
                self.inferred_new_onset_armed = False
        self.transcription_counts['finals_emitted'] += 1
        self._drop_transcription(role)
        return event

    @staticmethod
    def _validate_item(item):
        if not isinstance(item, dict) or (item.get('text') is not None
                                          and not isinstance(item['text'], str)):
            raise ValueError('invalid Live transcription')
        text = (item.get('text') or '').strip()
        if len(text) > 3000:
            raise ValueError('Live transcription limit')
        if 'finished' in item and type(item['finished']) is not bool:
            raise ValueError('invalid Live transcription marker')
        return text

    def _interim_input(self, item):
        if item is None:
            return None
        if self.ambiguous_user_input:
            self._validate_item(item)
            self.ambiguous_input_drops += 1
            return None
        if isinstance(item, dict) and item.get('text') is None:
            return None
        text = self._validate_item(item)
        self.transcription_counts['interimInputTranscription'] += 1
        # Interim text is updated while the customer speaks. It may be revised
        # by recognition, so it must not enter the persisted final accumulator.
        return self._preview('user', text) if text else None

    def _transcription(self, role, item):
        if item is None:
            return ()
        text = self._validate_item(item)
        old = self.pending_transcript[role]
        if text:
            old_words, new_words = old.split(), text.split()
            shared_words = 0
            for previous, current in zip(old_words, new_words):
                if previous != current:
                    break
                shared_words += 1
            # Google can revise an earlier complete phrase. A shared
            # two-word prefix is evidence of replacement; otherwise chunks
            # are conservatively concatenated as separate segments.
            replacement = text.startswith(old) or shared_words >= 2
            text = text if replacement else (old + ' ' + text).strip()
            if len(text) > 3000:
                raise ValueError('Live transcription limit')
            self.pending_transcript[role] = text
        else:
            text = old
        self.pending_unspecified[role] = 'finished' not in item and bool(text)
        preview = self._preview(role, text) if text else None
        events = [preview] if preview else []
        if role == 'user':
            if item.get('finished') is False:
                self.user_explicitly_unfinished = True
                self.input_marker_counts['unfinished'] += 1
            elif item.get('finished') is True and text:
                self.user_explicitly_unfinished = False
                if self.user_voice_closed and self.active_voice_turn_id == self.pending_turn_id['user']:
                    self.user_finished_after_end += 1
                    self.input_marker_counts['post_end'] += 1
                else:
                    self.user_finished_before_end = True
                    self.input_marker_counts[
                        'pre_end' if (self.active_voice_turn_id ==
                            self.pending_turn_id['user']) else 'no_vad'] += 1
            elif text and 'finished' not in item:
                self.input_marker_counts['unspecified'] += 1
        elif text:
            # Output text is only provisional until the model turn completes;
            # an interruption can still discard it after `finished: true`.
            self.assistant_provider_finished = item.get('finished') is True
        return tuple(events)

    def _complete_user_turn(self):
        """Close one utterance only after all observable speech boundaries.

        A pre-END `finished` is a segment marker, not consent. Multiple
        post-END finals or an explicitly unfinished tail remain UI-only.
        """
        text = self.pending_transcript['user'].strip()
        if not text:
            return None
        if self.user_explicitly_unfinished:
            turn_id = self._turn_id('user')
            if self.unconfirmed_user_turn_id == turn_id:
                return None
            self.unconfirmed_user_turn_id = turn_id
            return LiveUnconfirmedTurn(turn_id, text)
        trusted = (self.user_voice_closed and self.active_voice_turn_id == self.pending_turn_id['user']
                   and not self.user_finished_before_end and self.user_finished_after_end == 1
                   and not self.pending_unspecified['user'] and not self.ambiguous_user_input)
        # A complete, VAD-bounded metadata question may still be verified if
        # the provider omits its optional `finished` marker. A contextual
        # folder count is only routed after the server verifies Drive context
        # in this exact thread; search and analysis never use this boundary.
        directive = parse_drive_instruction(text, drive_context=True)
        bounded = (self.user_voice_closed and self.active_voice_turn_id == self.pending_turn_id['user']
                   and not self.ambiguous_user_input and directive is not None
                   and directive.action in ('access', 'count_folders'))
        # A primary transcript with an explicit closed VAD and the model's
        # completion boundary is usable for semantic metadata interpretation
        # even when Google omits its optional `finished` marker. Its words do
        # not decide provenance: action-specific admission is a later step.
        # Inferred, ambiguous and segmented inputs cannot gain this source.
        primary_closed = (self.user_voice_closed
            and self.active_voice_turn_id == self.pending_turn_id['user']
            and self.active_voice_turn_id != self.inferred_user_turn_id
            and not self.ambiguous_user_input and not self.user_finished_before_end
            and self.user_finished_after_end == 0)
        return self._final('user', text,
                           'provider_finished' if trusted else
                           'read_only_boundary' if bounded else
                           'primary_vad_closed' if primary_closed else 'model_turn_complete')

    def _user_transcription(self, item):
        if self.ambiguous_user_input and item is not None:
            self._validate_item(item)
            self.ambiguous_input_drops += 1
            if item.get('finished') is True:
                self.ambiguous_finishes_remaining -= 1
                if self.ambiguous_finishes_remaining <= 0:
                    self.ambiguous_user_input = False
                    turn_id = self.pending_turn_id['user']
                    self._drop_transcription('user')
                    return ((LiveTranscriptPreview('user', turn_id, ''),)
                            if turn_id else ())
            return ()
        updates = self._transcription('user', item)
        if (isinstance(item, dict) and item.get('finished') is True
                and self.input_after_turn_complete and self.pending_transcript['user']):
            # A final that trails model completion remains visible, but is too
            # late to certify the complete current voice turn for an action.
            updates += (self._final('user', self.pending_transcript['user'].strip(),
                                    'model_turn_complete'),)
        # A transcription can trail model turnComplete and still be revised.
        # Never persist an unspecified late fragment as a final merely
        # because that earlier boundary has already passed.
        if any(isinstance(event, LiveTranscript) for event in updates):
            self.input_after_turn_complete = False
        return updates

    def _flush_unspecified(self, role, source=''):
        if not self.pending_unspecified[role]:
            return None
        text = self.pending_transcript[role].strip()
        return self._final(role, text, source) if text else None

    def _model_text(self, text):
        if not isinstance(text, str) or len(text) > 3000:
            raise ValueError('invalid Live model text')
        text = text.strip()
        if text:
            old = self.model_text
            self.model_text = text if text.startswith(old) else (old + ' ' + text).strip()
            if len(self.model_text) > 3000:
                raise ValueError('Live model text limit')

    def _assistant_transcription(self, item):
        if self.suppress_late_output_transcription and item is not None:
            return ()
        return self._transcription('assistant', item)

    def _complete_assistant_turn(self):
        text = self.pending_transcript['assistant'].strip()
        if text and (self.assistant_provider_finished or
                     self.pending_unspecified['assistant']):
            event = self._final('assistant', text,
                'provider_finished' if self.assistant_provider_finished else 'model_turn_complete')
            self.model_text = ''
            self.assistant_transcribed_in_turn = False
            self.suppress_late_output_transcription = True
            return event
        return self._complete_model_turn()

    def _complete_model_turn(self):
        text = self.model_text.strip()
        self.model_text = ''
        if self.assistant_transcribed_in_turn or not text:
            self.assistant_transcribed_in_turn = False
            return None
        self.assistant_transcribed_in_turn = False
        self.suppress_late_output_transcription = True
        return self._final('assistant', text)
