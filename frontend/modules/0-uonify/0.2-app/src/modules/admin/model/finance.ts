import { tokensToEuros } from './format';
import type { LedgerEntry } from './types';

/**
 * Desistimiento de 14 días (decisión del dueño): devolución automática menos solo los
 * tokens de Uonify gastados, a precio de tarifa. Nunca negativa.
 */
export function withdrawalRefund(paidEur: number, tokensSpent: number): number {
  const refund = paidEur - tokensToEuros(Math.max(0, tokensSpent));
  return Math.max(0, Math.round(refund * 100) / 100);
}

/** Saldo = suma de los apuntes contabilizados (los pendientes de aprobación no cuentan). */
export function ledgerBalance(entries: Pick<LedgerEntry, 'tokens' | 'status'>[]): number {
  return entries.reduce((sum, entry) => (entry.status === 'posted' ? sum + entry.tokens : sum), 0);
}

/** Margen bruto de la IA: ingresos por tokens menos coste de proveedores. */
export function grossMargin(revenue: number, cost: number): { amount: number; ratio: number } {
  const amount = Math.round((revenue - cost) * 100) / 100;
  return { amount, ratio: revenue > 0 ? amount / revenue : 0 };
}

/** Nivel del gasto frente al tope: aviso desde el 80 %, parado al 100 %. */
export type SpendLevel = 'ok' | 'warning' | 'limit';

export function spendLevel(spent: number, cap: number): SpendLevel {
  if (cap <= 0 || spent >= cap) return 'limit';
  return spent / cap >= 0.8 ? 'warning' : 'ok';
}
