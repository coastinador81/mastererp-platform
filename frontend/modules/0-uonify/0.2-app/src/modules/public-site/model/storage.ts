/**
 * Lectura y escritura tolerantes en sessionStorage (como readJSON/saveJSON del PROTO):
 * si el almacenamiento no está disponible, la interfaz sigue funcionando en memoria.
 */
export function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as T | null) : null;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

/** Devuelve true si se ha guardado. */
export function saveSession(key: string, value: unknown): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Preferencias visuales de la portada («Preferencias» del pie), por pestaña. */
export interface HomePreferences { contrast: boolean; reduceMotion: boolean }

export const HOME_PREFERENCES_KEY = 'uonify-preferences';
export const DEFAULT_HOME_PREFERENCES: HomePreferences = { contrast: false, reduceMotion: false };

export function readHomePreferences(): HomePreferences {
  const saved = readSession<Partial<HomePreferences> | null>(HOME_PREFERENCES_KEY, null);
  if (!saved) return { ...DEFAULT_HOME_PREFERENCES };
  return { contrast: saved.contrast === true, reduceMotion: saved.reduceMotion === true };
}

/** Aplica las preferencias al documento (atributos que leen las hojas y el espacio). */
export function applyHomePreferences(preferences: HomePreferences, root: HTMLElement = document.documentElement): void {
  root.dataset.moreContrast = String(preferences.contrast);
  root.dataset.reduceMotion = String(preferences.reduceMotion);
}
