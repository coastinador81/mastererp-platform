import { openSignIn, useAuthLinks, useSession, type SessionStatus } from '@/modules/auth';
import { WORKSPACE_PATH } from '../model/views';

/**
 * Único punto de contacto de la web pública con el acceso (módulo auth): estado de
 * la sesión y textos de los accesos (refreshAccount del PROTO). Las guardas de la
 * portada (ocultarla mientras se resuelve y llevar al espacio a quien ya lo tiene)
 * las aplica <AuthDialogs/>.
 */
export function usePublicSession() {
  const { status } = useSession();
  const links = useAuthLinks();
  return { status, links, signedIn: isSignedIn(status) };
}

export const isSignedIn = (status: SessionStatus) => status === 'ready' || status === 'onboarding';

/** «Inicio» de la sesión: el espacio si hay sesión; si no, el destino público. */
export const sessionHomePath = (status: SessionStatus, publicTarget: string) => (isSignedIn(status) ? WORKSPACE_PATH : publicTarget);

/**
 * Abre el acceso de Uonify («Continuar con ChatGPT»). Con una petición, auth la
 * conserva y el espacio la retoma (continueWithPrompt del PROTO); con el alta a
 * medias abre el alta y, con todo listo, la bienvenida al espacio.
 */
export function startAccess(prompt?: string): void {
  void openSignIn(prompt === undefined ? {} : { prompt: prompt.trim() });
}
