import { apiUrl } from '@/shared/api/config';
import { semanticFailureEventOf, type SemanticFailureEvent } from './liveSemanticFailure';
import { semanticRecoveryOf, type SemanticRecovery } from './semanticRecovery';

export const LIVE_WORK_INTENTS = ['drive_access', 'drive_count', 'drive_search', 'drive_analyze', 'drive_assist', 'work_status', 'clarify', 'create_product', 'creative_plan', 'semantic_request', 'recover_request'] as const;
export type LiveWorkIntent = typeof LIVE_WORK_INTENTS[number];

/** Transporte aislado del piloto Live; no captura audio ni inicia tareas de Uony. */
export type LiveTransportEvent =
  | SemanticFailureEvent
  | { type: 'bound'; threadId: string; sessionId: string }
  | { type: 'handoff'; threadId: string; turnId: string; requestId: string;
      status: 'queued' | 'running' | 'success' | 'error' | 'unknown' | 'cancelled'; intent?: LiveWorkIntent;
      semanticRecovery?: SemanticRecovery }
  | { type: 'turn_progress'; threadId: string; turnId: string; phase: 'interpreting' | 'settled' }
  | { type: 'speech_progress'; threadId: string; turnId: string; requestId: string; phase: 'preparing' | 'settled' }
  | { type: 'speech_progress'; threadId: string; turnId: string; requestId: string;
      phase: 'failed'; reason: 'narration_unavailable' }
  | { type: 'voice_notice'; turnId: string; reason: 'response_audio_limit' }
  | { type: 'action_unconfirmed'; threadId: string; turnId: string; reason: 'transcript_not_verified' }
  | { type: 'status'; state: 'ready' | 'listening' | 'speaking'; audioProtocol?: 'scoped-v1' }
  | { type: 'transcript_preview'; role: 'user'; turnId: string; text: string }
  | { type: 'transcript_preview'; role: 'assistant'; turnId: string; text: string; replyToTurnId?: string | null }
  | { type: 'transcript'; role: 'user'; turnId: string; text: string; final: true }
  | { type: 'transcript'; role: 'assistant'; turnId: string; text: string; final: true; replyToTurnId?: string | null }
  // PIEZA 2 · subtítulo de presentación pura (no persiste, C5); canal SEPARADO de `transcript`.
  | { type: 'subtitle'; role: 'user' | 'uony'; text: string; finished: boolean }
  | { type: 'audio'; pcm: Uint8Array }
  | { type: 'speech_delivery'; eventId: string; requestId: string; phase: 'start' | 'end' }
  | { type: 'ordinary_audio'; generationId: string; replyToTurnId: string | null; phase: 'start' | 'end' }
  | { type: 'speech_started'; turnId?: string }
  | { type: 'speech_ended'; turnId: string }
  | { type: 'caption_status'; state: 'ready' | 'unavailable' }
  | { type: 'interrupted' }
  | { type: 'error'; reason: 'connection' | 'protocol' | 'timeout' | 'limit' | 'backpressure' }
  | { type: 'closed'; code: number; wasClean: boolean };

export interface LiveTransport {
  readonly state: 'connecting' | 'ready' | 'closed';
  /** Devuelve false si la sesión no acepta más audio; nunca descarta audio en silencio. */
  sendAudio(pcm: Uint8Array | ArrayBuffer): boolean;
  interrupt(): boolean;
  acknowledgeSpeech(eventId: string, outcome: 'played' | 'interrupted'): boolean;
  acknowledgeOrdinary(generationId: string, outcome: 'played' | 'interrupted'): boolean;
  reportPlayback(state: 'playing' | 'idle'): boolean;
  close(): void;
}

const MAX_FRAME_BYTES = 8192;
const LIVE_SESSION_SECONDS = 8 * 60;
const MAX_INPUT_BYTES = LIVE_SESSION_SECONDS * 16_000 * 2;
const MAX_OUTPUT_BYTES = LIVE_SESSION_SECONDS * 24_000 * 2;
const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_CONTROL_CHARS = 384;
const MAX_TRANSCRIPT_CHARS = 3000;
const MAX_TRANSCRIPT_MESSAGE_CHARS = 4000;
const READY_TIMEOUT_MS = 15_000;
const THREAD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function liveUrl(): string {
  const url = new URL(apiUrl('/uony/live'), window.location.href);
  if (url.origin !== window.location.origin || url.search || url.hash || url.username || url.password ||
      (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('Live requiere la API del mismo origen, sin parámetros.');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

function control(data: string): LiveTransportEvent | null {
  if (data.length > MAX_TRANSCRIPT_MESSAGE_CHARS) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(',');
  const assistantLink = value.replyToTurnId === null ||
    (typeof value.replyToTurnId === 'string' && EVENT_ID.test(value.replyToTurnId));
  const previewKeys = value.role === 'user' ? keys === 'role,text,turnId,type'
    : value.role === 'assistant' && (keys === 'role,text,turnId,type'
      || (keys === 'replyToTurnId,role,text,turnId,type' && assistantLink));
  if (value.type === 'transcript_preview' && previewKeys
      && (value.role === 'user' || value.role === 'assistant')
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)
      && typeof value.text === 'string' && value.text.length <= MAX_TRANSCRIPT_CHARS
      && !value.text.includes('\0')) {
    return value.role === 'user'
      ? { type: 'transcript_preview', role: 'user', turnId: value.turnId, text: value.text }
      : { type: 'transcript_preview', role: 'assistant', turnId: value.turnId, text: value.text,
        ...(keys.includes('replyToTurnId') ? { replyToTurnId: value.replyToTurnId as string | null } : {}) };
  }
  const finalKeys = value.role === 'user' ? keys === 'final,role,text,turnId,type'
    : value.role === 'assistant' && (keys === 'final,role,text,turnId,type'
      || (keys === 'final,replyToTurnId,role,text,turnId,type' && assistantLink));
  if (value.type === 'transcript' && finalKeys
      && value.final === true && (value.role === 'user' || value.role === 'assistant')
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)
      && typeof value.text === 'string' && value.text.trim().length > 0
      && value.text.length <= MAX_TRANSCRIPT_CHARS && !value.text.includes('\0')) {
    return value.role === 'user'
      ? { type: 'transcript', role: 'user', turnId: value.turnId, text: value.text, final: true }
      : { type: 'transcript', role: 'assistant', turnId: value.turnId, text: value.text, final: true,
        ...(keys.includes('replyToTurnId') ? { replyToTurnId: value.replyToTurnId as string | null } : {}) };
  }
  // PIEZA 2 · subtítulo {type, role, text, finished}: presentación pura, canal propio. Validación
  // estricta de claves, igual que `transcript`; se admite antes del límite de control por su texto.
  if (value.type === 'subtitle' && keys === 'finished,role,text,type'
      && (value.role === 'user' || value.role === 'uony')
      && typeof value.text === 'string' && value.text.length <= MAX_TRANSCRIPT_CHARS && !value.text.includes('\0')
      && typeof value.finished === 'boolean') {
    return { type: 'subtitle', role: value.role, text: value.text, finished: value.finished };
  }
  if (value.type === 'semantic_failure') return data.length <= 1600 ? semanticFailureEventOf(value) : null;
  const recoveryHandoff = value.type === 'handoff' && value.semanticRecovery !== undefined;
  if (data.length > (recoveryHandoff ? 1600 : MAX_CONTROL_CHARS)) return null;
  if (value.type === 'bound' && keys === 'sessionId,threadId,type'
      && typeof value.threadId === 'string' && THREAD_ID.test(value.threadId)
      && typeof value.sessionId === 'string' && EVENT_ID.test(value.sessionId)) {
    return { type: 'bound', threadId: value.threadId, sessionId: value.sessionId };
  }
  if (value.type === 'handoff' && ['requestId,status,threadId,turnId,type', 'intent,requestId,status,threadId,turnId,type',
      'requestId,semanticRecovery,status,threadId,turnId,type', 'intent,requestId,semanticRecovery,status,threadId,turnId,type'].includes(keys)
      && typeof value.threadId === 'string' && THREAD_ID.test(value.threadId)
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)
      && typeof value.requestId === 'string' && EVENT_ID.test(value.requestId)
      && ['queued', 'running', 'success', 'error', 'unknown', 'cancelled'].includes(String(value.status))
      && (value.intent === undefined || LIVE_WORK_INTENTS.includes(value.intent as LiveWorkIntent))
      && (!recoveryHandoff || semanticRecoveryOf(value.semanticRecovery, value.requestId))) {
    return { type: 'handoff', threadId: value.threadId, turnId: value.turnId,
      requestId: value.requestId, status: value.status as Extract<LiveTransportEvent, { type: 'handoff' }>['status'],
      ...(value.intent === undefined ? {} : { intent: value.intent as LiveWorkIntent }),
      ...(recoveryHandoff ? { semanticRecovery: value.semanticRecovery as SemanticRecovery } : {}) };
  }
  if (['turn_progress', 'speech_progress'].includes(String(value.type))
      && typeof value.threadId === 'string' && THREAD_ID.test(value.threadId)
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)) {
    if (value.type === 'turn_progress' && keys === 'phase,threadId,turnId,type'
        && ['interpreting', 'settled'].includes(String(value.phase)))
      return { type: 'turn_progress', threadId: value.threadId, turnId: value.turnId,
        phase: value.phase as 'interpreting' | 'settled' };
    if (value.type === 'speech_progress' && keys === 'phase,requestId,threadId,turnId,type'
        && typeof value.requestId === 'string' && EVENT_ID.test(value.requestId)
        && ['preparing', 'settled'].includes(String(value.phase)))
      return { type: 'speech_progress', threadId: value.threadId, turnId: value.turnId,
        requestId: value.requestId, phase: value.phase as 'preparing' | 'settled' };
    if (value.type === 'speech_progress' && keys === 'phase,reason,requestId,threadId,turnId,type'
        && typeof value.requestId === 'string' && EVENT_ID.test(value.requestId)
        && value.phase === 'failed' && value.reason === 'narration_unavailable')
      return { type: 'speech_progress', threadId: value.threadId, turnId: value.turnId,
        requestId: value.requestId, phase: 'failed', reason: 'narration_unavailable' };
  }
  if (value.type === 'action_unconfirmed' && keys === 'reason,threadId,turnId,type'
      && typeof value.threadId === 'string' && THREAD_ID.test(value.threadId)
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)
      && value.reason === 'transcript_not_verified') {
    return { type: 'action_unconfirmed', threadId: value.threadId, turnId: value.turnId,
      reason: 'transcript_not_verified' };
  }
  if (value.type === 'voice_notice' && keys === 'reason,turnId,type'
      && typeof value.turnId === 'string' && UUID.test(value.turnId)
      && value.reason === 'response_audio_limit') {
    return { type: 'voice_notice', turnId: value.turnId, reason: 'response_audio_limit' };
  }
  if (value.type === 'speech_delivery' && keys === 'eventId,phase,requestId,type'
      && typeof value.eventId === 'string' && UUID.test(value.eventId)
      && typeof value.requestId === 'string' && UUID.test(value.requestId)
      && (value.phase === 'start' || value.phase === 'end')) {
    return { type: 'speech_delivery', eventId: value.eventId, requestId: value.requestId, phase: value.phase };
  }
  if (value.type === 'ordinary_audio' && keys === 'generationId,phase,replyToTurnId,type'
      && typeof value.generationId === 'string' && UUID.test(value.generationId)
      && (value.replyToTurnId === null || typeof value.replyToTurnId === 'string' && UUID.test(value.replyToTurnId))
      && (value.phase === 'start' || value.phase === 'end')) {
    return { type: 'ordinary_audio', generationId: value.generationId,
      replyToTurnId: value.replyToTurnId as string | null, phase: value.phase };
  }
  if (value.type === 'speech_started' && keys === 'type') return { type: 'speech_started' };
  if (value.type === 'speech_started' && keys === 'turnId,type'
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)) {
    return { type: 'speech_started', turnId: value.turnId };
  }
  if (value.type === 'speech_ended' && keys === 'turnId,type'
      && typeof value.turnId === 'string' && EVENT_ID.test(value.turnId)) {
    return { type: 'speech_ended', turnId: value.turnId };
  }
  if (value.type === 'caption_status' && keys === 'state,type'
      && (value.state === 'ready' || value.state === 'unavailable')) {
    return { type: 'caption_status', state: value.state };
  }
  if (value.type === 'interrupted' && keys === 'type') return { type: 'interrupted' };
  if (value.type !== 'status') return null;
  if (value.state === 'ready' && (keys === 'inputFormat,outputFormat,state,type' ||
      keys === 'audioProtocol,inputFormat,outputFormat,state,type' && value.audioProtocol === 'scoped-v1') &&
      value.inputFormat === 'pcm_s16le_16000' && value.outputFormat === 'pcm_s16le_24000') {
    return { type: 'status', state: 'ready', ...(value.audioProtocol === 'scoped-v1' ? { audioProtocol: 'scoped-v1' } : {}) };
  }
  if (keys === 'state,type' && (value.state === 'listening' || value.state === 'speaking')) {
    return { type: 'status', state: value.state };
  }
  return null;
}

/** La única acción al importar este módulo es definir la función: abrir requiere llamada explícita. */
export function connectLiveTransport(threadId: string, onEvent: (event: LiveTransportEvent) => void,
  makeSocket: (url: string) => WebSocket = url => new WebSocket(url),
  projectId?: string | null): LiveTransport {
  if (!THREAD_ID.test(threadId)) throw new RangeError('La conversación de voz necesita un hilo válido.');
  const socket = makeSocket(liveUrl());
  socket.binaryType = 'arraybuffer';
  let state: LiveTransport['state'] = 'connecting';
  let inputBytes = 0;
  let outputBytes = 0;
  let errorSent = false;
  let interruptSent = false;
  let closedSent = false;
  let bound = false;
  let openingConfirmed = false;
  let playbackState: 'playing' | 'idle' = 'idle';
  const timeout = window.setTimeout(() => fail('timeout'), READY_TIMEOUT_MS);

  function stop(): void {
    if (state === 'closed') return;
    state = 'closed';
    window.clearTimeout(timeout);
    try { socket.close(); } catch { /* El cierre local prevalece ante un socket roto. */ }
  }

  function notify(event: LiveTransportEvent): void {
    try { onEvent(event); }
    catch { stop(); }
  }

  function fail(reason: Extract<LiveTransportEvent, { type: 'error' }>['reason']): void {
    if (state === 'closed') return;
    if (!errorSent) { errorSent = true; notify({ type: 'error', reason }); }
    stop();
  }

  function write(data: string | ArrayBuffer): boolean {
    if (socket.readyState !== WebSocket.OPEN) { fail('connection'); return false; }
    try { socket.send(data); return true; }
    catch { fail('connection'); return false; }
  }

  socket.onopen = () => {
    if (state !== 'connecting') return;
    write(JSON.stringify({ type: 'bind', threadId,
      ...(projectId !== undefined ? { projectId } : {}) }));
  };
  socket.onmessage = event => {
    if (state === 'closed') return;
    // Stop is final for this voice session. Frames already in flight are no
    // longer part of playback or protocol accounting while the peer closes.
    if (interruptSent) return;
    if (typeof event.data === 'string') {
      const message = control(event.data);
      if (!message) { fail('protocol'); return; }
      if (message.type === 'bound') {
        if (state !== 'connecting' || bound || message.threadId !== threadId) { fail('protocol'); return; }
        bound = true;
        notify(message);
        // El servidor no abre Vertex hasta que esta instancia aún viva confirma el bind.
        if (state === 'connecting' && socket.readyState === WebSocket.OPEN
          && write(JSON.stringify({ type: 'ready', sessionId: message.sessionId }))) openingConfirmed = true;
        return;
      } else if (message.type === 'status' && message.state === 'ready') {
        if (state !== 'connecting' || !bound || !openingConfirmed) { fail('protocol'); return; }
        state = 'ready';
        window.clearTimeout(timeout);
      } else if (state !== 'ready') { fail('protocol'); return; }
      if ((['handoff', 'action_unconfirmed', 'semantic_failure', 'turn_progress', 'speech_progress'].includes(message.type) && 'threadId' in message)
        && message.threadId !== threadId) { fail('protocol'); return; }
      notify(message);
      return;
    }
    if (state !== 'ready' || !(event.data instanceof ArrayBuffer) || !event.data.byteLength ||
        event.data.byteLength > MAX_FRAME_BYTES || event.data.byteLength % 2) {
      fail('protocol');
      return;
    }
    outputBytes += event.data.byteLength;
    if (outputBytes > MAX_OUTPUT_BYTES) { fail('limit'); return; }
    notify({ type: 'audio', pcm: new Uint8Array(event.data) });
  };
  socket.onerror = () => { if (interruptSent) stop(); else fail('connection'); };
  socket.onclose = event => {
    if (closedSent) return;
    closedSent = true;
    state = 'closed';
    window.clearTimeout(timeout);
    notify({ type: 'closed', code: event.code, wasClean: event.wasClean });
  };

  return {
    get state() { return state; },
    sendAudio(pcm) {
      if (state !== 'ready' || interruptSent) return false;
      const bytes = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : pcm;
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength ||
          bytes.byteLength > MAX_FRAME_BYTES || bytes.byteLength % 2) {
        throw new RangeError('Live requiere PCM16 mono en tramas pares de hasta 8192 bytes.');
      }
      if (inputBytes + bytes.byteLength > MAX_INPUT_BYTES) { fail('limit'); return false; }
      if (socket.bufferedAmount + bytes.byteLength > MAX_BUFFERED_BYTES) { fail('backpressure'); return false; }
      // Una copia pequeña evita enviar accidentalmente un SharedArrayBuffer.
      const frame = new Uint8Array(bytes.byteLength);
      frame.set(bytes);
      if (!write(frame.buffer)) return false;
      inputBytes += bytes.byteLength;
      return true;
    },
    interrupt() {
      if (state !== 'ready' || interruptSent) return false;
      if (!write(JSON.stringify({ type: 'interrupt' }))) return false;
      interruptSent = true;
      // Manual Stop closes the voice session upstream. Flush any queued audio
      // immediately; frames already in flight must never reach playback.
      notify({ type: 'interrupted' });
      return true;
    },
    acknowledgeSpeech(eventId, outcome) {
      if (!UUID.test(eventId) || !['played', 'interrupted'].includes(outcome)) {
        throw new RangeError('El acuse de voz necesita un evento y un resultado válidos.');
      }
      if (state !== 'ready' || (interruptSent && outcome !== 'interrupted')) return false;
      return write(JSON.stringify({ type: 'speech_ack', eventId, outcome }));
    },
    acknowledgeOrdinary(generationId, outcome) {
      if (!UUID.test(generationId) || !['played', 'interrupted'].includes(outcome)) {
        throw new RangeError('El acuse de audio necesita una generación y un resultado válidos.');
      }
      if (state !== 'ready' || (interruptSent && outcome !== 'interrupted')) return false;
      return write(JSON.stringify({ type: 'ordinary_ack', generationId, outcome }));
    },
    reportPlayback(nextState) {
      if (nextState !== 'playing' && nextState !== 'idle') throw new RangeError('Estado de reproducción inválido.');
      if (state !== 'ready' || (interruptSent && nextState !== 'idle')) return false;
      if (playbackState === nextState) return true;
      if (!write(JSON.stringify({ type: 'playback_state', state: nextState }))) return false;
      playbackState = nextState;
      return true;
    },
    close: stop,
  };
}
