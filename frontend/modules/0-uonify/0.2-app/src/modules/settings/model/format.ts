/**
 * Formato de números, dinero y fechas de Configuración (español de España).
 * Los miles se agrupan siempre con punto («1.250 tokens · 12,50 €»), también con
 * cuatro cifras, que Intl no agrupa en es-ES.
 */
const NBSP = ' ';

export function groupThousands(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = String(Math.trunc(Math.abs(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** «12,50 €» · «1.250,00 €» · «-3,20 €». */
export function formatEuros(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const cents = Math.round(Math.abs(value) * 100);
  const whole = groupThousands(Math.floor(cents / 100));
  const decimals = String(cents % 100).padStart(2, '0');
  return `${value < 0 && cents > 0 ? '-' : ''}${whole},${decimals}${NBSP}€`;
}

/** «1.250 tokens» (o «1 token»). */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  return `${groupThousands(rounded)} ${Math.abs(rounded) === 1 ? 'token' : 'tokens'}`;
}

/** Porcentaje con coma decimal solo si hace falta: «26 %», «6,5 %». */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded).replace('.', ',')}${NBSP}%`;
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «27 sept 2026». */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = value === null || value === undefined ? null : toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace(/\./g, '');
}

/** «27 sept 2026, 14:05». */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = value === null || value === undefined ? null : toDate(value);
  if (!date) return '—';
  const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${formatDate(date)}, ${time}`;
}

/** «Activa ahora», «hace 5 min», «hace 3 h», «hace 2 días», o la fecha si pasa de un mes. */
export function formatRelative(value: string | number | Date | null | undefined, now = Date.now()): string {
  const date = value === null || value === undefined ? null : toDate(value);
  if (!date) return '—';
  const minutes = Math.floor((now - date.getTime()) / 60000);
  if (minutes < 2) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return formatDate(date);
}

/** Días enteros que faltan hasta una fecha (0 si ya pasó). */
export function daysUntil(value: string | number | Date | null | undefined, now = Date.now()): number {
  const date = value === null || value === undefined ? null : toDate(value);
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() - now) / 86_400_000));
}

/** Duración hasta un instante: «2 h 46 min», «12 min», «3 días 4 h». */
export function formatCountdown(target: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((target - now) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days} ${days === 1 ? 'día' : 'días'} ${hours} h` : `${days} ${days === 1 ? 'día' : 'días'}`;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

/** Iniciales para el avatar: «Ana García» → «AG». */
export function initials(name: string, fallback = 'U'): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const letters = parts.length === 1 ? parts[0].slice(0, 1) : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return letters.toUpperCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}
