/**
 * Acceso del equipo: solo correos del dominio de la empresa (servidor de correo propio
 * de Uonify), un código enviado al correo y la verificación en dos pasos.
 */
export const COMPANY_DOMAIN = 'uonify.com';

/** Minúsculas y sin espacios alrededor. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

/**
 * Correo de empresa: parte local válida y dominio exacto «uonify.com» (ni subdominios
 * ni dominios que solo lo contienen, como «uonify.com.otro.es»).
 */
export function isCompanyEmail(value: string): boolean {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at <= 0 || email.indexOf('@') !== at) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return domain === COMPANY_DOMAIN && LOCAL_PART.test(local) && !local.includes('..');
}

/** Error que se enseña bajo el campo, o null si el correo sirve. */
export function companyEmailError(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return 'Escribe tu correo de empresa.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Escribe un correo válido.';
  if (!isCompanyEmail(email)) return `Solo se puede entrar con un correo @${COMPANY_DOMAIN}.`;
  return null;
}

/** Código de 6 cifras (correo y aplicación de autenticación); admite espacios al pegar. */
export function cleanCode(value: string): string {
  return value.replace(/\s+/g, '');
}

export function isSixDigitCode(value: string): boolean {
  return /^\d{6}$/.test(cleanCode(value));
}

/** Código de recuperación: 8 caracteres en dos grupos («K7QD-M2XP»). */
export function normalizeRecoveryCode(value: string): string {
  const compact = value.replace(/[\s-]+/g, '').toUpperCase();
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

export function isRecoveryCode(value: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeRecoveryCode(value));
}

/** «laura@uonify.com» → «l••••@uonify.com». */
export function maskEmail(value: string): string {
  const email = normalizeEmail(value);
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email[0]}${'•'.repeat(Math.max(3, Math.min(6, at - 1)))}${email.slice(at)}`;
}
