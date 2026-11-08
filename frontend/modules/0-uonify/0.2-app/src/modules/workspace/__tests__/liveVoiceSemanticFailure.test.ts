import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectLiveTransport, type LiveTransportEvent } from '../api/liveTransport';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';

vi.mock('../api/liveTransport', () => ({ connectLiveTransport: vi.fn() }));
let receive: (event: LiveTransportEvent) => void;
const transport = { state: 'ready' as const, sendAudio: vi.fn(() => true), close: vi.fn(), interrupt: vi.fn(() => true),
  acknowledgeSpeech: vi.fn(() => true), acknowledgeOrdinary: vi.fn(() => true), reportPlayback: vi.fn(() => true) };
const turnOne = '11111111-1111-4111-8111-111111111111';
const turnTwo = '22222222-2222-4222-8222-222222222222';
const generationOne = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generationTwo = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
class Context {
  static latest: Context;
  sampleRate = 16_000;
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = node();
  sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
  processor = { ...node(), onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null };
  close = vi.fn(async () => { this.state = 'closed'; });
  resume = vi.fn(async () => {});
  constructor() { Context.latest = this; }
  createMediaStreamSource = node;
  createScriptProcessor = () => this.processor;
  createGain = () => ({ ...node(), gain: { value: 1 } });
  createBuffer = (_channels: number, samples: number, rate: number) => ({
    duration: samples / rate, getChannelData: () => new Float32Array(samples),
  });
  createBufferSource = () => {
    const source = { ...node(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, buffer: null };
    this.sources.push(source); return source;
  };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('AudioContext', Context);
  const track = { enabled: true, stop: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })),
  } });
  vi.mocked(connectLiveTransport).mockImplementation((_threadId, callback) => { receive = callback; return transport; });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('entrega el fallo sin cerrar el micrófono, corta su audio y reproduce el siguiente turno', async () => {
  const semanticFailure = vi.fn(), error = vi.fn();
  const voice = startLiveVoiceAudio({ threadId: 'thread-one', valid: () => true, status: vi.fn(),
    transcript: vi.fn(), semanticFailure, error });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  receive({ type: 'status', state: 'ready', audioProtocol: 'scoped-v1' });
  receive({ type: 'transcript', role: 'user', turnId: turnOne, text: 'Mi petición', final: true });
  receive({ type: 'ordinary_audio', generationId: generationOne, replyToTurnId: turnOne, phase: 'start' });
  receive({ type: 'audio', pcm: new Uint8Array(2400) });
  expect(Context.latest.sources).toHaveLength(1);
  const failure = { type: 'semantic_failure' as const, threadId: 'thread-one', turnId: turnOne, requestId: 'request-one',
    category: 'timeout' as const, phase: 'classification' as const, code: 'semantic_timeout' as const,
    message: 'No pude interpretar esta petición. No he iniciado ninguna acción.',
    interpretation: 'failed' as const, execution: 'not_started' as const, delivery: 'text_only' as const,
    persistence: 'pending' as const };
  receive(failure);
  expect(semanticFailure).toHaveBeenCalledExactlyOnceWith(failure);
  expect(Context.latest.sources[0].stop).toHaveBeenCalledOnce();
  receive({ type: 'audio', pcm: new Uint8Array(2400) });
  receive({ type: 'ordinary_audio', generationId: generationOne, replyToTurnId: turnOne, phase: 'end' });
  expect(Context.latest.sources).toHaveLength(1);
  expect(transport.close).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  receive({ type: 'transcript', role: 'user', turnId: turnTwo, text: 'Siguiente petición', final: true });
  receive({ type: 'ordinary_audio', generationId: generationTwo, replyToTurnId: turnTwo, phase: 'start' });
  receive({ type: 'audio', pcm: new Uint8Array(2400) });
  expect(Context.latest.sources).toHaveLength(2);
  Context.latest.processor.onaudioprocess?.({ inputBuffer: {
    getChannelData: () => new Float32Array([0, 0]),
  } } as unknown as AudioProcessingEvent);
  expect(transport.sendAudio).toHaveBeenCalledOnce();
  voice.stop();
});
