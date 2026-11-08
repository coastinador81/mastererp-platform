/**
 * Fechas de la campana en español de España, sin depender de los datos de
 * idioma del navegador (mismo texto en todos los equipos y en las pruebas).
 */
const MONTHS_SHORT = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Medianoche (hora local) del día de `ms`. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Días naturales entre dos instantes (0 = mismo día, 1 = ayer…). */
export function calendarDaysBetween(earlier: number, later: number): number {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / DAY);
}

function clock(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «27 de septiembre de 2026, 10:42» (para el título de <time>). */
export function formatFullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} de ${MONTHS_LONG[date.getMonth()]} de ${date.getFullYear()}, ${clock(date)}`;
}

/** «4 de octubre» (para los textos de la simulación). */
export function formatDayMonth(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} de ${MONTHS_LONG[date.getMonth()]}`;
}

/**
 * Cuándo llegó una notificación, relativo a `now`:
 * «Ahora mismo», «Hace 5 min», «Hace 2 h», «Ayer, 18:40», «Martes, 9:15»,
 * «22 sept.» y, de otro año, «22 sept. 2025».
 */
export function formatWhen(iso: string, now: number): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const diff = Math.max(0, now - time);
  const days = calendarDaysBetween(time, now);
  if (days <= 0) {
    if (diff < MINUTE) return 'Ahora mismo';
    if (diff < HOUR) return `Hace ${Math.floor(diff / MINUTE)} min`;
    return `Hace ${Math.floor(diff / HOUR)} h`;
  }
  const date = new Date(time);
  if (days === 1) return `Ayer, ${clock(date)}`;
  if (days < 7) return `${capitalize(WEEKDAYS[date.getDay()])}, ${clock(date)}`;
  const dayMonth = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? dayMonth : `${dayMonth} ${date.getFullYear()}`;
}
