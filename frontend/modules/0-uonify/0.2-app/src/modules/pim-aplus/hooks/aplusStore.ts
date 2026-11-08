import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AplusDocument, AplusModule } from '../model/types';

/**
 * Estado de la pestaña A+ montada (el `state` de APlusContentInterface). Un almacén
 * zustand por montaje: los componentes leen solo lo que pintan y las operaciones
 * asíncronas (cargar, guardar, subir) leen siempre el estado vigente.
 */
export interface AplusState {
  modules: AplusModule[];
  /** Cargando desde Amazon (bloquea Recargar, el selector y el guardado). */
  loading: boolean;
  /** Guardando o publicando. */
  publishing: boolean;
  brand: string;
  hasUnsavedChanges: boolean;
  availableDocuments: AplusDocument[];
  selectedDocumentKey: string;
  /** Documento que se está cargando desde el selector (A08). */
  pendingDocumentKey: string | null;
  isLinkedToAsin: boolean;
}

export type AplusStore = StoreApi<AplusState>;

export const initialAplusState = (): AplusState => ({
  modules: [],
  loading: false,
  publishing: false,
  brand: '',
  hasUnsavedChanges: false,
  availableDocuments: [],
  selectedDocumentKey: '',
  pendingDocumentKey: null,
  isLinkedToAsin: false,
});

export function createAplusStore(): AplusStore {
  return createStore<AplusState>()(() => initialAplusState());
}
