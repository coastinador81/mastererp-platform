import { create } from 'zustand';
import { useWorkspaceStore } from './workspaceStore';
import {
  clampEffort,
  DISMISSED_SUGGESTIONS_KEY,
  normalizePreferences,
  PREFERENCES_KEY,
  readJSON,
  saveJSON,
  type EffortId,
  type Speed,
} from '../model/composerOptions';

/**
 * Estado del compositor. Vive fuera del componente porque el compositor cambia de
 * sitio (inicio, conversación, panel lateral, dentro de Producto) y en React eso
 * lo vuelve a montar: el texto, los adjuntos y los menús no deben perderse
 * (en el PROTO se movía el mismo nodo del DOM).
 */
export type Picker = 'model' | 'effort' | null;
export type ListeningMode = 'dictate' | 'talk' | null;
export interface ProductLinkDraft {
  text: string;
  sku: string;
  revision: number;
  account: string;
  threadId: string | null;
  requestId?: string;
  expectedVersion?: number;
}

export interface ComposerState {
  draft: string;
  productLink: ProductLinkDraft | null;
  attachments: File[];
  status: string;
  /** Hilo desde el que se originó el aviso del compositor; null indica aviso general. */
  statusThreadId: string | null;
  /** Errores terminales de Uony: cada hilo conserva el suyo al cambiar de conversación. */
  threadStatuses: Record<string, string>;
  model: string;
  effort: EffortId;
  speed: Speed;
  picker: Picker;
  usageOpen: boolean;
  moreOpen: boolean;
  listening: ListeningMode;
  microphoneMuted: boolean;
  speakerMuted: boolean;
  dismissedSuggestions: string[];
  /** Petición de foco al texto (se atiende al pintar, aunque se vuelva a montar). */
  focusTick: number;
  /** El foco estaba en el compositor cuando se desmontó. */
  hadFocus: boolean;
  setDraft(text: string): void;
  prepareProductLink(link: ProductLinkDraft): void;
  setStatus(message: string, threadId?: string | null): void;
  setThreadStatus(threadId: string, message: string): void;
  clearThreadStatus(threadId: string): void;
  setModel(model: string): void;
  setEffort(effort: EffortId): void;
  toggleSpeed(): void;
  setPicker(picker: Picker): void;
  setUsageOpen(open: boolean): void;
  setMoreOpen(open: boolean): void;
  addAttachments(files: File[]): void;
  removeAttachment(index: number): void;
  setListening(mode: ListeningMode): void;
  dismissSuggestion(id: string): void;
  requestFocus(): void;
}

const saved = normalizePreferences(readJSON(PREFERENCES_KEY, {}));

function persist(state: Pick<ComposerState, 'model' | 'effort' | 'speed'>): void {
  saveJSON(PREFERENCES_KEY, { model: state.model, effort: state.effort, speed: state.speed });
}

export const useComposerStore = create<ComposerState>()((set, get) => ({
  draft: '',
  productLink: null,
  attachments: [],
  status: '',
  statusThreadId: null,
  threadStatuses: {},
  model: saved.model,
  effort: saved.effort,
  speed: saved.speed,
  picker: null,
  usageOpen: false,
  moreOpen: false,
  listening: null,
  microphoneMuted: false,
  speakerMuted: false,
  dismissedSuggestions: readJSON<string[]>(DISMISSED_SUGGESTIONS_KEY, []),
  focusTick: 0,
  hadFocus: false,
  setDraft: draft => set({ draft, productLink: null }),
  prepareProductLink: productLink => set({ draft: productLink.text, productLink }),
  setStatus: (status, threadId = useWorkspaceStore.getState().activeThreadId) => set({
    status, statusThreadId: status ? threadId : null,
  }),
  setThreadStatus: (threadId, message) => set(state => ({ threadStatuses: { ...state.threadStatuses, [threadId]: message } })),
  clearThreadStatus: threadId => set(state => {
    if (!(threadId in state.threadStatuses)) return state;
    const threadStatuses = { ...state.threadStatuses };
    delete threadStatuses[threadId];
    return { threadStatuses };
  }),
  setModel(model) {
    set({ model, effort: clampEffort(model, get().effort) });
    persist(get());
  },
  setEffort(effort) {
    set({ effort: clampEffort(get().model, effort) });
    persist(get());
  },
  toggleSpeed() {
    set({ speed: get().speed === 'fast' ? 'standard' : 'fast' });
    persist(get());
  },
  setPicker: picker => set({ picker }),
  setUsageOpen: usageOpen => set({ usageOpen }),
  setMoreOpen: moreOpen => set({ moreOpen }),
  addAttachments: files => set({ attachments: [...get().attachments, ...files] }),
  removeAttachment: index => set({ attachments: get().attachments.filter((_, i) => i !== index) }),
  setListening: listening => set({ listening }),
  dismissSuggestion(id) {
    const dismissed = [...new Set([...readJSON<string[]>(DISMISSED_SUGGESTIONS_KEY, []), id])];
    saveJSON(DISMISSED_SUGGESTIONS_KEY, dismissed);
    set({ dismissedSuggestions: dismissed });
  },
  requestFocus: () => set({ focusTick: get().focusTick + 1 }),
}));

export function visibleComposerStatus(state: Pick<ComposerState, 'status' | 'statusThreadId' | 'threadStatuses'>,
  threadId: string | null): string {
  if (state.status && (state.statusThreadId === null || state.statusThreadId === threadId)) return state.status;
  return threadId ? state.threadStatuses[threadId] ?? '' : '';
}

useWorkspaceStore.subscribe((state, previous) => {
  if (state.historyEpoch !== previous.historyEpoch || state.historyAccount !== previous.historyAccount) {
    useComposerStore.setState({ status: '', statusThreadId: null, threadStatuses: {} });
    return;
  }
  if (state.threads === previous.threads) return;
  const removed = new Set(previous.threads.map(thread => thread.id));
  state.threads.forEach(thread => removed.delete(thread.id));
  if (!removed.size) return;
  useComposerStore.setState(current => {
    const threadStatuses = { ...current.threadStatuses };
    removed.forEach(id => { delete threadStatuses[id]; });
    return { threadStatuses, ...(current.statusThreadId && removed.has(current.statusThreadId)
      ? { status: '', statusThreadId: null } : {}) };
  });
});

/**
 * Vuelve a leer las opciones de IA y las sugerencias quitadas de sessionStorage. La
 * portada (módulo public-site) usa las mismas claves y se llega al espacio sin
 * recargar: sin esto, el espacio mostraría lo que había al cargar la página.
 */
export function syncComposerFromStorage(): void {
  const stored = normalizePreferences(readJSON(PREFERENCES_KEY, {}));
  useComposerStore.setState({
    model: stored.model,
    effort: stored.effort,
    speed: stored.speed,
    dismissedSuggestions: readJSON<string[]>(DISMISSED_SUGGESTIONS_KEY, []),
  });
}

/** Opciones de IA con las que se envía un mensaje (PROTO: `getPreferences()`). */
export function getAiPreferences(): { model: string; effort: EffortId; speed: Speed } {
  const { model, effort, speed } = useComposerStore.getState();
  return { model, effort, speed };
}

/** Hay un menú del compositor abierto (modelo, esfuerzo, uso o «+»). */
export function composerPopupOpen(): boolean {
  const state = useComposerStore.getState();
  return state.picker !== null || state.usageOpen || state.moreOpen;
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  useComposerStore.setState({ draft: '', productLink: null, attachments: [], status: '', statusThreadId: null,
    threadStatuses: {}, picker: null, usageOpen: false,
    moreOpen: false, listening: null, hadFocus: false });
});
