import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { billingApi } from '../api/billingApi';
import { handlers } from '@/shared/mocks/handlers';
import { PLANS } from '../mocks/fixtures/plans';
import { NEW_CARD, seedSubscription } from '../mocks/fixtures/seed';
import { invoicesDb, movementsDb, subscriptionDb } from '../mocks/store';
import { quoteCheckout } from '../model/quote';
import { subscriptionInterval } from '../model/interval';
import { PlanOverview } from '../components/settings/PlanOverview';
import { CheckoutDialog } from '../components/checkout/CheckoutDialog';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  subscriptionDb.set(seedSubscription());
  invoicesDb.reset(); movementsDb.reset();
});
const basic = PLANS.find(plan => plan.id === 'basic')!;
function mount(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}
const request = { planId: 'basic' as const, paymentMethod: 'new', newCard: NEW_CARD, acceptedTerms: true, acceptedWithdrawal: true, termsVersion: '2026-11-09' };

test('mensual cobra una cuota y renueva al mes; anual mantiene 12 cuotas y 13 meses', () => {
  const now = new Date('2026-01-31T12:00:00Z');
  const monthly = quoteCheckout({ plan: basic, interval: 'monthly', vatRate: 0.21, now });
  expect(monthly).toMatchObject({ months: 1, paidMonths: 1, base: 49, renewalBase: 49, amounts: { total: 59.29 }, endsAt: '2026-02-28T12:00:00.000Z' });
  const annual = quoteCheckout({ plan: basic, interval: 'annual', vatRate: 0.21, now });
  expect(annual).toMatchObject({ months: 13, paidMonths: 12, base: 588, amounts: { total: 711.48 }, endsAt: '2027-02-28T12:00:00.000Z' });
  expect(subscriptionInterval({ ...seedSubscription(), planId: 'basic', months: 13 })).toBe('annual');
});

test.each(['monthly', 'annual'] as const)('el contrato conserva %s en vista previa, cobro, factura y suscripción', async interval => {
  const preview = await billingApi.checkoutPreview('basic', interval);
  const result = await billingApi.checkout({ ...request, interval });
  expect(preview.interval).toBe(interval);
  expect(result.subscription.interval).toBe(interval);
  expect(result.subscription.months).toBe(interval === 'monthly' ? 1 : 13);
  expect(result.invoice.total).toBe(preview.amounts.total);
  expect(result.invoice.concept).toContain(interval === 'monthly' ? 'mensual' : 'anual');
  expect((await billingApi.subscription()).interval).toBe(interval);
});

test('cambiar modalidad se programa sin nuevo cobro y se puede cancelar', async () => {
  const paid = await billingApi.checkout({ ...request, interval: 'monthly' });
  const invoices = invoicesDb.all().length;
  const scheduled = await billingApi.scheduleChange('basic', 'annual');
  expect(scheduled).toMatchObject({ interval: 'monthly', scheduledPlanId: 'basic', scheduledInterval: 'annual', renewsAt: paid.subscription.renewsAt });
  expect(invoicesDb.all()).toHaveLength(invoices);
  expect(await billingApi.scheduleChange(null)).toMatchObject({ scheduledPlanId: null, scheduledInterval: null });
});

test('rechaza modalidades inválidas y un cambio inmediato que perdería el periodo pagado', async () => {
  const response = await fetch('/api/billing/checkout/preview?planId=basic&interval=weekly');
  expect(response.status).toBe(400);
  await billingApi.checkout({ ...request, interval: 'annual' });
  const invoices = invoicesDb.all().length;
  await expect(billingApi.checkout({ ...request, planId: 'pro', interval: 'monthly' })).rejects.toMatchObject({ status: 409 });
  expect(invoicesDb.all()).toHaveLength(invoices);
});

test('el selector muestra mensual por defecto y actualiza las tarjetas al elegir anual', async () => {
  mount(<PlanOverview subscription={seedSubscription()} plans={PLANS} primary />);
  await userEvent.click(screen.getByRole('button', { name: 'Ver planes' }));
  expect(screen.getByRole('radio', { name: 'Mensual' })).toBeChecked();
  expect(screen.getAllByText(/Facturación mensual/)).toHaveLength(3);
  await userEvent.click(screen.getByRole('radio', { name: 'Anual' }));
  expect(screen.getAllByText('13 meses por el precio de 12')).toHaveLength(3);
});

test.each(['monthly', 'annual'] as const)('el resumen de pago %s muestra el importe y periodo correctos', async interval => {
  mount(<CheckoutDialog id={123} planId="basic" interval={interval} />);
  const summary = await screen.findByRole('region', { name: 'Resumen del pago' });
  expect(within(summary).getByText(interval === 'monthly' ? /59,29/ : /711,48/)).toBeVisible();
  expect(within(summary).getByText(interval === 'monthly' ? /IVA cada mes/ : /IVA cada 13 meses/)).toBeVisible();
});
