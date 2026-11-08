import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import {
  CODE_LENGTH,
  CODE_TTL_SECONDS,
  CODE_WINDOW_SECONDS,
  isCompleteCode,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_WINDOW,
  RESEND_SECONDS,
} from '../model/emailCode';
import { isEmail } from '../model/profile';
import type { EmailStartResponse } from '../model/types';
import { codeStore, profileKey, signInAs } from './authDb';
import { readJson } from './readJson';

/**
 * Simulación del acceso con correo y código (sin contraseña):
 * - POST /api/auth/email/start  { email }        → envía un código de 6 dígitos (10 min).
 * - POST /api/auth/email/verify { email, code }  → comprueba el código y abre la sesión.
 * Límites: otro código cada 30 s, 5 códigos por correo cada 15 min y 5 intentos por código.
 * Como no se envía ningún correo, el modo demostración devuelve el código (previewCode).
 */
const error = (status: number, code: string, message: string, extra: Record<string, number> = {}) =>
  HttpResponse.json({ error: code, message, ...extra }, { status });

function newCode(): string {
  const digits = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(digits);
  else digits[0] = Math.floor(Math.random() * 1e9);
  return String(digits[0] % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, '0');
}

export const emailHandlers = [
  http.post(mock('/auth/email/start'), async ({ request }) => {
    const body = ((await readJson(request)) ?? {}) as { email?: unknown };
    await latency(600);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isEmail(email)) return fail(400, 'Introduce un correo electrónico válido.', 'invalid_email');
    const now = Date.now();
    const key = profileKey(email);
    const existing = codeStore.get(key);
    const sends = (existing?.sends ?? []).filter(at => now - at < CODE_WINDOW_SECONDS * 1000);
    if (existing && now - existing.lastSentAt < RESEND_SECONDS * 1000) {
      const retryAfterSeconds = Math.ceil((existing.lastSentAt + RESEND_SECONDS * 1000 - now) / 1000);
      return error(429, 'resend_too_soon', 'Espera un poco para pedir otro código.', { retryAfterSeconds });
    }
    if (sends.length >= MAX_CODES_PER_WINDOW) {
      const retryAfterSeconds = Math.ceil((sends[0] + CODE_WINDOW_SECONDS * 1000 - now) / 1000);
      return error(429, 'too_many_codes', 'Has pedido demasiados códigos.', { retryAfterSeconds });
    }
    const code = newCode();
    codeStore.upsert({
      id: key,
      code,
      expiresAt: now + CODE_TTL_SECONDS * 1000,
      attemptsLeft: MAX_CODE_ATTEMPTS,
      lastSentAt: now,
      sends: [...sends, now],
    });
    return HttpResponse.json({
      email,
      expiresInSeconds: CODE_TTL_SECONDS,
      resendInSeconds: RESEND_SECONDS,
      attemptsLeft: MAX_CODE_ATTEMPTS,
      previewCode: code,
    } satisfies EmailStartResponse);
  }),

  http.post(mock('/auth/email/verify'), async ({ request }) => {
    const body = ((await readJson(request)) ?? {}) as { email?: unknown; code?: unknown };
    await latency(500);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isEmail(email)) return fail(400, 'Introduce un correo electrónico válido.', 'invalid_email');
    if (!isCompleteCode(body.code)) return fail(400, 'Introduce el código de 6 dígitos.', 'invalid_request');
    const key = profileKey(email);
    const stored = codeStore.get(key);
    if (!stored?.code) return fail(404, 'Este código ya no es válido.', 'code_not_found');
    if (Date.now() > stored.expiresAt) {
      codeStore.patch(key, { attemptsLeft: 0, expiresAt: 0 });
      return fail(410, 'El código ha caducado.', 'code_expired');
    }
    if (stored.attemptsLeft <= 0) return fail(429, 'Has agotado los intentos para este código.', 'too_many_attempts');
    if (stored.code !== body.code) {
      const attemptsLeft = stored.attemptsLeft - 1;
      codeStore.patch(key, { attemptsLeft });
      return error(400, 'invalid_code', 'El código no es correcto.', { attemptsLeft });
    }
    // Un código solo sirve una vez; se conserva el registro de envíos para los límites.
    codeStore.patch(key, { code: '', attemptsLeft: 0, expiresAt: 0 });
    return HttpResponse.json({ session: signInAs(email, 'email') });
  }),
];
