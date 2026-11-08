import { useSyncExternalStore } from 'react';

/**
 * Mensajes para la región viva de la campana (role="status"). Se escriben desde
 * fuera de React (consulta y mutaciones) y los pinta <NotificationsBell/>.
 */
let current = '';
let sequence = 0;
const listeners = new Set<() => void>();

/** Anuncia un texto; repetir el mismo texto vuelve a leerse (alterna un espacio invisible). */
export function announce(message: string): void {
  sequence += 1;
  current = message ? `${message}${sequence % 2 ? '' : ' '}` : '';
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => current;

export function useAnnouncement(): string {
  return useSyncExternalStore(subscribe, snapshot, () => '');
}
