import { useEffect, type RefObject } from 'react';
import { useLatest } from '@/shared/hooks';

/**
 * Cierra un menú abierto al pulsar fuera de él (listeners `pointerdown` del
 * documento en el PROTO). `inside` son los elementos que no lo cierran: el
 * propio menú y su botón.
 */
export function useDismissOnPointerDown(active: boolean, inside: RefObject<Element | null>[], onDismiss: () => void): void {
  const latest = useLatest({ inside, onDismiss });
  useEffect(() => {
    if (!active) return undefined;
    const listener = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && latest.current.inside.some(ref => ref.current?.contains(target))) return;
      latest.current.onDismiss();
    };
    document.addEventListener('pointerdown', listener);
    return () => document.removeEventListener('pointerdown', listener);
  }, [active, latest]);
}
