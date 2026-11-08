import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';
import { observeLiveHandoff } from '../hooks/liveHandoff';
import { startLiveVoicePilot, stopVoice, toggleSpeaker } from '../hooks/voiceSession';
import { useLiveTranscriptPreview } from '../hooks/liveTranscriptPreview';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

const account = vi.hoisted(() => ({ email: 'live-reply@uonify.test' }));
vi.mock('@/modules/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/auth')>(),
  currentAccountEmail: () => account.email,
}));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn() }));
vi.mock('../hooks/liveHandoff', () => ({ observeLiveHandoff: vi.fn() }));

let callbacks: Parameters<typeof startLiveVoiceAudio>[0] | null = null;
beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks();
  useLiveTranscriptPreview.getState().clear();
  useWorkspaceStore.setState({ historyAccount: account.email });
  vi.mocked(startLiveVoiceAudio).mockImplementation(value => {
    callbacks = value;
    return { stop: vi.fn(), muteMicrophone: vi.fn(), muteSpeaker: vi.fn() };
  });
});
afterEach(() => { stopVoice(''); callbacks = null; });

it('sustituye solo la frase Live del turno delegado y conserva la pregunta y respuestas posteriores', () => {
  startLiveVoicePilot();
  const threadId = useWorkspaceStore.getState().activeThreadId!;
  const epoch = useWorkspaceStore.getState().historyEpoch;
  callbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-1',
    text: '¿Tienes acceso a mi Drive?', final: true });
  callbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-1',
    replyToTurnId: 'user-1', text: 'Estoy comprobando el acceso.', final: true });
  callbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-2',
    text: 'Gracias.', final: true });
  callbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-2',
    replyToTurnId: 'user-2', text: 'De nada.', final: true });
  callbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'reply-late',
    replyToTurnId: 'user-1', text: 'Todavía lo compruebo.' });
  callbacks?.handoff?.({ type: 'handoff', threadId, turnId: 'user-1',
    requestId: 'request-1', status: 'queued' });
  const messages = useWorkspaceStore.getState().threads.find(thread => thread.id === threadId)!.messages;
  expect(messages.map(message => message.text)).toEqual([
    '¿Tienes acceso a mi Drive?', 'Estoy comprobando el acceso.', 'Gracias.', 'De nada.',
  ]);
  expect(messages[1]).toMatchObject({ replyToTurnId: 'user-1', supersededByHandoff: true });
  expect(messages[3]).toMatchObject({ replyToTurnId: 'user-2' });
  expect(useLiveTranscriptPreview.getState().previews.some(preview => preview.turnId === 'reply-late')).toBe(false);
  expect(observeLiveHandoff).toHaveBeenCalledWith({ type: 'handoff', threadId,
    turnId: 'user-1', requestId: 'request-1', status: 'queued' }, account.email, epoch);
  callbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-late',
    replyToTurnId: 'user-1', text: 'Texto atrasado de Live.', final: true });
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === threadId)!.messages).toHaveLength(4);
});

it('un handoff anterior al subtítulo final impide crear una segunda respuesta', () => {
  startLiveVoicePilot();
  const threadId = useWorkspaceStore.getState().activeThreadId!;
  callbacks?.transcript({ type: 'transcript', role: 'user', turnId: 'user-1',
    text: 'Comprueba mi Drive', final: true });
  callbacks?.handoff?.({ type: 'handoff', threadId, turnId: 'user-1',
    requestId: 'request-1', status: 'queued' });
  callbacks?.preview?.({ type: 'transcript_preview', role: 'assistant', turnId: 'reply-1',
    replyToTurnId: 'user-1', text: 'Estoy revisando.' });
  callbacks?.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-1',
    replyToTurnId: 'user-1', text: 'Estoy revisando.', final: true });
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === threadId)!.messages)
    .toMatchObject([{ role: 'user', text: 'Comprueba mi Drive' }]);
  expect(useLiveTranscriptPreview.getState().previews).toEqual([]);
});

it('mantiene un único altavoz Live durante el trabajo persistido', () => {
  startLiveVoicePilot();
  const threadId = useWorkspaceStore.getState().activeThreadId!;
  callbacks?.handoff?.({ type: 'handoff', threadId, turnId: 'user-voice',
    requestId: 'creative-request', status: 'queued' });
  expect(vi.mocked(observeLiveHandoff).mock.calls[0]).toHaveLength(3);
  expect(vi.mocked(startLiveVoiceAudio).mock.results[0].value.muteSpeaker).not.toHaveBeenCalled();
  toggleSpeaker();
  expect(vi.mocked(startLiveVoiceAudio).mock.results[0].value.muteSpeaker).toHaveBeenCalledExactlyOnceWith(true);
});
