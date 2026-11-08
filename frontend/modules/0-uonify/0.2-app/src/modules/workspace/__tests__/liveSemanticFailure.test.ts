import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, Fragment } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SemanticFailureEvent } from '../api/liveSemanticFailure';
import { startLiveVoiceAudio } from '../hooks/liveVoiceAudio';
import { observeLiveHandoff } from '../hooks/liveHandoff';
import { startLiveVoicePilot, stopVoice } from '../hooks/voiceSession';
import { useComposerStore } from '../hooks/composerStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { liveProgressLabel, observeLiveProgressWork, useLiveWorkProgress } from '../hooks/liveWorkProgress';
import { setUi, useUiStore } from '../hooks/uiStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { Composer } from '../components/composer/Composer';

const account = vi.hoisted(() => ({ email: 'pilot@uonify.test' }));
vi.mock('@/modules/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/auth')>(), currentAccountEmail: () => account.email,
  useSession: () => ({ status: 'ready', user: { email: account.email } }),
}));
vi.mock('../hooks/liveVoiceAudio', () => ({ startLiveVoiceAudio: vi.fn() }));
vi.mock('../hooks/liveHandoff', () => ({ observeLiveHandoff: vi.fn() }));
let callbacks: Parameters<typeof startLiveVoiceAudio>[0];
const refresh = vi.fn();
const warning = 'No pude interpretar esta petición por un fallo técnico. No he iniciado ninguna acción.';
const scope = () => ({ account: account.email, epoch: useWorkspaceStore.getState().historyEpoch,
  threadId: useWorkspaceStore.getState().activeThreadId! });
type InterpretationFailure = Extract<SemanticFailureEvent, { interpretation: 'failed' }>;
const failure = (changes: Partial<InterpretationFailure> = {}): InterpretationFailure => ({ type: 'semantic_failure',
  threadId: scope().threadId, turnId: 'turn-one', requestId: 'request-one', category: 'provider', phase: 'provider_wait',
  code: 'google_unavailable', providerCode: 504, message: warning,
  interpretation: 'failed', execution: 'not_started', delivery: 'text_only', persistence: 'pending', ...changes });
const admissionUnknown = (persistence: 'saved' | 'unknown' = 'unknown'):
  Extract<SemanticFailureEvent, { code: 'semantic_admission_unknown' }> => ({
  type: 'semantic_failure', threadId: scope().threadId, turnId: 'turn-one', requestId: 'request-one',
  category: 'admission', phase: 'admission', code: 'semantic_admission_unknown',
  message: 'He interpretado la petición, pero no puedo confirmar si llegó a iniciarse. La solicitud se conserva; hay que comprobar su estado antes de volver a ejecutarla.',
  interpretation: 'succeeded', execution: 'unknown', delivery: 'text_only', persistence });
function startTurn(turnId = 'turn-one') {
  callbacks.speechStarted?.(turnId);
  callbacks.transcript({ type: 'transcript', role: 'user', turnId, text: `Solicitud ${turnId}`, final: true });
  callbacks.progress?.({ type: 'turn_progress', threadId: scope().threadId, turnId, phase: 'interpreting' });
}

beforeEach(() => {
  stopVoice(''); resetWorkspaceStore(); vi.clearAllMocks();
  useComposerStore.setState({ status: '', listening: null, draft: 'Mi borrador', threadStatuses: {} });
  useLiveWorkProgress.setState({ turns: [], work: [] }); setUi({ pendingReply: null });
  useWorkspaceStore.setState({ historyAccount: account.email, retryHistory: refresh });
  useGooglePreferences.setState({ account: account.email, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
  vi.mocked(startLiveVoiceAudio).mockImplementation(value => {
    callbacks = value;
    return { stop: vi.fn(), muteMicrophone: vi.fn(), muteSpeaker: vi.fn() };
  });
  startLiveVoicePilot(); callbacks.status('listening');
});
afterEach(() => { stopVoice(''); });

it('retira el progreso, conserva solicitud y borrador, y acepta el turno siguiente', () => {
  startTurn();
  expect(liveProgressLabel(useLiveWorkProgress.getState(), scope())).toBe('Uony está entendiendo tu petición…');
  callbacks.semanticFailure?.(failure());
  expect(liveProgressLabel(useLiveWorkProgress.getState(), scope())).toBeNull();
  expect(useComposerStore.getState().status).toBe(warning);
  expect(useComposerStore.getState()).toMatchObject({ draft: 'Mi borrador', listening: 'talk' });
  expect(useWorkspaceStore.getState().threads.at(-1)?.messages).toEqual([
    expect.objectContaining({ role: 'user', turnId: 'turn-one', text: 'Solicitud turn-one' }),
  ]);
  callbacks.status('speaking'); callbacks.captionStatus?.('unavailable');
  expect(useComposerStore.getState().status).toBe(warning);
  callbacks.progress?.({ type: 'turn_progress', threadId: scope().threadId, turnId: 'turn-one', phase: 'interpreting' });
  expect(liveProgressLabel(useLiveWorkProgress.getState(), scope())).toBeNull();
  startTurn('turn-two');
  expect(useComposerStore.getState().status).not.toBe(warning);
  expect(liveProgressLabel(useLiveWorkProgress.getState(), scope())).toBe('Uony está entendiendo tu petición…');
  callbacks.handoff?.({ type: 'handoff', threadId: scope().threadId, turnId: 'turn-two', requestId: 'request-two', status: 'queued' });
  expect(observeLiveHandoff).toHaveBeenCalledOnce();
  expect(vi.mocked(startLiveVoiceAudio).mock.results[0].value.stop).not.toHaveBeenCalled();
});

it('deduplica pending/unknown/saved sin prometer guardado ni crear mensajes nuevos', () => {
  startTurn(); refresh.mockClear();
  callbacks.semanticFailure?.(failure()); callbacks.semanticFailure?.(failure());
  expect(refresh).not.toHaveBeenCalled();
  callbacks.semanticFailure?.(failure({ persistence: 'unknown' }));
  expect(useComposerStore.getState().status).toContain('No se ha podido confirmar el guardado');
  callbacks.semanticFailure?.(failure());
  expect(useComposerStore.getState().status).toContain('No se ha podido confirmar el guardado');
  callbacks.semanticFailure?.(failure({ persistence: 'saved' }));
  expect(useComposerStore.getState().status).toBe(warning);
  expect(refresh).toHaveBeenCalledOnce();
  callbacks.semanticFailure?.(failure({ persistence: 'saved' }));
  callbacks.semanticFailure?.(failure({ persistence: 'unknown' }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(useComposerStore.getState().status).toBe(warning);
  expect(useWorkspaceStore.getState().threads.at(-1)?.messages).toHaveLength(1);
});

it('un fallo tardío no borra otro turno ni trabajo anterior ni reemplaza su aviso', () => {
  startTurn('previous-work');
  observeLiveProgressWork(scope(), { type: 'handoff', threadId: scope().threadId, turnId: 'previous-work',
    requestId: 'previous-request', status: 'running', intent: 'drive_count' });
  setUi({ pendingReply: { threadId: scope().threadId, requestId: 'previous-request', label: 'Contando…' } });
  startTurn(); startTurn('turn-two');
  const status = useComposerStore.getState().status;
  callbacks.semanticFailure?.(failure());
  expect(useComposerStore.getState().status).toBe(status);
  expect(useLiveWorkProgress.getState().turns.find(turn => turn.turnId === 'turn-two')?.interpreting).toBe(true);
  expect(useLiveWorkProgress.getState().work[0].status).toBe('running');
  expect(useUiStore.getState().pendingReply?.requestId).toBe('previous-request');
});

it('descarta respuestas ordinarias tardías y un handoff contradictorio del turno fallido', () => {
  startTurn(); callbacks.semanticFailure?.(failure());
  callbacks.transcript({ type: 'transcript', role: 'assistant', turnId: 'reply-one', replyToTurnId: 'turn-one',
    text: 'Todo completado', final: true });
  callbacks.handoff?.({ type: 'handoff', threadId: scope().threadId, turnId: 'turn-one', requestId: 'request-one', status: 'success' });
  expect(observeLiveHandoff).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads.at(-1)?.messages).toHaveLength(1);
});

it('la admisión incierta conserva el trabajo y permite reconciliar el mismo request sin repetirlo', () => {
  startTurn();
  observeLiveProgressWork(scope(), { type: 'handoff', threadId: scope().threadId, turnId: 'turn-one',
    requestId: 'request-one', status: 'running', intent: 'drive_count' });
  const pendingReply = { threadId: scope().threadId, requestId: 'request-one', label: 'Contando…' };
  setUi({ pendingReply }); refresh.mockClear();
  callbacks.semanticFailure?.(admissionUnknown());
  expect(useComposerStore.getState().status).toContain('no puedo confirmar si llegó a iniciarse');
  expect(useComposerStore.getState().status).not.toContain('No he iniciado');
  expect(useLiveWorkProgress.getState().turns[0].interpreting).toBe(false);
  expect(useLiveWorkProgress.getState().work[0].status).toBe('running');
  expect(useUiStore.getState().pendingReply).toEqual(pendingReply);
  expect(observeLiveHandoff).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  callbacks.handoff?.({ type: 'handoff', threadId: scope().threadId, turnId: 'turn-one', requestId: 'other-request', status: 'running' });
  expect(observeLiveHandoff).not.toHaveBeenCalled();
  callbacks.semanticFailure?.(admissionUnknown('saved'));
  expect(refresh).toHaveBeenCalledOnce();
  callbacks.handoff?.({ type: 'handoff', threadId: scope().threadId, turnId: 'turn-one', requestId: 'request-one', status: 'running' });
  expect(observeLiveHandoff).toHaveBeenCalledOnce();
  expect(useComposerStore.getState().status).not.toContain('no puedo confirmar');
  callbacks.semanticFailure?.(admissionUnknown());
  expect(useComposerStore.getState().status).not.toContain('no puedo confirmar');
  expect(useUiStore.getState().pendingReply).toEqual(pendingReply);
  expect(useWorkspaceStore.getState().threads.at(-1)?.messages).toHaveLength(1);
});

it('un aviso incierto no inventa trabajo y no invalida el handoff ya confirmado', () => {
  startTurn(); callbacks.semanticFailure?.(admissionUnknown());
  expect(useLiveWorkProgress.getState().work).toEqual([]);
  expect(useUiStore.getState().pendingReply).toBeNull();
  callbacks.handoff?.({ type: 'handoff', threadId: scope().threadId, turnId: 'turn-one', requestId: 'request-one', status: 'success' });
  expect(observeLiveHandoff).toHaveBeenCalledOnce();
  callbacks.semanticFailure?.(admissionUnknown('saved'));
  expect(useComposerStore.getState().status).not.toContain('no puedo confirmar');
  startTurn('turn-two');
  expect(liveProgressLabel(useLiveWorkProgress.getState(), scope())).toBe('Uony está entendiendo tu petición…');
});

it('una admisión fallida confirmada termina su espera sin afirmar que falló la interpretación', () => {
  startTurn();
  setUi({ pendingReply: { threadId: scope().threadId, requestId: 'request-one', label: 'Preparando…' } });
  const event: SemanticFailureEvent = { ...admissionUnknown(), code: 'semantic_admission_failed',
    execution: 'not_started', persistence: 'pending',
    message: 'He interpretado la petición, pero no pudo iniciarse la acción. La solicitud se conserva; no la repetiré automáticamente.' };
  callbacks.semanticFailure?.(event);
  expect(useComposerStore.getState().status).toBe(event.message);
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(liveProgressLabel(useLiveWorkProgress.getState(), scope())).toBeNull();
  callbacks.handoff?.({ type: 'handoff', threadId: scope().threadId, turnId: 'turn-one', requestId: 'request-one', status: 'running' });
  expect(observeLiveHandoff).not.toHaveBeenCalled();
});

it('no acepta fallos cruzados ni tardíos tras cambio de identidad', () => {
  startTurn(); const status = useComposerStore.getState().status;
  callbacks.semanticFailure?.(failure({ threadId: 'other-thread' }));
  expect(useComposerStore.getState().status).toBe(status);
  useWorkspaceStore.setState(state => ({ historyEpoch: state.historyEpoch + 1 }));
  const stopped = useComposerStore.getState().status;
  callbacks.semanticFailure?.(failure({ persistence: 'saved' }));
  expect(useComposerStore.getState().status).toBe(stopped);
});

it('pinta el aviso en el compositor existente y retira su indicador de interpretación', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  startTurn();
  render(createElement(QueryClientProvider, { client }, createElement(Fragment, null,
    createElement(ConversationActiveIndicator), createElement(Composer))));
  expect(screen.getByText('Uony está entendiendo tu petición…')).toBeVisible();
  act(() => callbacks.semanticFailure?.(failure()));
  expect(screen.queryByText('Uony está entendiendo tu petición…')).not.toBeInTheDocument();
  expect(screen.getByText(warning)).toHaveClass('composer-live-status');
  expect(screen.getByText(warning)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Mi borrador');
  act(() => startTurn('turn-two'));
  expect(screen.queryByText(warning)).not.toBeInTheDocument();
  expect(screen.getByText('Uony está entendiendo tu petición…')).toBeVisible();
});
