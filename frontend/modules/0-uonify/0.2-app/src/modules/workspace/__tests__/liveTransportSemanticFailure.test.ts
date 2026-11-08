import { expect, it, vi } from 'vitest';
import { connectLiveTransport, type LiveTransportEvent } from '../api/liveTransport';
import type { SemanticFailureEvent } from '../api/liveSemanticFailure';

class Socket {
  binaryType: BinaryType = 'blob';
  readyState = 0;
  bufferedAmount = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  receive(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
  accept() {
    this.readyState = 1; this.onopen?.();
    this.receive({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' });
    this.receive({ type: 'status', state: 'ready', inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000' });
  }
}
const failure: SemanticFailureEvent = { type: 'semantic_failure', threadId: 'thread-one', turnId: 'turn-one',
  requestId: 'request-one', category: 'provider', phase: 'provider_wait', code: 'google_unavailable', providerCode: 504,
  message: 'No pude interpretar esta petición por un fallo técnico. No he iniciado ninguna acción.',
  interpretation: 'failed', execution: 'not_started', delivery: 'text_only', persistence: 'pending' };
function fixture() {
  const socket = new Socket();
  const events: LiveTransportEvent[] = [];
  const transport = connectLiveTransport('thread-one', event => events.push(event), () => socket as unknown as WebSocket);
  socket.accept();
  return { socket, events, transport };
}

it('entrega el fallo y su guardado sin cerrar Live ni enviar otra petición', () => {
  const { socket, transport, events } = fixture();
  for (const persistence of ['pending', 'saved', 'unknown'] as const) {
    const packet = { ...failure, persistence };
    socket.receive(packet);
    expect(events.at(-1)).toEqual(packet);
  }
  expect(transport.state).toBe('ready');
  expect(socket.send).toHaveBeenCalledTimes(2);
  expect(transport.sendAudio(new Uint8Array([0, 0]))).toBe(true);
  transport.close();
});

it('acepta IDs largos y mensaje acotado sin ampliar el límite de los otros controles', () => {
  const { socket, transport, events } = fixture();
  const packet = { ...failure, turnId: 't'.repeat(80), requestId: 'r'.repeat(80), message: 'a'.repeat(500) };
  socket.receive(packet);
  expect(events.at(-1)).toEqual(packet);
  expect(transport.state).toBe('ready');
  transport.close();
});

it.each([
  { category: 'admission', phase: 'admission', code: 'semantic_admission_unknown', interpretation: 'succeeded', execution: 'unknown', persistence: 'unknown' },
  { category: 'admission', phase: 'admission', code: 'semantic_admission_unknown', interpretation: 'succeeded', execution: 'unknown', persistence: 'saved' },
  { category: 'admission', phase: 'admission', code: 'semantic_admission_failed', interpretation: 'succeeded', execution: 'not_started', persistence: 'pending' },
  { phase: 'client_close' },
])('acepta el contrato de admisión y cierre sin reenvío: %j', changes => {
  const { socket, transport, events } = fixture();
  const packet = { ...failure, ...changes };
  socket.receive(packet);
  expect(events.at(-1)).toEqual(packet);
  expect(transport.state).toBe('ready');
  expect(socket.send).toHaveBeenCalledTimes(2);
  transport.close();
});

it.each([
  { interpretation: 'failed' }, { execution: 'not_started' }, { persistence: 'pending' },
  { phase: 'classification' }, { code: 'google_unavailable' }, { category: 'provider' },
  { code: 'semantic_admission_failed' },
])('rechaza mezclas que negarían una admisión incierta: %j', changes => {
  const { socket, transport, events } = fixture();
  socket.receive({ ...failure, category: 'admission', phase: 'admission', code: 'semantic_admission_unknown',
    interpretation: 'succeeded', execution: 'unknown', persistence: 'unknown', ...changes });
  expect(transport.state).toBe('closed');
  expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
});

it.each([
  { threadId: 'other-thread' }, { turnId: undefined }, { requestId: undefined }, { category: 'invented' },
  { phase: 'executing' }, { code: 'retry' }, { interpretation: 'success' }, { execution: 'started' },
  { delivery: 'audio' }, { persistence: 'complete' }, { providerCode: 200 }, { providerCode: '504' },
  { providerCode: 504.5 }, { message: '' }, { message: 'a'.repeat(501) }, { message: 'error\0secret' }, { extra: true },
])('rechaza un fallo sin contrato exacto: %j', changed => {
  const { socket, transport, events } = fixture();
  socket.receive({ ...failure, ...changed });
  expect(transport.state).toBe('closed');
  expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
});
