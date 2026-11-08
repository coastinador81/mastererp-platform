import { create } from 'zustand';
import type { LiveTransportEvent } from '../api/liveTransport';
import type { VoiceTranscriptTurnData } from '../components/voice/VoiceTranscriptTurn';

/**
 * Subtítulos de la conversación por voz (PIEZA 2, diseño A′). SOLO VISTA: nunca se persiste (C5).
 * Se alimenta del tipo `subtitle` del WS de la voz ({role, text, finished}) — un canal SEPARADO de
 * la ruta de caption persistida (`transcript_preview`/`transcript`). Reglas A′ (dueño 27-10):
 *  - tu voz (user): aparece COMPLETA al cerrar el turno; los parciales en vivo no se muestran.
 *  - Uony (uony): se completa EN VIVO (un turno abierto que se actualiza) y se fija al terminar.
 *  - barge-in: un turno del usuario, o `discardUnfinished` desde la voz, descarta el parcial de Uony.
 */
export interface VoiceSubtitle extends VoiceTranscriptTurnData {
  account: string;
  epoch: number;
  threadId: string;
  id: number;
}

export interface VoiceSubtitleScope { account: string; epoch: number; threadId: string }

let sequence = 0;

interface VoiceSubtitlesState {
  turns: VoiceSubtitle[];
  /** Aplica un subtítulo {role, text, finished} con la regla A′. */
  applySubtitle(scope: VoiceSubtitleScope, role: 'user' | 'uony', text: string, finished: boolean): void;
  /** Barge-in: descarta el subtítulo de Uony sin terminar del hilo (nunca se persiste). */
  discardUnfinished(scope: VoiceSubtitleScope): void;
  clearScope(scope: VoiceSubtitleScope): void;
  clear(): void;
}

const inScope = (turn: VoiceSubtitle, scope: VoiceSubtitleScope) => turn.account === scope.account
  && turn.epoch === scope.epoch && turn.threadId === scope.threadId;

export const useVoiceSubtitles = create<VoiceSubtitlesState>()(set => ({
  turns: [],
  applySubtitle(scope, role, text, finished) {
    set(state => {
      if (role === 'user') {
        if (!finished) return state; // A′: la voz del usuario solo se muestra al cerrar su turno.
        // Un turno del usuario descarta el parcial de Uony en curso (barge-in).
        const kept = state.turns.filter(turn => !(inScope(turn, scope) && turn.role === 'uony' && !turn.finished));
        return { turns: [...kept, { ...scope, id: ++sequence, role: 'user', text, finished: true }] };
      }
      // Uony: actualiza el turno abierto (sin terminar) o abre uno nuevo.
      const open = state.turns.findLastIndex(turn => inScope(turn, scope) && turn.role === 'uony' && !turn.finished);
      if (open === -1) return { turns: [...state.turns, { ...scope, id: ++sequence, role: 'uony', text, finished }] };
      const turns = state.turns.slice();
      turns[open] = { ...turns[open], text, finished };
      return { turns };
    });
  },
  discardUnfinished(scope) {
    set(state => ({ turns: state.turns.filter(turn => !(inScope(turn, scope) && turn.role === 'uony' && !turn.finished)) }));
  },
  clearScope(scope) {
    set(state => ({ turns: state.turns.filter(turn => !inScope(turn, scope)) }));
  },
  clear: () => set({ turns: [] }),
}));

/** Subtítulos del hilo activo, en orden de llegada. */
export function subtitlesFor(turns: readonly VoiceSubtitle[], scope: VoiceSubtitleScope): VoiceSubtitle[] {
  return turns.filter(turn => inScope(turn, scope));
}

/** Enchufa el evento `subtitle` del WS (PIEZA 2) a los subtítulos con la regla A′. Solo vista. */
export function applyVoiceSubtitleEvent(scope: VoiceSubtitleScope,
  event: Extract<LiveTransportEvent, { type: 'subtitle' }>): void {
  useVoiceSubtitles.getState().applySubtitle(scope, event.role, event.text, event.finished);
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  useVoiceSubtitles.getState().clear();
});
