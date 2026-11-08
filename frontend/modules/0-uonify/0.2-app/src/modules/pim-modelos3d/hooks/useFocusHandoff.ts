import { useCallback, useLayoutEffect, useRef, type FocusEvent } from 'react';

/**
 * Al cambiar entre el bloque del modelo y el estado vacío, el control con el
 * foco desaparece: si el foco estaba en esa zona, pasa a la acción equivalente
 * («Descargar GLB» o la primera acción disponible del estado vacío), como el
 * renderMain del prototipo.
 */
export function useFocusHandoff(mode: 'block' | 'empty') {
  const ref = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const firstRun = useRef(true);

  const onFocus = useCallback(() => { hadFocus.current = true; }, []);
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    // Sin destino (el control se quitó del documento) se conserva la marca.
    if (next && !event.currentTarget.contains(next)) hadFocus.current = false;
  }, []);

  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const zone = ref.current;
    if (!zone || !hadFocus.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && zone.contains(active)) return;
    if (active && active !== document.body) return;
    const target = mode === 'block'
      ? zone.querySelector<HTMLElement>('[data-m3d-action="download"]')
      : zone.querySelector<HTMLElement>('.pim-modelos3d-empty-actions button:not(:disabled)');
    target?.focus({ preventScroll: true });
  }, [mode]);

  return { ref, onFocus, onBlur };
}
