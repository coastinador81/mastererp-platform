import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { fail, HttpResponse, mock } from '@/shared/mocks/utils';
import { workspaceRoutes } from '../routes';
import { useMastererp } from '../hooks/useMastererp';
import { demoConnection, demoStatus } from '../mocks/demo';
import { handlers } from '../mocks/handlers';

const ui = vi.hoisted(() => ({ isNavigationOpen: false, focusComposer: vi.fn(), announce: vi.fn(), setSheetTitle: vi.fn() }));

vi.mock('@/modules/workspace', () => ({
  TopbarCenter: ({ children }: { children: ReactNode }) => <div data-testid="topbar-center">{children}</div>,
  ConversationDock: () => <div data-testid="conversation-dock" />,
  useWorkspaceUi: () => ui,
}));
// Sin latencia simulada en las pruebas.
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  vi.clearAllMocks();
  demoConnection.set({ connected: false, tenantId: null, companyId: null });
  useMastererp.setState({ status: 'idle', message: null, spaces: [], tenant: '', context: null, company: '' });
});
afterEach(() => server.resetHandlers());

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/espacio', element: <Outlet />, children: workspaceRoutes }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

const LAZY = { timeout: 4000 };
const menu = () => screen.findByRole('complementary', { name: 'Menú de Finanzas' }, LAZY);

/** Conecta la simulación desde la tarjeta del menú, como haría la persona. */
async function connect(user: ReturnType<typeof userEvent.setup>) {
  const panel = await menu();
  await user.click(await within(panel).findByRole('button', { name: 'Conectar MasterERP' }));
  expect(await within(panel).findByText('Espacio DEMO · Empresa DEMO', {}, LAZY)).toBeInTheDocument();
  return panel;
}

test('sin conexión: menú de ejemplo y tarjeta para conectar; al conectar, datos del ERP con sus permisos', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/erp');
  const panel = await menu();
  expect(await within(panel).findByText(/la conexión se simula con datos de ejemplo/)).toBeInTheDocument();
  expect(within(panel).getByText('Clientes').closest('[aria-disabled]')).toHaveTextContent('Próximamente');
  await connect(user);
  expect(within(panel).getByText('Simulación')).toBeInTheDocument();
  expect(screen.getByTestId('topbar-center')).toHaveTextContent('Vista local · ERP simulado');
  for (const name of ['Clientes', 'Ventas', 'Proveedores', 'Compras', 'Órdenes de compra', 'Facturas de proveedores', 'Sugerencias de compras']) {
    expect(within(panel).getByRole('button', { name })).toBeEnabled();
  }
});

test('sin administration.read en el contexto, Ventas sale como «Sin acceso» (menú del equipo)', async () => {
  server.use(http.get(mock('/connections/erp'), () => {
    const status = demoStatus();
    return HttpResponse.json({ connection: { ...status, permissions: (status.permissions ?? []).filter(code => code !== 'administration.read') }, accessAllowed: true });
  }));
  const user = userEvent.setup();
  renderAt('/espacio/erp');
  const panel = await connect(user);
  expect(within(panel).getByText('Ventas').closest('[aria-disabled]')).toHaveTextContent('Sin acceso');
  expect(within(panel).getByRole('button', { name: 'Compras' })).toBeEnabled();
});

test('Compras: lista por el servidor con referencias opacas y ficha con los textos del equipo', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp');
  const panel = await connect(user);
  await user.click(within(panel).getByRole('button', { name: 'Compras' }));
  const list = await screen.findByRole('complementary', { name: 'Compras' }, LAZY);
  expect(await within(list).findByText('VES 18.450,50 · Suministros Horizonte DEMO')).toBeInTheDocument();
  expect(within(list).getByText('05/11/2026 · Borrador')).toBeInTheDocument();
  expect(within(list).getByText('Sin referencia')).toBeInTheDocument();
  expect(within(list).getByText('10 registros por página')).toBeInTheDocument();
  expect(within(list).getByRole('button', { name: 'Siguiente' })).toBeDisabled();

  await user.click(within(list).getByRole('button', { name: /DEMO-SC-0001/ }));
  expect(router.state.location.pathname).toBe('/espacio/erp/solicitudes-compra/DEMO-SC-0001');
  expect(await screen.findByRole('heading', { level: 1, name: 'DEMO-SC-0001' }, LAZY)).toBeInTheDocument();
  expect(screen.getByText('Borrador · DEMO-SC-0001 · Versión 1')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Papel bond carta (DEMO)' })).toBeInTheDocument();
});

test('Ventas: búsqueda en el servidor (q) y ficha con el detalle de la venta', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/erp');
  const panel = await connect(user);
  await user.click(within(panel).getByRole('button', { name: 'Ventas' }));
  const list = await screen.findByRole('complementary', { name: 'Ventas' }, LAZY);
  expect(await within(list).findByRole('button', { name: /DEMO-VT-1002/ })).toBeInTheDocument();
  await user.type(within(list).getByRole('searchbox', { name: 'Buscar ventas' }), '1001');
  await waitFor(() => expect(within(list).queryByRole('button', { name: /DEMO-VT-1002/ })).not.toBeInTheDocument(), LAZY);
  await user.click(await within(list).findByRole('button', { name: /DEMO-VT-1001/ }, LAZY));
  expect(await screen.findByRole('heading', { level: 1, name: 'Detalle de venta' }, LAZY)).toBeInTheDocument();
  expect(screen.getByText('Confirmada')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Detalle de la venta' })).toBeInTheDocument();
});

test('un 403 de la API enseña el texto del equipo y no ofrece reintentar', async () => {
  server.use(http.get(mock('/erp/clientes'), () => fail(403, 'Acceso denegado.', 'erp_denied')));
  const user = userEvent.setup();
  renderAt('/espacio/erp');
  const panel = await connect(user);
  await user.click(within(panel).getByRole('button', { name: 'Clientes' }));
  const list = await screen.findByRole('complementary', { name: 'Clientes' }, LAZY);
  expect(await within(list).findByRole('alert')).toHaveTextContent('Acceso denegado.');
  expect(within(list).queryByRole('button', { name: 'Recargar datos' })).not.toBeInTheDocument();
});
