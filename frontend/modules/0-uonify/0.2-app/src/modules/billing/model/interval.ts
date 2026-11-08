import type { BillingInterval } from './plans';
import type { Subscription } from './types';

/** Compatibilidad con suscripciones guardadas antes de ofrecer pago mensual. */
export const subscriptionInterval = (subscription: Subscription): BillingInterval =>
  subscription.interval ?? (subscription.months === 1 ? 'monthly' : 'annual');
export const intervalLabel = (interval: BillingInterval): string => interval === 'monthly' ? 'Mensual' : 'Anual';
