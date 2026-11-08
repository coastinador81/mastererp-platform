/**
 * Formato de importes y fechas en español de España.
 */
const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** «39,00 €». */
export function formatEur(amount: number): string {
  return EUR.format(amount);
}

/** «27 de septiembre de 2026» a partir de «2026-09-27» o un ISO. */
export function formatLongDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(date);
}

/** «lun, 5 oct» de una fecha AAAA-MM-DD (sin cambiar de día por la zona). */
export function formatDayChip(date: string): { weekday: string; day: string; month: string; full: string } {
  const at = new Date(`${date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-ES', { ...options, timeZone: 'UTC' }).format(at);
  return {
    weekday: part({ weekday: 'short' }).replace('.', ''),
    day: part({ day: 'numeric' }),
    month: part({ month: 'short' }).replace('.', ''),
    full: part({ weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

/** «10:30» en la zona indicada. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(iso));
}

/** «lunes, 5 de octubre · 10:30» en la zona indicada. */
export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date(iso));
  return `${date} · ${formatTime(iso, timeZone)}`;
}

/** Hace cuánto: «hace 5 min», «hace 2 h», «hace 3 días» o la fecha. */
export function formatRelative(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'ayer' : `hace ${days} días`;
  return formatLongDate(iso);
}
