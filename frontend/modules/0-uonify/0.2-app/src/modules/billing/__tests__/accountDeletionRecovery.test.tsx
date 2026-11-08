import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { AccountDeletionControl } from '@/modules/auth';
import { WorkspaceAccessGate } from '../components/WorkspaceAccessGate';

vi.mock('@/modules/auth', () => ({
  useSession: () => ({ status: 'onboarding', user: { email: 'owner@example.test' }, accountDeletionPending: true }),
  useAccessTransition: () => false, signOut: vi.fn(), openSignIn: vi.fn(),
  AccountDeletionControl: vi.fn(({ account }: { account: string }) => <button>Revisar eliminación de {account}</button>),
}));
afterEach(() => vi.restoreAllMocks());

test('el borrado pendiente ofrece recuperación sin montar servicios ni pedir acceso de pago', () => {
  vi.spyOn(api, 'get');
  render(<QueryClientProvider client={new QueryClient()}><WorkspaceAccessGate><p>Servicios privados</p></WorkspaceAccessGate></QueryClientProvider>);
  expect(screen.getByRole('button', { name: 'Revisar eliminación de owner@example.test' })).toBeVisible();
  expect(AccountDeletionControl).toHaveBeenCalledWith(expect.objectContaining({ account: 'owner@example.test' }), undefined);
  expect(screen.queryByText('Servicios privados')).not.toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
});
