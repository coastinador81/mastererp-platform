import { create } from 'zustand';
import type { CategoryTerm, StockData } from '../model/types';

/**
 * Memoria por producto de Atributos que no es una porción compartida del
 * almacén (prototipo: pim/atributos.js, `memory`): el término del buscador de
 * categorías y el stock cargado. En el original vivía en ProductsPIMInterface,
 * fuera de la pestaña, así que sobrevive a un cambio de pestaña.
 */
export interface AtributosMemory {
  categoryTerm: CategoryTerm | null;
  currentStock: StockData | null;
  loadingStock: boolean;
  stockRequested: boolean;
  updatingStock: boolean;
}

export const EMPTY_MEMORY: AtributosMemory = Object.freeze({
  categoryTerm: null,
  currentStock: null,
  loadingStock: false,
  stockRequested: false,
  updatingStock: false,
});

interface MemoryState {
  byKey: Record<string, AtributosMemory>;
  patch(key: string, patch: Partial<AtributosMemory>): void;
  drop(key: string): void;
}

export const useAtributosMemoryStore = create<MemoryState>()(set => ({
  byKey: {},
  patch: (key, patch) => set(state => ({ byKey: { ...state.byKey, [key]: { ...(state.byKey[key] ?? EMPTY_MEMORY), ...patch } } })),
  drop: key => set(state => {
    const next = { ...state.byKey };
    delete next[key];
    return { byKey: next };
  }),
}));

/** Memoria del producto `key` (se actualiza al cambiar). */
export function useAtributosMemory(key: string): AtributosMemory {
  return useAtributosMemoryStore(state => state.byKey[key] ?? EMPTY_MEMORY);
}

/** Lectura y escritura fuera de React (respuestas que llegan tarde). */
export const memory = {
  get: (key: string): AtributosMemory => useAtributosMemoryStore.getState().byKey[key] ?? EMPTY_MEMORY,
  patch: (key: string, patch: Partial<AtributosMemory>) => useAtributosMemoryStore.getState().patch(key, patch),
  drop: (key: string) => useAtributosMemoryStore.getState().drop(key),
  reset: () => useAtributosMemoryStore.setState({ byKey: {} }),
};
