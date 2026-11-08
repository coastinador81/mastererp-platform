import { expect, it, vi } from 'vitest';
import { connectLiveTransport, type LiveTransportEvent } from '../api/liveTransport';
import type { SemanticRecovery } from '../api/semanticRecovery';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const recovery: SemanticRecovery = { logicalRequestId: A, recoveryCommandId: B, semanticAttemptId: A,
  businessExecutionId: A, businessRequestId: A, disposition: 'observing', businessStatus: 'running' };
class Socket {
  binaryType: BinaryType = 'blob'; readyState = 1; bufferedAmount = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null; onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  receive(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}
function fixture() {
  const socket = new Socket(), events: LiveTransportEvent[] = [];
  const transport = connectLiveTransport('thread-one', event => events.push(event), () => socket as unknown as WebSocket);
  socket.onopen?.();
  socket.receive({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' });
  socket.receive({ type: 'status', state: 'ready', inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000' });
  return { socket, transport, events };
}
const handoff = { type: 'handoff', threadId: 'thread-one', turnId: 'turn-one', requestId: B,
  status: 'success', intent: 'recover_request', semanticRecovery: recovery };

it('acepta handoff con procedencia mayor de 384 caracteres sin tratar el negocio como terminado', () => {
  const { socket, transport, events } = fixture();
  expect(JSON.stringify(handoff).length).toBeGreaterThan(384);
  socket.receive(handoff);
  expect(events.at(-1)).toEqual(handoff);
  expect(transport.state).toBe('ready');
  expect(socket.send).toHaveBeenCalledTimes(2);
  transport.close();
});

it('acepta el recibo observado antes de que exista un negocio admitido', () => {
  const { socket, transport, events } = fixture();
  const event = { ...handoff, semanticRecovery: { ...recovery, observedRequestId: A,
    businessRequestId: null, businessExecutionId: null, businessStatus: null } };
  socket.receive(event);
  expect(events.at(-1)).toEqual(event);
  expect(transport.state).toBe('ready');
  transport.close();
});

it.each([{ recoveryCommandId: A }, { businessRequestId: 'invalid' }, { extra: true }])(
  'rechaza handoff de recuperación incoherente: %j', changes => {
    const { socket, transport, events } = fixture();
    socket.receive({ ...handoff, semanticRecovery: { ...recovery, ...changes } });
    expect(transport.state).toBe('closed');
    expect(events).toContainEqual({ type: 'error', reason: 'protocol' });
  });

it('conserva el handoff histórico sin metadata y no amplía otros controles', () => {
  const { socket, transport, events } = fixture();
  const old = { type: 'handoff', threadId: 'thread-one', turnId: 'turn-one', requestId: B, status: 'running' };
  socket.receive(old);
  expect(events.at(-1)).toEqual(old);
  socket.receive({ type: 'turn_progress', threadId: 'thread-one', turnId: 'turn-one', phase: 'interpreting', extra: 'x'.repeat(400) });
  expect(transport.state).toBe('closed');
});
