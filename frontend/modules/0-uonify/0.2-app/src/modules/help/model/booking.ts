/**
 * Videollamadas de soporte con Google Meet: huecos de la agenda en su zona horaria,
 * aviso de precio ANTES de pagar (transparencia previa, como videocall-pricing de
 * Rentprivé: lo que se anuncia y lo que se cobra salen de la misma configuración),
 * cancelación y el evento para el calendario. Lógica pura, sin leer la hora.
 */
import { minutesOf } from './config';
import { formatEur } from './format';
import type { Booking, BookingStatus, BookingTopic, SlotDay, VideocallConfig } from './types';

export const BOOKING_TOPICS: Record<BookingTopic, string> = {
  onboarding: 'Primeros pasos con Uonify',
  amazon: 'Amazon y publicación de fichas',
  content: 'Contenido con Uony: textos, imágenes y vídeo',
  billing: 'Planes, tokens y facturación',
  other: 'Otro tema',
};

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Celebrada',
  expired: 'Sin pagar',
};

/** Minutos que se guarda un hueco mientras se paga. */
export const HOLD_MINUTES = 10;

function parts(instant: number, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return out;
}

/** Diferencia en minutos entre la hora local de la zona y UTC en un instante. */
export function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const p = parts(instant, timeZone);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000) / 60_000;
}

/** Instante UTC de una fecha y hora de pared en una zona («2026-10-05», «10:30», Europe/Madrid). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const first = zoneOffsetMinutes(guess, timeZone);
  let utc = guess - first * 60_000;
  const second = zoneOffsetMinutes(utc, timeZone);
  if (second !== first) utc = guess - second * 60_000;
  return new Date(utc);
}

/** Fecha AAAA-MM-DD de un instante en una zona. */
export function zonedDate(instant: number, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export interface SlotOptions {
  now: number;
  /** Inicios ya reservados (ISO). */
  taken?: ReadonlySet<string>;
  /** Huecos ocupados por la agenda del equipo. */
  isBusy?: (startIso: string) => boolean;
}

/**
 * Días y huecos reservables: días con agenda, franjas del equipo, antelación mínima
 * y horizonte. Los huecos ocupados se devuelven como no disponibles.
 */
export function generateSlotDays(config: VideocallConfig, { now, taken = new Set(), isBusy = () => false }: SlotOptions): SlotDay[] {
  const first = zonedDate(now, config.timezone);
  const earliest = now + config.minNoticeHours * 3_600_000;
  const days: SlotDay[] = [];
  for (let offset = 0; offset < config.horizonDays; offset += 1) {
    const date = addDays(first, offset);
    if (!config.weekdays.includes(weekdayOf(date))) continue;
    const slots = config.windows.flatMap(window => {
      const out: Array<{ start: string; available: boolean }> = [];
      for (let t = minutesOf(window.from); t + config.durationMin <= minutesOf(window.to); t += config.durationMin) {
        const start = zonedToUtc(date, hhmm(t), config.timezone);
        if (start.getTime() < earliest) continue;
        const iso = start.toISOString();
        out.push({ start: iso, available: !taken.has(iso) && !isBusy(iso) });
      }
      return out;
    });
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

/** Si un inicio es un hueco válido de la agenda (el servidor lo comprueba al reservar). */
export function isValidSlot(config: VideocallConfig, startIso: string, now: number): boolean {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return false;
  return generateSlotDays(config, { now }).some(day => day.slots.some(slot => new Date(slot.start).getTime() === start));
}

/**
 * Aviso de precio que se enseña ANTES de pagar. Nunca se escribe en el componente:
 * así el texto y el importe no pueden divergir.
 */
export function chargeNotice(config: Pick<VideocallConfig, 'priceEur' | 'vatIncluded' | 'cancelNoticeHours' | 'durationMin'>): string {
  if (config.priceEur <= 0) return `La videollamada de ${config.durationMin} minutos es gratuita: al confirmarla no se te cobrará nada.`;
  const vat = config.vatIncluded ? 'IVA incluido' : 'más IVA';
  return `La videollamada de ${config.durationMin} minutos cuesta ${formatEur(config.priceEur)} (${vat}) y se cobra al confirmar la reserva. `
    + `Puedes cancelarla hasta ${config.cancelNoticeHours} horas antes y te devolvemos el importe completo. Si la cancela Uonify, también te lo devolvemos.`;
}

/** Precio corto para botones y tarjetas: «39,00 €» o «Gratis». */
export function priceLabel(priceEur: number): string {
  return priceEur > 0 ? formatEur(priceEur) : 'Gratis';
}

export type CancelCheck = { ok: true; refund: boolean } | { ok: false; message: string };

/** Si se puede cancelar una reserva ahora, y si se devuelve el importe. */
export function cancelCheck(booking: Pick<Booking, 'status' | 'start' | 'priceEur'>, cancelNoticeHours: number, now: number): CancelCheck {
  if (booking.status === 'pending_payment') return { ok: true, refund: false };
  if (booking.status !== 'confirmed') return { ok: false, message: 'Esta reserva ya no se puede cancelar.' };
  const hoursLeft = (new Date(booking.start).getTime() - now) / 3_600_000;
  if (hoursLeft < cancelNoticeHours) {
    return { ok: false, message: `Solo se puede cancelar hasta ${cancelNoticeHours} horas antes. Si no puedes asistir, escríbenos.` };
  }
  return { ok: true, refund: booking.priceEur > 0 };
}

/** Código de sala de Meet con el formato abc-defg-hij a partir de una semilla. */
export function meetCode(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const letters = 'abcdefghijkmnopqrstuvwxyz';
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
    code += letters[hash % letters.length];
  }
  return `${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`;
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/[,;]/g, match => `\\${match}`).replace(/\n/g, '\\n');

export const EVENT_TITLE = 'Videollamada con el soporte de Uonify';

function eventDetails(booking: Pick<Booking, 'meetUrl' | 'topic' | 'durationMin'>): string {
  return [
    `Sesión de ${booking.durationMin} minutos con el equipo de Uonify sobre: ${BOOKING_TOPICS[booking.topic]}.`,
    booking.meetUrl ? `Únete con Google Meet: ${booking.meetUrl}` : '',
  ].filter(Boolean).join('\n');
}

/** Archivo .ics del evento (líneas CRLF, textos escapados). */
export function buildIcs(booking: Pick<Booking, 'id' | 'start' | 'end' | 'meetUrl' | 'topic' | 'durationMin'>, now: number): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Uonify//Soporte//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@uonify.com`,
    `DTSTAMP:${icsDate(new Date(now).toISOString())}`,
    `DTSTART:${icsDate(booking.start)}`,
    `DTEND:${icsDate(booking.end)}`,
    `SUMMARY:${icsText(EVENT_TITLE)}`,
    `DESCRIPTION:${icsText(eventDetails(booking))}`,
    booking.meetUrl ? `LOCATION:${icsText(booking.meetUrl)}` : '',
    booking.meetUrl ? `URL:${booking.meetUrl}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/** Enlace para añadir el evento a Google Calendar. */
export function googleCalendarUrl(booking: Pick<Booking, 'start' | 'end' | 'meetUrl' | 'topic' | 'durationMin'>): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: EVENT_TITLE,
    dates: `${icsDate(booking.start)}/${icsDate(booking.end)}`,
    details: eventDetails(booking),
  });
  if (booking.meetUrl) params.set('location', booking.meetUrl);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Nombre legible de la zona para la persona. */
export function timezoneLabel(timeZone: string): string {
  return timeZone === 'Europe/Madrid' ? 'hora peninsular española' : timeZone.replace(/_/g, ' ');
}
