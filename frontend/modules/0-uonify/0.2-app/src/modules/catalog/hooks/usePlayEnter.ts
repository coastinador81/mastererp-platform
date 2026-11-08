import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useReducedMotion } from '@/shared/hooks';

const VARIANTS = ['uon-enter', 'uon-enter-side', 'uon-enter-soft'] as const;
export type EnterVariant = (typeof VARIANTS)[number];

/** Movimiento reducido del sistema o de las preferencias de Uonify. */
function reduceMotionPreferred(systemReduced: boolean): boolean {
  if (systemReduced || document.documentElement.dataset.reduceMotion === 'true') return true;
  try {
    return (JSON.parse(sessionStorage.getItem('uonify-preferences') || 'null') as { reduceMotion?: boolean } | null)?.reduceMotion === true;
  } catch {
    return false;
  }
}

/**
 * Entrada sutil de un elemento (prototipo: playEnter de app-shell.js): fundido,
 * ligera subida y enfoque. Nada se mueve con movimiento reducido.
 */
export function playEnter(element: HTMLElement | null, variant: EnterVariant = 'uon-enter', reduced = false): void {
  if (!element || reduceMotionPreferred(reduced)) return;
  element.classList.remove(...VARIANTS);
  void element.offsetWidth;
  element.classList.add(variant);
  const done = (event?: AnimationEvent) => {
    if (event && event.target !== element) return;
    element.classList.remove(variant);
    element.removeEventListener('animationend', done);
  };
  element.addEventListener('animationend', done);
  // Una pestaña del navegador en segundo plano no ejecuta la animación.
  window.setTimeout(() => done(), 700);
}

/**
 * La ficha entra al abrirse o cerrarse (el centro), otra ficha o pestaña entra más
 * suave (la ficha entera o solo su superficie).
 */
export function useSheetEnter(center: RefObject<HTMLElement | null>, sheet: string, tab: string): void {
  const reduced = useReducedMotion();
  const last = useRef<{ sheet: string; tab: string } | null>(null);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { sheet, tab };
    if (!before || (before.sheet === sheet && before.tab === tab)) return;
    const root = center.current;
    if (!root) return;
    const opensOrCloses = (before.sheet === 'none') !== (sheet === 'none');
    if (opensOrCloses) playEnter(root, 'uon-enter', reduced);
    else if (sheet !== 'none') {
      const target = before.sheet === sheet ? root.querySelector<HTMLElement>('.product-editor-surface') : root.querySelector<HTMLElement>('.product-editor-layout');
      playEnter(target, 'uon-enter-soft', reduced);
    }
  }, [center, sheet, tab, reduced]);
}
