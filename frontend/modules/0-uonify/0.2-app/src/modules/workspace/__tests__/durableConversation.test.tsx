import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { ApiError } from '@/shared/api/client';
import { sendLivePrompt, useLiveHistory } from '../hooks/liveConversation';
import { getUnresolvedDurableRequests } from '../api/durableRequests';
import { useDurableRecovery } from '../hooks/useDurableRecovery';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { useComposerStore } from '../hooks/composerStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { setUi, useUiStore } from '../hooks/uiStore';
import { DURABLE_POST_UNCERTAIN } from '../hooks/durableDelivery';
import { DURABLE_READ_FORBIDDEN, DURABLE_READ_UNAUTHORIZED } from '../hooks/durableRequestWatcher';
import { MANUAL_RETRY_STATUS } from '../hooks/manualDurableRetry';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'one@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  useSession: () => ({ status: 'ready', user: { email: identity.account } }) }));
function Harness() { useLiveHistory(); useDurableRecovery(); return null; }
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness /></QueryClientProvider>);
const activeStatus = () => {
  const threadId = useWorkspaceStore.getState().activeThreadId;
  const composer = useComposerStore.getState();
  return (threadId && composer.threadStatuses[threadId]) || composer.status;
};

beforeEach(() => {
  window.dispatchEvent(new Event('uonify:identity-changed'));
  identity.account = 'one@example.test'; resetWorkspaceStore(); setUi({ pendingReply: null });
  useComposerStore.setState({ draft: '', status: '' });
  useGooglePreferences.setState({ account: identity.account, saving: false, data: {
    models: [], efforts: [], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' } });
});
afterEach(() => { window.dispatchEvent(new Event('uonify:identity-changed')); vi.restoreAllMocks(); });

it('POST 202 consulta el mismo requestId y entrega una sola respuesta, sin repetir Gemini', async () => {
  let requestId = '';
  let threadId = '';
  let finished = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: finished ? [{ id: threadId, title: 'Basic', service: null, view: 'default', messages: [
      { role: 'user', text: 'Quiero Basic Mini Bricks', requestId },
      { role: 'assistant', text: '¿Tienes sus documentos?', requestId, model: 'gemini-3.5-flash', effort: 'medium' },
    ] }] : [] };
    if (path === '/uony/requests/recent') return { requests: [] };
    if (path === `/uony/requests/${requestId}`) {
      finished = true;
      return { requestId, threadId, status: 'success', response: { reply: '¿Tienes sus documentos?', model: 'gemini-3.5-flash', effort: 'medium' } };
    }
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return { requestId, threadId, status: 'queued' };
  });
  mount();
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === '/uony/requests/recent')).toBe(true));
  expect(sendLivePrompt('Quiero Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages.at(-1)?.text).toBe('¿Tienes sus documentos?'));
  expect(post).toHaveBeenCalledOnce();
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${requestId}`)).toHaveLength(1);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.requestId === requestId)).toHaveLength(2);
});

it('retira el aviso transitorio al recuperar el GET y entrega Basic una sola vez', async () => {
  let requestId = '';
  let threadId = '';
  let reads = 0;
  let finished = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: finished ? [{ id: threadId, title: 'Basic', service: null,
      view: 'default', messages: [{ role: 'user', text: 'Continuar Basic Mini Bricks', requestId },
        { role: 'assistant', text: 'Seguimos con Basic Mini Bricks.', requestId, model: 'gemini-3.5-flash', effort: 'medium' }] }] : [] };
    if (path === '/uony/requests/recent' || path === '/uony/requests/unresolved') return { requests: [], nextCursor: null };
    if (path === `/uony/requests/${requestId}`) {
      reads += 1;
      if (reads === 1) throw new ApiError(503, { error: 'temporarily_unavailable' });
      if (reads === 2) return { requestId, threadId, status: 'running', progress: { stage: 'consulting_google', seq: 3 } };
      finished = true;
      return { requestId, threadId, status: 'success', response: {
        reply: 'Seguimos con Basic Mini Bricks.', model: 'gemini-3.5-flash', effort: 'medium',
      } };
    }
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return { requestId, threadId, status: 'queued' };
  });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Continuar Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(useComposerStore.getState().status).toBe('Seguimos consultando tu petición. Tu trabajo está guardado.'));
  act(() => useComposerStore.getState().setDraft('Mi siguiente pregunta'));
  await waitFor(() => {
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(useComposerStore.getState().status).toBe('');
    expect(useUiStore.getState().pendingReply?.label).toBe('Uony está preparando tu respuesta…');
  }, { timeout: 3500 });
  expect(useComposerStore.getState().draft).toBe('Mi siguiente pregunta');
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages.some(message =>
    message.role === 'assistant' && message.requestId === requestId)).toBe(true), { timeout: 3500 });
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${requestId}`)).toHaveLength(3);
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.requestId === requestId)).toHaveLength(2);
  expect(post).toHaveBeenCalledOnce();
}, 8000);

it('una lectura recuperada no borra un aviso accionable de la misma conversación', async () => {
  let requestId = '';
  let threadId = '';
  let reads = 0;
  let finished = false;
  let resolveRunning: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: finished ? [{ id: threadId, title: 'Basic',
      service: null, view: 'default', messages: [{ role: 'user', text: 'Continuar Basic', requestId },
        { role: 'assistant', text: 'Basic está listo.', requestId, model: 'gemini-3.5-flash', effort: 'medium' }] }] : [] });
    if (path === '/uony/requests/recent' || path === '/uony/requests/unresolved') return Promise.resolve({ requests: [], nextCursor: null });
    if (path === `/uony/requests/${requestId}`) {
      reads += 1;
      if (reads <= 2) return Promise.reject(new ApiError(503, { error: 'temporarily_unavailable' }));
      if (reads === 3) return new Promise(resolve => { resolveRunning = resolve; });
      finished = true;
      return Promise.resolve({ requestId, threadId, status: 'success', response: {
        reply: 'Basic está listo.', model: 'gemini-3.5-flash', effort: 'medium',
      } });
    }
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return { requestId, threadId, status: 'queued' };
  });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Continuar Basic')).toBe(true);
  await waitFor(() => expect(useComposerStore.getState().status).toBe('Seguimos consultando tu petición. Tu trabajo está guardado.'));
  act(() => useComposerStore.getState().setStatus('Revisa tu conexión con Google antes de continuar.'));
  await waitFor(() => expect(reads).toBe(2), { timeout: 3500 });
  expect(useComposerStore.getState().status).toBe('Revisa tu conexión con Google antes de continuar.');
  await waitFor(() => expect(resolveRunning).toBeDefined(), { timeout: 5500 });
  await act(async () => resolveRunning?.({ requestId, threadId, status: 'running', progress: { stage: 'consulting_google', seq: 3 } }));
  await waitFor(() => expect(useUiStore.getState().pendingReply?.label).toBe('Uony está preparando tu respuesta…'));
  expect(useComposerStore.getState().status).toBe('Revisa tu conexión con Google antes de continuar.');
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0]?.messages.some(message =>
    message.role === 'assistant' && message.requestId === requestId)).toBe(true), { timeout: 3500 });
  expect(useComposerStore.getState().status).toBe('Revisa tu conexión con Google antes de continuar.');
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.requestId === requestId)).toHaveLength(2);
  expect(post).toHaveBeenCalledOnce();
}, 12000);

it('limpia el aviso inicial al volver la lista de peticiones, sin enviar el borrador', async () => {
  let recentReads = 0;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: [] };
    if (path === '/uony/requests/recent') {
      recentReads += 1;
      if (recentReads === 1) throw new ApiError(503, { error: 'temporarily_unavailable' });
      return { requests: [] };
    }
    if (path === '/uony/requests/unresolved') return { requests: [], nextCursor: null };
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  useComposerStore.getState().setDraft('Quiero crear Basic Mini Bricks');
  mount();
  await waitFor(() => expect(useComposerStore.getState().status).toBe(
    'Estamos recuperando el estado de tu petición. Espera a que vuelva la conexión.'));
  await waitFor(() => {
    expect(recentReads).toBe(2);
    expect(useComposerStore.getState().status).toBe('');
  }, { timeout: 7000 });
  expect(useComposerStore.getState().draft).toBe('Quiero crear Basic Mini Bricks');
  expect(useUiStore.getState().pendingReply).toBeNull();
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(post).not.toHaveBeenCalled();
}, 9000);

it('un segundo fallo de /recent y su recuperación conservan el aviso accionable', async () => {
  let recentReads = 0;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/uony/threads') return { threads: [] };
    if (path === '/uony/requests/recent') {
      recentReads += 1;
      if (recentReads <= 2) throw new ApiError(503, { error: 'temporarily_unavailable' });
      return { requests: [] };
    }
    if (path === '/uony/requests/unresolved') return { requests: [], nextCursor: null };
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  useComposerStore.getState().setDraft('Quiero crear Basic Mini Bricks');
  mount();
  await waitFor(() => expect(useComposerStore.getState().status).toBe(
    'Estamos recuperando el estado de tu petición. Espera a que vuelva la conexión.'));
  act(() => useComposerStore.getState().setStatus('Conecta Google para continuar.'));
  await waitFor(() => expect(recentReads).toBe(2), { timeout: 7000 });
  expect(useComposerStore.getState().status).toBe('Conecta Google para continuar.');
  await waitFor(() => expect(recentReads).toBe(3), { timeout: 7000 });
  expect(useComposerStore.getState().status).toBe('Conecta Google para continuar.');
  expect(useComposerStore.getState().draft).toBe('Quiero crear Basic Mini Bricks');
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(post).not.toHaveBeenCalled();
}, 15000);

it('un timeout de POST conserva el mensaje y consulta estado, sin otro POST ni liberar el envío', async () => {
  let requestId = '';
  let threadId = '';
  let settled = false;
  let resolveStatus: ((value: unknown) => void) | undefined;
  const unknown = 'Google no ha confirmado el resultado.';
  const get = vi.spyOn(api, 'get').mockImplementation(path => {
    // Como el servidor, el historial guarda el resultado incierto como mensaje de Uony.
    if (path === '/uony/threads') return Promise.resolve({ threads: threadId ? [{ id: threadId, title: 'Basic',
      service: null, view: 'default', messages: [{ role: 'user', text: 'Comprueba Basic', requestId }, ...(settled
        ? [{ role: 'assistant', text: unknown, model: 'uonify-guide', requestId, requestStatus: 'unknown' }] : [])] }] : [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${requestId}`) return new Promise(resolve => { resolveStatus = resolve; });
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation((_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return Promise.reject(new DOMException('El tiempo de espera se agotó.', 'TimeoutError'));
  });
  mount(); await waitFor(() => expect(get.mock.calls.some(([path]) => path === '/uony/requests/recent')).toBe(true));
  expect(sendLivePrompt('Comprueba Basic')).toBe(true);
  await waitFor(() => expect(resolveStatus).toBeDefined());
  expect(useWorkspaceStore.getState().threads[0].messages).toMatchObject([{ role: 'user', text: 'Comprueba Basic', requestId }]);
  expect(useUiStore.getState().pendingReply).toMatchObject({ requestId, threadId });
  expect(sendLivePrompt('Comprueba Basic')).toBe(false);
  expect(post).toHaveBeenCalledOnce();
  await act(async () => { settled = true; resolveStatus?.({ requestId, threadId, status: 'unknown',
    error: { code: 'consumption_unknown', message: unknown } }); });
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  // Lote 6: el resultado incierto se lee una vez en la conversación; nada bajo el compositor.
  expect(activeStatus()).toBe('');
  expect(useWorkspaceStore.getState().threads[0].messages).toMatchObject([{ role: 'user', requestId },
    { role: 'assistant', text: unknown, model: 'uonify-guide', requestId, requestStatus: 'unknown' }]);
  expect(post).toHaveBeenCalledOnce();
});

it('POST incierto pasa a la fase confirmada al leer GET 200 running, sin otro POST', async () => {
  let requestId = '';
  let threadId = '';
  let resolveStatus: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${requestId}`) return new Promise(resolve => { resolveStatus = resolve; });
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation((_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return Promise.reject(new DOMException('Tiempo agotado', 'TimeoutError'));
  });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Preparar Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(resolveStatus).toBeDefined());
  expect(useComposerStore.getState().status).toBe(DURABLE_POST_UNCERTAIN);
  await act(async () => resolveStatus?.({ requestId, threadId, status: 'running',
    progress: { stage: 'consulting_google', seq: 1 } }));
  await waitFor(() => {
    expect(useComposerStore.getState().status).toBe('');
    expect(useUiStore.getState().pendingReply?.label).toBe('Uony está preparando tu respuesta…');
  });
  expect(sendLivePrompt('Preparar Basic Mini Bricks')).toBe(false);
  expect(post).toHaveBeenCalledOnce();
});

it.each([[401, DURABLE_READ_UNAUTHORIZED], [403, DURABLE_READ_FORBIDDEN]])(
  'GET %i tras POST incierto conserva la reserva y ofrece recuperar el acceso', async (code, guidance) => {
  let requestId = '';
  let threadId = '';
  let reads = 0;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${requestId}`) {
      reads += 1;
      if (reads === 1) return Promise.reject(new ApiError(code, { error: 'access_denied' }));
      return Promise.resolve({ requestId, threadId, status: 'running', progress: { stage: 'consulting_google', seq: 2 } });
    }
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation((_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return Promise.reject(new DOMException('Tiempo agotado', 'TimeoutError'));
  });
  mount();
  await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(true);
  await waitFor(() => expect(useComposerStore.getState().status).toBe(guidance));
  expect(useUiStore.getState().pendingReply).toMatchObject({ requestId, threadId });
  expect(sendLivePrompt('Crear Basic Mini Bricks')).toBe(false);
  expect(post).toHaveBeenCalledOnce();
  await waitFor(() => {
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(useComposerStore.getState().status).toBe('');
    expect(useUiStore.getState().pendingReply?.label).toBe('Uony está preparando tu respuesta…');
  }, { timeout: 4500 });
  expect(post).toHaveBeenCalledOnce();
}, 6500);

it('reabrir consulta una petición activa y su resultado sin volver a enviar el mensaje', async () => {
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const threadId = 'thread-basic';
  let finished = false;
  let resolveStatus: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [{ id: threadId, title: 'Basic', service: null, view: 'default',
      messages: finished ? [{ role: 'user', requestId, text: 'Quiero crear Basic Mini Bricks' },
        { role: 'assistant', requestId, text: '¿Tienes los archivos del producto?', model: 'gemini-3.5-flash', effort: 'medium' }] : [] }] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [{ requestId, threadId,
      text: 'Quiero crear Basic Mini Bricks', model: 'auto', effort: 'medium', status: 'running', createdAt: '2026-10-16T12:00:00Z' }] });
    if (path === `/uony/requests/${requestId}`) return new Promise(resolve => { resolveStatus = resolve; });
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(resolveStatus).toBeDefined());
  expect(useWorkspaceStore.getState().threads[0].messages).toMatchObject([{ role: 'user', requestId, text: 'Quiero crear Basic Mini Bricks' }]);
  expect(useUiStore.getState().pendingReply).toMatchObject({ requestId, threadId });
  expect(post).not.toHaveBeenCalled();
  await act(async () => { finished = true; resolveStatus?.({ requestId, threadId, status: 'success',
    response: { reply: '¿Tienes los archivos del producto?', model: 'gemini-3.5-flash', effort: 'medium' } }); });
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.some(message => message.text === '¿Tienes los archivos del producto?')).toBe(true));
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.requestId === requestId)).toHaveLength(2);
  expect(post).not.toHaveBeenCalled();
});

it('una respuesta terminada después de cambiar de cuenta no entra en el nuevo espacio', async () => {
  let requestId = '';
  let threadId = '';
  let resolveStatus: ((value: unknown) => void) | undefined;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${requestId}`) return new Promise(resolve => { resolveStatus = resolve; });
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const sent = body as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return { requestId, threadId, status: 'running' };
  });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Mi producto privado')).toBe(true);
  await waitFor(() => expect(resolveStatus).toBeDefined());
  act(() => { identity.account = 'two@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async () => resolveStatus?.({ requestId, threadId, status: 'success',
    response: { reply: 'Respuesta privada', model: 'gemini-3.5-flash', effort: 'medium' } }));
  expect(useWorkspaceStore.getState().threads).toEqual([]);
  expect(useComposerStore.getState().draft).not.toBe('Mi producto privado');
  expect(post).toHaveBeenCalledOnce();
});

it('si el POST nunca se reservó, deja continuar con Enviar usando el mismo identificador', async () => {
  let missingId = '';
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${missingId}`) return Promise.reject(new ApiError(404, { error: 'not_found' }));
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, value) => {
    const sent = value as { requestId: string };
    if (!missingId) { missingId = sent.requestId; throw new TypeError('Sin conexión'); }
    return { reply: 'Ahora sí.', model: 'gemini-3.5-flash', effort: 'medium' };
  });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Pregunta conservada')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull(), { timeout: 6000 });
  expect(useComposerStore.getState().draft).toBe('Pregunta conservada');
  // Lote 6: Uony explica en la conversación cómo seguir con el mismo intento; nunca bajo el compositor.
  expect(useWorkspaceStore.getState().threads[0].messages).toEqual([{ role: 'assistant', text: MANUAL_RETRY_STATUS,
    model: 'uonify-guide', requestId: missingId, requestStatus: 'error' }]);
  expect(activeStatus()).toBe('');
  expect(post).toHaveBeenCalledOnce();
  expect(sendLivePrompt(useComposerStore.getState().draft)).toBe(true);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toBe('Ahora sí.'));
  expect(post).toHaveBeenCalledTimes(2);
  expect((post.mock.calls[1][1] as { requestId: string }).requestId).toBe(missingId);
});

it('un reenvío manual del mismo intento acepta el resultado terminal 200 sin abrir otro trabajo', async () => {
  let requestId = '';
  let threadId = '';
  let finished = false;
  vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: finished ? [{ id: threadId, title: 'La misma pregunta',
      service: null, view: 'default', messages: [{ role: 'user', requestId, text: 'La misma pregunta' },
        { role: 'assistant', requestId, text: 'La respuesta del primer intento tardío.', model: 'gemini-3.5-flash', effort: 'medium' }] }] : [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${requestId}`) return Promise.reject(new ApiError(404, { error: 'request_not_found' }));
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, value) => {
    const sent = value as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    if (post.mock.calls.length === 1) throw new TypeError('Se perdió la respuesta al POST');
    finished = true;
    return { requestId, threadId, status: 'success', response: {
      reply: 'La respuesta del primer intento tardío.', model: 'gemini-3.5-flash', effort: 'medium',
    } };
  });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('La misma pregunta')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull(), { timeout: 6000 });
  expect(sendLivePrompt(useComposerStore.getState().draft)).toBe(true);
  await waitFor(() => expect(useWorkspaceStore.getState().threads[0].messages.at(-1)?.text).toBe('La respuesta del primer intento tardío.'));
  expect(post).toHaveBeenCalledTimes(2);
  expect((post.mock.calls[1][1] as { requestId: string }).requestId).toBe(requestId);
});

it('un trabajo 202 borrado desde otra pestaña sale de la espera sin reenviar Gemini', async () => {
  let requestId = '';
  let threadId = '';
  const get = vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === `/uony/requests/${requestId}`) return Promise.reject(new ApiError(404, { error: 'request_not_found' }));
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, value) => {
    const sent = value as { requestId: string; threadId: string };
    requestId = sent.requestId; threadId = sent.threadId;
    return { requestId, threadId, status: 'queued' };
  });
  mount(); await waitFor(() => expect(useWorkspaceStore.getState().historyAccount).toBe(identity.account));
  expect(sendLivePrompt('Mi hilo ya fue eliminado')).toBe(true);
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull(), { timeout: 6000 });
  expect(get.mock.calls.filter(([path]) => path === `/uony/requests/${requestId}`)).toHaveLength(2);
  expect(useComposerStore.getState().draft).toBe('Mi hilo ya fue eliminado');
  // Lote 6: el aviso sigue a la pregunta en la conversación, sin repetirla ni ocupar el compositor.
  expect(useWorkspaceStore.getState().threads[0].messages).toMatchObject([{ role: 'user', requestId },
    { role: 'assistant', model: 'uonify-guide', requestId, requestStatus: 'error',
      text: 'La petición dejó de estar disponible. Conservamos tu texto y no la repetiremos automáticamente.' }]);
  expect(activeStatus()).not.toContain('no la repetiremos automáticamente');
  expect(post).toHaveBeenCalledOnce();
});

it('reabre consumos inciertos antiguos recorriendo sus páginas, sin otro POST', async () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const get = vi.spyOn(api, 'get').mockImplementation(path => {
    if (path === '/uony/threads') return Promise.resolve({ threads: [{ id: 'old', title: 'Una pregunta antigua', service: null,
      view: 'default', messages: [{ role: 'user', requestId: first, text: 'Una pregunta antigua' },
        { role: 'assistant', requestId: first, requestStatus: 'unknown', text: 'No podemos confirmar el consumo.' }] }] });
    if (path === '/uony/requests/recent') return Promise.resolve({ requests: [] });
    if (path === '/uony/requests/unresolved') return Promise.resolve({ requests: [{ requestId: first, threadId: 'old',
      status: 'unknown', text: 'Una pregunta antigua', createdAt: '2026-10-01T12:00:00Z',
      error: { code: 'consumption_unknown', message: 'No podemos confirmar el consumo.' } }], nextCursor: first });
    if (path === `/uony/requests/unresolved?after=${first}`) return Promise.resolve({ requests: [{ requestId: second, threadId: 'older',
      status: 'unknown', text: 'Otra pregunta antigua', createdAt: '2026-09-01T12:00:00Z',
      error: { code: 'consumption_unknown', message: 'No podemos confirmar el consumo.' } }], nextCursor: null });
    throw new Error(`Unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(get.mock.calls.some(([path]) => path === `/uony/requests/unresolved?after=${first}`)).toBe(true));
  // Lote 6: el resultado ya está en la conversación; reconciliarlo (y releer el historial) no lo repite
  // ni lo lleva bajo el compositor.
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path === '/uony/threads').length).toBeGreaterThanOrEqual(3));
  expect(activeStatus()).toBe('');
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.requestId === first)).toMatchObject([
    { role: 'user' }, { role: 'assistant', requestStatus: 'unknown', text: 'No podemos confirmar el consumo.' }]);
  expect(post).not.toHaveBeenCalled();
});

it('deduplica peticiones inciertas repetidas entre páginas', async () => {
  const requestId = '33333333-3333-4333-8333-333333333333';
  const row = { requestId, threadId: 'old', status: 'unknown', text: 'Pregunta', createdAt: '2026-10-01T12:00:00Z' };
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/uony/requests/unresolved'
    ? { requests: [row], nextCursor: requestId }
    : { requests: [row], nextCursor: null });
  expect(await getUnresolvedDurableRequests()).toEqual([row]);
});
