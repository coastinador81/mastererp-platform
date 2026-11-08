import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';

const ready = JSON.stringify({ type: 'status', state: 'ready',
  inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000', audioProtocol: 'scoped-v1' });

class Socket {
  static instances: Socket[] = [];
  static OPEN = 1;
  binaryType: BinaryType = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.({ code: 1000, wasClean: true } as CloseEvent); });
  constructor(readonly url: string) { Socket.instances.push(this); }
  receive(data: string | ArrayBuffer) { this.onmessage?.({ data } as MessageEvent); }
  accept() {
    this.readyState = 1;
    this.onopen?.();
    this.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    this.receive(ready);
  }
}

class Track {
  enabled = true;
  stop = vi.fn();
}
class AudioNode {
  connect = vi.fn(); disconnect = vi.fn();
}
class Processor extends AudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
  frame(samples: number[]) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(samples) } } as unknown as AudioProcessingEvent);
  }
}
class Source extends AudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start = vi.fn(); stop = vi.fn();
}
class Context {
  static instances: Context[] = [];
  static resumePlan: (() => Promise<void>) | null = null;
  sampleRate = 16_000;
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = new AudioNode();
  input = new AudioNode();
  processor = new Processor();
  gain = Object.assign(new AudioNode(), { gain: { value: 1 } });
  sources: Source[] = [];
  close = vi.fn(async () => { this.state = 'closed'; });
  resume = vi.fn(async () => { await Context.resumePlan?.(); this.state = 'running'; });
  constructor() { Context.instances.push(this); }
  createMediaStreamSource = vi.fn(() => this.input);
  createScriptProcessor = vi.fn(() => this.processor);
  createGain = vi.fn(() => this.gain);
  createBuffer = vi.fn((_channels: number, samples: number, rate: number) => ({
    duration: samples / rate, getChannelData: () => new Float32Array(samples),
  }));
  createBufferSource = vi.fn(() => { const source = new Source(); this.sources.push(source); return source; });
}

let track: Track;
let resolveMedia: ((value: MediaStream) => void) | null;
let getUserMedia: ReturnType<typeof vi.fn>;
const stream = () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream;
const socket = () => Socket.instances.at(-1)!;
const context = () => Context.instances.at(-1)!;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const callbacks = (status = vi.fn(), error = vi.fn(), transcript = vi.fn()) => ({
  threadId: 'thread-one', valid: () => true, status, error, transcript,
});

beforeEach(() => {
  Socket.instances = []; Context.instances = []; Context.resumePlan = null; track = new Track();
  resolveMedia = null;
  getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
    resolveMedia = resolve;
  }));
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('AudioContext', Context);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => { vi.unstubAllGlobals(); });

const turnA = '11111111-1111-4111-8111-111111111111';
const turnB = '22222222-2222-4222-8222-222222222222';
const generationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const generationC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const control = (value: object) => socket().receive(JSON.stringify(value));
const pcm = (samples = 1200) => socket().receive(new Int16Array(samples).fill(2048).buffer);
const ordinary = (phase: 'start' | 'end', generationId = generationA, replyToTurnId: string | null = turnA) =>
  control({ type: 'ordinary_audio', phase, generationId, replyToTurnId });
const speech = (phase: 'started' | 'ended', turnId = turnA) => control({ type: `speech_${phase}`, turnId });
const final = (turnId: string) => control({ type: 'transcript', role: 'user', turnId, text: 'Pregunta', final: true });
const start = async (status = vi.fn(), error = vi.fn(), transcript = vi.fn()) => {
  const voice = startLiveVoiceAudio(callbacks(status, error, transcript));
  resolveMedia!(stream()); await settle(); socket().accept(); return voice;
};
const pendingReply = () => { speech('started'); speech('ended'); ordinary('start'); pcm(); pcm(); ordinary('end'); };
const states = () => socket().send.mock.calls.map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
  .filter(value => value?.type === 'playback_state').map(value => value.state);
const ordinaryAcks = () => socket().send.mock.calls.map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
  .filter(value => value?.type === 'ordinary_ack');

describe('audio ordinario vinculado a su generación y turno', () => {
  it('con scoped-v1 nunca reproduce PCM fuera de un envelope, aunque llegue speaking', async () => {
    const voice = await start();
    control({ type: 'status', state: 'speaking' }); pcm();
    expect(context().sources).toHaveLength(0);
    ordinary('start'); pcm(); ordinary('end'); pcm();
    expect(context().sources).toHaveLength(1); voice.stop();
  });

  it('reproduce el audio de una respuesta conversacional en el orden real del backend', async () => {
    // Orden de cable que produce el backend para un turno conversacional con
    // retención + resolución semántica: VAD, progreso de turno, final de usuario,
    // listening, settled, speaking y un único envelope ordinary_audio. Debe llegar
    // a play (crear una fuente) sin fallo de protocolo, con un único end por
    // generación (el backend ya no duplica el end tras una corrección de carrera).
    const status = vi.fn(); const error = vi.fn();
    const voice = await start(status, error);
    control({ type: 'speech_started', turnId: turnA });
    control({ type: 'turn_progress', threadId: 'thread-one', turnId: turnA, phase: 'interpreting' });
    control({ type: 'transcript', role: 'user', turnId: turnA, text: '¿me escuchas?', final: true });
    control({ type: 'status', state: 'listening' });
    control({ type: 'turn_progress', threadId: 'thread-one', turnId: turnA, phase: 'settled' });
    control({ type: 'status', state: 'speaking' });
    ordinary('start'); pcm(); pcm(); ordinary('end');
    expect(error).not.toHaveBeenCalled();
    expect(context().sources).toHaveLength(2);
    expect(status).toHaveBeenLastCalledWith('speaking');
    context().sources.forEach(source => source.onended?.());
    expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome: 'played' }]);
    voice.stop();
  });

  it('rechaza un end ordinary_audio duplicado como protocolo (contrato que respeta el backend)', async () => {
    const error = vi.fn();
    const voice = await start(vi.fn(), error);
    final(turnA); ordinary('start'); pcm(); ordinary('end');
    expect(error).not.toHaveBeenCalled();
    ordinary('end');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', reason: 'protocol' }));
    voice.stop();
  });

  it('el final del proveedor no impide cortar fuentes pendientes ni descartar la generación antigua', async () => {
    const status = vi.fn(); const error = vi.fn(); const voice = await start(status, error);
    pendingReply(); control({ type: 'status', state: 'listening' });
    expect(status).toHaveBeenLastCalledWith('speaking');
    const sources = [...context().sources]; const staleEnded = sources.map(source => source.onended);
    speech('started', turnB);
    sources.forEach(source => expect(source.stop).toHaveBeenCalledOnce());
    ordinary('start'); pcm(); ordinary('end');
    pcm(); control({ type: 'status', state: 'speaking' }); pcm();
    staleEnded.forEach(ended => ended?.());
    expect(context().sources).toHaveLength(2); expect(status).toHaveBeenLastCalledWith('interrupted');
    expect(states()).toEqual(['playing', 'idle']);
    context().processor.frame([0.4, -0.4]);
    expect(socket().send.mock.calls.filter(([value]) => value instanceof ArrayBuffer)).toHaveLength(1);
    speech('ended', turnB); final(turnB); ordinary('start', generationB, turnB); pcm(); pcm();
    ordinary('end', generationB, turnB); control({ type: 'status', state: 'listening' });
    expect(context().sources).toHaveLength(4); expect(status).toHaveBeenLastCalledWith('speaking');
    context().sources[2].onended?.(); expect(status).toHaveBeenLastCalledWith('speaking');
    context().sources[3].onended?.(); expect(status).toHaveBeenLastCalledWith('listening');
    expect(states()).toEqual(['playing', 'idle', 'playing', 'idle']);
    expect(error).not.toHaveBeenCalled(); voice.stop();
  });

  it('corta un envelope abierto y sus PCM posteriores, sin cerrar el micrófono', async () => {
    const voice = await start(); speech('started'); speech('ended'); ordinary('start'); pcm();
    speech('started', turnB); pcm(); ordinary('end');
    expect(context().sources).toHaveLength(1); expect(context().sources[0].stop).toHaveBeenCalledOnce();
    context().processor.frame([0.5]); expect(track.stop).not.toHaveBeenCalled();
    expect(socket().readyState).toBe(Socket.OPEN); voice.stop();
  });

  it('un ID nuevo no rescata audio para un turno anterior ni habla encima del usuario', async () => {
    const voice = await start(); pendingReply(); speech('started', turnB);
    ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
    speech('ended', turnB); ordinary('start', generationC, turnA); pcm(); ordinary('end', generationC, turnA);
    expect(context().sources).toHaveLength(2); voice.stop();
  });

  it('interrupted sin VAD también bloquea generaciones nuevas del turno cancelado', async () => {
    const voice = await start(); pendingReply(); control({ type: 'interrupted' });
    ordinary('start', generationB, turnA); pcm(); ordinary('end', generationB, turnA);
    expect(context().sources).toHaveLength(2);
    speech('started', turnB); speech('ended', turnB);
    ordinary('start', generationC, turnB); pcm(); ordinary('end', generationC, turnB);
    expect(context().sources).toHaveLength(3); voice.stop();
  });

  it('un final tardío de A no cambia el foco B ni impide oír su respuesta', async () => {
    const transcript = vi.fn(); const voice = await start(vi.fn(), vi.fn(), transcript);
    speech('started'); speech('ended'); speech('started', turnB); speech('ended', turnB);
    final(turnA); ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB); final(turnB);
    expect(context().sources).toHaveLength(1); expect(transcript).toHaveBeenCalledTimes(2); voice.stop();
  });

  it('avanza con finales sin VAD y nunca retrocede por un final antiguo repetido', async () => {
    const voice = await start(); final(turnA); ordinary('start'); pcm(); ordinary('end');
    context().sources[0].onended?.(); final(turnB); final(turnA);
    ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
    expect(context().sources).toHaveLength(2); voice.stop();
  });

  it('el final de un turno nuevo cierra también el inicio de voz legado sin identificador', async () => {
    const voice = await start(); final(turnA); ordinary('start'); pcm(); ordinary('end');
    control({ type: 'speech_started' }); final(turnB);
    ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
    expect(context().sources).toHaveLength(2); voice.stop();
  });

  it('un interrupted posterior al VAD de B cancela A, no su nueva respuesta B', async () => {
    const voice = await start(); pendingReply(); speech('started', turnB); speech('ended', turnB);
    control({ type: 'interrupted' }); final(turnB); final(turnA);
    ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
    expect(context().sources).toHaveLength(3); voice.stop();
  });

  it('un envelope duplicado no corta ni vuelve a encolar el original pendiente', async () => {
    const voice = await start(); pendingReply(); ordinary('start'); pcm(); ordinary('end');
    expect(context().sources).toHaveLength(2);
    context().sources.forEach(source => expect(source.stop).not.toHaveBeenCalled()); voice.stop();
  });

  it('silenciar no permite reanudar una generación antigua al activar el altavoz', async () => {
    const voice = await start(); ordinary('start'); pcm(); voice.muteSpeaker(true); voice.muteSpeaker(false);
    pcm(); ordinary('end'); ordinary('start'); pcm(); ordinary('end');
    expect(context().sources).toHaveLength(1); expect(context().sources[0].stop).toHaveBeenCalledOnce(); voice.stop();
  });

  it('separa audio ordinario de entrega verificada y conserva el acuse tras drenaje real', async () => {
    const voice = await start(); pendingReply(); speech('started', turnB); speech('ended', turnB);
    const delivered = (phase: 'start' | 'end') => control({ type: 'speech_delivery', phase,
      eventId: generationB, requestId: generationC });
    delivered('start'); pcm(); delivered('end'); pcm();
    expect(context().sources).toHaveLength(3); context().sources[2].onended?.();
    const acks = socket().send.mock.calls.map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.type === 'speech_ack');
    expect(acks).toEqual([{ type: 'speech_ack', eventId: generationB, outcome: 'played' }]); voice.stop();
  });

  it.each(['interleaved', 'mismatched-end', 'reassigned-id'] as const)('rechaza secuencias ambiguas: %s', async fault => {
    const error = vi.fn(); const voice = await start(vi.fn(), error); ordinary('start'); pcm();
    if (fault === 'interleaved') control({ type: 'speech_delivery', phase: 'start', eventId: generationB, requestId: generationC });
    else if (fault === 'mismatched-end') ordinary('end', generationB, turnA);
    else { ordinary('end'); ordinary('start', generationA, turnB); }
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', reason: 'protocol' }));
    expect(context().sources[0].stop).toHaveBeenCalledOnce(); voice.stop();
  });
});

describe('acuses de reproducción ordinaria', () => {
  it('confirma played una sola vez después de end y de todas las fuentes, nunca antes', async () => {
    const voice = await start(); pendingReply();
    expect(ordinaryAcks()).toEqual([]);
    context().sources[0].onended?.(); expect(ordinaryAcks()).toEqual([]);
    context().sources[1].onended?.(); context().sources[1].onended?.();
    expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome: 'played' }]);
    ordinary('start'); pcm(); ordinary('end'); voice.stop();
    expect(ordinaryAcks()).toHaveLength(1);
  });

  it('espera end aunque ya se hayan drenado las fuentes de audio', async () => {
    const voice = await start(); ordinary('start'); pcm(); context().sources[0].onended?.();
    expect(ordinaryAcks()).toEqual([]); ordinary('end');
    expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome: 'played' }]); voice.stop();
  });

  it.each(['barge-in', 'interrupted', 'mute', 'stop'] as const)('acusa %s como interrumpido e ignora onended tardíos', async action => {
    const voice = await start(); pendingReply(); const ended = context().sources.map(source => source.onended);
    if (action === 'barge-in') speech('started', turnB);
    else if (action === 'interrupted') control({ type: 'interrupted' });
    else if (action === 'mute') voice.muteSpeaker(true);
    else voice.stop();
    ended.forEach(callback => callback?.());
    expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome: 'interrupted' }]); voice.stop();
  });

  it.each(['empty', 'muted', 'stale', 'user-speaking'] as const)('no declara played cuando no reproduce: %s', async reason => {
    const voice = await start();
    if (reason === 'muted') voice.muteSpeaker(true);
    if (reason === 'stale' || reason === 'user-speaking') speech('started', turnB);
    if (reason === 'stale') speech('ended', turnB);
    ordinary('start'); if (reason !== 'empty') pcm(); ordinary('end');
    expect(context().sources).toHaveLength(0);
    expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome: 'interrupted' }]); voice.stop();
  });

  it('acusa una interrupción antes de end y no la duplica al cerrarlo o reenviarlo', async () => {
    const voice = await start(); ordinary('start'); pcm(); speech('started', turnB);
    expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome: 'interrupted' }]);
    pcm(); ordinary('end'); ordinary('start'); pcm(); ordinary('end');
    expect(ordinaryAcks()).toHaveLength(1); voice.stop();
  });
});

it('un aviso de audio limitado conserva micrófono/socket y permite la respuesta del siguiente turno', async () => {
  const voiceNotice = vi.fn(); const error = vi.fn(); const status = vi.fn();
  const voice = startLiveVoiceAudio({ ...callbacks(status, error), voiceNotice });
  resolveMedia!(stream()); await settle(); socket().accept();
  speech('started'); speech('ended'); final(turnA);
  const event = { type: 'voice_notice', turnId: turnA, reason: 'response_audio_limit' };
  control(event); expect(voiceNotice).toHaveBeenCalledWith(event);
  expect(error).not.toHaveBeenCalled(); expect(socket().close).not.toHaveBeenCalled();
  expect(track.stop).not.toHaveBeenCalled(); expect(context().close).not.toHaveBeenCalled();
  context().processor.frame([0.4, -0.4]);
  expect(socket().send.mock.calls.filter(([value]) => value instanceof ArrayBuffer)).toHaveLength(1);
  speech('started', turnB); speech('ended', turnB); final(turnB);
  ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
  expect(context().sources).toHaveLength(1); expect(status).toHaveBeenLastCalledWith('speaking');
  context().sources[0].onended?.();
  expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationB, outcome: 'played' }]);
  expect(status).toHaveBeenLastCalledWith('listening'); voice.stop();
});

it.each([
  { parts: [1, 1, 1, 1, 1, 1], outcome: 'interrupted' },
  { parts: [1199], outcome: 'interrupted' },
  { parts: [1200], outcome: 'played' },
  { parts: [1, 1, 1198], outcome: 'played' },
])('evalúa PCM total de la generación $parts sin filtrar frames pequeños', async ({ parts, outcome }) => {
  const voiceNotice = vi.fn(); const error = vi.fn();
  const voice = startLiveVoiceAudio({ ...callbacks(vi.fn(), error), voiceNotice });
  resolveMedia!(stream()); await settle(); socket().accept(); final(turnA);
  ordinary('start'); parts.forEach(size => pcm(size)); ordinary('end');
  expect(context().sources).toHaveLength(parts.length);
  expect(ordinaryAcks()).toEqual([]);
  context().sources.forEach(source => source.onended?.());
  expect(ordinaryAcks()).toEqual([{ type: 'ordinary_ack', generationId: generationA, outcome }]);
  if (outcome === 'interrupted') expect(voiceNotice).toHaveBeenCalledExactlyOnceWith({
    type: 'voice_notice', turnId: turnA, reason: 'response_audio_unavailable' });
  else expect(voiceNotice).not.toHaveBeenCalled();
  expect(track.stop).not.toHaveBeenCalled(); expect(socket().close).not.toHaveBeenCalled();
  context().processor.frame([0.3]);
  expect(socket().send.mock.calls.filter(([data]) => data instanceof ArrayBuffer)).toHaveLength(1);
  ordinary('start'); pcm(1); ordinary('end');
  expect(ordinaryAcks()).toHaveLength(1);
  speech('started', turnB); speech('ended', turnB); final(turnB);
  ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
  context().sources.at(-1)!.onended?.();
  expect(ordinaryAcks().at(-1)).toEqual({ type: 'ordinary_ack', generationId: generationB, outcome: 'played' });
  expect(error).not.toHaveBeenCalled(); voice.stop();
});

it('un onended tardío de audio insuficiente no avisa sobre el nuevo turno', async () => {
  const voiceNotice = vi.fn();
  const voice = startLiveVoiceAudio({ ...callbacks(), voiceNotice });
  resolveMedia!(stream()); await settle(); socket().accept(); final(turnA);
  ordinary('start'); pcm(1); ordinary('end'); const lateEnd = context().sources[0].onended;
  speech('started', turnB); speech('ended', turnB); final(turnB);
  ordinary('start', generationB, turnB); pcm(); ordinary('end', generationB, turnB);
  lateEnd?.(); context().sources[1].onended?.();
  expect(voiceNotice).not.toHaveBeenCalled();
  expect(ordinaryAcks()).toEqual([
    { type: 'ordinary_ack', generationId: generationA, outcome: 'interrupted' },
    { type: 'ordinary_ack', generationId: generationB, outcome: 'played' },
  ]);
  voice.stop();
});
