import { create } from 'zustand';
import { EMPTY_FILTERS, invalidRange, type PurchaseFilters } from '../model/demoPurchases';

interface ListFilters {
  /** Lo que muestran los controles. */
  draft: PurchaseFilters;
  /** Lo que filtra la lista: un rango de fechas invertido no se aplica, como en la demo. */
  applied: PurchaseFilters;
}

interface FinanceFiltersState {
  /** Por apartado (solicitudes-compra, ordenes-compra…). */
  lists: Record<string, ListFilters>;
  setFilters: (list: string, next: PurchaseFilters) => void;
  reset: () => void;
}

const EMPTY_LIST: ListFilters = { draft: EMPTY_FILTERS, applied: EMPTY_FILTERS };

/**
 * Búsqueda y filtros de cada lista de Finanzas en memoria mientras la pestaña siga abierta,
 * como los del catálogo de Producto (useCatalogStore): se conservan al abrir una ficha y
 * al salir de ERP; cada apartado tiene los suyos.
 */
export const useFinanceFilters = create<FinanceFiltersState>(set => ({
  lists: {},
  setFilters: (list, next) => set(state => {
    const current = state.lists[list] ?? EMPTY_LIST;
    const updated = invalidRange(next) ? { ...current, draft: next } : { draft: next, applied: next };
    return { lists: { ...state.lists, [list]: updated } };
  }),
  reset: () => set({ lists: {} }),
}));

/** Filtros de una lista (los de partida si aún no se han tocado). */
export const useListFilters = (list: string): ListFilters => useFinanceFilters(state => state.lists[list] ?? EMPTY_LIST);
