import { USE_MOCKS } from '@/shared/api/config';
import { create } from 'zustand';
import {
  initialWorkspace,
  newThreadId,
  readSavedWorkspace,
  saveWorkspace,
  threadTitle,
  type ChatMessage,
  type Thread,
  type WorkspaceData,
} from '../model/workspaceState';
import type { ServiceId } from '../model/services';

/**
 * Datos del espacio (hilos y panel de conversación), guardados en
 * sessionStorage como el PROTO («uonify-home-workspace-v1»). Al cargar se aplican
 * las reglas de recarga: solo vuelven los datos duraderos.
 */
export interface WorkspaceStore extends WorkspaceData {
  historyAccount: string | null;
  historyEpoch: number;
  historyRevision: number;
  historyLoading: boolean;
  historyError: boolean;
  historySnapshot: object | null;
  retryHistory: (() => void) | null;
  /** Hilos Live locales retenidos hasta que un GET del historial confirme su fila. */
  pendingLiveThreadIds: string[];
  boundLiveThreadIds: string[];
  setActiveThread(id: string | null): void;
  setConversationExpanded(expanded: boolean): void;
  setChatPanelCollapsed(collapsed: boolean): void;
  setChatPanelWidth(width: number | null): void;
  createThread(input: { title: string; service: ServiceId | null; view: string; id?: string; pendingLiveBind?: boolean }): Thread;
  markLiveThreadBound(id: string): void;
  discardPendingLiveThread(id: string): void;
  updateThread(id: string, patch: Partial<Pick<Thread, 'service' | 'view' | 'title'>>): void;
  pushMessage(threadId: string, message: ChatMessage): void;
  insertLiveUserMessage(threadId: string, message: ChatMessage, anchorIndex: number,
    laterTurnIds?: readonly string[], replyTurnIds?: readonly string[]): number | null;
  insertLiveAssistantMessage(threadId: string, message: ChatMessage, userTurnId: string): number | null;
  insertLiveAssistantAfterPending(threadId: string, message: ChatMessage, anchorIndex: number, laterTurnIds: readonly string[]): number | null;
  suppressLiveAssistantReplies(threadId: string, userTurnId: string): void;
  consumeFormOpening(threadId: string, messageIndex: number, formId: string): void;
  /**
   * Retira el último mensaje de la persona que Uony no llegó a recibir (límite de
   * ChatGPT). Un hilo que se queda vacío desaparece. Devuelve true si lo quitó.
   */
  withdrawLastMessage(threadId: string, keepEmpty?: boolean): boolean;
}

function dataOf(state: WorkspaceData): WorkspaceData {
  return {
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    activeProjectId: state.activeProjectId,
    conversationExpanded: state.conversationExpanded,
    chatPanelCollapsed: state.chatPanelCollapsed,
    chatPanelWidth: state.chatPanelWidth,
  };
}

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  ...(USE_MOCKS ? readSavedWorkspace() : initialWorkspace()),
  historyAccount: null, historyEpoch: 0, historyRevision: 0, historyLoading: false, historyError: false, historySnapshot: null, retryHistory: null,
  pendingLiveThreadIds: [], boundLiveThreadIds: [],
  setActiveThread: id => set({ activeThreadId: id }),
  setConversationExpanded: expanded => set({ conversationExpanded: expanded }),
  setChatPanelCollapsed: collapsed => set({ chatPanelCollapsed: collapsed }),
  setChatPanelWidth: width => set({ chatPanelWidth: width }),
  createThread({ title, service, view, id, pendingLiveBind }) {
    const thread: Thread = { id: id ?? newThreadId(), title: threadTitle(title), service, view, projectId: id ? null : get().activeProjectId, messages: [] };
    set(state => ({ threads: [...state.threads, thread], activeThreadId: thread.id,
      pendingLiveThreadIds: pendingLiveBind ? [...state.pendingLiveThreadIds, thread.id] : state.pendingLiveThreadIds }));
    return thread;
  },
  markLiveThreadBound(id) {
    set(state => ({ boundLiveThreadIds: state.pendingLiveThreadIds.includes(id)
      ? [...state.boundLiveThreadIds.filter(threadId => threadId !== id), id] : state.boundLiveThreadIds }));
  },
  discardPendingLiveThread(id) {
    set(state => {
      if (!state.pendingLiveThreadIds.includes(id)) return state;
      const thread = state.threads.find(item => item.id === id);
      const discard = thread && thread.messages.length === 0;
      return { pendingLiveThreadIds: state.pendingLiveThreadIds.filter(threadId => threadId !== id),
        boundLiveThreadIds: state.boundLiveThreadIds.filter(threadId => threadId !== id),
        threads: discard ? state.threads.filter(item => item.id !== id) : state.threads,
        activeThreadId: discard && state.activeThreadId === id ? null : state.activeThreadId };
    });
  },
  updateThread(id, patch) {
    set(state => ({ threads: state.threads.map(thread => (thread.id === id ? { ...thread, ...patch } : thread)) }));
  },
  pushMessage(threadId, message) {
    set(state => {
      const thread = state.threads.find(item => item.id === threadId);
      if (!thread || (message.turnId && thread.messages.some(item =>
        item.role === message.role && item.turnId === message.turnId))) return state;
      return { threads: state.threads.map(item => item.id === threadId
        ? { ...item, messages: [...item.messages, message] } : item) };
    });
  },
  insertLiveUserMessage(threadId, message, anchorIndex, laterTurnIds = [], replyTurnIds = []) {
    let insertedIndex: number | null = null;
    set(state => {
      const thread = state.threads.find(item => item.id === threadId);
      if (!thread || message.role !== 'user' || !message.turnId || thread.messages.some(item =>
        item.role === 'user' && item.turnId === message.turnId)) return state;
      const nextUser = thread.messages.findIndex(item => item.role === 'user' && !!item.turnId
        && laterTurnIds.includes(item.turnId));
      const firstReply = thread.messages.findIndex(item => item.role === 'assistant' && !!item.turnId
        && replyTurnIds.includes(item.turnId));
      const index = firstReply >= 0 ? firstReply
        : nextUser >= 0 ? nextUser : Math.max(0, Math.min(anchorIndex, thread.messages.length));
      insertedIndex = index;
      return { threads: state.threads.map(item => item.id === threadId
        ? { ...item, messages: [...item.messages.slice(0, index), message, ...item.messages.slice(index)] }
        : item) };
    });
    return insertedIndex;
  },
  insertLiveAssistantMessage(threadId, message, userTurnId) {
    let insertedIndex: number | null = null;
    set(state => {
      const thread = state.threads.find(item => item.id === threadId);
      if (!thread || message.role !== 'assistant' || !message.turnId || thread.messages.some(item =>
        item.role === 'assistant' && item.turnId === message.turnId)) return state;
      const userIndex = thread.messages.findIndex(item => item.role === 'user' && item.turnId === userTurnId);
      if (userIndex < 0) return state;
      const nextUser = thread.messages.findIndex((item, index) => index > userIndex && item.role === 'user');
      const index = nextUser >= 0 ? nextUser : thread.messages.length;
      insertedIndex = index;
      return { threads: state.threads.map(item => item.id === threadId
        ? { ...item, messages: [...item.messages.slice(0, index), message, ...item.messages.slice(index)] }
        : item) };
    });
    return insertedIndex;
  },
  insertLiveAssistantAfterPending(threadId, message, anchorIndex, laterTurnIds) {
    let insertedIndex: number | null = null;
    set(state => {
      const thread = state.threads.find(item => item.id === threadId);
      if (!thread || message.role !== 'assistant' || !message.turnId || thread.messages.some(item =>
        item.role === 'assistant' && item.turnId === message.turnId)) return state;
      const nextUser = thread.messages.findIndex(item => item.role === 'user' && !!item.turnId
        && laterTurnIds.includes(item.turnId));
      const index = nextUser >= 0 ? nextUser : Math.max(0, Math.min(anchorIndex, thread.messages.length));
      insertedIndex = index;
      return { threads: state.threads.map(item => item.id === threadId
        ? { ...item, messages: [...item.messages.slice(0, index), message, ...item.messages.slice(index)] }
        : item) };
    });
    return insertedIndex;
  },
  suppressLiveAssistantReplies(threadId, userTurnId) {
    set(state => {
      const thread = state.threads.find(item => item.id === threadId);
      if (!thread?.messages.some(message => message.role === 'assistant' && !!message.turnId
        && !message.requestId && message.replyToTurnId === userTurnId && !message.supersededByHandoff)) return state;
      return { threads: state.threads.map(item => item.id === threadId ? { ...item,
        messages: item.messages.map(message => message.role === 'assistant' && !!message.turnId
          && !message.requestId && message.replyToTurnId === userTurnId
          ? { ...message, supersededByHandoff: true } : message) } : item) };
    });
  },
  consumeFormOpening(threadId, messageIndex, formId) {
    set(state => {
      const thread = state.threads.find(item => item.id === threadId);
      const entry = thread?.messages[messageIndex];
      if (!entry?.conversationFormFresh || entry.conversationForm?.id !== formId) return state;
      return { threads: state.threads.map(item => item.id === threadId ? { ...item,
        messages: item.messages.map((message, index) => index === messageIndex ? { ...message, conversationFormFresh: false } : message),
      } : item) };
    });
  },
  withdrawLastMessage(threadId, keepEmpty = false) {
    const thread = get().threads.find(item => item.id === threadId);
    if (!thread || thread.messages.at(-1)?.role !== 'user') return false;
    const messages = thread.messages.slice(0, -1);
    if (messages.length || keepEmpty) {
      set(state => ({ threads: state.threads.map(item => (item.id === threadId ? { ...item, messages } : item)) }));
      return true;
    }
    set(state => ({
      threads: state.threads.filter(item => item.id !== threadId),
      activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
      conversationExpanded: state.activeThreadId === threadId ? false : state.conversationExpanded,
    }));
    return true;
  },
}));

// Cada cambio se guarda entero, como `save()` del PROTO.
useWorkspaceStore.subscribe(state => { if (USE_MOCKS) saveWorkspace(dataOf(state)); });
useWorkspaceStore.subscribe((state, previous) => {
  if (state.threads !== previous.threads && state.historyEpoch === previous.historyEpoch) {
    useWorkspaceStore.setState({ historyRevision: previous.historyRevision + 1 });
  }
});

// Otra cuenta en este navegador (auth lo avisa y borra la clave): el espacio empieza de cero.
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => resetWorkspaceStore());

export function activeThreadOf(state: Pick<WorkspaceData, 'threads' | 'activeThreadId'>): Thread | null {
  return state.threads.find(thread => thread.id === state.activeThreadId) ?? null;
}

/** Solo para pruebas: vuelve al estado de una primera visita (o al guardado). */
export function resetWorkspaceStore(fromStorage = false): void {
  useWorkspaceStore.setState({ ...(fromStorage ? readSavedWorkspace() : initialWorkspace()),
    historyAccount: null, historyEpoch: useWorkspaceStore.getState().historyEpoch + 1,
    historyRevision: 0, historyLoading: false, historyError: false, historySnapshot: null, retryHistory: null,
    pendingLiveThreadIds: [], boundLiveThreadIds: [] });
}
