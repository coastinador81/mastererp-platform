import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Referencia que siempre apunta al último valor: sirve para leer props actuales
 * desde temporizadores o listeners globales sin volver a engancharlos.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
