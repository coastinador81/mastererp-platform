import { ApiError } from '@/shared/api/client';
import { startEmailAccess, verifyEmailCode } from '../api/authApi';
import { codeIsDead, emailErrorMessage, isCompleteCode, normalizeCode, type EmailErrorData } from '../model/emailCode';
import { isEmail } from '../model/profile';
import { parseSession } from '../model/session';
import { getUi, patchSignIn, requestFocus } from '../state/authUi';
import { cancelAccessAttempt, completeSignIn, isCurrentAttempt, nextAttempt } from './access';

/**
 * «Continuar con tu correo»: el backend envía un código de 6 dígitos y, si es
 * correcto, abre la sesión. Sin contraseña. Otro código cada 30 s, con límite de
 * intentos y de envíos (el backend manda; aquí se explica cada error).
 */
export const EMAIL_INPUT = '#uon-auth-email';
export const CODE_INPUT = '#uon-auth-code';

const errorData = (error: unknown): EmailErrorData | null =>
  error instanceof ApiError && error.data && typeof error.data === 'object' ? (error.data as EmailErrorData) : null;

/** De las tres formas de entrar al formulario del correo. */
export function openEmailView(): void {
  cancelAccessAttempt();
  patchSignIn({ view: 'email', error: '', status: '', busy: false });
  requestFocus(EMAIL_INPUT);
}

/** «Volver» a las tres formas de entrar. */
export function backToProviders(): void {
  cancelAccessAttempt();
  patchSignIn({ view: 'providers', error: '', busy: false, code: '' });
  requestFocus('[data-auth-provider="email"]');
}

/** «Cambiar correo» desde el paso del código. */
export function changeEmail(): void {
  cancelAccessAttempt();
  patchSignIn({ view: 'email', error: '', busy: false, code: '', previewCode: '' });
  requestFocus(EMAIL_INPUT);
}

/** Envía (o reenvía) el código al correo escrito. */
export async function sendEmailCode(): Promise<void> {
  const state = getUi().signIn;
  if (state.busy) return;
  const email = state.email.trim();
  const target = state.view === 'code' ? CODE_INPUT : EMAIL_INPUT;
  if (!isEmail(email)) {
    patchSignIn({ error: 'Introduce un correo electrónico válido.' });
    requestFocus(EMAIL_INPUT);
    return;
  }
  const attempt = nextAttempt();
  patchSignIn({ busy: true, error: '', email });
  try {
    const result = await startEmailAccess(email);
    if (!isCurrentAttempt(attempt)) return;
    const now = Date.now();
    patchSignIn({
      busy: false,
      view: 'code',
      code: '',
      codeDead: false,
      resendAt: now + Math.max(0, result.resendInSeconds) * 1000,
      expiresAt: now + Math.max(0, result.expiresInSeconds) * 1000,
      previewCode: typeof result.previewCode === 'string' ? result.previewCode : '',
    });
    requestFocus(CODE_INPUT);
  } catch (error) {
    if (!isCurrentAttempt(attempt)) return;
    const data = errorData(error);
    const retry = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 0;
    patchSignIn({
      busy: false,
      error: emailErrorMessage(data, 'No se pudo enviar el código. Inténtalo de nuevo.'),
      ...(retry ? { resendAt: Date.now() + retry * 1000 } : {}),
    });
    requestFocus(target);
  }
}

/** Escribe el código (solo dígitos) y lo comprueba al llegar a 6. */
export function setEmailCode(raw: string): void {
  const code = normalizeCode(raw);
  patchSignIn({ code, error: '' });
  const state = getUi().signIn;
  if (isCompleteCode(code) && !state.busy && !state.codeDead) void verifyCode();
}

/** Comprueba el código; si es correcto, sigue como cualquier otro acceso. */
export async function verifyCode(): Promise<void> {
  const state = getUi().signIn;
  if (state.busy || state.codeDead) return;
  const code = normalizeCode(state.code);
  if (!isCompleteCode(code)) {
    patchSignIn({ error: 'Introduce el código de 6 dígitos.' });
    requestFocus(CODE_INPUT);
    return;
  }
  const attempt = nextAttempt();
  patchSignIn({ busy: true, error: '' });
  try {
    const result = await verifyEmailCode(state.email, code);
    const session = parseSession(result?.session);
    if (!session.authenticated) throw new Error('auth-session-missing');
    if (!isCurrentAttempt(attempt)) return;
    patchSignIn({ busy: false, code: '', previewCode: '' });
    await completeSignIn(session, state.email.trim());
  } catch (error) {
    if (!isCurrentAttempt(attempt)) return;
    const data = errorData(error);
    patchSignIn({
      busy: false,
      code: '',
      codeDead: codeIsDead(data),
      error: emailErrorMessage(data, 'No se pudo comprobar el código. Inténtalo de nuevo.'),
    });
    requestFocus(CODE_INPUT);
  }
}
