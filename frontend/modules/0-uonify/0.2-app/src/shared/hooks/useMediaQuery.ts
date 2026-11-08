import { useCallback, useSyncExternalStore } from 'react';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Si la consulta de medios se cumple ahora; se actualiza al cambiar. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => matches(query), () => false);
}

function subscribeRootMotion(notify: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
  return () => observer.disconnect();
}

const rootReducesMotion = () => typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'true';

/**
 * Movimiento reducido: la preferencia del sistema o la de la cuenta
 * (`:root[data-reduce-motion="true"]`, como en el prototipo).
 */
export function useReducedMotion(): boolean {
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  const account = useSyncExternalStore(subscribeRootMotion, rootReducesMotion, () => false);
  return system || account;
}
