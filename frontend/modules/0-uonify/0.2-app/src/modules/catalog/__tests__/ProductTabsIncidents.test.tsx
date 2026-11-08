import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { api } from '@/shared/api/client';
import { pimStore } from '@/shared/pim';
import { ProductTabs } from '../components/ProductTabs';
import { useCatalogStore } from '../hooks/useCatalogStore';

vi.mock('@/shared/api/config', async original => ({ ...await original<typeof import('@/shared/api/config')>(), USE_MOCKS: false }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'one@example.test' }));
vi.mock('@/modules/workspace', () => ({
  TopbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationDock: () => <div>Conversación conservada</div>,
  startIncidentResolution: vi.fn(),
  useWorkspaceUi: () => ({ isConversationOpen: true, isNavigationOpen: false, setSheetTitle: () => {}, announce: () => {}, focusComposer: () => {} }),
}));
const { workspaceRoutes } = await import('../routes');
const product = { sku: 'BRICKS/01', name: 'Basic Mini Bricks', brand: 'UONIFY', revision: 1, customFields: [], bullets: [] };
const issue = { id: 'issue-1', sku: product.sku, productId: 'p1', productName: product.name, marketplaceId: 'ES', marketplaceName: 'España', code: '90220', message: 'Falta el material.', severity: 'ERROR', attributeNames: ['material'], status: 'needs_attention', revision: 1, firstSeenAt: '2026-10-14', lastSeenAt: '2026-10-14', resolvedAt: null, history: [], submissionStatus: null };
let active = true;
let syncState = 'ok';
let connected = true;
const issues = () => ({ incidents: active ? [issue] : [], summary: { active: active ? 1 : 0, products: active ? 1 : 0, blocking: active ? 1 : 0, warnings: 0 }, sync: { state: syncState, lastCheckedAt: '2026-10-14', message: null, nextToken: null }, connection: { connected, marketplaceId: 'ES' } });
beforeEach(() => { active = true; syncState = 'ok'; connected = true; pimStore.clear(); useCatalogStore.setState({ drawer: { open: false, pinned: false }, layoutReady: false, selection: [], channelStates: {}, publishRequest: null, redirect: null }); });
afterEach(() => vi.restoreAllMocks());
function mount(path: string) {
  vi.spyOn(api, 'get').mockImplementation(async route => route === '/product-incidents' ? issues() : route === '/products' ? { products: [product] } : { product });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/espacio', element: <Outlet />, children: workspaceRoutes }], { initialEntries: [path] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router };
}

test('la pestaña resuelta sigue abierta y se oculta al abandonarla; teclado solo recorre las visibles', () => {
  const onSelect = vi.fn();
  const { rerender } = render(<ProductTabs definitions={[]} active="incidencias" onSelect={onSelect} incidentCount={1} />);
  expect(screen.getByRole('tab', { name: 'Incidencias · 1' })).toHaveAttribute('aria-selected', 'true');
  rerender(<ProductTabs definitions={[]} active="incidencias" onSelect={onSelect} incidentCount={0} />);
  expect(screen.getByRole('tab', { name: 'Incidencias' })).toHaveAttribute('aria-selected', 'true');
  rerender(<ProductTabs definitions={[]} active="aplus" onSelect={onSelect} incidentCount={0} />);
  expect(screen.queryByRole('tab', { name: 'Incidencias' })).not.toBeInTheDocument();
  fireEvent.keyDown(within(screen.getByRole('tablist')).getByRole('tab', { name: 'A+' }), { key: 'ArrowRight' });
  expect(onSelect).toHaveBeenCalledWith('atributos', true);
});

test('badge abre la pestaña y el resultado servidor cierra la última sin quitar el panel abierto', async () => {
  const { router } = mount('/espacio/producto/BRICKS%2F01');
  fireEvent.click(await screen.findByRole('button', { name: '1 incidencia requiere atención' }));
  expect(router.state.location.pathname).toBe('/espacio/producto/BRICKS%2F01/incidencias');
  await screen.findByText('Falta el material.');
  act(() => { active = false; window.dispatchEvent(new Event('uonify:product-incidents-changed')); });
  expect(await screen.findByText('No hay incidencias pendientes registradas')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Incidencias' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Atributos' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Incidencias' })).not.toBeInTheDocument());
});

test('Ver todas abre la bandeja global; el acceso del catálogo sigue disponible con cero incidencias', async () => {
  const { router } = mount('/espacio/producto/BRICKS%2F01/incidencias');
  expect(await screen.findByRole('button', { name: 'Todas las incidencias: 1 incidencia pendiente' })).toHaveAttribute('data-state', 'attention');
  fireEvent.click(await screen.findByRole('button', { name: 'Ver todas las incidencias' }));
  expect(router.state.location.pathname).toBe('/espacio/producto/incidencias/todas');
  expect(await screen.findByRole('region', { name: 'Todas las incidencias' })).toBeInTheDocument();
  expect(await screen.findByRole('searchbox', { name: 'Buscar producto o SKU' })).toBeInTheDocument();
  act(() => { active = false; window.dispatchEvent(new Event('uonify:product-incidents-changed')); });
  await screen.findByText('No hay incidencias pendientes registradas');
  expect(await screen.findByRole('button', { name: 'Todas las incidencias: Todo correcto, no hay incidencias' })).toHaveAttribute('data-state', 'clear');
  expect(router.state.location.pathname).toBe('/espacio/producto/incidencias/todas');
});

test.each([
  ['never', true, 'Pendiente de comprobar'],
  ['partial', true, 'Comprobación incompleta'],
  ['error', true, 'No se ha podido comprobar'],
  ['ok', false, 'Conecta Amazon para comprobar'],
])('el acceso no anuncia cero confirmado con estado %s y conexión %s', async (state, connection, message) => {
  active = false; syncState = state; connected = connection;
  mount('/espacio/producto');
  expect(await screen.findByRole('button', { name: `Todas las incidencias: ${message}` })).toHaveAttribute('data-state', 'unknown');
  expect(screen.queryByRole('button', { name: /Todo correcto, no hay incidencias/ })).not.toBeInTheDocument();
});

test('la desconexión conserva el contador de incidencias conocidas', async () => {
  connected = false;
  mount('/espacio/producto');
  const access = await screen.findByRole('button', { name: 'Todas las incidencias: 1 incidencia pendiente' });
  expect(access).toHaveAttribute('data-state', 'attention');
  expect(access).toHaveAttribute('title', expect.stringContaining('Último estado conocido'));
});
