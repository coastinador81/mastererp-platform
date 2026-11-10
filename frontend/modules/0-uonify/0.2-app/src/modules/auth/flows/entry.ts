import { readKey, removeKey, STORAGE_KEYS, writeKey } from '../model/storage';
import { ensureSession } from '../state/session';
import { openSignInDialog } from './access';
import { captureFocus } from './focus';
import { HOME_PATH, navigation } from './navigation';
import { showProfile } from './profile';
import { hideWorkspaceTransition } from './transition';
import { transitionToWorkspace } from './workspace';

/**
 * Puertas de entrada públicas del acceso (prototipo: window.UonifyAuth).
 */
export interface OpenSignInOptions {
  /** Petición actual: vacía descarta la anterior; omitirla conserva la pendiente. */
  prompt?: string;
  /** Servicio pulsado sin sesión (panel «Tu espacio Uonify»): al entrar se abre ese servicio. */
  service?: string;
}

/**
 * «Iniciar sesión», «Ir a mi espacio» o enviar una petición desde la portada
 * (prototipo: continueWithPrompt y .identity-trigger). Sin sesión abre el acceso;
 * con el alta a medias, el alta; con todo listo, la bienvenida al espacio.
 */
export async function openSignIn(options: OpenSignInOptions = {}): Promise<void> {
  captureFocus();
  const text = String(options.prompt ?? '').trim();
  if (options.prompt !== undefined) {
    if (text) writeKey(STORAGE_KEYS.pendingPrompt, text);
    else removeKey(STORAGE_KEYS.pendingPrompt);
  }
  // Manda la última intención: un acceso sin servicio (o con uno no válido) descarta el pendiente.
  if (options.service && /^[a-z-]+$/.test(options.service)) writeKey(STORAGE_KEYS.pendingService, options.service);
  else removeKey(STORAGE_KEYS.pendingService);
  const session = await ensureSession();
  if (!session.authenticated) openSignInDialog({ prompt: text });
  else if (!session.profileReady) showProfile();
  else if (!navigation.onWorkspace()) await transitionToWorkspace();
}

/**
 * Enviar desde el compositor del espacio (prototipo: requirePrompt): solo con la
 * sesión lista se ejecuta `onAuthenticated`.
 */
export async function requirePrompt(prompt: string, onAuthenticated: () => void): Promise<void> {
  const session = await ensureSession();
  if (!session.authenticated) {
    captureFocus();
    openSignInDialog({ prompt });
  } else if (!session.profileReady) {
    const text = String(prompt).trim();
    if (text) writeKey(STORAGE_KEYS.pendingPrompt, text);
    showProfile();
  } else onAuthenticated();
}

/** Guarda del espacio (prototipo: ensureWorkspaceReady). */
export async function ensureWorkspaceReady(): Promise<boolean> {
  const session = await ensureSession();
  if (!session.authenticated) {
    if (navigation.onWorkspace()) navigation.go(HOME_PATH, { replace: true });
    else openSignInDialog();
    return false;
  }
  if (!session.profileReady) {
    hideWorkspaceTransition();
    showProfile();
    return false;
  }
  return true;
}

/** Recoge (y borra) la petición escrita antes de entrar. */
export function readPendingPrompt(): string { return readKey(STORAGE_KEYS.pendingPrompt) || ''; }

export function takePendingPrompt(): string {
  const prompt = readPendingPrompt();
  removeKey(STORAGE_KEYS.pendingPrompt);
  return prompt;
}

/** Solo retirar la copia local después de aceptar la entrega de ese mismo texto. */
export function acknowledgePendingPrompt(prompt: string): void {
  if (readKey(STORAGE_KEYS.pendingPrompt) === prompt) removeKey(STORAGE_KEYS.pendingPrompt);
}
