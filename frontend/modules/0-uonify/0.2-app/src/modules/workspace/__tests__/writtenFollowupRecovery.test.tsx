import { act, cleanup, render } from '@testing-library/react';
import { api, ApiError } from '@/shared/api/client';
import { isDurableRequest, type DurableRequest, type DurableRequestSummary } from '../api/durableRequests';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';
import { useComposerStore } from '../hooks/composerStore';
import { useLiveWorkProgress } from '../hooks/liveWorkProgress';
import { useDurableRecovery } from '../hooks/useDurableRecovery';
import { setUi, useUiStore } from '../hooks/uiStore';
import { useWrittenFollowups } from '../hooks/writtenFollowup';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import * as replyEvents from '../model/events';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'recovery@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
const ACCOUNT = 'recovery@example.test';
const EPOCH = 12;
const THREAD = 'first-product-thread';
const OTHER = 'other-thread';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const original: DurableRequestSummary = { requestId: A, threadId: THREAD, status: 'running',
  text: 'Analiza los documentos', model: 'auto', effort: 'medium', createdAt: '2026-10-19T06:00:00Z',
  progress: { stage: 'consulting_google', seq: 3 } };
const followup: DurableRequestSummary = { requestId: B, targetRequestId: A, threadId: THREAD, status: 'running',
  text: '¿Cómo va la solicitud?', model: 'auto', effort: 'medium', createdAt: '2026-10-19T06:00:05Z',
  progress: { stage: 'consulting_google', seq: 1 } };
const success = (request: DurableRequestSummary, reply: string): DurableRequestSummary => ({ ...request,
  status: 'success', response: { reply, model: 'gemini-3.5-flash', effort: 'medium' } });
const messages = (threadId = THREAD) => useWorkspaceStore.getState().threads.find(item => item.id === threadId)!.messages;
const activeLine = () => document.querySelector('.conversation-active-indicator');
function deferred() {
  let resolve!: (value: DurableRequest) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DurableRequest>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Harness() { useDurableRecovery(); return <ConversationActiveIndicator />; }
async function start(recent: DurableRequestSummary[] = [followup, original]) {
  const reads = new Map([[A, deferred()], [B, deferred()]]);
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('No debe enviar POST al recuperar'));
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/requests/recent') return { requests: recent };
    if (path === '/uony/requests/unresolved') return { requests: [], nextCursor: null };
    const read = reads.get(path.split('/').at(-1)!);
    if (read) return read.promise;
    throw new Error(`GET inesperado: ${path}`);
  });
  const emitted = vi.spyOn(replyEvents, 'emitAssistantReply');
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<Harness />); });
  return { reads, post, get, emitted, view };
}

beforeEach(() => {
  window.dispatchEvent(new Event('uonify:identity-changed'));
  vi.useFakeTimers();
  identity.account = ACCOUNT;
  resetWorkspaceStore();
  useWorkspaceStore.setState({ historyAccount: ACCOUNT, historyEpoch: EPOCH, activeThreadId: THREAD,
    retryHistory: vi.fn(), threads: [
      { id: THREAD, title: '1er producto', service: null, view: 'default',
        messages: [{ role: 'user', requestId: A, text: original.text }] },
      { id: OTHER, title: 'Otro hilo', service: null, view: 'default', messages: [] },
    ] });
  setUi({ pendingReply: null, liveText: '' });
  useComposerStore.setState({ draft: 'Mi borrador intacto', status: '', statusThreadId: null, threadStatuses: {} });
  useWrittenFollowups.setState({ pending: [] });
  useLiveWorkProgress.setState({ turns: [], work: [] });
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('uonify:identity-changed'));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('recupera A+B aunque B llegue primero, sin sustituir el trabajo ni su progreso', async () => {
  const { reads, get, post } = await start();
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  expect(activeLine()).toHaveTextContent('Uony está preparando tu respuesta…');
  expect(document.querySelectorAll('.conversation-active-indicator')).toHaveLength(1);
  expect(useWrittenFollowups.getState().pending).toEqual([{ account: ACCOUNT, epoch: EPOCH, threadId: THREAD, requestId: B }]);
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${A}`)).toHaveLength(1);
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${B}`)).toHaveLength(1);
  await act(async () => reads.get(B)!.resolve(success(followup, 'El análisis sigue en curso.')));
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  expect(activeLine()).toHaveTextContent('Uony está preparando tu respuesta…');
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(messages().filter(item => item.requestId === B)).toHaveLength(2);
  expect(useComposerStore.getState().draft).toBe('Mi borrador intacto');
  expect(post).not.toHaveBeenCalled();
});

it('si A finaliza primero, B mantiene su propio indicador y termina sin otra ejecución', async () => {
  const { reads, post } = await start();
  await act(async () => reads.get(A)!.resolve(success(original, 'Análisis terminado.')));
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(activeLine()).toHaveTextContent('Consultando tu solicitud…');
  expect(useWrittenFollowups.getState().pending).toHaveLength(1);
  await act(async () => reads.get(B)!.resolve(success(followup, 'El análisis ya terminó.')));
  expect(activeLine()).toBeNull();
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(messages().filter(item => item.role === 'assistant').map(item => item.requestId)).toEqual([A, B]);
  expect(post).not.toHaveBeenCalled();
});

it('A ya terminal y B activa recupera únicamente el indicador de la consulta', async () => {
  const { reads, get, post } = await start([followup, success(original, 'Resultado guardado.')]);
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(activeLine()).toHaveTextContent('Consultando tu solicitud…');
  expect(get.mock.calls.some(([path]) => path === `/uony/requests/${A}`)).toBe(false);
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalled();
  await act(async () => reads.get(B)!.resolve(success(followup, 'Tu resultado está guardado.')));
  expect(activeLine()).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('B ya exitosa se relee en el historial, sin repetir su locución ni limpiar avisos de A', async () => {
  useComposerStore.getState().setThreadStatus(THREAD, 'Revisa la conexión de este trabajo.');
  const { get, emitted, post } = await start([success(followup, 'Respuesta ya guardada.'), original]);
  expect(get.mock.calls.some(([path]) => path === `/uony/requests/${B}`)).toBe(false);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(messages().some(item => item.text === 'Respuesta ya guardada.')).toBe(false);
  expect(useWorkspaceStore.getState().retryHistory).toHaveBeenCalled();
  expect(useComposerStore.getState().threadStatuses[THREAD]).toBe('Revisa la conexión de este trabajo.');
  expect(emitted).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it.each(['error', 'unknown'] as const)('B terminal %s conserva su pregunta y el seguimiento de A', async status => {
  const { get, post } = await start([{ ...followup, status,
    error: { code: 'read_error', message: 'No pude confirmar esa consulta.' } }, original]);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  expect(activeLine()).toHaveTextContent('Uony está preparando tu respuesta…');
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  // Lote 6: el recibo de B se lee en la conversación, tras su pregunta; nada bajo el compositor.
  expect(messages().filter(item => item.requestId === B)).toEqual([
    expect.objectContaining({ role: 'user', text: followup.text }),
    { role: 'assistant', text: 'No pude confirmar esa consulta.', model: 'uonify-guide', requestId: B, requestStatus: status },
  ]);
  expect(useComposerStore.getState().threadStatuses[THREAD]).toBeUndefined();
  expect(useComposerStore.getState().draft).toBe('Mi borrador intacto');
  expect(get.mock.calls.some(([path]) => path === `/uony/requests/${B}`)).toBe(false);
  expect(post).not.toHaveBeenCalled();
});

it('un error B histórico no reemplaza el aviso del trabajo posterior', async () => {
  useComposerStore.getState().setThreadStatus(THREAD, 'Aviso vigente del trabajo nuevo.');
  await start([{ ...followup, status: 'error', createdAt: '2026-10-19T05:55:00Z',
    error: { code: 'old_error', message: 'Error antiguo.' } }, original]);
  expect(useComposerStore.getState().threadStatuses[THREAD]).toBe('Aviso vigente del trabajo nuevo.');
  expect(messages().some(item => item.requestId === B)).toBe(false);
});

it('cambiar de cuenta descarta las respuestas pendientes de A y B', async () => {
  const { reads, emitted, get } = await start();
  get.mockResolvedValue({ requests: [], nextCursor: null });
  act(() => {
    identity.account = 'another@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
    useWorkspaceStore.setState({ historyAccount: identity.account, historyEpoch: EPOCH + 1,
      threads: [{ id: THREAD, title: 'Cuenta nueva', service: null, view: 'default', messages: [] }] });
    setUi({ pendingReply: null });
    useComposerStore.getState().setDraft('Borrador de la cuenta nueva');
  });
  await act(async () => {
    reads.get(A)!.resolve(success(original, 'Resultado de otra cuenta.'));
    reads.get(B)!.resolve(success(followup, 'Estado de otra cuenta.'));
  });
  expect(messages()).toEqual([]);
  expect(useComposerStore.getState().draft).toBe('Borrador de la cuenta nueva');
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(emitted).not.toHaveBeenCalled();
});

it('cambiar de hilo conserva B en el original, sin locución ni cambios en el borrador actual', async () => {
  const { reads, emitted } = await start();
  act(() => {
    useWorkspaceStore.getState().setActiveThread(OTHER);
    useComposerStore.getState().setDraft('Texto del otro hilo');
  });
  expect(activeLine()).toBeNull();
  await act(async () => reads.get(B)!.resolve(success(followup, 'El análisis sigue trabajando.')));
  expect(messages().filter(item => item.requestId === B)).toHaveLength(2);
  expect(messages(OTHER)).toEqual([]);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  expect(useComposerStore.getState().draft).toBe('Texto del otro hilo');
  expect(emitted).not.toHaveBeenCalled();
});

it('un GET con targetRequestId cambiado no entrega un resultado de otra solicitud', async () => {
  const { reads, post } = await start();
  await act(async () => reads.get(B)!.resolve({ ...success(followup, 'Respuesta de otro trabajo.'), targetRequestId: C }));
  expect(messages().some(item => item.text === 'Respuesta de otro trabajo.')).toBe(false);
  expect(useWrittenFollowups.getState().pending).toHaveLength(1);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  reads.set(B, deferred());
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => reads.get(B)!.resolve(success(followup, 'Estado del trabajo correcto.')));
  expect(messages().at(-1)?.text).toBe('Estado del trabajo correcto.');
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(post).not.toHaveBeenCalled();
});

it('dos lecturas 404 retiran solo B, conservan la pregunta y no vuelven a enviarla', async () => {
  const { reads, post } = await start();
  await act(async () => reads.get(B)!.reject(new ApiError(404, {})));
  reads.set(B, deferred());
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => reads.get(B)!.reject(new ApiError(404, {})));
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  // Lote 6: Uony lo explica en la conversación tras la pregunta B, y nada queda bajo el compositor.
  expect(messages().filter(item => item.requestId === B)).toEqual([
    expect.objectContaining({ role: 'user', text: followup.text }),
    { role: 'assistant', model: 'uonify-guide', requestId: B, requestStatus: 'error',
      text: 'No podemos confirmar esta consulta. Conservamos tu pregunta y no la enviaremos otra vez.' },
  ]);
  expect(useComposerStore.getState().threadStatuses[THREAD] ?? '').toBe('');
  expect(useComposerStore.getState().draft).toBe('Mi borrador intacto');
  expect(post).not.toHaveBeenCalled();
});

it('remontar la recuperación no duplica lectores ni la respuesta de B', async () => {
  const { reads, get, view, emitted } = await start();
  view.unmount();
  await act(async () => { render(<Harness />); });
  expect(useWrittenFollowups.getState().pending).toHaveLength(1);
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${A}`)).toHaveLength(1);
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${B}`)).toHaveLength(1);
  await act(async () => reads.get(B)!.resolve(success(followup, 'Una única respuesta.')));
  expect(messages().filter(item => item.role === 'assistant' && item.requestId === B)).toHaveLength(1);
  expect(useWrittenFollowups.getState().pending).toEqual([]);
  expect(emitted).toHaveBeenCalledOnce();
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
});

it('recuperar B no borra un aviso accionable que llegó durante su fallo de lectura', async () => {
  const { reads } = await start();
  await act(async () => reads.get(B)!.reject(new ApiError(503, {})));
  act(() => useComposerStore.getState().setThreadStatus(THREAD, 'Acción pendiente del trabajo A.'));
  reads.set(B, deferred());
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => reads.get(B)!.resolve(success(followup, 'El trabajo sigue su curso.')));
  expect(useComposerStore.getState().threadStatuses[THREAD]).toBe('Acción pendiente del trabajo A.');
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
});

it('el DTO rechaza un destino mal formado o circular, y permite respuestas normales sin destino', () => {
  expect(isDurableRequest(original)).toBe(true);
  expect(isDurableRequest(followup)).toBe(true);
  expect(isDurableRequest({ ...followup, targetRequestId: B })).toBe(false);
  expect(isDurableRequest({ ...followup, targetRequestId: 4 })).toBe(false);
  expect(isDurableRequest({ ...followup, targetRequestId: 'otra-solicitud' })).toBe(false);
});
