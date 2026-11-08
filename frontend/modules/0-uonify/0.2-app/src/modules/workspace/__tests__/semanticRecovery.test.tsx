import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { type DurableRequest } from '../api/durableRequests';
import { type SemanticRecovery } from '../api/semanticRecovery';
import { sendLivePrompt } from '../hooks/liveConversation';
import { observeLiveHandoff } from '../hooks/liveHandoff';
import { observeSemanticRecovery } from '../hooks/semanticRecovery';
import { useDurableRecovery } from '../hooks/useDurableRecovery';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { useLiveWorkProgress } from '../hooks/liveWorkProgress';
import { useWrittenFollowups } from '../hooks/writtenFollowup';
import { setUi, useUiStore } from '../hooks/uiStore';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { ConversationActiveIndicator } from '../components/ConversationActiveIndicator';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ email: 'recovery@uonify.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.email }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const threadId = 'thread-one';
const command = 'Recupera la petición anterior';
const provenance = 'La solicitud anterior sigue en curso. He recuperado su seguimiento sin volver a ejecutarla.';
const metadata = (id = B): SemanticRecovery => ({ logicalRequestId: A, recoveryCommandId: id,
  semanticAttemptId: A, businessExecutionId: A, businessRequestId: A, disposition: 'observing', businessStatus: 'running' });
const receipt = (id = B): DurableRequest => ({ requestId: id, threadId, status: 'success', semanticRecovery: metadata(id),
  response: { reply: provenance, model: 'auto', effort: 'medium' } });
const business: DurableRequest = { requestId: A, threadId, status: 'success',
  response: { reply: 'Resultado anterior de A', model: 'auto', effort: 'medium' } };
const messages = () => useWorkspaceStore.getState().threads[0].messages;
const epoch = () => useWorkspaceStore.getState().historyEpoch;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  window.dispatchEvent(new Event('uonify:identity-changed')); resetWorkspaceStore();
  useWorkspaceStore.setState({ historyAccount: identity.email, activeThreadId: threadId, retryHistory: vi.fn(),
    threads: [{ id: threadId, title: '1er producto', service: null, view: 'default', messages: [
      { role: 'user', requestId: A, text: 'Cuenta las carpetas de Drive' },
      { role: 'assistant', requestId: A, text: 'Resultado anterior de A' },
    ] }] });
  useComposerStore.setState({ draft: command, status: '', statusThreadId: null, threadStatuses: {} });
  useGooglePreferences.setState({ account: identity.email, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
  useWrittenFollowups.setState({ pending: [] }); useLiveWorkProgress.setState({ turns: [], work: [] });
  setUi({ pendingReply: null });
});
afterEach(() => { cleanup(); window.dispatchEvent(new Event('uonify:identity-changed')); vi.restoreAllMocks(); vi.useRealTimers(); });

it('una orden escrita B conserva el trabajo A, bloquea doble clic y no presenta su éxito antiguo como nuevo', async () => {
  const result = deferred<DurableRequest>(), readA = deferred<DurableRequest>();
  const post = vi.spyOn(api, 'post').mockImplementation(() => result.promise);
  const get = vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === `/uony/requests/${A}`) return readA.promise;
    throw new Error(`GET inesperado ${path}`);
  });
  render(<ConversationActiveIndicator />);
  act(() => { expect(sendLivePrompt(command, { requestId: B })).toBe(true); expect(sendLivePrompt(command)).toBe(false); });
  act(() => useComposerStore.getState().setDraft('Mi siguiente idea'));
  await act(async () => result.resolve(receipt()));
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledOnce();
  expect(post.mock.calls[0][0]).toBe('/uony/messages');
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  expect(screen.getByRole('status')).toHaveTextContent('Uony está trabajando');
  expect(messages().filter(item => item.requestId === B && item.role === 'assistant').map(item => item.text)).toEqual([provenance]);
  await act(async () => readA.resolve(business));
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(messages().filter(item => item.text === business.response!.reply)).toHaveLength(1);
  expect(useComposerStore.getState().draft).toBe('Mi siguiente idea');
});

it('tras perder ACK lee B y A sin reenviar ni clasificar automáticamente', async () => {
  const readA = deferred<DurableRequest>();
  const post = vi.spyOn(api, 'post').mockRejectedValue(new TypeError('ACK perdido'));
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === `/uony/requests/${B}`) return receipt();
    if (path === `/uony/requests/${A}`) return readA.promise;
    throw new Error(`GET inesperado ${path}`);
  });
  expect(sendLivePrompt(command, { requestId: B })).toBe(true);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(post).toHaveBeenCalledOnce();
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  await act(async () => readA.resolve(business));
  expect(post).toHaveBeenCalledOnce();
  expect(messages().filter(item => item.requestId === B && item.role === 'assistant')).toHaveLength(1);
});

it('la orden escrita con A pendiente conserva la ruta de seguimiento y un solo recibo propio', async () => {
  const result = deferred<DurableRequest>(), readA = deferred<DurableRequest>();
  const post = vi.spyOn(api, 'post').mockImplementation(() => result.promise);
  const get = vi.spyOn(api, 'get').mockImplementation(() => readA.promise);
  setUi({ pendingReply: { threadId, requestId: A, label: 'Contando las carpetas…' } });
  expect(sendLivePrompt(command)).toBe(true);
  expect(sendLivePrompt(command)).toBe(false);
  const sent = post.mock.calls[0][1] as { requestId: string };
  expect(post.mock.calls[0][0]).toBe(`/uony/requests/${A}/followups`);
  expect(sent.requestId).not.toBe(A);
  useComposerStore.getState().setDraft('Siguiente borrador');
  await act(async () => result.resolve({ ...receipt(sent.requestId), targetRequestId: A }));
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0][0]).toBe(`/uony/requests/${A}`);
  expect(messages().filter(item => item.requestId === sent.requestId && item.role === 'assistant')
    .map(item => item.text)).toEqual([provenance]);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  await act(async () => readA.resolve(business));
  expect(post).toHaveBeenCalledOnce();
  expect(useComposerStore.getState().draft).toBe('Siguiente borrador');
  expect(messages().filter(item => item.text === business.response!.reply)).toHaveLength(1);
});

it('voz y lectura concurrentes observan un solo trabajo, conservando otro job y el borrador', async () => {
  const readA = deferred<DurableRequest>();
  const post = vi.spyOn(api, 'post');
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path === `/uony/requests/${A}` ? readA.promise : receipt());
  const pending = { threadId, requestId: C, label: 'Otro trabajo activo…' };
  setUi({ pendingReply: pending }); useComposerStore.getState().setDraft('Borrador intacto');
  observeLiveHandoff({ type: 'handoff', threadId, turnId: C, requestId: B, status: 'success',
    intent: 'recover_request', semanticRecovery: metadata() }, identity.email, epoch());
  observeSemanticRecovery(identity.email, epoch(), receipt());
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${A}`)).toHaveLength(1);
  expect(useUiStore.getState().pendingReply).toEqual(pending);
  await act(async () => readA.resolve(business));
  expect(useUiStore.getState().pendingReply).toEqual(pending);
  expect(useComposerStore.getState().draft).toBe('Borrador intacto');
  expect(messages()).toHaveLength(2);
  expect(post).not.toHaveBeenCalled();
});

it.each(['reused', 'reconciliation_required', 'blocked'] as const)('el estado %s no dispara otra ejecución ni sondeo de un job inventado', disposition => {
  const post = vi.spyOn(api, 'post'), get = vi.spyOn(api, 'get');
  const semanticRecovery: SemanticRecovery = { ...metadata(), disposition,
    businessRequestId: disposition === 'reused' ? A : null, businessExecutionId: disposition === 'reused' ? A : null,
    businessStatus: disposition === 'reused' ? 'success' : null };
  observeSemanticRecovery(identity.email, epoch(), { ...receipt(), semanticRecovery });
  expect(post).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  expect(useUiStore.getState().pendingReply).toBeNull(); expect(messages()).toHaveLength(2);
});

it('recargar recupera B y observa A sin repetir la orden ni borrar el borrador', async () => {
  const readA = deferred<DurableRequest>(), post = vi.spyOn(api, 'post');
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/requests/recent') return { requests: [{ ...receipt(), text: command,
      model: 'auto', effort: 'medium', createdAt: '2026-10-19T12:00:00Z' }] };
    if (path === '/uony/requests/unresolved') return { requests: [], nextCursor: null };
    if (path === `/uony/requests/${A}`) return readA.promise;
    throw new Error(`GET inesperado ${path}`);
  });
  function Recovery() { useDurableRecovery(); return <ConversationActiveIndicator />; }
  render(<Recovery />);
  await waitFor(() => expect(useUiStore.getState().pendingReply?.requestId).toBe(A));
  expect(screen.getByRole('status')).toHaveTextContent('Uony está trabajando');
  await act(async () => readA.resolve(business));
  expect(post).not.toHaveBeenCalled(); expect(useComposerStore.getState().draft).toBe(command);
  expect(messages().filter(item => item.requestId === A)).toHaveLength(2);
});

it('C sigue el recibo B antes de la admisión y después observa A sin volver a entregar respuestas', async () => {
  const readB = deferred<DurableRequest>(), readA = deferred<DurableRequest>();
  const post = vi.spyOn(api, 'post');
  const get = vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === `/uony/requests/${B}`) return readB.promise;
    if (path === `/uony/requests/${A}`) return readA.promise;
    throw new Error(`GET inesperado ${path}`);
  });
  const observing = { ...receipt(C), semanticRecovery: { ...metadata(C),
    observedRequestId: B, businessRequestId: null, businessExecutionId: null, businessStatus: null } };
  useComposerStore.getState().setDraft('Borrador siguiente');
  observeSemanticRecovery(identity.email, epoch(), observing);
  observeSemanticRecovery(identity.email, epoch(), observing);
  expect(get).toHaveBeenCalledOnce();
  expect(useUiStore.getState().pendingReply).toMatchObject({ requestId: B,
    purpose: 'recover_request', label: 'Uony está recuperando el estado de tu solicitud…' });
  expect(useLiveWorkProgress.getState().work).toHaveLength(0);
  await act(async () => readB.resolve(receipt()));
  expect(get).toHaveBeenCalledTimes(2);
  expect(useUiStore.getState().pendingReply?.requestId).toBe(A);
  await act(async () => readA.resolve(business));
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(messages()).toHaveLength(2);
  expect(useComposerStore.getState().draft).toBe('Borrador siguiente');
  expect(post).not.toHaveBeenCalled();
});

it('C pasa del seguimiento de B al progreso real de B admitido y conserva un único GET activo', async () => {
  vi.useFakeTimers();
  const readB = deferred<DurableRequest>(), post = vi.spyOn(api, 'post');
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ ...receipt(), status: 'running',
    progress: { stage: 'checking_result', seq: 1 }, semanticRecovery: { ...metadata(),
      disposition: 'reclassified', businessRequestId: B, businessStatus: 'running', observedRequestId: null } })
    .mockImplementation(() => readB.promise);
  observeSemanticRecovery(identity.email, epoch(), { ...receipt(C), semanticRecovery: { ...metadata(C),
    observedRequestId: B, businessRequestId: null, businessExecutionId: null, businessStatus: null } });
  await act(async () => { await Promise.resolve(); });
  expect(useUiStore.getState().pendingReply).toMatchObject({ requestId: B,
    label: 'Uony está ultimando su respuesta…' });
  expect(useUiStore.getState().pendingReply?.purpose).toBeUndefined();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.every(([path]) => path === `/uony/requests/${B}`)).toBe(true);
  await act(async () => readB.resolve({ ...receipt(), semanticRecovery: { ...metadata(),
    disposition: 'reclassified', businessRequestId: B, businessStatus: 'success', observedRequestId: null } }));
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(messages()).toHaveLength(2);
  expect(post).not.toHaveBeenCalled();
});

it('un recibo B fallido cierra su interpretación previa y conserva otro trabajo activo', async () => {
  const readB = deferred<DurableRequest>(), post = vi.spyOn(api, 'post');
  vi.spyOn(api, 'get').mockImplementation(() => readB.promise);
  const scope = { account: identity.email, epoch: epoch(), threadId };
  useLiveWorkProgress.setState({ turns: [{ ...scope, turnId: B, interpreting: true, settled: false }],
    work: [{ ...scope, turnId: A, requestId: A, status: 'running', speech: 'idle' },
      { ...scope, turnId: B, requestId: B, status: 'running', speech: 'idle', intent: 'recover_request' }] });
  const pending = { threadId, requestId: A, label: 'Otro trabajo activo…' };
  setUi({ pendingReply: pending });
  const semanticRecovery: SemanticRecovery = { ...metadata(C), observedRequestId: B,
    businessRequestId: null, businessExecutionId: null, businessStatus: null };
  observeSemanticRecovery(identity.email, epoch(), { ...receipt(C), semanticRecovery });
  await act(async () => readB.resolve({ requestId: B, threadId, sourceLiveTurnId: B, status: 'error',
    error: { code: 'semantic_timeout', message: 'La interpretación agotó su tiempo. La solicitud se conserva.' } }));
  expect(useLiveWorkProgress.getState().turns[0]).toMatchObject({ interpreting: false, settled: true });
  expect(useLiveWorkProgress.getState().work.map(work => work.status)).toEqual(['running', 'error']);
  expect(useUiStore.getState().pendingReply).toEqual(pending);
  // Lote 6 (dueño): nada bajo el compositor; Uony lo dice en la conversación.
  expect(useComposerStore.getState().threadStatuses[threadId] ?? '').toBe('');
  expect(messages()).toHaveLength(3);
  expect(messages().at(-1)).toEqual(expect.objectContaining({ role: 'assistant', requestStatus: 'error',
    text: 'La interpretación agotó su tiempo. La solicitud se conserva.' }));
  expect(post).not.toHaveBeenCalled();
});
