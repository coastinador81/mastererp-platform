import { eurosShort, round2 } from './money';
import { withVat } from './quote';
import type { Amounts, BillingConfig, Movement, TokenAccount } from './types';

/**
 * Recargas de tokens de Uonify: importe libre desde la recarga mínima (20 €), sin
 * packs ni descuentos. Cada token vale lo mismo recargues lo que recargues.
 */

/** Lee un importe escrito a la española: «20», «20,5», «1.000,50» o «20.50». */
export function parseAmount(input: string): number | null {
  const text = input.replace(/[€\s\u00a0]/g, '').trim();
  if (!text) return null;
  let normalized: string;
  if (text.includes(',')) normalized = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) normalized = text.replace(/\./g, '');
  else normalized = text;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? round2(value) : null;
}

/** Motivo por el que no se puede recargar ese importe, o null si vale. */
export function rechargeError(amount: number | null, config: Pick<BillingConfig, 'minRecharge' | 'maxRecharge'>): string | null {
  if (amount === null || Number.isNaN(amount)) return 'Escribe el importe que quieres recargar.';
  if (amount < config.minRecharge) return `La recarga mínima es de ${eurosShort(config.minRecharge)}.`;
  if (amount > config.maxRecharge) return `Puedes recargar hasta ${eurosShort(config.maxRecharge)} cada vez.`;
  return null;
}

export interface RechargeQuote {
  tokens: number;
  amounts: Amounts;
}

/** Tokens que da un importe y lo que se cobra con impuestos. */
export function rechargeQuote(amount: number, config: Pick<BillingConfig, 'tokenPrice' | 'vatRate'>): RechargeQuote {
  const tokens = Math.floor(round2(amount) / config.tokenPrice + 1e-9);
  return { tokens, amounts: withVat(amount, config.vatRate) };
}

export interface TokenTotals {
  tokens: number;
  included: number;
  recharged: number;
}

/** Saldo por subcuenta a partir del libro de movimientos. */
export function tokenTotals(movements: readonly Movement[]): TokenTotals {
  const sum = (account: TokenAccount) => movements.filter(m => m.account === account).reduce((total, m) => total + m.tokens, 0);
  const included = Math.max(0, sum('included'));
  const recharged = Math.max(0, sum('recharged'));
  return { tokens: included + recharged, included, recharged };
}

/**
 * Reparte un gasto entre subcuentas: primero los tokens del plan y después los
 * recargados. Null si no alcanza (el backend responde 402 tokens_required).
 */
export function splitSpend(totals: TokenTotals, cost: number): { included: number; recharged: number } | null {
  if (cost > totals.tokens) return null;
  const included = Math.min(totals.included, cost);
  return { included, recharged: cost - included };
}
