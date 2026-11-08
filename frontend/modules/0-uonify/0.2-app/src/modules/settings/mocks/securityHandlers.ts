import { http } from 'msw';
import { uid } from '@/shared/lib';
import { fail, HttpResponse, latency, mock } from '@/shared/mocks/utils';
import { ENDPOINTS } from '../api/endpoints';
import { canUnlink, generateRecoveryCodes, maskPhone, smsRateLimit, retryText } from '../model/security';
import type { MfaActivation, SignInMethodId } from '../model/types';
import { mfaStatus, mockCodeIsValid, nowIso, readJson, text } from './helpers';
import { pseudoQrDataUrl, randomBase32 } from './qr';
import { accountRecord, connectionsRecord, mfaRecord, sessionsStore, signInMethodsRecord, type MfaState } from './store';

/**
 * Seguridad (/api/security). La simulación acepta cualquier código de 6 cifras
 * salvo «000000» (código incorrecto).
 *
 *   GET    /security/mfa                      → MfaStatus
 *   POST   /security/mfa/totp/setup           → { setupId, secret, otpauthUrl, qrDataUrl } · 409 already_enabled
 *   POST   /security/mfa/totp/verify          { setupId, code } → { status, recoveryCodes? } · 400 setup_expired | invalid_code
 *   DELETE /security/mfa/totp                 → MfaStatus · 409 mfa_required_by_amazon
 *   POST   /security/mfa/sms/start            { phone (E.164) } → { setupId, phoneMasked, resendInSec } · 400 invalid_phone · 429 rate_limited { retryAfterSec }
 *   POST   /security/mfa/sms/verify           { setupId, code } → { status, recoveryCodes? }
 *   DELETE /security/mfa/sms                  → MfaStatus · 409 mfa_required_by_amazon
 *   POST   /security/mfa/recovery-codes       → { status, recoveryCodes } (invalida los anteriores) · 409 mfa_disabled
 *   GET    /security/sessions                 → { sessions }
 *   DELETE /security/sessions/:id             → { ok } · 400 current_session · 404
 *   DELETE /security/sessions                 → { ok, ended } (todas, también la actual)
 *   GET    /security/sign-in-methods          → { methods }
 *   POST   /security/sign-in-methods/:id      → real: { authUrl } (ChatGPT o Google) · simulado: { methods } · 409 already_linked
 *   DELETE /security/sign-in-methods/:id      → { methods } · 409 last_method
 *
 * Los códigos de recuperación (10) solo se devuelven al activar el primer método o al regenerarlos.
 */
const RESEND_SEC = 60;
const INVALID_CODE = 'El código no es correcto. Comprueba que es el último y vuelve a probar.';

function activation(state: MfaState, firstFactor: boolean): MfaActivation {
  if (!firstFactor) return { status: mfaStatus(state) };
  const codes = generateRecoveryCodes();
  const next = mfaRecord.set({ ...state, recovery: { codes, used: 0, generatedAt: nowIso() } });
  return { status: mfaStatus(next), recoveryCodes: codes };
}

/** Quitar el último segundo paso no se permite con Amazon conectado (lo exige Amazon). */
function blocksLastFactor(state: MfaState, removing: 'totp' | 'sms'): boolean {
  const remaining = removing === 'totp' ? state.sms.enabled : state.totp.enabled;
  return !remaining && connectionsRecord.get().amazon.status === 'connected';
}

function afterRemoval(state: MfaState): MfaState {
  const anyLeft = state.totp.enabled || state.sms.enabled;
  return anyLeft ? state : { ...state, recovery: { codes: [], used: 0, generatedAt: null } };
}

const AMAZON_NEEDS_MFA = 'Amazon exige la verificación en dos pasos mientras tu cuenta esté conectada. Desconecta Amazon antes de desactivarla.';

const mfaHandlers = [
  http.get(mock(ENDPOINTS.mfa), async () => {
    await latency(250);
    return HttpResponse.json(mfaStatus());
  }),

  http.post(mock(ENDPOINTS.totpSetup), async () => {
    await latency(450);
    const state = mfaRecord.get();
    if (state.totp.enabled) return fail(409, 'La app de autenticación ya está activada.', 'already_enabled');
    const secret = randomBase32();
    const setupId = uid('totp');
    mfaRecord.set({ ...state, pendingTotp: { setupId, secret } });
    const label = encodeURIComponent(`Uonify:${accountRecord.get().email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=Uonify&digits=6&period=30`;
    return HttpResponse.json({ setupId, secret, otpauthUrl, qrDataUrl: pseudoQrDataUrl(secret) });
  }),

  http.post(mock(ENDPOINTS.totpVerify), async ({ request }) => {
    await latency(500);
    const { setupId, code } = await readJson<{ setupId: string; code: string }>(request);
    const state = mfaRecord.get();
    if (!state.pendingTotp || state.pendingTotp.setupId !== setupId) return fail(400, 'La configuración ha caducado. Vuelve a empezar.', 'setup_expired');
    if (!mockCodeIsValid(code)) return fail(400, INVALID_CODE, 'invalid_code');
    const firstFactor = !state.totp.enabled && !state.sms.enabled;
    const next = mfaRecord.set({ ...state, totp: { enabled: true, secret: state.pendingTotp.secret, addedAt: nowIso() }, pendingTotp: null });
    return HttpResponse.json(activation(next, firstFactor));
  }),

  http.delete(mock(ENDPOINTS.totp), async () => {
    await latency(400);
    const state = mfaRecord.get();
    if (!state.totp.enabled) return HttpResponse.json(mfaStatus(state));
    if (blocksLastFactor(state, 'totp')) return fail(409, AMAZON_NEEDS_MFA, 'mfa_required_by_amazon');
    const next = mfaRecord.set(afterRemoval({ ...state, totp: { enabled: false, secret: null, addedAt: null } }));
    return HttpResponse.json(mfaStatus(next));
  }),

  http.post(mock(ENDPOINTS.smsStart), async ({ request }) => {
    await latency(500);
    const phone = text((await readJson<{ phone: string }>(request)).phone).replace(/\s/g, '');
    if (!/^\+\d{8,15}$/.test(phone)) return fail(400, 'Escribe un número de móvil válido, con su prefijo.', 'invalid_phone');
    const state = mfaRecord.get();
    const decision = smsRateLimit(state.smsSentAt);
    if (!decision.allowed) {
      const message = decision.reason === 'interval'
        ? `Espera ${retryText(decision.retryAfterSec)} para pedir otro código.`
        : `Has pedido demasiados códigos por SMS. Podrás pedir otro en ${retryText(decision.retryAfterSec)}.`;
      return HttpResponse.json({ error: 'rate_limited', message, retryAfterSec: decision.retryAfterSec }, { status: 429 });
    }
    const setupId = state.pendingSms?.phone === phone ? state.pendingSms.setupId : uid('sms');
    mfaRecord.set({ ...state, pendingSms: { setupId, phone }, smsSentAt: [...state.smsSentAt, Date.now()].slice(-20) });
    return HttpResponse.json({ setupId, phoneMasked: maskPhone(phone), resendInSec: RESEND_SEC });
  }),

  http.post(mock(ENDPOINTS.smsVerify), async ({ request }) => {
    await latency(500);
    const { setupId, code } = await readJson<{ setupId: string; code: string }>(request);
    const state = mfaRecord.get();
    if (!state.pendingSms || state.pendingSms.setupId !== setupId) return fail(400, 'El código ha caducado. Pide uno nuevo.', 'setup_expired');
    if (!mockCodeIsValid(code)) return fail(400, INVALID_CODE, 'invalid_code');
    const firstFactor = !state.totp.enabled && !state.sms.enabled;
    const next = mfaRecord.set({ ...state, sms: { enabled: true, phone: state.pendingSms.phone, addedAt: nowIso() }, pendingSms: null });
    return HttpResponse.json(activation(next, firstFactor));
  }),

  http.delete(mock(ENDPOINTS.sms), async () => {
    await latency(400);
    const state = mfaRecord.get();
    if (!state.sms.enabled) return HttpResponse.json(mfaStatus(state));
    if (blocksLastFactor(state, 'sms')) return fail(409, AMAZON_NEEDS_MFA, 'mfa_required_by_amazon');
    const next = mfaRecord.set(afterRemoval({ ...state, sms: { enabled: false, phone: null, addedAt: null } }));
    return HttpResponse.json(mfaStatus(next));
  }),

  http.post(mock(ENDPOINTS.recoveryCodes), async () => {
    await latency(450);
    const state = mfaRecord.get();
    if (!state.totp.enabled && !state.sms.enabled) return fail(409, 'Activa antes la verificación en dos pasos.', 'mfa_disabled');
    return HttpResponse.json(activation(state, true));
  }),
];

const sessionHandlers = [
  http.get(mock(ENDPOINTS.sessions), async () => {
    await latency(300);
    const sessions = sessionsStore.all().map(session => (session.current ? { ...session, lastActiveAt: nowIso() } : session));
    return HttpResponse.json({ sessions });
  }),

  http.delete(mock('/security/sessions/:id'), async ({ params }) => {
    await latency(400);
    const session = sessionsStore.get(String(params.id));
    if (!session) return fail(404, 'Esa sesión ya no existe.', 'not_found');
    if (session.current) return fail(400, 'Para cerrar esta sesión, usa «Cerrar sesión» en el menú de tu cuenta.', 'current_session');
    sessionsStore.remove(session.id);
    return HttpResponse.json({ ok: true });
  }),

  http.delete(mock(ENDPOINTS.sessions), async () => {
    await latency(500);
    const ended = sessionsStore.all().length;
    sessionsStore.all().forEach(session => sessionsStore.remove(session.id));
    return HttpResponse.json({ ok: true, ended });
  }),
];

const METHOD_IDS: readonly SignInMethodId[] = ['chatgpt', 'google', 'email'];
const isMethod = (value: unknown): value is SignInMethodId => METHOD_IDS.includes(value as SignInMethodId);

const methodHandlers = [
  http.get(mock(ENDPOINTS.signInMethods), async () => {
    await latency(250);
    return HttpResponse.json({ methods: signInMethodsRecord.get() });
  }),

  http.post(mock('/security/sign-in-methods/:id'), async ({ params }) => {
    await latency(700);
    const id = params.id;
    if (!isMethod(id)) return fail(404, 'Esa forma de entrar no existe.', 'not_found');
    const methods = signInMethodsRecord.get();
    if (methods.find(method => method.id === id)?.linked) return fail(409, 'Ya está vinculada.', 'already_linked');
    const email = accountRecord.get().email;
    const next = signInMethodsRecord.set(methods.map(method => (method.id === id ? { ...method, linked: true, email, linkedAt: nowIso() } : method)));
    return HttpResponse.json({ methods: next });
  }),

  http.delete(mock('/security/sign-in-methods/:id'), async ({ params }) => {
    await latency(400);
    const id = params.id;
    if (!isMethod(id)) return fail(404, 'Esa forma de entrar no existe.', 'not_found');
    const methods = signInMethodsRecord.get();
    if (!canUnlink(methods, id)) return fail(409, 'Necesitas al menos una forma de entrar en Uonify.', 'last_method');
    const next = signInMethodsRecord.set(methods.map(method => (method.id === id ? { ...method, linked: false, email: null, linkedAt: null } : method)));
    return HttpResponse.json({ methods: next });
  }),
];

export const securityHandlers = [...mfaHandlers, ...sessionHandlers, ...methodHandlers];
