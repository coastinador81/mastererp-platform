import { http } from 'msw';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { cleanCode, COMPANY_DOMAIN, isCompanyEmail, isRecoveryCode, isSixDigitCode, maskEmail, normalizeEmail, normalizeRecoveryCode } from '../model/email';
import type { AdminSession, EmailChallenge, MfaChallenge } from '../model/types';
import {
  CODE_MINUTES,
  currentMember,
  db,
  findMember,
  logAudit,
  MAX_ATTEMPTS,
  newId,
  RESEND_SECONDS,
  SESSION_HOURS,
  sixDigits,
  type ChallengeRecord,
} from './adminDb';

/**
 * Acceso del equipo (/api/admin/auth/*): correo @uonify.com → código por correo (lo
 * envía el servidor de correo propio de Uonify) → verificación en dos pasos (aplicación
 * de autenticación o código de recuperación) → cookie de sesión del panel.
 * Para no revelar quién es del equipo, un correo del dominio que no está dado de alta
 * recibe la misma respuesta, pero ningún código sirve.
 */
const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const expired = (iso: string) => new Date(iso).getTime() < Date.now();

function challengePayload(challenge: ChallengeRecord): EmailChallenge {
  const member = findMember(challenge.email);
  return {
    challengeId: challenge.id,
    maskedEmail: maskEmail(challenge.email),
    expiresAt: challenge.expiresAt,
    resendAfter: RESEND_SECONDS,
    // Solo la simulación enseña el código: el backend lo envía por correo.
    preview: {
      message: member
        ? `Tu código es ${challenge.code}.`
        : 'Este correo no está en el equipo. Usa tu correo de Uonify.',
    },
  };
}

function wrongCode(challenge: ChallengeRecord) {
  const attempts = challenge.attempts + 1;
  db.challenges.patch(challenge.id, { attempts });
  const left = MAX_ATTEMPTS - attempts;
  if (left <= 0) {
    db.challenges.patch(challenge.id, { stage: 'used' });
    return fail(429, 'Has superado el número de intentos. Vuelve a empezar para recibir un código nuevo.', 'too_many_attempts');
  }
  return fail(400, `El código no es correcto. Te quedan ${left} ${left === 1 ? 'intento' : 'intentos'}.`, 'invalid_code');
}

export const authHandlers = [
  http.get(mock('/admin/auth/session'), async () => {
    await latency(150);
    const member = currentMember();
    // Modo local/desarrollo: acceso simple por contraseña (el backend real lo dicta por flag).
    const body: AdminSession = {
      authMode: 'password',
      passwordLogin: true,
      ...(member ? { authenticated: true, member, expiresAt: db.session.get().expiresAt ?? undefined } : { authenticated: false }),
    };
    return HttpResponse.json(body);
  }),

  // Acceso simple local/desarrollo: correo de empresa + contraseña, sin código ni 2FA.
  http.post(mock('/admin/auth/password'), async ({ request }) => {
    const data = await readJson(request);
    const email = normalizeEmail(str(data.email));
    const password = str(data.password);
    await latency(500);
    const member = findMember(email);
    // Modo local: cualquier contraseña no vacía vale para un miembro del equipo.
    if (!member || !password) return fail(401, 'Correo o contraseña incorrectos.', 'invalid_credentials');
    const expiresAt = minutesFromNow(SESSION_HOURS * 60);
    db.session.set({ email: member.email, expiresAt });
    logAudit(member, 'admin.signin', { type: 'sesion', id: member.email, label: 'Panel de administración' }, { detail: 'Acceso simple (correo + contraseña, modo local)' });
    const session: AdminSession = { authenticated: true, member, expiresAt };
    return HttpResponse.json(session);
  }),

  http.post(mock('/admin/auth/email/start'), async ({ request }) => {
    const email = normalizeEmail(str((await readJson(request)).email));
    await latency(600);
    if (!isCompanyEmail(email)) {
      return fail(400, `Solo puede entrar el equipo de Uonify, con su correo @${COMPANY_DOMAIN}.`, 'domain_not_allowed');
    }
    const challenge: ChallengeRecord = {
      id: newId('chl'),
      email,
      code: sixDigits(),
      expiresAt: minutesFromNow(CODE_MINUTES),
      resendAt: minutesFromNow(RESEND_SECONDS / 60),
      attempts: 0,
      stage: 'email',
    };
    db.challenges.upsert(challenge);
    return HttpResponse.json(challengePayload(challenge));
  }),

  http.post(mock('/admin/auth/email/resend'), async ({ request }) => {
    const challenge = db.challenges.get(str((await readJson(request)).challengeId));
    await latency(400);
    if (!challenge || challenge.stage !== 'email') return fail(404, 'Vuelve a empezar para recibir un código nuevo.', 'challenge_not_found');
    if (!expired(challenge.resendAt)) return fail(429, 'Espera unos segundos antes de pedir otro código.', 'resend_too_soon');
    const next = db.challenges.patch(challenge.id, {
      code: sixDigits(),
      attempts: 0,
      expiresAt: minutesFromNow(CODE_MINUTES),
      resendAt: minutesFromNow(RESEND_SECONDS / 60),
    });
    return HttpResponse.json(challengePayload(next ?? challenge));
  }),

  http.post(mock('/admin/auth/email/verify'), async ({ request }) => {
    const body = await readJson(request);
    const challenge = db.challenges.get(str(body.challengeId));
    const code = cleanCode(str(body.code));
    await latency(500);
    if (!challenge || challenge.stage !== 'email') return fail(404, 'Vuelve a empezar para recibir un código nuevo.', 'challenge_not_found');
    if (expired(challenge.expiresAt)) return fail(410, 'El código ha caducado. Pide uno nuevo.', 'code_expired');
    if (!isSixDigitCode(code)) return fail(400, 'El código tiene 6 cifras.', 'invalid_code');
    const member = findMember(challenge.email);
    if (!member || code !== challenge.code) return wrongCode(challenge);
    const mfaCode = sixDigits();
    const recoveryCode = normalizeRecoveryCode(Math.random().toString(36).slice(2, 10).padEnd(8, '7'));
    db.challenges.patch(challenge.id, { stage: 'mfa', attempts: 0, mfaCode, recoveryCode, expiresAt: minutesFromNow(CODE_MINUTES) });
    const payload: MfaChallenge = {
      mfaChallengeId: challenge.id,
      methods: ['totp', 'recovery'],
      preview: { message: `Código de autenticación: ${mfaCode}. Código de recuperación: ${recoveryCode}.` },
    };
    return HttpResponse.json(payload);
  }),

  http.post(mock('/admin/auth/mfa/verify'), async ({ request }) => {
    const body = await readJson(request);
    const challenge = db.challenges.get(str(body.mfaChallengeId));
    const method = str(body.method) === 'recovery' ? 'recovery' : 'totp';
    const raw = str(body.code);
    await latency(500);
    if (!challenge || challenge.stage !== 'mfa') return fail(404, 'Vuelve a empezar para entrar en el panel.', 'challenge_not_found');
    if (expired(challenge.expiresAt)) return fail(410, 'Ha pasado demasiado tiempo. Vuelve a empezar.', 'code_expired');
    const member = findMember(challenge.email);
    const ok = method === 'totp'
      ? isSixDigitCode(raw) && cleanCode(raw) === challenge.mfaCode
      : isRecoveryCode(raw) && normalizeRecoveryCode(raw) === challenge.recoveryCode;
    if (!member || !ok) return wrongCode(challenge);
    db.challenges.patch(challenge.id, { stage: 'used' });
    const expiresAt = minutesFromNow(SESSION_HOURS * 60);
    db.session.set({ email: member.email, expiresAt });
    logAudit(member, 'admin.signin', { type: 'sesion', id: member.email, label: 'Panel de administración' }, method === 'recovery' ? { detail: 'Con un código de recuperación' } : {});
    const session: AdminSession = { authenticated: true, member, expiresAt };
    return HttpResponse.json(session);
  }),

  http.post(mock('/admin/auth/logout'), async () => {
    await latency(200);
    const member = currentMember();
    if (member) logAudit(member, 'admin.signout', { type: 'sesion', id: member.email, label: 'Panel de administración' });
    db.session.set({ email: null, expiresAt: null });
    return HttpResponse.json({ ok: true });
  }),
];
