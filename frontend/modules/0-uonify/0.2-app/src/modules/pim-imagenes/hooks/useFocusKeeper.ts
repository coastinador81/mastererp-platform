import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Mantiene el foco dentro de una región cuando el control que lo tenía se apaga
 * o desaparece (prototipo: focusToken / restoreFocus de pim/imagenes.js, que
 * repintaba con innerHTML). Si el control ya no sirve, el foco va al primero de
 * `fallbackSelector` que esté activo y, si no hay, a la propia región.
 */
export function useFocusKeeper(ref: RefObject<HTMLElement | null>, fallbackSelector?: string): void {
  const tracked = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const onFocusIn = (event: FocusEvent) => {
      tracked.current = event.target instanceof HTMLElement ? event.target : null;
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !root.contains(next)) tracked.current = null;
    };
    // Un clic fuera de la región (aunque no enfoque nada) la suelta, como el
    // prototipo, que solo restauraba si el foco seguía dentro al repintar.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) tracked.current = null;
    };
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [ref]);

  // Tras cada pintado: si el control enfocado se ha apagado o ya no está.
  useLayoutEffect(() => {
    const root = ref.current;
    const element = tracked.current;
    if (!root || !element) return;
    const usable = (node: Element | null): node is HTMLElement =>
      node instanceof HTMLElement && node.isConnected && !(node as HTMLButtonElement).disabled;
    if (usable(element) && root.contains(element)) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== element) {
      // El foco ya está en otro sitio (otra región o un diálogo): no se toca.
      if (!root.contains(active)) tracked.current = null;
      return;
    }
    const fallback = fallbackSelector ? root.querySelector(fallbackSelector) : null;
    const target = usable(fallback) ? fallback : root;
    tracked.current = target === root ? null : target;
    target.focus({ preventScroll: true });
  });
}
