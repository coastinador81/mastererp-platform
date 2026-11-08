import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';

const ready = JSON.stringify({ type: 'status', state: 'ready',
  inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000' });

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
let rejectMedia: ((reason?: unknown) => void) | null;
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
  resolveMedia = null; rejectMedia = null;
  getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve, reject) => {
    resolveMedia = resolve; rejectMedia = reject;
  }));
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('AudioContext', Context);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('audio Live sin acciones de chat', () => {
  it('no abre nada al importar; captura PCM16 únicamente tras ready y detiene recursos al cerrar', async () => {
    expect(Socket.instances).toHaveLength(0);
    const status = vi.fn(); const error = vi.fn(); const bound = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(status, error), bound });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(0);
    resolveMedia!(stream()); await settle();
    expect(Socket.instances).toHaveLength(1);
    socket().accept();
    expect(bound).toHaveBeenCalledOnce();
    expect(context().sampleRate).toBe(16_000);
    expect(context().createScriptProcessor).toHaveBeenCalledExactlyOnceWith(512, 1, 1);
    expect(status).toHaveBeenCalledWith('listening');
    context().processor.frame([-1, 0, 1]);
    const sent = socket().send.mock.calls.at(-1)![0] as ArrayBuffer;
    expect(Array.from(new Int16Array(sent))).toEqual([-32768, 0, 32767]);
    voice.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context().close).toHaveBeenCalledOnce();
    expect(socket().close).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    context().processor.frame([1]);
    expect(socket().send).toHaveBeenCalledTimes(3);
  });

  it('envía tramas PCM16 de 32 ms dentro del tamaño admitido para Live', async () => {
    const voice = startLiveVoiceAudio(callbacks());
    resolveMedia!(stream()); await settle(); socket().accept();
    expect(context().sampleRate).toBe(16_000);
    expect(context().createScriptProcessor).toHaveBeenCalledExactlyOnceWith(512, 1, 1);
    context().processor.frame(Array(512).fill(0.5));
    const sent = socket().send.mock.calls.at(-1)![0] as ArrayBuffer;
    expect(sent.byteLength).toBe(1024);
    expect(new Int16Array(sent)[0]).toBe(16383);
    voice.stop();
  });

  it('silencia cada canal y vacía el audio pendiente al interrumpir', async () => {
    const status = vi.fn(); const error = vi.fn();
    const voice = startLiveVoiceAudio(callbacks(status, error));
    resolveMedia!(stream()); await settle(); socket().accept();
    voice.muteMicrophone(true);
    expect(track.enabled).toBe(false);
    context().processor.frame([0.5]);
    expect(socket().send).toHaveBeenCalledTimes(2);
    voice.muteMicrophone(false);
    context().processor.frame([0.5]);
    expect(socket().send).toHaveBeenCalledTimes(3);
    socket().receive(new Uint8Array([1, 0, 2, 0]).buffer);
    expect(context().sources).toHaveLength(1);
    socket().receive('{"type":"interrupted"}');
    expect(context().sources[0].stop).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith('interrupted');
    expect(error).not.toHaveBeenCalled();
    context().processor.frame([0.25]);
    expect(socket().send.mock.calls.filter(([value]) => value instanceof ArrayBuffer)).toHaveLength(2);
    voice.muteSpeaker(true);
    socket().receive(new Uint8Array([1, 0]).buffer);
    expect(context().sources).toHaveLength(1);
    voice.muteSpeaker(false);
    socket().receive(new Uint8Array([1, 0]).buffer);
    expect(context().sources).toHaveLength(1); // El audio del turno interrumpido no se reactiva.
    voice.stop();
    expect(error).not.toHaveBeenCalled();
  });

  it('el inicio de voz del cliente vacía el audio en cola sin esperar a interrupted', async () => {
    const status = vi.fn();
    const voice = startLiveVoiceAudio(callbacks(status));
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().receive(new Uint8Array([1, 0, 2, 0]).buffer);
    socket().receive(new Uint8Array([3, 0, 4, 0]).buffer);
    expect(context().sources).toHaveLength(2);
    expect(context().sources[1].start).toHaveBeenCalledWith(2 / 24_000);
    socket().receive('{"type":"speech_started"}');
    expect(context().sources[0].stop).toHaveBeenCalledOnce();
    expect(context().sources[1].stop).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith('interrupted');
    status.mockClear();
    socket().receive('{"type":"speech_started"}');
    expect(status).not.toHaveBeenCalledWith('interrupted');
    context().processor.frame([0.25]);
    expect(socket().send.mock.calls.filter(([value]) => value instanceof ArrayBuffer)).toHaveLength(1);
    voice.stop();
  });

  it('entrega el turno de voz persistido para refrescar el hilo sin reenviar el mensaje', async () => {
    const transcript = vi.fn();
    const voice = startLiveVoiceAudio(callbacks(vi.fn(), vi.fn(), transcript));
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().receive(JSON.stringify({ type: 'transcript', role: 'user', turnId: 'turn-1',
      text: 'Quiero crear Basic Mini Bricks', final: true }));
    expect(transcript).toHaveBeenCalledExactlyOnceWith({ type: 'transcript', role: 'user',
      turnId: 'turn-1', text: 'Quiero crear Basic Mini Bricks', final: true });
    expect(socket().send).toHaveBeenNthCalledWith(1, '{"type":"bind","threadId":"thread-one"}');
    expect(socket().send).toHaveBeenNthCalledWith(2, '{"type":"ready","sessionId":"session-one"}');
    voice.stop();
    socket().receive(JSON.stringify({ type: 'transcript', role: 'assistant', turnId: 'turn-1',
      text: 'Entendido', final: true }));
    expect(transcript).toHaveBeenCalledOnce();
  });

  it('entrega el traspaso del servidor sin crear una segunda petición desde el navegador', async () => {
    const handoff = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(), handoff });
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().receive(JSON.stringify({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
      requestId: 'request-one', status: 'queued' }));
    expect(handoff).toHaveBeenCalledExactlyOnceWith({ type: 'handoff', threadId: 'thread-one',
      turnId: 'voice-turn', requestId: 'request-one', status: 'queued' });
    expect(socket().send).toHaveBeenCalledTimes(2);
    voice.stop();
  });

  it('entrega el aviso de voz no verificada sin convertirlo en cambio de estado ni enviar otra acción', async () => {
    const actionUnconfirmed = vi.fn(); const status = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(status), actionUnconfirmed });
    resolveMedia!(stream()); await settle(); socket().accept();
    status.mockClear();
    socket().receive(JSON.stringify({ type: 'action_unconfirmed', threadId: 'thread-one',
      turnId: 'voice-turn', reason: 'transcript_not_verified' }));
    expect(actionUnconfirmed).toHaveBeenCalledExactlyOnceWith({ type: 'action_unconfirmed',
      threadId: 'thread-one', turnId: 'voice-turn', reason: 'transcript_not_verified' });
    expect(status).not.toHaveBeenCalled();
    expect(socket().send).toHaveBeenCalledTimes(2);
    voice.stop();
  });

  it('entrega previews y límites de un mismo turno, y avisa de interrupción', async () => {
    const preview = vi.fn(); const speechStarted = vi.fn(); const speechEnded = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(), preview, speechStarted, speechEnded });
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().receive(JSON.stringify({ type: 'transcript_preview', role: 'user', turnId: 'turn-1',
      text: 'Quiero crear' }));
    socket().receive(JSON.stringify({ type: 'transcript_preview', role: 'assistant', turnId: 'turn-1',
      text: 'Vamos a' }));
    expect(preview).toHaveBeenCalledTimes(2);
    socket().receive('{"type":"speech_started","turnId":"turn-1"}');
    socket().receive('{"type":"speech_ended","turnId":"turn-1"}');
    socket().receive('{"type":"interrupted"}');
    expect(speechStarted).toHaveBeenCalledTimes(2);
    expect(speechStarted).toHaveBeenNthCalledWith(1, 'turn-1', false);
    expect(speechEnded).toHaveBeenCalledExactlyOnceWith('turn-1');
    voice.stop();
  });

  it('informa si los subtítulos no están disponibles sin cortar la voz', async () => {
    const captionStatus = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(), captionStatus });
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().receive('{"type":"caption_status","state":"unavailable"}');
    expect(captionStatus).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(socket().close).not.toHaveBeenCalled();
    voice.stop();
  });

  it('un cierre del servidor falla sin reenviar texto ni reiniciar audio', async () => {
    const error = vi.fn();
    startLiveVoiceAudio(callbacks(vi.fn(), error));
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().onclose?.({ code: 1008, wasClean: false } as CloseEvent);
    expect(error).toHaveBeenCalledExactlyOnceWith({ type: 'closed', code: 1008, wasClean: false,
      phase: 'active', sentAudioFrames: 0, receivedAudioFrames: 0,
      transcriptEvents: 0, interruptionEvents: 0 });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context().close).toHaveBeenCalledOnce();
    socket().receive(new Uint8Array([2, 0]).buffer);
    expect(context().sources).toHaveLength(0);
  });

  it('conserva la causa de protocolo después de ready sin registrar audio ni texto', async () => {
    const error = vi.fn();
    startLiveVoiceAudio(callbacks(vi.fn(), error));
    resolveMedia!(stream()); await settle(); socket().accept();
    socket().receive('{"type":"evento-desconocido"}');
    expect(error).toHaveBeenCalledExactlyOnceWith({ type: 'error', reason: 'protocol',
      phase: 'active', sentAudioFrames: 0, receivedAudioFrames: 0,
      transcriptEvents: 0, interruptionEvents: 0 });
  });

  it('detenerse antes de bound no confirma la apertura de Vertex', async () => {
    const voice = startLiveVoiceAudio(callbacks());
    resolveMedia!(stream()); await settle();
    socket().readyState = 1;
    socket().onopen?.();
    voice.stop();
    socket().receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    expect(socket().send).toHaveBeenCalledExactlyOnceWith('{"type":"bind","threadId":"thread-one"}');
  });

  it('cambiar de hilo durante bound cierra el socket sin confirmar Vertex', async () => {
    let sameThread = true;
    const bound = vi.fn(() => { sameThread = false; });
    startLiveVoiceAudio({ ...callbacks(), valid: () => sameThread, bound });
    resolveMedia!(stream()); await settle();
    socket().accept();
    expect(bound).toHaveBeenCalledOnce();
    expect(socket().send).toHaveBeenCalledExactlyOnceWith('{"type":"bind","threadId":"thread-one"}');
    expect(socket().close).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('si cambia la identidad antes del permiso libera el micrófono tardío', async () => {
    let sameIdentity = true;
    const error = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(vi.fn(), error), valid: () => sameIdentity });
    expect(Socket.instances).toHaveLength(0);
    sameIdentity = false;
    resolveMedia!(stream()); await settle();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.instances).toHaveLength(0);
    expect(Socket.instances).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    voice.stop();
  });

  it('denegar el micrófono no abre WebSocket ni crea AudioContext', async () => {
    const error = vi.fn();
    startLiveVoiceAudio(callbacks(vi.fn(), error));
    rejectMedia!(new DOMException('Denegado', 'NotAllowedError'));
    await settle();
    expect(Socket.instances).toHaveLength(0);
    expect(Context.instances).toHaveLength(0);
    expect(error).toHaveBeenCalledOnce();
  });

  it('detener durante el permiso libera tracks tardíos sin abrir WebSocket', async () => {
    const error = vi.fn();
    const voice = startLiveVoiceAudio(callbacks(vi.fn(), error));
    voice.stop();
    resolveMedia!(stream()); await settle();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.instances).toHaveLength(0);
    expect(Socket.instances).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it('un fallo al reanudar AudioContext cierra los recursos sin abrir WebSocket', async () => {
    Context.resumePlan = async () => { throw new Error('Audio bloqueado'); };
    const error = vi.fn();
    startLiveVoiceAudio(callbacks(vi.fn(), error));
    resolveMedia!(stream()); await settle();
    expect(context().resume).toHaveBeenCalledOnce();
    expect(context().close).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(0);
    expect(error).toHaveBeenCalledOnce();
  });

  it('detener mientras resume AudioContext no abre WebSocket tras la espera', async () => {
    let finishResume: (() => void) | null = null;
    Context.resumePlan = () => new Promise<void>(resolve => { finishResume = resolve; });
    const error = vi.fn();
    const voice = startLiveVoiceAudio(callbacks(vi.fn(), error));
    resolveMedia!(stream()); await settle();
    expect(Socket.instances).toHaveLength(0);
    voice.stop();
    finishResume!(); await settle();
    expect(context().close).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });
});

const deliveredId = '11111111-1111-4111-8111-111111111111';
const deliveredRequest = '22222222-2222-4222-8222-222222222222';
const envelope = (phase: 'start' | 'end', eventId = deliveredId) => socket().receive(JSON.stringify({
  type: 'speech_delivery', eventId, requestId: deliveredRequest, phase,
}));
const pcm = () => socket().receive(new Uint8Array([1, 0, 2, 0]).buffer);
const acknowledgements = () => socket().send.mock.calls.map(([data]) => typeof data === 'string' ? JSON.parse(data) : null)
  .filter(value => value?.type === 'speech_ack');
const openVoice = async () => {
  const voice = startLiveVoiceAudio(callbacks());
  resolveMedia!(stream()); await settle(); socket().accept(); return voice;
};

describe('recibo de reproducción verificada', () => {
  it('no confirma al recibir PCM ni end: espera a todos los onended del envelope', async () => {
    const voice = await openVoice();
    envelope('start'); pcm(); pcm(); envelope('end');
    expect(acknowledgements()).toEqual([]);
    context().sources[0].onended?.();
    expect(acknowledgements()).toEqual([]);
    context().sources[1].onended?.();
    expect(acknowledgements()).toEqual([{ type: 'speech_ack', eventId: deliveredId, outcome: 'played' }]);
    voice.stop(); expect(acknowledgements()).toHaveLength(1);
  });
  it('avisa de la voz audible con el primer PCM verificado, no al abrir el envío', async () => {
    const speechAudible = vi.fn();
    const voice = startLiveVoiceAudio({ ...callbacks(), speechAudible });
    resolveMedia!(stream()); await settle(); socket().accept();
    envelope('start'); expect(speechAudible).not.toHaveBeenCalled();
    pcm(); pcm(); envelope('end');
    expect(speechAudible).toHaveBeenCalledExactlyOnceWith(deliveredRequest); voice.stop();
  });
  it('espera end aunque ya haya terminado el audio', async () => {
    const voice = await openVoice();
    envelope('start'); pcm(); context().sources[0].onended?.();
    expect(acknowledgements()).toEqual([]);
    envelope('end'); expect(acknowledgements()[0].outcome).toBe('played'); voice.stop();
  });
  it.each(['mute', 'barge-in', 'interrupted', 'stop'] as const)('registra %s como interrumpido, nunca reproducido', async action => {
    const voice = await openVoice();
    envelope('start'); pcm(); envelope('end');
    const lateEnded = context().sources[0].onended;
    if (action === 'mute') voice.muteSpeaker(true);
    else if (action === 'stop') voice.stop();
    else socket().receive(JSON.stringify({ type: action === 'barge-in' ? 'speech_started' : 'interrupted' }));
    lateEnded?.();
    expect(acknowledgements()).toEqual([{ type: 'speech_ack', eventId: deliveredId, outcome: 'interrupted' }]);
    expect(context().sources[0].stop).toHaveBeenCalledOnce(); voice.stop();
  });
  it('silenciar a mitad descarta el resto del envelope aunque se vuelva a activar el altavoz', async () => {
    const voice = await openVoice();
    envelope('start'); pcm(); voice.muteSpeaker(true); voice.muteSpeaker(false); pcm(); envelope('end');
    expect(context().sources).toHaveLength(1);
    pcm(); expect(context().sources).toHaveLength(2);
    expect(acknowledgements()[0].outcome).toBe('interrupted'); voice.stop();
  });
  it.each([false, true])('sin audio reproducido nunca confirma played (muted=%s)', async muted => {
    const voice = await openVoice(); voice.muteSpeaker(muted);
    envelope('start'); if (muted) pcm(); envelope('end');
    expect(context().sources).toHaveLength(0);
    expect(acknowledgements()).toEqual([{ type: 'speech_ack', eventId: deliveredId, outcome: 'interrupted' }]);
    voice.stop();
  });
  it('un envelope duplicado no vuelve a sonar ni corta el original pendiente', async () => {
    const voice = await openVoice();
    envelope('start'); pcm(); envelope('end');
    envelope('start'); pcm(); envelope('end');
    expect(context().sources).toHaveLength(1);
    expect(context().sources[0].stop).not.toHaveBeenCalled();
    context().sources[0].onended?.();
    envelope('start'); pcm(); envelope('end');
    expect(context().sources).toHaveLength(1);
    pcm(); expect(context().sources).toHaveLength(2);
    expect(acknowledgements()).toEqual([{ type: 'speech_ack', eventId: deliveredId, outcome: 'played' }]);
    voice.stop();
  });
  it('una nueva entrega vacía la anterior y confirma cada resultado por separado', async () => {
    const voice = await openVoice(); const nextId = '33333333-3333-4333-8333-333333333333';
    envelope('start'); pcm(); envelope('end');
    envelope('start', nextId); pcm(); envelope('end', nextId);
    expect(context().sources[0].stop).toHaveBeenCalledOnce();
    expect(acknowledgements()).toEqual([{ type: 'speech_ack', eventId: deliveredId, outcome: 'interrupted' }]);
    context().sources[1].onended?.();
    expect(acknowledgements()[1]).toEqual({ type: 'speech_ack', eventId: nextId, outcome: 'played' }); voice.stop();
  });
  it('acota el historial a los últimos256 identificadores de entrega', async () => {
    const voice = await openVoice();
    for (let n = 0; n < 257; n++) {
      const id = `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
      envelope('start', id); envelope('end', id);
    }
    expect(acknowledgements()).toHaveLength(257);
    envelope('start', '11111111-1111-4111-8111-000000000256');
    envelope('end', '11111111-1111-4111-8111-000000000256');
    expect(acknowledgements()).toHaveLength(257);
    envelope('start', '11111111-1111-4111-8111-000000000000');
    envelope('end', '11111111-1111-4111-8111-000000000000');
    expect(acknowledgements()).toHaveLength(258); voice.stop();
  });
});


describe('estado de voz durante la entrega verificada', () => {
  it('informa reproducción real una vez por transición y libera al drenar, silenciar o detener', async () => {
    const voice = await openVoice();
    const states = () => socket().send.mock.calls.map(([value]) => typeof value === 'string' ? JSON.parse(value) : null)
      .filter(value => value?.type === 'playback_state').map(value => value.state);
    pcm(); pcm(); expect(states()).toEqual(['playing']);
    context().sources[0].onended?.(); expect(states()).toEqual(['playing']);
    context().sources[1].onended?.(); context().sources[1].onended?.();
    expect(states()).toEqual(['playing', 'idle']);
    pcm(); const lateEnded = context().sources[2].onended;
    voice.muteSpeaker(true); lateEnded?.(); pcm();
    expect(states()).toEqual(['playing', 'idle', 'playing', 'idle']);
    voice.muteSpeaker(false); pcm(); voice.stop(); voice.stop();
    expect(states()).toEqual(['playing', 'idle', 'playing', 'idle', 'playing', 'idle']);
  });
  it('habla al primer PCM y escucha solo tras drenar el audio, sin cambiar el diseño', async () => {
    const status = vi.fn(); const voice = startLiveVoiceAudio(callbacks(status));
    resolveMedia!(stream()); await settle(); socket().accept(); status.mockClear();
    envelope('start'); expect(status).not.toHaveBeenCalled();
    pcm(); pcm(); envelope('end');
    socket().receive('{"type":"status","state":"listening"}');
    expect(status).toHaveBeenCalledExactlyOnceWith('speaking');
    context().sources[0].onended?.(); expect(status).toHaveBeenCalledTimes(1);
    context().sources[1].onended?.(); expect(status).toHaveBeenLastCalledWith('listening'); voice.stop();
  });
  it('no cambia a speaking si el altavoz está silenciado ni vuelve a listening tras interrupción', async () => {
    const status = vi.fn(); const voice = startLiveVoiceAudio(callbacks(status));
    resolveMedia!(stream()); await settle(); socket().accept(); status.mockClear();
    voice.muteSpeaker(true); envelope('start'); pcm(); envelope('end');
    expect(status).not.toHaveBeenCalled(); voice.muteSpeaker(false);
    const nextId = '33333333-3333-4333-8333-333333333333';
    envelope('start', nextId); pcm(); envelope('end', nextId);
    const lateEnded = context().sources[0].onended;
    socket().receive('{"type":"speech_started"}'); status.mockClear(); lateEnded?.();
    expect(status).not.toHaveBeenCalled(); voice.stop();
  });
});
