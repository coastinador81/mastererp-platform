/**
 * Movimiento del espacio (app-shell.js, `reduceMotion` y `playEnter`): cada cambio
 * de pantalla entra con el mismo efecto sutil (fundido, leve subida y enfoque);
 * otro producto o pestaña, con uno más ligero. Nada se mueve si la persona pidió
 * menos movimiento (ajuste del sistema o preferencia de Uonify).
 */
export const PREFERENCES_STORAGE_KEY = 'uonify-preferences';

export type EnterVariant = 'uon-enter' | 'uon-enter-side' | 'uon-enter-soft' | 'uon-reply-text' | 'uon-reply-card';
const ENTER_VARIANTS: EnterVariant[] = ['uon-enter', 'uon-enter-side', 'uon-enter-soft', 'uon-reply-text', 'uon-reply-card'];

function readPreferences(): { reduceMotion?: unknown; contrast?: unknown } | null {
  try {
    return JSON.parse(sessionStorage.getItem(PREFERENCES_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function reduceMotion(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true') return true;
  return readPreferences()?.reduceMotion === true;
}

/**
 * Las preferencias de Uonify (guardadas en la portada) también se aplican tras
 * recargar el espacio, donde la portada no se ejecuta.
 */
export function applyStoredPreferences(): void {
  const preferences = readPreferences();
  if (!preferences) return;
  document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion === true);
  document.documentElement.dataset.moreContrast = String(preferences.contrast === true);
}

export function playEnter(element: Element | null | undefined, variant: EnterVariant = 'uon-enter'): void {
  if (!element || reduceMotion()) return;
  element.classList.remove(...ENTER_VARIANTS);
  void (element as HTMLElement).offsetWidth; // reinicia la animación
  element.classList.add(variant);
  const done = (event?: Event) => {
    if (event && event.target !== element) return;
    element.classList.remove(variant);
    element.removeEventListener('animationend', done);
  };
  element.addEventListener('animationend', done);
  setTimeout(done, 700); // una pestaña en segundo plano no ejecuta la animación
}
