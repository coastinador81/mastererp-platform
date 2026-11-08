import type { RefObject } from 'react';

/** Después de que React pinte (siguiente fotograma; sin él, en la siguiente vuelta). */
export function afterPaint(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/**
 * Foco dentro de la pestaña tras un cambio (prototipo: pim/video.js, restoreFocus):
 * el primer destino que exista y no esté apagado.
 */
export function focusSoon(root: RefObject<HTMLElement | null>, selectors: string[]): void {
  afterPaint(() => {
    const container = root.current;
    if (!container) return;
    for (const selector of selectors) {
      const target = container.querySelector<HTMLElement>(selector);
      if (target && !(target as HTMLButtonElement).disabled && !target.closest('fieldset:disabled')) {
        target.focus({ preventScroll: true });
        return;
      }
    }
  });
}

/** Selector CSS seguro para un valor de atributo. */
export const attr = (value: string): string =>
  (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));
