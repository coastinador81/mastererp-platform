import type { SignInMethodId } from './types';

/**
 * Lógica pura de Seguridad: códigos de verificación, teléfonos, límites de SMS
 * (cada SMS cuesta dinero a Uonify) y códigos de recuperación.
 */

/** Deja solo las cifras de un código pegado («123 456» → «123456»). */
export function normalizeCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function isSixDigitCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** Clave base32 en grupos de cuatro para copiarla a mano. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

export interface CountryPrefix {
  code: string;
  prefix: string;
  label: string;
}

/** Prefijos más habituales (el backend acepta cualquier número E.164). */
export const COUNTRY_PREFIXES: readonly CountryPrefix[] = [
  { code: 'ES', prefix: '+34', label: 'España (+34)' },
  { code: 'PT', prefix: '+351', label: 'Portugal (+351)' },
  { code: 'FR', prefix: '+33', label: 'Francia (+33)' },
  { code: 'IT', prefix: '+39', label: 'Italia (+39)' },
  { code: 'DE', prefix: '+49', label: 'Alemania (+49)' },
  { code: 'GB', prefix: '+44', label: 'Reino Unido (+44)' },
  { code: 'US', prefix: '+1', label: 'Estados Unidos (+1)' },
  { code: 'MX', prefix: '+52', label: 'México (+52)' },
];

/** Número en formato E.164 o null si no es válido («+34» + «612 345 678» → «+34612345678»). */
export function toE164(prefix: string, number: string): string | null {
  const digits = number.replace(/[\s().-]/g, '');
  if (!/^\d{6,14}$/.test(digits)) return null;
  const full = `${prefix}${digits}`;
  return /^\+\d{8,15}$/.test(full) ? full : null;
}

/** «+34612345678» → «+34 ••• ••• 678». */
export function maskPhone(e164: string): string {
  const match = /^(\+\d{1,3}?)(\d{6,14})$/.exec(e164.replace(/\s/g, ''));
  if (!match) return '•••';
  const known = COUNTRY_PREFIXES.map(item => item.prefix).find(prefix => e164.startsWith(prefix));
  const prefix = known ?? match[1];
  const rest = e164.slice(prefix.length);
  return `${prefix} ••• ••• ${rest.slice(-3)}`;
}

/** Límites del envío de SMS: pausa entre envíos y topes por hora y por día. */
export const SMS_LIMITS = { minIntervalSec: 60, perHour: 5, perDay: 10 } as const;

export interface RateDecision {
  allowed: boolean;
  /** Segundos hasta el próximo envío permitido (0 si se permite ya). */
  retryAfterSec: number;
  reason?: 'interval' | 'hour' | 'day';
}

/** ¿Se puede enviar otro SMS? `sentAt`: instantes (ms) de los envíos anteriores. */
export function smsRateLimit(sentAt: readonly number[], now = Date.now(), limits = SMS_LIMITS): RateDecision {
  const recent = [...sentAt].filter(time => now - time < 86_400_000).sort((a, b) => a - b);
  const last = recent.at(-1);
  if (last !== undefined && now - last < limits.minIntervalSec * 1000) {
    return { allowed: false, retryAfterSec: Math.ceil((limits.minIntervalSec * 1000 - (now - last)) / 1000), reason: 'interval' };
  }
  const lastHour = recent.filter(time => now - time < 3_600_000);
  if (lastHour.length >= limits.perHour) {
    return { allowed: false, retryAfterSec: Math.ceil((lastHour[0] + 3_600_000 - now) / 1000), reason: 'hour' };
  }
  if (recent.length >= limits.perDay) {
    return { allowed: false, retryAfterSec: Math.ceil((recent[0] + 86_400_000 - now) / 1000), reason: 'day' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Texto para el límite de SMS: «Podrás pedir otro código en 45 s» / «en 12 min». */
export function retryText(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Diez códigos de un solo uso con el formato «xxxx-xxxx» (sin caracteres confusos). */
export function generateRecoveryCodes(random: () => number = Math.random, count = RECOVERY_CODE_COUNT): string[] {
  const pick = () => RECOVERY_ALPHABET[Math.floor(random() * RECOVERY_ALPHABET.length) % RECOVERY_ALPHABET.length];
  const codes = new Set<string>();
  while (codes.size < count) codes.add(`${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`);
  return [...codes];
}

/** Texto del archivo de códigos que se descarga. */
export function recoveryCodesFile(codes: readonly string[], email: string, date = new Date()): string {
  return [
    'Uonify · Códigos de recuperación',
    `Cuenta: ${email}`,
    `Generados: ${date.toISOString().slice(0, 10)}`,
    '',
    'Cada código sirve una sola vez. Guárdalos en un lugar seguro.',
    '',
    ...codes,
    '',
  ].join('\n');
}

export const SIGN_IN_METHOD_LABELS: Readonly<Record<SignInMethodId, string>> = {
  chatgpt: 'ChatGPT',
  google: 'Google',
  email: 'Correo con código',
};

/** Solo se puede desvincular un método si queda otro para entrar. */
export function canUnlink(methods: ReadonlyArray<{ id: SignInMethodId; linked: boolean }>, id: SignInMethodId): boolean {
  const linked = methods.filter(method => method.linked);
  return linked.some(method => method.id === id) && linked.length > 1;
}

// Destinos admitidos al vincular o conectar con un proveedor real (nunca una URL cualquiera).
const PROVIDER_HOSTS = [
  'chatgpt.com',
  'auth.openai.com',
  'accounts.google.com',
  'sellercentral.amazon.es',
  'sellercentral-europe.amazon.com',
  'sellercentral.amazon.com',
];

/** URL de autorización segura: del mismo origen o de un proveedor conocido por HTTPS. */
export function isAllowedAuthUrl(value: string, origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin): boolean {
  try {
    const url = new URL(value, origin);
    if (url.origin === origin) return true;
    return url.protocol === 'https:' && PROVIDER_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/** Nombre legible de una sesión: «Chrome en macOS». */
export function sessionLabel(session: { browser: string; os: string }): string {
  return `${session.browser} en ${session.os}`;
}
