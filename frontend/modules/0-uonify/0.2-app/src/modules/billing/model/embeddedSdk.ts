import type { StripeEmbeddedCheckout, StripeEmbeddedCheckoutOptions } from '@stripe/stripe-js';

type Factory = (options: StripeEmbeddedCheckoutOptions) => Promise<StripeEmbeddedCheckout>;
interface Runtime {
  createEmbeddedCheckoutPage?: Factory;
  initEmbeddedCheckout?: Factory;
}

/** Stripe renombró el método; ambos usan la misma sesión y formulario oficial. */
export function createEmbeddedCheckout(stripe: Runtime, options: StripeEmbeddedCheckoutOptions): Promise<StripeEmbeddedCheckout> {
  if (typeof stripe.createEmbeddedCheckoutPage === 'function') return stripe.createEmbeddedCheckoutPage(options);
  // Compatibilidad con runtimes anteriores. Nunca usarlo tras un rechazo del nuevo.
  if (typeof stripe.initEmbeddedCheckout === 'function') return stripe.initEmbeddedCheckout(options);
  throw new Error('Stripe embedded checkout method is not available.');
}
