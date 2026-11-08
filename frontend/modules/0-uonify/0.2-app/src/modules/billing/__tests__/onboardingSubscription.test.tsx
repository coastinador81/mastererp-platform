import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { OnboardingSubscription } from '../components/OnboardingSubscription';

const offer = { version: 'launch-2026-10-09', currency: 'EUR', monthlyCents: 990, annualCents: 11880, trialDays: 14, reminderDays: 3, taxIncluded: false, cardRequired: true };
const server = setupServer();
let interval: 'monthly' | 'annual' | null;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  interval = null;
  server.use(http.get(mock('/billing/onboarding-offer'), () => HttpResponse.json({ offer, selection: interval ? { interval, offerVersion: offer.version } : null, checkoutReady: false })));
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><OnboardingSubscription account="test@example.test" /></QueryClientProvider>);
}

test('anual por defecto, mensual persistido; ningún guardado inicia prueba ni pago', async () => {
  const user = userEvent.setup();
  server.use(http.put(mock('/billing/onboarding-selection'), async ({ request }) => {
    const body = await request.json();
    expect(body).toEqual({ interval: 'monthly', offerVersion: offer.version });
    interval = 'monthly';
    return HttpResponse.json({ offer, selection: { interval, offerVersion: offer.version }, checkoutReady: false });
  }));
  const view = mount();
  expect(await screen.findByRole('radio', { name: /Anual/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Anual.*118,80/ })).toBeVisible();
  await user.click(screen.getByRole('radio', { name: /Mensual/ }));
  await user.click(screen.getByRole('button', { name: 'Guardar modalidad' }));
  expect(await screen.findByRole('button', { name: 'Modalidad guardada' })).toBeDisabled();
  view.unmount(); mount();
  expect(await screen.findByRole('radio', { name: /Mensual/ })).toBeChecked();
  expect(screen.getByText(/El pago integrado aún no está disponible/)).toBeVisible();
});

test('fallo del servidor conserva la elección y permite reintentar', async () => {
  const user = userEvent.setup();
  server.use(http.put(mock('/billing/onboarding-selection'), () => HttpResponse.json({ message: 'No se ha guardado.' }, { status: 503 })));
  mount();
  await user.click(await screen.findByRole('radio', { name: /Mensual/ }));
  await user.click(screen.getByRole('button', { name: 'Guardar modalidad' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No se ha guardado.'));
  expect(screen.getByRole('radio', { name: /Mensual/ })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Guardar modalidad' })).toBeEnabled();
});

it('recupera la confirmación del servidor al volver de Stripe y permite cancelar', async () => {
  window.history.replaceState({}, '', '/?billing=return');
  let cancelled = false;
  const subscription = () => ({ status: 'trialing', cancelAtPeriodEnd: cancelled, interval: 'monthly', trialEndsAt: '2026-10-23T12:00:00Z', periodEndsAt: '2026-10-23T12:00:00Z' });
  server.use(
    http.post(mock('/billing/subscription/refresh'), () => HttpResponse.json({ subscription: subscription() })),
    http.get(mock('/billing/onboarding-offer'), () => HttpResponse.json({ offer, selection: { interval: 'monthly', offerVersion: offer.version }, checkoutReady: true, subscription: subscription() })),
    http.post(mock('/billing/subscription/cancel'), () => { cancelled = true; return HttpResponse.json({ subscription: subscription() }); }),
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={cache}><OnboardingSubscription account="owner@example.test" /></QueryClientProvider>);
  const user = userEvent.setup();
  expect(await screen.findByText('Tu prueba está activa')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancelar renovación' }));
  expect(cancelled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
  expect(await screen.findByText('Renovación cancelada')).toBeInTheDocument();
  view.unmount(); window.history.replaceState({}, '', '/');
});

it('un error del checkout mantiene el formulario sin conceder acceso', async () => {
  server.use(
    http.get(mock('/billing/onboarding-offer'), () => HttpResponse.json({ offer, selection: null, checkoutReady: true, embeddedReady: true })),
    http.put(mock('/billing/onboarding-selection'), () => HttpResponse.json({ offer, selection: { interval: 'annual', offerVersion: offer.version }, checkoutReady: true, embeddedReady: true })),
    http.post(mock('/billing/checkout-embedded'), () => HttpResponse.json({ message: 'Stripe no está disponible.' }, { status: 503 })),
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><OnboardingSubscription account="owner@example.test" /></QueryClientProvider>);
  await userEvent.click(await screen.findByRole('checkbox', { name: /Autorizo las renovaciones/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuar con la prueba' }));
  expect(await screen.findByText('Stripe no está disponible.')).toBeInTheDocument();
  expect(screen.queryByText('Tu prueba está activa')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuar con la prueba' })).toBeEnabled();
});
