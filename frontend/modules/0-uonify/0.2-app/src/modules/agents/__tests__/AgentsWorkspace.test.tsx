import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { workspaceRoutes } from '../routes';
import { useAgentsStore } from '../model/store';
import { PREDEFINED_AGENTS } from '../model/catalog';

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

beforeEach(() => {
  vi.clearAllMocks();
  useAgentsStore.setState({ drafts: [], requested: [] });
});

// Como en el espacio real: la vista genérica del servicio va antes que las rutas del módulo.
function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/espacio', element: <Outlet />, children: [{ path: 'agentes', element: <p>Vista genérica</p> }, ...workspaceRoutes] }],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const LAZY = { timeout: 4000 };

test('al entrar: el menú de Agentes y la conversación, sin la vista genérica', async () => {
  renderAt('/espacio/agentes');
  const panel = await screen.findByRole('complementary', { name: 'Menú de Agentes' }, LAZY);
  expect(screen.getByTestId('conversation-dock')).toBeInTheDocument();
  expect(screen.queryByText('Vista genérica')).not.toBeInTheDocument();
  for (const label of ['Inicio', 'Agentes predeterminados', 'Agentes personalizados', 'Conocimiento y reglas', 'Flujos y tareas', 'Aprobaciones', 'Integraciones y canales', 'Supervisión']) {
    expect(within(panel).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
  }
  expect(document.body.textContent).not.toMatch(/Próximamente|demo|pendiente/i);
});

test('los 10 agentes predeterminados, listos, y su ficha', async () => {
  const router = renderAt('/espacio/agentes/predeterminados');
  const panel = await screen.findByRole('complementary', { name: 'Agentes predeterminados' }, LAZY);
  expect(within(panel).getAllByText('Listo')).toHaveLength(PREDEFINED_AGENTS.length);
  await userEvent.click(within(panel).getByRole('button', { name: /^CRM/ }));
  expect(router.state.location.pathname).toBe('/espacio/agentes/predeterminados/crm');
  expect(await screen.findByRole('heading', { name: 'CRM', level: 1 })).toBeInTheDocument();
  expect(screen.getByText('Modo de operación')).toBeInTheDocument();
  expect(screen.getByText('Permisos y aprobaciones')).toBeInTheDocument();
});

test('crear agente en 6 pasos deja un borrador en Agentes personalizados', async () => {
  const router = renderAt('/espacio/agentes/crear');
  await screen.findByRole('heading', { name: 'Crear agente', level: 1 }, LAZY);
  await userEvent.click(screen.getByLabelText(/Recordatorios de cobro/));
  for (let step = 0; step < 5; step += 1) await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await userEvent.click(within(screen.getByRole('region', { name: 'Crear agente' })).getByRole('button', { name: 'Crear agente' }));
  expect(useAgentsStore.getState().drafts.map(draft => draft.name)).toEqual(['Recordatorios de cobro']);
  expect(router.state.location.pathname).toBe('/espacio/agentes/personalizados/recordatorios-de-cobro');
  expect(await screen.findByRole('heading', { name: 'Recordatorios de cobro', level: 1 })).toBeInTheDocument();
});

test('una integración se solicita sin dar por hecha la conexión', async () => {
  renderAt('/espacio/agentes/integraciones');
  const buttons = await screen.findAllByRole('button', { name: 'Solicitar activación' }, LAZY);
  await userEvent.click(buttons[0]!);
  expect(screen.getByText('Solicitud registrada: activaremos esta conexión en tu espacio.')).toBeInTheDocument();
});
