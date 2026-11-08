import { addDays, round2 } from './money';
import type { Amounts, Movement, Subscription, WithdrawalPreview } from './types';

/**
 * Desistimiento de 14 días (decisión del dueño): se devuelve automáticamente lo
 * pagado por el plan menos SOLO los tokens de Uonify del plan gastados desde el
 * cobro, a precio de tarifa, con nota de crédito y factura rectificativa. Los
 * tokens recargados aparte ya están pagados y no se descuentan.
 */
export const WITHDRAWAL_DAYS = 14;

export function withdrawalDeadline(startedAt: string | Date): Date {
  return addDays(startedAt, WITHDRAWAL_DAYS);
}

/** Tokens del plan (cuenta «incluidos») gastados desde `since`. */
export function tokensSpentSince(movements: readonly Movement[], since: string | Date): number {
  const from = new Date(since).getTime();
  return movements
    .filter(movement => movement.kind === 'spend' && movement.account === 'included' && new Date(movement.at).getTime() >= from)
    .reduce((total, movement) => total + Math.abs(movement.tokens), 0);
}

/**
 * Devolución = lo pagado − tokens gastados × precio de tarifa (sobre la base); el
 * IVA se devuelve en la misma proporción. Nunca es negativa.
 */
export function refundAmounts(paid: Amounts, tokensSpent: number, tokenPrice: number): { spentValue: number; refund: Amounts } {
  const spentValue = round2(Math.max(0, tokensSpent) * tokenPrice);
  const base = round2(Math.max(0, paid.base - spentValue));
  const vat = base === paid.base ? paid.vat : round2(base * paid.vatRate);
  return { spentValue, refund: { base, vatRate: paid.vatRate, vat, total: round2(base + vat) } };
}

const NO_REFUND = (vatRate: number): Amounts => ({ base: 0, vatRate, vat: 0, total: 0 });

export interface WithdrawalInput {
  subscription: Subscription;
  planName: string;
  movements: readonly Movement[];
  tokenPrice: number;
  invoiceNumber?: string | null;
  now?: Date;
}

export function withdrawalPreview({ subscription, planName, movements, tokenPrice, invoiceNumber = null, now = new Date() }: WithdrawalInput): WithdrawalPreview {
  const paid = subscription.amountPaid;
  const base = {
    planId: subscription.planId,
    planName,
    paidAt: subscription.startedAt,
    paid,
    invoiceNumber,
    tokenPrice,
  };
  if (subscription.planId === 'free' || !paid || !subscription.startedAt) {
    return { ...base, eligible: false, reason: 'no_plan', deadline: null, tokensSpent: 0, spentValue: 0, refund: NO_REFUND(paid?.vatRate ?? 0) };
  }
  const deadline = subscription.withdrawalUntil ? new Date(subscription.withdrawalUntil) : withdrawalDeadline(subscription.startedAt);
  const tokensSpent = tokensSpentSince(movements, subscription.startedAt);
  const { spentValue, refund } = refundAmounts(paid, tokensSpent, tokenPrice);
  const open = now.getTime() <= deadline.getTime();
  return {
    ...base,
    eligible: open,
    reason: open ? null : 'expired',
    deadline: deadline.toISOString(),
    tokensSpent,
    spentValue,
    refund: open ? refund : NO_REFUND(paid.vatRate),
  };
}
