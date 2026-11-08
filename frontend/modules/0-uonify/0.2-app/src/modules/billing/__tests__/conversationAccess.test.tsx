import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { WorkspaceAccessGate } from '../components/WorkspaceAccessGate';

vi.mock('@/shared/api/config', async original => ({ ...await original<typeof import('@/shared/api/config')>(), USE_MOCKS: false }));
vi.mock('@/modules/auth', () => ({
  useSession: () => ({ status: 'ready', user: { email: 'one@example.test' } }),
  useAccessTransition: () => false,
  AccountDeletionControl: () => null,
  signOut: vi.fn(),
  ConversationActivationAccess: ({ account, onFinished }: { account: string; onFinished?: () => Promise<void> }) => <main aria-label="Activación conversacional">Retomar {account}<button onClick={() => void onFinished?.()}>Continuar con Uony</button></main>,
}));
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it.each(['onboarding_required', 'subscription_required', 'checkout_required'])('recupera %s en el chat sin montar módulos privados ni un modal', async status => {
  let mounted = 0;
  function PrivateModule() { useEffect(() => { mounted += 1; }, []); return <p>Servicio privado</p>; }
  server.use(http.get('/api/billing/workspace-access', () => HttpResponse.json({ status, planId: 'basic', interval: 'monthly' })));
  render(<QueryClientProvider client={new QueryClient()}><WorkspaceAccessGate><PrivateModule /></WorkspaceAccessGate></QueryClientProvider>);
  expect(await screen.findByRole('main', { name: 'Activación conversacional' })).toHaveTextContent('one@example.test');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Servicio privado')).not.toBeInTheDocument();
  expect(mounted).toBe(0);
});


it('una actualización de acceso no cierra la confirmación hasta que el cliente continúa', async () => {
  let status = 'subscription_required';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server.use(http.get('/api/billing/workspace-access', () => HttpResponse.json({ status })));
  render(<QueryClientProvider client={client}><WorkspaceAccessGate><p>Servicio privado</p></WorkspaceAccessGate></QueryClientProvider>);
  expect(await screen.findByRole('main', { name: 'Activación conversacional' })).toBeVisible();
  status = 'allowed';
  await act(async () => { await client.invalidateQueries({ queryKey: ['workspace-access', 'one@example.test'] }); });
  expect(screen.getByRole('main', { name: 'Activación conversacional' })).toBeVisible();
  expect(screen.queryByText('Servicio privado')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByText('Servicio privado')).toBeVisible();
});
