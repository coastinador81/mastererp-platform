type VoiceState = 'connecting' | 'listening' | 'speaking' | 'interrupted';
const NO_CAPTIONS = 'La voz sigue; transcripción en directo no disponible.';
const CONNECTING = 'Uony está conectando la voz…';
const SPEAKING = 'Uony está hablando…';
const LISTENING = 'Voz en directo de prueba. Los mensajes confirmados quedan en el chat.';

/** Estado de fondo de la voz (conectando, escuchando, hablando): no es un aviso del turno. */
export function isLiveVoiceBackdrop(text: string): boolean {
  return [NO_CAPTIONS, CONNECTING, SPEAKING, LISTENING].includes(text);
}

/** Avisos recuperables del turno, en la línea de estado ya existente. */
export function createLiveVoiceStatus(emit: (text: string) => void, latestTurn: () => string | undefined) {
  let current: VoiceState = 'connecting';
  let captionsUnavailable = false;
  let actionTurn: string | null = null;
  let noticeTurn: string | null = null;
  let noticeText = '';
  const update = () => emit(actionTurn
    ? 'No he podido confirmar tu petición por voz. No inicié ningún trabajo; repítela o escríbela.'
    : noticeTurn ? noticeText
      : captionsUnavailable ? NO_CAPTIONS
        : current === 'connecting' ? CONNECTING
          : current === 'speaking' ? SPEAKING : LISTENING);
  return {
    status(state: VoiceState) { current = state; update(); },
    caption(state: 'ready' | 'unavailable') { captionsUnavailable = state === 'unavailable'; update(); },
    startTurn(turnId?: string) {
      const changed = actionTurn && actionTurn !== turnId || noticeTurn && noticeTurn !== turnId;
      if (actionTurn !== turnId) actionTurn = null;
      if (noticeTurn !== turnId) noticeTurn = null;
      if (changed) update();
    },
    notice(turnId: string, reason: 'response_audio_limit' | 'response_audio_unavailable' |
      'narration_unavailable' = 'response_audio_limit') {
      const latest = latestTurn();
      if (latest && turnId !== latest) return;
      noticeTurn = turnId;
      noticeText = reason === 'narration_unavailable'
        ? 'La respuesta está en el chat, pero no he podido decirla en voz alta. Puedes seguir hablando.'
        : reason === 'response_audio_unavailable'
          ? 'Esta respuesta está en el chat; la voz no se pudo reproducir. Puedes seguir hablando.'
          : 'Esta respuesta se muestra en el chat. Puedes seguir hablando.';
      update();
    },
    actionUnconfirmed(turnId: string) { actionTurn = turnId; update(); },
    semanticFailure(turnId: string, message: string, persistence: 'pending' | 'saved' | 'unknown') {
      if (latestTurn() && latestTurn() !== turnId) return;
      if (actionTurn === turnId) actionTurn = null;
      noticeTurn = turnId;
      noticeText = message + (persistence === 'unknown' ? ' No se ha podido confirmar el guardado del aviso.' : '');
      update();
    },
    handoff(turnId: string) {
      const changed = actionTurn === turnId || noticeTurn === turnId;
      if (actionTurn === turnId) actionTurn = null;
      if (noticeTurn === turnId) noticeTurn = null;
      if (changed) update();
    },
  };
}
