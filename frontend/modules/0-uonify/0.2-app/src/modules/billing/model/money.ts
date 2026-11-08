/**
 * Formato de importes, tokens y fechas de facturación (español de España).
 * Se agrupan los miles también en cifras de 4 dígitos («1.250 tokens»), como pide
 * el dueño; Intl en es-ES no lo hace por defecto.
 */
const NBSP = ' ';

/** Redondeo a céntimos sin errores de coma flotante (0,1 + 0,2). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** «1.250», «1.873,08», «-3,50». */
export function formatNumber(value: number, decimals = 0): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const negative = value < 0 && Number(fixed) !== 0;
  return `${negative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/** «1.873,08 €». */
export function euros(value: number): string {
  return `${formatNumber(round2(value), 2)}${NBSP}€`;
}

/** Sin céntimos si el importe es redondo: «129 €», «9,50 €». */
export function eurosShort(value: number): string {
  const rounded = round2(value);
  return Number.isInteger(rounded) ? `${formatNumber(rounded)}${NBSP}€` : euros(rounded);
}

/** «1.250 tokens» («1 token»). */
export function tokens(value: number): string {
  const count = Math.round(value);
  return `${formatNumber(count)}${NBSP}${Math.abs(count) === 1 ? 'token' : 'tokens'}`;
}

/** Tokens de Uonify siempre con su valor en euros: «1.250 tokens · 12,50 €». */
export function tokensLabel(count: number, tokenPrice: number): string {
  return `${tokens(count)} · ${euros(count * tokenPrice)}`;
}

/** «+2.000» o «-1.792» para la lista de movimientos. */
export function signedNumber(value: number, decimals = 0): string {
  const text = formatNumber(value, decimals);
  return value > 0 ? `+${text}` : text;
}

/** «21 %». */
export function percent(rate: number): string {
  return `${formatNumber(round2(rate * 100), Number.isInteger(round2(rate * 100)) ? 0 : 1)}${NBSP}%`;
}

const LONG = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** «27 de octubre de 2027». */
export function longDate(value: string | number | Date): string {
  return LONG.format(toDate(value));
}

/** «27 oct 2027». */
export function shortDate(value: string | number | Date): string {
  return SHORT.format(toDate(value)).replace(/\./g, '');
}

/** «septiembre de 2026». */
export function monthLabel(value: string | number | Date): string {
  return MONTH.format(toDate(value));
}

/** Suma meses respetando el fin de mes (31 ene + 1 mes = 28/29 feb). */
export function addMonths(value: string | number | Date, months: number): Date {
  const date = new Date(toDate(value).getTime());
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}

export function addDays(value: string | number | Date, days: number): Date {
  return new Date(toDate(value).getTime() + days * 86_400_000);
}
