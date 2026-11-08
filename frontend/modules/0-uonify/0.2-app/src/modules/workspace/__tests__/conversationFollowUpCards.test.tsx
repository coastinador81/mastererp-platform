import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { ConversationFollowUpCards } from '../components/ConversationFollowUpCards';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'sellerify@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));

const brief = { product: { sku: 'BASIC', name: 'Basic Mini Bricks', revision: 11 },
  confirmedFacts: [
    { id: 'weight', label: 'Peso', value: '500 g', freshness: 'saved_product_revision' },
    { id: 'pvpr', label: 'PVPR', value: '19,90 €', freshness: 'saved_product_revision' },
    { id: 'audience', label: 'Público', value: 'adultos y familias', freshness: 'saved_product_revision' },
    { id: 'dangerous_goods', label: 'Mercancías peligrosas', value: 'No aplicable', freshness: 'saved_product_revision' },
  ], status: { amazonRequirements: 'locally_valid_not_published', amazonPublication: 'local_draft',
    amazonPublicationDetail: { phase: 'local_draft', snapshotId: 'snapshot-1', approvalId: null, attemptId: null,
      productRevision: 11, matchesProductRevision: true, newerLocalDraft: false,
      currentVisibilityVerified: false, retailLinkVerified: false, causedByThisSubmission: null } }, pending: [],
  completedFollowUps: [], followUpHistory: [], trackingVersion: 0, sourceFingerprint: 'a'.repeat(64),
  nextAction: 'continue_in_chat', summary: 'Basic sigue guardado.' };
const snapshot = { snapshotId: 'snapshot-1', sku: 'BASIC', productRevision: 11,
  preview: { title: 'Basic Mini Bricks', attributes: { item_name: [{ value: 'Basic Mini Bricks' }], item_weight: [{ value: 500, unit: 'g' }] },
    localIssues: [], localValidation: 'valid', mediaReadiness: 'missing', sourceCurrent: true,
    readyToSubmit: false, limitations: ['Amazon aún no ha recibido el borrador.'] } };

function mount(shouldFollowScroll?: () => boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><div className="conversation-messages">
    <ConversationFollowUpCards account={identity.account} threadId="basic-thread" suspended={false}
      shouldFollowScroll={shouldFollowScroll} />
  </div></QueryClientProvider>);
}

beforeEach(() => {
  identity.account = 'sellerify@example.test';
  resetWorkspaceStore();
  setUi({ pendingReply: null });
  useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'basic-thread',
    threads: [{ id: 'basic-thread', title: 'Basic', service: null, view: 'default', messages: [] }] });
});
afterEach(() => vi.restoreAllMocks());

it('recupera hechos confirmados de Basic sin crear una generación ni un envío Amazon', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    if (path.endsWith('/amazon-publish-snapshots/latest')) return snapshot as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toHaveTextContent('500 g');
  expect(screen.getByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toHaveTextContent('19,90 €');
  expect(screen.getByRole('region', { name: 'Resumen de Basic Mini Bricks' }).querySelectorAll('button')).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
  expect(get.mock.calls.filter(([path]) => path.includes('amazon-publish-snapshots'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Revisar borrador para Amazon →' }));
  const card = await screen.findByRole('region', { name: 'Vista previa para Amazon de Basic Mini Bricks' });
  await waitFor(() => expect(card).toHaveTextContent('Título guardado: Basic Mini Bricks'));
  expect(card).toHaveTextContent('BORRADOR LOCAL · SIN ENVIAR');
  expect(card).toHaveTextContent('No consta un intento de envío de este borrador desde Uonify.');
  expect(card).not.toHaveTextContent('BASIC');
  expect(card.querySelectorAll('button')).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
});

it('el resumen y la vista previa no mueven el chat si la persona lee arriba; siguen si estaba al final', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    if (path.endsWith('/amazon-publish-snapshots/latest')) return snapshot as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  let follow = false;
  const view = mount(() => follow);
  const list = view.container.querySelector<HTMLElement>('.conversation-messages')!;
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 800 });
  list.scrollTop = 140;
  await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(list.scrollTop).toBe(140);

  follow = true;
  fireEvent.click(screen.getByRole('button', { name: 'Revisar borrador para Amazon →' }));
  await screen.findByRole('region', { name: 'Vista previa para Amazon de Basic Mini Bricks' });
  await waitFor(() => expect(list.scrollTop).toBe(800));
});

it('un borrador ausente solo se prepara tras pulsar la acción explícita y nunca se publica', async () => {
  let available = false;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    if (path.endsWith('/amazon-publish-snapshots/latest') && available) return snapshot as never;
    throw new ApiError(404, { error: 'amazon_snapshot_not_found' });
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async () => { available = true; return snapshot; });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar borrador para Amazon →' }));
  expect(await screen.findByText(/Aún no hay una vista previa guardada/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preparar vista previa local' }));
  await waitFor(() => expect(screen.getByText(/Título guardado:/)).toBeInTheDocument());
  expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith('/products/BASIC/amazon-publish-snapshots', { revision: 11 }, expect.any(Object));
});

it('no inventa una tarjeta ni datos de producto cuando el hilo no tiene ficha vinculada', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief, product: null, confirmedFacts: [],
    status: null, sourceFingerprint: null } });
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.endsWith('/return-brief'))).toHaveLength(1));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('al enviar otra petición oculta el resumen hasta que la persona vuelva a abrir el hilo', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: brief });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (suspended: boolean) => <QueryClientProvider client={client}><div className="conversation-messages">
    <ConversationFollowUpCards account={identity.account} threadId="basic-thread" suspended={suspended} />
  </div></QueryClientProvider>;
  const screenView = render(view(false));
  expect(await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toBeInTheDocument();
  act(() => setUi({ pendingReply: { threadId: 'basic-thread', requestId: 'next-request', label: 'Preparando…' } }));
  screenView.rerender(view(true));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  act(() => setUi({ pendingReply: null }));
  screenView.rerender(view(false));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('renueva el resumen y la previa al guardar Basic en la revisión 12', async () => {
  let revision = 11;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: { ...brief,
      product: { ...brief.product, revision }, confirmedFacts: [{ ...brief.confirmedFacts[0], value: `${revision === 11 ? 500 : 510} g` }] } } as never;
    if (path.endsWith('/amazon-publish-snapshots/latest')) return {
      ...snapshot, preview: { ...snapshot.preview, sourceCurrent: revision === 11 },
    } as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar borrador para Amazon →' }));
  expect(await screen.findByText('Actual para esta ficha.')).toBeInTheDocument();
  revision = 12;
  act(() => window.dispatchEvent(new CustomEvent('uonify:products-changed', {
    detail: [{ product: { sku: 'BASIC', revision: 12 }, previousSku: 'BASIC' }],
  })));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Vista previa para Amazon de Basic Mini Bricks' }))
    .toHaveTextContent('La ficha o los requisitos han cambiado'));
  expect(screen.queryByText('Actual para esta ficha.')).not.toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => path.endsWith('/return-brief')).length).toBeGreaterThan(1);
  expect(get.mock.calls.filter(([path]) => path.endsWith('/amazon-publish-snapshots/latest')).length).toBeGreaterThan(1);
});

it('una renovación del esquema en la misma revisión invalida la previa; el POST local nunca tapa el GET posterior', async () => {
  let available = false;
  let sourceCurrent = true;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    if (path.endsWith('/amazon-publish-snapshots/latest')) {
      if (!available) throw new ApiError(404, { error: 'amazon_snapshot_not_found' });
      return { ...snapshot, preview: { ...snapshot.preview, sourceCurrent } } as never;
    }
    throw new Error(`GET inesperado: ${path}`);
  });
  vi.spyOn(api, 'post').mockImplementation(async () => { available = true; return snapshot; });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar borrador para Amazon →' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar vista previa local' }));
  expect(await screen.findByText('Actual para esta ficha.')).toBeInTheDocument();
  sourceCurrent = false;
  act(() => window.dispatchEvent(new CustomEvent('uonify:products-changed', {
    detail: [{ product: { sku: 'BASIC', revision: 11 }, previousSku: 'BASIC' }],
  })));
  expect(await screen.findByText(/La ficha o los requisitos han cambiado/)).toBeInTheDocument();
  expect(screen.queryByText('Actual para esta ficha.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preparar vista previa local' })).toBeInTheDocument();
});

it('si falla la relectura no conserva una previa antigua como actual ni ofrece prepararla a ciegas', async () => {
  let readFails = false;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    if (path.endsWith('/amazon-publish-snapshots/latest')) {
      if (readFails) throw new ApiError(503, { error: 'unavailable' });
      return snapshot as never;
    }
    throw new Error(`GET inesperado: ${path}`);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar borrador para Amazon →' }));
  expect(await screen.findByText('Actual para esta ficha.')).toBeInTheDocument();
  readFails = true;
  act(() => window.dispatchEvent(new CustomEvent('uonify:products-changed', {
    detail: [{ product: { sku: 'BASIC', revision: 11 }, previousSku: 'BASIC' }],
  })));
  expect(await screen.findByText('No podemos comprobar si la vista previa guardada sigue vigente.')).toBeInTheDocument();
  expect(screen.queryByText('Actual para esta ficha.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preparar vista previa local' })).not.toBeInTheDocument();
});

it.each([
  ['approved_not_sent', null, 'Hay una aprobación guardada'],
  ['outcome_unknown', 'attempt-1', 'El resultado del envío es incierto'],
  ['visible_current', 'attempt-1', 'no verifica un enlace de compra'],
])('una fase Amazon %s mantiene un solo CTA y no muestra el borrador sin enviar', async (phase, attemptId, message) => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief, status: { ...brief.status,
    amazonPublication: phase, amazonPublicationDetail: { ...brief.status.amazonPublicationDetail, phase, attemptId },
  } } });
  mount();
  const card = await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(card).toHaveTextContent(message);
  expect(card).not.toHaveTextContent('SIN ENVIAR');
  expect(card.querySelectorAll('button')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Revisar borrador para Amazon →' })).not.toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => path.includes('amazon-publish-snapshots'))).toHaveLength(0);
});

it('una fase antigua desconocida no se interpreta como intento ni como borrador sin enviar', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief, status: { ...brief.status,
    amazonPublication: 'not_integrated', amazonPublicationDetail: undefined,
  } } });
  mount();
  const card = await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(card).toHaveTextContent('El estado de Amazon no está disponible en este momento.');
  expect(card).not.toHaveTextContent('intento de envío registrado');
  expect(card).not.toHaveTextContent('SIN ENVIAR');
  expect(card.querySelectorAll('button')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Revisar borrador para Amazon →' })).not.toBeInTheDocument();
});

it('avisa de una vista local más reciente antes de continuar con la aprobación antigua', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief, status: { ...brief.status,
    amazonPublication: 'approved_not_sent', amazonPublicationDetail: { ...brief.status.amazonPublicationDetail,
      phase: 'approved_not_sent', approvalId: 'approval-1', newerLocalDraft: true },
  } } });
  mount();
  const card = await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(card).toHaveTextContent('Hay una vista previa local más reciente');
  expect(card).toHaveTextContent('Revisar la vista previa local más reciente antes de usar la aprobación guardada.');
  expect(card.querySelectorAll('button')).toHaveLength(1);
});

it('aplaza un pendiente con una sola decisión y conserva los datos confirmados de Basic', async () => {
  let current = { ...brief, pending: [{ id: 'missing_source:BASIC', kind: 'missing_source',
    label: 'Revisar el dato pendiente para Amazon.', sourceFingerprint: 'b'.repeat(64), followUp: 'open' }],
  status: { ...brief.status, amazonRequirements: 'needs_input' } };
  vi.spyOn(api, 'get').mockImplementation(async () => ({ returnBrief: current }) as never);
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const request = body as { requestId: string; action: string; pendingId: string; expectedVersion: number };
    expect(request.action).toBe('defer');
    expect(request.pendingId).toBe('missing_source:BASIC');
    current = { ...current, trackingVersion: 1, pending: [{ ...current.pending[0], followUp: 'deferred' }] };
    return { event: { requestId: request.requestId, action: request.action,
      pendingId: request.pendingId, trackingVersion: request.expectedVersion + 1 } } as never;
  });
  mount();
  const card = await screen.findByRole('region', { name: 'Resumen de Basic Mini Bricks' });
  expect(card).toHaveTextContent('500 g');
  expect(card).toHaveTextContent('19,90 €');
  expect(card).toHaveTextContent('adultos y familias');
  expect(card).toHaveTextContent('No aplicable');
  expect(card).toHaveTextContent('Pendiente por atender');
  expect(card.querySelectorAll('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Aplazar por ahora' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Aplazar por ahora' })).not.toBeInTheDocument());
  expect(post).toHaveBeenCalledOnce();
  expect(card).toHaveTextContent('500 g');
});

it('reutiliza el UUID tras una respuesta incierta y pide resumen nuevo ante 409', async () => {
  let current = { ...brief, pending: [{ id: 'missing_source:BASIC', kind: 'missing_source',
    label: 'Revisar el dato pendiente.', sourceFingerprint: 'b'.repeat(64), followUp: 'open' }] };
  vi.spyOn(api, 'get').mockImplementation(async () => ({ returnBrief: current }) as never);
  const requestIds: string[] = [];
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const request = body as { requestId: string };
    requestIds.push(request.requestId);
    if (requestIds.length === 1) throw new Error('La respuesta se perdió.');
    throw new ApiError(409, { error: 'return_brief_conflict' });
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Aplazar por ahora' }));
  expect(await screen.findByText(/No hemos podido comprobar si se guardó/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Aplazar por ahora' }));
  expect(await screen.findByText(/El resumen ha cambiado/)).toBeInTheDocument();
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  expect(post).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Aplazar por ahora' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar resumen →' })).toBeInTheDocument();
  current = { ...current, trackingVersion: 1, pending: [] };
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar resumen →' }));
  await waitFor(() => expect(screen.queryByText(/El resumen ha cambiado/)).not.toBeInTheDocument());
  expect(screen.getByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toHaveTextContent('500 g');
});

it('solo ofrece cerrar un seguimiento que el servidor ya marca como resuelto', async () => {
  let current = { ...brief, completedFollowUps: [{ id: 'missing_source:BASIC',
    label: 'Revisar el dato pendiente.', canResolve: true }] };
  vi.spyOn(api, 'get').mockImplementation(async () => ({ returnBrief: current }) as never);
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const request = body as { requestId: string; action: string; pendingId: string; expectedVersion: number };
    expect(request.action).toBe('resolve');
    current = { ...current, completedFollowUps: [], trackingVersion: 1 };
    return { event: { requestId: request.requestId, action: request.action,
      pendingId: request.pendingId, trackingVersion: request.expectedVersion + 1 } } as never;
  });
  mount();
  expect(await screen.findByText(/Seguimiento listo para cerrar/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar seguimiento' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cerrar seguimiento' })).not.toBeInTheDocument());
  expect(post).toHaveBeenCalledOnce();
});

it('un rechazo definitivo no se presenta como respuesta incierta ni se reenvía', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief,
    pending: [{ id: 'missing_source:BASIC', kind: 'missing_source', label: 'Revisar el dato pendiente.',
      sourceFingerprint: 'b'.repeat(64), followUp: 'open' }] } });
  const post = vi.spyOn(api, 'post').mockRejectedValue(new ApiError(404, { error: 'followup_not_found' }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Aplazar por ahora' }));
  expect(await screen.findByText(/No se ha guardado el seguimiento/)).toBeInTheDocument();
  expect(screen.queryByText(/Pulsa de nuevo la misma acción/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar resumen →' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aplazar por ahora' })).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledOnce();
});

it('un GET posterior quita el aviso de reintento si el pendiente ya cambió', async () => {
  let current = { ...brief, pending: [{ id: 'missing_source:BASIC', kind: 'missing_source',
    label: 'Revisar el dato pendiente.', sourceFingerprint: 'b'.repeat(64), followUp: 'open' }] };
  vi.spyOn(api, 'get').mockImplementation(async () => ({ returnBrief: current }) as never);
  vi.spyOn(api, 'post').mockRejectedValue(new Error('La respuesta se perdió.'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Aplazar por ahora' }));
  expect(await screen.findByText(/Pulsa de nuevo la misma acción/)).toBeInTheDocument();
  current = { ...current, trackingVersion: 1, pending: [{ ...current.pending[0], followUp: 'deferred' }] };
  act(() => window.dispatchEvent(new CustomEvent('uonify:products-changed', {
    detail: [{ product: { sku: 'BASIC', revision: 11 }, previousSku: 'BASIC' }],
  })));
  await waitFor(() => expect(screen.queryByText(/Pulsa de nuevo la misma acción/)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Aplazar por ahora' })).not.toBeInTheDocument();
});

it('atiende primero un pendiente Amazon abierto antes de ofrecer la vista previa', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: { ...brief,
    status: { ...brief.status, amazonRequirements: 'needs_input' },
    pending: [{ id: 'amazon_requirements:BASIC', kind: 'amazon_requirements',
      label: 'Completar un dato de Amazon.', sourceFingerprint: 'b'.repeat(64), followUp: 'open' }] } });
  mount();
  expect(await screen.findByRole('button', { name: 'Continuar en esta conversación →' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Revisar borrador para Amazon →' })).not.toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => path.includes('amazon-publish-snapshots'))).toHaveLength(0);
});
