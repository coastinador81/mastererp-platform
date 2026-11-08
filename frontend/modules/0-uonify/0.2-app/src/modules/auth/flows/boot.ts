import { authReturnError, isAuthReturn, isPlanGrantReturn, planGrantReturnError, RETURN_ERROR_FALLBACK } from '../model/authUrl';
import { patchSignIn } from '../state/authUi';
import { ensureSession } from '../state/session';
import { finishAccess, openSignInDialog } from './access';
import { HOME_PATH, navigation } from './navigation';
import { setPendingProfileStatus, showProfile } from './profile';
import { finishReadingTransition, hideWorkspaceTransition, showTransition } from './transition';
import { recoverPendingAccountDeletion } from './pendingAccountDeletion';

/**
 * Arranque del acceso, una vez por carga de página (prototipo: final de
 * auth-ui.js). Resuelve la sesión y atiende la vuelta de OpenAI o Google
 * (?auth=return[&error=…]) y la del permiso del plan de ChatGPT (&grant=chatgpt-plan).
 * La redirección de la portada al espacio y la guarda del espacio las hace
 * useAuthRouting en cada cambio de ruta.
 */
let booted = false;

export async function bootAuth(search: string): Promise<void> {
  if (booted) return;
  booted = true;
  const authReturn = isAuthReturn(search);
  if (authReturn) showTransition({ title: 'Preparando tu acceso', copy: 'Recuperando tu cuenta para continuar.' });
  const session = await ensureSession();
  if (recoverPendingAccountDeletion()) return;
  // En la portada, quien tiene el alta a medias la retoma al cargar.
  if (!authReturn && session.authenticated && !session.profileReady && navigation.onHome()) {
    showProfile();
    return;
  }
  if (!authReturn) return;
  if (!(await finishReadingTransition())) return;
  navigation.go(HOME_PATH, { replace: true });
  if (session.authenticated) {
    if (isPlanGrantReturn(search)) setPendingProfileStatus(planGrantReturnError(search));
    await finishAccess();
    return;
  }
  hideWorkspaceTransition();
  openSignInDialog();
  patchSignIn({ status: authReturnError(search) ?? RETURN_ERROR_FALLBACK });
}

/** Solo pruebas. */
export function resetBoot(): void {
  booted = false;
}
