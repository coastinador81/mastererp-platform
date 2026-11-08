import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';
import { observeLiveHandoff } from '../hooks/liveHandoff';
import { startLiveVoicePilot, stopVoice } from '../hooks/voiceSession';
import { useComposerStore } from '../hooks/composerStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
vi.mock('@/modules/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/auth')>(),
  currentAccountEmail: () => account.email,
}));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn() }));
vi.mock('../hooks/liveHandoff', () => ({ observeLiveHandoff: vi.fn() }));

let callbacks: Parameters<typeof startLiveVoiceAudio>[0] | null = null;
const unconfirmed = (turnId: string, threadId: string) => ({ type: 'action_unconfirmed' as const,
  threadId, turnId, reason: 'transcript_not_verified' as const });

beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks(); callbacks = null;
  useComposerStore.setState({ status: '', listening: null });
  useWorkspaceStore.setState({ historyAccount: account.email });
  vi.mocked(startLiveVoiceAudio).mockImplementation(value => {
    callbacks = value;
    return { stop: vi.fn(), muteMicrophone: vi.fn(), muteSpeaker: vi.fn() };
  });
});
afterEach(() => { stopVoice(''); });

it('mantiene la orden no verificada frente a estados normales hasta que empieza otro turno', () => {
  startLiveVoicePilot();
  const threadId = useWorkspaceStore.getState().activeThreadId!;
  callbacks!.status('listening');
  callbacks!.speechStarted?.('turn-one');
  callbacks!.actionUnconfirmed?.(unconfirmed('turn-one', threadId));
  const warning = 'No he podido confirmar tu petición por voz. No inicié ningún trabajo; repítela o escríbela.';
  expect(useComposerStore.getState().status).toBe(warning);
  callbacks!.status('speaking');
  callbacks!.captionStatus?.('unavailable');
  callbacks!.speechStarted?.('turn-one');
  expect(useComposerStore.getState().status).toBe(warning);
  callbacks!.speechStarted?.('turn-two');
  expect(useComposerStore.getState().status).toBe('La voz sigue; transcripción en directo no disponible.');
  callbacks!.actionUnconfirmed?.(unconfirmed('turn-one', threadId));
  expect(useComposerStore.getState().status).not.toBe(warning);
  expect(observeLiveHandoff).not.toHaveBeenCalled();
});

it('un handoff del mismo turno retira el aviso y descarta avisos tardíos contradictorios', () => {
  startLiveVoicePilot();
  const threadId = useWorkspaceStore.getState().activeThreadId!;
  callbacks!.status('listening');
  callbacks!.speechStarted?.('turn-one');
  callbacks!.actionUnconfirmed?.(unconfirmed('turn-one', threadId));
  callbacks!.handoff?.({ type: 'handoff', threadId, turnId: 'turn-one',
    requestId: 'request-one', status: 'queued' });
  expect(useComposerStore.getState().status).toBe('Voz en directo de prueba. Los mensajes confirmados quedan en el chat.');
  expect(observeLiveHandoff).toHaveBeenCalledOnce();
  callbacks!.actionUnconfirmed?.(unconfirmed('turn-one', threadId));
  expect(useComposerStore.getState().status).not.toContain('No he podido confirmar');
});
