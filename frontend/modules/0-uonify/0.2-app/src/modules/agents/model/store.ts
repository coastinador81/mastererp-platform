import { create } from 'zustand';
import type { AgentMode } from './catalog';

/** Borrador de un agente personalizado creado con el asistente (en memoria de la sesión). */
export interface AgentDraft {
  id: string;
  name: string;
  mode: AgentMode;
  module: string;
  goal: string;
  tone: string;
  knowledge: string[];
  integrations: string[];
  approvals: string[];
  createdAt: number;
}

export type NewDraft = Omit<AgentDraft, 'id' | 'createdAt'>;

interface AgentsState {
  drafts: AgentDraft[];
  /** Integraciones cuya activación se ha solicitado en esta sesión. */
  requested: string[];
  addDraft: (draft: NewDraft) => AgentDraft;
  requestActivation: (id: string) => void;
}

const slug = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';

export const useAgentsStore = create<AgentsState>((set, get) => ({
  drafts: [],
  requested: [],
  addDraft: draft => {
    const taken = new Set(get().drafts.map(item => item.id));
    const base = slug(draft.name);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    const created: AgentDraft = { ...draft, id, createdAt: Date.now() };
    set(state => ({ drafts: [created, ...state.drafts] }));
    return created;
  },
  requestActivation: id => set(state => (state.requested.includes(id) ? state : { requested: [...state.requested, id] })),
}));

export const findDraft = (drafts: readonly AgentDraft[], id: string | undefined) => drafts.find(item => item.id === id) ?? null;
