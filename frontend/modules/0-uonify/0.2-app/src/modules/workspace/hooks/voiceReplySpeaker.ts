import { useComposerStore } from './composerStore';

/**
 * Locución de las respuestas de Uony con la síntesis del navegador, solo para
 * la voz clásica. La voz en directo nunca la usa: la respuesta del agente la dice
 * la voz de Uony (narración verificada) o queda escrita (decisión del dueño, 20-10-2026).
 */
const composer = () => useComposerStore.getState();
const SPEAKING_STATUS = 'Uony está hablando… Pulsa de nuevo el botón de voz para detenerlo.';
let speaking: SpeechSynthesisUtterance | null = null;

/** `true` mientras una respuesta se está leyendo en voz alta. */
export function isSpeaking(): boolean {
  return speaking !== null;
}

/** Corta cualquier locución en curso sin disparar sus `onend`/`onerror`. */
export function cancelSpeech(): void {
  if (speaking) { speaking.onend = null; speaking.onerror = null; speaking = null; }
  window.speechSynthesis?.cancel();
}

export interface SpeakReplyOptions {
  spoken: string;
  beforeSpeak: () => void;
  onEnd: () => void;
  onError: () => void;
}

/**
 * Lee `spoken` en es-ES. Devuelve `false` sin hablar si el altavoz está
 * silenciado o el navegador no tiene síntesis; el que llama decide entonces
 * cómo seguir. Reproduce el comportamiento exacto de la voz clásica.
 */
export function speakReply(options: SpeakReplyOptions): boolean {
  if (composer().speakerMuted || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false;
  options.beforeSpeak();
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(options.spoken);
  speaking = utterance;
  utterance.lang = 'es-ES'; utterance.rate = 1.05;
  utterance.onend = () => { if (speaking === utterance) speaking = null; options.onEnd(); };
  utterance.onerror = () => { if (speaking === utterance) speaking = null; options.onError(); };
  composer().setStatus(SPEAKING_STATUS);
  window.speechSynthesis.speak(utterance);
  return true;
}
