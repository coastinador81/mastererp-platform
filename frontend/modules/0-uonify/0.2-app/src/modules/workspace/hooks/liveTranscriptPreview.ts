import { create } from 'zustand';

const PREVIEW_IDLE_MS = 8_000;
const TRANSCRIPTION_DELAY_MS = 12_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const timerKey = (threadId: string, role: 'user' | 'assistant', turnId: string) => `${threadId}:${role}:${turnId}`;
const pendingTimerKey = (threadId: string, turnId: string) => `${threadId}:pending:${turnId}`;
function cancelTimer(key: string): void {
  const timer = timers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(key);
}

/** Texto provisional de Live: solo presentación, nunca borrador ni mensaje enviado. */
export interface LiveTranscriptPreview {
  account: string;
  epoch: number;
  threadId: string;
  role: 'user' | 'assistant';
  turnId: string;
  text: string;
  replyToTurnId?: string | null;
}

export interface LivePendingUserTurn {
  account: string;
  epoch: number;
  threadId: string;
  turnId: string;
  anchorIndex: number;
  ended: boolean;
  unavailable?: boolean;
}

interface PreviewState {
  previews: LiveTranscriptPreview[];
  pendingUsers: LivePendingUserTurn[];
  startUser(turn: Omit<LivePendingUserTurn, 'ended'>): void;
  endUser(turn: Omit<LivePendingUserTurn, 'ended'>, onDelayed?: () => void): void;
  rebase(threadId: string, insertedIndex: number, laterTurnIds: readonly string[]): void;
  show(preview: LiveTranscriptPreview): void;
  withdraw(threadId: string, role: LiveTranscriptPreview['role'], turnId: string): void;
  remove(threadId: string, role: LiveTranscriptPreview['role'], turnId: string): void;
  clearAssistant(threadId: string): void;
  clear(): void;
}

export const useLiveTranscriptPreview = create<PreviewState>()((set, get) => ({
  previews: [],
  pendingUsers: [],
  startUser(turn) {
    set(state => ({ pendingUsers: [...state.pendingUsers.filter(item =>
      item.threadId !== turn.threadId || item.turnId !== turn.turnId), { ...turn, ended: false }] }));
  },
  endUser(turn, onDelayed) {
    cancelTimer(timerKey(turn.threadId, 'user', turn.turnId));
    set(state => ({ pendingUsers: state.pendingUsers.some(item =>
      item.threadId === turn.threadId && item.turnId === turn.turnId)
      ? state.pendingUsers.map(item => item.threadId === turn.threadId && item.turnId === turn.turnId
        ? { ...item, ended: true } : item)
      : [...state.pendingUsers, { ...turn, ended: true }] }));
    const key = pendingTimerKey(turn.threadId, turn.turnId);
    cancelTimer(key);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      if (!get().pendingUsers.some(item => item.threadId === turn.threadId && item.turnId === turn.turnId)) return;
      cancelTimer(timerKey(turn.threadId, 'user', turn.turnId));
      set(state => ({ pendingUsers: state.pendingUsers.map(item => item.threadId === turn.threadId
        && item.turnId === turn.turnId ? { ...item, unavailable: true } : item),
      previews: state.previews.filter(item => item.threadId !== turn.threadId || item.role !== 'user'
        || item.turnId !== turn.turnId) }));
      onDelayed?.();
    }, TRANSCRIPTION_DELAY_MS));
  },
  rebase(threadId, insertedIndex, laterTurnIds) {
    set(state => ({ pendingUsers: state.pendingUsers.map(item => item.threadId === threadId
      && (item.anchorIndex > insertedIndex || item.anchorIndex === insertedIndex && laterTurnIds.includes(item.turnId))
      ? { ...item, anchorIndex: item.anchorIndex + 1 } : item) }));
  },
  show(preview) {
    if (!preview.text) { get().withdraw(preview.threadId, preview.role, preview.turnId); return; }
    const key = timerKey(preview.threadId, preview.role, preview.turnId);
    cancelTimer(key);
    set(state => ({ previews: [
      ...state.previews.filter(item => item.threadId !== preview.threadId || item.role !== preview.role
        || item.turnId !== preview.turnId),
      preview,
    ] }));
    // Un fragmento sin final no debe bloquear indefinidamente el compositor.
    if (preview.role !== 'user' || !get().pendingUsers.some(item =>
      item.threadId === preview.threadId && item.turnId === preview.turnId && item.ended)) {
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        set(state => ({ previews: state.previews.filter(item => item.threadId !== preview.threadId
          || item.role !== preview.role || item.turnId !== preview.turnId) }));
      }, PREVIEW_IDLE_MS));
    }
  },
  withdraw(threadId, role, turnId) {
    cancelTimer(timerKey(threadId, role, turnId));
    set(state => ({ previews: state.previews.filter(item => item.threadId !== threadId
      || item.role !== role || item.turnId !== turnId) }));
  },
  remove(threadId, role, turnId) {
    if (!get().previews.some(item => item.threadId === threadId && item.role === role && item.turnId === turnId)
      && !get().pendingUsers.some(item => item.threadId === threadId && item.turnId === turnId)) return;
    cancelTimer(timerKey(threadId, role, turnId));
    if (role === 'user') cancelTimer(pendingTimerKey(threadId, turnId));
    set(state => ({ previews: state.previews.filter(item =>
      item.threadId !== threadId || item.role !== role || item.turnId !== turnId),
    pendingUsers: role === 'user' ? state.pendingUsers.filter(item =>
      item.threadId !== threadId || item.turnId !== turnId) : state.pendingUsers }));
  },
  clearAssistant(threadId) {
    for (const preview of get().previews) if (preview.threadId === threadId && preview.role === 'assistant')
      cancelTimer(timerKey(threadId, 'assistant', preview.turnId));
    set(state => ({ previews: state.previews.filter(item =>
      item.threadId !== threadId || item.role !== 'assistant') }));
  },
  clear: () => {
    for (const key of timers.keys()) cancelTimer(key);
    set({ previews: [], pendingUsers: [] });
  },
}));

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  useLiveTranscriptPreview.getState().clear();
});
