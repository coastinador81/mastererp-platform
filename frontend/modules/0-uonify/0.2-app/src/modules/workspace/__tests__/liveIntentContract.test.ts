import { expect, it, vi } from 'vitest';
import { connectLiveTransport, LIVE_WORK_INTENTS, type LiveTransportEvent } from '../api/liveTransport';
import { liveWorkLabel } from '../hooks/liveWorkProgress';

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
  close = vi.fn(() => { this.readyState = 3; this.onclose?.({ code: 1000, wasClean: true } as CloseEvent); });
  constructor(readonly url: string) { FakeSocket.sockets.push(this); }
  receive(data: string): void { this.onmessage?.({ data } as MessageEvent); }
  accept(): void {
    this.readyState = 1;
    this.onopen?.();
    this.receive(JSON.stringify({ type: 'bound', threadId: 'thread-one', sessionId: 'session-one' }));
    this.receive(JSON.stringify({ type: 'status', state: 'ready',
      inputFormat: 'pcm_s16le_16000', outputFormat: 'pcm_s16le_24000' }));
  }
}

it('acepta el aviso del agente abierto de Drive sin cortar la sesión de voz', () => {
  // 20-10-2026 11:23:06: el servidor avisó intent=drive_assist para «Dime mis carpetas
  // de Drive», el navegador lo tomó por un error de protocolo y cortó la voz.
  const events: LiveTransportEvent[] = [];
  const transport = connectLiveTransport('thread-one', event => events.push(event),
    url => new FakeSocket(url) as unknown as WebSocket);
  FakeSocket.sockets.at(-1)!.accept();
  const handoff = { type: 'handoff', threadId: 'thread-one', turnId: 'turn-one',
    requestId: 'request-one', status: 'queued', intent: 'drive_assist' };
  FakeSocket.sockets.at(-1)!.receive(JSON.stringify(handoff));
  expect(events.at(-1)).toEqual(handoff);
  expect(transport.state).toBe('ready');
  transport.close();
});

it('anuncia el trabajo del agente abierto de Drive con el texto que ya usa Drive', () => {
  expect(liveWorkLabel('drive_assist')).toBe('Uony está revisando tu Drive…');
});

it('incluye el agente abierto de Drive entre los encargos de voz aceptados', () => {
  // El contrato completo con el backend lo comprueba scripts/check-live-contract.mjs.
  expect(LIVE_WORK_INTENTS).toContain('drive_assist');
});
