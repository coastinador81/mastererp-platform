import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';
import { startLiveVoicePilot, stopVoice } from '../hooks/voiceSession';
import { useComposerStore } from '../hooks/composerStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
vi.mock('@/modules/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/auth')>(), currentAccountEmail: () => account.email,
}));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn() }));
vi.mock('../hooks/liveHandoff', () => ({ observeLiveHandoff: vi.fn() }));
let callbacks: Parameters<typeof startLiveVoiceAudio>[0];
const stop = vi.fn();
const warning = 'Esta respuesta se muestra en el chat. Puedes seguir hablando.';
const notice = (turnId: string) => ({ type: 'voice_notice' as const, turnId, reason: 'response_audio_limit' as const });
beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks();
  useComposerStore.setState({ status: '', listening: null });
  useWorkspaceStore.setState({ historyAccount: account.email });
  vi.mocked(startLiveVoiceAudio).mockImplementation(value => {
    callbacks = value; return { stop, muteMicrophone: vi.fn(), muteSpeaker: vi.fn() };
  });
  startLiveVoicePilot(); callbacks.status('listening');
});
afterEach(() => stopVoice(''));

it('mantiene el aviso recuperable sin cerrar la voz y lo limpia al siguiente turno', () => {
  callbacks.speechStarted?.('turn-a'); callbacks.voiceNotice?.(notice('turn-a'));
  callbacks.status('listening'); callbacks.captionStatus?.('unavailable');
  expect(useComposerStore.getState().status).toBe(warning);
  expect(useComposerStore.getState().listening).toBe('talk');
  expect(stop).not.toHaveBeenCalled();
  callbacks.speechStarted?.('turn-b');
  callbacks.captionStatus?.('ready'); callbacks.status('speaking');
  expect(useComposerStore.getState().status).toBe('Uony está hablando…');
  callbacks.voiceNotice?.(notice('turn-a'));
  callbacks.voiceNotice?.(notice('unknown-old-turn'));
  expect(useComposerStore.getState().status).toBe('Uony está hablando…');
});

it('un final anterior no retira el aviso vigente y un nuevo turno sin VAD sí lo retira', () => {
  callbacks.speechStarted?.('turn-a'); callbacks.speechStarted?.('turn-b');
  callbacks.voiceNotice?.(notice('turn-b'));
  callbacks.transcript({ type: 'transcript', role: 'user', turnId: 'turn-a', text: 'Anterior', final: true });
  expect(useComposerStore.getState().status).toBe(warning);
  callbacks.transcript({ type: 'transcript', role: 'user', turnId: 'turn-c', text: 'Siguiente', final: true });
  expect(useComposerStore.getState().status).not.toBe(warning);
});

it('ignora avisos de una sesión cuyo hilo, cuenta o epoch ya no está vigente', () => {
  callbacks.speechStarted?.('turn-a');
  const staleCallbacks = callbacks;
  useWorkspaceStore.getState().createThread({ title: 'Otro', service: null, view: 'default' });
  const statusAfterChange = useComposerStore.getState().status;
  staleCallbacks.voiceNotice?.(notice('turn-a'));
  expect(useComposerStore.getState().status).toBe(statusAfterChange);
});

it('un handoff retira el aviso de ese turno y descarta un aviso posterior', () => {
  callbacks.speechStarted?.('turn-a'); callbacks.voiceNotice?.(notice('turn-a'));
  callbacks.handoff?.({ type: 'handoff', threadId: useWorkspaceStore.getState().activeThreadId!,
    turnId: 'turn-a', requestId: 'request-a', status: 'queued' });
  expect(useComposerStore.getState().status).not.toBe(warning);
  callbacks.voiceNotice?.(notice('turn-a'));
  expect(useComposerStore.getState().status).not.toBe(warning);
});

it('informa audio insuficiente sin bloquear voz y conserva el aviso hasta otro turno humano', () => {
  callbacks.speechStarted?.('turn-a');
  callbacks.voiceNotice?.({ type: 'voice_notice', turnId: 'turn-a', reason: 'response_audio_unavailable' });
  const message = 'Esta respuesta está en el chat; la voz no se pudo reproducir. Puedes seguir hablando.';
  expect(useComposerStore.getState().status).toBe(message);
  callbacks.status('listening'); expect(useComposerStore.getState().status).toBe(message);
  expect(stop).not.toHaveBeenCalled();
  callbacks.speechStarted?.('turn-b'); callbacks.status('speaking');
  expect(useComposerStore.getState().status).toBe('Uony está hablando…');
  callbacks.voiceNotice?.({ type: 'voice_notice', turnId: 'turn-a', reason: 'response_audio_unavailable' });
  expect(useComposerStore.getState().status).toBe('Uony está hablando…');
});

it('avisa de una narración fallida con resultado escrito sin cortar la sesión ni crear otro trabajo', () => {
  callbacks.speechStarted?.('turn-a');
  callbacks.handoff?.({ type: 'handoff', threadId: useWorkspaceStore.getState().activeThreadId!,
    turnId: 'turn-a', requestId: 'request-a', status: 'success' });
  callbacks.progress?.({ type: 'speech_progress', threadId: useWorkspaceStore.getState().activeThreadId!,
    turnId: 'turn-a', requestId: 'request-a', phase: 'failed', reason: 'narration_unavailable' });
  const message = 'La respuesta está en el chat, pero no he podido decirla en voz alta. Puedes seguir hablando.';
  expect(useComposerStore.getState().status).toBe(message);
  expect(useComposerStore.getState().listening).toBe('talk');
  expect(stop).not.toHaveBeenCalled();
  callbacks.progress?.({ type: 'speech_progress', threadId: useWorkspaceStore.getState().activeThreadId!,
    turnId: 'turn-a', requestId: 'request-a', phase: 'settled' });
  expect(useComposerStore.getState().status).toBe(message);
  callbacks.speechStarted?.('turn-b'); callbacks.status('listening');
  expect(useComposerStore.getState().status).not.toBe(message);
});
