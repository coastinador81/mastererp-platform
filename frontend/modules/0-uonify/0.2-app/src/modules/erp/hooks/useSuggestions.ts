import { useMemo } from 'react';
import { create } from 'zustand';
import { nodeName, type DemoPurchase, type NodeId } from '../model/demoPurchases';
import type { DocumentsList } from '../model/lists';
import { PURCHASES_ROUTE } from '../model/paths';
import { suggestionReference, totalOf, type Proposal, type ProposalDraft, type Stage, type Suggestion } from '../model/suggestions';

interface NodeReview {
  at: string;
  note: string;
  proposal: Proposal;
  original: Proposal;
}

interface SuggestionsState {
  /** Observaciones del Jefe de nodo mientras escribe (antes de su revisión). */
  notes: Record<string, string>;
  /** Borradores de cada revisión: «001:node» o «001:purchasing». */
  drafts: Record<string, ProposalDraft>;
  nodeReviews: Record<string, NodeReview>;
  /** Compras en borrador creadas al aprobar (DEMO-COM-IA-…), primero en la lista de Compras. */
  approved: DemoPurchase[];
  /** Filtros de la lista (Nodo y Aprobación), que se conservan al pasar por el menú. */
  filters: { node: '' | NodeId; stage: '' | Stage };
  setFilters: (patch: Partial<{ node: '' | NodeId; stage: '' | Stage }>) => void;
  setNote: (id: string, note: string) => void;
  setDraft: (key: string, draft: ProposalDraft) => void;
  reviewByNode: (suggestion: Suggestion, proposal: Proposal, original: Proposal) => void;
  approve: (suggestion: Suggestion, final: Proposal & { priority: boolean; purchasingNote: string }) => string | null;
  reset: () => void;
}

export const approvedReference = (id: string): string => `DEMO-COM-IA-${id}`;

/**
 * Las dos revisiones de las sugerencias y sus borradores en Compras, solo en la memoria de
 * esta pestaña, como la demo del equipo (PurchasesPreview.jsx: reviewByNode y
 * approveSuggestion): al recargar se pierde todo y cada sugerencia crea un único borrador.
 */
export const useSuggestions = create<SuggestionsState>((set, get) => ({
  notes: {},
  drafts: {},
  nodeReviews: {},
  approved: [],
  filters: { node: '', stage: '' },
  setFilters: patch => set(state => ({ filters: { ...state.filters, ...patch } })),
  setNote: (id, note) => set(state => ({ notes: { ...state.notes, [id]: note } })),
  setDraft: (key, draft) => set(state => ({ drafts: { ...state.drafts, [key]: draft } })),
  reviewByNode: (suggestion, proposal, original) => set(state => (state.nodeReviews[suggestion.id] ? state : {
    nodeReviews: {
      ...state.nodeReviews,
      [suggestion.id]: { at: new Date().toISOString(), note: state.notes[suggestion.id] ?? '', proposal, original },
    },
  })),
  approve: (suggestion, final) => {
    const state = get();
    const review = state.nodeReviews[suggestion.id];
    if (!review) return null;
    const reference = approvedReference(suggestion.id);
    if (!state.approved.some(row => row.reference === reference)) {
      const proposal = { quantity: final.quantity, price: final.price, supplier: final.supplier };
      const row: DemoPurchase = {
        reference,
        date: '2026-11-08',
        nodeId: suggestion.node,
        node: nodeName(suggestion.node),
        supplier: final.supplier,
        concept: suggestion.product,
        currency: 'VES',
        total: totalOf(proposal),
        status: 'Borrador',
        source: suggestionReference(suggestion),
        fromSuggestion: {
          id: suggestion.id,
          final: proposal,
          original: review.original,
          node: review.proposal,
          priority: final.priority,
          purchasingObservation: final.purchasingNote,
          nodeObservation: review.note,
          nodeReviewedAt: review.at,
          approvedAt: new Date().toISOString(),
        },
      };
      set({ approved: [...state.approved, row] });
    }
    return reference;
  },
  reset: () => set({ notes: {}, drafts: {}, nodeReviews: {}, approved: [], filters: { node: '', stage: '' } }),
}));

/** Etapa de una sugerencia: espera al nodo, espera al Jefe de compras o ya está en Compras. */
export const stageOf = (state: Pick<SuggestionsState, 'nodeReviews' | 'approved'>, id: string): Stage => {
  if (state.approved.some(row => row.source === `DEMO-SUG-${id}`)) return 'completed';
  return state.nodeReviews[id] ? 'purchasing' : 'node';
};

/** Filas de una lista: en Compras, primero los borradores que salen de sugerencias (como la demo). */
export function useListRows(list: DocumentsList | undefined): readonly DemoPurchase[] {
  const approved = useSuggestions(state => state.approved);
  return useMemo(() => {
    if (!list) return [];
    return list.route === PURCHASES_ROUTE ? [...approved, ...list.rows] : list.rows;
  }, [list, approved]);
}
