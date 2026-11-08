import { useEffect } from 'react';
import { useLatest } from './useLatest';

type Target = Window | Document | HTMLElement | null | undefined;

/**
 * Engancha un listener global (teclado, puntero…) y lo suelta al desmontar.
 * El manejador puede cambiar en cada render sin volver a engancharse.
 */
export function useEventListener<K extends keyof WindowEventMap>(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  target?: Target,
  options?: AddEventListenerOptions,
): void;
export function useEventListener(type: string, handler: (event: Event) => void, target?: Target, options?: AddEventListenerOptions): void;
export function useEventListener(type: string, handler: (event: Event) => void, target?: Target, options?: AddEventListenerOptions): void {
  const latest = useLatest(handler);
  const capture = options?.capture ?? false;
  const passive = options?.passive;
  const once = options?.once;
  useEffect(() => {
    const node: Target = target === undefined ? (typeof window === 'undefined' ? null : window) : target;
    if (!node) return undefined;
    const listener = (event: Event) => latest.current(event);
    node.addEventListener(type, listener, { capture, passive, once });
    return () => node.removeEventListener(type, listener, { capture });
  }, [type, target, capture, passive, once, latest]);
}
