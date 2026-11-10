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

/**
 * Ajustes de accesibilidad («Más contraste» y «Reducir movimiento», en el menú «Idioma y
 * accesibilidad» del pie global), por pestaña. El espacio de trabajo lee la misma clave.
 */
export interface HomePreferences { contrast: boolean; reduceMotion: boolean }

export const HOME_PREFERENCES_KEY = 'uonify-preferences';
export const DEFAULT_HOME_PREFERENCES: HomePreferences = { contrast: false, reduceMotion: false };

/** Las guardadas en la pestaña; sin nada guardado, `fallback` (por defecto, las dos apagadas). */
export function readHomePreferences(fallback: HomePreferences = DEFAULT_HOME_PREFERENCES): HomePreferences {
  const saved = readSession<Partial<HomePreferences> | null>(HOME_PREFERENCES_KEY, null);
  if (!saved) return { ...fallback };
  return { contrast: saved.contrast === true, reduceMotion: saved.reduceMotion === true };
}

/** Aplica las preferencias al documento (atributos que leen las hojas y el espacio). */
export function applyHomePreferences(preferences: HomePreferences, root: HTMLElement = document.documentElement): void {
  root.dataset.moreContrast = String(preferences.contrast);
  root.dataset.reduceMotion = String(preferences.reduceMotion);
}

/** Las que ya tiene el documento (`:root[data-more-contrast]` y `:root[data-reduce-motion]`). */
export function documentHomePreferences(root: HTMLElement = document.documentElement): HomePreferences {
  return { contrast: root.dataset.moreContrast === 'true', reduceMotion: root.dataset.reduceMotion === 'true' };
}
