import { billingApi } from '@/modules/billing';
import { isPaidPlan } from '../model/plans';
import { delay, nextFrame, timing } from '../model/timing';
import { getUi, patchTransition } from '../state/authUi';
import { currentSession } from '../state/session';
import { navigation, WORKSPACE_PATH } from './navigation';
import {
  clearTransitionTimers,
  failTransition,
  finishReadingTransition,
  revealTransition,
  scheduleTransition,
  setTransitionMessage,
  showTransition,
  transitionVersion,
} from './transition';

/** Logotipo del centro de la capa: se decodifica antes del «Todo listo». */
export const TRANSITION_LOGO = '/assets/brands/uonify-overlay.webp';

function decodeBrand(): Promise<void> {
  const image = new Image();
  image.src = TRANSITION_LOGO;
  return typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve();
}

/**
 * Monta el espacio detrás de la capa (prototipo: UonifyViews.openWorkspace).
 * En React basta con navegar a /espacio y dejar que el router lo pinte.
 */
async function openWorkspace(): Promise<void> {
  if (navigation.onWorkspace()) return;
  navigation.go(WORKSPACE_PATH);
  await navigation.waitFor(() => navigation.onWorkspace(), timing.workspaceTimeout);
  await nextFrame();
  await nextFrame();
}

let workspaceOpening = false;

/**
 * Bienvenida al espacio (prototipo: transitionToWorkspace): tres mensajes de
 * lectura, «Todo listo, Nombre», se abre el espacio detrás y la capa se funde.
 */
export async function transitionToWorkspace(): Promise<void> {
  if (workspaceOpening) return;
  workspaceOpening = true;
  // Tras otro mensaje (acceso o reintento), primero se termina de leer.
  const current = getUi().transition;
  if (current.open && !current.error && !(await finishReadingTransition())) {
    workspaceOpening = false;
    return;
  }
  const expected = showTransition({
    title: 'Preparando tu entorno',
    copy: 'Preparamos tu espacio.',
    kicker: 'TODO EMPIEZA AQUÍ',
    context: 'workspace',
  });
  scheduleTransition(() => setTransitionMessage('Un espacio a tu medida', 'Organizamos tus herramientas.', 1), timing.message);
  scheduleTransition(() => setTransitionMessage('Casi estamos', 'Un momento más.', 2), timing.message * 2);
  let watchdog: number | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      watchdog = window.setTimeout(() => reject(new Error('workspace-timeout')), timing.workspaceTimeout);
    });
    const profile = currentSession().profile;
    const access = profile && isPaidPlan(profile.desiredPlan) ? billingApi.workspaceAccess() : Promise.resolve(null);
    const [, , workspaceAccess] = await Promise.race([Promise.all([decodeBrand(), delay(timing.message * 3), access]), timeout]);
    if (expected !== transitionVersion()) return;
    clearTransitionTimers();
    const firstName = currentSession().profile?.firstName.trim();
    const checkoutRequired = workspaceAccess?.status === 'checkout_required';
    setTransitionMessage(
      checkoutRequired ? 'Cargando pasarela de pago' : firstName ? `Todo listo, ${firstName}` : 'Tu espacio está listo',
      checkoutRequired ? 'Preparamos el pago de tu plan.' : 'Hazlo posible con Uonify.',
      3,
    );
    patchTransition({ ready: true, ...(checkoutRequired ? { kicker: 'TU PLAN UONIFY' } : {}) });
    await delay(timing.ready);
    if (expected !== transitionVersion()) return;
    // El mismo velo sigue hasta el final; el espacio se monta solo en el relevo.
    const opening = openWorkspace();
    opening.catch(() => {}); // si gana el límite, su rechazo posterior no queda suelto
    await Promise.race([opening, timeout]);
    if (expected !== transitionVersion()) return;
    await revealTransition(() => document.getElementById('composer-text')?.focus({ preventScroll: true }), true);
  } catch {
    if (expected !== transitionVersion()) return;
    failTransition('Vamos a intentarlo de nuevo', 'Tu perfil está guardado. No hemos podido abrir el espacio de trabajo.');
  } finally {
    window.clearTimeout(watchdog);
    workspaceOpening = false;
  }
}

/** Solo pruebas. */
export function resetWorkspaceFlow(): void {
  workspaceOpening = false;
}
