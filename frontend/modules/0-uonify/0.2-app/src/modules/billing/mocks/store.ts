import { currentAccountEmail, mockBillingAccount } from '@/modules/auth';
import { resetAccessMocks } from './access';
import { collection, record } from '@/shared/mocks/db';
import { uid } from '@/shared/lib';
import { round2 } from '../model/money';
import { sortPlans, type BillingPlan, type PlanId } from '../model/plans';
import { tokenTotals } from '../model/recharge';
import type { Amounts, BillingBalance, BillingConfig, BillingDocument, DocumentKind, Movement, Subscription } from '../model/types';
import { DEFAULT_CONFIG, PLANS } from './fixtures/plans';
import { seedInvoices, seedMovements, seedSubscription } from './fixtures/seed';

/**
 * «Base de datos» de la simulación de cobros (sessionStorage con @/shared/mocks/db):
 * planes y configuración editables desde admin, suscripción, libro de tokens,
 * facturas y tarjeta. Solo la usan los handlers de MSW.
 */
export const plansDb = collection<BillingPlan>('billing-plans', () => PLANS.map(plan => ({ ...plan })));
export const configDb = record<BillingConfig>('billing-config', () => ({ ...DEFAULT_CONFIG }));
const subscriptions = record<Record<string, Subscription>>('billing-subscriptions-v2', () => ({}));
const owner = () => mockBillingAccount().email ?? currentAccountEmail()?.trim().toLowerCase() ?? 'local';
export const subscriptionDb = {
  get: () => subscriptions.get()[owner()] ?? seedSubscription(),
  set: (subscription: Subscription) => {
    subscriptions.update(all => ({ ...all, [owner()]: subscription }));
    return subscription;
  },
};
export const movementsDb = collection<Movement>('billing-movements', seedMovements);
export const invoicesDb = collection<BillingDocument>('billing-invoices', seedInvoices);
export { cardDb } from './cards';
import { cardDb } from './cards';
const countersDb = record<Record<DocumentKind, number>>('billing-counters', () => ({ invoice: 1, credit_note: 0, corrective: 0 }));

const SERIES: Record<DocumentKind, string> = { invoice: 'F', credit_note: 'NC', corrective: 'R' };

export function allPlans(): BillingPlan[] {
  return sortPlans(plansDb.all());
}

export function planById(id: PlanId): BillingPlan | undefined {
  return plansDb.get(id);
}

export function planName(id: PlanId): string {
  return planById(id)?.name ?? id;
}

/** Libro de movimientos del más reciente al más antiguo. */
export function movementsNewestFirst(): Movement[] {
  return movementsDb.all().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function addMovement(movement: Omit<Movement, 'id' | 'at'> & { at?: string }): Movement {
  return movementsDb.upsert({ id: uid('mv'), at: movement.at ?? new Date().toISOString(), ...movement });
}

/** Número correlativo por serie: F-2026-0002, NC-2026-0001, R-2026-0001. */
function nextNumber(kind: DocumentKind, at: Date): string {
  const counters = countersDb.update(current => ({ ...current, [kind]: current[kind] + 1 }));
  return `${SERIES[kind]}-${at.getUTCFullYear()}-${String(counters[kind]).padStart(4, '0')}`;
}

export function issueDocument(kind: DocumentKind, concept: string, amounts: Amounts, extra: Partial<BillingDocument> = {}): BillingDocument {
  const now = new Date();
  const sign = kind === 'invoice' ? 1 : -1;
  return invoicesDb.upsert({
    id: uid(kind === 'invoice' ? 'inv' : kind === 'credit_note' ? 'cn' : 'rect'),
    number: nextNumber(kind, now),
    kind,
    concept,
    issuedAt: now.toISOString(),
    base: round2(sign * amounts.base),
    vatRate: amounts.vatRate,
    vat: round2(sign * amounts.vat),
    total: round2(sign * amounts.total),
    status: kind === 'invoice' ? 'paid' : 'issued',
    ...extra,
  });
}

export function documentsNewestFirst(): BillingDocument[] {
  return invoicesDb.all().sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
}

/** Saldo con el contrato que ya lee pim-video: { amount, currency } más el detalle. */
export function currentBalance(): BillingBalance {
  const { tokenPrice } = configDb.get();
  const totals = tokenTotals(movementsDb.all());
  const subscription = subscriptionDb.get();
  return {
    amount: round2(totals.tokens * tokenPrice),
    currency: 'EUR',
    tokens: totals.tokens,
    tokenPrice,
    included: { tokens: totals.included, renewsAt: totals.included > 0 || subscription.planId !== 'free' ? nextMonthlyRenewal(subscription) : null },
    recharged: { tokens: totals.recharged },
  };
}

/** Los tokens del plan se renuevan cada mes desde el día del cobro. */
function nextMonthlyRenewal(subscription: Subscription): string | null {
  if (!subscription.startedAt) return null;
  const start = new Date(subscription.startedAt);
  const now = new Date();
  const next = new Date(start.getTime());
  while (next.getTime() <= now.getTime()) next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

/** Retira los tokens del plan que queden (cambio de plan o desistimiento). */
export function expireIncluded(concept: string): void {
  const { included } = tokenTotals(movementsDb.all());
  if (included > 0) addMovement({ kind: 'expiry', tokens: -included, account: 'included', concept });
}

/** Vuelve al estado inicial (pruebas y «empezar de cero»). */
export function resetBillingMocks(): void {
  resetAccessMocks();
  subscriptions.set({});
  plansDb.reset();
  configDb.set({ ...DEFAULT_CONFIG });
  subscriptionDb.set(seedSubscription());
  movementsDb.reset();
  invoicesDb.reset();
  cardDb.set({ card: null });
  countersDb.set({ invoice: 1, credit_note: 0, corrective: 0 });
}
