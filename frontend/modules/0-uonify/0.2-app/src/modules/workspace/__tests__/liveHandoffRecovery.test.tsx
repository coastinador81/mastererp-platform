import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getRecentDurableRequests, getUnresolvedDurableRequests } from '../api/durableRequests';
import { useDurableRecovery } from '../hooks/useDurableRecovery';
import { useComposerStore } from '../hooks/composerStore';
import { watchDurableRequest } from '../hooks/durableRequestWatcher';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi, useUiStore } from '../hooks/uiStore';

const account = vi.hoisted(() => ({ email: 'voice-recovery@uonify.test' }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account.email }));
vi.mock('../api/durableRequests', async importOriginal => ({
  ...await importOriginal<typeof import('../api/durableRequests')>(),
  getRecentDurableRequests: vi.fn(), getUnresolvedDurableRequests: vi.fn(),
}));
vi.mock('../hooks/durableRequestWatcher', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/durableRequestWatcher')>(),
  watchDurableRequest: vi.fn(),
}));

function Recovery() { useDurableRecovery(); return null; }
beforeEach(() => {
  resetWorkspaceStore(); setUi({ pendingReply: null }); vi.clearAllMocks();
  useComposerStore.setState({ draft: '' });
  useWorkspaceStore.setState({ historyAccount: account.email,
    threads: [{ id: 'thread-voice', title: 'Basic', service: null, view: 'default',
      messages: [{ role: 'user', text: 'Analiza mis documentos',
        turnId: '11111111-1111-4111-8111-111111111111' }] }],
    activeThreadId: 'thread-voice', retryHistory: vi.fn() });
  vi.mocked(getRecentDurableRequests).mockResolvedValue([{ requestId: '22222222-2222-4222-8222-222222222222',
    threadId: 'thread-voice', status: 'running', text: 'Analiza mis documentos', model: 'auto',
    effort: 'medium', createdAt: '2026-10-18T12:00:00Z',
    sourceLiveTurnId: '11111111-1111-4111-8111-111111111111' }]);
  vi.mocked(getUnresolvedDurableRequests).mockResolvedValue([]);
});

it('si el estado se pierde temporalmente, no convierte una frase hablada en borrador escrito', async () => {
  render(<Recovery />);
  await waitFor(() => expect(watchDurableRequest).toHaveBeenCalledOnce());
  act(() => vi.mocked(watchDurableRequest).mock.calls[0][0].missing?.());
  expect(useComposerStore.getState().draft).toBe('');
  // Lote 6: Uony avisa en la conversación; la frase hablada sigue siendo el único turno de la persona.
  expect(useWorkspaceStore.getState().threads[0].messages).toEqual([
    { role: 'user', text: 'Analiza mis documentos', turnId: '11111111-1111-4111-8111-111111111111' },
    { role: 'assistant', model: 'uonify-guide', requestId: '22222222-2222-4222-8222-222222222222', requestStatus: 'error',
      text: 'La petición dejó de estar disponible. Conservamos tu texto y no la repetiremos automáticamente.' }]);
  expect(useComposerStore.getState().threadStatuses['thread-voice']).toBeUndefined();
});

it('tras reconectar conserva una sola burbuja Live y lee la tarjeta final del historial', async () => {
  render(<Recovery />);
  await waitFor(() => expect(watchDurableRequest).toHaveBeenCalledOnce());
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(useUiStore.getState().pendingReply?.threadId).toBe('thread-voice');
  act(() => vi.mocked(watchDurableRequest).mock.calls[0][0].settled({
    requestId: '22222222-2222-4222-8222-222222222222', threadId: 'thread-voice',
    status: 'success', sourceLiveTurnId: '11111111-1111-4111-8111-111111111111',
    response: { reply: 'Vamos a elegir la carpeta.', model: 'gemini-3.5-flash', effort: 'medium' },
  }));
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalled();
});

it('al reconectar vigila dos encargos distintos y entrega sus resultados sin repetir la solicitud', async () => {
  useWorkspaceStore.setState(state => ({ threads: [...state.threads,
    { id: 'thread-two', title: 'Otro producto', service: null, view: 'default', messages: [
      { role: 'user', text: 'Busca sus materiales', turnId: '33333333-3333-4333-8333-333333333333' },
    ] }] }));
  vi.mocked(getRecentDurableRequests).mockResolvedValue([
    { requestId: '22222222-2222-4222-8222-222222222222', threadId: 'thread-voice',
      status: 'running', text: 'Analiza mis documentos', model: 'auto', effort: 'medium',
      createdAt: '2026-10-18T12:00:00Z', sourceLiveTurnId: '11111111-1111-4111-8111-111111111111' },
    { requestId: '44444444-4444-4444-8444-444444444444', threadId: 'thread-two',
      status: 'queued', text: 'Busca sus materiales', model: 'auto', effort: 'medium',
      createdAt: '2026-10-18T12:00:01Z', sourceLiveTurnId: '33333333-3333-4333-8333-333333333333' },
  ]);
  render(<Recovery />);
  await waitFor(() => expect(watchDurableRequest).toHaveBeenCalledTimes(2));
  expect(useUiStore.getState().pendingReply?.requestId).toBe('22222222-2222-4222-8222-222222222222');
  act(() => vi.mocked(watchDurableRequest).mock.calls[0][0].settled({
    requestId: '22222222-2222-4222-8222-222222222222', threadId: 'thread-voice',
    status: 'success', sourceLiveTurnId: '11111111-1111-4111-8111-111111111111',
    response: { reply: 'Primer resultado.', model: 'gemini-3.5-flash', effort: 'medium' },
  }));
  expect(useUiStore.getState().pendingReply?.requestId).toBe('44444444-4444-4444-8444-444444444444');
  act(() => vi.mocked(watchDurableRequest).mock.calls[1][0].settled({
    requestId: '44444444-4444-4444-8444-444444444444', threadId: 'thread-two',
    status: 'success', sourceLiveTurnId: '33333333-3333-4333-8333-333333333333',
    response: { reply: 'Segundo resultado.', model: 'gemini-3.5-flash', effort: 'medium' },
  }));
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().threads.map(thread => thread.messages.length)).toEqual([1, 1]);
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalledTimes(2);
});

it('si el trabajo Live ya terminó antes de recuperar, retira el progreso y relee su respuesta guardada', async () => {
  setUi({ pendingReply: { threadId: 'thread-voice', requestId: '22222222-2222-4222-8222-222222222222',
    label: 'Preparando tu respuesta…' } });
  vi.mocked(getRecentDurableRequests).mockResolvedValue([{ requestId: '22222222-2222-4222-8222-222222222222',
    threadId: 'thread-voice', status: 'success', text: 'Analiza mis documentos', model: 'auto',
    effort: 'medium', createdAt: '2026-10-18T12:00:00Z',
    sourceLiveTurnId: '11111111-1111-4111-8111-111111111111' }]);
  render(<Recovery />);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(watchDurableRequest).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads[0].messages).toHaveLength(1);
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalled();
});
