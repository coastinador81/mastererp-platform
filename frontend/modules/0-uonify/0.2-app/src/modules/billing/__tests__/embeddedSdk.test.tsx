import { render, screen, waitFor } from '@testing-library/react';
import { EmbeddedCheckout } from '../components/EmbeddedCheckout';
import type { EmbeddedCheckoutSession } from '../model/onboarding';

const sdk = vi.hoisted(() => ({ load: vi.fn(), modern: vi.fn(), legacy: vi.fn(), mount: vi.fn(), destroy: vi.fn() }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: sdk.load }));
const session: EmbeddedCheckoutSession = {
  clientSecret: 'opaque-fixture-existing-session', publishableKey: 'pk_test_FixtureOnly000000000000',
  summary: { currency: 'EUR', interval: 'annual', baseCents: 11880, taxCents: 2495, totalCents: 14375, dueTodayCents: 14375, trialDays: 0, reminderDays: 3, taxScope: 'sandbox_fixed_21' },
};
beforeEach(() => {
  sdk.load.mockReset(); sdk.modern.mockReset(); sdk.legacy.mockReset(); sdk.mount.mockReset(); sdk.destroy.mockReset();
  sdk.modern.mockResolvedValue({ mount: sdk.mount, destroy: sdk.destroy });
  sdk.legacy.mockImplementation(() => { throw new Error('stripe.initEmbeddedCheckout() has been removed. Please use stripe.createEmbeddedCheckoutPage() instead.'); });
  sdk.load.mockResolvedValue({ createEmbeddedCheckoutPage: sdk.modern, initEmbeddedCheckout: sdk.legacy });
});

it('abre el mismo pago en Stripe actual sin invocar el método retirado que bloqueó al cliente', async () => {
  const complete = vi.fn();
  const view = render(<EmbeddedCheckout session={session} onComplete={complete} />);
  await waitFor(() => expect(sdk.mount).toHaveBeenCalledTimes(1));
  expect(sdk.modern).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: session.clientSecret }));
  expect(sdk.legacy).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  view.unmount(); expect(sdk.destroy).toHaveBeenCalledTimes(1);
});

it('no intenta el método antiguo si Stripe rechaza el nuevo, ni confirma o duplica un pago', async () => {
  sdk.modern.mockRejectedValue(new Error('Network connection unavailable'));
  const complete = vi.fn();
  render(<EmbeddedCheckout session={session} onComplete={complete} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido conectar');
  expect(sdk.modern).toHaveBeenCalledTimes(1);
  expect(sdk.legacy).not.toHaveBeenCalled(); expect(sdk.mount).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
