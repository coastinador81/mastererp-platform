import { currentAccountEmail } from '@/modules/auth';
import { record } from '@/shared/mocks/db';
import { parsePaymentCard } from '../model/card';
import type { PaymentDetails, PaymentMethod } from '../model/types';

// Nueva colección: no hereda tarjetas precargadas de versiones anteriores.
const cards = record<Record<string, PaymentMethod | null>>('billing-saved-cards-v2', () => ({}));
const owner = () => currentAccountEmail()?.trim().toLowerCase() ?? 'local';
export const cardDb = {
  get: () => ({ card: cards.get()[owner()] ?? null }),
  set: ({ card }: { card: PaymentMethod | null }) => {
    cards.update(all => ({ ...all, [owner()]: card }));
    return { card };
  },
};

export function resolvePayment(body: Partial<PaymentDetails>): PaymentMethod | null {
  if (body.paymentMethod === 'new') return parsePaymentCard(body.newCard);
  const saved = cardDb.get().card;
  return saved && body.paymentMethod === saved.id ? saved : null;
}

/** Solo tras un pago correcto y una elección explícita. */
export function savePaymentChoice(body: Partial<PaymentDetails>, card: PaymentMethod): void {
  if (body.paymentMethod === 'new' && body.savePaymentMethod === true) cardDb.set({ card });
}
