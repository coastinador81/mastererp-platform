import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;

/** Hora actual redondeada al minuto: estable dentro del minuto, así el render es puro. */
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;

function subscribe(notify: () => void): () => void {
  const timer = setInterval(notify, 15_000);
  return () => clearInterval(timer);
}

/** «Ahora» para los textos relativos («Hace 5 min»); se actualiza solo cada minuto. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, minuteNow, minuteNow);
}
