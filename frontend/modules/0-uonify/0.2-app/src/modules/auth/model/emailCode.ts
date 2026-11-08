/**
 * Acceso con el correo y un código de 6 dígitos (sin contraseña). Reglas comunes
 * al formulario y a la simulación del backend.
 */
export const CODE_LENGTH = 6;
/** Segundos hasta poder pedir otro código. */
export const RESEND_SECONDS = 30;
/** Vigencia de cada código. */
export const CODE_TTL_SECONDS = 600;
/** Intentos por código; al agotarlos hay que pedir otro. */
export const MAX_CODE_ATTEMPTS = 5;
/** Códigos por correo en la ventana de envíos (enviar correos cuesta y se puede abusar). */
export const MAX_CODES_PER_WINDOW = 5;
export const CODE_WINDOW_SECONDS = 900;

/** Deja solo los dígitos (acepta el código pegado con espacios o guiones). */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export const isCompleteCode = (value: unknown): value is string => typeof value === 'string' && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value);

/** «0:30», «1:05». */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** Segundos que faltan hasta `at` (ms), nunca negativos. */
export const secondsUntil = (at: number, now: number = Date.now()): number => Math.max(0, Math.ceil((at - now) / 1000));

/** Errores del backend del acceso por correo ({ error, message } + datos). */
export type EmailErrorCode =
  | 'invalid_email'
  | 'invalid_code'
  | 'code_expired'
  | 'code_not_found'
  | 'too_many_attempts'
  | 'too_many_codes'
  | 'resend_too_soon';

export interface EmailErrorData {
  error?: unknown;
  attemptsLeft?: unknown;
  retryAfterSeconds?: unknown;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function minutesText(seconds: number): string {
  if (seconds < 60) return plural(Math.max(1, Math.ceil(seconds)), 'segundo', 'segundos');
  return plural(Math.ceil(seconds / 60), 'minuto', 'minutos');
}

/** Mensaje claro para cada error; `fallback` si no se reconoce (p. ej. sin red). */
export function emailErrorMessage(data: EmailErrorData | null | undefined, fallback: string): string {
  const code = typeof data?.error === 'string' ? data.error : '';
  const attemptsLeft = typeof data?.attemptsLeft === 'number' ? data.attemptsLeft : null;
  const retry = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null;
  switch (code as EmailErrorCode) {
    case 'invalid_email':
      return 'Introduce un correo electrónico válido.';
    case 'invalid_code':
      return attemptsLeft !== null && attemptsLeft > 0
        ? `El código no es correcto. Te ${attemptsLeft === 1 ? 'queda 1 intento' : `quedan ${attemptsLeft} intentos`}.`
        : 'El código no es correcto. Pide un código nuevo.';
    case 'code_expired':
      return 'El código ha caducado. Pide uno nuevo.';
    case 'code_not_found':
      return 'Este código ya no es válido. Pide uno nuevo.';
    case 'too_many_attempts':
      return 'Has agotado los intentos para este código. Pide uno nuevo.';
    case 'too_many_codes':
      return `Has pedido demasiados códigos. Inténtalo de nuevo dentro de ${minutesText(retry ?? CODE_WINDOW_SECONDS)}.`;
    case 'resend_too_soon':
      return `Espera ${minutesText(retry ?? RESEND_SECONDS)} para pedir otro código.`;
    default:
      return fallback;
  }
}

/** Errores tras los que el código actual ya no sirve y hay que pedir otro. */
export function codeIsDead(data: EmailErrorData | null | undefined): boolean {
  const code = typeof data?.error === 'string' ? data.error : '';
  if (code === 'invalid_code') return data?.attemptsLeft === 0;
  return code === 'code_expired' || code === 'code_not_found' || code === 'too_many_attempts';
}
