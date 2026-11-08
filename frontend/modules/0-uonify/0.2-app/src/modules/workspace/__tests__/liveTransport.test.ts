import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectLiveTransport, type LiveTransportEvent } from '../api/liveTransport';

const ready = JSON.stringify({ type: 'status', state: 'ready',
  inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000' });

class FakeSocket {
  static sockets: FakeSocket[] = [];
  binaryType: BinaryType = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({ code: 1000, wasClean: true } as CloseEvent);
  });
  constructor(readonly url: string) { FakeSocket.sockets.push(this); }
  receive(data: string | ArrayBuffer): void { this.onmessage?.({ data } as MessageEvent); }
  accept(): void {
    this.readyState = 1;
    this.onopen?.();
    this.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    this.receive(ready);
  }
}

function fixture() {
  const events: LiveTransportEvent[] = [];
  const transport = connectLiveTransport('thread-one', event => events.push(event),
    url => new FakeSocket(url) as unknown as WebSocket);
  return { transport, socket: FakeSocket.sockets.at(-1)!, events };
}

describe('protocolo de audio ordinario scoped-v1', () => {
  const generationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const replyToTurnId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  it('negocia scoped-v1 y conserva la identidad y el turno en start/end', () => {
    const { transport, socket, events } = fixture(); socket.readyState = 1; socket.onopen?.();
    socket.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    socket.receive(JSON.stringify({ ...JSON.parse(ready), audioProtocol: 'scoped-v1' }));
    expect(events.at(-1)).toEqual({ type: 'status', state: 'ready', audioProtocol: 'scoped-v1' });
    for (const turn of [replyToTurnId, null]) for (const phase of ['start', 'end']) {
      const event = { type: 'ordinary_audio', phase, generationId, replyToTurnId: turn };
      socket.receive(JSON.stringify(event)); expect(events.at(-1)).toEqual(event);
    }
    expect(transport.state).toBe('ready'); transport.close();
  });
  it('rechaza marcadores ambiguos, IDs inválidos y una versión desconocida', () => {
    for (const changes of [{ generationId: 'inventado' }, { replyToTurnId: 'otro' },
      { phase: 'done' }, { text: 'extra' }, { replyToTurnId: undefined }]) {
      const { socket, transport, events } = fixture(); socket.accept();
      socket.receive(JSON.stringify({ type: 'ordinary_audio', phase: 'start', generationId, replyToTurnId, ...changes }));
      expect(transport.state).toBe('closed'); expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
    }
    const { socket, transport } = fixture(); socket.readyState = 1; socket.onopen?.();
    socket.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    socket.receive(JSON.stringify({ ...JSON.parse(ready), audioProtocol: 'unknown' }));
    expect(transport.state).toBe('closed');
  });
  it('envía el acuse ordinary solo con generación válida y sesión abierta', () => {
    const { socket, transport } = fixture();
    expect(transport.acknowledgeOrdinary(generationId, 'played')).toBe(false); socket.accept();
    expect(() => transport.acknowledgeOrdinary('inventado', 'played')).toThrow(RangeError);
    expect(transport.acknowledgeOrdinary(generationId, 'played')).toBe(true);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'ordinary_ack', generationId, outcome: 'played' }));
    transport.interrupt(); expect(transport.acknowledgeOrdinary(generationId, 'played')).toBe(false);
    expect(transport.acknowledgeOrdinary(generationId, 'interrupted')).toBe(true);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'ordinary_ack', generationId, outcome: 'interrupted' }));
    transport.close(); expect(transport.acknowledgeOrdinary(generationId, 'interrupted')).toBe(false);
  });
});

beforeEach(() => { FakeSocket.sockets = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('transporte Live aislado', () => {
  it('abre solo al llamarlo y usa el origen propio sin query ni credenciales', () => {
    expect(FakeSocket.sockets).toHaveLength(0);
    const { transport, socket, events } = fixture();
    const url = new URL(socket.url);
    expect(url.protocol).toBe(window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe('/api/uony/live');
    expect(url.search).toBe('');
    expect(socket.binaryType).toBe('arraybuffer');
    expect(transport.state).toBe('connecting');
    expect(transport.sendAudio(new Uint8Array(2))).toBe(false);
    socket.accept();
    expect(transport.state).toBe('ready');
    expect(socket.send).toHaveBeenCalledWith('{"type":"bind","threadId":"thread-one"}');
    expect(socket.send).toHaveBeenCalledWith('{"type":"ready","sessionId":"session-one"}');
    expect(events).toEqual([{ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' },
      { type: 'status', state: 'ready' }]);
  });

  it('vincula el proyecto Uonify elegido y distingue un hilo sin proyecto', () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    connectLiveTransport('thread-one', () => {},
      url => new FakeSocket(url) as unknown as WebSocket, projectId);
    const projectSocket = FakeSocket.sockets.at(-1)!;
    projectSocket.accept();
    expect(projectSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'bind', threadId: 'thread-one', projectId }));
    connectLiveTransport('thread-one', () => {},
      url => new FakeSocket(url) as unknown as WebSocket, null);
    const ungroupedSocket = FakeSocket.sockets.at(-1)!;
    ungroupedSocket.accept();
    expect(ungroupedSocket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'bind', threadId: 'thread-one', projectId: null }));
  });

  it('envía únicamente tramas PCM pares y el control explícito de interrupción', () => {
    const { transport, socket } = fixture();
    socket.accept();
    const pcm = new Uint8Array([1, 2, 3, 4]);
    expect(transport.sendAudio(pcm)).toBe(true);
    expect(new Uint8Array(socket.send.mock.calls[2][0] as ArrayBuffer)).toEqual(pcm);
    expect(transport.interrupt()).toBe(true);
    expect(socket.send).toHaveBeenNthCalledWith(4, '{"type":"interrupt"}');
    expect(transport.interrupt()).toBe(false);
    expect(transport.sendAudio(new Uint8Array(2))).toBe(false);
    expect(socket.send).toHaveBeenCalledTimes(4);
  });

  it('rechaza tramas inválidas y un fallo de envío cierra la sesión', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    expect(() => transport.sendAudio(new Uint8Array(3))).toThrow(RangeError);
    expect(() => transport.sendAudio(new Uint8Array(8194))).toThrow(RangeError);
    socket.send.mockImplementationOnce(() => { throw new Error('socket cerrado'); });
    expect(transport.sendAudio(new Uint8Array(2))).toBe(false);
    expect(events).toContainEqual({ type: 'error', reason: 'connection' });
    expect(transport.state).toBe('closed');
  });

  it('entrega audio y la señal de interrupción al futuro reproductor', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'status', state: 'speaking' }));
    socket.receive(new Uint8Array([3, 0, 4, 0]).buffer);
    socket.receive('{"type":"speech_started"}');
    socket.receive('{"type":"interrupted"}');
    expect(events).toEqual([
      { type: 'bound', threadId: 'thread-one', sessionId: 'session-one' },
      { type: 'status', state: 'ready' },
      { type: 'status', state: 'speaking' },
      { type: 'audio', pcm: new Uint8Array([3, 0, 4, 0]) },
      { type: 'speech_started' },
      { type: 'interrupted' },
    ]);
    expect(transport.state).toBe('ready');
  });

  it('recibe el traspaso de un turno a un trabajo persistido sin reenviar el texto por el socket', () => {
    const { socket, events } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
      requestId: 'request-one', status: 'queued' }));
    expect(events.at(-1)).toEqual({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
      requestId: 'request-one', status: 'queued' });
    socket.receive(JSON.stringify({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
      requestId: 'request-one', status: 'cancelled' }));
    expect(events.at(-1)).toEqual({ type: 'handoff', threadId: 'thread-one', turnId: 'voice-turn',
      requestId: 'request-one', status: 'cancelled' });
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it('rechaza un traspaso dirigido a otro hilo antes de mostrarlo', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'handoff', threadId: 'other-thread', turnId: 'voice-turn',
      requestId: 'request-one', status: 'queued' }));
    expect(transport.state).toBe('closed');
    expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
    expect(events.some(event => event.type === 'handoff')).toBe(false);
  });

  it('acepta solo el aviso de orden no verificada del hilo vinculado', () => {
    const accepted = fixture();
    accepted.socket.accept();
    accepted.socket.receive(JSON.stringify({ type: 'action_unconfirmed', threadId: 'thread-one',
      turnId: 'voice-turn', reason: 'transcript_not_verified' }));
    expect(accepted.events.at(-1)).toEqual({ type: 'action_unconfirmed', threadId: 'thread-one',
      turnId: 'voice-turn', reason: 'transcript_not_verified' });
    expect(accepted.socket.send).toHaveBeenCalledTimes(2);

    for (const invalid of [
      { type: 'action_unconfirmed', threadId: 'other-thread', turnId: 'voice-turn', reason: 'transcript_not_verified' },
      { type: 'action_unconfirmed', threadId: 'thread-one', turnId: 'voice-turn', reason: 'other' },
      { type: 'action_unconfirmed', threadId: 'thread-one', turnId: 'voice-turn', reason: 'transcript_not_verified', text: 'extra' },
    ]) {
      const item = fixture();
      item.socket.accept();
      item.socket.receive(JSON.stringify(invalid));
      expect(item.transport.state).toBe('closed');
      expect(item.events).toContainEqual({ type: 'error', reason: 'protocol' });
      expect(item.events.some(event => event.type === 'action_unconfirmed')).toBe(false);
    }
  });

  it('acepta únicamente transcripciones finales del hilo vinculado', () => {
    const { transport, socket, events } = fixture();
    socket.readyState = 1;
    socket.onopen?.();
    expect(socket.send).toHaveBeenCalledExactlyOnceWith('{"type":"bind","threadId":"thread-one"}');
    socket.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    socket.receive(ready);
    socket.receive(JSON.stringify({ type: 'transcript', role: 'user', turnId: 'turn-1',
      text: 'Quiero preparar Basic Mini Bricks', final: true }));
    socket.receive(JSON.stringify({ type: 'transcript', role: 'assistant', turnId: 'turn-1',
      text: '¿Partimos de tus materiales o de cero?', final: true }));
    expect(events.filter(event => event.type === 'transcript')).toEqual([
      { type: 'transcript', role: 'user', turnId: 'turn-1', text: 'Quiero preparar Basic Mini Bricks', final: true },
      { type: 'transcript', role: 'assistant', turnId: 'turn-1', text: '¿Partimos de tus materiales o de cero?', final: true },
    ]);
    expect(transport.state).toBe('ready');
  });

  it('entrega transcripción provisional y retirada sin convertirlas en final', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'transcript_preview', role: 'user', turnId: 'turn-1', text: 'Necesito' }));
    socket.receive(JSON.stringify({ type: 'transcript_preview', role: 'user', turnId: 'turn-1', text: 'Necesito un producto' }));
    socket.receive(JSON.stringify({ type: 'transcript_preview', role: 'user', turnId: 'turn-1', text: '' }));
    expect(events.filter(event => event.type === 'transcript_preview')).toEqual([
      { type: 'transcript_preview', role: 'user', turnId: 'turn-1', text: 'Necesito' },
      { type: 'transcript_preview', role: 'user', turnId: 'turn-1', text: 'Necesito un producto' },
      { type: 'transcript_preview', role: 'user', turnId: 'turn-1', text: '' },
    ]);
    expect(transport.state).toBe('ready');
  });

  it('ordena los límites VAD con el mismo identificador del turno de usuario', () => {
    const { socket, events, transport } = fixture();
    socket.accept();
    socket.receive('{"type":"speech_started","turnId":"voice-1"}');
    socket.receive('{"type":"speech_ended","turnId":"voice-1"}');
    expect(events.slice(-2)).toEqual([
      { type: 'speech_started', turnId: 'voice-1' },
      { type: 'speech_ended', turnId: 'voice-1' },
    ]);
    expect(transport.state).toBe('ready');
  });

  it('conserva el vínculo explícito de una respuesta tardía sin adivinar el último turno', () => {
    const { socket, events, transport } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'transcript_preview', role: 'assistant', turnId: 'a1',
      replyToTurnId: 'u1', text: 'Voy con la primera' }));
    socket.receive(JSON.stringify({ type: 'transcript', role: 'assistant', turnId: 'a1',
      replyToTurnId: 'u1', text: 'Primera lista', final: true }));
    expect(events.slice(-2)).toEqual([
      { type: 'transcript_preview', role: 'assistant', turnId: 'a1', replyToTurnId: 'u1', text: 'Voy con la primera' },
      { type: 'transcript', role: 'assistant', turnId: 'a1', replyToTurnId: 'u1', text: 'Primera lista', final: true },
    ]);
    expect(transport.state).toBe('ready');
  });

  it('recibe el estado informativo de subtítulos sin alterar la sesión Live', () => {
    const { socket, events, transport } = fixture();
    socket.accept();
    socket.receive('{"type":"caption_status","state":"unavailable"}');
    socket.receive('{"type":"caption_status","state":"ready"}');
    expect(events.slice(-2)).toEqual([
      { type: 'caption_status', state: 'unavailable' }, { type: 'caption_status', state: 'ready' },
    ]);
    expect(transport.state).toBe('ready');
  });

  it('rechaza transcripción provisional con campos extra', () => {
    const { socket, events, transport } = fixture();
    socket.accept();
    socket.receive(JSON.stringify({ type: 'transcript_preview', role: 'user', turnId: 'turn-1',
      text: 'Prueba', final: false }));
    expect(transport.state).toBe('closed');
    expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
  });

  it('rechaza un hilo distinto, un ready sin bind y transcripciones parciales', () => {
    const unbound = fixture();
    unbound.socket.readyState = 1;
    unbound.socket.onopen?.();
    unbound.socket.receive(ready);
    expect(unbound.transport.state).toBe('closed');
    const wrong = fixture();
    wrong.socket.readyState = 1;
    wrong.socket.onopen?.();
    wrong.socket.receive(JSON.stringify({ type: 'bound', threadId: 'other-thread', sessionId: 'session-one' }));
    expect(wrong.transport.state).toBe('closed');
    const partial = fixture();
    partial.socket.accept();
    partial.socket.receive(JSON.stringify({ type: 'transcript', role: 'user', turnId: 'turn-1',
      text: 'frase a medias', final: false }));
    expect(partial.transport.state).toBe('closed');
    expect(partial.events).toContainEqual({ type: 'error', reason: 'protocol' });
  });

  it('rechaza eventos antes de ready, formatos inesperados y audio inválido', () => {
    const early = fixture();
    early.socket.receive('{"type":"status","state":"speaking"}');
    expect(early.transport.state).toBe('closed');
    expect(early.events).toContainEqual({ type: 'error', reason: 'protocol' });

    const wrong = fixture();
    wrong.socket.readyState = 1;
    wrong.socket.receive(JSON.stringify({ type: 'status', state: 'ready',
      inputFormat: 'audio/webm', outputFormat: 'pcm_s16le_24000' }));
    expect(wrong.transport.state).toBe('closed');

    const odd = fixture();
    odd.socket.accept();
    odd.socket.receive(new Uint8Array(3).buffer);
    expect(odd.events).toContainEqual({ type: 'error', reason: 'protocol' });
    expect(odd.socket.close).toHaveBeenCalledOnce();
  });

  it('corta ante contrapresión y no descarta audio sin avisar', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    socket.bufferedAmount = 64 * 1024;
    expect(transport.sendAudio(new Uint8Array(2))).toBe(false);
    expect(events).toContainEqual({ type: 'error', reason: 'backpressure' });
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(transport.state).toBe('closed');
  });

  it('acota el audio de entrada y cancela el arranque sin ready', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    for (let i = 0; i < 1875; i++) expect(transport.sendAudio(new Uint8Array(8192))).toBe(true);
    expect(transport.sendAudio(new Uint8Array(8192))).toBe(false);
    expect(events).toContainEqual({ type: 'error', reason: 'limit' });
    expect(socket.send).toHaveBeenCalledTimes(1877);

    const stalled = fixture();
    vi.advanceTimersByTime(15_000);
    expect(stalled.events).toContainEqual({ type: 'error', reason: 'timeout' });
    expect(stalled.transport.state).toBe('closed');
    expect(stalled.socket.close).toHaveBeenCalledOnce();
  });

  it('permite hasta ocho minutos de PCM de salida y rechaza el exceso', () => {
    const events: LiveTransportEvent[] = [];
    const transport = connectLiveTransport('thread-one', event => {
      if (event.type !== 'audio') events.push(event);
    }, url => new FakeSocket(url) as unknown as WebSocket);
    const socket = FakeSocket.sockets.at(-1)!;
    socket.accept();
    const fullFrame = new Uint8Array(8192).buffer;
    for (let i = 0; i < 2812; i++) socket.receive(fullFrame);
    socket.receive(new Uint8Array(4096).buffer);
    expect(transport.state).toBe('ready');
    socket.receive(new Uint8Array(2).buffer);
    expect(events).toContainEqual({ type: 'error', reason: 'limit' });
    expect(transport.state).toBe('closed');
  });

  it('detiene la sesión y evita envíos o eventos de audio tardíos', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    transport.close();
    expect(transport.state).toBe('closed');
    expect(transport.interrupt()).toBe(false);
    expect(transport.sendAudio(new Uint8Array(2))).toBe(false);
    socket.receive(new Uint8Array(2).buffer);
    expect(events).toEqual([{ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' },
      { type: 'status', state: 'ready' },
      { type: 'closed', code: 1000, wasClean: true }]);
  });

  it('detenerse al recibir bound impide confirmar la apertura de Vertex', () => {
    const transport = connectLiveTransport('thread-one', event => {
      if (event.type === 'bound') transport.close();
    }, url => new FakeSocket(url) as unknown as WebSocket);
    const socket = FakeSocket.sockets.at(-1)!;
    socket.readyState = 1;
    socket.onopen?.();
    socket.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    expect(transport.state).toBe('closed');
    expect(socket.send).toHaveBeenCalledExactlyOnceWith('{"type":"bind","threadId":"thread-one"}');
  });

  it('al detener manualmente vacía la salida e ignora audio ya en vuelo', () => {
    const { transport, socket, events } = fixture();
    socket.accept();
    socket.receive(new Uint8Array([1, 0]).buffer);
    expect(transport.interrupt()).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'interrupted' });
    socket.receive(JSON.stringify({ type: 'status', state: 'speaking' }));
    socket.receive(new Uint8Array([2, 0]).buffer);
    socket.receive('{"type":"interrupted"}');
    socket.receive('respuesta tardía no válida');
    socket.receive(new Uint8Array(3).buffer);
    expect(events.filter(event => event.type === 'audio')).toHaveLength(1);
    expect(events.filter(event => event.type === 'interrupted')).toHaveLength(1);
    expect(events.filter(event => event.type === 'error')).toHaveLength(0);
    socket.onerror?.();
    expect(transport.state).toBe('closed');
    expect(events.filter(event => event.type === 'error')).toHaveLength(0);
    expect(transport.sendAudio(new Uint8Array(2))).toBe(false);
  });

  it('cierra el socket aunque el consumidor lance al recibir un error', () => {
    const callback = vi.fn((event: LiveTransportEvent) => {
      if (event.type === 'error') throw new Error('Vista retirada');
    });
    const transport = connectLiveTransport('thread-one', callback,
      url => new FakeSocket(url) as unknown as WebSocket);
    const socket = FakeSocket.sockets.at(-1)!;
    socket.receive('{"type":"status","state":"speaking"}');
    expect(transport.state).toBe('closed');
    expect(socket.close).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({ type: 'error', reason: 'protocol' });
  });
});

describe('transporte de entrega verificada', () => {
  const eventId = '11111111-1111-4111-8111-111111111111';
  const requestId = '22222222-2222-4222-8222-222222222222';
  it('deduplica cambios de reproducción y permite cerrar en idle sin envíos tardíos', () => {
    const { socket, transport } = fixture();
    expect(transport.reportPlayback('playing')).toBe(false); socket.accept(); socket.send.mockClear();
    for (const state of ['idle', 'playing', 'playing', 'idle', 'idle'] as const) {
      expect(transport.reportPlayback(state)).toBe(true);
    }
    expect(socket.send.mock.calls.map(([value]) => JSON.parse(value as string))).toEqual([
      { type: 'playback_state', state: 'playing' }, { type: 'playback_state', state: 'idle' },
    ]);
    transport.reportPlayback('playing'); transport.interrupt();
    expect(transport.reportPlayback('playing')).toBe(false);
    expect(transport.reportPlayback('idle')).toBe(true);
    transport.close(); const count = socket.send.mock.calls.length;
    expect(transport.reportPlayback('idle')).toBe(false); expect(socket.send).toHaveBeenCalledTimes(count);
  });
  it('acepta start/end y envía un acuse sin texto ni segunda operación', () => {
    const { socket, transport, events } = fixture();
    expect(transport.acknowledgeSpeech(eventId, 'played')).toBe(false); socket.accept();
    for (const phase of ['start', 'end'] as const) {
      const event = { type: 'speech_delivery', eventId, requestId, phase };
      socket.receive(JSON.stringify(event)); expect(events.at(-1)).toEqual(event);
    }
    expect(transport.acknowledgeSpeech(eventId, 'played')).toBe(true);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'speech_ack', eventId, outcome: 'played' }));
    transport.close(); expect(transport.acknowledgeSpeech(eventId, 'interrupted')).toBe(false);
  });
  it('rechaza identificadores, campos extra y fases inválidas', () => {
    for (const changes of [{ eventId: 'inventado' }, { requestId: 'otro' }, { phase: 'done' }, { text: 'extra' }]) {
      const { socket, transport, events } = fixture(); socket.accept();
      socket.receive(JSON.stringify({ type: 'speech_delivery', eventId, requestId, phase: 'start', ...changes }));
      expect(transport.state).toBe('closed'); expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
    }
  });
  it('no declara played después de la interrupción manual pero permite notificar interrupted', () => {
    const { socket, transport } = fixture(); socket.accept(); transport.interrupt();
    expect(transport.acknowledgeSpeech(eventId, 'played')).toBe(false);
    expect(transport.acknowledgeSpeech(eventId, 'interrupted')).toBe(true);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'speech_ack', eventId, outcome: 'interrupted' }));
  });
});

it('acepta solo avisos recuperables con turno y motivo válidos sin cerrar el transporte', () => {
  const event = { type: 'voice_notice', turnId: '11111111-1111-4111-8111-111111111111', reason: 'response_audio_limit' };
  const { socket, transport, events } = fixture(); socket.accept();
  socket.receive(JSON.stringify(event)); expect(events.at(-1)).toEqual(event);
  expect(transport.state).toBe('ready'); expect(socket.close).not.toHaveBeenCalled(); transport.close();
  for (const changes of [{ reason: 'unknown' }, { turnId: 'invalid' }, { extra: true }, { turnId: undefined }]) {
    const invalid = fixture(); invalid.socket.accept(); invalid.socket.receive(JSON.stringify({ ...event, ...changes }));
    expect(invalid.events).toContainEqual({ type: 'error', reason: 'protocol' });
    expect(invalid.transport.state).toBe('closed');
  }
});
