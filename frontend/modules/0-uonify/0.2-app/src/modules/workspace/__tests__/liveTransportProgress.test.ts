import { expect, it, vi } from 'vitest';
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

it('acepta progreso correlacionado y propósito declarado por el servidor', () => {
  const { socket, transport, events } = fixture(); socket.accept();
  const packets = [
    { type: 'turn_progress', threadId: 'thread-one', turnId: 'turn-one', phase: 'interpreting' },
    { type: 'turn_progress', threadId: 'thread-one', turnId: 'turn-one', phase: 'settled' },
    { type: 'handoff', threadId: 'thread-one', turnId: 'turn-one', requestId: 'request-one', status: 'running', intent: 'drive_count' },
    { type: 'speech_progress', threadId: 'thread-one', turnId: 'turn-one', requestId: 'request-one', phase: 'preparing' },
    { type: 'speech_progress', threadId: 'thread-one', turnId: 'turn-one', requestId: 'request-one',
      phase: 'failed', reason: 'narration_unavailable' },
    { type: 'speech_progress', threadId: 'thread-one', turnId: 'turn-one', requestId: 'request-one', phase: 'settled' },
  ];
  for (const packet of packets) { socket.receive(JSON.stringify(packet)); expect(events.at(-1)).toEqual(packet); }
  expect(transport.state).toBe('ready'); transport.close();
});

it('rechaza progreso sin correlación, fuera del hilo o con campos desconocidos', () => {
  for (const changes of [{ threadId: 'other-thread' }, { turnId: undefined }, { phase: 'running' },
    { extra: true }, { requestId: undefined }]) {
    const { socket, transport, events } = fixture(); socket.accept();
    socket.receive(JSON.stringify({ type: 'speech_progress', threadId: 'thread-one', turnId: 'turn-one',
      requestId: 'request-one', phase: 'preparing', ...changes }));
    expect(transport.state).toBe('closed'); expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
  }
});

it('rechaza avisos de narración fallida sin motivo exacto o con datos extra', () => {
  for (const changes of [{ reason: undefined }, { reason: 'retry' }, { extra: true }, { phase: 'failed-too' }]) {
    const { socket, transport, events } = fixture(); socket.accept();
    socket.receive(JSON.stringify({ type: 'speech_progress', threadId: 'thread-one', turnId: 'turn-one',
      requestId: 'request-one', phase: 'failed', reason: 'narration_unavailable', ...changes }));
    expect(transport.state).toBe('closed'); expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
  }
});

it('acepta el aviso de fallo con identificadores válidos largos sin cerrar la voz', () => {
  const { socket, transport, events } = fixture(); socket.accept();
  const packet = { type: 'speech_progress', threadId: 'thread-one', turnId: 't'.repeat(80),
    requestId: 'r'.repeat(80), phase: 'failed', reason: 'narration_unavailable' };
  socket.receive(JSON.stringify(packet));
  expect(events.at(-1)).toEqual(packet);
  expect(transport.state).toBe('ready'); transport.close();
});

it('no acepta propósitos inventados en un handoff', () => {
  const { socket, transport } = fixture(); socket.accept();
  socket.receive(JSON.stringify({ type: 'handoff', threadId: 'thread-one', turnId: 'turn-one',
    requestId: 'request-one', status: 'running', intent: 'publish_everything' }));
  expect(transport.state).toBe('closed');
});
