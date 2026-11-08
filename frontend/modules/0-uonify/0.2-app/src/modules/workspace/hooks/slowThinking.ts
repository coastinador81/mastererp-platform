import { useEffect } from 'react';
import { create } from 'zustand';
import { useComposerStore } from './composerStore';
import { useUiStore, type PendingReply, type ProvisionalReply } from './uiStore';

/**
 * Lote 9 (maqueta aprobada por el dueño el 22-10-2026): si Google no empieza a responder en 20 s,
 * «Uony está pensando…» deja la línea junto al compositor y pasa al sitio donde aparecerá la
 * respuesta. En cuanto llega el texto (F1-S), lo sustituye en ese mismo sitio.
 */
export const SLOW_THINKING_MS = 20_000;

interface SlowThinkingState {
  /** Hilo de la respuesta escrita en espera; null si no hay ninguna que cumpla las condiciones. */
  threadId: string | null;
  since: number;
  slow: boolean;
}

export const useSlowThinking = create<SlowThinkingState>()(() => ({ threadId: null, since: 0, slow: false }));

/** Solo la respuesta escrita corriente: Drive, requisitos y voz conservan su propio aviso. */
export function slowThinkingEligible(pending: PendingReply | null, provisional: ProvisionalReply | null,
  voice: boolean): pending is PendingReply {
  if (!pending || pending.purpose || pending.requirements || voice) return false;
  const writing = !!pending.requestId && provisional?.threadId === pending.threadId
    && provisional.requestId === pending.requestId && !!provisional.text;
  return !writing;
}

export const slowThinkingFor = (threadId: string | null | undefined) =>
  (state: SlowThinkingState) => !!threadId && state.slow && state.threadId === threadId;

/**
 * Cuenta los 20 s desde que empieza la espera. Varias instancias pueden convivir un momento
 * (la conversación cambia de sitio): comparten el inicio, así que el aviso no vuelve a empezar.
 */
export function useSlowThinkingTimer(): void {
  const voice = useComposerStore(state => state.listening === 'talk');
  const threadId = useUiStore(state => {
    const pending = state.pendingReply;
    return slowThinkingEligible(pending, state.provisionalReply, voice) ? pending.threadId : null;
  });
  useEffect(() => {
    const current = useSlowThinking.getState();
    if (!threadId) {
      if (current.threadId) useSlowThinking.setState({ threadId: null, since: 0, slow: false });
      return;
    }
    const since = current.threadId === threadId ? current.since : Date.now();
    if (current.threadId !== threadId) useSlowThinking.setState({ threadId, since, slow: false });
    const wait = since + SLOW_THINKING_MS - Date.now();
    if (wait <= 0) {
      useSlowThinking.setState({ slow: true });
      return;
    }
    const timer = window.setTimeout(() => {
      if (useSlowThinking.getState().threadId === threadId) useSlowThinking.setState({ slow: true });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [threadId]);
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () =>
  useSlowThinking.setState({ threadId: null, since: 0, slow: false }));
