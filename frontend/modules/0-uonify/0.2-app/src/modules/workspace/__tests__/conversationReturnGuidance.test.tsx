import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { clearReturnRetryConflict, saveReturnRetryIntent } from '../api/returnRetryIntent';
import { clearAllReturnPreparationDrafts } from '../api/returnPreparationDraft';
import { ConversationFollowUpCards } from '../components/ConversationFollowUpCards';
import { prepareProductRequirements, sendLivePrompt } from '../hooks/liveConversation';
import { resetWorkspaceStore, useWorkspaceStore } from '../hooks/workspaceStore';
import { setUi } from '../hooks/uiStore';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const identity = vi.hoisted(() => ({ account: 'qa-a@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
vi.mock('../hooks/liveConversation', () => ({ prepareProductRequirements: vi.fn(() => true), sendLivePrompt: vi.fn(() => true) }));
vi.mock('../components/ConversationConnection', () => ({ ConversationConnection: ({ provider }: { provider: string }) =>
  <div data-testid="google-connection-inline">Conexión {provider} dentro del chat</div> }));

const product = { sku: 'BASIC', name: 'Basic Mini Bricks', revision: 11, linkVersion: 1 };
const facts = [
  { id: 'weight', label: 'Peso', value: '500 g', freshness: 'saved_product_revision' },
  { id: 'pvpr', label: 'PVPR', value: '19,90 €', freshness: 'saved_product_revision' },
  { id: 'audience', label: 'Público', value: 'adultos y familias', freshness: 'saved_product_revision' },
  { id: 'dangerous_goods', label: 'Mercancías peligrosas', value: 'No aplicable', freshness: 'saved_product_revision' },
];
const base = { product, confirmedFacts: facts,
  status: { reasoning: 'completed', preparation: 'not_started', amazonRequirements: 'not_started', amazonPublication: 'not_started' },
  pending: [], completedFollowUps: [], followUpHistory: [], trackingVersion: 0,
  sourceFingerprint: 'a'.repeat(64), nextAction: 'review_amazon_requirements', summary: 'Ficha guardada.' };
const jobId = '12345678-1234-4123-8123-123456789abc';
const reasoningBrief = (status: 'error' | 'unknown', canRetry = true, revision = 11,
  connectionRequired = false, requiresConsumptionAcknowledgement = status === 'unknown',
  previousConnectionFailure = false) => ({ ...base,
  status: { ...base.status, reasoning: status, amazonRequirements: 'needs_input', reasoningDetail: {
    id: jobId, status, revision,
    message: status === 'error' ? 'Google no completó la comprobación.' : 'El consumo anterior no se puede confirmar.',
    canRetry, connectionRequired, requiresConsumptionAcknowledgement, previousConnectionFailure } },
  pending: [{ id: `reasoning:${jobId}`, kind: 'reasoning', label: 'Revisar comprobación de IA',
    sourceFingerprint: 'b'.repeat(64), followUp: 'open' }], nextAction: 'review_ai' });
const preparationBrief = { ...base, status: { ...base.status, reasoning: 'none', preparation: 'needs_review' },
  pending: [{ id: 'preparation:auditoria', kind: 'preparation', label: 'Revisar el apartado auditoria',
    sourceFingerprint: 'c'.repeat(64), followUp: 'open' }], nextAction: 'review_preparation' };
const prep = (revision = 11) => ({ product: { ...product, revision }, preparation: { mode: 'guided', activeSection: 'auditoria', briefReady: false,
  sections: [{ id: 'auditoria', label: 'Auditoría IA', kind: 'planning', state: 'saved', notice: '',
    fields: [{ id: 'benefits', label: 'Ventajas comprobables', type: 'textarea', required: false, value: 'Construcción creativa' },
      { id: 'components', label: 'Componentes', type: 'text', required: false, value: '48 piezas' }] }] } });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><div className="conversation-messages">
    <ConversationFollowUpCards account={identity.account} threadId="basic-thread" suspended={false} />
  </div></QueryClientProvider>);
  return { ...view, client };
}

beforeEach(() => {
  localStorage.clear();
  clearAllReturnPreparationDrafts();
  identity.account = 'qa-a@example.test';
  clearReturnRetryConflict(identity.account, 'basic-thread');
  resetWorkspaceStore(); setUi({ pendingReply: null });
  useWorkspaceStore.setState({ historyAccount: identity.account, activeThreadId: 'basic-thread',
    threads: [{ id: 'basic-thread', title: 'Basic', service: null, view: 'default', messages: [] }] });
  vi.mocked(prepareProductRequirements).mockReset().mockReturnValue(true);
  vi.mocked(sendLivePrompt).mockReset().mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

it('trabajo terminado consulta la misma revisión y deja elegir sin llamar IA al abrir', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: base } as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByText(/La revisión de IA terminó para esta versión/)).toBeInTheDocument();
  expect(screen.queryByText(/Revisar los requisitos y el borrador/)).not.toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => path.endsWith('/return-brief'))).toHaveLength(1);
  expect(post).not.toHaveBeenCalled(); expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ver resultado y continuar →' }));
  expect(await screen.findByText(/Aún no hay requisitos de Amazon consultados/)).toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => path.endsWith('/return-brief'))).toHaveLength(2);
  expect(post).not.toHaveBeenCalled(); expect(sendLivePrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ver datos de la ficha' }));
  expect(screen.getByText('Peso: 500 g')).toBeInTheDocument();
  expect(screen.getByText(/Cuando quieras preparar la ficha de Amazon/)).toBeInTheDocument();
  expect(sendLivePrompt).not.toHaveBeenCalled();
});

it('un trabajo terminado con requisitos pendientes muestra los campos concretos por GET sin iniciar IA', async () => {
  const brief = { ...base, status: { ...base.status, amazonRequirements: 'needs_input' },
    pending: [{ id: 'amazon_requirements:fields', kind: 'amazon_requirements', label: 'Revisar 2 datos pendientes para Amazon',
      sourceFingerprint: 'e'.repeat(64), followUp: 'open' }] };
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    if (path.endsWith('/amazon-requirements')) return { product, evaluation: { state: 'needs_input', fields: [
      { id: 'color', label: 'Color', type: 'text', required: true, value: '' },
      { id: 'pieces', label: 'Piezas', type: 'text', required: true, value: '48' },
    ] } } as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver resultado y continuar →' }));
  expect(await screen.findByText(/Hay 2 dato\(s\) de Amazon/)).toBeInTheDocument();
  expect(screen.getByText(/falta este dato/)).toBeInTheDocument();
  expect(screen.getByText(/«48» · revisar/)).toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => !path.endsWith('/assignment-return'))).toHaveLength(3);
  expect(post).not.toHaveBeenCalled(); expect(sendLivePrompt).not.toHaveBeenCalled();
});

it('una revisión terminada obsoleta no abre un resultado ni inicia otra operación', async () => {
  let reads = 0;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: reads++ ? { ...base,
      product: { ...product, revision: 12 }, sourceFingerprint: 'd'.repeat(64) } : base } as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver resultado y continuar →' }));
  expect(await screen.findByText(/El trabajo guardado cambió/)).toBeInTheDocument();
  expect(screen.queryByText(/Cuando quieras preparar la ficha de Amazon/)).not.toBeInTheDocument();
  expect(sendLivePrompt).not.toHaveBeenCalled();
});

it('un error consulta la incidencia por GET y reintenta solo tras clic con CAS y UUID persistido', async () => {
  const brief = reasoningBrief('error');
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: brief } as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByText(/El intento guardado terminó con error/)).toBeInTheDocument();
  expect(get.mock.calls.filter(([path]) => path.endsWith('/return-brief'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Ver incidencia de IA →' }));
  expect(await screen.findByText(/Google no completó la comprobación/)).toBeInTheDocument();
  expect(prepareProductRequirements).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  const retry = screen.getByRole('button', { name: 'Reintentar con Uony' });
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado guardado' }));
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path.endsWith('/return-brief'))).toHaveLength(3));
  expect(post).not.toHaveBeenCalled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
  fireEvent.click(retry);
  expect(prepareProductRequirements).toHaveBeenCalledWith('BASIC', expect.objectContaining({
    retry: true, acknowledgeUnknown: false, expectedRevision: 11, expectedLinkVersion: 1,
    expectedReasoningId: jobId, expectedReasoningStatus: 'error', expectedSourceFingerprint: brief.sourceFingerprint,
    expectedThreadId: 'basic-thread', requestId: expect.any(String),
  }));
  const requestId = vi.mocked(prepareProductRequirements).mock.calls[0][1]?.requestId;
  expect(requestId).toBeTruthy();
  expect(localStorage.getItem('uonify:return-retry:' + JSON.stringify([identity.account, 'basic-thread', 'BASIC']))).toContain(requestId!);
});

it('un recibo verificado tras perder respuesta libera el UUID sin otro POST', async () => {
  const brief = reasoningBrief('error');
  const intent = saveReturnRetryIntent({ account: identity.account, threadId: 'basic-thread', sku: 'BASIC',
    revision: 11, linkVersion: 1, reasoningId: jobId, reasoningStatus: 'error',
    sourceFingerprint: brief.sourceFingerprint }, null, false)!;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: brief } as never : path.endsWith('/receipt') ? { requestId: intent.requestId,
      threadId: intent.threadId, status: 'success', action: { kind: 'requirements_prepare', action: 'prepare', sku: 'BASIC',
        retry: true, acknowledgeUnknown: false, expectedRevision: 11, expectedLinkVersion: 1,
        expectedReasoningId: jobId, expectedReasoningStatus: 'error',
        expectedSourceFingerprint: brief.sourceFingerprint } } as never : Promise.reject(new Error('GET inesperado')));
  const post = vi.spyOn(api, 'post');
  mount();
  await waitFor(() => expect(localStorage.getItem('uonify:return-retry:'
    + JSON.stringify([identity.account, 'basic-thread', 'BASIC']))).toBeNull());
  expect(get.mock.calls.some(([path]) => path.endsWith('/receipt'))).toBe(true);
  expect(post).not.toHaveBeenCalled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('un 4xx definitivo libera solo el intento rechazado y pide actualizar el resumen', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: reasoningBrief('error') });
  const { unmount } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar con Uony' }));
  const callback = vi.mocked(prepareProductRequirements).mock.calls[0][1]?.onSettled;
  const requestId = vi.mocked(prepareProductRequirements).mock.calls[0][1]?.requestId;
  expect(callback).toBeDefined();
  act(() => {
    setUi({ pendingReply: { threadId: 'basic-thread', requestId, label: 'Consultando…' } });
    callback?.(false, 'Acceso denegado.', 'definitive');
    setUi({ pendingReply: null });
  });
  expect(await screen.findByText(/No se ha iniciado otra revisión/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar resumen →' })).toBeInTheDocument();
  expect(localStorage.getItem('uonify:return-retry:'
    + JSON.stringify([identity.account, 'basic-thread', 'BASIC']))).toBeNull();
  expect(screen.getByRole('region', { name: 'Resumen de Basic Mini Bricks' })).toBeInTheDocument();
  unmount();
  mount();
  expect(await screen.findByText(/No se ha iniciado otra revisión/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Actualizar resumen →' })).toBeInTheDocument();
});

it('si el error no permite reintento, el detalle no ofrece el botón', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: reasoningBrief('error', false) } as never : Promise.reject(new Error('GET inesperado')));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  expect(await screen.findByText(/Google no completó la comprobación/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar con Uony' })).not.toBeInTheDocument();
});

it('un error de conexión abre Google en la misma conversación sin retry ni IA', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: reasoningBrief('error', false, 11, true) });
  const post = vi.spyOn(api, 'post');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  expect(await screen.findByText(/Google no completó la comprobación/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar con Uony' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar conexión Google' }));
  expect(screen.getAllByTestId('google-connection-inline').map(item => item.textContent)).toEqual([
    'Conexión cloud dentro del chat', 'Conexión drive dentro del chat',
  ]);
  expect(screen.getByText(/aunque aparezcan conectados/)).toBeInTheDocument();
  expect(screen.getByText(/Después de reconectar, pídele a Uony/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('un fallo remoto anterior permite revisar Cloud y Drive antes de un reintento explícito', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: reasoningBrief('error', true, 11, false, false, true) });
  const post = vi.spyOn(api, 'post');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  expect(await screen.findByRole('button', { name: 'Revisar permisos de Google' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reintentar con Uony' })).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar permisos de Google' }));
  expect(screen.getAllByTestId('google-connection-inline').map(item => item.textContent)).toEqual([
    'Conexión cloud dentro del chat', 'Conexión drive dentro del chat',
  ]);
  expect(post).not.toHaveBeenCalled(); expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('un resultado incierto exige aceptación explícita antes del retry de la misma revisión', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: reasoningBrief('unknown') } as never : Promise.reject(new Error('GET inesperado')));
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByText(/no podemos confirmar si la comprobación terminó o consumió crédito/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar estado de IA →' }));
  expect(await screen.findByText(/El consumo anterior no se puede confirmar/)).toBeInTheDocument();
  expect(screen.getByText(/Repetirla puede consumir crédito adicional/)).toBeInTheDocument();
  const retry = screen.getByRole('button', { name: 'Autorizar otro intento con Uony' });
  expect(retry).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Entiendo que repetir la revisión/ }));
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  expect(prepareProductRequirements).toHaveBeenCalledWith('BASIC', expect.objectContaining({
    retry: true, acknowledgeUnknown: true, expectedRevision: 11, expectedLinkVersion: 1,
    expectedReasoningId: jobId, expectedReasoningStatus: 'unknown', requestId: expect.any(String),
  }));
});

it('un error actual con consumo anterior incierto también exige aceptación antes de POST', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: reasoningBrief('error', true, 11, false, true) });
  const post = vi.spyOn(api, 'post');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  const retry = await screen.findByRole('button', { name: 'Reintentar con Uony' });
  expect(retry).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Entiendo que repetir la revisión/ }));
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  expect(prepareProductRequirements).toHaveBeenCalledWith('BASIC', expect.objectContaining({
    retry: true, acknowledgeUnknown: true, expectedReasoningStatus: 'error', requestId: expect.any(String),
  }));
});

it('un GET de IA fallido nunca habilita un reintento a ciegas', async () => {
  let reads = 0;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief') && reads++ === 0) return { returnBrief: reasoningBrief('error') } as never;
    throw new ApiError(503, { error: 'unavailable' });
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  expect(await screen.findByText(/No hemos podido consultar el estado guardado/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar con Uony' })).not.toBeInTheDocument();
  expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('un dato pendiente aparece con su valor sin preguntar de nuevo y se guarda por CAS tras revisión', async () => {
  let saved = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return { returnBrief: saved ? { ...base,
      product: { ...product, revision: 12 }, status: { ...base.status, reasoning: 'none' } } : preparationBrief } as never;
    if (path.endsWith('/preparation')) return prep() as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const patch = vi.spyOn(api, 'patch').mockImplementation(async () => { saved = true; return prep(12); });
  const post = vi.spyOn(api, 'post');
  mount();
  expect(await screen.findByText(/«Ventajas comprobables», en Auditoría IA: «Construcción creativa»/)).toBeInTheDocument();
  expect(screen.getByText(/Hay 1 dato\(s\) más en este apartado/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar este dato →' }));
  expect(await screen.findByLabelText('Ventajas comprobables')).toHaveValue('Construcción creativa');
  expect(screen.getByLabelText('Componentes')).toHaveValue('48 piezas');
  fireEvent.change(screen.getByLabelText('Ventajas comprobables'), { target: { value: 'Construcción creativa confirmada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y marcar revisado' }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/products/BASIC/preparation', expect.objectContaining({
    revision: 11, section: 'auditoria', answers: { benefits: 'Construcción creativa confirmada', components: '48 piezas' }, reviewed: true,
  }), expect.any(Object)));
  expect(get.mock.calls.filter(([path]) => path.endsWith('/preparation')).length).toBeGreaterThanOrEqual(2);
  expect(post).not.toHaveBeenCalled();
  expect([...Array(sessionStorage.length).keys()].some(index =>
    sessionStorage.key(index)?.startsWith('uonify:return-preparation-draft:'))).toBe(false);
});

it('un refetch conserva la corrección local y Aplazar no la descarta sin guardar', async () => {
  let reads = 0;
  let release: (value: unknown) => void = () => {};
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/return-brief')) return ++reads <= 1 ? { returnBrief: preparationBrief } as never
      : new Promise(resolve => { release = resolve; }) as never;
    if (path.endsWith('/preparation')) return prep() as never;
    throw new Error(`GET inesperado: ${path}`);
  });
  const patch = vi.spyOn(api, 'patch');
  const { client } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  const field = await screen.findByLabelText('Ventajas comprobables');
  fireEvent.change(field, { target: { value: 'Corrección todavía sin guardar' } });
  expect(screen.getByRole('button', { name: 'Aplazar por ahora' })).toBeDisabled();
  expect(screen.getByText(/Guarda tus cambios antes de aplazar/)).toBeInTheDocument();
  const refetch = client.invalidateQueries({ queryKey: ['uony-return-brief', identity.account, 'basic-thread'] });
  await waitFor(() => expect(reads).toBe(2));
  expect(field).toHaveValue('Corrección todavía sin guardar');
  expect(screen.queryByRole('button', { name: 'Guardar y marcar revisado' })).toBeDisabled();
  await act(async () => release({ returnBrief: { ...preparationBrief, sourceFingerprint: 'd'.repeat(64) } }));
  await refetch;
  expect(screen.getByLabelText('Ventajas comprobables')).toHaveValue('Corrección todavía sin guardar');
  expect(patch).not.toHaveBeenCalled();
});

it('al aplazar el apartado A, el apartado B abre sus propios campos y no hereda el formulario anterior', async () => {
  const secondBrief = { ...preparationBrief, trackingVersion: 1, sourceFingerprint: 'd'.repeat(64),
    pending: [{ id: 'preparation:catalogo', kind: 'preparation', label: 'Revisar el apartado catálogo',
      sourceFingerprint: 'e'.repeat(64), followUp: 'open' as const }] };
  const bothSections = { ...prep(), preparation: { ...prep().preparation, sections: [
    ...prep().preparation.sections,
    { id: 'catalogo', label: 'Catálogo', kind: 'planning', state: 'saved', notice: '',
      fields: [{ id: 'benefits', label: 'Ventajas del catálogo', type: 'textarea', required: false,
        value: 'Dato propio de B' }] },
  ] } };
  let currentBrief: typeof preparationBrief | typeof secondBrief = preparationBrief;
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: currentBrief } as never : path.endsWith('/preparation')
      ? bothSections as never : Promise.reject(new Error('GET inesperado')));
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const action = body as { requestId: string; action: 'defer'; pendingId: string };
    currentBrief = secondBrief;
    return { event: { ...action, trackingVersion: 1 } } as never;
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  expect(await screen.findByLabelText('Ventajas comprobables')).toHaveValue('Construcción creativa');
  fireEvent.click(screen.getByRole('button', { name: 'Aplazar por ahora' }));
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(await screen.findByText(/«Ventajas del catálogo», en Catálogo: «Dato propio de B»/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Ventajas comprobables')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar este dato →' }));
  expect(await screen.findByLabelText('Ventajas del catálogo')).toHaveValue('Dato propio de B');
  expect(screen.queryByLabelText('Ventajas comprobables')).not.toBeInTheDocument();
});

it('cambiar temporalmente de modo o hilo conserva el borrador acotado a su ficha', async () => {
  let currentBrief: typeof preparationBrief | typeof base = preparationBrief;
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: currentBrief } as never : path.endsWith('/preparation')
      ? prep() as never : Promise.reject(new Error('GET inesperado')));
  const { client, unmount } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  const field = await screen.findByLabelText('Ventajas comprobables');
  fireEvent.change(field, { target: { value: 'Borrador de Basic en esta conversación' } });
  currentBrief = base;
  await act(async () => { await client.invalidateQueries({ queryKey: ['uony-return-brief', identity.account, 'basic-thread'] }); });
  expect(await screen.findByText(/La revisión de IA terminó para esta versión/)).toBeInTheDocument();
  unmount();
  currentBrief = preparationBrief;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  expect(await screen.findByLabelText('Ventajas comprobables')).toHaveValue('Borrador de Basic en esta conversación');
  expect(screen.getByRole('button', { name: 'Aplazar por ahora' })).toBeDisabled();
});

it('un 409 de preparación conserva el texto editado y obliga a refrescar antes de guardar', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: preparationBrief } as never : prep() as never);
  const patch = vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(409, { error: 'product_conflict', message: 'La ficha cambió.' }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  const field = await screen.findByLabelText('Ventajas comprobables');
  fireEvent.change(field, { target: { value: 'Mi corrección' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y marcar revisado' }));
  expect(await screen.findByText(/La ficha cambió. Conservamos tu texto/)).toBeInTheDocument();
  expect(field).toHaveValue('Mi corrección');
  expect(screen.getByRole('button', { name: 'Guardar y marcar revisado' })).toBeDisabled();
  expect(patch).toHaveBeenCalledOnce();
});

it('otra pestaña avanza la revisión: conserva el borrador visible para copiarlo sin aplicarlo a la nueva ficha', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: preparationBrief } as never : prep() as never);
  const patch = vi.spyOn(api, 'patch');
  const { client } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  fireEvent.change(await screen.findByLabelText('Ventajas comprobables'),
    { target: { value: 'Mi texto sin guardar para revisar' } });
  act(() => client.setQueryData(['uony-return-brief', identity.account, 'basic-thread',
    useWorkspaceStore.getState().historyRevision], { ...base, product: { ...product, revision: 12 },
    sourceFingerprint: 'd'.repeat(64) }));
  expect(await screen.findByText(/Copia de edición anterior · revisión 11/)).toBeInTheDocument();
  expect(screen.getByLabelText('Copiar edición local de la revisión 11')).toHaveValue(
    'benefits: Mi texto sin guardar para revisar\n\ncomponents: 48 piezas');
  expect(screen.getByText(/no se aplicará a la revisión 12/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar y marcar revisado' })).not.toBeInTheDocument();
  expect(patch).not.toHaveBeenCalled();
});

it('al cambiar de cuenta elimina las copias de la pestaña antes de mostrar otra identidad', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: preparationBrief } as never : prep() as never);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar este dato →' }));
  fireEvent.change(await screen.findByLabelText('Ventajas comprobables'),
    { target: { value: 'Texto de cuenta A' } });
  expect(sessionStorage.length).toBeGreaterThan(0);
  act(() => {
    identity.account = 'qa-b@example.test';
    window.dispatchEvent(new Event('uonify:identity-changed'));
  });
  expect([...Array(sessionStorage.length).keys()].filter(index =>
    sessionStorage.key(index)?.startsWith('uonify:return-preparation-draft:'))).toHaveLength(0);
  expect(screen.queryByText(/Texto de cuenta A/)).not.toBeInTheDocument();
});

it('no muestra el dato ni guarda si el GET de preparación corresponde a otra revisión', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path.endsWith('/return-brief')
    ? { returnBrief: preparationBrief } as never : prep(12) as never);
  const patch = vi.spyOn(api, 'patch');
  mount();
  expect(await screen.findByText(/El dato ha cambiado; actualiza el resumen/)).toBeInTheDocument();
  expect(screen.queryByText(/Construcción creativa/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar y marcar revisado' })).not.toBeInTheDocument();
  expect(patch).not.toHaveBeenCalled();
});

it('descarta una respuesta tardía si cambia la cuenta antes del GET de incidencia', async () => {
  let release!: (value: unknown) => void;
  let reads = 0;
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path.endsWith('/assignment-return')) throw new ApiError(404, { detail: 'Not Found' });
    return path.endsWith('/return-brief') && reads++ === 0
      ? { returnBrief: reasoningBrief('error') } as never : new Promise(resolve => { release = resolve; }) as never;
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ver incidencia de IA →' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  identity.account = 'qa-b@example.test';
  act(() => window.dispatchEvent(new Event('uonify:identity-changed')));
  await act(async () => { release({ returnBrief: reasoningBrief('error') }); });
  expect(screen.queryByText(/Google no completó la comprobación/)).not.toBeInTheDocument();
  expect(prepareProductRequirements).not.toHaveBeenCalled();
});

it('conserva la tarjeta durante un requestId de retry persistido y la oculta ante otra petición', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ returnBrief: reasoningBrief('error') });
  const intent = saveReturnRetryIntent({ account: identity.account, threadId: 'basic-thread', sku: 'BASIC',
    revision: 11, linkVersion: 1, reasoningId: jobId, reasoningStatus: 'error',
    sourceFingerprint: 'b'.repeat(64) }, null, false);
  expect(intent).not.toBeNull();
  mount();
  expect(await screen.findByText(/El intento guardado terminó con error/)).toBeInTheDocument();
  act(() => setUi({ pendingReply: { threadId: 'basic-thread', requestId: intent!.requestId, label: 'Consultando…' } }));
  expect(screen.getByText(/El intento guardado terminó con error/)).toBeInTheDocument();
  act(() => setUi({ pendingReply: { threadId: 'basic-thread', requestId: crypto.randomUUID(), label: 'Otra petición' } }));
  await waitFor(() => expect(screen.queryByText(/El intento guardado terminó con error/)).not.toBeInTheDocument());
});
