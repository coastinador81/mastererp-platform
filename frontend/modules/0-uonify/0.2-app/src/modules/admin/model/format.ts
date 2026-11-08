/**
 * Formato de cifras del panel (español de España). Los tokens de Uonify se muestran
 * siempre con su valor en euros al lado: «1.250 tokens · 12,50 €».
 */

/** 100 tokens de Uonify = 1 € (precio de tarifa). */
export const TOKENS_PER_EURO = 100;

const integer = new Intl.NumberFormat('es-ES', { useGrouping: 'always', maximumFractionDigits: 0 });
const euro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const euroRound = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', useGrouping: 'always' });
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const dayTime = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function tokensToEuros(tokens: number): number {
  return tokens / TOKENS_PER_EURO;
}

export function eurosToTokens(euros: number): number {
  return Math.round(euros * TOKENS_PER_EURO);
}

/** 12.5 → «12,50 €»; con `round`, sin céntimos («4.310 €»). */
export function formatEuro(value: number, round = false): string {
  return (round ? euroRound : euro).format(value);
}

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** «1.250 tokens · 12,50 €» (con signo si `signed`: «+500 tokens · 5,00 €»). */
export function formatTokens(tokens: number, signed = false): string {
  const sign = signed && tokens > 0 ? '+' : tokens < 0 ? '−' : '';
  const abs = Math.abs(tokens);
  const unit = abs === 1 ? 'token' : 'tokens';
  return `${sign}${integer.format(abs)} ${unit} · ${euro.format(tokensToEuros(abs))}`;
}

/**
 * Importe en euros de un movimiento, con signo opcional. El libro guarda las cantidades
 * en céntimos (100 = 1 €), como en el backend: «+118,80 €», «−9,90 €».
 */
export function formatMoney(cents: number, signed = false): string {
  const sign = signed && cents > 0 ? '+' : cents < 0 ? '−' : '';
  return `${sign}${euro.format(tokensToEuros(Math.abs(cents)))}`;
}

/** 0.068 → «6,8 %». */
export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | Date): string {
  const date = toDate(value);
  return date ? day.format(date) : '—';
}

export function formatDateTime(value: string | Date): string {
  const date = toDate(value);
  return date ? dayTime.format(date) : '—';
}

/** Días enteros desde `now` hasta `value` (negativos si ya pasó). */
export function daysUntil(value: string, now: Date = new Date()): number {
  const date = toDate(value);
  if (!date) return Number.NaN;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** Variación frente al periodo anterior: 0.12 → «+12 %»; null si no hay base. */
export function formatDelta(current: number, previous: number): string | null {
  if (!previous) return null;
  const ratio = (current - previous) / previous;
  const text = percent.format(Math.abs(ratio));
  if (Math.abs(ratio) < 0.0005) return '0 %';
  return `${ratio > 0 ? '+' : '−'}${text}`;
}
