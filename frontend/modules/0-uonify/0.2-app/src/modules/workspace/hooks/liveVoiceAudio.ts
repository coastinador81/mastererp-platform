import { connectLiveTransport, type LiveTransport, type LiveTransportEvent } from '../api/liveTransport';

type SpeechDelivery = {
  eventId: string;
  requestId: string;
  ended: boolean;
  hadAudio: boolean;
  pendingSources: number;
  outcome?: 'played' | 'interrupted';
};
type OrdinaryGeneration = {
  generationId: string;
  replyToTurnId: string | null;
  discarded: boolean;
  samples: number;
  hadAudio: boolean;
  ended: boolean;
  pendingSources: number;
  outcome?: 'played' | 'interrupted';
};

type VoiceState = 'connecting' | 'listening' | 'speaking' | 'interrupted';
type FailureCause = Extract<LiveTransportEvent, { type: 'error' | 'closed' }>
  | { type: 'local'; reason: 'microphone' | 'audio_context' | 'capture' | 'playback' | 'startup' };

/** Solo metadatos de diagnóstico: nunca incluye audio, transcripción ni identificadores. */
export type LiveVoiceFailure = FailureCause & {
  phase: 'startup' | 'active';
  sentAudioFrames: number;
  receivedAudioFrames: number;
  transcriptEvents: number;
  interruptionEvents: number;
};

interface LiveVoiceCallbacks {
  threadId: string;
  projectId?: string | null;
  valid(): boolean;
  bound?(): void;
  status(state: VoiceState): void;
  preview?(event: Extract<LiveTransportEvent, { type: 'transcript_preview' }>): void;
  speechStarted?(turnId?: string, interruptedPlayback?: boolean): void;
  speechEnded?(turnId: string): void;
  captionStatus?(state: 'ready' | 'unavailable'): void;
  // Primer audio audible de una narración verificada (el envío se abre antes de que exista audio).
  speechAudible?(requestId: string): void;
  transcript(event: Extract<LiveTransportEvent, { type: 'transcript' }>): void;
  // PIEZA 2 · subtítulo de presentación (canal propio, no persiste).
  subtitle?(event: Extract<LiveTransportEvent, { type: 'subtitle' }>): void;
  progress?(event: Extract<LiveTransportEvent, { type: 'turn_progress' | 'speech_progress' }>): void;
  speechDelivery?(event: Extract<LiveTransportEvent, { type: 'speech_delivery' }>): void;
  handoff?(event: Extract<LiveTransportEvent, { type: 'handoff' }>): void;
  voiceNotice?(event: { type: 'voice_notice'; turnId: string;
    reason: 'response_audio_limit' | 'response_audio_unavailable' }): void;
  actionUnconfirmed?(event: Extract<LiveTransportEvent, { type: 'action_unconfirmed' }>): void;
  semanticFailure?(event: Extract<LiveTransportEvent, { type: 'semantic_failure' }>): void;
  error(failure: LiveVoiceFailure): void;
}

export interface LiveVoiceAudio {
  stop(): void;
  muteMicrophone(muted: boolean): void;
  muteSpeaker(muted: boolean): void;
}

/** Voz Live ligada al hilo: el servidor persiste las transcripciones antes de emitirlas. */
export function startLiveVoiceAudio(callbacks: LiveVoiceCallbacks): LiveVoiceAudio {
  let stopped = false;
  let microphoneMuted = false;
  let speakerMuted = false;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let input: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silent: GainNode | null = null;
  let transport: LiveTransport | null = null;
  let nextPlayback = 0;
  let ready = false;
  let sentAudioFrames = 0;
  let receivedAudioFrames = 0;
  let transcriptEvents = 0;
  let interruptionEvents = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const deliveries = new Map<string, SpeechDelivery>();
  let activeDelivery: SpeechDelivery | null = null;
  let wireDelivery: { delivery: SpeechDelivery; discard: boolean } | null = null;
  const ordinaryGenerations = new Map<string, OrdinaryGeneration>();
  const cancelledOrdinaryTurns = new Set<string | null>();
  let latestOrdinaryTurn: string | null | undefined;
  let activeOrdinary: OrdinaryGeneration | null = null;
  let wireOrdinary: { generation: OrdinaryGeneration; discard: boolean } | null = null;
  let scopedAudio = false;
  let ordinaryBlocked = false;
  let userSpeaking = false;
  let latestUserTurn: string | null = null;
  let pendingVadTurn: string | null = null;
  const observedUserTurns = new Set<string>();

  const observeUserTurn = (turnId: string) => {
    observedUserTurns.add(turnId);
    if (observedUserTurns.size > 256) observedUserTurns.delete(observedUserTurns.values().next().value!);
  };

  const invalidateOrdinaryTurn = () => {
    const generation = activeOrdinary ?? wireOrdinary?.generation;
    const turn = generation ? generation.replyToTurnId : latestOrdinaryTurn;
    if (turn !== undefined) cancelledOrdinaryTurns.add(turn);
    if (cancelledOrdinaryTurns.size > 256) cancelledOrdinaryTurns.delete(cancelledOrdinaryTurns.values().next().value!);
  };

  const acknowledge = (delivery: SpeechDelivery, outcome: 'played' | 'interrupted') => {
    if (delivery.outcome) return;
    delivery.outcome = outcome;
    transport?.acknowledgeSpeech(delivery.eventId, outcome);
  };
  const finishDelivery = (delivery: SpeechDelivery) => {
    if (delivery.ended && delivery.pendingSources === 0 && !delivery.outcome) {
      const played = delivery.hadAudio && !speakerMuted && context?.state === 'running';
      acknowledge(delivery, played ? 'played' : 'interrupted');
      if (activeDelivery === delivery) {
        activeDelivery = null;
        if (played && playing.size === 0 && !stopped && callbacks.valid()) callbacks.status('listening');
      }
    }
  };
  const acknowledgeOrdinary = (generation: OrdinaryGeneration, outcome: 'played' | 'interrupted') => {
    if (generation.outcome) return;
    generation.outcome = outcome;
    transport?.acknowledgeOrdinary(generation.generationId, outcome);
  };
  const finishOrdinary = (generation: OrdinaryGeneration) => {
    if (!generation.ended || generation.pendingSources !== 0 || generation.outcome) return;
    // A complete generation below 50 ms is not a usable utterance. Tiny frames
    // inside otherwise valid audio remain untouched; never retry the provider.
    const enoughAudio = generation.samples >= 1200;
    const eligible = !generation.discarded && !speakerMuted && context?.state === 'running';
    const played = generation.hadAudio && enoughAudio && eligible;
    acknowledgeOrdinary(generation, played ? 'played' : 'interrupted');
    if (activeOrdinary === generation && eligible && playing.size === 0 && !stopped && callbacks.valid()) {
      const turnId = generation.replyToTurnId ?? latestUserTurn;
      if (!enoughAudio && turnId) callbacks.voiceNotice?.({
        type: 'voice_notice', turnId, reason: 'response_audio_unavailable' });
      callbacks.status('listening');
    }
  };

  const clearPlayback = () => {
    if (activeDelivery) acknowledge(activeDelivery, 'interrupted');
    if (wireDelivery) wireDelivery.discard = true;
    activeDelivery = null;
    if (activeOrdinary) { activeOrdinary.discarded = true; acknowledgeOrdinary(activeOrdinary, 'interrupted'); }
    if (wireOrdinary) { wireOrdinary.discard = true; acknowledgeOrdinary(wireOrdinary.generation, 'interrupted'); }
    activeOrdinary = null;
    for (const source of playing) { source.onended = null; try { source.stop(); } catch { /* Ya terminó. */ } source.disconnect(); }
    playing.clear();
    transport?.reportPlayback('idle');
    nextPlayback = context?.currentTime ?? 0;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearPlayback();
    transport?.close();
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    input?.disconnect();
    silent?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    if (context) void context.close().catch(() => {});
    transport = null; processor = null; input = null; silent = null; stream = null; context = null;
  };
  const fail = (cause: FailureCause) => {
    if (stopped) return;
    const failure: LiveVoiceFailure = { ...cause, phase: ready ? 'active' : 'startup',
      sentAudioFrames, receivedAudioFrames, transcriptEvents, interruptionEvents };
    stop();
    if (callbacks.valid()) callbacks.error(failure);
  };
  const valid = () => {
    if (!stopped && callbacks.valid()) return true;
    stop();
    return false;
  };
  const deliveryEvent = (event: Extract<LiveTransportEvent, { type: 'speech_delivery' }>) => {
    if (event.phase === 'end') {
      if (!wireDelivery || wireDelivery.delivery.eventId !== event.eventId
          || wireDelivery.delivery.requestId !== event.requestId) {
        fail({ type: 'error', reason: 'protocol' }); return;
      }
      const { delivery, discard } = wireDelivery;
      wireDelivery = null;
      if (!discard) { delivery.ended = true; finishDelivery(delivery); }
      return;
    }
    if (wireDelivery || wireOrdinary) { fail({ type: 'error', reason: 'protocol' }); return; }
    const previous = deliveries.get(event.eventId);
    if (previous) {
      if (previous.requestId !== event.requestId) { fail({ type: 'error', reason: 'protocol' }); return; }
      // Un envelope repetido no detiene el original que aún está sonando.
      wireDelivery = { delivery: previous, discard: true };
      return;
    }
    clearPlayback();
    const delivery: SpeechDelivery = { eventId: event.eventId, requestId: event.requestId,
      ended: false, hadAudio: false, pendingSources: 0 };
    deliveries.set(event.eventId, delivery);
    if (deliveries.size > 256) deliveries.delete(deliveries.keys().next().value!);
    activeDelivery = delivery;
    wireDelivery = { delivery, discard: speakerMuted };
    if (speakerMuted) acknowledge(delivery, 'interrupted');
  };
  const ordinaryEvent = (event: Extract<LiveTransportEvent, { type: 'ordinary_audio' }>) => {
    scopedAudio = true;
    if (event.phase === 'end') {
      if (!wireOrdinary || wireOrdinary.generation.generationId !== event.generationId
          || wireOrdinary.generation.replyToTurnId !== event.replyToTurnId) {
        fail({ type: 'error', reason: 'protocol' }); return;
      }
      const { generation, discard } = wireOrdinary;
      wireOrdinary = null;
      if (!discard) { generation.ended = true; finishOrdinary(generation); }
      return;
    }
    if (wireOrdinary || wireDelivery) { fail({ type: 'error', reason: 'protocol' }); return; }
    const previous = ordinaryGenerations.get(event.generationId);
    if (previous) {
      if (previous.replyToTurnId !== event.replyToTurnId) { fail({ type: 'error', reason: 'protocol' }); return; }
      wireOrdinary = { generation: previous, discard: true };
      return;
    }
    const discard = userSpeaking || speakerMuted || cancelledOrdinaryTurns.has(event.replyToTurnId)
      || (latestUserTurn !== null && event.replyToTurnId !== latestUserTurn);
    if (!discard) clearPlayback();
    const generation: OrdinaryGeneration = { generationId: event.generationId,
      replyToTurnId: event.replyToTurnId, discarded: discard, samples: 0, hadAudio: false, ended: false, pendingSources: 0 };
    ordinaryGenerations.set(event.generationId, generation);
    if (ordinaryGenerations.size > 256) ordinaryGenerations.delete(ordinaryGenerations.keys().next().value!);
    wireOrdinary = { generation, discard };
    if (discard) acknowledgeOrdinary(generation, 'interrupted');
    if (!discard) { activeOrdinary = generation; latestOrdinaryTurn = event.replyToTurnId; ordinaryBlocked = false; }
  };
  const play = (pcm: Uint8Array) => {
    if (wireDelivery?.discard || wireOrdinary?.discard || wireOrdinary?.generation.discarded || !context || speakerMuted) return;
    if (!wireDelivery && !wireOrdinary && (scopedAudio || ordinaryBlocked)) return;
    const delivery = wireDelivery?.delivery;
    const ordinary = wireOrdinary?.generation;
    const firstVerifiedAudio = delivery && !delivery.hadAudio;
    const firstOrdinaryAudio = ordinary && !ordinary.hadAudio;
    if (ordinary) { ordinary.hadAudio = true; ordinary.samples += pcm.byteLength / 2; ordinary.pendingSources += 1; }
    if (delivery) { delivery.hadAudio = true; delivery.pendingSources += 1; }
    const samples = pcm.byteLength / 2;
    const audio = context.createBuffer(1, samples, 24_000);
    const channel = audio.getChannelData(0);
    const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < samples; i++) channel[i] = data.getInt16(i * 2, true) / 32_768;
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(context.destination);
    source.onended = () => {
      if (!playing.delete(source)) return;
      source.disconnect();
      if (playing.size === 0) transport?.reportPlayback('idle');
      if (!valid()) return;
      if (delivery) { delivery.pendingSources -= 1; finishDelivery(delivery); }
      if (ordinary) { ordinary.pendingSources -= 1; finishOrdinary(ordinary); }
    };
    playing.add(source);
    const start = Math.max(context.currentTime, nextPlayback);
    source.start(start);
    if (playing.size === 1 && context.state === 'running') transport?.reportPlayback('playing');
    nextPlayback = start + audio.duration;
    if ((firstVerifiedAudio || firstOrdinaryAudio) && !stopped) callbacks.status('speaking');
    if (firstVerifiedAudio && delivery && !stopped && callbacks.valid()) callbacks.speechAudible?.(delivery.requestId);
  };
  const startMicrophone = async () => {
    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
    } catch { fail({ type: 'local', reason: 'microphone' }); return; }
    if (!valid()) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    stream.getAudioTracks().forEach(track => { track.enabled = !microphoneMuted; });
    try {
      context = new AudioContext({ sampleRate: 16_000 });
      if (context.sampleRate !== 16_000) { fail({ type: 'local', reason: 'audio_context' }); return; }
      input = context.createMediaStreamSource(stream);
      // 512 muestras a 16 kHz = 32 ms por trama para que Live detecte antes la interrupción.
      processor = context.createScriptProcessor(512, 1, 1);
      silent = context.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = event => {
        if (!valid() || microphoneMuted || transport?.state !== 'ready') return;
        const samples = event.inputBuffer.getChannelData(0);
        const pcm = new Uint8Array(samples.length * 2);
        const data = new DataView(pcm.buffer);
        for (let i = 0; i < samples.length; i++) {
          const sample = Math.max(-1, Math.min(1, samples[i]));
          data.setInt16(i * 2, sample < 0 ? sample * 32_768 : sample * 32_767, true);
        }
        try {
          if (transport.sendAudio(pcm)) sentAudioFrames += 1;
          else fail({ type: 'local', reason: 'capture' });
        } catch { fail({ type: 'local', reason: 'capture' }); }
      };
      input.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
      await context.resume();
      if (!valid()) return;
      if (context.state !== 'running') { fail({ type: 'local', reason: 'audio_context' }); return; }
      // El servidor solo se abre tras conceder el micrófono y preparar el audio local.
      transport = connectLiveTransport(callbacks.threadId, event => {
        if (!valid()) return;
        if (event.type === 'error' || event.type === 'closed') { fail(event); return; }
        if (event.type === 'speech_delivery') { deliveryEvent(event); callbacks.speechDelivery?.(event); return; }
        if (event.type === 'turn_progress' || event.type === 'speech_progress') { callbacks.progress?.(event); return; }
        if (event.type === 'ordinary_audio') { ordinaryEvent(event); return; }
        if (event.type === 'audio') {
          try { play(event.pcm); receivedAudioFrames += 1; }
          catch { fail({ type: 'local', reason: 'playback' }); }
          return;
        }
        if (event.type === 'speech_started') {
          invalidateOrdinaryTurn();
          userSpeaking = true;
          ordinaryBlocked = true;
          if (event.turnId) { latestUserTurn = event.turnId; pendingVadTurn = event.turnId; observeUserTurn(event.turnId); }
          const hadPlayback = playing.size > 0;
          clearPlayback();
          callbacks.speechStarted?.(event.turnId, hadPlayback);
          if (hadPlayback) callbacks.status('interrupted');
          return;
        }
        if (event.type === 'speech_ended') {
          if (latestUserTurn === null || latestUserTurn === event.turnId) userSpeaking = false;
          callbacks.speechEnded?.(event.turnId); return;
        }
        if (event.type === 'caption_status') { callbacks.captionStatus?.(event.state); return; }
        if (event.type === 'subtitle') { callbacks.subtitle?.(event); return; }
        if (event.type === 'interrupted') {
          invalidateOrdinaryTurn();
          ordinaryBlocked = true;
          interruptionEvents += 1; clearPlayback(); callbacks.speechStarted?.(undefined, true); callbacks.status('interrupted'); return;
        }
        if (event.type === 'transcript_preview') { callbacks.preview?.(event); return; }
        if (event.type === 'transcript') {
          if (event.role === 'user') {
            if (latestUserTurn === null || latestUserTurn === event.turnId) userSpeaking = false;
            // Un final nuevo avanza sin VAD; uno antiguo no desplaza un turno posterior.
            if (latestUserTurn === null || (!observedUserTurns.has(event.turnId) && pendingVadTurn === null)) {
              latestUserTurn = event.turnId; userSpeaking = false;
            }
            if (pendingVadTurn === event.turnId) pendingVadTurn = null;
            observeUserTurn(event.turnId);
          }
          transcriptEvents += 1; callbacks.transcript(event); return;
        }
        if (event.type === 'handoff') { callbacks.handoff?.(event); return; }
        if (event.type === 'voice_notice') { callbacks.voiceNotice?.(event); return; }
        if (event.type === 'action_unconfirmed') { callbacks.actionUnconfirmed?.(event); return; }
        if (event.type === 'semantic_failure') {
          cancelledOrdinaryTurns.add(event.turnId);
          if (cancelledOrdinaryTurns.size > 256) cancelledOrdinaryTurns.delete(cancelledOrdinaryTurns.values().next().value!);
          if (activeOrdinary?.replyToTurnId === event.turnId) clearPlayback();
          callbacks.semanticFailure?.(event); return;
        }
        if (event.type === 'bound') {
          callbacks.bound?.();
          valid(); // Cambiar de hilo o detenerse durante bound impide confirmar la apertura de Vertex.
          return;
        }
        // La reproducción verificada conserva el estado hasta acabar o ser interrumpida.
        if (activeDelivery?.hadAudio && !activeDelivery.outcome) return;
        if (activeOrdinary?.hadAudio && playing.size > 0) return;
        if (event.state === 'ready') { ready = true; scopedAudio = event.audioProtocol === 'scoped-v1'; callbacks.status('listening'); return; }
        if (ordinaryBlocked || userSpeaking) return;
        if (event.state === 'speaking') callbacks.status('speaking');
        else callbacks.status('listening');
      }, undefined, callbacks.projectId);
    } catch { fail({ type: 'local', reason: 'startup' }); }
  };

  if (!callbacks.valid() || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
    fail({ type: 'local', reason: 'startup' });
  } else {
    callbacks.status('connecting');
    void startMicrophone();
  }
  return {
    stop,
    muteMicrophone(muted) {
      microphoneMuted = muted;
      stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    },
    muteSpeaker(muted) {
      speakerMuted = muted;
      if (muted) clearPlayback();
    },
  };
}
