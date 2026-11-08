import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerStore } from '../hooks/composerStore';
import { useWorkspaceStore, resetWorkspaceStore } from '../hooks/workspaceStore';
import { startLiveVoicePilot, stopVoice } from '../hooks/voiceSession';
import { emitAssistantReply } from '../model/events';
import { sendPrompt } from '../hooks/conversation';
import { startLiveVoiceAudio, type LiveVoiceFailure } from '../hooks/liveVoiceAudio';

// En la voz en directo la respuesta del agente solo la dice la voz de Uony (narración
// verificada). La síntesis del navegador nunca la lee: si la voz de Uony no puede hablar,
// la respuesta queda escrita con un aviso (decisión del dueño, 20-10-2026).
const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
// Simulacro completo: con `importOriginal`, auth carga el espacio y la entrega durable no vería esta cuenta.
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account.email }));
vi.mock('../hooks/conversation', () => ({ sendPrompt: vi.fn(() => true) }));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn() }));
vi.mock('../hooks/liveHandoff', () => ({ observeLiveHandoff: vi.fn() }));

const liveFailure: LiveVoiceFailure = { type: 'closed', code: 1011, wasClean: false,
  phase: 'active', sentAudioFrames: 1, receivedAudioFrames: 0,
  transcriptEvents: 0, interruptionEvents: 0 };
class Utterance {
  lang = ''; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
const speak = vi.fn(); const cancel = vi.fn();
const liveStop = vi.fn(); const liveMicrophone = vi.fn(); const liveSpeaker = vi.fn();
let liveCallbacks: Parameters<typeof startLiveVoiceAudio>[0] | null = null;
let threadId = '';
const callbacks = () => liveCallbacks!;
const handoff = (requestId: string, status: 'running' | 'success' = 'running') =>
  callbacks().handoff?.({ type: 'handoff', threadId, turnId: `turn-${requestId}`, requestId, status });
const reply = (text: string, requestId?: string) => emitAssistantReply(text, { threadId, requestId });
const progress = (requestId: string, phase: 'preparing' | 'settled' | 'failed') => callbacks().progress?.(
  phase === 'failed'
    ? { type: 'speech_progress', threadId, turnId: `turn-${requestId}`, requestId, phase, reason: 'narration_unavailable' }
    : { type: 'speech_progress', threadId, turnId: `turn-${requestId}`, requestId, phase });
const delivery = (requestId: string) => callbacks().speechDelivery?.({ type: 'speech_delivery',
  eventId: `event-${requestId}`, requestId, phase: 'start' });

beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks(); liveCallbacks = null;
  vi.useFakeTimers();
  vi.mocked(startLiveVoiceAudio).mockImplementation(value => {
    liveCallbacks = value;
    return { stop: liveStop, muteMicrophone: liveMicrophone, muteSpeaker: liveSpeaker };
  });
  useComposerStore.setState({ draft: '', status: '', listening: null });
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { speak, cancel });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useWorkspaceStore.setState({ historyAccount: account.email });
  startLiveVoicePilot();
  threadId = useWorkspaceStore.getState().activeThreadId!;
  callbacks().bound?.();
  callbacks().status('listening');
});
afterEach(() => { stopVoice(''); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('voz Live: la respuesta del agente nunca se lee con la voz del navegador', () => {
  it('ni con la narración preparada, ni sin señal, ni si la narración falla', () => {
    handoff('req-1');
    reply('Tienes cuatro carpetas.', 'req-1');
    progress('req-1', 'preparing');
    delivery('req-1');
    handoff('req-2');
    reply('Sin narración.', 'req-2');
    handoff('req-3');
    reply('La narración falló.', 'req-3');
    progress('req-3', 'failed');
    vi.advanceTimersByTime(30_000);
    expect(speak).not.toHaveBeenCalled();
    expect(liveMicrophone).not.toHaveBeenCalled();
  });

  it('si la voz de Uony falla, avisa de que la respuesta está escrita y la sesión sigue abierta', () => {
    callbacks().transcript?.({ type: 'transcript', role: 'user', turnId: 'turn-req-1',
      text: 'Dime mis carpetas de Drive.', final: true });
    handoff('req-1');
    progress('req-1', 'failed');
    expect(useComposerStore.getState().status).toBe(
      'La respuesta está en el chat, pero no he podido decirla en voz alta. Puedes seguir hablando.');
    expect(useComposerStore.getState().listening).toBe('talk');
    expect(liveStop).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('si cae el transporte con un encargo en curso, cierra la voz sin leer nada y re-sincroniza la vista', () => {
    const retryHistory = vi.fn();
    useWorkspaceStore.setState({ retryHistory });
    handoff('req-1');
    retryHistory.mockClear();
    callbacks().error(liveFailure);
    // Fin anómalo: re-sincroniza el historial para que el chat no se vea vacío (datos intactos en BD).
    expect(retryHistory).toHaveBeenCalledOnce();
    reply('Respuesta tardía.', 'req-1');
    vi.advanceTimersByTime(30_000);
    expect(speak).not.toHaveBeenCalled();
    expect(liveStop).toHaveBeenCalled();
    expect(useComposerStore.getState().listening).toBeNull();
  });
});
