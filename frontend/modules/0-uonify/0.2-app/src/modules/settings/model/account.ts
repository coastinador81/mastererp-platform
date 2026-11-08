import type { Account, AccountPatch, LanguageCode } from './types';

/** Idiomas de la interfaz. De momento solo hay español de España. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguageCode; label: string; disabled?: boolean }> = [
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'en', label: 'English (próximamente)', disabled: true },
];

export const TIME_ZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Europe/Madrid', label: 'Madrid, península y Baleares (CET)' },
  { value: 'Atlantic/Canary', label: 'Canarias (WET)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (WET)' },
  { value: 'Europe/London', label: 'Londres (GMT)' },
  { value: 'Europe/Paris', label: 'París (CET)' },
  { value: 'Europe/Berlin', label: 'Berlín (CET)' },
  { value: 'Europe/Rome', label: 'Roma (CET)' },
  { value: 'America/New_York', label: 'Nueva York (ET)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (CST)' },
  { value: 'America/Bogota', label: 'Bogotá (COT)' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires (ART)' },
  { value: 'UTC', label: 'Tiempo universal (UTC)' },
];

/** Zona horaria del dispositivo, o Madrid si el navegador no la da. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
  } catch {
    return 'Europe/Madrid';
  }
}

/** Opciones de zona horaria con la actual aunque no esté en la lista. */
export function timeZoneOptions(current: string): Array<{ value: string; label: string }> {
  if (!current || TIME_ZONES.some(zone => zone.value === current)) return [...TIME_ZONES];
  return [...TIME_ZONES, { value: current, label: current.replace(/_/g, ' ') }];
}

export const NAME_MAX = 80;

export interface AccountForm {
  name: string;
  language: LanguageCode;
  timeZone: string;
}

export function accountForm(account: Pick<Account, 'name' | 'language' | 'timeZone'>): AccountForm {
  return { name: account.name, language: account.language, timeZone: account.timeZone };
}

export function validateName(name: string): string | null {
  const clean = name.trim();
  if (!clean) return 'Escribe tu nombre.';
  if (clean.length > NAME_MAX) return `Usa ${NAME_MAX} caracteres como máximo.`;
  return null;
}

/** Solo los campos que han cambiado (vacío = nada que guardar). */
export function accountChanges(saved: AccountForm, form: AccountForm): AccountPatch {
  const patch: AccountPatch = {};
  if (form.name.trim() !== saved.name.trim()) patch.name = form.name.trim();
  if (form.language !== saved.language) patch.language = form.language;
  if (form.timeZone !== saved.timeZone) patch.timeZone = form.timeZone;
  return patch;
}

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Motivo por el que no se acepta una foto, o null si vale. */
export function avatarProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return 'Usa una imagen JPG, PNG o WEBP.';
  if (file.size > AVATAR_MAX_BYTES) return 'La imagen pesa más de 2 MB. Elige otra más ligera.';
  return null;
}
