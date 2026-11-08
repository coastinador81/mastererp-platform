import { addDays } from '../../model/money';
import { withVat } from '../../model/quote';
import type { BillingDocument, Movement, PaymentMethod, Subscription } from '../../model/types';

/**
 * Cuenta simulada al empezar: plan Gratis (lanzamiento gratis) y una recarga de 80 € de la que ya se han gastado 2.000 tokens en un
 * vídeo y en botones de la ficha. Quedan 6.000 tokens · 60,00 €, el mismo saldo
 * inicial que usaba la pestaña Vídeo.
 */
/** Solo fixture: no se asigna a cuentas nuevas. */
export const SEED_CARD: PaymentMethod = { id: 'pm_seed_visa', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 };

/** Tarjeta que «devuelve» el formulario simulado de Stripe al añadir otra. */
export const NEW_CARD: PaymentMethod = { id: 'pm_new_mastercard', brand: 'mastercard', last4: '4444', expMonth: 12, expYear: 2030 };

export const SEED_RECHARGE_INVOICE = 'inv_seed_recharge';

export function seedSubscription(): Subscription {
  return {
    planId: 'free',
    startedAt: null,
    renewsAt: null,
    months: null,
    amountPaid: null,
    invoiceId: null,
    withdrawalUntil: null,
    scheduledPlanId: null,
    support: { active: false, amount: 0, since: null },
  };
}

const iso = (daysAgo: number) => addDays(new Date(), -daysAgo).toISOString();

export function seedMovements(): Movement[] {
  return [
    { id: 'mv_seed_1', at: iso(20), kind: 'recharge', tokens: 8000, account: 'recharged', concept: 'Recarga de tokens de Uonify', invoiceId: SEED_RECHARGE_INVOICE },
    { id: 'mv_seed_2', at: iso(12), kind: 'spend', tokens: -1792, account: 'recharged', concept: 'Vídeo de «Make It Possible» · 4 planos con audio', feature: 'video' },
    { id: 'mv_seed_3', at: iso(5), kind: 'spend', tokens: -208, account: 'recharged', concept: 'Título y viñetas con Uony · UON-KIT-01', feature: 'product-ai' },
  ];
}

export function seedInvoices(): BillingDocument[] {
  const amounts = withVat(80, 0.21);
  return [
    {
      id: SEED_RECHARGE_INVOICE,
      number: 'F-2026-0001',
      kind: 'invoice',
      concept: 'Recarga de tokens de Uonify · 8.000 tokens',
      issuedAt: iso(20),
      base: amounts.base,
      vatRate: amounts.vatRate,
      vat: amounts.vat,
      total: amounts.total,
      status: 'paid',
    },
  ];
}
