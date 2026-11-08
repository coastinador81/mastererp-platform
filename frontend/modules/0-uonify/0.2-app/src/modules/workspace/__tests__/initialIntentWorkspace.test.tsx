import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import type { FirstIntentDelivery } from '@/modules/auth';
import { setActiveProduct, type PimProduct } from '@/shared/pim';
import { renderWorkspace, resetStores } from './harness';
import { useWorkspaceStore } from '../hooks/workspaceStore';
import { useGooglePreferences } from '../hooks/googlePreferences';
import { useComposerStore } from '../hooks/composerStore';
import { useUiStore } from '../hooks/uiStore';
import type { GoogleOptions } from '../hooks/googlePreferences';

const identity = vi.hoisted(() => ({ account: 'initial-intent@example.test' }));
vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account,
  acknowledgePendingPrompt: vi.fn(), readPendingPrompt: () => sessionStorage.getItem('uonify-auth-pending-prompt') || '', useSession: () => ({ status: 'ready', user: { email: identity.account } }),
  requirePrompt: async (_text: string, run: () => void) => run(), takePendingPrompt: () => '',
  ConversationActivationPanel: () => null, useConversationActivationOpen: () => false,
}));
vi.mock('../components/Topbar', () => ({ Topbar: () => <header>Uonify</header> }));
vi.mock('../components/navigation/NavDrawer', () => ({ NavDrawer: () => null }));
vi.mock('../components/limit/ChatGptLimitDialog', () => ({ ChatGptLimitDialog: () => null }));
vi.mock('../components/composer/ContextUsage', () => ({ ContextUsage: () => null }));
vi.mock('../hooks/useLimitWatcher', () => ({ useLimitWatcher: () => {}, resetLimitWatcher: () => {} }));

const text = 'Quiero crear Basic Mini Bricks desde mis documentos';
const reply = 'Prepararemos Basic Mini Bricks paso a paso. ¿Dónde tienes los documentos?';
const options: GoogleOptions = { models: [{ id: 'gemini-3.5-flash', label: 'Flash', short: 'Flash', detail: '', efforts: ['medium'] }], efforts: [{ id: 'medium', label: 'Medio' }], preferences: { model: 'auto', effort: 'medium' }, autoPolicy: '' };
const body = { requestId: '213af545-8009-481b-bdfb-1d0ad75ab1c3', threadId: 'first_intent_durable', text, model: 'auto', effort: 'medium' as const };
let delivery: FirstIntentDelivery | null;
let persisted = false;
beforeEach(() => {
  resetStores(); window.dispatchEvent(new Event('uonify:identity-changed'));
  useGooglePreferences.setState({ account: null, data: null, saving: false });
  delivery = null; persisted = false;
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('recupera la intención del servidor, espera historial/IA y no duplica al recargar; conserva un borrador nuevo: %s', async preserveNewDraft => {
  let finishHistory!: (value: unknown) => void;
  let finishOptions!: (value: GoogleOptions) => void;
  let firstHistory = true;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return { firstIntent: text, firstIntentDelivery: delivery } as never;
    if (path === '/uony/requests/recent') return { requests: [] } as never;
    if (path === '/uony/options') return new Promise<GoogleOptions>(resolve => { finishOptions = resolve; }) as never;
    if (path === '/uony/threads') {
      if (firstHistory) { firstHistory = false; return new Promise(resolve => { finishHistory = resolve; }) as never; }
      return { threads: persisted ? [{ id: body.threadId, title: text, service: null, view: 'default', messages: [{ role: 'user', text }, { role: 'assistant', text: reply, model: 'Flash', effort: 'medium' }] }] : [] } as never;
    }
    if (path === '/uony/projects') return { projects: [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
    if (path === '/onboarding/first-intent/claim') { delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never; }
    if (path === '/uony/messages') {
      expect(sent).toEqual(body);
      persisted = true; delivery = { ...body, status: 'complete', message: '' };
      return { reply, model: 'Flash', effort: 'medium' } as never;
    }
    throw new Error(`Operación inesperada: ${path}`);
  });
  const view = renderWorkspace();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(text));
  expect(sessionStorage.getItem('uonify-auth-pending-prompt')).toBeNull();
  expect(post).not.toHaveBeenCalled();
  await act(async () => finishHistory({ threads: [] }));
  expect(post).not.toHaveBeenCalled();
  if (preserveNewDraft) fireEvent.change(screen.getByRole('textbox', { name: 'Escribe a Uony' }), { target: { value: 'Este es otro borrador que estoy escribiendo' } });
  await act(async () => finishOptions(options));
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(preserveNewDraft ? 'Este es otro borrador que estoy escribiendo' : '');
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/first-intent/claim')).toHaveLength(1);
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
  expect(useWorkspaceStore.getState().threads).toHaveLength(1);
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.role === 'user')).toHaveLength(1);
  view.unmount(); resetStores();
  const again = renderWorkspace();
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  await waitFor(() => expect(useWorkspaceStore.getState().threads).toHaveLength(1));
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
  expect(screen.getAllByText(reply, { selector: '.message.assistant' })).toHaveLength(1);
  again.unmount();
});

it('la primera petición POST 202 continúa tras recargar con el mismo requestId y conserva otro borrador', async () => {
  let queued = false;
  let completed = false;
  const statusResolvers: Array<(value: unknown) => void> = [];
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return { firstIntent: text, firstIntentDelivery: delivery } as never;
    if (path === '/uony/options') return options as never;
    if (path === '/uony/projects') return { projects: [] } as never;
    if (path === '/uony/requests/recent') return { requests: queued && !completed ? [{ ...body, status: 'running', createdAt: '2026-10-16T12:00:00Z' }] : [] } as never;
    if (path === `/uony/requests/${body.requestId}`) return new Promise(resolve => statusResolvers.push(resolve)) as never;
    if (path === '/uony/threads') return { threads: completed ? [{ id: body.threadId, title: text, service: null, view: 'default', messages: [
      { role: 'user', text, requestId: body.requestId },
      { role: 'assistant', text: reply, requestId: body.requestId, model: 'gemini-3.5-flash', effort: 'medium' },
    ] }] : [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
    if (path === '/onboarding/first-intent/claim') { delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never; }
    if (path === '/uony/messages') {
      expect(sent).toEqual(body);
      queued = true; delivery = { ...body, status: 'sending', message: 'Uony está trabajando con tu primera petición.' };
      return { requestId: body.requestId, threadId: body.threadId, status: 'queued' } as never;
    }
    throw new Error(`Operación inesperada: ${path}`);
  });
  const first = renderWorkspace();
  await waitFor(() => expect(statusResolvers).toHaveLength(1));
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.role === 'user')).toHaveLength(1);
  first.unmount(); resetStores();
  useComposerStore.getState().setDraft('Tengo una segunda idea');
  const again = renderWorkspace();
  await waitFor(() => expect(statusResolvers).toHaveLength(2));
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.requestId === body.requestId)).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Tengo una segunda idea');
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
  await act(async () => {
    completed = true; delivery = { ...body, status: 'complete', message: '' };
    statusResolvers.forEach(resolve => resolve({ requestId: body.requestId, threadId: body.threadId, status: 'success',
      response: { reply, model: 'gemini-3.5-flash', effort: 'medium' } }));
  });
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(screen.getAllByText(reply, { selector: '.message.assistant' })).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('Tengo una segunda idea');
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
  again.unmount();
});

it.each(['sending', 'unknown'] as const)('una entrega %s conserva su texto y no repite llamadas de IA', async status => {
  delivery = { ...body, status, message: status === 'unknown' ? 'No sabemos si la llamada terminó. No volveremos a enviarla automáticamente.' : 'Uony está trabajando con tu primera petición.' };
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return { firstIntent: text, firstIntentDelivery: delivery } as never;
    if (path === '/uony/requests/recent') return { requests: [] } as never;
    if (path === '/uony/options') return options as never;
    if (path === '/uony/threads') return { threads: delivery?.status === 'complete' ? [{ id: delivery.threadId, title: delivery.text, service: null, view: 'default',
      messages: [{ role: 'user', text: delivery.text }, { role: 'assistant', text: reply }] }] : [] } as never;
    if (path === '/uony/projects') return { projects: [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  renderWorkspace();
  expect(await screen.findByText(delivery.message)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(text);
  expect(post).not.toHaveBeenCalled();
});

function readyReads(intent: () => string, catalog = options) {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return { firstIntent: intent(), firstIntentDelivery: delivery } as never;
    if (path === '/uony/requests/recent') return { requests: [] } as never;
    if (path === '/uony/options') return catalog as never;
    if (path === '/uony/threads') return { threads: delivery?.status === 'complete' ? [{ id: delivery.threadId, title: delivery.text, service: null, view: 'default',
      messages: [{ role: 'user', text: delivery.text }, { role: 'assistant', text: reply }] }] : [] } as never;
    if (path === '/uony/projects') return { projects: [] } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
}

it('Auto/Bajo usa Lite verificado y entrega el cuerpo reservado sin contexto ni acciones del producto abierto', async () => {
  const catalog: GoogleOptions = { ...options, models: [...options.models, { id: 'gemini-3.5-flash-lite', label: 'Flash-Lite', short: 'Lite', detail: '', efforts: ['low'] }],
    efforts: [{ id: 'low', label: 'Bajo' }, ...options.efforts], preferences: { model: 'auto', effort: 'low' } };
  readyReads(() => text, catalog);
  setActiveProduct({ sku: 'OTRO-PRODUCTO', name: 'Otro producto abierto', revision: 7 } as PimProduct);
  const canonical = { ...body, effort: 'low' };
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
    if (path === '/onboarding/first-intent/claim') {
      expect(sent).toEqual({ model: 'auto', effort: 'low' });
      delivery = { ...canonical, effort: 'low', status: 'pending', message: '' }; return { delivery } as never;
    }
    expect(sent).toEqual(canonical);
    delivery = { ...delivery!, status: 'complete' };
    return { reply, model: 'Flash-Lite', effort: 'low' } as never;
  });
  renderWorkspace();
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
});

it('conserva los textos históricos de más de 3000 caracteres y solo envía la versión que el cliente acorta', async () => {
  let intent = 'B'.repeat(3500);
  readyReads(() => intent);
  const put = vi.spyOn(api, 'put').mockImplementation(async (_path, value) => { intent = (value as { firstIntent: string }).firstIntent; return {} as never; });
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
    if (path === '/onboarding/first-intent/claim') { delivery = { ...body, text: intent, status: 'pending', message: '' }; return { delivery } as never; }
    expect(sent).toEqual({ ...body, text: intent });
    delivery = { ...delivery!, status: 'complete' }; return { reply } as never;
  });
  renderWorkspace();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(intent));
  expect(await screen.findByText(/Tu petición tiene más de 3000 caracteres/)).toBeVisible();
  expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Escribe a Uony' }), { target: { value: text } });
  await waitFor(() => expect(useGooglePreferences.getState().data).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(put).toHaveBeenCalledWith('/onboarding/setup', { firstIntent: text }, expect.anything());
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
});

it('una pérdida de red conserva la reserva y un reintento explícito reutiliza texto, hilo, modelo e identificador', async () => {
  readyReads(() => text);
  let tries = 0;
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
    if (path === '/onboarding/first-intent/claim') { delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never; }
    expect(sent).toEqual(body);
    if (++tries === 1) throw new Error('La conexión se ha interrumpido.');
    delivery = { ...delivery!, status: 'complete' }; return { reply } as never;
  });
  renderWorkspace();
  await waitFor(() => expect(tries).toBe(1));
  await waitFor(() => expect(useUiStore.getState().pendingReply).toBeNull());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(text));
  // Lote 6: el fallo no se anuncia bajo el compositor; Uony lo dice en el hilo, que sobrevive a la relectura.
  expect(document.querySelector('[data-composer-status]')).not.toHaveTextContent('La conexión se ha interrumpido.');
  expect(await screen.findByText('La conexión se ha interrumpido.', { selector: '.message.assistant' })).toBeVisible();
  act(() => useGooglePreferences.setState({ data: { ...options, preferences: { model: 'gemini-3.5-flash', effort: 'medium' } } }));
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  // La relectura del historial puede volver a pintar el hilo: se busca la respuesta en cada intento.
  await waitFor(() => expect(screen.getByText(reply, { selector: '.message.assistant' })).toBeVisible());
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/first-intent/claim')).toHaveLength(1);
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(2);
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message => message.role === 'user')).toHaveLength(1);
});

it('guarda en servidor la petición local antigua antes de reservarla y no la consume anticipadamente', async () => {
  let intent = '';
  readyReads(() => intent);
  sessionStorage.setItem('uonify-auth-pending-prompt', text);
  const put = vi.spyOn(api, 'put').mockImplementation(async (_path, value) => { intent = (value as { firstIntent: string }).firstIntent; return {} as never; });
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
    if (path === '/onboarding/first-intent/claim') {
      expect(put).toHaveBeenCalledOnce(); expect(intent).toBe(text);
      expect(sessionStorage.getItem('uonify-auth-pending-prompt')).toBe(text);
      delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never;
    }
    expect(sent).toEqual(body); delivery = { ...delivery!, status: 'complete' }; return { reply } as never;
  });
  renderWorkspace();
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
});

it('cuando el servidor termina tras una pérdida de red recupera la respuesta sin recarga ni otro envío', async () => {
  readyReads(() => text);
  const post = vi.spyOn(api, 'post').mockImplementation(async path => {
    if (path === '/onboarding/first-intent/claim') { delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never; }
    delivery = { ...body, status: 'sending', message: 'Uony está trabajando con tu primera petición.' };
    throw new Error('La conexión se ha interrumpido.');
  });
  renderWorkspace();
  expect(await screen.findByText('Uony está trabajando con tu primera petición.')).toBeVisible();
  await act(async () => {
    delivery = { ...body, status: 'complete', message: '' };
    await queryClient.invalidateQueries({ queryKey: ['uony-initial-intent', identity.account] });
  });
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue('');
  expect(screen.queryByText('La conexión se ha interrumpido.')).not.toBeInTheDocument();
  expect(post.mock.calls.filter(([path]) => path === '/uony/messages')).toHaveLength(1);
});

it.each([false, true])('una cuenta ya preparada conserva la nueva petición local como borrador sin repetir su alta; borrador propio: %s', async ownDraft => {
  const next = 'Ahora quiero crear otro producto desde Drive';
  delivery = { ...body, status: 'complete', message: '' };
  readyReads(() => text);
  sessionStorage.setItem('uonify-auth-pending-prompt', next);
  if (ownDraft) useComposerStore.setState({ draft: 'Estoy redactando otra cosa' });
  const post = vi.spyOn(api, 'post');
  const put = vi.spyOn(api, 'put');
  renderWorkspace();
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(ownDraft ? 'Estoy redactando otra cosa' : next));
  expect(sessionStorage.getItem('uonify-auth-pending-prompt')).toBe(next);
  expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});

it('una preferencia anónima antigua no sustituye la configuración de la cuenta ni retrasa la primera petición', async () => {
  sessionStorage.setItem('uonify-google-visitor-preferences', JSON.stringify({ preferences: { model: 'gemini-3.1-pro-preview', effort: 'high' }, pending: true, account: identity.account }));
  readyReads(() => text);
  const put = vi.spyOn(api, 'put');
  const post = vi.spyOn(api, 'post').mockImplementation(async (path, value) => {
    if (path === '/onboarding/first-intent/claim') { expect(value).toEqual(options.preferences); delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never; }
    expect(value).toEqual(body); delivery = { ...delivery!, status: 'complete' }; return { reply } as never;
  });
  renderWorkspace();
  expect(await screen.findByText(reply, { selector: '.message.assistant' })).toBeVisible();
  expect(put).not.toHaveBeenCalled();
  expect(post.mock.calls.map(([path]) => path)).toEqual(['/onboarding/first-intent/claim', '/uony/messages']);
});

it('si no se puede reservar el envío y aún no hay conversación, solo espera bajo la caja y lo reintenta sola (dueño, 22-10-2026)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    readyReads(() => text);
    let claims = 0;
    vi.spyOn(api, 'post').mockImplementation(async (path, sent) => {
      if (path === '/onboarding/first-intent/claim') {
        if (++claims === 1) throw new Error('Servicio no disponible.');
        delivery = { ...body, status: 'pending', message: '' }; return { delivery } as never;
      }
      expect(sent).toEqual(body);
      delivery = { ...delivery!, status: 'complete' }; return { reply } as never;
    });
    renderWorkspace();
    await waitFor(() => expect(claims).toBe(1));
    await waitFor(() => expect(useComposerStore.getState().status).toBe('Tu petición está guardada. Estamos preparando la conversación para continuar.'));
    expect(screen.queryByText('Servicio no disponible.')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Escribe a Uony' })).toHaveValue(text);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await waitFor(() => expect(claims).toBe(2));
    await waitFor(() => expect(screen.getByText(reply, { selector: '.message.assistant' })).toBeVisible());
  } finally { vi.useRealTimers(); }
});
