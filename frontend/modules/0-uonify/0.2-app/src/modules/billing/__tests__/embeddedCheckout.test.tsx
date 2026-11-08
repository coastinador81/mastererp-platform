import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { OnboardingSubscription } from '../components/OnboardingSubscription';
import type { StripeEmbeddedCheckoutOptions } from '@stripe/stripe-js';

const sdk = vi.hoisted(() => ({ options: null as StripeEmbeddedCheckoutOptions | null, mount: vi.fn(), destroy: vi.fn(), load: vi.fn() }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: sdk.load }));
const offer = { version: 'launch-2026-10-09', currency: 'EUR', monthlyCents: 990, annualCents: 11880, trialDays: 14, reminderDays: 3, taxIncluded: false, cardRequired: true };
const summary = { currency: 'EUR', interval: 'monthly', baseCents: 990, taxCents: 208, totalCents: 1198, dueTodayCents: 0, trialDays: 14, reminderDays: 3, taxScope: 'sandbox_fixed_21' };
// Valor de fixture opaco y largo; la interfaz no impone el formato interno de Stripe.
const session = { clientSecret: 'opaque_fixture_' + 'A_b-0='.repeat(70), publishableKey: 'pk_test_FixtureOnly000000000000', summary };
const server = setupServer();
let creates: number;
let trialUsed: boolean;
let open: boolean;
let interval: 'monthly' | 'annual';
let allowed: boolean;
const current = () => ({ offer, selection: { interval, offerVersion: offer.version }, checkoutReady: true, embeddedReady: true, taxRatePercent: 21, trialUsed, checkoutInterval: open ? interval : null });
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  creates = 0; trialUsed = false; open = false; allowed = false; interval = 'monthly'; sdk.options = null;
  sdk.mount.mockReset(); sdk.destroy.mockReset(); sdk.load.mockReset();
  sdk.load.mockResolvedValue({ initEmbeddedCheckout: async (options: StripeEmbeddedCheckoutOptions) => { sdk.options = options; return { mount: sdk.mount, destroy: sdk.destroy }; } });
  server.use(
    http.get(mock('/billing/onboarding-offer'), () => HttpResponse.json(current())),
    http.put(mock('/billing/onboarding-selection'), async ({ request }) => { interval = (await request.json() as { interval: 'monthly' | 'annual' }).interval; return HttpResponse.json(current()); }),
    http.post(mock('/billing/checkout-embedded'), async ({ request }) => { expect(await request.json()).toEqual({ acceptRenewal: true, interval: 'monthly', offerVersion: offer.version }); creates += 1; open = true; return HttpResponse.json(session); }),
    http.post(mock('/billing/checkout-status'), () => HttpResponse.json({ subscription: null, access: { status: allowed ? 'allowed' : 'subscription_required' } })),
    http.post(mock('/billing/checkout/abandon'), () => { open = false; return HttpResponse.json({ ok: true }); }),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function mount(onContinue = vi.fn(async () => {}), account = 'one@example.test', compact = false, onProgress = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...render(<OnboardingSubscription account={account} onContinue={onContinue} compact={compact} onProgress={onProgress} />, { wrapper }), onContinue };
}
async function openPayment() {
  await userEvent.click(await screen.findByRole('checkbox', { name: /Autorizo las renovaciones/ }));
  await userEvent.click(screen.getByRole('button', { name: /Continuar con (la prueba|el pago)/ }));
  await waitFor(() => expect(sdk.mount).toHaveBeenCalled());
}

it('muestra importes y consentimiento; monta Stripe en el mismo contexto sin redirigir', async () => {
  const original = window.location.href;
  mount();
  expect(await screen.findByRole('button', { name: 'Continuar con la prueba' })).toBeDisabled();
  expect(screen.getAllByText(/11,98/).length).toBeGreaterThan(0);
  expect(screen.getByText('0,00 €')).toBeVisible();
  expect(creates).toBe(0);
  await openPayment();
  expect(creates).toBe(1);
  expect(screen.getByRole('region', { name: 'Pago seguro con Stripe' })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(window.location.href).toBe(original);
  expect(localStorage.getItem('clientSecret')).toBeNull();
});

it('no anuncia otra prueba ni cero euros si el servidor ya la considera utilizada', async () => {
  trialUsed = true; mount();
  expect(await screen.findByText('Ya has utilizado la prueba gratuita.')).toBeVisible();
  expect(screen.queryByText('0,00 €')).not.toBeInTheDocument();
  expect(screen.queryByText(/14 días gratis/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuar con el pago' })).toBeDisabled();
});

it('el callback de Stripe no concede acceso ni avanza si el servidor sigue pendiente', async () => {
  const view = mount(); await openPayment();
  await act(async () => { sdk.options?.onComplete?.(); });
  expect(await screen.findByText(/Todavía no tenemos la confirmación del pago/)).toBeVisible();
  expect(view.onContinue).not.toHaveBeenCalled();
  expect(creates).toBe(1);
  expect(sdk.destroy).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Pago seguro con Stripe' })).toBeVisible();
});

it('conserva la confirmación de Stripe hasta continuar, incluso al actualizarse la suscripción', async () => {
  const view = mount(); await openPayment(); allowed = true;
  server.use(http.get(mock('/billing/onboarding-offer'), () => HttpResponse.json({ ...current(),
    subscription: { status: 'active', cancelAtPeriodEnd: false, interval: 'monthly', trialEndsAt: null, periodEndsAt: '2099-12-01T00:00:00Z' } })));
  await act(async () => { sdk.options?.onComplete?.(); sdk.options?.onComplete?.(); });
  expect(await screen.findByText(/Tu pago está confirmado/)).toBeVisible();
  expect(view.onContinue).not.toHaveBeenCalled(); expect(sdk.destroy).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Pago seguro con Stripe' })).toBeVisible();
  vi.useFakeTimers();
  await act(async () => { vi.advanceTimersByTime(300_000); });
  vi.useRealTimers();
  expect(sdk.destroy).not.toHaveBeenCalled(); expect(view.onContinue).not.toHaveBeenCalled();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Continuar con Uony' }));
  await waitFor(() => expect(view.onContinue).toHaveBeenCalledTimes(1));
  expect(sdk.destroy).toHaveBeenCalledTimes(1); expect(creates).toBe(1);
});

it('sitúa continuar después del recibo confirmado sin remontar Stripe ni duplicar el pago', async () => {
  sdk.mount.mockImplementation((host: HTMLElement) => {
    const receipt = document.createElement('p');
    receipt.textContent = 'Gracias por tu pago';
    host.append(receipt);
  });
  const view = mount(); await openPayment();
  const receipt = screen.getByText('Gracias por tu pago');
  const host = receipt.parentElement;
  const check = screen.getByRole('button', { name: 'Comprobar mi pago' });
  expect(check.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  allowed = true;
  await act(async () => { sdk.options?.onComplete?.(); });
  const next = await screen.findByRole('button', { name: 'Continuar con Uony' });
  expect(receipt.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(next).toHaveClass('uon-onboard-back');
  expect(view.container.querySelectorAll('.bil-onboard-actions')).toHaveLength(1);
  expect(screen.getByText('Gracias por tu pago').parentElement).toBe(host);
  expect(sdk.mount).toHaveBeenCalledTimes(1); expect(sdk.destroy).not.toHaveBeenCalled();
  expect(view.onContinue).not.toHaveBeenCalled(); expect(creates).toBe(1);
  await userEvent.click(next);
  await waitFor(() => expect(view.onContinue).toHaveBeenCalledTimes(1));
  expect(creates).toBe(1); expect(sdk.destroy).toHaveBeenCalledTimes(1);
});

it('revalida al continuar y conserva el recibo si el acceso deja de estar confirmado', async () => {
  const view = mount(); await openPayment(); allowed = true;
  await act(async () => { sdk.options?.onComplete?.(); });
  expect(await screen.findByText(/Tu pago está confirmado/)).toBeVisible();
  allowed = false;
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  expect(await screen.findByText(/Todavía no tenemos la confirmación del pago/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Comprobar mi pago' })).toBeEnabled();
  expect(view.onContinue).not.toHaveBeenCalled(); expect(sdk.destroy).not.toHaveBeenCalled();
  expect(creates).toBe(1);
});

it('cerrar y volver conserva la intención; recargar no crea pagos sin un clic', async () => {
  const view = mount(); await openPayment();
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar el formulario y continuar más tarde' }));
  expect(sdk.destroy).toHaveBeenCalled();
  view.unmount(); mount();
  expect(await screen.findByRole('button', { name: 'Retomar pago seguro' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Mensual/ })).toBeChecked();
  expect(creates).toBe(1);
});

it('un error del SDK mantiene el contexto y permite cerrar sin activar nada', async () => {
  sdk.load.mockRejectedValueOnce(new Error('fixture'));
  mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: /Autorizo las renovaciones/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con la prueba' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido conectar con el formulario de Stripe.');
  expect(screen.getByRole('button', { name: 'Cerrar el formulario y continuar más tarde' })).toBeEnabled();
  expect(screen.queryByText('Tu prueba está activa')).not.toBeInTheDocument();
});

it('recupera el formulario y comprueba el mismo pago sin crear otro ni conceder acceso pendiente', async () => {
  sdk.load.mockRejectedValueOnce(new Error('fixture'));
  const view = mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: /Autorizo las renovaciones/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con la prueba' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Reintentar formulario' }));
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  expect(creates).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar mi pago' }));
  expect(await screen.findByText(/Todavía no tenemos la confirmación del pago/)).toBeVisible();
  expect(sdk.destroy).not.toHaveBeenCalled();
  expect(view.onContinue).not.toHaveBeenCalled();
  expect(creates).toBe(1);
  allowed = true;
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar mi pago' }));
  expect(await screen.findByText(/Tu pago está confirmado/)).toBeVisible();
  expect(view.onContinue).not.toHaveBeenCalled(); expect(sdk.destroy).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con Uony' }));
  await waitFor(() => expect(view.onContinue).toHaveBeenCalledTimes(1));
  expect(sdk.destroy).toHaveBeenCalledTimes(1);
  expect(creates).toBe(1);
});

it('un formulario caducado vuelve a revisión y exige una nueva autorización antes de abrir otro', async () => {
  mount(undefined, 'expired@example.test', true);
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar suscripción' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  await openPayment();
  server.use(http.post(mock('/billing/checkout-status'), () => {
    open = false;
    return HttpResponse.json({ subscription: null, access: { status: 'subscription_required' }, checkoutStatus: 'expired' });
  }));
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar mi pago' }));
  expect(await screen.findByText('El formulario anterior ha caducado. Revisa las condiciones para abrir otro.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Revisa tu suscripción' })).toBeVisible();
  expect(sdk.destroy).toHaveBeenCalledTimes(1);
  expect(creates).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  expect(screen.getByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Continuar con la prueba' })).toBeDisabled();
  expect(creates).toBe(1);
});

it('conserva la retirada de una sesión caducada aunque falle la lectura posterior del plan', async () => {
  mount(undefined, 'expired-read-error@example.test', true);
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar suscripción' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  await openPayment();
  let failRead = true;
  server.use(
    http.post(mock('/billing/checkout-status'), () => { open = false; return HttpResponse.json({ subscription: null, access: { status: 'subscription_required' }, checkoutStatus: 'expired' }); }),
    http.get(mock('/billing/onboarding-offer'), () => failRead ? HttpResponse.json({ message: 'No disponible' }, { status: 503 }) : HttpResponse.json(current())),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar mi pago' }));
  expect(await screen.findByText('No hemos podido cargar tu plan.')).toBeVisible();
  expect(sdk.destroy).toHaveBeenCalledTimes(1);
  failRead = false;
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Continuar a la autorización' }));
  expect(screen.getByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Continuar con la prueba' })).toBeDisabled();
  expect(creates).toBe(1);
});

it('cambiar de cuenta destruye Stripe y no arrastra el consentimiento', async () => {
  const view = mount(); await openPayment(); open = false;
  view.rerender(<OnboardingSubscription account="two@example.test" onContinue={view.onContinue} />);
  expect(await screen.findByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeChecked();
  expect(sdk.destroy).toHaveBeenCalled();
  await act(async () => { sdk.options?.onComplete?.(); });
  expect(view.onContinue).not.toHaveBeenCalled();
});

it('el recorrido compacto exige revisar el importe y aceptar renovaciones antes de abrir Stripe', async () => {
  const progress = vi.fn();
  mount(undefined, 'compact@example.test', true, progress);
  expect(await screen.findByText(/Tu suscripción incluye las herramientas y agentes de Uonify/)).toBeVisible();
  expect(screen.getByText(/El consumo de Google se paga aparte, desde tu cuenta/)).toBeVisible();
  expect(progress).toHaveBeenLastCalledWith({ id: 'subscription-choice', label: 'Elegir modalidad', index: 1, total: 5 });
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar suscripción' }));
  expect(progress).toHaveBeenLastCalledWith({ id: 'subscription-review', label: 'Revisar suscripción', index: 2, total: 5 });
  expect(screen.getByText('0,00 €')).toBeVisible();
  expect(screen.getAllByText(/11,98/).length).toBeGreaterThan(0);
  expect(screen.getByText('IVA (21 %)')).toBeVisible();
  expect(screen.getByText(/Si cancelas durante la prueba, no pagarás/)).toBeVisible();
  expect(screen.queryByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeInTheDocument();
  expect(creates).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  expect(progress).toHaveBeenLastCalledWith({ id: 'subscription-consent', label: 'Autorizar suscripción', index: 3, total: 5 });
  expect(screen.getByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Continuar con la prueba' })).toBeDisabled();
  expect(creates).toBe(0);
  await openPayment();
  expect(progress).toHaveBeenLastCalledWith({ id: 'subscription-payment', label: 'Pago seguro', index: 4, total: 5 });
  expect(screen.getByRole('region', { name: 'Pago seguro con Stripe' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Tu suscripción Uonify' })).toHaveAttribute('data-activation-payment', 'true');
  expect(screen.queryByRole('group', { name: 'Elige tu modalidad' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeInTheDocument();
  expect(creates).toBe(1);
});

it('volver a elegir modalidad en el recorrido compacto no conserva una aceptación anterior', async () => {
  mount(undefined, 'compact@example.test', true);
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar suscripción' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo las renovaciones/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Volver a las condiciones' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cambiar modalidad' }));
  await userEvent.click(screen.getByRole('button', { name: 'Revisar suscripción' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  expect(screen.getByRole('checkbox', { name: /Autorizo las renovaciones/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Continuar con la prueba' })).toBeDisabled();
  expect(creates).toBe(0);
});

it('conserva la modalidad elegida entre apartados sin guardar ni crear un pago antes de autorizar', async () => {
  let selections = 0;
  server.use(http.put(mock('/billing/onboarding-selection'), () => { selections += 1; return HttpResponse.json(current()); }));
  mount(undefined, 'compact@example.test', true);
  await userEvent.click(await screen.findByRole('radio', { name: /Anual/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Revisar suscripción' }));
  expect(screen.getByText('118,80 € / año')).toBeVisible();
  expect(screen.getByText('143,75 € / año')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  expect(screen.getByText(/143,75 € con IVA \/ año/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continuar con la prueba' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Volver a las condiciones' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cambiar modalidad' }));
  expect(screen.getByRole('radio', { name: /Anual/ })).toBeChecked();
  expect(selections).toBe(0); expect(creates).toBe(0); expect(sdk.mount).not.toHaveBeenCalled();
});

it('en compacto sin prueba muestra el cobro de hoy y requiere autorización antes del pago', async () => {
  trialUsed = true; mount(undefined, 'compact@example.test', true);
  await userEvent.click(await screen.findByRole('button', { name: 'Revisar suscripción' }));
  expect(screen.getByText('Ya has utilizado la prueba gratuita.')).toBeVisible();
  expect(screen.getAllByText('11,98 € / mes').length).toBeGreaterThan(0);
  expect(screen.queryByText('0,00 €')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continuar a la autorización' }));
  expect(screen.getByText(/Hoy 11,98 €/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continuar con el pago' })).toBeDisabled();
  expect(creates).toBe(0);
});
