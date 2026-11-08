"""Original Gemini Live server messages → Uonify Live events.

The raw Vertex transport and the ADK candidate feed the same decoded provider
messages here, before any SDK normalization, so primary transcript finality,
VAD boundaries and turn provenance stay identical on both routes
(ADK-FLUJOS §2 «Adaptación requerida» and §10.2).
"""
import base64
import binascii
import logging

from .uony_live_bridge import (MAX_FRAME_BYTES, MAX_OUTPUT_BYTES, LiveAudio,
                               LiveInterrupted, LiveSpeechStarted, LiveSpeechEnded,
                               LiveStatus, LiveToolCall, LiveUsage)
from .uony_live_output_epoch import LiveOutputEpoch
from .uony_live_pcm_diagnostics import LivePcmDiagnostics
from .uony_live_signal_timing import LiveSignalTiming
from .uony_live_transcription import LiveTranscriptionState
from .uony_live_usage import usage_counts

OUTPUT_MIME = 'audio/pcm;rate=24000'
MAX_UPSTREAM_MESSAGE = 4 * 1024 * 1024
logger = logging.getLogger('app.uony_live_vertex')


class LiveServerMessages(LiveTranscriptionState):
    """Turn, transcript and audio state driven by original provider messages."""

    def __init__(self):
        super().__init__()
        self.speaking = False
        self.output_bytes = 0
        self.suppress_stale_audio = False
        self.output_epoch = LiveOutputEpoch()
        self.signal_counts = dict.fromkeys(('interrupted', 'voiceActivity',
                                            'voiceActivityDetectionSignal', 'speechState'), 0)
        self.signals_reported = False
        self.timing = LiveSignalTiming()
        self.pcm_diagnostics = LivePcmDiagnostics(logger)

    def report_signals(self):
        """Once per session: provider signal and transcript-finality diagnostics."""
        if self.signals_reported:
            return
        self.signals_reported = True
        logger.warning('Live signals interrupted=%d voiceActivity=%d vad=%d speechState=%d interim=%d previews=%d finals=%d',
                       *self.signal_counts.values(), *self.transcription_counts.values())
        vad_ends, offsets = self.timing.summary()
        logger.warning('Live transcript timing vad_ends=%d input_audio_complete_ms=%s',
                       vad_ends, offsets)
        counts = self.input_finalization_counts
        logger.warning('Live input finals provider=%d reply_boundary=%d model_complete=%d provider_after_reply=%d primary_vad_closed=%d',
                       counts['provider_finished'], counts['reply_boundary'],
                       counts['model_turn_complete'], counts['provider_after_reply'], counts['primary_vad_closed'])
        markers = self.input_marker_counts
        logger.warning('Live input markers pre_end=%d post_end=%d no_vad=%d '
            'unfinished=%d unspecified=%d read_only_boundary=%d',
            markers['pre_end'], markers['post_end'], markers['no_vad'],
            markers['unfinished'], markers['unspecified'],
            counts['read_only_boundary'])
        if self.ambiguous_input_drops:
            logger.warning('Live ambiguous input dropped=%d', self.ambiguous_input_drops)

    def translate(self, data):
        """Yield the Uonify events carried by one decoded provider message."""
        content_signals = data.get('serverContent')
        for signal in ('voiceActivity', 'voiceActivityDetectionSignal', 'speechState'):
            if signal in data or (isinstance(content_signals, dict) and signal in content_signals):
                self.signal_counts[signal] += 1
        if 'voiceActivity' in data or 'voiceActivityDetectionSignal' in data:
            # A VAD notice may share a frame with usage or content.
            activity = data.get('voiceActivity')
            activity_type = (activity.get('voiceActivityType',
                              activity.get('type', activity.get('voiceActivity')))
                             if isinstance(activity, dict) else None)
            if activity_type == 'VOICE_ACTIVITY_START':
                activity_type = 'ACTIVITY_START'
            if activity_type == 'ACTIVITY_START':
                self.output_epoch.voice_start(self.reply_started, self.assistant_reply_to)
                recovered_prior = self._retire_caption_recovered_before_voice_start()
                unresolved_prior = (self.user_voice_closed and
                                    bool(self.pending_turn_id['user']))
                if unresolved_prior:
                    self._mark_ambiguous_input()
                if (not recovered_prior and
                        (self.input_after_turn_complete or self.user_voice_closed)):
                    withdrawn = self._withdraw_preview('user')
                    if withdrawn:
                        yield withdrawn
                    self.input_after_turn_complete = False
                self.timing.start()
                # Gemini can finish generating before browser playback
                # ends. Voice start must flush that remaining audio.
                active_reply = bool(self.speaking or self.reply_started or self.model_text
                                    or self.pending_transcript['assistant']
                                    or self.preview_text['assistant'])
                self.suppress_stale_audio = active_reply
                start_diagnostic = self.pcm_diagnostics.snapshot('vad_start', self)
                if active_reply:
                    self._drop_transcription('assistant')
                    self.model_text = ''
                    self.assistant_transcribed_in_turn = False
                    self.suppress_late_output_transcription = True
                started_turn = self._voice_start()
                self.pcm_diagnostics.transition('vad_start', self, start_diagnostic)
                yield LiveSpeechStarted(started_turn)
            elif activity_type == 'ACTIVITY_END':
                if self.output_epoch.voice_end(self.active_voice_turn_id):
                    self.suppress_stale_audio = False
                    self.speaking = False
                self.timing.mark('end')
                self.pcm_diagnostics.transition('vad_end', self)
                yield LiveSpeechEnded(self._voice_end())
        if (data.get('inputTranscription') is not None or
                (isinstance(content_signals, dict) and
                 content_signals.get('inputTranscription') is not None)):
            self.timing.mark('input')
        if 'usageMetadata' in data:
            counts = usage_counts(data['usageMetadata'])
            if counts:
                yield LiveUsage(counts)
        if 'toolCall' in data:
            calls = data['toolCall'].get('functionCalls') if isinstance(data['toolCall'], dict) else None
            if not isinstance(calls, list) or not 1 <= len(calls) <= 4:
                raise ValueError('invalid Live tool call')
            if boundary := self._reply_begins():
                yield boundary
            for call in calls:
                if not isinstance(call, dict):
                    raise ValueError('invalid Live tool call')
                yield LiveToolCall(call.get('id'), call.get('name'), call.get('args'))
            return
        if 'toolCallCancellation' in data:
            # A voice interruption may cancel a read-only status query;
            # it never rolls back or starts a persisted Uonify job.
            return
        if set(data) in ({'voiceActivity'}, {'voiceActivityDetectionSignal'}):
            # VAD notices are control-only; they never grant actions.
            return
        if 'serverContent' not in data and any(key in data for key in
                ('interimInputTranscription', 'inputTranscription', 'outputTranscription')):
            preview = self._interim_input(data.get('interimInputTranscription'))
            if preview:
                yield preview
            for role, key in (('user', 'inputTranscription'),
                              ('assistant', 'outputTranscription')):
                if key in data:
                    if role == 'assistant' and self.suppress_stale_audio:
                        continue
                    if role == 'assistant':
                        user_final = self._reply_begins()
                        if user_final:
                            yield user_final
                    updates = (self._user_transcription(data[key]) if role == 'user'
                               else self._assistant_transcription(data[key]))
                    for update in updates:
                        yield update
            return
        if 'serverContent' not in data:
            if any(key in data for key in ('usageMetadata', 'goAway',
                                           'sessionResumptionUpdate')):
                return
            raise ValueError('unexpected Live event')
        content = data['serverContent']
        if not isinstance(content, dict):
            raise ValueError('invalid Live content')
        self.pcm_diagnostics.observe_content(content, self)
        if content.get('interrupted') is True:
            self.signal_counts['interrupted'] += 1
            self.output_epoch.delimiter(self.active_voice_turn_id)
            self.suppress_stale_audio = (self.output_epoch.voice_open or
                self.output_epoch.cut)
            self.pcm_diagnostics.transition('interrupted', self)
            self.speaking = False
            self._drop_transcription('assistant')
            self.model_text = ''
            self.assistant_transcribed_in_turn = False
            self.suppress_late_output_transcription = False
            self.assistant_reply_to = None
            self.reply_started = False
            self.completed_user_turn_id = None
            yield LiveInterrupted()
            # An interruption and a user transcription may share one
            # serverContent frame. Keep the user's words, not the cut
            # off assistant audio or text.
            preview = self._interim_input(content.get(
                'interimInputTranscription', data.get('interimInputTranscription')))
            if preview:
                yield preview
            user_transcript = content.get('inputTranscription', data.get('inputTranscription'))
            for update in self._user_transcription(user_transcript):
                yield update
            return
        preview = self._interim_input(content.get(
            'interimInputTranscription', data.get('interimInputTranscription')))
        if preview:
            yield preview
        user_transcript = content.get('inputTranscription', data.get('inputTranscription'))
        assistant_transcript = content.get('outputTranscription', data.get('outputTranscription'))
        turn = content.get('modelTurn')
        for update in self._user_transcription(user_transcript):
            yield update
        if (assistant_transcript is not None or turn is not None) and not self.suppress_stale_audio:
            user_final = self._reply_begins()
            if user_final:
                yield user_final
        if turn is not None and not self.assistant_transcribed_in_turn:
            self.suppress_late_output_transcription = False
        if not self.suppress_stale_audio:
            for update in self._assistant_transcription(assistant_transcript):
                yield update
        if turn is not None:
            yield from self._model_turn(turn)
        if content.get('turnComplete') is True:
            yield from self._turn_complete()

    def _model_turn(self, turn):
        if not isinstance(turn, dict) or not isinstance(turn.get('parts'), list):
            raise ValueError('invalid Live turn')
        for part in turn['parts']:
            if not isinstance(part, dict):
                raise ValueError('invalid Live part')
            if self.suppress_stale_audio:
                continue
            self._turn_id('assistant')
            if 'text' in part:
                self._model_text(part['text'])
                if (self.model_text and not self.pending_transcript['assistant']
                        and not self.assistant_transcribed_in_turn):
                    preview = self._preview('assistant', self.model_text)
                    if preview:
                        yield preview
            blob = part.get('inlineData')
            if blob is None:
                continue
            if not isinstance(blob, dict) or blob.get('mimeType') != OUTPUT_MIME:
                raise ValueError('unexpected Live audio format')
            try:
                pcm = base64.b64decode(blob['data'], validate=True)
            except (KeyError, TypeError, binascii.Error) as error:
                raise ValueError('invalid Live audio') from error
            if not pcm or len(pcm) % 2 or len(pcm) > MAX_UPSTREAM_MESSAGE:
                raise ValueError('invalid Live PCM')
            if self.output_bytes + len(pcm) > MAX_OUTPUT_BYTES:
                raise ValueError('output PCM limit')
            self.output_bytes += len(pcm)
            self.output_epoch.ensure(self.assistant_reply_to)
            if not self.speaking:
                self.speaking = True
                yield LiveStatus('speaking', self.output_epoch.generation_id)
            self.timing.mark('audio')
            for offset in range(0, len(pcm), MAX_FRAME_BYTES):
                self.pcm_diagnostics.emitted(pcm[offset:offset + MAX_FRAME_BYTES], self)
                yield LiveAudio(pcm[offset:offset + MAX_FRAME_BYTES],
                    self.output_epoch.generation_id, self.output_epoch.reply_to)

    def _turn_complete(self):
        self.timing.mark('complete')
        self.suppress_stale_audio = self.output_epoch.voice_open
        # Input/output transcriptions have their own `finished`
        # marker, but it is optional. Explicitly provisional text
        # stays pending; unspecified fragments consolidate here.
        preserve_user = self._turn_complete_precedes_current_input()
        user_final = None if preserve_user else self._complete_user_turn()
        if user_final:
            yield user_final
        assistant_final = self._complete_assistant_turn()
        if assistant_final:
            yield assistant_final
        for role in ('user', 'assistant'):
            if (role == 'user' and
                    (preserve_user or self.preview_text['user'] or
                     (self.user_voice_closed and self.pending_turn_id['user']))):
                # Input transcription may trail the model turn.
                # Keep its VAD identity even without provisional
                # text until a late final or a new VAD start.
                continue
            withdrawn = self._withdraw_preview(role)
            if withdrawn:
                yield withdrawn
        if not preserve_user:
            self.input_after_turn_complete = True
        # Late output without a delimiter cannot be assigned
        # safely; it must never create a duplicate assistant turn.
        self.suppress_late_output_transcription = True
        self.assistant_reply_to = None
        self.reply_started = False
        if self.speaking:
            self.speaking = False
            yield LiveStatus('listening', self.output_epoch.generation_id)
        self.pcm_diagnostics.complete(self)
        self.output_epoch.complete()
