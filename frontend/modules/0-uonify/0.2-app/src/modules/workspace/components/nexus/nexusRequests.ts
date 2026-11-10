import { useCallback, useState } from 'react';

/** Solicitudes de activación por cuenta, guardadas solo en este navegador. */
export const NEXUS_REQUESTED_KEY = 'uonify.nexus.requested';

type Stored = Record<string, string[]>;

function readAll(): Stored {
  try {
    const raw = window.localStorage.getItem(NEXUS_REQUESTED_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Stored : {};
  } catch {
    return {};
  }
}

function readFor(account: string): string[] {
  const list = readAll()[account];
  return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
}

export function useNexusRequests(account: string) {
  const [requested, setRequested] = useState<string[]>(() => readFor(account));
  const [owner, setOwner] = useState(account);
  if (owner !== account) { setOwner(account); setRequested(readFor(account)); }
  const request = useCallback((id: string) => {
    setRequested(current => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      try {
        window.localStorage.setItem(NEXUS_REQUESTED_KEY, JSON.stringify({ ...readAll(), [account]: next }));
      } catch { /* Sin almacenamiento: la solicitud queda registrada en esta sesión. */ }
      return next;
    });
  }, [account]);
  return { isRequested: (id: string) => requested.includes(id), request };
}
