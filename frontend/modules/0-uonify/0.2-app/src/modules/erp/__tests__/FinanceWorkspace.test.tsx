import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { workspaceRoutes } from '../routes';
import { useFinanceFilters } from '../hooks/useFinanceFilters';
import { FINANCE_MENU } from '../model/menu';
import { DATE_RANGE_ERROR, DEMO_ORDERS, DEMO_PURCHASES, EMPTY_FILTERS, ORDER_STATUSES, filterPurchases, suggestPurchases } from '../model/demoPurchases';
import { setupServer } from 'msw/node';
import { handlers as erpHandlers } from '../mocks/handlers';

const ui = vi.hoisted(() => ({
  isNavigationOpen: false,
  focusComposer: vi.fn(),
  announce: vi.fn(),
  setSheetTitle: vi.fn(),
}));

vi.mock('@/modules/workspace', () => ({
  TopbarCenter: ({ children }: { children: ReactNode }) => <div data-testid="topbar-center">{children}</div>,
  ConversationDock: () => <div data-testid="conversation-dock" />,
  useWorkspaceUi: () => ui,
}));

// La conexión con el ERP se valida al entrar: responde la simulación del módulo (sin latencia).
vi.mock('@/shared/mocks/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/mocks/utils')>()),
  latency: () => Promise.resolve(),
}));
const erpServer = setupServer(...erpHandlers);
beforeAll(() => erpServer.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => erpServer.close());

beforeEach(() => {
  vi.clearAllMocks();
  useFinanceFilters.getState().reset();
});

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/espacio', element: <Outlet />, children: workspaceRoutes }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

// La ruta de ERP se carga aparte: con toda la batería en marcha, la primera carga puede tardar.
const LAZY = { timeout: 4000 };
const menu = () => screen.findByRole('complementary', { name: 'Menú de Finanzas' }, LAZY);
const list = () => screen.findByRole('complementary', { name: 'Compras' }, LAZY);
const rows = (panel: HTMLElement) => within(panel).queryAllByRole('button', { name: /DEMO-(COM|OC)-/ });

test('al entrar: el menú de Finanzas del equipo y la conversación centrada', async () => {
  renderAt('/espacio/erp');
  const panel = await menu();
  expect(screen.getByTestId('conversation-dock')).toBeInTheDocument();
  expect(screen.getByTestId('topbar-center')).toHaveTextContent('Vista local · Datos ficticios');
  for (const group of ['Gestión comercial', 'Gestión de compras', 'Cartera y obligaciones', 'Tesorería', 'Gastos y fondos menores']) {
    expect(within(panel).getByText(group, { selector: 'summary span' })).toBeInTheDocument();
  }
  expect(within(panel).getByRole('button', { name: 'Compras' })).toBeEnabled();
  expect(within(panel).getByRole('button', { name: 'Cotizaciones' })).toBeEnabled();
  expect(within(panel).getByRole('button', { name: 'Clientes' })).toBeEnabled();
  expect(within(panel).queryByText(/Pendiente|Próximamente/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Gestión de compras' })).toHaveLength(1);
});

test('Compras: lista en bolívares con concepto, ficha con los textos de la demo y vuelta al menú', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp');
  await user.click(within(await menu()).getByRole('button', { name: 'Compras' }));
  expect(router.state.location.pathname).toBe('/espacio/erp/solicitudes-compra');
  const panel = await list();
  expect(within(panel).getByText('6 compras ficticias · Vista local')).toBeInTheDocument();
  expect(rows(panel)).toHaveLength(6);
  expect(within(panel).getByText('Bs. 18.450,50 · Suministros Horizonte DEMO')).toBeInTheDocument();
  expect(within(panel).getByText('Material de oficina')).toBeInTheDocument();
  expect(within(panel).getByText('07/11/2026 · Nodo de ejemplo A')).toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: /DEMO-COM-001/ }));
  expect(router.state.location.pathname).toBe('/espacio/erp/solicitudes-compra/DEMO-COM-001');
  expect(screen.getByRole('heading', { level: 1, name: 'DEMO-COM-001' })).toBeInTheDocument();
  expect(screen.getByText('Datos ficticios · Borrador')).toBeInTheDocument();
  for (const title of ['Información general', 'Proveedor', 'Productos y servicios', 'Condiciones y entrega', 'Resumen de importes', 'Documentos relacionados y soportes', 'Observaciones y trazabilidad']) {
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  }
  expect(screen.getByText('Esta ficha no genera deuda, pagos, reservas ni movimientos de inventario.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cerrar ficha' }));
  expect(router.state.location.pathname).toBe('/espacio/erp/solicitudes-compra');
  expect(ui.focusComposer).toHaveBeenCalled();
  expect(screen.getByTestId('conversation-dock')).toBeInTheDocument();
  await user.click(within(await list()).getByRole('button', { name: 'Volver al menú de Finanzas' }));
  expect(await menu()).toBeInTheDocument();
});

test('buscar con sugerencias, como la demo: flechas, Enter y Escape', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/erp/solicitudes-compra');
  const panel = await list();
  const search = within(panel).getByRole('combobox', { name: 'Buscar compra' });
  await user.type(search, 'tecnologia');
  expect(rows(panel).map(row => row.textContent)).toEqual([expect.stringContaining('DEMO-COM-003')]);
  const options = within(within(panel).getByRole('listbox', { name: 'Sugerencias de compras' })).getAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual(['Tecnología Andina DEMO']);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(search).toHaveValue('Tecnología Andina DEMO');
  expect(within(panel).queryByRole('listbox')).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'demo-com-00');
  expect(within(panel).getByRole('listbox')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(within(panel).queryByRole('listbox')).not.toBeInTheDocument();
});

test('filtrar: moneda, fechas y un rango invertido que avisa aunque se plieguen los filtros', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/erp/solicitudes-compra');
  const panel = await list();
  await user.click(within(panel).getByRole('button', { name: /Filtros/ }));
  await user.selectOptions(within(panel).getByRole('combobox', { name: 'Moneda' }), 'USD');
  expect(rows(panel)).toHaveLength(3);
  await user.type(within(panel).getByLabelText('Desde'), '2026-11-01');
  expect(rows(panel)).toHaveLength(1);
  await user.type(within(panel).getByLabelText('Hasta'), '2026-10-01');
  expect(within(panel).getByRole('alert')).toHaveTextContent(DATE_RANGE_ERROR);
  expect(rows(panel)).toHaveLength(1);
  // Plegar con el aviso activo: el panel se cierra y el aviso sigue a la vista, fuera de él.
  await user.click(within(panel).getByRole('button', { name: /Filtros/ }));
  expect(within(panel).getByRole('button', { name: /Filtros/ })).toHaveAttribute('aria-expanded', 'false');
  expect(within(panel).getByRole('alert')).toBeVisible();
  await user.click(within(panel).getByRole('button', { name: /Filtros/ }));
  await user.click(within(panel).getByRole('button', { name: 'Limpiar filtros' }));
  expect(rows(panel)).toHaveLength(6);
});

test('Escape pliega el panel abierto sin fijar, como el catálogo, y el foco vuelve al raíl', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/erp/solicitudes-compra/DEMO-COM-001');
  // El primer icono del raíl: jsdom no mide, así que el foco vuelve al primero (como railMain en Producto).
  const rail = await screen.findByRole('button', { name: 'Gestión comercial' }, LAZY);
  await user.click(rail);
  expect(rail).toHaveAttribute('aria-expanded', 'true');
  expect(await menu()).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(rail).toHaveAttribute('aria-expanded', 'false');
  expect(rail).toHaveFocus();
});

test('referencias y apartados que no están: «Documento no disponible» o vuelta al menú', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp/solicitudes-compra/DEMO-COM-999');
  expect(await screen.findByRole('heading', { level: 1, name: 'Documento no disponible' }, LAZY)).toBeInTheDocument();
  expect(screen.getByText('La referencia no corresponde a un documento DEMO.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Volver a Compras' }));
  expect(router.state.location.pathname).toBe('/espacio/erp/solicitudes-compra');
  await router.navigate('/espacio/erp/no-existe');
  await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/erp'));
  await router.navigate('/espacio/erp/DEMO-COM-001');
  await waitFor(() => expect(router.state.location.pathname).toBe('/espacio/erp'));
});

test('modelo: menú literal del equipo, filtros de partida, sugerencias y rango invertido sin aplicar', () => {
  expect(FINANCE_MENU.map(group => group.name)).toEqual(['Gestión comercial', 'Gestión de compras', 'Cartera y obligaciones', 'Tesorería', 'Gastos y fondos menores']);
  expect(FINANCE_MENU[1].items.map(item => item.label)).toEqual(['Resumen', 'Proveedores', 'Compras', 'Sugerencias de compras', 'Órdenes de compra', 'Facturas de proveedores']);
  expect(filterPurchases(DEMO_PURCHASES, EMPTY_FILTERS).map(item => item.currency)).toEqual(Array(6).fill('VES'));
  expect(filterPurchases(DEMO_PURCHASES, { ...EMPTY_FILTERS, currency: 'EUR', node: 'b' }).map(item => item.reference)).toEqual(['DEMO-COM-011']);
  expect(suggestPurchases(DEMO_PURCHASES, { ...EMPTY_FILTERS, search: 'limpieza' })).toEqual(['Limpieza Brisa DEMO', 'Insumos de limpieza']);
  expect(suggestPurchases(DEMO_PURCHASES, { ...EMPTY_FILTERS, search: '  ' })).toEqual([]);
  useFinanceFilters.getState().setFilters('solicitudes-compra', { ...EMPTY_FILTERS, from: '2026-11-05', to: '2026-11-01' });
  expect(useFinanceFilters.getState().lists['solicitudes-compra'].draft.to).toBe('2026-11-01');
  expect(useFinanceFilters.getState().lists['solicitudes-compra'].applied).toEqual(EMPTY_FILTERS);
  expect(DEMO_ORDERS.map(order => order.status).slice(0, 8)).toEqual([...ORDER_STATUSES]);
  expect(DEMO_ORDERS[0]).toMatchObject({ reference: 'DEMO-OC-001', source: 'DEMO-COM-001' });
});

test('Órdenes de compra: estados de la demo, filtro por estado y ficha de orden', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp');
  await user.click(within(await menu()).getByRole('button', { name: 'Órdenes de compra' }));
  expect(router.state.location.pathname).toBe('/espacio/erp/ordenes-compra');
  const panel = await screen.findByRole('complementary', { name: 'Órdenes de compra' });
  expect(within(panel).getByText('6 órdenes ficticias · Vista local')).toBeInTheDocument();
  expect(within(panel).getByText('06/11/2026 · Nodo de ejemplo B · Pendiente de aprobación')).toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: /Filtros/ }));
  await user.selectOptions(within(panel).getByRole('combobox', { name: 'Estado' }), 'En tránsito');
  expect(rows(panel).map(row => row.textContent)).toEqual([expect.stringContaining('DEMO-OC-003')]);
  await user.click(rows(panel)[0]);
  expect(router.state.location.pathname).toBe('/espacio/erp/ordenes-compra/DEMO-OC-003');
  expect(screen.getByRole('heading', { level: 1, name: 'DEMO-OC-003' })).toBeInTheDocument();
  expect(screen.getByText('Datos ficticios · En tránsito')).toBeInTheDocument();
  expect(screen.getByText('Fecha de la orden')).toBeInTheDocument();
  expect(screen.getByText('Consultar detalle de recepción · no conectado')).toBeInTheDocument();
  expect(screen.getByText('Estado ilustrativo · sin aprobación real')).toBeInTheDocument();
  expect(screen.getAllByText('DEMO-COM-003').length).toBeGreaterThan(0);
});

test('Resumen: indicadores sin cifras, tablas vacías y filtros con «Aplicar filtros»', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp');
  await user.click(within(await menu()).getByRole('button', { name: 'Resumen' }));
  expect(router.state.location.pathname).toBe('/espacio/erp/resumen-compras');
  expect(screen.getByRole('heading', { level: 1, name: 'Resumen' })).toBeInTheDocument();
  expect(screen.getByText('Vista previa · Sin datos')).toBeInTheDocument();
  const indicators = screen.getByLabelText('Indicadores de compras');
  expect(within(indicators).getAllByText('—')).toHaveLength(6);
  expect(screen.getByText('Sin información de proveedores')).toBeInTheDocument();
  expect(screen.getByText('Sin información de reservas')).toBeInTheDocument();
  const scope = screen.getByRole('status');
  expect(scope).toHaveTextContent('Resumen general Todos los nodos');
  expect(scope).toHaveTextContent('Todas las fechas · Bolívares (Bs.)');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Nodo' }), 'b');
  expect(scope).toHaveTextContent('Todos los nodos');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  expect(scope).toHaveTextContent('Resumen por nodo Nodo de ejemplo B');
  await user.type(screen.getByLabelText('Fecha desde'), '2026-11-05');
  await user.type(screen.getByLabelText('Fecha hasta'), '2026-11-01');
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  expect(screen.getByRole('alert')).toHaveTextContent(DATE_RANGE_ERROR);
  expect(screen.getByLabelText('Fecha hasta')).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Restablecer' }));
  expect(scope).toHaveTextContent('Resumen general Todos los nodos');
  await user.click(screen.getByRole('button', { name: 'Cerrar resumen' }));
  expect(router.state.location.pathname).toBe('/espacio/erp');
});

test('un apartado sin registros se abre vacío, sin datos de ejemplo', async () => {
  renderAt('/espacio/erp/caja-chica');
  expect(await screen.findByText('Aún no hay caja chica en esta empresa.')).toBeInTheDocument();
});
