import { delay, prefersReducedMotion, timing } from '../model/timing';
import { getUi, patchTransition, patchUi, requestFocus, resetTransition, setSurface, type TransitionContext } from '../state/authUi';
import { syncSurface } from './focus';

/**
 * Capa de transición a pantalla completa (prototipo: #uon-workspace-transition,
 * showTransition, revealTransition…). Cada apertura sube la versión: los pasos
 * programados de una versión anterior se descartan.
 */
let version = 0;
let messageAt = 0;
const timers = new Set<number>();

export const transitionVersion = (): number => version;

export function clearTransitionTimers(): void {
  timers.forEach(timer => window.clearTimeout(timer));
  timers.clear();
}

export function scheduleTransition(callback: () => void, ms: number): void {
  const scheduled = version;
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    if (scheduled === version) callback();
  }, ms);
  timers.add(timer);
}

export function setTransitionMessage(title: string, copy: string, step = 0): void {
  messageAt = performance.now();
  patchTransition({ title, copy, step, messageKey: getUi().transition.messageKey + 1 });
}

function showDelayError(title: string, copy: string): void {
  patchTransition({ error: true, retry: true, cancel: true });
  setTransitionMessage(title, copy);
  requestFocus('#uon-transition-retry');
}

export interface ShowTransitionOptions {
  title: string;
  copy: string;
  kicker?: string;
  context?: TransitionContext;
}

/** Abre la capa (cierra cualquier diálogo) y arma el aviso de espera larga. */
export function showTransition({ title, copy, kicker = 'ACCESO A UONIFY', context = 'access' }: ShowTransitionOptions): number {
  version += 1;
  clearTransitionTimers();
  setSurface(true);
  const wasOpen = getUi().transition.open;
  patchUi({ dialog: null });
  patchTransition({
    open: true,
    visible: wasOpen ? getUi().transition.visible : false,
    ready: false,
    leaving: false,
    error: false,
    context,
    kicker,
    retry: false,
    cancel: false,
  });
  setTransitionMessage(title, copy);
  requestFocus('#uon-transition-title');
  scheduleTransition(() => showDelayError('Lleva más tiempo de lo esperado', 'Puedes volver a intentarlo para continuar.'), timing.watchdog);
  return version;
}

export function hideWorkspaceTransition(): void {
  version += 1;
  clearTransitionTimers();
  resetTransition();
  // Como el evento «close» del prototipo: se comprueba después de que el paso
  // siguiente (si lo hay) haya abierto su diálogo.
  window.setTimeout(syncSurface, 0);
}

/** Espera a que el mensaje actual se haya podido leer. */
export async function finishReadingTransition(expected = version): Promise<boolean> {
  await delay(Math.max(0, timing.message - (performance.now() - messageAt)));
  const current = getUi().transition;
  return expected === version && current.open && !current.error;
}

/**
 * Funde la capa y da paso al siguiente estado. Con `workspace`, el velo se
 * desvanece junto con la capa y el espacio aparece con su animación. Devuelve
 * true si el relevo se completó (no lo interrumpió otra capa).
 */
export async function revealTransition(next?: () => void, workspace = false): Promise<boolean> {
  const expected = version;
  if (!(await finishReadingTransition(expected))) return false;
  if (workspace) patchUi({ surface: { active: true, leaving: true }, revealing: true });
  patchTransition({ leaving: true });
  await delay(prefersReducedMotion() ? timing.leaveReduced : timing.leave);
  if (expected !== version) return false;
  if (!workspace) next?.();
  hideWorkspaceTransition();
  if (workspace) {
    setSurface(false);
    next?.();
  }
  window.setTimeout(() => patchUi({ revealing: false }), timing.reveal);
  return true;
}

/** Muestra el error final con «Intentar de nuevo» y «Volver». */
export function failTransition(title: string, copy: string): void {
  clearTransitionTimers();
  showDelayError(title, copy);
}

/** Solo pruebas. */
export function resetTransitionClock(): void {
  version += 1;
  clearTransitionTimers();
  messageAt = 0;
}
