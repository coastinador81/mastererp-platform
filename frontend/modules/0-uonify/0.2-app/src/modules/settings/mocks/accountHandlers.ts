import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { ENDPOINTS } from '../api/endpoints';
import { AVATAR_MAX_BYTES, avatarProblem, NAME_MAX } from '../model/account';
import { isEmail } from '../model/format';
import type { Account, AccountPatch } from '../model/types';
import { fileToDataUrl, mockCodeIsValid, readJson, text } from './helpers';
import { accountRecord, pendingEmailRecord, signInMethodsRecord } from './store';

/**
 * Cuenta (/api/account):
 *
 *   GET    /account                 200 → Account
 *   PATCH  /account                 { name?, language?, timeZone? } → Account · 400 invalid_name | unsupported_language | invalid_time_zone
 *   POST   /account/avatar          multipart «file» (JPG, PNG o WEBP ≤ 2 MB) → { avatarUrl } · 400 invalid_image · 413 image_too_large
 *   DELETE /account/avatar          → { avatarUrl: null }
 *   POST   /account/email/start     { email } → { sentTo, resendInSec, expiresInSec } · 400 invalid_email · 409 same_email · 429 rate_limited
 *   POST   /account/email/confirm   { code } → Account · 400 no_pending | invalid_code
 */
const RESEND_SEC = 60;
const EXPIRES_SEC = 600;

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const accountHandlers = [
  http.get(mock(ENDPOINTS.account), async () => {
    await latency(250);
    return HttpResponse.json(accountRecord.get());
  }),

  http.patch(mock(ENDPOINTS.account), async ({ request }) => {
    await latency(400);
    const body = await readJson<AccountPatch>(request);
    const patch: Partial<Account> = {};
    if (body.name !== undefined) {
      const name = text(body.name);
      if (!name || name.length > NAME_MAX) return fail(400, 'Escribe un nombre de 1 a 80 caracteres.', 'invalid_name');
      patch.name = name;
    }
    if (body.language !== undefined) {
      if (body.language !== 'es-ES') return fail(400, 'De momento Uonify solo está en español.', 'unsupported_language');
      patch.language = body.language;
    }
    if (body.timeZone !== undefined) {
      const zone = text(body.timeZone);
      if (!zone || !validTimeZone(zone)) return fail(400, 'Esa zona horaria no existe.', 'invalid_time_zone');
      patch.timeZone = zone;
    }
    return HttpResponse.json(accountRecord.update(current => ({ ...current, ...patch })));
  }),

  http.post(mock(ENDPOINTS.accountAvatar), async ({ request }) => {
    await latency(600);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof Blob)) return fail(400, 'Elige una imagen para tu foto.', 'invalid_image');
    const problem = avatarProblem({ type: file.type, size: file.size });
    if (problem) return file.size > AVATAR_MAX_BYTES ? fail(413, problem, 'image_too_large') : fail(400, problem, 'invalid_image');
    const avatarUrl = await fileToDataUrl(file);
    accountRecord.update(current => ({ ...current, avatarUrl }));
    return HttpResponse.json({ avatarUrl });
  }),

  http.delete(mock(ENDPOINTS.accountAvatar), async () => {
    await latency(300);
    accountRecord.update(current => ({ ...current, avatarUrl: null }));
    return HttpResponse.json({ avatarUrl: null });
  }),

  http.post(mock(ENDPOINTS.accountEmailStart), async ({ request }) => {
    await latency(500);
    const email = text((await readJson<{ email: string }>(request)).email).toLowerCase();
    if (!isEmail(email)) return fail(400, 'Escribe un correo electrónico válido.', 'invalid_email');
    if (email === accountRecord.get().email.toLowerCase()) return fail(409, 'Ese ya es el correo de tu cuenta.', 'same_email');
    const pending = pendingEmailRecord.get();
    const waited = pending ? (Date.now() - pending.sentAt) / 1000 : Infinity;
    if (pending && pending.email === email && waited < RESEND_SEC) {
      const retryAfterSec = Math.ceil(RESEND_SEC - waited);
      return HttpResponse.json({ error: 'rate_limited', message: `Espera ${retryAfterSec} s para pedir otro código.`, retryAfterSec }, { status: 429 });
    }
    pendingEmailRecord.set({ email, sentAt: Date.now() });
    return HttpResponse.json({ sentTo: email, resendInSec: RESEND_SEC, expiresInSec: EXPIRES_SEC });
  }),

  http.post(mock(ENDPOINTS.accountEmailConfirm), async ({ request }) => {
    await latency(500);
    const pending = pendingEmailRecord.get();
    if (!pending || Date.now() - pending.sentAt > EXPIRES_SEC * 1000) return fail(400, 'El código ha caducado. Pide uno nuevo.', 'no_pending');
    const { code } = await readJson<{ code: string }>(request);
    if (!mockCodeIsValid(code)) return fail(400, 'El código no es correcto. Revisa el correo e inténtalo de nuevo.', 'invalid_code');
    pendingEmailRecord.set(null);
    signInMethodsRecord.update(methods => methods.map(method => (method.id === 'email' && method.linked ? { ...method, email: pending.email } : method)));
    return HttpResponse.json(accountRecord.update(current => ({ ...current, email: pending.email })));
  }),
];
