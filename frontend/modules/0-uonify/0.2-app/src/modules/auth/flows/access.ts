import { ApiError, errorMessage } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { startOAuthAccess } from '../api/authApi';
import { authReturnUrl, trustedAuthUrl } from '../model/authUrl';
import { parseSession } from '../model/session';
import { readKey, removeKey, STORAGE_KEYS, writeKey } from '../model/storage';
import { delay, timing } from '../model/timing';
import type { AuthSession, OAuthProvider } from '../model/types';
import { getUi, patchConnect, patchSignIn, patchTransition, patchUi, requestFocus, setSurface } from '../state/authUi';
import { currentSession, ensureAuthConfig, setSession } from '../state/session';
import { restoreFocus } from './focus';
import { navigation } from './navigation';
import { showProfile } from './profile';
import { hideWorkspaceTransition, revealTransition, setTransitionMessage, showTransition } from './transition';
import { transitionToWorkspace } from './workspace';
import { recoverPendingAccountDeletion } from './pendingAccountDeletion';

/**
 * Acceso con ChatGPT o Google (prototipo: open, startChatGPT, showPreviewAccount,
 * finishAccess y el formulario #uon-connect-form). Cada intento lleva número:
 * si la persona cierra o vuelve, los pasos pendientes del intento anterior se descartan.
 * La palabra «Conectar» se reserva para el permiso del plan de ChatGPT (requisito de OpenAI).
 */
let accessAttempt = 0;

export const cancelAccessAttempt = (): void => {
  accessAttempt += 1;
};

/** Empieza un intento nuevo (también lo usa el acceso por correo). */
export const nextAttempt = (): number => {
  accessAttempt += 1;
  return accessAttempt;
};

export const isCurrentAttempt = (attempt: number): boolean => attempt === accessAttempt;

interface ProviderCopy {
  title: string;
  copy: string;
  continueTitle: string;
  continueCopy: string;
  error: string;
}

const PROVIDER_COPY: Record<OAuthProvider, ProviderCopy> = {
  chatgpt: {
    title: 'Iniciando sesión con ChatGPT',
    copy: 'Conectamos con tu cuenta.',
    continueTitle: 'Continúa en ChatGPT',
    continueCopy: 'Te llevamos a ChatGPT para confirmar tu cuenta. Después volverás a Uonify.',
    error: 'No se pudo iniciar el acceso con ChatGPT. Inténtalo de nuevo.',
  },
  google: {
    title: 'Iniciando sesión con Google',
    copy: 'Conectamos con tu cuenta.',
    continueTitle: 'Continúa en Google',
    continueCopy: 'Te llevamos a Google para confirmar tu cuenta. Después volverás a Uonify.',
    error: 'No se pudo iniciar el acceso con Google. Inténtalo de nuevo.',
  },
};

/** Abre «Entra en Uonify» (las tres formas de entrar) con la petición pendiente, si la hay. */
export function openSignInDialog({ prompt = '' }: { prompt?: string } = {}): void {
  const request = String(prompt).trim();
  if (request) writeKey(STORAGE_KEYS.pendingPrompt, request);
  const waiting = request || readKey(STORAGE_KEYS.pendingPrompt) || '';
  patchSignIn({ prompt: waiting, status: '', providerDisabled: false, view: 'providers', busy: false, error: '', code: '' });
  setSurface(true);
  patchUi({ dialog: 'signin' });
  requestFocus('[data-auth-provider]');
}

export function closeSignIn(): void {
  cancelAccessAttempt();
  patchSignIn({ busy: false });
  patchUi({ dialog: null });
  restoreFocus();
}

/** Muestra el error de inicio en el diálogo de acceso. */
function failStart(status: string): void {
  hideWorkspaceTransition();
  openSignInDialog();
  patchSignIn({ providerDisabled: false, status });
}

/** Modo demostración: la cuenta se elige sin salir de Uonify (nunca imita la pantalla del proveedor). */
function showPreviewAccount(provider: OAuthProvider): void {
  setSurface(true);
  patchConnect({ email: readKey(STORAGE_KEYS.identity) || '', submitting: false, provider });
  patchUi({ dialog: 'connect' });
  requestFocus('#uon-connect-email');
}

/** «Continuar con ChatGPT» o «Continuar con Google». */
export async function startProvider(provider: OAuthProvider): Promise<void> {
  if (getUi().signIn.providerDisabled) return;
  patchSignIn({ providerDisabled: true, status: '' });
  const attempt = nextAttempt();
  const copy = PROVIDER_COPY[provider];
  showTransition({ title: copy.title, copy: copy.copy });
  const minimum = delay(timing.message);
  try {
    const config = await ensureAuthConfig();
    if (config.mode === 'preview') {
      await minimum;
      if (isCurrentAttempt(attempt)) await revealTransition(() => showPreviewAccount(provider));
      return;
    }
    // start devuelve la URL del proveedor; la vuelta crea la sesión de Uonify y
    // redirige a returnTo. Las credenciales nunca pasan por Uonify.
    const result = await startOAuthAccess(provider, { returnTo: authReturnUrl(window.location.origin) });
    await minimum;
    if (!isCurrentAttempt(attempt)) return;
    const target = trustedAuthUrl(result?.authUrl ?? result?.authorizationUrl, window.location.origin, provider);
    if (!target) throw new Error('auth-url-untrusted');
    setTransitionMessage(copy.continueTitle, copy.continueCopy, 1);
    await delay(timing.message);
    if (!isCurrentAttempt(attempt)) return;
    navigation.hard(target.href);
  } catch (error) {
    await minimum;
    if (!isCurrentAttempt(attempt)) return;
    failStart(error instanceof ApiError ? errorMessage(error, copy.error) : copy.error);
  }
}

export const startChatGPT = (): Promise<void> => startProvider('chatgpt');
export const startGoogle = (): Promise<void> => startProvider('google');

/** X o «Volver» del modo demostración: vuelve al acceso. */
export function backToSignIn(): void {
  cancelAccessAttempt();
  openSignInDialog();
}

/** Escape en el modo demostración: se cierra todo (prototipo: cancel). */
export function cancelConnect(): void {
  cancelAccessAttempt();
  patchUi({ dialog: null });
  restoreFocus();
}

/**
 * Tras cualquier acceso: si cambia la cuenta, se olvida el espacio de la anterior;
 * después, «Preparando tu perfil» y el alta o el espacio.
 */
export async function completeSignIn(session: AuthSession, email: string): Promise<void> {
  if (readKey(STORAGE_KEYS.identity) !== email) {
    removeKey(STORAGE_KEYS.workspace);
    window.dispatchEvent(new CustomEvent('uonify:identity-changed', { detail: { email } }));
  }
  writeKey(STORAGE_KEYS.identity, email);
  setSession(session);
  await finishAccess();
}

/** Envío del modo demostración: el backend (simulado) crea la sesión para ese correo. */
export async function submitIdentity(rawEmail: string): Promise<void> {
  const { submitting, provider } = getUi().connect;
  if (submitting) return;
  const email = rawEmail.trim();
  patchConnect({ submitting: true });
  const attempt = accessAttempt;
  let session: AuthSession;
  try {
    const config = await ensureAuthConfig();
    if (!isCurrentAttempt(attempt)) return;
    if (config.mode !== 'preview') throw new Error('auth-mode-changed');
    const result = await startOAuthAccess(provider, { returnTo: authReturnUrl(window.location.origin), loginHint: email });
    session = parseSession(result?.session);
    if (!session.authenticated) throw new Error('auth-session-missing');
  } catch {
    patchConnect({ submitting: false });
    if (isCurrentAttempt(attempt)) failStart(PROVIDER_COPY[provider].error);
    return;
  }
  patchConnect({ submitting: false });
  if (!isCurrentAttempt(attempt)) return;
  await completeSignIn(session, email);
}

/** «Preparando tu perfil» y después el alta o directamente el espacio. */
export async function finishAccess(): Promise<void> {
  if (recoverPendingAccountDeletion()) return;
  if (!USE_MOCKS && !currentSession().profileReady) {
    hideWorkspaceTransition(); showProfile(); return;
  }
  const attempt = accessAttempt;
  showTransition({ title: 'Preparando tu perfil', copy: 'Recuperamos tus datos.', kicker: 'TU CUENTA UONIFY' });
  await delay(timing.message);
  if (!isCurrentAttempt(attempt)) return;
  if (currentSession().profileReady) {
    await transitionToWorkspace();
    return;
  }
  patchTransition({ ready: true });
  await revealTransition(showProfile);
}

/** «Volver» de la capa: tras un error se recarga el inicio; si no, vuelve el acceso. */
export function cancelTransition(): void {
  cancelAccessAttempt();
  const failed = getUi().transition.error;
  hideWorkspaceTransition();
  patchSignIn({ providerDisabled: false });
  if (failed) navigation.hard('/');
  else openSignInDialog();
}

/** «Intentar de nuevo»: en el espacio se repite la bienvenida; si no, vuelve el acceso. */
export function retryTransition(): void {
  if (getUi().transition.context === 'workspace') {
    void transitionToWorkspace();
    return;
  }
  cancelAccessAttempt();
  hideWorkspaceTransition();
  openSignInDialog();
}

/** Solo pruebas. */
export function resetAccessFlow(): void {
  accessAttempt = 0;
}
