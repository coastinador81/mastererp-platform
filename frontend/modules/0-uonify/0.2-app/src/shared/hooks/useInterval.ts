import { useEffect } from 'react';
import { useLatest } from './useLatest';

/**
 * Llama a `callback` cada `delay` ms mientras `delay` no sea null
 * (p. ej. consultar el estado de un trabajo cada 5 s y parar al terminar).
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const latest = useLatest(callback);
  useEffect(() => {
    if (delay === null) return undefined;
    const timer = setInterval(() => latest.current(), delay);
    return () => clearInterval(timer);
  }, [delay, latest]);
}

/** Llama una vez a `callback` pasados `delay` ms (se anula al desmontar o con null). */
export function useTimeout(callback: () => void, delay: number | null): void {
  const latest = useLatest(callback);
  useEffect(() => {
    if (delay === null) return undefined;
    const timer = setTimeout(() => latest.current(), delay);
    return () => clearTimeout(timer);
  }, [delay, latest]);
}
