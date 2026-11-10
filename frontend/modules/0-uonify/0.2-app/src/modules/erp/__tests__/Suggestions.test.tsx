import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { workspaceRoutes } from '../routes';
import { useFinanceFilters } from '../hooks/useFinanceFilters';
import { useSuggestions } from '../hooks/useSuggestions';
import { changedProposal, totalOf, validateProposal } from '../model/suggestions';
import { setupServer } from 'msw/node';
import { handlers as erpHandlers } from '../mocks/handlers';

const ui = vi.hoisted(() => ({ isNavigationOpen: false, focusComposer: vi.fn(), announce: vi.fn(), setSheetTitle: vi.fn() }));

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
  useSuggestions.getState().reset();
});

const LAZY = { timeout: 4000 };

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/espacio', element: <Outlet />, children: workspaceRoutes }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

test('sugerencias: revisión del nodo, aprobación del Jefe de compras y borrador en Compras', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp/sugerencias-compras');
  const panel = await screen.findByRole('complementary', { name: 'Sugerencias de compras' }, LAZY);
  expect(within(panel).getByText('3 sugerencias DEMO')).toBeInTheDocument();
  const suggestionRows = within(panel).getAllByRole('button', { name: /DEMO-SUG-/ });
  expect(suggestionRows).toHaveLength(3);
  for (const row of suggestionRows) expect(row).toHaveTextContent('Pendiente de revisión del nodo');

  await user.click(within(panel).getByRole('button', { name: /DEMO-SUG-001/ }));
  expect(router.state.location.pathname).toBe('/espacio/erp/sugerencias-compras/DEMO-SUG-001');
  expect(screen.getByRole('heading', { level: 1, name: 'Compra sugerida · DEMO-SUG-001' })).toBeInTheDocument();
  // En el panel (como la cabecera de la lista de la demo) y en la cabecera de la ficha.
  expect(screen.getAllByText('DEMO · IA no conectada')).toHaveLength(2);
  expect(screen.getByRole('heading', { level: 2, name: 'Validación y ajustes del Jefe de nodo' })).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Validar y enviar al jefe de compras' });
  expect(send).toBeDisabled();

  const quantity = screen.getByLabelText('Cantidad a comprar');
  await user.clear(quantity);
  await user.type(quantity, '25');
  // Cambian la cantidad y, con ella, el total estimado: dos celdas marcadas, como la demo.
  expect(screen.getAllByText('Modificado frente a IA')).toHaveLength(2);
  await user.type(screen.getByLabelText('Observaciones'), 'Urgente para el cierre');
  await user.click(screen.getByLabelText('Confirmo la revisión de esta propuesta DEMO.'));
  await user.click(send);

  expect(screen.getByRole('heading', { level: 2, name: '2. Revisión del Jefe de compras' })).toBeInTheDocument();
  expect(screen.getByText('El nodo modificó la recomendación. Revisa las diferencias antes de aprobar y decide si requiere prioridad.')).toBeInTheDocument();
  expect(screen.getByLabelText('Observaciones')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Observaciones')).toHaveValue('Urgente para el cierre');
  const first = within(panel).getByRole('button', { name: /DEMO-SUG-001/ });
  expect(first).toHaveTextContent('Pendiente del Jefe de compras');
  expect(first).toHaveTextContent('Modificada por el nodo');

  await user.click(screen.getByLabelText('Marcar como compra prioritaria'));
  await user.type(screen.getByLabelText('Observaciones del Jefe de compras'), 'Aprobada con prioridad');
  await user.click(screen.getByLabelText('Confirmo la revisión de esta propuesta DEMO.'));
  await user.click(screen.getByRole('button', { name: 'Aprobar y pasar a Compras' }));

  expect(router.state.location.pathname).toBe('/espacio/erp/solicitudes-compra/DEMO-COM-IA-001');
  expect(screen.getByRole('heading', { level: 1, name: 'DEMO-COM-IA-001' })).toBeInTheDocument();
  expect(screen.getByText(/Valores finales de la propuesta revisada\./)).toBeInTheDocument();
  expect(screen.getByText('Jefe de nodo + Jefe de compras · DEMO sin identidad autenticada')).toBeInTheDocument();
  expect(screen.getByText('Prioritaria')).toBeInTheDocument();
  expect(screen.getByText('Urgente para el cierre')).toBeInTheDocument();
  expect(screen.getByText('Aprobada con prioridad')).toBeInTheDocument();
  expect(screen.getAllByText('Bs. 3.750,00').length).toBeGreaterThan(0);

  const compras = await screen.findByRole('complementary', { name: 'Compras' });
  expect(within(compras).getByText('7 compras ficticias · Vista local')).toBeInTheDocument();
  expect(within(compras).getAllByRole('button', { name: /DEMO-(COM|OC)-/ })[0]).toHaveTextContent('DEMO-COM-IA-001');
});

test('sugerencias: una propuesta no válida avisa con el texto de la demo y no avanza', async () => {
  const user = userEvent.setup();
  renderAt('/espacio/erp/sugerencias-compras/DEMO-SUG-002');
  const quantity = await screen.findByLabelText('Cantidad a comprar', {}, LAZY);
  await user.clear(quantity);
  await user.type(quantity, '0');
  expect(screen.getByText('Revisa los importes')).toBeInTheDocument();
  await user.click(screen.getByLabelText('Confirmo la revisión de esta propuesta DEMO.'));
  await user.click(screen.getByRole('button', { name: 'Validar y enviar al jefe de compras' }));
  expect(screen.getByRole('alert')).toHaveTextContent('La cantidad debe ser un número entero entre 1 y 1.000.000.');
  expect(screen.getByRole('heading', { level: 2, name: 'Validación y ajustes del Jefe de nodo' })).toBeInTheDocument();
});

test('sugerencias: referencia que no existe y reglas de la demo', async () => {
  const user = userEvent.setup();
  const router = renderAt('/espacio/erp/sugerencias-compras/DEMO-SUG-999');
  expect(await screen.findByRole('heading', { level: 1, name: 'Sugerencia no disponible' }, LAZY)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Volver a sugerencias' }));
  expect(router.state.location.pathname).toBe('/espacio/erp/sugerencias-compras');
  expect(validateProposal({ quantity: '10', price: '12.345', supplier: 'X' })).toBe('Indica un precio positivo de hasta 1.000.000, con un máximo de dos decimales.');
  expect(validateProposal({ quantity: '10', price: '12.34', supplier: '  ' })).toBe('Indica un proveedor de hasta 160 caracteres.');
  expect(totalOf({ quantity: 3, price: 10.005 })).toBe(30.03);
  expect(changedProposal({ quantity: 1, price: 2, supplier: 'A ' }, { quantity: '1', price: '2', supplier: 'A' })).toBe(false);
});
