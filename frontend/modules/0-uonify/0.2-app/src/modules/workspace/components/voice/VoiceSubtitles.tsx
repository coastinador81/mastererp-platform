import { useVoiceSubtitles, subtitlesFor, type VoiceSubtitleScope } from '../../hooks/voiceSubtitles';
import { VoiceTranscriptTurn } from './VoiceTranscriptTurn';

/**
 * Subtítulos de la conversación por voz (PIEZA 2, diseño A′) del hilo activo. Pensado para ir
 * DENTRO de `.conversation-messages`, donde hereda el isotipo ON y el cursor reales. Solo lee el
 * store de subtítulos (solo vista): lo alimenta el WS de la voz vía `applyVoiceTranscriptEvent`.
 */
export function VoiceSubtitles({ account, epoch, threadId }: VoiceSubtitleScope) {
  // Seleccionamos la lista estable y filtramos al renderizar (snapshot cacheable para React).
  const turns = subtitlesFor(useVoiceSubtitles(state => state.turns), { account, epoch, threadId });
  return <>{turns.map(turn => <VoiceTranscriptTurn key={turn.id}
    turn={{ role: turn.role, text: turn.text, finished: turn.finished }} />)}</>;
}
