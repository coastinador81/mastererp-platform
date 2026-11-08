import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { StripeEmbeddedCheckoutOptions } from '@stripe/stripe-js';
import type { MockInstance } from 'vitest';
import { api } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { ConversationActivationGate } from '../components/ConversationActivation';
import { parseSession } from '../model/session';
import { setSession } from '../state/session';
import { resetAuthUi } from '../state/authUi';
import { navigation } from '../flows/navigation';
import type { ActivationState } from '../model/activation';

vi.mock('@/shared/api/config', () => ({ USE_MOCKS: false, API_BASE: '/api' }));
const sdk = vi.hoisted(() => ({ options: null as StripeEmbeddedCheckoutOptions | null, load: vi.fn(), mount: vi.fn(), destroy: vi.fn() }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: sdk.load }));
const account = 'closure@example.test';
const intent = 'Quiero conectar un canal de venta con Uonify';
const endsAt = '2099-10-15T00:00:00Z';
let state: ActivationState;
let confirmed: boolean;
let complete: boolean;
let allowed: boolean;
let post: MockInstance<typeof api.post>;
const navigate = vi.fn();
const session = () => ({ authenticated: true, email: account, account: { provider: 'google' as const }, identity: { name: 'Ana García' },
  onboardingStage: 'profile' as const, onboarding: { step: 'pending' as const }, profileComplete: complete, ageConfirmedAdult: true });

beforeEach(() => {
  queryClient.clear(); sessionStorage.clear(); resetAuthUi(); navigate.mockReset();
  confirmed = false; complete = false; allowed = true;
  state = { step: 'subscription', firstIntent: intent, setupReady: true, aiReady: true,
    drive: { connected: true, deferred: false }, cloud: { connected: true, ready: true, projectId: 'uonify-closure', projectName: 'Uonify', operation: null } };
  setSession(parseSession(session())); navigation.bind(navigate, '/espacio');
  sdk.options = null; sdk.mount.mockReset(); sdk.destroy.mockReset(); sdk.load.mockReset();
  sdk.load.mockResolvedValue({ createEmbeddedCheckoutPage: async (options: StripeEmbeddedCheckoutOptions) => {
    sdk.options = options; return { mount: sdk.mount, destroy: sdk.destroy };
  } });
  vi.spyOn(api, 'get').mockImplementation(async path => {
    if (path === '/onboarding/setup') return structuredClone(state) as never;
    if (path === '/billing/onboarding-offer') return { offer: { version: 'v1', annualCents: 11880, monthlyCents: 990, currency: 'EUR', trialDays: 14, reminderDays: 3 },
      trialUsed: true, embeddedReady: true, taxRatePercent: 21, selection: null, subscription: null } as never;
    throw new Error(`Consulta inesperada: ${path}`);
  });
  vi.spyOn(api, 'put').mockResolvedValue({ embeddedReady: true } as never);
  post = vi.spyOn(api, 'post').mockImplementation(async path => {
    if (path === '/billing/checkout-embedded') return { clientSecret: 'closure_fixture_secret', publishableKey: 'pk_test_FixtureOnly000000000000',
      summary: { interval: 'annual', baseCents: 11880, taxCents: 2495, totalCents: 14375, dueTodayCents: 14375, trialDays: 0 } } as never;
    if (path === '/billing/checkout-status') {
      if (allowed) { confirmed = true; state = { ...state, step: 'complete', activation: { basis: 'paid', endsAt } }; }
      return { access: { status: allowed ? 'allowed' : 'subscription_required' } } as never;
    }
    if (path === '/onboarding/complete') { complete = true; return session() as never; }
    throw new Error(`Operación inesperada: ${path}`);
  });
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });
const mount = () => render(<QueryClientProvider client={queryClient}><MemoryRouter><ConversationActivationGate><p>Primera conversación</p></ConversationActivationGate></MemoryRouter></QueryClientProvider>);
async function pay() {
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar suscripción' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo las renovaciones/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con el pago' }));
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  await act(async () => { sdk.options?.onComplete?.(); });
}

it('conserva el recibo hasta continuar y después mantiene el cierre antes de abrir la conversación', async () => {
  mount(); await pay();
  expect(await screen.findByText(/Tu pago está confirmado/)).toBeVisible();
  expect(confirmed).toBe(true); expect(sdk.destroy).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Tu suscripción está activa' })).not.toBeInTheDocument();
  // El foco o un refresco del estado no pueden retirar el recibo de Stripe.
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['onboarding-setup', account] }); });
  expect(screen.getByRole('region', { name: 'Pago seguro con Stripe' })).toBeVisible();
  expect(sdk.destroy).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  expect(complete).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  const title = await screen.findByRole('heading', { name: 'Tu suscripción está activa' });
  expect(confirmed).toBe(true); expect(title).toHaveFocus();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByText(intent)).toBeVisible();
  expect(screen.getByText('Google Drive conectado')).toBeVisible();
  expect(screen.getByText(/El proyecto Uonify está comprobado/)).toBeVisible();
  expect(complete).toBe(false); expect(navigate).not.toHaveBeenCalled();
  expect(post.mock.calls.some(([path]) => path === '/uony/messages')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByText('Primera conversación')).toBeVisible();
  expect(post.mock.calls.filter(([path]) => path === '/onboarding/complete')).toHaveLength(1);
  expect(navigate).toHaveBeenCalledWith('/espacio', { replace: true });
});

it.each(['trial', 'paid'] as const)('recarga el cierre %s sin repetir pago ni enviar la petición antes de continuar', async basis => {
  state = { ...state, step: 'complete', activation: { basis, endsAt }, drive: { connected: false, deferred: true } };
  const first = mount();
  expect(await screen.findByRole('heading', { name: basis === 'trial' ? 'Tu prueba está activa' : 'Tu suscripción está activa' })).toBeVisible();
  first.unmount(); mount();
  expect(await screen.findByText(intent)).toBeVisible();
  expect(screen.getByText('Google Drive para más adelante')).toBeVisible();
  expect(post).not.toHaveBeenCalled(); expect(sdk.load).not.toHaveBeenCalled();
});

it('conserva el cierre y la petición si falla terminar el alta; doble clic no duplica la operación', async () => {
  state = { ...state, step: 'complete', activation: { basis: 'paid', endsAt } };
  let reject!: (error: Error) => void;
  post.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  mount();
  await userEvent.dblClick(await screen.findByRole('button', { name: 'Continuar con Uony' }));
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('No se ha podido finalizar. Vuelve a intentarlo.')); });
  expect(await screen.findByText('No se ha podido finalizar. Vuelve a intentarlo.')).toBeVisible();
  expect(screen.getByText(intent)).toBeVisible(); expect(navigate).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByText('Primera conversación')).toBeVisible();
  expect(sdk.load).not.toHaveBeenCalled();
});

it('sin petición previa explica cómo empezar y no genera ni simula una llamada a Uony', async () => {
  state = { ...state, step: 'complete', firstIntent: '', activation: { basis: 'trial', endsAt } };
  mount();
  expect(await screen.findByText(/Uony te ayudará a elegir tu primera tarea/)).toBeVisible();
  expect(screen.queryByText('Continuamos con tu petición')).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('si caduca el acceso mientras se lee el cierre, recupera el paso pendiente y conserva la petición', async () => {
  state = { ...state, step: 'complete', activation: { basis: 'paid', endsAt } };
  post.mockImplementationOnce(async () => {
    state = { ...state, step: 'subscription', activation: null };
    throw new Error('Tu acceso ha terminado. Revisa tu suscripción para continuar.');
  });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByRole('button', { name: 'Revisar suscripción' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Tu suscripción está activa' })).not.toBeInTheDocument();
  expect(state.firstIntent).toBe(intent); expect(complete).toBe(false);
  expect(navigate).not.toHaveBeenCalled(); expect(sdk.load).not.toHaveBeenCalled();
});

it('un callback de Stripe sin acceso confirmado no muestra éxito ni termina el alta', async () => {
  allowed = false; mount(); await pay();
  expect(await screen.findByText(/Todavía no tenemos la confirmación del pago/)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Tu suscripción está activa' })).not.toBeInTheDocument();
  expect(complete).toBe(false); expect(navigate).not.toHaveBeenCalled();
});
