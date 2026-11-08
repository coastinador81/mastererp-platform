import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { useLiveHistory, sendLivePrompt } from '../hooks/liveConversation';
import { historyKey, HISTORY_WAIT } from '../hooks/liveHistory';
import { submitPendingFirstIntent } from '../hooks/initialIntent';
import { useWorkspaceStore, resetWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';
import { MANUAL_RETRY_STATUS, manualDurableRetryOf } from '../hooks/manualDurableRetry';
import type { Thread } from '../model/workspaceState';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ status: 'ready', user: { email: identity.account } }),
  acknowledgePendingPrompt: vi.fn(), readPendingPrompt: () => '' }));
function History() { useLiveHistory(); return null; }
const saved: Thread = { id: 'saved-thread', title: 'Mi producto', service: null, view: 'default', messages: [{ role: 'assistant', text: 'Dato confirmado' }] };
let client: QueryClient;
beforeEach(() => {
  identity.account = 'one@example.test'; resetWorkspaceStore(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: 'Quiero crear Basic Mini Bricks', status: '' });
  useGooglePreferences.setState({ account: identity.account, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { client.clear(); queryClient.clear(); vi.restoreAllMocks(); });
const mount = (strict = false) => render(<QueryClientProvider client={client}>{strict ? <StrictMode><History /></StrictMode> : <History />}</QueryClientProvider>);

it('un error inicial permite volver a consultar con Enviar, conserva el texto y no lo envía automáticamente', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValueOnce(new ApiError(503, { error: 'temporary', message: 'private' }))
    .mockResolvedValue({ threads: [] });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Empecemos con tus materiales.' });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyError).toBe(true));
  // Lote 6: el fallo del historial no se anuncia bajo el compositor; Enviar solo muestra la espera.
  expect(useComposerStore.getState().status).toBe('');
  expect(useWorkspaceStore.getState().historyAccount).toBeNull();
  expect(sendLivePrompt(useComposerStore.getState().draft)).toBe(false);
  expect(useComposerStore.getState().status).toBe(HISTORY_WAIT);
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(get).toHaveBeenCalledTimes(2); expect(post).not.toHaveBeenCalled();
  expect(useComposerStore.getState().draft).toBe('Quiero crear Basic Mini Bricks');
  expect(useComposerStore.getState().status).toBe('');
  expect(sendLivePrompt(useComposerStore.getState().draft)).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post).toHaveBeenCalledOnce(); expect(useWorkspaceStore.getState().threads).toHaveLength(1);
});

it('una actualización de fondo fallida no bloquea el historial ya aplicado ni cambia su hilo', async () => {
  vi.spyOn(api, 'get').mockResolvedValueOnce({ threads: [saved] }).mockRejectedValue(new Error('temporary'));
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Seguimos.' });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  await act(async () => { await client.refetchQueries({ queryKey: historyKey(identity.account, useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(useWorkspaceStore.getState().historyError).toBe(true));
  expect(useWorkspaceStore.getState().activeThreadId).toBe(saved.id);
  expect(sendLivePrompt('Seguimos con mi producto')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(post).toHaveBeenCalledOnce(); expect(useWorkspaceStore.getState().threads[0].messages[0].text).toBe('Dato confirmado');
});

it('un GET anterior al envío no borra mensajes nuevos aunque llegue después de terminar el POST', async () => {
  let finishOld: ((value: unknown) => void) | undefined;
  const canonical = { ...saved, messages: [...saved.messages, { role: 'user' as const, text: 'Mi siguiente paso' }, { role: 'assistant' as const, text: 'Dato nuevo guardado' }] };
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ threads: [saved] })
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValue({ threads: [canonical] });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ reply: 'Dato nuevo guardado' });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  let refreshing: Promise<void> | undefined;
  act(() => { refreshing = client.refetchQueries({ queryKey: historyKey(identity.account, useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(finishOld).toBeDefined());
  expect(sendLivePrompt('Mi siguiente paso')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  await act(async () => { finishOld?.({ threads: [saved] }); await refreshing; });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  expect(useWorkspaceStore.getState().threads[0].messages.map(message => message.text)).toEqual(canonical.messages.map(message => message.text));
  expect(post).toHaveBeenCalledOnce();
});

it('un GET anterior al enlace Live no borra el hilo local aunque llegue después de bound', async () => {
  let finishOld: ((value: unknown) => void) | undefined;
  let calls = 0;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path !== '/uony/threads') throw new Error(`Unexpected GET ${path}`);
    calls += 1;
    if (calls === 1) return Promise.resolve({ threads: [] });
    if (calls === 2) return new Promise(resolve => { finishOld = resolve; });
    const id = useWorkspaceStore.getState().activeThreadId!;
    return Promise.resolve({ threads: [{ id, title: 'Conversación por voz', service: null,
      view: 'default', messages: [] }] });
  });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  let id = '';
  act(() => { id = useWorkspaceStore.getState().createThread({ title: 'Conversación por voz',
    service: null, view: 'default', pendingLiveBind: true }).id; });
  let stale: Promise<void> | undefined;
  act(() => { stale = client.refetchQueries({ queryKey: historyKey(identity.account,
    useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(finishOld).toBeDefined());
  act(() => useWorkspaceStore.getState().markLiveThreadBound(id));
  await act(async () => { finishOld?.({ threads: [] }); await stale; });
  expect(useWorkspaceStore.getState().activeThreadId).toBe(id);
  expect(useWorkspaceStore.getState().threads.some(thread => thread.id === id)).toBe(true);
  expect(useWorkspaceStore.getState().pendingLiveThreadIds).toContain(id);
  expect(useWorkspaceStore.getState().boundLiveThreadIds).toContain(id);
  await act(async () => { await client.refetchQueries({ queryKey: historyKey(identity.account,
    useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(useWorkspaceStore.getState().pendingLiveThreadIds).toEqual([]));
  expect(useWorkspaceStore.getState().activeThreadId).toBe(id);
  expect(useWorkspaceStore.getState().boundLiveThreadIds).toEqual([]);
});

it('un GET de Live iniciado antes del texto final no borra ni desordena el turno recibido', async () => {
  let finishOld: ((value: unknown) => void) | undefined;
  let finishCanonical: ((value: unknown) => void) | undefined;
  const voiceUser = { role: 'user' as const, text: 'Quiero crear Basic', turnId: 'voice-user-1' };
  const voiceReply = { role: 'assistant' as const, text: 'Empezamos por tus materiales', turnId: 'voice-reply-1' };
  const canonical = { ...saved, messages: [...saved.messages, voiceUser, voiceReply] };
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ threads: [saved] })
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishCanonical = resolve; }));
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  let stale: Promise<void> | undefined;
  act(() => { stale = client.refetchQueries({ queryKey: historyKey(identity.account,
    useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(finishOld).toBeDefined());
  const revision = useWorkspaceStore.getState().historyRevision;
  act(() => {
    useWorkspaceStore.getState().insertLiveUserMessage(saved.id, voiceUser, 1);
    useWorkspaceStore.getState().pushMessage(saved.id, voiceReply);
  });
  expect(useWorkspaceStore.getState().historyRevision).toBeGreaterThan(revision);
  await act(async () => { finishOld?.({ threads: [saved] }); await stale; });
  await waitFor(() => expect(finishCanonical).toBeDefined());
  expect(useWorkspaceStore.getState().threads[0].messages.map(message => message.text))
    .toEqual(canonical.messages.map(message => message.text));
  await act(async () => { finishCanonical?.({ threads: [canonical] }); });
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.map(message => message.turnId))
    .toEqual(canonical.messages.map(message => message.turnId)));
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.turnId === 'voice-user-1')).toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(3);
});

it('el cierre antes de bound no resucita un hilo Live provisional por un GET antiguo', async () => {
  let finishOld: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockResolvedValueOnce({ threads: [] })
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValue({ threads: [] });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  let id = '';
  act(() => { id = useWorkspaceStore.getState().createThread({ title: 'Conversación por voz',
    service: null, view: 'default', pendingLiveBind: true }).id; });
  let stale: Promise<void> | undefined;
  act(() => { stale = client.refetchQueries({ queryKey: historyKey(identity.account,
    useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(finishOld).toBeDefined());
  act(() => useWorkspaceStore.getState().discardPendingLiveThread(id));
  await act(async () => { finishOld?.({ threads: [] }); await stale; });
  expect(useWorkspaceStore.getState().activeThreadId).toBeNull();
  expect(useWorkspaceStore.getState().threads.some(thread => thread.id === id)).toBe(false);
  expect(useWorkspaceStore.getState().pendingLiveThreadIds).toEqual([]);
  expect(useComposerStore.getState().draft).toBe('Quiero crear Basic Mini Bricks');
});

it('el mismo correo tras cambiar identidad exige una lectura nueva y descarta el GET de la sesión anterior', async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  const get = vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
  const post = vi.spyOn(api, 'post');
  mount(); await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  const firstSignal = get.mock.calls[0][1]?.signal;
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => { resolvers[0]({ threads: [saved] }); });
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(useWorkspaceStore.getState().historyAccount).toBeNull();
  await act(async () => { resolvers[1]({ threads: [] }); });
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(useWorkspaceStore.getState().threads).toEqual([]); expect(post).not.toHaveBeenCalled();
});

it('StrictMode y remontar el lector no envían nada ni cambian la elección de conversación', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ threads: [saved, { ...saved, id: 'other-thread' }] });
  const post = vi.spyOn(api, 'post');
  const view = mount(true); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => useWorkspaceStore.getState().setActiveThread(saved.id));
  view.unmount(); mount(true);
  await waitFor(() => expect(useWorkspaceStore.getState().historyLoading).toBe(false));
  expect(useWorkspaceStore.getState().activeThreadId).toBe(saved.id); expect(post).not.toHaveBeenCalled();
});

it('dos lectores comparten una hidratación y no se revalidan entre sí sin fin', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ threads: [saved] });
  const post = vi.spyOn(api, 'post');
  render(<QueryClientProvider client={client}><History /><History /></QueryClientProvider>);
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  await act(async () => { await Promise.resolve(); });
  expect(get).toHaveBeenCalledOnce(); expect(post).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
});

it.each(['sin A', 'A sin el intento', 'A con resultado', 'A con resultado y texto nuevo'] as const)(
  'conserva el UUID incierto al refrescar B y reconcilia %s del servidor', async mode => {
  const threadA: Thread = { id: 'thread-a', title: 'Basic Mini Bricks', service: null, view: 'default',
    messages: [{ role: 'assistant', text: 'Datos previos de A.' }] };
  const threadB: Thread = { id: 'thread-b', title: 'Otro producto', service: null, view: 'default', messages: [] };
  let serverThreads = [threadA, threadB];
  let requestA = '';
  const get = vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: serverThreads });
    if (path === `/uony/requests/${requestA}`) return Promise.reject(new ApiError(404, { error: 'request_not_found' }));
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  const post = vi.spyOn(api, 'post').mockImplementation((_path, value) => {
    const sent = value as { requestId: string; threadId: string };
    if (sent.threadId === 'thread-a' && !requestA) {
      requestA = sent.requestId;
      return Promise.reject(new TypeError('Se perdió la respuesta al POST'));
    }
    if (sent.threadId === 'thread-b') {
      serverThreads = [
        ...(mode === 'sin A' ? [] : [{ ...threadA, messages: mode.startsWith('A con resultado')
          ? [...threadA.messages, { role: 'user' as const, text: 'Crear Basic Mini Bricks', requestId: requestA },
            { role: 'assistant' as const, text: 'Ya respondí A.', requestId: requestA }]
          : threadA.messages }]),
        { ...threadB, messages: [{ role: 'user', text: 'Pregunta de B', requestId: sent.requestId },
          { role: 'assistant', text: 'Respuesta de B.', requestId: sent.requestId }] },
      ];
      return Promise.resolve({ requestId: sent.requestId, threadId: sent.threadId, status: 'success',
        response: { reply: 'Respuesta de B.', model: 'gemini-3.5-flash', effort: 'medium' } });
    }
    return Promise.resolve({ requestId: sent.requestId, threadId: sent.threadId, status: 'success',
      response: { reply: 'Respuesta de A.', model: 'gemini-3.5-flash', effort: 'medium' } });
  });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === `/uony/requests/${requestA}`)).toBe(true));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull(), { timeout: 5000 });
  expect(manualDurableRetryOf(identity.account, useWorkspaceStore.getState().historyEpoch,
    'thread-a', 'Crear Basic Mini Bricks')).not.toBeNull();
  if (mode === 'A con resultado y texto nuevo') {
    act(() => useComposerStore.getState().setDraft('Ahora quiero comparar variantes.'));
  }
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  expect(sendLivePrompt('Pregunta de B')).toBe(true);
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path === '/uony/threads').length).toBeGreaterThan(1));
  await waitFor(() => expect(useWorkspaceStore.getState().threads.find(thread => thread.id === 'thread-b')
    ?.messages.at(-1)?.text).toBe('Respuesta de B.'));
  const localA = useWorkspaceStore.getState().threads.find(thread => thread.id === 'thread-a');
  expect(localA).toBeDefined();
  expect(localA?.messages.filter(message => message.requestId === requestA && message.role === 'user')).toHaveLength(1);
  // Lote 6: sin A en el servidor se conserva el aviso local «mismo intento»; con A, manda el servidor.
  expect(localA?.messages.filter(message => message.requestId === requestA && message.role === 'assistant')
    .map(message => message.text)).toEqual(mode === 'sin A' ? [MANUAL_RETRY_STATUS]
    : mode.startsWith('A con resultado') ? ['Ya respondí A.'] : []);
  act(() => useWorkspaceStore.getState().setActiveThread('thread-a'));
  if (mode.startsWith('A con resultado')) {
    expect(manualDurableRetryOf(identity.account, useWorkspaceStore.getState().historyEpoch,
      'thread-a', 'Crear Basic Mini Bricks')).toBeNull();
    expect(useComposerStore.getState().threadStatuses['thread-a'] ?? '').toBe('');
    expect(useComposerStore.getState().draft).toBe(mode === 'A con resultado y texto nuevo'
      ? 'Ahora quiero comparar variantes.' : '');
  } else {
    expect(useComposerStore.getState().draft).toBe('Crear Basic Mini Bricks');
    expect(sendLivePrompt(useComposerStore.getState().draft)).toBe(true);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect((post.mock.calls[2][1] as { requestId: string }).requestId).toBe(requestA);
  }
}, 9000);

it('un GET de B no borra el hilo local nuevo cuyo POST fue rechazado y espera corrección manual', async () => {
  const threadB: Thread = { id: 'thread-b', title: 'Otro producto', service: null, view: 'default', messages: [] };
  const get = vi.spyOn(api, 'get').mockResolvedValue({ threads: [threadB] });
  let rejectPost: ((error: unknown) => void) | undefined;
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((_resolve, reject) => { rejectPost = reject; }));
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  act(() => useWorkspaceStore.getState().setActiveThread(null));
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(rejectPost).toBeDefined());
  const threadA = useWorkspaceStore.getState().activeThreadId;
  expect(threadA).toBeTruthy();
  act(() => {
    useWorkspaceStore.getState().setActiveThread('thread-b');
    useComposerStore.getState().setDraft('Borrador de B');
  });
  await act(async () => rejectPost?.(new ApiError(429, { error: 'quota_exceeded', message: 'Revisa el límite de Google.' })));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  await act(async () => { await client.refetchQueries({ queryKey: historyKey(identity.account, useWorkspaceStore.getState().historyEpoch) }); });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  // Lote 6: el hilo local se conserva con el aviso de Uony en su conversación, no bajo el compositor.
  expect(useWorkspaceStore.getState().threads.find(thread => thread.id === threadA)?.messages).toEqual([
    { role: 'assistant', text: 'Revisa el límite de Google.', model: 'uonify-guide', requestStatus: 'error' }]);
  expect(useComposerStore.getState().threadStatuses[threadA!]).toBeUndefined();
  expect(useComposerStore.getState().draft).toBe('Borrador de B');
  act(() => useWorkspaceStore.getState().setActiveThread(threadA));
  expect(useComposerStore.getState().draft).toBe('Crear Basic Mini Bricks');
  act(() => useWorkspaceStore.getState().setActiveThread('thread-b'));
  expect(useComposerStore.getState().draft).toBe('Borrador de B');
  expect(post).toHaveBeenCalledOnce();
});

it('una reserva inicial anterior al mismo correo no envía IA ni libera el bloqueo de la sesión nueva', async () => {
  function selection() {
    useGooglePreferences.setState({ account: identity.account, saving: false, data: {
      models: [{ id: 'gemini-3.5-flash', label: 'Flash', short: 'Flash', detail: '', efforts: ['medium'] }],
      efforts: [{ id: 'medium', label: 'Medio' }], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
  }
  function reserve(text: string) {
    queryClient.setQueryData(['uony-initial-intent', identity.account, useWorkspaceStore.getState().historyEpoch], { firstIntent: text });
    return submitPendingFirstIntent(text);
  }
  const finish: Array<(value: unknown) => void> = [];
  const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise(resolve => finish.push(resolve)));
  selection(); const first = reserve('Primera petición');
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  selection(); const second = reserve('Petición nueva');
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish[0]({ delivery: { requestId: 'old-request', threadId: 'old-thread', status: 'pending',
      text: 'Primera petición', model: 'auto', effort: 'medium', message: '' } });
    await first;
  });
  await reserve('Petición nueva');
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls.every(([path]) => path === '/onboarding/first-intent/claim')).toBe(true);
  await act(async () => { finish[1]({ delivery: null }); await second; });
  expect(useWorkspaceStore.getState().threads).toEqual([]);
});

it.each([null, {}, { threads: [{ id: 'broken', messages: null }] }])('una respuesta malformada no se confunde con un historial vacío: %j', async response => {
  vi.spyOn(api, 'get').mockResolvedValue(response);
  const post = vi.spyOn(api, 'post'); mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyError).toBe(true));
  expect(useComposerStore.getState().status).toBe('');
  expect(useWorkspaceStore.getState().historyAccount).toBeNull();
  expect(useWorkspaceStore.getState().threads).toEqual([]); expect(post).not.toHaveBeenCalled();
});
