import { USE_MOCKS } from '@/shared/api/config';
import { debounce } from '@/shared/lib';

/**
 * Almacén por producto que comparten las pestañas de la ficha (prototipo:
 * pim/core.js, `UonifyPIM.store`). Clave = SKU del producto ('__new__' para el
 * que se está creando); dentro, una «porción» por tema (`edited`, `bullets`,
 * `images`, `gpsr`, `video`…). Dura la sesión: sessionStorage 'uonify-pim-v1'.
 */
export const PIM_STORE_KEY = 'uonify-pim-v1';
/** Clave del producto que se está creando. */
export const NEW_PRODUCT_KEY = '__new__';

export type PimEntry = Record<string, unknown>;

/** Aviso a los suscriptores: `set` como el prototipo ({ key, slice, value }) + rename/drop/clear. */
export type PimStoreEvent =
  | { type: 'set'; key: string; slice: string; value: unknown }
  | { type: 'rename'; from: string; to: string }
  | { type: 'drop'; key: string }
  | { type: 'clear' };

/** Vista del almacén sobre una clave. Un rename mueve `key` y lo que siga escribiendo cae en el producto nuevo. */
export interface PimScope {
  key: string;
  get<T = unknown>(slice: string, fallback?: T): T;
  set<T>(slice: string, value: T): T;
  update<T>(slice: string, updater: (current: T) => T, fallback?: T): T;
}

export interface PimStore {
  get<T = unknown>(key: string, slice: string, fallback?: T): T;
  set<T>(key: string, slice: string, value: T): T;
  update<T>(key: string, slice: string, updater: (current: T) => T, fallback?: T): T;
  /** Copia de todas las porciones de un producto. */
  all(key: string): PimEntry;
  /** Registro interno de una clave (referencia estable hasta que cambia): para hooks. */
  entry(key: string): PimEntry | undefined;
  /** Mueve el estado del producto nuevo a su SKU al crearlo («Guardar y Crear»). */
  rename(from: string, to: string): void;
  drop(key: string): void;
  /** Vacía todo (cierre de sesión, pruebas). */
  clear(): void;
  subscribe(listener: (event: PimStoreEvent) => void): () => void;
  /** Un único ámbito por clave: pestañas y trabajos en segundo plano lo comparten. */
  scope(key: string): PimScope;
  /** Escribe ya en sessionStorage lo pendiente. */
  flush(): void;
}

export interface PimStoreOptions {
  /** Almacenamiento (sessionStorage por defecto; null = solo memoria). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  storageKey?: string;
  /** Espera antes de escribir (200 ms, como el prototipo). */
  persistDelay?: number;
}

const MAX_SCOPES = 500;

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function createPimStore({ storage = defaultStorage(), storageKey = PIM_STORE_KEY, persistDelay = 200 }: PimStoreOptions = {}): PimStore {
  let memory: Record<string, PimEntry> = {};
  try {
    const raw = storage?.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    memory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, PimEntry>) : {};
  } catch {
    memory = {};
  }
  const listeners = new Set<(event: PimStoreEvent) => void>();
  const liveScopes = new Set<PimScope>();
  const emit = (event: PimStoreEvent) => listeners.forEach(listener => listener(event));
  const persist = debounce(() => {
    try {
      storage?.setItem(storageKey, JSON.stringify(memory));
    } catch {
      /* Las imágenes grandes pueden llenar la cuota: la sesión sigue en memoria. */
    }
  }, persistDelay);

  const store: PimStore = {
    get<T>(key: string, slice: string, fallback?: T): T {
      return (memory[key]?.[slice] ?? fallback) as T;
    },
    set<T>(key: string, slice: string, value: T): T {
      memory = { ...memory, [key]: { ...(memory[key] || {}), [slice]: value } };
      persist();
      emit({ type: 'set', key, slice, value });
      return value;
    },
    update<T>(key: string, slice: string, updater: (current: T) => T, fallback?: T): T {
      return store.set(key, slice, updater(store.get<T>(key, slice, fallback)));
    },
    all: key => ({ ...(memory[key] || {}) }),
    entry: key => memory[key],
    rename(from, to) {
      if (from === to) return;
      if (memory[from]) {
        const { [from]: moved, ...rest } = memory;
        memory = { ...rest, [to]: { ...(memory[to] || {}), ...moved } };
        persist();
      }
      // Una pestaña que sigue trabajando con la clave vieja (p. ej. una petición
      // que termina después de «Guardar y Crear») escribe en su producto.
      liveScopes.forEach(scope => {
        if (scope.key === from) scope.key = to;
      });
      emit({ type: 'rename', from, to });
    },
    drop(key) {
      if (!(key in memory)) return;
      const { [key]: _dropped, ...rest } = memory;
      memory = rest;
      persist();
      emit({ type: 'drop', key });
    },
    clear() {
      memory = {};
      persist();
      emit({ type: 'clear' });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    scope(key) {
      for (const existing of liveScopes) if (existing.key === key) return existing;
      const scope: PimScope = {
        key,
        get: <T>(slice: string, fallback?: T) => store.get<T>(scope.key, slice, fallback),
        set: <T>(slice: string, value: T) => store.set<T>(scope.key, slice, value),
        update: <T>(slice: string, updater: (current: T) => T, fallback?: T) => store.update<T>(scope.key, slice, updater, fallback),
      };
      liveScopes.add(scope);
      if (liveScopes.size > MAX_SCOPES) {
        const oldest = liveScopes.values().next().value;
        if (oldest) liveScopes.delete(oldest);
      }
      return scope;
    },
    flush: () => persist.flush(),
  };
  return store;
}

/** Almacén de la aplicación (uno por pestaña del navegador). */
export const pimStore: PimStore = createPimStore(USE_MOCKS ? {} : { storage: null });
