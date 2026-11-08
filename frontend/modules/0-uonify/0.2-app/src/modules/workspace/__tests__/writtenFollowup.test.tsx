import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { Composer } from '../components/composer/Composer';
import { rememberExpectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import type { DurableRequest } from '../api/durableRequests';
import { settleDurableRequest } from '../hooks/durableDelivery';
import { sendLivePrompt } from '../hooks/liveConversation';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { useLiveWorkProgress } from '../hooks/liveWorkProgress';
import { canSendWrittenFollowup, useWrittenFollowups } from '../hooks/writtenFollowup';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi, useUiStore } from '../hooks/uiStore';
import * as replyEvents from '../model/events';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  acknowledgePendingPrompt: vi.fn(), useSession: () => ({ user: null }) }));
vi.mock('../components/authBridge', () => ({
  requirePrompt: async (_text: string, run: () => void) => run(),
}));
vi.mock('../hooks/initialIntent', () => ({ submitPendingFirstIntent: () => false }));
vi.mock('../hooks/useSpeech', () => ({ useSpeech: () => vi.fn() }));
vi.mock('../components/navigation/Projects', () => ({ ProjectContext: () => null }));
vi.mock('../components/composer/GoogleAiPicker', () => ({ GoogleAiPicker: () => null }));
vi.mock('../components/composer/ContextUsage', () => ({ ContextUsage: () => null }));
vi.mock('../components/VoiceWelcome', () => ({ VoiceTalkButton: () => null }));

const ACCOUNT = 'sellerify@example.test';
const THREAD = 'first-product-thread';
const OTHER = 'other-thread';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const REQUEST_A = '22222222-2222-4222-8222-222222222222';
const EPOCH = 7;
const QUESTION = '¿Cómo va el análisis que te pedí?';
const ANSWER = 'El análisis sigue en curso; conserva el mismo trabajo.';
const pendingA = { threadId: THREAD, requestId: REQUEST_A, label: 'Analizando los documentos…' };
type Sent = { requestId: string; threadId: string; text: string; projectId: string | null };

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function success(sent: Pick<Sent, 'requestId' | 'threadId'>, reply = ANSWER): DurableRequest {
  return { ...sent, ...(sent.requestId !== REQUEST_A ? { targetRequestId: REQUEST_A } : {}),
    status: 'success', response: { reply, model: 'gemini-3.5-flash', effort: 'medium' } };
}
const messages = (threadId = THREAD) => useWorkspaceStore.getState().threads.find(item => item.id === threadId)!.messages;
const followup = () => useWrittenFollowups.getState().pending[0];
const activeLine = () => document.querySelector('.conversation-active-indicator');
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConversationActiveIndicator /><Composer /></QueryClientProvider>);
}
function send() { act(() => expect(sendLivePrompt(QUESTION)).toBe(true)); }

beforeEach(() => {
  window.dispatchEvent(new Event('uonify:identity-changed'));
  identity.account = ACCOUNT;
  sessionStorage.clear();
  resetWorkspaceStore();
  useWorkspaceStore.setState({ historyAccount: ACCOUNT, historyEpoch: EPOCH, activeThreadId: THREAD,
    activeProjectId: PROJECT, retryHistory: null, threads: [
      { id: THREAD, title: '1er producto', projectId: PROJECT, service: null, view: 'default',
        messages: [{ role: 'user', text: 'Analiza mis documentos', requestId: REQUEST_A }] },
      { id: OTHER, title: 'Otra conversación', projectId: null, service: null, view: 'default', messages: [] },
    ] });
  setUi({ pendingReply: pendingA, liveText: '' });
  useWrittenFollowups.setState({ pending: [] });
  useLiveWorkProgress.setState({ turns: [], work: [] });
  useComposerStore.setState({ draft: QUESTION, status: '', statusThreadId: null, threadStatuses: {},
    attachments: [], productLink: null, listening: null, moreOpen: false, picker: null, usageOpen: false });
  useGooglePreferences.setState({ account: ACCOUNT, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('uonify:identity-changed'));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('envía desde el compositor una sola consulta y conserva A, su indicador y el siguiente borrador durante POST lento', async () => {
  const response = deferred();
  const post = vi.spyOn(api, 'post').mockImplementation(() => response.promise);
  const get = vi.spyOn(api, 'get');
  const assignmentId = '33333333-3333-4333-8333-333333333333';
  expect(rememberExpectedAssignmentFocus(ACCOUNT, THREAD, assignmentId, 4)).toBe(true);
  mount();
  expect(screen.getByRole('button', { name: 'Enviar mensaje' })).not.toHaveAttribute('aria-disabled', 'true');
  fireEvent.submit(document.getElementById('composer')!);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  const sent = post.mock.calls[0][1] as Sent;
  expect(post.mock.calls[0][0]).toBe(`/uony/requests/${REQUEST_A}/followups`);
  expect(sent).toMatchObject({ threadId: THREAD, projectId: PROJECT, text: QUESTION, model: 'auto', effort: 'medium',
    expectedAssignmentFocus: { assignmentId, version: 4 } });
  expect(sent.requestId).not.toBe(REQUEST_A);
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  expect(activeLine()).toHaveTextContent(pendingA.label);
  expect(document.querySelectorAll('.conversation-active-indicator')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(screen.getByRole('textbox', { name: 'Escribe a Uony' }), { target: { value: 'Mi siguiente idea' } });
  fireEvent.submit(document.getElementById('composer')!);
  expect(post).toHaveBeenCalledOnce();
  await act(async () => response.resolve(success(sent)));
  expect(get).not.toHaveBeenCalled();
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  expect(activeLine()).toHaveTextContent(pendingA.label);
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Mi siguiente idea');
  expect(messages().filter(item => item.requestId === sent.requestId)).toHaveLength(2);
  expect(useWorkspaceStore.getState().threads).toHaveLength(2);
});

it('si A termina antes de B mantiene un único indicador para B hasta su respuesta', async () => {
  const response = deferred();
  const post = vi.spyOn(api, 'post').mockImplementation(() => response.promise);
  mount(); send();
  const sent = post.mock.calls[0][1] as Sent;
  act(() => {
    useComposerStore.getState().setDraft('Borrador que no se envía');
    settleDurableRequest(ACCOUNT, EPOCH, success({ requestId: REQUEST_A, threadId: THREAD }, 'Análisis terminado.'));
  });
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(activeLine()).toHaveTextContent('Consultando tu solicitud…');
  expect(document.querySelectorAll('.conversation-active-indicator')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toHaveAttribute('aria-disabled', 'true');
  await act(async () => response.resolve(success(sent)));
  expect(activeLine()).toBeNull();
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
  expect(useComposerStore.getState().draft).toBe('Borrador que no se envía');
  expect(messages().filter(item => item.role === 'assistant').map(item => item.requestId)).toEqual([REQUEST_A, sent.requestId]);
});

it('tras perder POST consulta el mismo identificador por GET y reconcilia la respuesta ya presente sin duplicarla', async () => {
  const read = deferred();
  const post = vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Network lost'));
  const get = vi.spyOn(api, 'get').mockImplementation(() => read.promise);
  send();
  const sent = post.mock.calls[0][1] as Sent;
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  expect(get.mock.calls[0][0]).toBe(`/uony/requests/${sent.requestId}`);
  act(() => {
    useComposerStore.getState().setDraft('Conserva esta idea');
    useWorkspaceStore.getState().pushMessage(THREAD, { role: 'assistant', requestId: sent.requestId, text: ANSWER });
  });
  expect(sendLivePrompt(QUESTION)).toBe(false);
  await act(async () => read.resolve(success(sent)));
  expect(post).toHaveBeenCalledOnce();
  expect(get).toHaveBeenCalledOnce();
  expect(messages().filter(item => item.requestId === sent.requestId && item.role === 'assistant')).toHaveLength(1);
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  expect(useComposerStore.getState().draft).toBe('Conserva esta idea');
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
});

it.each(['', 'Un borrador posterior'])('un rechazo 409 retira solo B y respeta el borrador %j', async draft => {
  const response = deferred();
  const post = vi.spyOn(api, 'post').mockImplementation(() => response.promise);
  const get = vi.spyOn(api, 'get');
  send();
  const sent = post.mock.calls[0][1] as Sent;
  act(() => useComposerStore.getState().setDraft(draft));
  await act(async () => response.reject(new ApiError(409, { message: 'La solicitud ya no coincide.' })));
  // Lote 6: la pregunta B se retira y Uony explica el rechazo en la conversación, con el identificador de B.
  expect(messages().filter(item => item.requestId === sent.requestId)).toEqual([{ role: 'assistant',
    text: 'La solicitud ya no coincide.', model: 'uonify-guide', requestId: sent.requestId, requestStatus: 'error' }]);
  expect(messages().some(item => item.requestId === REQUEST_A)).toBe(true);
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  expect(useComposerStore.getState().draft).toBe(draft || QUESTION);
  expect(useComposerStore.getState().threadStatuses[THREAD]).toBeUndefined();
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
  expect(get).not.toHaveBeenCalled();
});

it('una respuesta tardía tras cambiar de cuenta no escribe en la cuenta nueva', async () => {
  const response = deferred();
  const post = vi.spyOn(api, 'post').mockImplementation(() => response.promise);
  const emitted = vi.spyOn(replyEvents, 'emitAssistantReply');
  send();
  const sent = post.mock.calls[0][1] as Sent;
  act(() => {
    identity.account = 'other@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
    useWorkspaceStore.setState({ historyAccount: identity.account, historyEpoch: EPOCH + 1,
      threads: [{ id: THREAD, title: 'Cuenta nueva', service: null, view: 'default', messages: [] }] });
    useComposerStore.getState().setDraft('Texto de otra cuenta');
  });
  await act(async () => response.resolve(success(sent)));
  expect(messages()).toEqual([]);
  expect(useComposerStore.getState().draft).toBe('Texto de otra cuenta');
  expect(useComposerStore.getState().threadStatuses).toEqual({});
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
  expect(emitted).not.toHaveBeenCalled();
});

it('al cambiar de hilo guarda B en su hilo original sin anunciarla ni alterar el borrador actual', async () => {
  const response = deferred();
  const post = vi.spyOn(api, 'post').mockImplementation(() => response.promise);
  const emitted = vi.spyOn(replyEvents, 'emitAssistantReply');
  mount(); send();
  const sent = post.mock.calls[0][1] as Sent;
  act(() => {
    useWorkspaceStore.getState().setActiveThread(OTHER);
    useComposerStore.getState().setDraft('Texto del otro hilo');
  });
  expect(activeLine()).toBeNull();
  expect(canSendWrittenFollowup()).toBe(false);
  await act(async () => response.resolve(success(sent)));
  expect(messages().filter(item => item.requestId === sent.requestId)).toHaveLength(2);
  expect(messages(OTHER)).toEqual([]);
  expect(useComposerStore.getState().draft).toBe('Texto del otro hilo');
  expect(emitted).not.toHaveBeenCalled();
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  act(() => useWorkspaceStore.getState().setActiveThread(THREAD));
  expect(activeLine()).toHaveTextContent(pendingA.label);
});

it('un GET pendiente también ignora la respuesta después del cambio de identidad', async () => {
  const read = deferred();
  const post = vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Network lost'));
  const get = vi.spyOn(api, 'get').mockImplementation(() => read.promise);
  send();
  const sent = post.mock.calls[0][1] as Sent;
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  act(() => {
    identity.account = 'other@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
    useWorkspaceStore.setState({ historyAccount: identity.account, historyEpoch: EPOCH + 1,
      threads: [{ id: THREAD, title: 'Nueva', service: null, view: 'default', messages: [] }] });
  });
  await act(async () => read.resolve(success(sent)));
  expect(messages()).toEqual([]);
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
  expect(post).toHaveBeenCalledOnce();
});

it('rechaza acciones estructuradas, requisitos y el trabajo de otro hilo sin enviar consultas', () => {
  const post = vi.spyOn(api, 'post');
  expect(sendLivePrompt(QUESTION, { formResponse: { formId: 'form-1', answers: { answer: 'sí' } } })).toBe(false);
  expect(sendLivePrompt(QUESTION, { materialAction: { action: 'review', sku: 'BASIC', analysisId: PROJECT } })).toBe(false);
  expect(sendLivePrompt(QUESTION, { requirementsAction: { action: 'prepare', sku: 'BASIC' } })).toBe(false);
  setUi({ pendingReply: { ...pendingA, requirements: {} } });
  expect(canSendWrittenFollowup()).toBe(false);
  expect(sendLivePrompt(QUESTION)).toBe(false);
  setUi({ pendingReply: { ...pendingA, threadId: OTHER } });
  expect(canSendWrittenFollowup()).toBe(false);
  expect(sendLivePrompt(QUESTION)).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(useComposerStore.getState().draft).toBe(QUESTION);
  expect(messages()).toHaveLength(1);
});

it('reenviar la misma petición A con espacios o mayúsculas no crea una consulta B', () => {
  const post = vi.spyOn(api, 'post');
  expect(sendLivePrompt('Analiza mis documentos')).toBe(false);
  expect(sendLivePrompt('  ANALIZA   MIS DOCUMENTOS  ')).toBe(false);
  expect(post).not.toHaveBeenCalled();
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  expect(messages()).toHaveLength(1);
});

it('un POST con identidad discordante se recupera por GET del identificador propio', async () => {
  const read = deferred();
  const post = vi.spyOn(api, 'post').mockResolvedValue(success({ requestId: REQUEST_A, threadId: OTHER }, 'Respuesta ajena'));
  const get = vi.spyOn(api, 'get').mockImplementation(() => read.promise);
  send();
  const sent = post.mock.calls[0][1] as Sent;
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  expect(messages().some(item => item.text === 'Respuesta ajena')).toBe(false);
  expect(get.mock.calls[0][0]).toBe(`/uony/requests/${sent.requestId}`);
  await act(async () => read.resolve(success(sent)));
  expect(messages().at(-1)?.text).toBe(ANSWER);
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
});

it('retira solo el aviso transitorio al recuperar GET y conserva el trabajo y borrador', async () => {
  vi.useFakeTimers();
  const post = vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Network lost'));
  const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(503, {}));
  await act(async () => { expect(sendLivePrompt(QUESTION)).toBe(true); });
  const sent = post.mock.calls[0][1] as Sent;
  get.mockResolvedValue(success(sent));
  expect(followup()?.requestId).toBe(sent.requestId);
  expect(useComposerStore.getState().threadStatuses[THREAD]).toContain('recuperando tu consulta');
  act(() => useComposerStore.getState().setDraft('No borrar esta frase'));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(get).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenCalledOnce();
  expect(useComposerStore.getState().threadStatuses[THREAD]).toBeUndefined();
  expect(useComposerStore.getState().draft).toBe('No borrar esta frase');
  expect(useUiStore.getState().pendingReply).toEqual(pendingA);
  expect(useWrittenFollowups.getState().pending).toHaveLength(0);
});
