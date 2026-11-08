import { useEffect, useRef, useState } from 'react';

interface RecognitionResultEvent { results: ArrayLike<ArrayLike<{ transcript?: string }>> }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
type RecognitionConstructor = new () => Recognition;
export type ListeningMode = 'dictate' | 'talk';
interface AudioState { mode: ListeningMode | null; microphoneMuted: boolean; speakerMuted: boolean }
interface SpeechOptions {
  onTranscript: (transcript: string) => void;
  report: (message: string) => void;
  submit: () => void;
  focusDraft: () => void;
}
const INITIAL: AudioState = { mode: null, microphoneMuted: false, speakerMuted: false };

/** Portada: dictado y conversación con controles independientes de entrada y salida. */
export function useSpeechInput(options: SpeechOptions) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [state, setState] = useState<AudioState>(INITIAL);
  const [controller] = useState(() => {
    let audio = { ...INITIAL };
    let recognition: Recognition | null = null;
    let utterance: SpeechSynthesisUtterance | null = null;
    let waiting = false;
    let removeReply: (() => void) | undefined;
    const report = (message: string) => latest.current.report(message);
    const update = (patch: Partial<AudioState>) => { audio = { ...audio, ...patch }; setState(audio); };
    const abort = () => {
      const old = recognition; recognition = null;
      if (old) { old.onresult = null; old.onend = null; old.onerror = null; old.abort(); }
    };
    const silence = () => {
      if (utterance) { utterance.onend = null; utterance.onerror = null; utterance = null; }
      window.speechSynthesis?.cancel();
    };
    const stop = () => {
      abort(); silence(); removeReply?.(); removeReply = undefined; waiting = false; update(INITIAL);
    };
    const listen = () => {
      if (!audio.mode || audio.microphoneMuted || waiting || utterance || recognition) return;
      const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
      const Speech = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
      if (!Speech) { stop(); report('El dictado por voz no está disponible en este navegador.'); return; }
      const current = new Speech(); recognition = current;
      current.lang = 'es-ES'; current.interimResults = false; current.continuous = false;
      report(audio.mode === 'dictate' ? 'Dictando… Tu voz se convierte en texto. Envíalo cuando termines.' : 'Escuchando tu petición…');
      current.onresult = event => {
        if (recognition !== current || audio.microphoneMuted) return;
        const transcript = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ').trim();
        if (!transcript) return;
        latest.current.onTranscript(transcript);
        if (audio.mode === 'dictate') {
          stop(); latest.current.focusDraft(); report('Texto añadido al mensaje.'); return;
        }
        abort(); waiting = true; report('Petición recibida.');
        const reply = (event: Event) => {
          removeReply?.(); removeReply = undefined; waiting = false;
          if (audio.mode !== 'talk') return;
          const text = (event as CustomEvent<{ text?: string }>).detail?.text;
          if (!text || audio.speakerMuted || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { listen(); return; }
          silence(); abort();
          const speech = new SpeechSynthesisUtterance(text); utterance = speech;
          speech.lang = 'es-ES';
          speech.onend = () => { utterance = null; listen(); };
          speech.onerror = () => { utterance = null; report('Puedes leer la respuesta en el chat.'); listen(); };
          window.speechSynthesis.speak(speech);
        };
        const timer = window.setTimeout(() => {
          stop(); report('Puedes continuar por escrito o volver a activar la voz.');
        }, 8000);
        removeReply = () => { window.clearTimeout(timer); window.removeEventListener('uonify:assistant-reply', reply); };
        window.addEventListener('uonify:assistant-reply', reply, { once: true });
        latest.current.submit();
      };
      current.onerror = event => {
        if (recognition !== current || event.error === 'aborted') return;
        stop(); report(event.error === 'not-allowed' ? 'Permite el micrófono en tu navegador para usar la voz.' : 'No se pudo reconocer la voz. Inténtalo de nuevo.');
      };
      current.onend = () => {
        if (recognition !== current) return;
        stop(); report('Micrófono detenido. Puedes volver a activar la voz.');
      };
      try { current.start(); } catch { stop(); report('No se pudo iniciar el micrófono.'); }
    };
    return {
      stop,
      start(next: ListeningMode) {
        const same = audio.mode === next;
        stop();
        if (same) { report('Micrófono detenido.'); return; }
        update({ mode: next }); listen();
      },
      toggleMicrophone() {
        if (audio.mode !== 'talk') return;
        update({ microphoneMuted: !audio.microphoneMuted });
        if (audio.microphoneMuted) abort(); else listen();
        report(audio.microphoneMuted ? 'Micrófono silenciado. La conversación sigue abierta.' : 'Micrófono activado.');
      },
      toggleSpeaker() {
        if (audio.mode !== 'talk') return;
        update({ speakerMuted: !audio.speakerMuted });
        if (audio.speakerMuted) { silence(); listen(); }
        report(audio.speakerMuted ? 'Altavoz silenciado.' : 'Altavoz activado para las próximas respuestas de Uony.');
      },
    };
  });
  useEffect(() => () => controller.stop(), [controller]);
  return { ...state, ...controller };
}
