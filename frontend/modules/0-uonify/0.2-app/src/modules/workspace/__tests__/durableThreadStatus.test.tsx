import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { Composer } from '../components/composer/Composer';
import { useComposerStore } from '../hooks/composerStore';
import { sendLivePrompt } from '../hooks/liveConversation';
import { CHAT_RETRY_LATER } from '../hooks/conversationNotice';
import { settleDurableRequest } from '../hooks/durableDelivery';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { forgetManualDurableRetry, MANUAL_RETRY_STATUS, manualDurableRetryOf,
  rememberManualDurableRetry } from '../hooks/manualDurableRetry';
import { setUi, useUiStore } from '../hooks/uiStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';

const account = 'sellerify@example.test';
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account,
  useSession: () => ({ status: 'ready', user: { email: account } }) }));

function mountChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConversationActiveIndicator /><Composer /></QueryClientProvider>);
}
const messagesOf = (threadId: string) => useWorkspaceStore.getState().threads.find(thread => thread.id === threadId)?.messages;

beforeEach(() => {
  window.dispatchEvent(new Event('uonify:identity-changed'));
  resetWorkspaceStore();
  useWorkspaceStore.setState({ historyAccount: account, activeThreadId: 'thread-a',
    threads: [
      { id: 'thread-a', title: 'Basic Mini Bricks', service: null, view: 'default', messages: [] },
      { id: 'thread-b', title: 'Otro producto', service: null, view: 'default', messages: [] },
    ] });
  useComposerStore.setState({ status: '', statusThreadId: null, threadStatuses: {}, draft: '' });
  useGooglePreferences.setState({ account, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
  setUi({ pendingReply: null });
});
afterEach(() => { window.dispatchEvent(new Event('uonify:identity-changed')); vi.restoreAllMocks(); });

it.each([
  ['unknown', CHAT_RETRY_LATER],
  ['error', 'Google ha rechazado esta petición.'],
] as const)('conserva el resultado %s en A cuando llega mientras B está abierto', async (state, message) => {
  let requestId = '';
  let resolveStatus: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(path => path === `/uony/requests/${requestId}`
    ? new Promise(resolve => { resolveStatus = resolve; }) : Promise.reject(new Error(`Unexpected GET ${path}`)));
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, value) => {
    requestId = (value as { requestId: string }).requestId;
    return { requestId, threadId: 'thread-a', status: 'queued' };
  });
  mountChat();
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(resolveStatus).toBeDefined());
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setStatus('Aviso general del otro hilo.');
  });
  await act(async () => resolveStatus?.({ requestId, threadId: 'thread-a', status: state,
    ...(state === 'error' ? { error: { code: 'provider_rejected', message } } : {}) }));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Aviso general del otro hilo.');
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('');
  // Lote 6: el resultado de A queda en su conversación; ni B ni el compositor lo reciben.
  expect(useComposerStore.getState().threadStatuses['thread-a']).toBeUndefined();
  expect(messagesOf('thread-a')).toEqual([expect.objectContaining({ role: 'user', requestId }),
    { role: 'assistant', text: message, model: 'uonify-guide', requestId, requestStatus: state }]);
  expect(messagesOf('thread-b')).toEqual([]);
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledOnce();
});

it.each([404, 410])('conserva en A el GET %i mientras B mantiene su propio borrador', async code => {
  let requestId = '';
  const get = vi.spyOn(api, 'get').mockImplementation(path => path === `/uony/requests/${requestId}`
    ? Promise.reject(new ApiError(code, { error: 'request_not_found' }))
    : Promise.reject(new Error(`Unexpected GET ${path}`)));
  const post = vi.spyOn(api, 'post').mockImplementation((_path, value) => {
    requestId = (value as { requestId: string }).requestId;
    return Promise.reject(new DOMException('Sin respuesta', 'TimeoutError'));
  });
  mountChat();
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === `/uony/requests/${requestId}`)).toBe(true));
  const draftB = code === 404 ? '' : 'Borrador de B';
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setDraft(draftB);
  });
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull(), { timeout: 5000 });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(draftB);
  // Lote 6: el aviso «mismo intento» queda en la conversación de A; ni B ni el compositor lo reciben.
  expect(messagesOf('thread-a')?.at(-1)).toEqual({ role: 'assistant', text: MANUAL_RETRY_STATUS,
    model: 'uonify-guide', requestId, requestStatus: 'error' });
  expect(messagesOf('thread-b')).toEqual([]);
  expect(useComposerStore.getState().threadStatuses['thread-a'] ?? '').toBe('');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Crear Basic Mini Bricks');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(draftB);
  expect(post).toHaveBeenCalledOnce();
}, 6500);

it('prioriza un aviso nuevo del hilo activo y recupera su error final al despejarlo', () => {
  mountChat();
  act(() => useComposerStore.getState().setThreadStatus('thread-a', 'Error final de A.'));
  expect(screen.getByRole('status')).toHaveTextContent('Error final de A.');
  act(() => useComposerStore.getState().setStatus('Quita el adjunto para continuar.'));
  expect(screen.getByRole('status')).toHaveTextContent('Quita el adjunto para continuar.');
  act(() => useComposerStore.getState().setStatus(''));
  expect(screen.getByRole('status')).toHaveTextContent('Error final de A.');
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setStatus('Elige un modelo de Google.');
  });
  expect(screen.getByRole('status')).toHaveTextContent('Elige un modelo de Google.');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(screen.getByRole('status')).toHaveTextContent('Error final de A.');
});

it('asocia a A el fallo de lectura que llega mientras B está abierto', async () => {
  let requestId = '';
  let rejectRead: ((error: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(path => path === `/uony/requests/${requestId}`
    ? new Promise((_resolve, reject) => { rejectRead = reject; }) : Promise.reject(new Error(`Unexpected GET ${path}`)));
  vi.spyOn(api, 'post').mockImplementation(async (_path, value) => {
    requestId = (value as { requestId: string }).requestId;
    return { requestId, threadId: 'thread-a', status: 'queued' };
  });
  mountChat();
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(rejectRead).toBeDefined());
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setStatus('Micrófono de B activado.');
  });
  await act(async () => rejectRead?.(new ApiError(403, { error: 'forbidden' })));
  await waitFor(() => expect(useComposerStore.getState().threadStatuses['thread-a']).toContain('acceso'));
  expect(useComposerStore.getState().statusThreadId).toBe('thread-b');
  expect(screen.getByRole('status')).toHaveTextContent('Micrófono de B activado.');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(useComposerStore.getState().threadStatuses['thread-a']);
});

it.each([['nuevo', 403], ['nuevo', 429], ['existente', 409]] as const)(
  'conserva A %s y el borrador al recibir POST %i con B abierto', async (kind, code) => {
  let rejectPost: ((error: unknown) => void) | undefined;
  let threadA = 'thread-a';
  vi.spyOn(api, 'post').mockImplementation((_path, body) => {
    threadA = (body as { threadId: string }).threadId;
    return new Promise((_resolve, reject) => { rejectPost = reject; });
  });
  act(() => useWorkspaceStore.setState(state => kind === 'nuevo'
    ? { threads: state.threads.filter(thread => thread.id === 'thread-b'), activeThreadId: null }
    : { threads: state.threads.map(thread => thread.id === 'thread-a'
      ? { ...thread, messages: [{ role: 'assistant', text: 'Contexto previo de A.' }] } : thread) }));
  mountChat();
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(rejectPost).toBeDefined());
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setDraft('Borrador privado de B');
  });
  await act(async () => rejectPost?.(new ApiError(code, { error: 'invalid_model', message: 'Modelo no disponible.' })));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  // Lote 6: sin tarjeta de conexión, A se conserva con el aviso de Uony en su conversación.
  expect(useComposerStore.getState().threadStatuses[threadA]).toBeUndefined();
  expect(messagesOf(threadA)).toEqual([
    ...(kind === 'existente' ? [{ role: 'assistant', text: 'Contexto previo de A.' }] : []),
    { role: 'assistant', text: 'Modelo no disponible.', model: 'uonify-guide', requestStatus: 'error' }]);
  expect(messagesOf('thread-b')).toEqual([]);
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Borrador privado de B');
  act(() => useWorkspaceStore.getState().setActiveThread(threadA));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Crear Basic Mini Bricks');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Borrador privado de B');
});

it.each([
  ['materiales', { materialAction: { action: 'review' as const, sku: 'BASIC', analysisId: 'analysis-1' } }],
  ['formulario', { formResponse: { formId: 'form-1', answers: { weight: '500 g' } } }],
])('el rechazo de %s conserva el borrador libre de A y no lo sustituye por la acción', async (_name, action) => {
  let rejectPost: ((error: unknown) => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((_resolve, reject) => { rejectPost = reject; }));
  act(() => useComposerStore.getState().setDraft('Mi pregunta libre D'));
  mountChat();
  expect(sendLivePrompt('Texto estructurado S', { preserveDraft: true, ...action })).toBe(true);
  await waitFor(() => expect(rejectPost).toBeDefined());
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setDraft('Borrador de B');
  });
  await act(async () => rejectPost?.(new ApiError(403, { error: 'forbidden', message: 'Revisa el acceso.' })));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(useComposerStore.getState().draft).toBe('Mi pregunta libre D');
  // Lote 6: el rechazo queda en la conversación de A, no bajo el compositor.
  expect(useComposerStore.getState().threadStatuses['thread-a']).toBeUndefined();
  expect(messagesOf('thread-a')).toEqual([
    { role: 'assistant', text: 'Revisa el acceso.', model: 'uonify-guide', requestStatus: 'error' }]);
  expect(useComposerStore.getState().productLink).toBeNull();
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  expect(useComposerStore.getState().draft).toBe('Borrador de B');
  expect(post).toHaveBeenCalledOnce();
});

it('una respuesta confirmada de B no borra el UUID del reintento manual de A', async () => {
  let firstRequestId = '';
  const get = vi.spyOn(api, 'get').mockImplementation(path => path === `/uony/requests/${firstRequestId}`
    ? Promise.reject(new ApiError(404, { error: 'request_not_found' }))
    : Promise.reject(new Error(`Unexpected GET ${path}`)));
  const post = vi.spyOn(api, 'post').mockImplementation((_path, value) => {
    const sent = value as { requestId: string; threadId: string };
    if (post.mock.calls.length === 1) {
      firstRequestId = sent.requestId;
      return Promise.reject(new TypeError('Se perdió la respuesta al POST'));
    }
    if (sent.threadId === 'thread-b') return Promise.resolve({ reply: 'Respuesta de B.', model: 'gemini-3.5-flash', effort: 'medium' });
    return Promise.resolve({ requestId: sent.requestId, threadId: sent.threadId, status: 'success', response: {
      reply: 'Respuesta de Basic.', model: 'gemini-3.5-flash', effort: 'medium',
    } });
  });
  mountChat();
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === `/uony/requests/${firstRequestId}`)).toBe(true));
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull(), { timeout: 5000 });
  expect(sendLivePrompt('Pregunta de B')).toBe(true);
  await waitFor(() => expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'thread-b')
    ?.messages.at(-1)?.text).toBe('Respuesta de B.'));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(useComposerStore.getState().draft).toBe('Crear Basic Mini Bricks');
  expect(messagesOf('thread-a')?.at(-1)).toMatchObject({ role: 'assistant', text: MANUAL_RETRY_STATUS,
    requestId: firstRequestId });
  expect(sendLivePrompt(useComposerStore.getState().draft)).toBe(true);
  // La respuesta confirmada ocupa el lugar del aviso de su misma petición (un solo mensaje de Uony).
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  await waitFor(() => expect(messagesOf('thread-a')?.at(-1)).toMatchObject({ role: 'assistant', text: 'Respuesta de Basic.' }));
  expect(messagesOf('thread-a')?.filter(message => message.role === 'assistant'
    && message.requestId === firstRequestId)).toHaveLength(1);
  expect(post).toHaveBeenCalledTimes(3);
  expect((post.mock.calls[2][1] as { requestId: string }).requestId).toBe(firstRequestId);
  expect(messagesOf('thread-a')?.filter(message => message.role === 'user'
    && message.requestId === firstRequestId)).toHaveLength(1);
  expect(manualDurableRetryOf(account, useWorkspaceStore.getState().historyEpoch,
    'thread-a', 'Crear Basic Mini Bricks')).toBeNull();
}, 8000);

it('retira el reintento de su hilo al reconciliar el resultado, borrarlo o cambiar de cuenta', () => {
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const retry = { account, epoch, threadId: 'thread-a', text: 'Crear Basic Mini Bricks', requestId: 'request-a', body: {} };
  rememberManualDurableRetry(retry);
  act(() => settleDurableRequest(account, epoch, { requestId: 'request-a', threadId: 'thread-a', status: 'success',
    response: { reply: 'Confirmada.', model: 'gemini-3.5-flash', effort: 'medium' } }));
  expect(manualDurableRetryOf(account, epoch, 'thread-a', retry.text)).toBeNull();
  rememberManualDurableRetry(retry);
  act(() => useWorkspaceStore.setState(state => ({ threads: state.threads.filter(thread => thread.id !== 'thread-a') })));
  expect(manualDurableRetryOf(account, epoch, 'thread-a', retry.text)).toBeNull();
  rememberManualDurableRetry({ ...retry, threadId: 'thread-b' });
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  expect(manualDurableRetryOf(account, epoch, 'thread-b', retry.text)).toBeNull();
});

it('un resultado de A mientras B escribe no traslada el borrador de B al volver a A', () => {
  const epoch = useWorkspaceStore.getState().historyEpoch;
  rememberManualDurableRetry({ account, epoch, threadId: 'thread-a', text: 'Crear Basic Mini Bricks',
    requestId: 'request-a', body: {} });
  act(() => {
    useComposerStore.getState().setDraft('Crear Basic Mini Bricks');
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setDraft('Borrador privado de B');
    forgetManualDurableRetry(account, epoch, 'thread-a', 'request-a');
    useWorkspaceStore.getState().setActiveThread('thread-a');
  });
  expect(useComposerStore.getState().draft).toBe('');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  expect(useComposerStore.getState().draft).toBe('Borrador privado de B');
});
