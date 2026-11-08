import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { IncidentsView } from '../components/IncidentsView';
import { incidentKeys } from '../hooks/useIncidents';
import type { IncidentList, ProductIncident } from '../model/types';

const mocks = vi.hoisted(() => ({ account: 'one@example.test', start: vi.fn() }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => mocks.account }));
vi.mock('@/modules/workspace', () => ({ startIncidentResolution: mocks.start }));

const incident = (changes: Partial<ProductIncident> = {}): ProductIncident => ({
  id: 'issue-1', sku: 'BRICKS/01', productId: 'product-1', productName: 'Basic Mini Bricks', marketplaceId: 'ES', marketplaceName: 'España',
  code: '90220', message: 'Falta el material del producto.', severity: 'ERROR', attributeNames: ['material'], status: 'needs_attention', revision: 1,
  firstSeenAt: '2026-10-14T08:00:00Z', lastSeenAt: '2026-10-14T09:00:00Z', resolvedAt: null, history: [], submissionStatus: null, ...changes,
});
const fixture = (items = [incident()]): IncidentList => ({ incidents: items, summary: { active: items.filter(item => item.status !== 'resolved').length, products: 1, blocking: 1, warnings: 0 },
  sync: { state: 'ok', lastCheckedAt: '2026-10-14T09:00:00Z', message: null, nextToken: null }, connection: { connected: true, marketplaceId: 'ES' } });

function mount(sku?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><IncidentsView sku={sku} /></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => { mocks.account = 'one@example.test'; mocks.start.mockReset().mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());

test('detalle real inicia la resolución en el mismo chat con el identificador, sin inventar cierre', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/product-incidents' ? fixture() : { incident: incident() });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Basic Mini Bricks.*Falta el material/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Resolver con Uony' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('issue-1', 'start'));
  expect(screen.getAllByText('Requiere corrección')).toHaveLength(3); // filtro, fila y detalle
  expect(screen.queryByText('Resuelta', { selector: 'span' })).not.toBeInTheDocument();
});

test('envío aceptado permanece pendiente y solo ofrece comprobar su resultado', async () => {
  const pending = incident({ status: 'awaiting_amazon', submissionStatus: 'accepted' });
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/product-incidents' ? fixture([pending]) : { incident: pending });
  mount('BRICKS/01');
  fireEvent.click(await screen.findByRole('button', { name: /Basic Mini Bricks.*Falta el material/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Comprobar con Uony' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('issue-1', 'check'));
  expect(screen.queryByRole('button', { name: 'Resolver con Uony' })).not.toBeInTheDocument();
});

test('error de consulta y desconexión nunca muestran el estado limpio', async () => {
  const result = fixture([]); result.connection.connected = false; result.sync.state = 'error'; result.sync.message = 'No se pudo consultar Amazon.';
  vi.spyOn(api, 'get').mockResolvedValue(result);
  mount();
  expect(await screen.findByText('Amazon no está conectado. El historial guardado se conserva.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo consultar Amazon.');
  expect(screen.getByRole('button', { name: /Comprobar en Amazon/ })).toBeDisabled();
  expect(screen.queryByText('No hay incidencias pendientes registradas')).not.toBeInTheDocument();
});

test('consulta parcial continúa con cursor opaco y conserva incidencias hasta completar', async () => {
  const result = fixture(); result.sync.state = 'partial'; result.sync.nextToken = 'opaque-cursor';
  vi.spyOn(api, 'get').mockResolvedValue(result);
  const post = vi.spyOn(api, 'post').mockResolvedValue(result);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Continuar comprobación' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/product-incidents/sync', { sku: undefined, marketplaceId: undefined, cursor: 'opaque-cursor' }));
  expect(screen.getByText('Falta el material del producto.')).toBeInTheDocument();
});

test('la vista global busca SKU, filtra gravedad y recupera el historial del servidor', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(fixture([incident(), incident({ id: 'issue-2', sku: 'LAMP-2', productName: 'Lámpara', severity: 'WARNING' })]));
  mount();
  await screen.findByText('Basic Mini Bricks');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'LAMP' } });
  expect(screen.queryByText('Basic Mini Bricks')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Gravedad'), { target: { value: 'ERROR' } });
  expect(screen.getByText('No hay coincidencias con estos filtros')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'resolved' } });
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/product-incidents', expect.objectContaining({ params: { sku: undefined, status: 'resolved', marketplaceId: undefined } })));
});

test('un fallo HTTP muestra reintento y no se convierte en lista vacía correcta', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, { message: 'Necesitas volver a iniciar sesión.' }));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Necesitas volver a iniciar sesión.');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(screen.queryByText(/0 incidencias pendientes/)).not.toBeInTheDocument();
});

test('cambiar cuenta elimina el detalle anterior y separa la caché por identidad', async () => {
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/product-incidents' ? fixture(mocks.account === 'one@example.test' ? [incident()] : []) : { incident: incident() });
  const { client } = mount();
  fireEvent.click(await screen.findByRole('button', { name: /Basic Mini Bricks.*Falta el material/ }));
  await screen.findByRole('button', { name: 'Resolver con Uony' });
  act(() => { mocks.account = 'two@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  await waitFor(() => expect(screen.queryByText('Basic Mini Bricks')).not.toBeInTheDocument());
  expect(screen.queryByRole('region', { name: 'Detalle de la incidencia' })).not.toBeInTheDocument();
  expect(client.getQueriesData({ queryKey: incidentKeys.account('one@example.test') })).not.toHaveLength(0);
  expect(client.getQueriesData({ queryKey: incidentKeys.account('two@example.test') })).not.toHaveLength(0);
});

test('cambiar de mercado consulta y sincroniza ese mercado, sin filtrar solo la página local', async () => {
  const result = fixture(); result.connection.marketplaces = [{ id: 'ES', name: 'España' }, { id: 'FR', name: 'Francia' }];
  const get = vi.spyOn(api, 'get').mockResolvedValue(result);
  const post = vi.spyOn(api, 'post').mockResolvedValue(result);
  mount();
  fireEvent.change(await screen.findByLabelText('Mercado'), { target: { value: 'FR' } });
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/product-incidents', expect.objectContaining({ params: { sku: undefined, status: 'active', marketplaceId: 'FR' } })));
  fireEvent.click(await screen.findByRole('button', { name: /Comprobar en Amazon/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/product-incidents/sync', { sku: undefined, marketplaceId: 'FR' }));
});

test('reconectar otro vendedor bajo la misma cuenta retira de inmediato los datos anteriores', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(fixture());
  mount();
  await screen.findByText('Basic Mini Bricks');
  get.mockImplementation(() => new Promise(() => {}));
  act(() => window.dispatchEvent(new CustomEvent('uonify:amazon-connection-changed', { detail: { account: mocks.account } })));
  await waitFor(() => expect(screen.queryByText('Basic Mini Bricks')).not.toBeInTheDocument());
  expect(screen.getByText('Cargando incidencias…')).toBeInTheDocument();
});

test('seguimiento automático solo lee el mercado pendiente, pausa oculto/sin red y se limita a cinco consultas', async () => {
  let poll = () => {};
  const originalInterval = window.setInterval.bind(window);
  const originalClear = window.clearInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 60_000) { poll = callback as () => void; return 123456; }
    return originalInterval(callback, delay, ...args);
  });
  vi.spyOn(window, 'clearInterval').mockImplementation(id => { if (id !== 123456) originalClear(id); });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const result = fixture([incident({ status: 'awaiting_amazon', marketplaceId: 'FR', marketplaceName: 'Francia' })]);
  vi.spyOn(api, 'get').mockResolvedValue(result);
  const post = vi.spyOn(api, 'post').mockResolvedValue(result);
  mount();
  await screen.findByText('Basic Mini Bricks');
  act(() => poll());
  expect(post).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible'); online.mockReturnValue(false);
  act(() => poll());
  expect(post).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  for (let count = 1; count <= 5; count += 1) {
    await act(async () => { poll(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(count));
    await waitFor(() => expect(screen.getByRole('button', { name: /Comprobar en Amazon/ })).toBeEnabled());
  }
  act(() => poll());
  expect(post).toHaveBeenCalledTimes(5);
  expect(post).toHaveBeenLastCalledWith('/product-incidents/sync', { sku: undefined, marketplaceId: 'FR' });
});

