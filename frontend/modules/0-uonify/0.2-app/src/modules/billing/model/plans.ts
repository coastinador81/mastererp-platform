import { round2 } from './money';

export type BillingInterval = 'monthly' | 'annual';
export const isBillingInterval = (value: unknown): value is BillingInterval => value === 'monthly' || value === 'annual';

export type PlanId = 'free' | 'basic' | 'pro' | 'max' | 'custom';

/** Plan tal como lo devuelve GET /api/billing/plans (precios editables desde admin). */
export interface BillingPlan {
  id: PlanId;
  name: string;
  /** Precio de una mensualidad en euros, para pago mensual o anual; null en Personalizado. */
  monthlyPrice: number | null;
  /** Meses de servicio por año pagado (13 = «1 mes gratis»). */
  monthsPerYear: number;
  description: string;
  seats: number | null;
  /** Límites aún por definir por el dueño: textos editables desde admin. */
  limits: string;
  contactSales?: boolean;
  /** Tokens de Uonify incluidos cada mes (no se acumulan). Editable desde admin. */
  includedTokens?: number | null;
  /** Plan destacado en las tarjetas («Más elegido»). */
  popular?: boolean;
}

/** Orden de los planes de menor a mayor (sirve para saber si un cambio sube o baja). */
export const PLAN_ORDER: readonly PlanId[] = ['free', 'basic', 'pro', 'max', 'custom'];

/** Meses que se pagan cada año: el mes de más es el que regala Uonify. */
export const PAID_MONTHS = 12;

export function planRank(id: PlanId): number {
  return PLAN_ORDER.indexOf(id);
}

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_ORDER as readonly string[]).includes(value);
}

/** Plan de pago con precio publicado (Básico, Pro y Max). */
export function isPaidPlan(plan: Pick<BillingPlan, 'monthlyPrice' | 'contactSales'>): boolean {
  return !plan.contactSales && plan.monthlyPrice !== null && plan.monthlyPrice > 0;
}

/** Lo que se cobra al año, sin impuestos: 12 cuotas (el mes 13 va incluido). */
export function annualPrice(plan: Pick<BillingPlan, 'monthlyPrice'>): number | null {
  return plan.monthlyPrice === null ? null : round2(plan.monthlyPrice * PAID_MONTHS);
}

export type PlanChange = 'current' | 'upgrade' | 'downgrade' | 'sales';

/** Qué supone pasar de un plan a otro: subir se paga ya, bajar se aplica al renovar. */
export function planChange(current: PlanId, target: PlanId): PlanChange {
  if (target === 'custom') return 'sales';
  if (target === current) return 'current';
  return planRank(target) > planRank(current) ? 'upgrade' : 'downgrade';
}

export function sortPlans<T extends { id: PlanId }>(plans: readonly T[]): T[] {
  return [...plans].sort((a, b) => planRank(a.id) - planRank(b.id));
}
