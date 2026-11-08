import { useEffect, useState } from 'react';
import { secondsUntil } from '../model/emailCode';

/**
 * Segundos que faltan hasta `at` (ms), refrescados cada segundo mientras queden
 * (p. ej. «Reenviar código en 0:24»). Al llegar a 0 deja de programar nada.
 */
export function useCountdown(at: number): number {
  const [now, setNow] = useState(() => Date.now());
  const remaining = secondsUntil(at, now);
  const running = remaining > 0;
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Corrige enseguida la hora guardada (puede ser de hace rato) y sigue cada segundo.
    const first = window.setTimeout(tick, 0);
    const timer = running ? window.setInterval(tick, 1000) : undefined;
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [at, running]);
  return remaining;
}
