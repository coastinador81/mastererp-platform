import { api, ApiError } from '@/shared/api/client';
import { sendPrompt } from '../hooks/conversation';
import { useComposerStore } from '../hooks/composerStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi, useUiStore } from '../hooks/uiStore';

const account = 'sellerify@example.test';
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));

beforeEach(() => {
  resetWorkspaceStore();
  useWorkspaceStore.setState({ historyAccount: account, activeThreadId: 'thread-a', threads: [
    { id: 'thread-a', title: 'Basic Mini Bricks', service: null, view: 'default', messages: [] },
    { id: 'thread-b', title: 'Otro producto', service: null, view: 'default', messages: [] },
  ] });
  useComposerStore.setState({ draft: '', productLink: null, status: '', statusThreadId: null, threadStatuses: {} });
  setUi({ pendingReply: null });
});
afterEach(() => { window.dispatchEvent(new Event('uonify:identity-changed')); vi.restoreAllMocks(); });

it.each([403, 429])('POST %i de enlace con B abierto conserva la acción estructurada al volver a A', async code => {
  let rejectFirst: ((error: unknown) => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce({ reply: 'Ficha vinculada.', model: 'gemini-3.5-flash', effort: 'medium' });
  const text = 'Continuar con Basic Mini Bricks';
  useComposerStore.getState().prepareProductLink({ text, sku: 'BASIC', revision: 2, expectedVersion: 1,
    account, threadId: 'thread-a' });
  expect(sendPrompt(text)).toBe(true);
  await vi.waitFor(() => expect(rejectFirst).toBeDefined());
  const first = post.mock.calls[0][1] as { requestId: string; productAction: { sku: string; revision: number } };
  expect(first.productAction).toMatchObject({ action: 'link', sku: 'BASIC', revision: 2 });
  useWorkspaceStore.getState().setActiveThread('thread-b');
  useComposerStore.getState().setDraft('Borrador privado de B');
  rejectFirst?.(new ApiError(code, { error: 'quota_or_access', message: 'Espera para continuar.' }));
  await vi.waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  useWorkspaceStore.getState().setActiveThread('thread-a');
  expect(useComposerStore.getState().productLink).toMatchObject({ text, sku: 'BASIC', revision: 2,
    requestId: first.requestId });
  expect(sendPrompt(text)).toBe(true);
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1][1]).toMatchObject({ requestId: first.requestId,
    productAction: { action: 'link', sku: 'BASIC', revision: 2, expectedVersion: 1 } });
  useWorkspaceStore.getState().setActiveThread('thread-b');
  expect(useComposerStore.getState().draft).toBe('Borrador privado de B');
});

it('un conflicto 409 con B abierto exige reelección y no deja texto de enlace como chat libre', async () => {
  let rejectFirst: ((error: unknown) => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
  const text = 'Continuar con Basic Mini Bricks';
  useComposerStore.getState().prepareProductLink({ text, sku: 'BASIC', revision: 2, expectedVersion: 1,
    account, threadId: 'thread-a' });
  expect(sendPrompt(text)).toBe(true);
  await vi.waitFor(() => expect(rejectFirst).toBeDefined());
  useWorkspaceStore.getState().setActiveThread('thread-b');
  useComposerStore.getState().setDraft('Borrador privado de B');
  rejectFirst?.(new ApiError(409, { error: 'product_link_conflict', message: 'La ficha cambió.' }));
  await vi.waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  useWorkspaceStore.getState().setActiveThread('thread-a');
  // Lote 6: Uony pide reelegir la ficha en la conversación de A, no bajo el compositor.
  expect(useComposerStore.getState().threadStatuses['thread-a']).toBeUndefined();
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'thread-a')?.messages).toEqual([
    { role: 'assistant', model: 'uonify-guide', requestStatus: 'error',
      text: 'La ficha cambió. Vuelve a elegir la ficha desde Producto para confirmar sus datos actuales.' }]);
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'thread-b')?.messages).toEqual([]);
  expect(useComposerStore.getState().draft).toBe('');
  expect(useComposerStore.getState().productLink).toBeNull();
  useWorkspaceStore.getState().setActiveThread('thread-b');
  expect(useComposerStore.getState().draft).toBe('Borrador privado de B');
  expect(post).toHaveBeenCalledOnce();
});
