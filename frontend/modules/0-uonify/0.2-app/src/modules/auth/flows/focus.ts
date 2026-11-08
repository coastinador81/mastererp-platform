import { flowActive, getUi, requestFocus, setSurface } from '../state/authUi';

/**
 * Foco y velo entre pasos (prototipo: previousFocus, restoreFocus y el listener
 * «close» de todos los diálogos).
 */
let previousFocus: HTMLElement | null = null;

/** Recuerda quién abrió el acceso para devolverle el foco al cerrar. */
export function captureFocus(trigger?: Element | null): void {
  const active = (trigger ?? document.activeElement) as HTMLElement | null;
  if (!active || active === document.body || !(active instanceof HTMLElement)) return;
  if (!trigger && active.closest('dialog')) return;
  // Desde el menú de cuenta, el foco vuelve al botón de la cuenta (el menú se cierra).
  previousFocus = active.closest('#account-menu') ? document.getElementById('account-button') ?? active : active;
}

/** Oculta el velo si ya no queda ningún paso abierto. */
export function syncSurface(): void {
  const state = getUi();
  if (!flowActive(state) && state.surface.active) setSurface(false);
}

/** Devuelve el foco a quien abrió el acceso, cuando el diálogo ya se ha cerrado. */
export function restoreFocus(): void {
  syncSurface();
  if (previousFocus?.isConnected) requestFocus(previousFocus);
}

/** Solo pruebas. */
export function resetFocus(): void {
  previousFocus = null;
}
