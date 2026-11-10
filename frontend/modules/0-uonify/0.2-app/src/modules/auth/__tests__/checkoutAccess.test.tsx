import { patchTransition } from '../state/authUi';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '@/app/appRoutes';
import { billingApi, WorkspaceAccessGate } from '@/modules/billing';
import { queryClient } from '@/shared/api/queryClient';
import { handlers } from '@/shared/mocks/handlers';
import { mock } from '@/shared/mocks/utils';
import { signInAs, storeProfile, recordConsents, signOutMock } from '../mocks/authDb';
import { CONSENT_DOCUMENTS } from '../model/legal';
import { parseSession } from '../model/session';
import { setSession } from '../state/session';
import type { Profile } from '../model/types';
import { resetAll } from './harness';

vi.mock('@/shared/mocks/utils', async original => ({ ...await original<typeof import('@/shared/mocks/utils')>(), latency: () => Promise.resolve() }));
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
let sequence = 0;
let email: string;
beforeEach(() => {
  resetAll(); queryClient.clear();
  email = `checkout-${++sequence}@example.test`;
  account(email);
});
const profile: Profile = { firstName: 'Ana', lastName: 'Prueba', name: 'Ana Prueba', email: '', ageRange: '25-34', role: 'seller', companySize: '1', company: '', primaryGoal: 'catalog', source: 'search', desiredPlan: 'basic', billingInterval: 'monthly' };
function account(address: string, plan: Profile['desiredPlan'] = 'basic') {
  storeProfile(address, { ...profile, email: address, desiredPlan: plan });
  recordConsents(address, ['terms', 'privacy', 'ai-third-party'].map(id => ({ id: id as 'terms', version: CONSENT_DOCUMENTS[id as 'terms'].version, acceptedAt: new Date().toISOString() })));
  // La guarda aislada recibe un perfil terminado; las rutas reales también lo validan.
  setSession({ ...parseSession(signInAs(address)), profileReady: true });
}
const payment = { planId: 'basic' as const, interval: 'monthly' as const, paymentMethod: 'new', newCard: { id: 'pm_access', brand: 'visa' as const, last4: '4242', expMonth: 12, expYear: 2035 }, acceptedTerms: true, acceptedWithdrawal: true, termsVersion: '2026-11-09' };
function mount() {
  // Las pantallas de la puerta llevan el pie global, con enlaces: necesitan un router.
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><WorkspaceAccessGate><h1>Contenido privado</h1></WorkspaceAccessGate></MemoryRouter></QueryClientProvider>);
}

test('clic fuera y Escape mantienen el checkout; la aplicación no se monta', async () => {
  mount();
  const dialog = await screen.findByRole('dialog', { name: 'Contratar el plan Básico' });
  fireEvent.pointerDown(dialog); fireEvent.click(dialog); fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(dialog).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Cerrar$/ })).toBeNull();
  expect(screen.queryByText('Contenido privado')).toBeNull();
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
});

test('recargar y volver a iniciar sesión conservan el pago pendiente', async () => {
  const view = mount();
  await screen.findByRole('dialog');
  view.unmount(); queryClient.clear();
  signOutMock(); account(email);
  mount();
  await screen.findByRole('dialog', { name: 'Contratar el plan Básico' });
  expect(screen.queryByText('Contenido privado')).toBeNull();
  expect(sessionStorage.getItem('uonify-mock:auth-profiles')).toContain(email);
});

test('un cobro rechazado deja el acceso bloqueado y permite reintentar', async () => {
  await expect(billingApi.checkout({ ...payment, newCard: undefined })).rejects.toMatchObject({ status: 400 });
  expect(await billingApi.workspaceAccess()).toMatchObject({ status: 'checkout_required' });
  mount(); await screen.findByRole('dialog');
  expect(screen.queryByText('Contenido privado')).toBeNull();
});

test('solo el pago confirmado permite acceder; una segunda cuenta sigue pendiente', async () => {
  await billingApi.checkout(payment);
  expect(await billingApi.workspaceAccess()).toEqual({ status: 'allowed' });
  mount(); await screen.findByText('Contenido privado');
  account('second-checkout@example.test');
  expect(await billingApi.workspaceAccess()).toMatchObject({ status: 'checkout_required' });
  expect((await billingApi.subscription()).planId).toBe('free');
});

test('el checkout completo cobra, muestra la confirmación y desbloquea al pulsar Listo', async () => {
  const user = userEvent.setup(); mount();
  await user.type(await screen.findByLabelText('Número de tarjeta'), '4242424242424242');
  await user.type(screen.getByLabelText('Caducidad'), '12/35');
  await user.type(screen.getByLabelText('CVC'), '123');
  await user.click(screen.getByRole('checkbox', { name: /He leído y acepto/ }));
  await user.click(screen.getByRole('checkbox', { name: /Quiero que el plan empiece/ }));
  await user.click(screen.getByRole('button', { name: /^Pagar/ }));
  await screen.findByText('Ya tienes el plan Básico');
  expect(screen.queryByText('Contenido privado')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Listo' }));
  await screen.findByText('Contenido privado');
});

test('si falla la comprobación del servidor no se muestra el espacio', async () => {
  server.use(http.get(mock('/billing/workspace-access'), () => new HttpResponse(null, { status: 503 })));
  mount(); await screen.findByText('No se ha podido comprobar tu acceso');
  expect(screen.queryByText('Contenido privado')).toBeNull();
  expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  server.resetHandlers(); fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('dialog');
});

test('Gratis permite entrar sin checkout', async () => {
  account(email, 'free'); mount();
  await screen.findByText('Contenido privado'); expect(screen.queryByRole('dialog')).toBeNull();
});

test('la ruta directa de configuración también queda detrás del pago', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/espacio/configuracion/plan'] });
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByRole('dialog', { name: 'Contratar el plan Básico' });
  await waitFor(() => expect(document.querySelector('#app-shell')).toBeNull());
});


test('la pasarela espera al último overlay y se abre cuando termina el fundido', async () => {
  patchTransition({ open: true });
  mount();
  await screen.findByText('Cargando pasarela de pago…');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Contenido privado')).toBeNull();
  act(() => patchTransition({ open: false }));
  await screen.findByRole('dialog', { name: 'Contratar el plan Básico' });
});
