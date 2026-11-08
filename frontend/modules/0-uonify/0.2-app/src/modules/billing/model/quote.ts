import { addDays, addMonths, round2 } from './money';
import { annualPrice, PAID_MONTHS, planChange, type BillingPlan, type BillingInterval } from './plans';
import { WITHDRAWAL_DAYS } from './refund';
import type { Amounts, CheckoutQuote, Subscription } from './types';

/**
 * Cálculo por modalidad (lo repite el servidor, que es quien cobra): una cuota
 * mensual o doce cuotas anuales, impuestos aparte y, al subir de plan, se descuenta la
 * parte no usada del plan actual.
 */

/** Base, IVA y total a partir de la base sin impuestos. */
export function withVat(base: number, vatRate: number): Amounts {
  const cleanBase = round2(Math.max(0, base));
  const vat = round2(cleanBase * vatRate);
  return { base: cleanBase, vatRate, vat, total: round2(cleanBase + vat) };
}

/**
 * Parte no usada del plan de pago actual, proporcional a los días que quedan del
 * periodo. Solo cuenta si es un plan de pago en curso.
 */
export function prorationCredit(current: Subscription | null | undefined, now: Date): number {
  if (!current?.amountPaid || !current.startedAt || !current.renewsAt || current.planId === 'free') return 0;
  const start = new Date(current.startedAt).getTime();
  const end = new Date(current.renewsAt).getTime();
  const at = now.getTime();
  if (!(end > start) || at >= end) return 0;
  const remaining = Math.min(1, (end - Math.max(at, start)) / (end - start));
  return round2(current.amountPaid.base * remaining);
}

export interface QuoteInput {
  plan: BillingPlan;
  interval?: BillingInterval;
  vatRate: number;
  current?: Subscription | null;
  currentPlanName?: string | null;
  now?: Date;
}

export function quoteCheckout({ plan, interval = 'annual', vatRate, current, currentPlanName = null, now = new Date() }: QuoteInput): CheckoutQuote {
  const base = (interval === 'monthly' ? plan.monthlyPrice : annualPrice(plan)) ?? 0;
  const upgrading = current ? planChange(current.planId, plan.id) === 'upgrade' : false;
  const credit = upgrading ? Math.min(base, prorationCredit(current, now)) : 0;
  const months = interval === 'monthly' ? 1 : plan.monthsPerYear || PAID_MONTHS;
  return {
    interval,
    planId: plan.id,
    planName: plan.name,
    monthlyPrice: plan.monthlyPrice ?? 0,
    paidMonths: interval === 'monthly' ? 1 : PAID_MONTHS,
    months,
    base,
    credit,
    creditPlanName: credit > 0 ? currentPlanName : null,
    amounts: withVat(base - credit, vatRate),
    startsAt: now.toISOString(),
    endsAt: addMonths(now, months).toISOString(),
    withdrawalUntil: addDays(now, WITHDRAWAL_DAYS).toISOString(),
    renewalBase: base,
  };
}
