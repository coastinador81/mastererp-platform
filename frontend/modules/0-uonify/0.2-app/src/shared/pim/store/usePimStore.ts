import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useLatest } from '@/shared/hooks';
import { useTabContext } from '../context/PimTabProvider';
import { pimStore, type PimEntry, type PimScope } from './pimStore';

/**
 * Hooks del almacén por producto: vuelven a pintar cuando cambia lo que leen.
 */

const subscribe = (notify: () => void) => pimStore.subscribe(() => notify());

export type SliceSetter<T> = (next: T | ((current: T) => T)) => void;

export interface PimStoreView extends Omit<PimScope, 'key'> {
  key: string;
  /** Todas las porciones del producto (se actualiza al cambiar). */
  values: PimEntry;
  /** Ámbito compartido de la clave (sigue al producto si se renombra). */
  scope: PimScope;
}

/**
 * El producto `key` entero: sus porciones y los métodos del ámbito
 * (para la ficha, la cabecera o «Publicar»).
 */
export function usePimStore(key: string): PimStoreView {
  const entry = useSyncExternalStore(subscribe, () => pimStore.entry(key), () => undefined);
  return useMemo(() => {
    const scope = pimStore.scope(key);
    return { key, scope, get: scope.get, set: scope.set, update: scope.update, values: { ...(entry ?? {}) } };
  }, [key, entry]);
}

/** Una porción de cualquier producto (sin contexto de pestaña). */
export function usePimValue<T>(key: string, slice: string, fallback: T): T {
  const raw = useSyncExternalStore(subscribe, () => pimStore.get<T | undefined>(key, slice), () => undefined);
  return (raw ?? fallback) as T;
}

/**
 * Porción del producto de la pestaña montada, como useState:
 *   const [images, setImages] = usePimSlice<Image[]>('images', []);
 * El setter escribe por el ámbito del producto, así que una respuesta que llega
 * después de «Guardar y Crear» cae en el SKU nuevo (pimStore.rename).
 * `fallback` puede ser un literal nuevo en cada render: no provoca bucles.
 */
export function usePimSlice<T>(slice: string, fallback: T): [T, SliceSetter<T>] {
  const { key } = useTabContext();
  const value = usePimValue<T>(key, slice, fallback);
  const scope = useMemo(() => pimStore.scope(key), [key]);
  const latestFallback = useLatest(fallback);
  const set = useCallback<SliceSetter<T>>(next => {
    if (typeof next === 'function') scope.update<T>(slice, next as (current: T) => T, latestFallback.current);
    else scope.set<T>(slice, next);
  }, [scope, slice, latestFallback]);
  return [value, set];
}

/** Ámbito del producto de la pestaña, para trabajos en segundo plano. */
export function usePimScope(): PimScope {
  const { key } = useTabContext();
  return useMemo(() => pimStore.scope(key), [key]);
}
