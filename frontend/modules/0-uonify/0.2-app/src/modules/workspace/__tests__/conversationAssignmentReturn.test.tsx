import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { useComposerStore } from '../hooks/composerStore';
import { getAssignmentReturn } from '../api/assignmentReturn';
import { ConversationFollowUpCards } from '../components/ConversationFollowUpCards';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { settleDurableRequest } from '../hooks/durableDelivery';
import { expectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import { setUi } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const basic = { assignment: { id: '11111111-1111-4111-8111-111111111111', label: 'Basic Mini Bricks', status: 'in_progress',
  nextStep: 'check_work', version: 1 }, product: { id: 'basic-product', name: 'Basic Mini Bricks', revision: 1 },
  assignmentWork: { id: 'basic-job', kind: 'materials', status: 'running', revision: 1,
    currentRevision: true, scope: 'started_for_assignment' }, relatedProductWork: null };
const lamp = { assignment: { id: '22222222-2222-4222-8222-222222222222', label: 'Lámpara azul', status: 'pending',
  nextStep: 'clarify_source', version: 1 }, product: null, assignmentWork: null, relatedProductWork: null };
const view = { resolution: 'ambiguous', focusVersion: 0, assignments: [basic, lamp], moreAvailable: false };
const noProductBrief = { product: null, confirmedFacts: [], status: null, pending: [],
  completedFollowUps: [], followUpHistory: [], trackingVersion: 0, sourceFingerprint: null,
  nextAction: 'continue_in_chat', summary: '' };
const oldProductBrief = { ...noProductBrief,
  product: { sku: 'BASIC', name: 'Basic Mini Bricks', revision: 1 },
  confirmedFacts: [{ id: 'weight', label: 'Peso', value: '500 g', freshness: 'saved_product_revision' }],
  status: { amazonRequirements: 'not_started', reasoning: 'none', amazonPublication: 'local_draft' },
  sourceFingerprint: 'a'.repeat(64) };

function mount(threadId = 'fresh', shouldFollowScroll?: () => boolean, owner = identity.account) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (account: string, thread: string) => <QueryClientProvider client={client}>
    <div className="conversation-messages"><ConversationFollowUpCards key={`${account}:${thread}`}
      account={account} threadId={thread} suspended={false} shouldFollowScroll={shouldFollowScroll} /></div>
  </QueryClientProvider>;
  const rendered = render(tree(owner, threadId));
  return { ...rendered, client, rerenderScope: (account: string, thread: string) => rendered.rerender(tree(account, thread)) };
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  identity.account = 'sellerify@example.test';
  resetWorkspaceStore();
  useComposerStore.getState().setDraft('');
  useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'fresh',
    threads: [{ id: 'fresh', title: 'Nuevo hilo', service: null, view: 'default',
      messages: [{ role: 'user', text: 'Quiero retomar mis encargos guardados' }] },
      { id: 'second', title: 'Otro hilo', service: null, view: 'default',
        messages: [{ role: 'user', text: 'Quiero retomar mis encargos guardados' }] }] });
});
afterEach(() => vi.restoreAllMocks());

it('muestra dos encargos sin atribuir el análisis a otro ni iniciar trabajo al volver', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const post = vi.spyOn(api, 'post');
  const put = vi.spyOn(api, 'put');
  mount();
  const card = await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(card).toHaveTextContent('Encargos guardados');
  expect(card).toHaveTextContent('Ver su estado no inicia trabajo ni envía mensajes a Uony');
  expect(screen.queryByRole('button', { name: 'Continuar en esta conversación →' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  expect(card).toHaveTextContent('Basic Mini Bricks · En curso');
  expect(card).toHaveTextContent('Análisis iniciado para este encargo: en curso');
  fireEvent.click(screen.getByRole('button', { name: 'Ver Lámpara azul' }));
  expect(card).toHaveTextContent('Lámpara azul · Pendiente');
  expect(card).toHaveTextContent('Aclarar si tienes materiales o partes de cero');
  expect(card).toHaveTextContent('No consta un análisis iniciado para este encargo');
  expect(card).not.toHaveTextContent('Análisis iniciado para este encargo: en curso');
  expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  expect(get.mock.calls.filter(([path]) => path.endsWith('/assignment-return'))).toHaveLength(1);
});

it('recibe el encargo creado desde el chat y conserva el foco y el borrador sin otra acción', async () => {
  let created = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? created ? { ...view, resolution: 'focused', focusVersion: 1, assignments: [lamp] } as never
      : { resolution: 'none', focusVersion: 0, assignments: [], moreAvailable: false } as never
    : { returnBrief: noProductBrief } as never);
  const post = vi.spyOn(api, 'post');
  const put = vi.spyOn(api, 'put');
  mount();
  await waitFor(() => expect(get.mock.calls.some(([path]) => path.endsWith('/assignment-return'))).toBe(true));
  act(() => {
    useComposerStore.getState().setDraft('Una pregunta que todavía no envío');
    setUi({ pendingReply: { threadId: 'fresh', requestId: 'natural-request', label: 'Preparando…' } });
  });
  created = true;
  act(() => settleDurableRequest(identity.account, useWorkspaceStore.getState().historyEpoch, {
    requestId: 'natural-request', threadId: 'fresh', status: 'success', response: {
      reply: 'He guardado el encargo «Lámpara azul». ¿Tienes materiales?',
      model: 'gemini-3.5-flash', effort: 'medium',
      createdAssignmentFocus: { assignmentId: lamp.assignment.id, version: 1 },
    },
  }));
  expect(expectedAssignmentFocus(identity.account, 'fresh')).toMatchObject({ kind: 'ready',
    value: { assignmentId: lamp.assignment.id, version: 1 } });
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path.endsWith('/assignment-return')).length).toBeGreaterThan(1));
  const card = await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(card).toHaveTextContent('Lámpara azul');
  expect(useComposerStore.getState().draft).toBe('Una pregunta que todavía no envío');
  expect(useWorkspaceStore.getState().threads[0].messages.filter(message =>
    message.role === 'assistant' && message.requestId === 'natural-request')).toHaveLength(1);
  expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});

it('separa un trabajo causal antiguo de otro trabajo de la ficha actual', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? { ...view, resolution: 'single', assignments: [{ ...basic,
      assignment: { ...basic.assignment, status: 'pending', nextStep: 'select_folder' },
      product: { ...basic.product, revision: 2 },
      assignmentWork: { ...basic.assignmentWork, status: 'ready', currentRevision: false },
      relatedProductWork: { id: 'generic-job', kind: 'materials', status: 'ready',
        scope: 'linked_product_current_revision' },
    }] } as never : { returnBrief: noProductBrief } as never);
  mount();
  const card = await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(card).toHaveTextContent('Elegir los materiales de la revisión actual');
  expect(card).toHaveTextContent('análisis de este encargo corresponde a una revisión anterior');
  expect(card).toHaveTextContent('Ese trabajo no se inició para este encargo');
  expect(card).not.toHaveTextContent('Análisis iniciado para este encargo: listo');
});

it('conserva el borrador y la posición de lectura al aparecer y consultar la tarjeta', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  useComposerStore.getState().setDraft('Mi consulta sobre Basic sin enviar');
  const rendered = mount('fresh', () => false);
  const list = rendered.container.querySelector<HTMLElement>('.conversation-messages')!;
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 800 });
  list.scrollTop = 140;
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Lámpara azul' }));
  expect(list.scrollTop).toBe(140);
  expect(useComposerStore.getState().draft).toBe('Mi consulta sobre Basic sin enviar');
});

it('no sustituye la tarjeta aprobada de una ficha del propio hilo por encargos de la cuenta', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: oldProductBrief } as never);
  mount();
  const card = await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(card).toHaveTextContent('500 g');
  expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
});

it('descarta una consulta tardía del otro hilo aunque siga la misma cuenta', async () => {
  let release!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.includes('/fresh/assignment-return')) return new Promise(resolve => { release = resolve; }) as never;
    if (path.includes('/second/assignment-return')) return { ...view, resolution: 'single', assignments: [lamp] } as never;
    return { returnBrief: noProductBrief } as never;
  });
  const rendered = mount();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => useWorkspaceStore.setState({ activeThreadId: 'second' }));
  rendered.rerenderScope(identity.account, 'second');
  await act(async () => release(view));
  const card = await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(card).toHaveTextContent('Lámpara azul');
  expect(card).not.toHaveTextContent('Basic Mini Bricks');
});

it('un resultado tardío de la cuenta o hilo anterior no aparece en el nuevo contexto', async () => {
  let release!: (value: unknown) => void;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.includes('/fresh/assignment-return')) return new Promise(resolve => { release = resolve; }) as never;
    if (path.includes('/second/assignment-return')) return { ...view, resolution: 'single',
      assignments: [{ ...lamp, assignment: { ...lamp.assignment, label: 'Objetivo de la otra cuenta' } }] } as never;
    return { returnBrief: noProductBrief } as never;
  });
  const rendered = mount();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  act(() => {
    identity.account = 'otra@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
    // Tras limpiar la cuenta antigua, la recuperación instala el nuevo hilo.
    useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'second',
      threads: [{ id: 'second', title: 'Otro hilo', service: null, view: 'default',
        messages: [{ role: 'user', text: 'Quiero retomar mis encargos guardados' }] }] });
  });
  rendered.rerenderScope(identity.account, 'second');
  await act(async () => release(view));
  await waitFor(() => expect(get.mock.calls.some(([path]) => path.includes('/second/assignment-return'))).toBe(true));
  const card = await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(card).toHaveTextContent('Objetivo de la otra cuenta');
  expect(card).not.toHaveTextContent('Basic Mini Bricks');
  expect(get.mock.calls.some(([path]) => path.includes('/second/assignment-return'))).toBe(true);
});

it('404 genérico de backend antiguo conserva la tarjeta de ficha; 404 específico no se confunde con ruta ausente', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/assignment-return')) throw new ApiError(404, { detail: 'Not Found' });
    return { returnBrief: oldProductBrief } as never;
  });
  mount();
  expect(await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toHaveTextContent('500 g');
  expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
  await expect(getAssignmentReturn('fresh')).resolves.toBeNull();
  vi.restoreAllMocks();
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, { detail: { error: 'thread_not_found' } }));
  await expect(getAssignmentReturn('fresh')).rejects.toMatchObject({ status: 404 });
});

it('un fallo del GET se muestra con reconsulta explícita sin abrir una acción', async () => {
  let available = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/assignment-return')) {
      if (!available) throw new ApiError(503, { error: 'unavailable' });
      return view as never;
    }
    return { returnBrief: noProductBrief } as never;
  });
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByRole('region', { name: 'Consulta de encargos' })).toHaveTextContent('No podemos consultar tus encargos');
  available = true;
  fireEvent.click(screen.getByRole('button', { name: 'Volver a consultar →' }));
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Basic Mini Bricks');
  expect(get.mock.calls.filter(([path]) => path.endsWith('/assignment-return'))).toHaveLength(2);
  expect(post).not.toHaveBeenCalled();
});

it('no consulta encargos de un hilo Live local antes de que el servidor confirme su persistencia', async () => {
  let persisted = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/assignment-return')) {
      if (!persisted) throw new ApiError(404, { detail: { error: 'thread_not_found' } });
      return { resolution: 'none', focusVersion: 0, assignments: [], moreAvailable: false } as never;
    }
    return { returnBrief: noProductBrief } as never;
  });
  useWorkspaceStore.setState(state => ({ pendingLiveThreadIds: ['fresh'],
    threads: state.threads.map(thread => thread.id === 'fresh' ? { ...thread, messages: [] } : thread) }));
  mount();
  await act(async () => {});
  expect(get).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Consulta de encargos' })).not.toBeInTheDocument();
  persisted = true;
  act(() => useWorkspaceStore.getState().markLiveThreadBound('fresh'));
  await waitFor(() => expect(get.mock.calls.some(([path]) => path.endsWith('/assignment-return'))).toBe(true));
  expect(screen.queryByRole('region', { name: 'Consulta de encargos' })).not.toBeInTheDocument();
});

it('elige explícitamente el segundo encargo con CAS y un único PUT, sin perder el texto ni iniciar IA', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockResolvedValue({ focus: { version: 1, current: { id: lamp.assignment.id } },
    replayed: false } as never);
  const post = vi.spyOn(api, 'post');
  useComposerStore.getState().setDraft('No olvidar mi pregunta');
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(screen.queryByRole('button', { name: 'Continuar en esta conversación →' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver Lámpara azul' }));
  expect(put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  await waitFor(() => expect(put).toHaveBeenCalledOnce());
  expect(put.mock.calls[0][0]).toBe('/uony/threads/fresh/assignment-focus');
  expect(put.mock.calls[0][1]).toMatchObject({ assignmentId: lamp.assignment.id, expectedVersion: 0,
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument());
  expect(useComposerStore.getState().draft).toBe('No olvidar mi pregunta');
  expect(post).not.toHaveBeenCalled();
});

it('un foco mostrado por un GET de caché se revalida con CAS antes de abrir el compositor', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? { ...view, resolution: 'focused', focusVersion: 1 } as never
    : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockResolvedValue({ focus: { version: 1, current: { id: basic.assignment.id } },
    replayed: false } as never);
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  await waitFor(() => expect(put).toHaveBeenCalledOnce());
  expect(put.mock.calls[0][1]).toMatchObject({ assignmentId: basic.assignment.id, expectedVersion: 1 });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument());
});

it('tras un 503 conserva el UUID y comprueba la misma decisión incluso al remontar', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockRejectedValueOnce(new ApiError(503, { error: 'unavailable' }))
    .mockResolvedValueOnce({ focus: { version: 1, current: { id: basic.assignment.id } }, replayed: true,
      outcome: { assignmentId: basic.assignment.id, appliedVersion: 1 } } as never);
  const first = mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  expect(await screen.findByRole('button', { name: 'Comprobar selección →' })).toBeInTheDocument();
  const originalId = (put.mock.calls[0][1] as { requestId: string }).requestId;
  expect(localStorage.getItem('uonify:assignment-focus:' + JSON.stringify([identity.account, 'fresh']))).toContain(originalId);
  first.unmount();
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Comprobar selección →' }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  expect((put.mock.calls[1][1] as { requestId: string }).requestId).toBe(originalId);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument());
  expect(localStorage.getItem('uonify:assignment-focus:' + JSON.stringify([identity.account, 'fresh']))).toBeNull();
});

it('recupera el UUID incierto aunque la sesión llegue después de montar la tarjeta', async () => {
  const owner = identity.account;
  const requestId = '33333333-3333-4333-8333-333333333333';
  localStorage.setItem('uonify:assignment-focus:' + JSON.stringify([owner, 'fresh']), JSON.stringify({
    account: owner, threadId: 'fresh', assignmentId: basic.assignment.id, expectedVersion: 0, requestId,
  }));
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put');
  identity.account = '';
  const rendered = mount('fresh', undefined, owner);
  expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
  act(() => { identity.account = owner; });
  rendered.rerenderScope(owner, 'fresh');
  expect(await screen.findByRole('button', { name: 'Comprobar selección →' })).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
});

it('un replay antiguo no afirma que el encargo esté retomado si otra pestaña cambió el foco', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockRejectedValueOnce(new ApiError(503, null))
    .mockResolvedValueOnce({ focus: { version: 2, current: { id: lamp.assignment.id } }, replayed: true,
      outcome: { assignmentId: basic.assignment.id, appliedVersion: 1 } } as never);
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Comprobar selección →' }));
  expect(await screen.findByText(/Otro cambio dejó un encargo distinto en foco/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Tus encargos guardados' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar encargos →' })).toBeInTheDocument();
  expect(put).toHaveBeenCalledTimes(2);
});

it('un 409 del envío reabre la tarjeta aprobada y consulta otra vez sin alterar el borrador', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockResolvedValue({ focus: { version: 1, current: { id: basic.assignment.id } },
    replayed: false } as never);
  useComposerStore.getState().setDraft('Mensaje conservado');
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument());
  act(() => window.dispatchEvent(new CustomEvent('uonify:assignment-focus-conflict', {
    detail: { account: identity.account, threadId: 'fresh' },
  })));
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path.endsWith('/assignment-return')).length).toBeGreaterThan(1));
  expect(put).toHaveBeenCalledOnce();
  expect(useComposerStore.getState().draft).toBe('Mensaje conservado');
});

it('un hilo con ficha abre la selección solo durante la recuperación y vuelve a su tarjeta de ficha', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: oldProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockResolvedValue({ focus: { version: 1, current: { id: lamp.assignment.id } },
    replayed: false } as never);
  useComposerStore.getState().setDraft('Mi consulta queda pendiente');
  mount();
  await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
  act(() => window.dispatchEvent(new CustomEvent('uonify:assignment-focus-conflict', {
    detail: { account: identity.account, threadId: 'fresh' },
  })));
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  expect(screen.queryByRole('region', { name: 'Resumen de Basic Mini Bricks' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ver Lámpara azul' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  await waitFor(() => expect(put).toHaveBeenCalledOnce());
  expect(await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Tus encargos guardados' })).not.toBeInTheDocument();
  expect(useComposerStore.getState().draft).toBe('Mi consulta queda pendiente');
});

it('409 exige releer el foco antes de aceptar otra selección', async () => {
  let focusVersion = 0;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? { ...view, focusVersion } as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockRejectedValue(new ApiError(409, { error: 'assignment_focus_conflict' }));
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  expect(await screen.findByRole('button', { name: 'Actualizar encargos →' })).toBeInTheDocument();
  expect(put).toHaveBeenCalledOnce();
  focusVersion = 2;
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar encargos →' }));
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path.endsWith('/assignment-return')).length).toBeGreaterThan(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar en esta conversación →' })).toBeInTheDocument());
  expect(put).toHaveBeenCalledOnce();
});

it('una intención local ilegible se retira solo tras reconsulta explícita, sin PUT', async () => {
  const key = 'uonify:assignment-focus:' + JSON.stringify([identity.account, 'fresh']);
  localStorage.setItem(key, '{corrupto');
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put');
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  expect(await screen.findByRole('button', { name: 'Actualizar encargos →' })).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar encargos →' }));
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path.endsWith('/assignment-return')).length).toBeGreaterThan(1));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  expect(screen.getByRole('button', { name: 'Continuar en esta conversación →' })).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
});

it('una intención válida de otra pestaña se comprueba con su UUID, no crea otro para el encargo elegido', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  const put = vi.spyOn(api, 'put').mockResolvedValue({ focus: { version: 1, current: { id: lamp.assignment.id } },
    replayed: true, outcome: { assignmentId: lamp.assignment.id, appliedVersion: 1 } } as never);
  mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  const existingId = '44444444-4444-4444-8444-444444444444';
  localStorage.setItem('uonify:assignment-focus:' + JSON.stringify([identity.account, 'fresh']), JSON.stringify({
    account: identity.account, threadId: 'fresh', assignmentId: lamp.assignment.id, expectedVersion: 0, requestId: existingId,
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  expect(await screen.findByRole('button', { name: 'Comprobar selección →' })).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Comprobar selección →' }));
  await waitFor(() => expect(put).toHaveBeenCalledOnce());
  expect(put.mock.calls[0][1]).toMatchObject({ assignmentId: lamp.assignment.id, requestId: existingId });
});

it('el PUT tardío de otro hilo o cuenta no cierra la nueva tarjeta ni borra el UUID incierto', async () => {
  let release!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? path.includes('/second/') ? { ...view, resolution: 'single', assignments: [lamp] } as never
      : view as never : { returnBrief: noProductBrief } as never);
  vi.spyOn(api, 'put').mockImplementation(() => new Promise(resolve => { release = resolve; }) as never);
  const rendered = mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const savedKey = 'uonify:assignment-focus:' + JSON.stringify([identity.account, 'fresh']);
  expect(localStorage.getItem(savedKey)).toContain(basic.assignment.id);
  act(() => useWorkspaceStore.setState({ activeThreadId: 'second' }));
  rendered.rerenderScope(identity.account, 'second');
  await act(async () => release({ focus: { version: 1, current: { id: basic.assignment.id } }, replayed: false }));
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Lámpara azul');
  expect(localStorage.getItem(savedKey)).toContain(basic.assignment.id);
  act(() => {
    identity.account = 'other@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
    useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'second',
      threads: [{ id: 'second', title: 'Otro hilo', service: null, view: 'default',
        messages: [{ role: 'user', text: 'Quiero retomar mis encargos guardados' }] }] });
  });
  rendered.rerenderScope(identity.account, 'second');
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toHaveTextContent('Lámpara azul');
  expect(localStorage.getItem(savedKey)).toContain(basic.assignment.id);
});

it('el PUT tardío de otra cuenta tampoco puede cerrar la tarjeta de la nueva identidad', async () => {
  let release!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/assignment-return')
    ? view as never : { returnBrief: noProductBrief } as never);
  vi.spyOn(api, 'put').mockImplementation(() => new Promise(resolve => { release = resolve; }) as never);
  const rendered = mount();
  await screen.findByRole('region', { name: 'Tus encargos guardados' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver Basic Mini Bricks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar en esta conversación →' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const savedKey = 'uonify:assignment-focus:' + JSON.stringify([identity.account, 'fresh']);
  act(() => {
    identity.account = 'other@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
    useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'second',
      threads: [{ id: 'second', title: 'Otro hilo', service: null, view: 'default',
        messages: [{ role: 'user', text: 'Quiero retomar mis encargos guardados' }] }] });
  });
  rendered.rerenderScope(identity.account, 'second');
  await act(async () => release({ focus: { version: 1, current: { id: basic.assignment.id } }, replayed: false }));
  expect(await screen.findByRole('region', { name: 'Tus encargos guardados' })).toBeInTheDocument();
  expect(localStorage.getItem(savedKey)).toContain(basic.assignment.id);
});
