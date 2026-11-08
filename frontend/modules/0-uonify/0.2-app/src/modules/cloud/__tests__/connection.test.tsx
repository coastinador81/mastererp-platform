import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { GoogleCloudConnection } from '../components/GoogleCloudConnection';

vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => 'owner@example.test' }));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GoogleCloudConnection account="owner@example.test" /></QueryClientProvider>);

it('guarda el proyecto comprobado, muestra límites y desconecta tras confirmación', async () => {
  let connected = true;
  let selected = false;
  const connection = () => connected ? { status: 'connected', email: 'cloud@example.test', projectId: selected ? 'customer-project' : null, projectName: 'Mi proyecto', checks: selected ? { billing: 'enabled', vertex: 'missing', permissions: 'unknown', credits: 'unverified', ready: false } : null } : { status: 'disconnected' };
  server.use(
    http.get(mock('/connections/google-cloud'), () => HttpResponse.json({ connection: connection(), available: true, accessAllowed: true })),
    http.get(mock('/connections/google-cloud/projects'), () => HttpResponse.json({ projects: [{ id: 'customer-project', name: 'Mi proyecto' }] })),
    http.put(mock('/connections/google-cloud/project'), async ({ request }) => { expect(await request.json()).toEqual({ projectId: 'customer-project' }); selected = true; return HttpResponse.json({ connection: connection() }); }),
    http.delete(mock('/connections/google-cloud'), () => { connected = false; return HttpResponse.json({ connection: connection() }); }),
  );
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Ver mis proyectos' }));
  await user.selectOptions(await screen.findByLabelText('Proyecto de Google Cloud'), 'customer-project');
  await user.click(screen.getByRole('button', { name: 'Guardar y comprobar proyecto' }));
  expect(await screen.findByText('Por configurar')).toBeInTheDocument();
  expect(screen.getByText('No se ha podido comprobar')).toBeInTheDocument();
  expect(screen.getByText(/no confirma su saldo/)).toBeInTheDocument();
  await user.click(screen.getByText('Gestionar la conexión'));
  await user.click(screen.getByRole('button', { name: 'Desconectar Google' }));
  expect(connected).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await screen.findByRole('button', { name: 'Conectar Google Cloud' })).toBeInTheDocument();
});

it('bloquea conectar si la prueba o suscripción ha vencido', async () => {
  server.use(http.get(mock('/connections/google-cloud'), () => HttpResponse.json({ connection: { status: 'disconnected' }, available: true, accessAllowed: false })));
  mount();
  expect(await screen.findByRole('button', { name: 'Conectar Google Cloud' })).toBeDisabled();
  expect(screen.getByText(/Necesitas una prueba o suscripción vigente/)).toBeInTheDocument();
});

it('presenta una conexión desactivada como sin conectar, sin avisos históricos', async () => {
  let queried = false;
  server.use(
    http.get(mock('/connections/google-cloud'), () => HttpResponse.json({ connection: { status: 'disconnected' }, available: true, accessAllowed: true })),
    http.get(mock('/connections/google-cloud/projects'), () => { queried = true; return HttpResponse.json({ projects: [] }); }),
  );
  mount();
  expect(await screen.findByRole('button', { name: 'Conectar Google Cloud' })).toBeEnabled();
  expect(screen.queryByText(/conexión anterior/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conectar Google Cloud' })).toBeEnabled();
  expect(screen.queryByText('Proyecto comprobado')).not.toBeInTheDocument();
  expect(queried).toBe(false);
});
