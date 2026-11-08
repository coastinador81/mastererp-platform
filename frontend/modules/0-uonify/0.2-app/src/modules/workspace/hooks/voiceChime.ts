// Tonos breves de cortesía al activar o apagar la voz de Uony, generados con WebAudio
// (sin archivos de audio). Se reutiliza un único AudioContext y cualquier fallo se ignora:
// el sonido es opcional y nunca debe interrumpir la conversación.

let shared: AudioContext | null = null;

type ChimeCapableWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as ChimeCapableWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!shared || shared.state === 'closed') shared = new Ctor();
    // La política de autoplay permite reanudarlo dentro del gesto del botón.
    if (shared.state === 'suspended') void shared.resume().catch(() => {});
    return shared;
  } catch {
    return null;
  }
}

type Chime = 'start' | 'stop';

/** Dos notas ascendentes (C5→E5) al activar y descendentes (E5→C5) al apagar, ~180 ms. */
export function playVoiceChime(kind: Chime): void {
  const context = audioContext();
  if (!context) return;
  try {
    const C5 = 523.25;
    const E5 = 659.25;
    const notes = kind === 'start' ? [C5, E5] : [E5, C5];
    const note = 0.09; // cada nota ~90 ms
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * note;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      // Envolvente suave de entrada y salida para que no se oiga ningún clic.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + note + 0.02);
    });
  } catch {
    /* El tono de cortesía es opcional: si el navegador lo bloquea, se omite sin ruido. */
  }
}
