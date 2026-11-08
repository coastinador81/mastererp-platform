/**
 * Configuración de la ayuda (GET/PUT /help/config). Admin edita el precio y la agenda
 * de las videollamadas, el correo de contacto y si Uony de soporte está activo.
 */
import { CONTACT_EMAIL } from './paths';
import type { HelpConfig, TimeWindow, VideocallConfig } from './types';

export const DEFAULT_VIDEOCALL: VideocallConfig = {
  enabled: true,
  priceEur: 39,
  vatIncluded: true,
  durationMin: 30,
  timezone: 'Europe/Madrid',
  weekdays: [1, 2, 3, 4, 5],
  windows: [{ from: '09:30', to: '13:30' }, { from: '15:30', to: '18:00' }],
  minNoticeHours: 24,
  horizonDays: 14,
  cancelNoticeHours: 24,
};

export function defaultHelpConfig(now = new Date()): HelpConfig {
  return {
    contactEmail: CONTACT_EMAIL,
    assistantEnabled: true,
    videocall: { ...DEFAULT_VIDEOCALL, weekdays: [...DEFAULT_VIDEOCALL.weekdays], windows: DEFAULT_VIDEOCALL.windows.map(w => ({ ...w })) },
    updatedAt: now.toISOString(),
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutos desde medianoche de «HH:MM». */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function validWindows(windows: unknown): windows is TimeWindow[] {
  if (!Array.isArray(windows) || !windows.length || windows.length > 6) return false;
  const parsed = windows.map(w => (w && typeof w === 'object' ? (w as TimeWindow) : null));
  if (parsed.some(w => !w || !TIME.test(w.from) || !TIME.test(w.to) || minutesOf(w.from) >= minutesOf(w.to))) return false;
  // Sin solaparse, en orden.
  return parsed.every((w, i) => i === 0 || minutesOf(parsed[i - 1]!.to) <= minutesOf(w!.from));
}

export type ConfigValidation = { ok: true; config: HelpConfig } | { ok: false; message: string };

/**
 * Comprueba una configuración que llega de admin y la completa con la actual.
 * Devuelve un mensaje en español si algo no vale.
 */
export function validateHelpConfig(input: unknown, current: HelpConfig, now = new Date()): ConfigValidation {
  if (!input || typeof input !== 'object') return { ok: false, message: 'La configuración no es válida.' };
  const body = input as Partial<HelpConfig> & { videocall?: Partial<VideocallConfig> };
  const email = body.contactEmail ?? current.contactEmail;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'El correo de contacto no es válido.' };
  const assistantEnabled = body.assistantEnabled ?? current.assistantEnabled;
  if (typeof assistantEnabled !== 'boolean') return { ok: false, message: 'Indica si Uony de soporte está activo.' };
  const v = { ...current.videocall, ...(body.videocall ?? {}) };
  if (typeof v.enabled !== 'boolean') return { ok: false, message: 'Indica si las videollamadas están activas.' };
  if (typeof v.priceEur !== 'number' || !Number.isFinite(v.priceEur) || v.priceEur < 0 || v.priceEur > 5000) {
    return { ok: false, message: 'El precio de la videollamada debe estar entre 0 y 5.000 €.' };
  }
  if (Math.round(v.priceEur * 100) !== v.priceEur * 100) return { ok: false, message: 'El precio admite como máximo dos decimales.' };
  if (typeof v.vatIncluded !== 'boolean') return { ok: false, message: 'Indica si el precio incluye el IVA.' };
  if (!Number.isInteger(v.durationMin) || v.durationMin < 15 || v.durationMin > 120) return { ok: false, message: 'La duración debe estar entre 15 y 120 minutos.' };
  if (typeof v.timezone !== 'string' || !validTimezone(v.timezone)) return { ok: false, message: 'La zona horaria no es válida.' };
  if (!Array.isArray(v.weekdays) || !v.weekdays.length || v.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    return { ok: false, message: 'Elige al menos un día de la semana con agenda.' };
  }
  if (!validWindows(v.windows)) return { ok: false, message: 'Las franjas horarias deben tener el formato HH:MM, en orden y sin solaparse.' };
  if (v.windows.some(w => minutesOf(w.to) - minutesOf(w.from) < v.durationMin)) return { ok: false, message: 'Cada franja debe durar al menos una sesión.' };
  if (!Number.isInteger(v.minNoticeHours) || v.minNoticeHours < 0 || v.minNoticeHours > 336) return { ok: false, message: 'La antelación mínima debe estar entre 0 y 336 horas.' };
  if (!Number.isInteger(v.horizonDays) || v.horizonDays < 1 || v.horizonDays > 90) return { ok: false, message: 'Se puede reservar entre 1 y 90 días por delante.' };
  if (!Number.isInteger(v.cancelNoticeHours) || v.cancelNoticeHours < 0 || v.cancelNoticeHours > 168) return { ok: false, message: 'El plazo de cancelación debe estar entre 0 y 168 horas.' };
  return {
    ok: true,
    config: {
      contactEmail: email.trim().toLowerCase(),
      assistantEnabled,
      videocall: { ...v, weekdays: [...new Set(v.weekdays)].sort(), windows: v.windows.map(w => ({ from: w.from, to: w.to })) },
      updatedAt: now.toISOString(),
    },
  };
}
