import '../../styles/voice-transcript.css';

/**
 * Contrato que llega por el MISMO WebSocket de la voz (PIEZA 2). Una pieza de transcripción:
 *  - `role`: quién habla, el cliente (`user`) o Uony.
 *  - `text`: texto del turno; parcial mientras se completa, completo al cerrarse.
 *  - `finished`: false = se está completando en vivo; true = turno cerrado (queda en el historial).
 */
export interface VoiceTranscriptTurnData {
  role: 'user' | 'uony';
  text: string;
  finished: boolean;
}

/** Onda de voz (mismo trazo que el botón de hablar del compositor). */
function Waveform() {
  return <svg className="voice-turn-wave" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    {['M3 10v4', 'M7 7v10', 'M11 3v18', 'M15 6v12', 'M19 10v4', 'M22 8v8'].map(d => <path key={d} d={d} />)}
  </svg>;
}

/**
 * Diseño APROBADO (opción A) de los subtítulos de voz: cada turno es un mensaje más del chat
 * que se completa en vivo, con una marca «voz» y, en Uony, su cursor de escritura mientras habla.
 * Pensado para ir dentro de `.conversation-messages` (así hereda el isotipo ON y el cursor reales).
 * Listo para enchufar al contrato {@link VoiceTranscriptTurnData}: basta mapear cada mensaje del WS.
 */
export function VoiceTranscriptTurn({ turn }: { turn: VoiceTranscriptTurnData }) {
  const who = turn.role === 'user' ? 'Tú' : 'Uony';
  const writing = !turn.finished;
  const transcribing = turn.role === 'user' && writing && !turn.text;
  const className = turn.role === 'user'
    ? `message user voice-turn${transcribing ? ' is-transcribing' : ''}`
    : `message assistant is-uony-reply voice-turn${writing ? ' is-writing' : ''}`;
  return (
    <div className={className} aria-label={`${who}, por voz`}>
      <span className="voice-turn-tag"><Waveform /> {who} · voz</span>
      <span className="voice-turn-body">
        {transcribing ? 'Transcribiendo tu voz…' : turn.text}
        {writing && turn.role === 'uony' && <span className="uony-writing-caret" aria-hidden="true" />}
      </span>
    </div>
  );
}
